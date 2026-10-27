import { useState, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import { usePermissions } from "../../shared/hooks/usePermissions";
import { repairStatus, taskStatus, repairFinancialMonth } from "../../shared/utils/repair";
import { resolveFixedCosts } from "../../shared/utils/finance";
import { fmtDate, fmtMoney, fmtDayMonth } from "../../shared/utils/format";
import { Badge } from "../../shared/ui/Badge";

import { Input, Select, FormGroup } from "../../shared/ui/Input";
import { Button } from "../../shared/ui/Button";
import { PhotoGrid } from "../../shared/ui/PhotoUploader";
import { PhotoLightbox } from "../../shared/ui/PhotoLightbox";
import { CreatorLine } from "../../shared/ui/CreatorLine";
import {
  assertFieldsUnchanged,
  canonicalEntityJson,
  ConcurrentMutationError,
  mutateClientRepair,
  mutateRepairTask,
} from "../../shared/firebase/concurrency";
import {
  assignIntakeRepairToClient,
  type AssignIntakeTarget,
} from "../../shared/firebase/intake";
import { RepairTaskWork, intakeRepairEditor } from "../../shared/repair-work";
import type { Repair, Client, Vehicle, RepairTask } from "../../shared/types/client";
import { intakeKind, type IntakeRepair } from "../../shared/types/intake";
import { suggestIntakeVehicles, suggestedVehicleForClient, vehicleMatchesSearch } from "../../shared/utils/clientVehicleSearch";
import type { ServiceTask } from "../../shared/types/task";
import type { PhotoData } from "../../shared/utils/photos";

import {closureIssue,parseClosureAmount} from "../../shared/utils/repairClosure";
import {prepareRepairClose,createRepairReview} from "../../shared/firebase/repairClose";
import {requestStage,selectServiceRequests} from "../../shared/requests/workspaceLogic";
import {ReportModal as Modal,ReportsWorkspace,ReportQueueCard,ReportSourceBoundary,ReportCloseReview,useReportWriteBlocked,type ReportView} from "./ReportsWorkspace";
import {selectReportItems,selectReportIntake,reportScope,confirmedReportData,reportArchiveMonths,reportTaskMonth,DEFAULT_REPORT_FILTERS,type ReportFilters,type DoneItem} from "./reportsLogic";

const FREON_TYPES = ["R134a", "R404A", "R410A", "R507", "R22", "R507a"];

const MONTH_NAMES_FULL = [
  "Январь","Февраль","Март","Апрель","Май","Июнь",
  "Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь",
];

function monthLabel(mk: string): string {
  if (mk === "0000-00" || !mk.includes("-")) return "Без даты";
  const [y, m] = mk.split("-");
  const month = MONTH_NAMES_FULL[parseInt(m) - 1];
  return month ? `${month} ${y}` : mk;
}

// ─── Avatar color helper ──────────────────────────────────────────────────────

const AVATAR_COLORS = [
  { bg: "rgba(59,130,246,0.15)",  color: "#2563eb" },
  { bg: "rgba(34,197,94,0.15)",   color: "#16a34a" },
  { bg: "rgba(139,92,246,0.15)",  color: "#7c3aed" },
  { bg: "rgba(245,158,11,0.15)",  color: "#b45309" },
  { bg: "rgba(6,182,212,0.15)",   color: "#0891b2" },
  { bg: "rgba(239,68,68,0.15)",   color: "#dc2626" },
];

function avatarColor(str: string) {
  let n = 0;
  for (const c of str) n += c.charCodeAt(0);
  return AVATAR_COLORS[n % AVATAR_COLORS.length];
}

// ─── Data shape ───────────────────────────────────────────────────────────────

// ─── Intake close card — assign the car to a client, then close ───────────────

function IntakeCloseCard({ intake, clients }: { intake: IntakeRepair; clients: Client[] }) {
  const { myProfile, user } = useAuth();
  const blocked=useReportWriteBlocked();
  const [reviewing,setReviewing]=useState(false);
  const [reviewedIntake,setReviewedIntake]=useState<IntakeRepair|null>(null);
  const editor = intakeRepairEditor(intake.id, {
    uid: user?.uid ?? "",
    name: myProfile?.name ?? user?.email ?? "Неизвестно",
  });

  const kind = intakeKind(intake);
  const isChamber = kind === "chamber";
  const plate = intake.vehicle?.plate ?? "";
  const matches = useMemo(
    () => (isChamber ? [] : suggestIntakeVehicles(clients, plate)),
    [clients, plate, isChamber],
  );

  const [sum, setSum] = useState(intake.repair.cost ?? "");
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [clientId, setClientId] = useState("");
  const [equipChoice, setEquipChoice] = useState<string>("new");
  const [search, setSearch] = useState("");
  const [nName, setNName] = useState("");
  const [nType, setNType] = useState<"phys" | "legal">("phys");
  const [nPhone, setNPhone] = useState("");
  const [nInn, setNInn] = useState("");
  const [nContact, setNContact] = useState("");
  const [nNote, setNNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const { repair } = intake;
  const tasks = repair.tasks ?? [];
  const equipName = isChamber
    ? `камера «${intake.chamber?.label ?? ""}»`
    : `машина «${plate}»`;
  const title = isChamber
    ? (intake.chamber?.label || "Камера")
    : ([intake.vehicle?.brand, intake.vehicle?.model].filter(Boolean).join(" ") || "Автомобиль");
  const photo = isChamber ? intake.chamber?.photo : intake.vehicle?.photo;
  const selectedClient = clients.find((c) => c.id === clientId);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients.slice(0, 8);
    return clients
      .filter((c) => c.name.toLowerCase().includes(q) || (c.vehicles ?? []).some((v) => vehicleMatchesSearch(v, q)))
      .slice(0, 12);
  }, [clients, search]);

  function checkReview():boolean {
    const issue=closureIssue(repair);
    if(issue){setError(issue);return false;}
    if(parseClosureAmount(sum)===null){setError("Укажите корректную сумму: 0 или больше, не более двух знаков после запятой.");return false;}
    if(mode==='existing'&&(!selectedClient||!equipChoice)){setError("Выберите клиента и технику.");return false;}
    if(mode==='new'&&!nName.trim()){setError("Укажите имя клиента или название компании.");return false;}
    setError("");return true;
  }
  async function handleAssign() {
    if(busy||blocked||!reviewedIntake||!checkReview())return;
    setError("");
    if (!sum.trim()) { setError("Укажите сумму"); return; }
    if (mode === "existing" && !equipChoice) { setError("Выберите конкретную машину из совпавших вариантов"); return; }

    const equipment: AssignIntakeTarget["equipment"] =
      mode === "new" || equipChoice === "new" ? { create: true } : { existingId: equipChoice };

    let target: AssignIntakeTarget;
    if (mode === "new") {
      if (!nName.trim()) { setError("Укажите имя клиента"); return; }
      target = {
        client: {
          create: {
            name: nName, clientType: nType,
            phone: nPhone || undefined,
            inn: nType === "legal" ? (nInn || undefined) : undefined,
            contactPerson: nType === "legal" ? (nContact || undefined) : undefined,
            note: nNote || undefined,
          },
        },
        equipment,
        requireReady: true, cost: sum, closedBy: user?.uid ?? "", closedByName: myProfile?.name ?? "Менеджер",
      };
    } else {
      if (!clientId) { setError("Выберите клиента"); return; }
      target = {
        client: { existingId: clientId },
        equipment,
        requireReady: true, cost: sum, closedBy: user?.uid ?? "", closedByName: myProfile?.name ?? "Менеджер",
      };
    }

    setBusy(true);
    try {
      await assignIntakeRepairToClient(reviewedIntake!, target);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось закрыть");
    } finally { setBusy(false); }
  }

  return (
    <div className="reports-ready-card" style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderLeft: "3px solid #16a34a", borderRadius: 14, padding: "14px", boxShadow: "0 2px 10px rgba(0,0,0,0.18)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 8 }}>
        {photo
          ? <img src={photo} alt="" style={{ width: 48, height: 48, borderRadius: 10, objectFit: "cover", flexShrink: 0, border: "1px solid var(--border)" }} />
          : <div style={{ width: 48, height: 48, borderRadius: 10, flexShrink: 0, background: "rgba(59,130,246,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{isChamber ? "🧊" : "🚚"}</div>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{title}</div>
          <div style={{ fontSize: 12, color: "var(--text3)", fontFamily: "JetBrains Mono, monospace" }}>
            {isChamber ? "камера" : plate}
          </div>
          <CreatorLine name={intake.createdByName} date={intake.createdAt} style={{ marginTop: 2 }} />
        </div>
      </div>

      <RepairTaskWork repair={repair} tasks={tasks} editor={editor} canManageTasks={!blocked&&!busy} />

      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
        <fieldset className="reports-intake-fields" disabled={busy||blocked||reviewing}>
        <FormGroup label="Итоговая стоимость, ₽">
          <Input aria-label="Стоимость приёмки" inputMode="decimal" placeholder="0" value={sum} disabled={busy||blocked} onChange={(e) => {setSum(e.target.value);setReviewing(false);}} />
        </FormGroup>

        {matches.length > 0 && (
          <div style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)", borderRadius: 10, padding: "8px 10px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#16a34a", marginBottom: 4 }}>Возможные машины в базе</div>
            <div style={{ fontSize: 11, color: "var(--text3)" }}>Выберите машину, чтобы сохранить ремонт в её существующей истории. Совпадение цифр не гарантирует совпадение машины.</div>
            {matches.map((m) => (
              <button
                key={`${m.client.id}-${m.vehicle.id}`}
                type="button"
                onClick={() => { setMode("existing"); setClientId(m.client.id); setEquipChoice(m.vehicle.id); }}
                style={{
                  display: "block", width: "100%", textAlign: "left", marginTop: 4, padding: "6px 8px", borderRadius: 8,
                  fontSize: 12, cursor: "pointer",
                  border: `1px solid ${clientId === m.client.id && equipChoice === m.vehicle.id ? "#16a34a" : "var(--border)"}`,
                  background: clientId === m.client.id && equipChoice === m.vehicle.id ? "rgba(34,197,94,0.15)" : "var(--bg3)",
                  color: "var(--text)",
                }}
              >
                {m.client.name} · {[m.vehicle.brand, m.vehicle.model, m.vehicle.plate].filter(Boolean).join(" ")} · {m.exact ? "Точный номер" : "Совпадают цифры номера"}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 6 }}>
          {(["existing", "new"] as const).map((mo) => (
            <button
              key={mo}
              type="button"
              onClick={() => setMode(mo)}
              style={{
                flex: 1, padding: "7px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: mode === mo ? "1px solid var(--accent)" : "1px solid var(--border2)",
                background: mode === mo ? "var(--accent)" : "var(--bg3)",
                color: mode === mo ? "white" : "var(--text2)",
              }}
            >
              {mo === "existing" ? "Существующий клиент" : "Новый клиент"}
            </button>
          ))}
        </div>

        {mode === "existing" ? (
          <>
            {selectedClient ? (
              <div style={{ fontSize: 13, color: "var(--text)", padding: "8px 10px", background: "var(--bg3)", borderRadius: 8, border: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span><b>{selectedClient.name}</b></span>
                  <button type="button" onClick={() => { setClientId(""); setSearch(""); }} style={{ fontSize: 11, color: "var(--accent2)", background: "transparent", border: "none", cursor: "pointer" }}>сменить</button>
                </div>
                <div style={{ marginTop: 6 }}>
                  <FormGroup label={isChamber ? "Камера" : "Машина"}>
                    <Select value={equipChoice} onChange={(e) => setEquipChoice(e.target.value)}>
                      {!isChamber && <option value="" disabled>Выберите машину — найдено несколько вариантов</option>}
                      {isChamber
                        ? (selectedClient.chambers ?? []).map((ch) => (
                            <option key={ch.id} value={ch.id}>
                              {ch.notes ? ch.notes.slice(0, 40) : `Камера ${ch.id.slice(0, 4)}`}
                            </option>
                          ))
                        : (selectedClient.vehicles ?? []).map((v) => (
                            <option key={v.id} value={v.id}>{[v.brand, v.plate].filter(Boolean).join(" ")}</option>
                          ))}
                      <option value="new">➕ {isChamber ? `Новая камера «${intake.chamber?.label ?? ""}»` : `Новая машина «${plate}»`}</option>
                    </Select>
                  </FormGroup>
                </div>
              </div>
            ) : (
              <>
                <Input placeholder="Поиск клиента по имени или номеру" value={search} onChange={(e) => setSearch(e.target.value)} />
                <div style={{ maxHeight: 180, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                  {filtered.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setClientId(c.id);
                        setEquipChoice(isChamber ? (c.chambers?.[0]?.id ?? "new") : suggestedVehicleForClient(c, search, plate));
                      }}
                      style={{ textAlign: "left", padding: "7px 10px", borderRadius: 8, fontSize: 13, cursor: "pointer", background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)" }}
                    >
                      {c.name}
                      {(c.vehicles ?? []).length > 0 && (
                        <span style={{ color: "var(--text3)", fontSize: 11 }}> · {(c.vehicles ?? []).map((v) => v.plate).join(", ")}</span>
                      )}
                    </button>
                  ))}
                  {filtered.length === 0 && <div style={{ fontSize: 12, color: "var(--text3)", padding: 6 }}>Ничего не найдено</div>}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6 }}>
              {(["phys", "legal"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setNType(t)} style={{
                  flex: 1, padding: "6px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                  border: nType === t ? "1px solid var(--accent)" : "1px solid var(--border2)",
                  background: nType === t ? "var(--accent)" : "var(--bg3)", color: nType === t ? "white" : "var(--text2)",
                }}>
                  {t === "phys" ? "Физлицо" : "Компания"}
                </button>
              ))}
            </div>
            <FormGroup label={nType === "phys" ? "ФИО *" : "Название *"}>
              <Input placeholder={nType === "phys" ? "Иван Иванов" : "ООО «Пример»"} value={nName} onChange={(e) => setNName(e.target.value)} />
            </FormGroup>
            <FormGroup label="Телефон"><Input type="tel" placeholder="+7 924 000 00 00" value={nPhone} onChange={(e) => setNPhone(e.target.value)} /></FormGroup>
            {nType === "legal" && (
              <>
                <FormGroup label="ИНН"><Input value={nInn} onChange={(e) => setNInn(e.target.value)} /></FormGroup>
                <FormGroup label="Контактное лицо"><Input value={nContact} onChange={(e) => setNContact(e.target.value)} /></FormGroup>
              </>
            )}
            <FormGroup label="Примечание"><Input value={nNote} onChange={(e) => setNNote(e.target.value)} /></FormGroup>
            <div style={{ fontSize: 11, color: "var(--text3)" }}>{equipName[0].toUpperCase() + equipName.slice(1)} будет добавлена этому клиенту.</div>
          </>
        )}

        </fieldset>
        {error && <div role="alert" style={{ fontSize: 12, color: "#dc2626", fontWeight: 600 }}>⚠ {error}</div>}
        {!reviewing?<Button size="lg" onClick={()=>{if(!blocked&&checkReview()){setReviewedIntake(intake);setReviewing(true);}}} disabled={busy||blocked}>Проверить привязку и стоимость</Button>:<ReportCloseReview name={`${mode==='new'?nName:selectedClient?.name||'Клиент'} · ${title} ${plate}`} amount={sum} busy={busy} blocked={blocked} onCancel={()=>setReviewing(false)} onConfirm={()=>void handleAssign()}/>}
      </div>
    </div>
  );
}

// ─── Close repair card (needs manager action) ─────────────────────────────────

function NeedsCloseCard({ item, onOpenClient }: { item: DoneItem; onOpenClient?: (client: Client, vehicleId?: string) => void }) {
  const { repair, client, vehicle, assigneeNames } = item;
  const { staff } = useData();
  const {user}=useAuth();
  const blocked=useReportWriteBlocked();
  const [error,setError]=useState("");
  const [reviewing,setReviewing]=useState(false);
  const [review,setReview]=useState<ReturnType<typeof createRepairReview>|null>(null);
  const [closeSum,     setCloseSum]     = useState(repair.cost ?? "");
  const [closing,      setClosing]      = useState(false);
  const [reopeningId,  setReopeningId]  = useState<string | null>(null);
  const [gallery,      setGallery]      = useState<{ photos: PhotoData[]; index: number } | null>(null);

  const av       = avatarColor(client.id);
  const brand    = vehicle?.brand ?? "";
  const initials = brand.slice(0, 2).toUpperCase() || (vehicle?.plate ?? client.name).slice(0, 2).toUpperCase();

  const closeIssue=closureIssue(repair);
  const unresolvedFreon=!!closeIssue;
  async function handleClose(){
    if(closing||blocked||reopeningId||!review)return;
    setError("");setClosing(true);
    try{await mutateClientRepair(client.id,repair,current=>prepareRepairClose(current,review.repair,review.amount,new Date().toISOString(),user?.uid||""));}
    catch(e){setError(e instanceof Error?e.message:"Не удалось закрыть заявку. Введённая сумма сохранена.");}
    finally{setClosing(false);}
  }
  async function handleReopenTask(taskId:string){
    if(reopeningId||closing||blocked)return;
    const task=repair.tasks?.find(t=>t.id===taskId);if(!task)return;
    setError("");setReviewing(false);setReopeningId(taskId);
    try{await mutateRepairTask(client.id,repair,task,current=>{assertFieldsUnchanged(current,task,["status","doneBy"],"Задача ремонта");return {...current,status:"in_progress",doneBy:[]};});}
    catch(e){setError(e instanceof Error?e.message:"Не удалось вернуть задачу в работу.");}
    finally{setReopeningId(null);}
  }

  return (
    <>
    <div className="reports-ready-card" style={{
      background:   "var(--bg2)",
      borderRadius: 16,
      border:       "1px solid rgba(34,197,94,0.3)",
      borderLeft:   "4px solid var(--green)",
      padding:      "14px 16px",
      boxShadow:    "0 2px 12px rgba(34,197,94,0.1)",
      display:      "flex",
      gap:          14,
    }}>
      {/* Avatar */}
      {vehicle?.photo ? (
        <img
          src={vehicle.photo}
          alt=""
          onClick={onOpenClient && vehicle ? () => onOpenClient(client, vehicle.id) : undefined}
          title={onOpenClient && vehicle ? "Открыть карточку автомобиля" : undefined}
          style={{ width: 60, height: 60, borderRadius: 10, objectFit: "cover", flexShrink: 0, border: "1px solid var(--border)", cursor: onOpenClient && vehicle ? "pointer" : "default" }}
        />
      ) : (
        <div style={{
          width: 60, height: 60, borderRadius: 10, flexShrink: 0,
          background: av.bg, color: av.color,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 18, fontWeight: 800,
        }}>
          {initials}
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
          <div
            onClick={onOpenClient ? () => onOpenClient(client) : undefined}
            title={onOpenClient ? "Открыть карточку клиента" : undefined}
            style={{ display: "flex", alignItems: "center", gap: 8, cursor: onOpenClient ? "pointer" : "default" }}
          >
            {vehicle?.plate && (
              <span style={{
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 13, fontWeight: 700,
                color: "var(--accent2)",
                background: "rgba(59,130,246,0.12)",
                padding: "2px 8px", borderRadius: 6,
              }}>
                {vehicle.plate}
              </span>
            )}
            <span style={{
              fontSize: 13.5, fontWeight: 700, color: "var(--text)",
              textDecoration: onOpenClient ? "underline" : "none",
              textDecorationColor: "rgba(59,130,246,0.35)",
              textUnderlineOffset: 2,
            }}>
              {brand ? `${brand} · ` : ""}{client.name}
            </span>
          </div>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#16a34a", background: "rgba(34,197,94,0.12)", padding: "1px 8px", borderRadius: 10 }}>
            ✓ все задачи выполнены
          </span>
        </div>

        {repair.description && (
          <div style={{ fontSize: 12.5, color: "var(--text2)", marginBottom: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {repair.description}
          </div>
        )}

        {assigneeNames && (
          <div style={{ fontSize: 11.5, color: "var(--text3)", marginBottom: 2 }}>
            👨‍🔧 {assigneeNames}
          </div>
        )}
        {item.createdByName && item.createdByName !== "—" && (
          <CreatorLine name={item.createdByName} date={repair.createdAt} style={{ marginBottom: 8 }} />
        )}

        {/* Task list with reopen buttons */}
        {(repair.tasks ?? []).length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 10 }}>
            {(repair.tasks ?? []).map((t) => {
              const isDone     = taskStatus(t) === "done";
              const isFreon    = t.freonTask === true;
              const isLoading  = reopeningId === t.id;
              const names      = (t.assignees ?? [])
                .map((uid) => staff.find((s) => s.id === uid)?.name ?? "")
                .filter(Boolean).join(", ");
              const taskPhotos = (t.photos ?? []).filter((p) => p.url ?? p.data);
              return (
                <div className="reports-task-row" key={t.id} style={{
                  display:    "flex",
                  alignItems: "center",
                  gap:        8,
                  background: isDone ? "rgba(34,197,94,0.05)" : "var(--bg3)",
                  borderRadius: 8,
                  padding:    "6px 10px",
                  border:     `1px solid ${isDone ? "rgba(34,197,94,0.2)" : "var(--border)"}`,
                }}>
                  <span style={{ fontSize: 13, color: isDone ? "#16a34a" : "var(--text3)", flexShrink: 0 }}>
                    {isFreon ? "❄️" : isDone ? "✓" : "○"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 12.5,
                      color: isDone ? "var(--text2)" : "var(--text)",
                      textDecoration: isDone && !isFreon ? "line-through" : "none",
                    }}>
                      {t.description}
                      {isFreon && t.freonType && (
                        <span style={{ color: "#0e7490" }}> {t.freonType}{t.freonKg ? ` · ${t.freonKg} кг` : ""}</span>
                      )}
                    </div>
                    {names && (
                      <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 1 }}>👤 {names}</div>
                    )}
                    <CreatorLine name={t.createdByName} date={t.createdAt} style={{ marginTop: 1 }} />
                    {taskPhotos.length > 0 && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 5 }}>
                        {taskPhotos.map((p, idx) => {
                          const src = (p.url ?? p.data)!;
                          return (
                            <img
                              key={p.id}
                              src={src}
                              alt=""
                              onClick={(e) => { e.stopPropagation(); setGallery({ photos: taskPhotos, index: idx }); }}
                              style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover", cursor: "pointer", border: "1px solid var(--border)" }}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {isDone && (
                    <button
                      type="button"
                      onClick={() => void handleReopenTask(t.id)}
                      aria-label={`Вернуть работу ${t.description} в работу`} disabled={!!reopeningId||closing||blocked}
                      title="Вернуть задачу в работу"
                      style={{
                        padding: "3px 9px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                        background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)",
                        color: "#b45309",
                        cursor: reopeningId ? "not-allowed" : "pointer",
                        opacity: reopeningId && !isLoading ? 0.4 : 1,
                        flexShrink: 0,
                        transition: "opacity 0.15s",
                      }}
                    >
                      {isLoading ? "..." : "↩"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Freon warning */}
        {unresolvedFreon && (
          <div style={{
            marginBottom: 8, padding: "6px 10px", borderRadius: 8,
            background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)",
            fontSize: 12, color: "#b45309", fontWeight: 600,
          }}>
            ⚠ {closeIssue}
          </div>
        )}

        <label className="reports-close-form-label" htmlFor={`close-${client.id}-${repair.id}`}>Итоговая стоимость, ₽</label>
        <div className="reports-close-form" style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <input id={`close-${client.id}-${repair.id}`} aria-label={`Стоимость заявки ${repair.id}`} inputMode="decimal" placeholder="Например, 12500" value={closeSum} onChange={e=>{setCloseSum(e.target.value);setReviewing(false);}} disabled={closing||blocked}/>
          {!reviewing&&<button type="button" className="btn btn-primary" disabled={closing||blocked||!!reopeningId||unresolvedFreon} onClick={()=>{if(parseClosureAmount(closeSum)===null){setError("Укажите корректную сумму: 0 или больше, не более двух знаков после запятой.");return;}setError("");setReview(createRepairReview(repair,closeSum));setReviewing(true);}}>Проверить и закрыть</button>}
        </div>
        {reviewing&&<ReportCloseReview name={`${client.name} · ${item.objectLabel}`} amount={closeSum} busy={closing} blocked={blocked||!!reopeningId||unresolvedFreon} onCancel={()=>setReviewing(false)} onConfirm={()=>void handleClose()}/>}
        {error&&<p className="reports-inline-error" role="alert">{error}</p>}

      </div>
    </div>
    {gallery && (
      <PhotoLightbox
        photos={gallery.photos}
        index={gallery.index}
        onIndexChange={(i) => setGallery((g) => (g ? { ...g, index: i } : g))}
        onClose={() => setGallery(null)}
      />
    )}
    </>
  );
}

// ─── Repair detail modal ─────────────────────────────────────────────────────

function RepairDetailModal({ item, isAdmin, showAmounts, onOpenClient, onClose }: {
  item:         DoneItem;
  isAdmin:      boolean;
  showAmounts:  boolean;
  onOpenClient?: (client: Client, vehicleId?: string) => void;
  onClose:      () => void;
}) {
  const { staff }  = useData();
  const { repair, client, vehicle, assigneeNames } = item;
  const [gallery, setGallery] = useState<{ photos: PhotoData[]; index: number } | null>(null);

  const brand       = vehicle?.brand ?? vehicle?.model ?? "";
  const isCancelled = repairStatus(repair) === "cancelled";
  const costNum     = parseFloat(repair.cost ?? "0") || 0;

  function openPhoto(photos: PhotoData[], src: string) {
    const idx = photos.findIndex((p) => (p.url ?? p.data) === src);
    setGallery({ photos, index: idx < 0 ? 0 : idx });
  }

  return (
    <Modal className="reports-modal" title="Детали ремонта" onClose={onClose}>

      {/* Vehicle + client header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, padding: "12px 14px", background: "var(--bg3)", borderRadius: 12, border: "1px solid var(--border)" }}>
        {vehicle?.photo ? (
          <img
            src={vehicle.photo}
            alt=""
            onClick={onOpenClient && vehicle ? () => { onOpenClient(client, vehicle.id); onClose(); } : undefined}
            title={onOpenClient && vehicle ? "Открыть карточку автомобиля" : undefined}
            style={{ width: 52, height: 52, borderRadius: 8, objectFit: "cover", flexShrink: 0, border: "1px solid var(--border)", cursor: onOpenClient && vehicle ? "pointer" : "default" }}
          />
        ) : (
          <div style={{ width: 52, height: 52, borderRadius: 8, flexShrink: 0, background: "rgba(59,130,246,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>
            🚗
          </div>
        )}
        <div
          style={{ flex: 1, minWidth: 0, cursor: onOpenClient ? "pointer" : "default" }}
          onClick={onOpenClient ? () => { onOpenClient(client); onClose(); } : undefined}
          title={onOpenClient ? "Открыть карточку клиента" : undefined}
        >
          {vehicle?.plate && (
            <div style={{ marginBottom: 3 }}>
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, fontWeight: 700, color: "#3b82f6", background: "rgba(59,130,246,0.12)", padding: "2px 8px", borderRadius: 6 }}>
                {vehicle.plate}
              </span>
            </div>
          )}
          {brand && <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 2 }}>{brand}</div>}
          <div style={{
            fontSize: 13, fontWeight: 600, color: "var(--text)",
            textDecoration: onOpenClient ? "underline" : "none",
            textDecorationColor: "rgba(59,130,246,0.35)",
            textUnderlineOffset: 2,
          }}>
            {client.name}
          </div>
        </div>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 10, flexShrink: 0,
          background: isCancelled ? "var(--bg2)" : "rgba(34,197,94,0.15)",
          color: isCancelled ? "var(--text3)" : "#16a34a",
          border: `1px solid ${isCancelled ? "var(--border)" : "rgba(34,197,94,0.3)"}`,
        }}>
          {isCancelled ? "Отказ" : requestStage(repair)==="closed" ? "Закрыто" : "Выполнено"}
        </span>
      </div>

      {/* Meta rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14, padding: "12px 14px", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 12 }}>
        {repair.date && (
          <div style={{ display: "flex", gap: 10, fontSize: 12.5 }}>
            <span style={{ color: "var(--text3)", minWidth: 88 }}>📅 Начало</span>
            <span style={{ color: "var(--text)", fontWeight: 600 }}>{fmtDate(repair.date)}</span>
          </div>
        )}
        {repair.closedAt && (
          <div style={{ display: "flex", gap: 10, fontSize: 12.5 }}>
            <span style={{ color: "var(--text3)", minWidth: 88 }}>✓ Закрыто</span>
            <span style={{ color: "#16a34a", fontWeight: 600 }}>{fmtDate(repair.closedAt.slice(0, 10))}</span>
          </div>
        )}
        {assigneeNames && (
          <div style={{ display: "flex", gap: 10, fontSize: 12.5 }}>
            <span style={{ color: "var(--text3)", minWidth: 88 }}>👨‍🔧 Механик</span>
            <span style={{ color: "var(--text)" }}>{assigneeNames}</span>
          </div>
        )}
        {item.createdByName && (
          <div style={{ display: "flex", gap: 10, fontSize: 12.5 }}>
            <span style={{ color: "var(--text3)", minWidth: 88 }}>🖊 Создал</span>
            <span style={{ color: "var(--text)", opacity: 0.8 }}>
              {item.createdByName}{repair.createdAt ? ` · ${fmtDayMonth(repair.createdAt)}` : ""}
            </span>
          </div>
        )}
        {repair.freonType && (
          <div style={{ display: "flex", gap: 10, fontSize: 12.5 }}>
            <span style={{ color: "var(--text3)", minWidth: 88 }}>❄️ Фреон</span>
            <span style={{ color: "#0e7490" }}>{repair.freonType}{repair.freonAmount ? ` · ${repair.freonAmount} кг` : ""}</span>
          </div>
        )}
        {isAdmin && showAmounts && costNum > 0 && (
          <div style={{ display: "flex", gap: 10, fontSize: 12.5 }}>
            <span style={{ color: "var(--text3)", minWidth: 88 }}>💰 Итого</span>
            <span style={{ color: "#16a34a", fontWeight: 700, fontFamily: "JetBrains Mono, monospace", fontSize: 14 }}>
              {fmtMoney(costNum)}
            </span>
          </div>
        )}
      </div>

      {/* Description */}
      {repair.description && (
        <div style={{ marginBottom: 14, padding: "10px 14px", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase" as const, letterSpacing: "0.5px", marginBottom: 5 }}>Описание</div>
          <div style={{ fontSize: 13, color: "var(--text)" }}>{repair.description}</div>
        </div>
      )}

      {/* Tasks — each with its own photos */}
      {(repair.tasks ?? []).length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase" as const, letterSpacing: "0.5px", marginBottom: 8 }}>
            Задачи · {(repair.tasks ?? []).length}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(repair.tasks ?? []).map((t) => {
              const isDone     = t.status === "done";
              const isFreon    = t.freonTask === true;
              const taskNames  = (t.assignees ?? [])
                .map((uid) => staff.find((s) => s.id === uid)?.name ?? "")
                .filter(Boolean).join(", ");
              const taskPhotos = (t.photos ?? []).filter((p) => p.url ?? p.data);
              return (
                <div key={t.id} style={{
                  background: "var(--bg3)",
                  border: `1px solid ${isFreon ? "rgba(6,182,212,0.2)" : "var(--border)"}`,
                  borderRadius: 10,
                  padding: "10px 12px",
                }}>
                  {/* Task header row */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <span style={{ flexShrink: 0, marginTop: 1, fontSize: isFreon ? 15 : 13 }}>
                      {isFreon ? "❄️" : isDone ? "✓" : "●"}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, fontWeight: 600,
                        color: isDone ? "var(--text2)" : "var(--text)",
                        textDecoration: isDone && !isFreon ? "line-through" : "none",
                      }}>
                        {t.description}
                        {isFreon && t.freonType && (
                          <span style={{ color: "#0e7490", fontWeight: 400 }}> {t.freonType}</span>
                        )}
                        {isFreon && t.freonKg && (
                          <span style={{ color: "#0e7490", fontWeight: 700 }}> · {t.freonKg} кг</span>
                        )}
                      </div>
                      {taskNames && (
                        <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 3 }}>👤 {taskNames}</div>
                      )}
                      <CreatorLine name={t.createdByName} date={t.createdAt} style={{ marginTop: 3 }} />
                      {t.workComment && (
                        <div style={{ fontSize: 11, color: "var(--text2)", background: "rgba(139,92,246,0.08)", borderRadius: 5, padding: "3px 8px", marginTop: 5, border: "1px solid rgba(139,92,246,0.15)" }}>
                          <span style={{ color: "#6d28d9", fontWeight: 600 }}>📝 </span>{t.workComment}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Per-task photos */}
                  {taskPhotos.length > 0 && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                      {/* Mobile: compact thumbnails — не трогаем */}
                      <div className="flex flex-wrap gap-1.5 md:hidden">
                        {taskPhotos.map((p) => {
                          const src = (p.url ?? p.data)!;
                          return (
                            <img
                              key={p.id}
                              src={src}
                              alt=""
                              onClick={() => openPhoto(taskPhotos, src)}
                              style={{ width: 72, height: 72, borderRadius: 7, objectFit: "cover", cursor: "pointer", border: "1px solid var(--border)" }}
                            />
                          );
                        })}
                      </div>
                      {/* Desktop: PhotoGrid — как в Заявках */}
                      <div className="hidden md:block">
                        <PhotoGrid photos={taskPhotos} readOnly onView={(src) => openPhoto(taskPhotos, src)} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Repair-level photos (attached to the order itself, not to tasks) */}
      {(repair.photos ?? []).some((p) => p.url ?? p.data) && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase" as const, letterSpacing: "0.5px", marginBottom: 8 }}>
            Фото наряда
          </div>
          {/* Mobile: compact thumbnails — не трогаем */}
          <div className="flex flex-wrap gap-2 md:hidden">
            {(repair.photos ?? []).map((p) => {
              const src = p.url ?? p.data;
              if (!src) return null;
              return (
                <img
                  key={p.id}
                  src={src}
                  alt=""
                  onClick={() => openPhoto(repair.photos ?? [], src)}
                  style={{ width: 80, height: 80, borderRadius: 8, objectFit: "cover", cursor: "pointer", border: "1px solid var(--border)" }}
                />
              );
            })}
          </div>
          {/* Desktop: PhotoGrid — как в Заявках */}
          <div className="hidden md:block">
            <PhotoGrid
              photos={(repair.photos ?? []).filter((p) => p.url ?? p.data)}
              readOnly
              onView={(src) => openPhoto(repair.photos ?? [], src)}
            />
          </div>
        </div>
      )}

      {/* Featured cost block */}
      {isAdmin && showAmounts && costNum > 0 && (
        <div style={{
          padding: "14px 16px",
          background: "rgba(34,197,94,0.08)",
          border: "1px solid rgba(34,197,94,0.25)",
          borderRadius: 12,
          textAlign: "center",
          marginBottom: 14,
        }}>
          <div style={{ fontSize: 11, color: "#16a34a", fontWeight: 700, marginBottom: 4, textTransform: "uppercase" as const, letterSpacing: "0.5px" }}>
            Итоговая сумма
          </div>
          <div style={{ fontSize: 30, fontWeight: 900, color: "#16a34a", fontFamily: "JetBrains Mono, monospace" }}>
            {fmtMoney(costNum)}
          </div>
        </div>
      )}

      {gallery && (
        <PhotoLightbox
          photos={gallery.photos}
          index={gallery.index}
          onIndexChange={(i) => setGallery((g) => (g ? { ...g, index: i } : g))}
          onClose={() => setGallery(null)}
        />
      )}
    </Modal>
  );
}

// ─── Tasks preview (inline in card) ──────────────────────────────────────────

function TasksPreview({ tasks }: { tasks: RepairTask[] }) {
  const [expanded, setExpanded] = useState(false);
  if (tasks.length === 0) return null;
  const MAX      = 3;
  const showing  = expanded ? tasks : tasks.slice(0, MAX);
  const remaining = tasks.length - MAX;

  return (
    <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--border)" }}>
      {showing.map((t) => {
        const done    = t.status === "done";
        const isFreon = t.freonTask === true;
        return (
          <div key={t.id} style={{ display: "flex", alignItems: "flex-start", gap: 5, marginBottom: 2 }}>
            <span style={{ fontSize: 11, color: done ? "#16a34a" : "var(--text3)", flexShrink: 0, marginTop: 1 }}>
              {isFreon ? "❄️" : done ? "✓" : "○"}
            </span>
            <span style={{
              fontSize: 11.5,
              color: done ? "var(--text2)" : "var(--text3)",
              textDecoration: done && !isFreon ? "line-through" : "none",
              flex: 1, minWidth: 0,
            }}>
              {t.description}
              {isFreon && t.freonType && (
                <span style={{ color: "#0e7490" }}> · {t.freonType}{t.freonKg ? ` ${t.freonKg} кг` : ""}</span>
              )}
            </span>
          </div>
        );
      })}
      {!expanded && remaining > 0 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
          style={{
            fontSize: 11, color: "var(--accent2)", background: "none",
            border: "none", cursor: "pointer", padding: "2px 0", marginTop: 2,
          }}
        >
          и ещё {remaining}...
        </button>
      )}
      {expanded && tasks.length > MAX && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
          style={{
            fontSize: 11, color: "var(--text3)", background: "none",
            border: "none", cursor: "pointer", padding: "2px 0", marginTop: 2,
          }}
        >
          ▲ Скрыть
        </button>
      )}
    </div>
  );
}

// ─── Repair card (closed history) ────────────────────────────────────────────

function RepairCard({ item, isAdmin, showAmounts, isOwner, ownerUid, canReturn, onOpenClient }: {
  item:          DoneItem;
  isAdmin:       boolean;
  showAmounts:   boolean;
  isOwner:       boolean;
  ownerUid:      string;
  canReturn:     boolean;
  onOpenClient?: (client: Client, vehicleId?: string) => void;
}) {
  const { repair, client, vehicle, assigneeNames } = item;
  const [showDetail, setShowDetail] = useState(false);
  const [showEdit,   setShowEdit]   = useState(false);
  const [returning,  setReturning]  = useState(false);
  const blocked=useReportWriteBlocked();
  const [error,setError]=useState("");
  const isCancelled = repairStatus(repair) === "cancelled";

  async function handleReturn(e: React.MouseEvent) {
    e.stopPropagation();
    if(returning||blocked)return;
    setError("");
    const label = vehicle?.plate ?? client.name;
    if (!window.confirm(`Снять закрытие заявки «${label}»? Работы сохранятся. Выполненная заявка вернётся на проверку менеджеру.`)) return;
    setReturning(true);
    try { await mutateClientRepair(client.id, repair, (current) => {
      assertFieldsUnchanged(current, repair, ["status", "closedByManager", "closedAt"], "Ремонт");
      return {
        ...current,
        status:          "in_progress" as const,
        closedByManager: false,
        closedAt:        undefined,
      };
    }); } catch(e){setError(e instanceof Error?e.message:"Не удалось снять закрытие заявки.");} finally {setReturning(false);}
  }

  function openDetail() {
    setShowDetail(true);
  }
  const costNum     = parseFloat(repair.cost ?? "0") || 0;

  const av       = avatarColor(client.id);
  const brand    = vehicle?.brand ?? "";
  const initials = brand.slice(0, 2).toUpperCase() || (vehicle?.plate ?? client.name).slice(0, 2).toUpperCase();

  return (
    <>
      <div className="reports-history-card"
        onClick={openDetail}
        style={{
          background:   "var(--bg2)",
          borderRadius: 16,
          border:       "1px solid var(--border)",
          borderLeft:   `4px solid ${isCancelled ? "var(--text3)" : repair.closedByManager ? "var(--green)" : "var(--accent)"}`,
          padding:      "14px 16px",
          boxShadow:    "0 2px 8px rgba(0,0,0,0.07)",
          display:      "flex",
          gap:          14,
          alignItems:   "center",
          cursor:       "pointer",
        }}
      >
        {/* Avatar */}
        {vehicle?.photo ? (
          <img
            src={vehicle.photo}
            alt=""
            onClick={onOpenClient && vehicle ? (e) => { e.stopPropagation(); onOpenClient(client, vehicle.id); } : undefined}
            title={onOpenClient && vehicle ? "Открыть карточку автомобиля" : undefined}
            style={{ width: 60, height: 60, borderRadius: 10, objectFit: "cover", flexShrink: 0, border: "1px solid var(--border)", cursor: onOpenClient && vehicle ? "pointer" : "default" }}
          />
        ) : (
          <div style={{
            width: 60, height: 60, borderRadius: 10, flexShrink: 0,
            background: av.bg, color: av.color,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, fontWeight: 800,
          }}>
            {initials}
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 4 }}>
            <div
              onClick={onOpenClient ? (e) => { e.stopPropagation(); onOpenClient(client); } : undefined}
              title={onOpenClient ? "Открыть карточку клиента" : undefined}
              style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0, cursor: onOpenClient ? "pointer" : "default" }}
            >
              {vehicle?.plate && (
                <span style={{
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: 13, fontWeight: 700,
                  color: "var(--accent2)",
                  background: "rgba(59,130,246,0.12)",
                  padding: "2px 8px", borderRadius: 6,
                  flexShrink: 0,
                }}>
                  {vehicle.plate}
                </span>
              )}
              <span style={{
                fontSize: 13.5, fontWeight: 700, color: "var(--text)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                textDecoration: onOpenClient ? "underline" : "none",
                textDecorationColor: "rgba(59,130,246,0.35)",
                textUnderlineOffset: 2,
              }}>
                {brand ? `${brand} · ` : ""}{client.name}
              </span>
            </div>
          </div>

          {repair.description && (
            <div style={{ fontSize: 12.5, color: "var(--text2)", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {repair.description}
            </div>
          )}

          {(() => {
            // Show freon from repair-level or aggregate from tasks
            const repairFreon = repair.freonType
              ? `❄️ ${repair.freonType}${repair.freonAmount ? ` · ${repair.freonAmount} кг` : ""}`
              : null;
            const taskFreonMap: Record<string, number> = {};
            (repair.tasks ?? []).forEach((t) => {
              if (t.freonTask && t.freonType) {
                taskFreonMap[t.freonType] = (taskFreonMap[t.freonType] ?? 0) + (parseFloat(t.freonKg ?? "0") || 0);
              }
            });
            const taskFreonStr = Object.entries(taskFreonMap)
              .map(([type, kg]) => `❄️ ${type}${kg > 0 ? ` · ${kg.toFixed(1)} кг` : ""}`)
              .join("  ");
            const freonLine = repairFreon ?? (taskFreonStr || null);
            if (!freonLine) return null;
            return (
              <div style={{ fontSize: 11.5, color: "var(--cyan)", marginBottom: 4 }}>
                {freonLine}
              </div>
            );
          })()}

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {assigneeNames && (
              <span style={{ fontSize: 11.5, color: "var(--text3)" }}>👨‍🔧 {assigneeNames}</span>
            )}
            {item.createdByName && item.createdByName !== "—" && (
              <span style={{ fontSize: 11, color: "var(--text3)", opacity: 0.7 }}>
                🖊 {item.createdByName}{repair.createdAt ? ` · ${fmtDayMonth(repair.createdAt)}` : ""}
              </span>
            )}
            <span style={{ fontSize: 11.5, color: "var(--text3)" }}>{fmtDate(repair.date)}</span>
          </div>

          <TasksPreview tasks={repair.tasks ?? []} />
        </div>

        {/* Right: cost + badge + owner edit */}
        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          {isAdmin && showAmounts && costNum > 0 && (
            <span style={{ fontSize: 15, fontWeight: 800, color: "#16a34a", fontFamily: "JetBrains Mono, monospace" }}>
              {fmtMoney(costNum)}
            </span>
          )}
          <Badge variant={isCancelled ? "gray" : "green"}>
            {isCancelled ? "Отказ" : requestStage(repair)==="closed" ? "Закрыто" : "Готово"}
          </Badge>
          <button type="button" className="reports-detail-button" onClick={e=>{e.stopPropagation();openDetail();}}>Детали заявки</button>
          {canReturn && (
            <button
              type="button"
              onClick={(e) => void handleReturn(e)}
              disabled={returning||blocked}
              style={{
                padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                background: returning ? "rgba(245,158,11,0.08)" : "rgba(245,158,11,0.12)",
                border: "1px solid rgba(245,158,11,0.3)",
                color: "#b45309", cursor: returning ? "not-allowed" : "pointer",
                opacity: returning ? 0.6 : 1,
              }}
            >
              {returning ? "..." : "Снять закрытие"}
            </button>
          )}
          {isOwner && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowEdit(true); }}
              style={{
                padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.3)",
                color: "#7c3aed", cursor: "pointer",
              }}
            >
              ✏️ Ред.
            </button>
          )}
        </div>
      </div>
      {error&&<p className="reports-inline-error" role="alert">{error}</p>}
      {showDetail && <RepairDetailModal item={item} isAdmin={isAdmin} showAmounts={showAmounts} onOpenClient={onOpenClient} onClose={() => setShowDetail(false)} />}
      {showEdit   && <OwnerEditRepairModal item={item} uid={ownerUid} onClose={() => setShowEdit(false)} />}
    </>
  );
}

// ─── Month block (collapsible) ────────────────────────────────────────────────

function MonthBlock({ mk, items, tasks, isAdmin, showAmounts, isOwner, ownerUid, canReturn, onOpenClient }: {
  mk:            string;
  items:         DoneItem[];
  tasks:         ServiceTask[];
  isAdmin:       boolean;
  showAmounts:   boolean;
  isOwner:       boolean;
  ownerUid:      string;
  canReturn:     boolean;
  onOpenClient?: (client: Client, vehicleId?: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const totalCost = isAdmin && showAmounts
    ? items.reduce((s, i) => s + (parseFloat(i.repair.cost ?? "0") || 0), 0)
    : 0;

  return (
    <div style={{ marginBottom: 8 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="reports-month-button" aria-expanded={open}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10,
          background: "var(--bg3)", borderRadius: 14,
          padding: "12px 16px",
          border: "1px solid var(--border)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ fontSize: 11, color: "var(--text3)", transition: "transform 0.2s", transform: open ? "rotate(90deg)" : "none" }}>▶</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", flex: 1 }}>{monthLabel(mk)}</span>
        <span style={{ fontSize: 12, color: "var(--text3)" }}>
          {items.length > 0 && `${items.length} рем.`}
          {tasks.length > 0 && ` · ${tasks.length} задач`}
        </span>
        {totalCost > 0 && (
          <span style={{ fontSize: 13, fontWeight: 700, color: "#16a34a", fontFamily: "JetBrains Mono, monospace" }}>
            {fmtMoney(totalCost)}
          </span>
        )}
      </button>

      {open && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 12 }}>
          {items.map((i) => (
            <RepairCard key={`${i.client.id}/${i.repair.id}`} item={i} isAdmin={isAdmin} showAmounts={showAmounts} isOwner={isOwner} ownerUid={ownerUid} canReturn={canReturn} onOpenClient={onOpenClient} />
          ))}
          {tasks.map((t) => (
            <div
              key={t.id}
              style={{
                background: "var(--bg2)", borderRadius: 16,
                border: "1px solid var(--border)",
                borderLeft: `4px solid ${t.taskType === "project" ? "var(--yellow)" : "var(--accent)"}`,
                padding: "12px 16px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {t.taskType === "project" && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#854F0B", background: "#FAEEDA", padding: "1px 7px", borderRadius: 10 }}>Проект</span>
                )}
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)", flex: 1 }}>{t.title ?? t.description ?? "—"}</span>
                <Badge variant="green">✓</Badge>
              </div>
              {t.title && t.description && (
                <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 3 }}>{t.description}</div>
              )}
              {t.workComment && (
                <div style={{ marginTop: 6, fontSize: 12, color: "var(--text)", background: "var(--bg3)", borderRadius: 8, padding: "6px 10px", border: "1px solid var(--border)" }}>
                  <span style={{ color: "#7c3aed", fontWeight: 600 }}>Отчёт: </span>{t.workComment}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Freon fix modal ──────────────────────────────────────────────────────────

interface UnknownFreonItem { client: Client; repair: Repair; vehicle?: Vehicle }

function FreonFixModal({ items, onClose }: { items: UnknownFreonItem[]; onClose: () => void }) {
  const blocked=useReportWriteBlocked();
  const [error,setError]=useState("");
  const [saving, setSaving] = useState<string | null>(null);

  async function applyType(item: UnknownFreonItem, freonType: string) {
    if(saving||blocked)return;
    setError("");setSaving(item.repair.id);
    try {
    await mutateClientRepair(item.client.id, item.repair, (current) => {
      assertFieldsUnchanged(current, item.repair, ["freonType", "tasks"], "Ремонт");
      return {
        ...current,
        freonType,
        tasks: (current.tasks ?? []).map((task) => task.freonTask ? { ...task, freonType } : task),
      };
    });
    } catch(e){setError(e instanceof Error?e.message:"Не удалось сохранить тип фреона.");} finally{setSaving(null);}
  }

  return (
    <Modal className="reports-modal" title={`Уточнить тип фреона · ${items.length}`} onClose={onClose}>
      {error&&<p className="reports-inline-error" role="alert">{error}</p>}
      {items.length === 0 ? (
        <div style={{ padding: "24px 0", textAlign: "center", color: "#16a34a", fontWeight: 600 }}>
          ✓ Все записи исправлены
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {items.map((item) => {
            const brand = item.vehicle?.brand ?? item.vehicle?.model ?? "";
            const isSaving = saving === item.repair.id;
            return (
              <div key={item.repair.id} style={{
                background: "var(--bg3)", borderRadius: 10,
                border: "1px solid var(--border)", padding: "10px 12px",
              }}>
                {/* Info row */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  {item.vehicle?.plate && (
                    <span style={{
                      fontFamily: "JetBrains Mono, monospace", fontSize: 12, fontWeight: 700,
                      color: "#3b82f6", background: "rgba(59,130,246,0.12)",
                      border: "1px solid rgba(59,130,246,0.25)", padding: "1px 7px", borderRadius: 5,
                    }}>
                      {item.vehicle.plate}
                    </span>
                  )}
                  {brand && <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{brand}</span>}
                  <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: "auto" }}>
                    {item.client.name}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#0e7490", marginBottom: 8 }}>
                  ❄️ {item.repair.freonAmount} кг · {item.repair.date ? item.repair.date.slice(0, 10) : "—"}
                </div>
                {/* Badge picker */}
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {FREON_TYPES.map((fr) => (
                    <button
                      key={fr}
                      type="button"
                      disabled={isSaving}
                      onClick={() => void applyType(item, fr)}
                      style={{
                        padding: "3px 10px", borderRadius: 6,
                        fontSize: 11, fontWeight: 700, cursor: isSaving ? "not-allowed" : "pointer",
                        border: "1px solid rgba(6,182,212,0.4)",
                        background: "rgba(6,182,212,0.1)", color: "#0891b2",
                        opacity: isSaving ? 0.5 : 1,
                      }}
                    >
                      {fr}
                    </button>
                  ))}
                  {isSaving && <span style={{ fontSize: 11, color: "var(--text3)", alignSelf: "center" }}>сохраняем...</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

// ─── Owner edit repair modal ──────────────────────────────────────────────────

function OwnerEditRepairModal({ item, uid, onClose }: {
  item:    DoneItem;
  uid:     string;
  onClose: () => void;
}) {
  const { repair, client } = item;
  const { myProfile } = useAuth();
  const blocked=useReportWriteBlocked();
  const [error,setError]=useState("");

  const [freonType,   setFreonType]   = useState(repair.freonType ?? "");
  const [freonAmount, setFreonAmount] = useState(repair.freonAmount ?? "");
  const [cost,        setCost]        = useState(repair.cost ?? "");
  const [status,      setStatus]      = useState<"in_progress" | "done" | "cancelled">(repair.status ?? "done");
  const [date,        setDate]        = useState(repair.date ?? "");
  const [tasks,       setTasks]       = useState<RepairTask[]>([...(repair.tasks ?? [])]);
  const [saving,      setSaving]      = useState(false);

  async function handleSave() {
    if(saving||blocked)return;
    setError("");setSaving(true);
    const editedAt = new Date().toISOString();
    try {
      await mutateClientRepair(client.id, repair, (current) => {
        assertFieldsUnchanged(
          current,
          repair,
          ["freonType", "freonAmount", "cost", "status", "date"],
          "Ремонт",
        );
        if (canonicalEntityJson(current.tasks ?? []) !== canonicalEntityJson(repair.tasks ?? [])) {
          throw new ConcurrentMutationError("Задачи ремонта уже изменены другим сотрудником");
        }
        return {
          ...current,
          freonType:   freonType   || undefined,
          freonAmount: freonAmount || undefined,
          cost,
          status,
          date,
          tasks,
          editedBy: uid,
          editedAt,
        };
      });
      onClose();
    } catch (error) {
      setError(error instanceof Error?error.message:"Не удалось сохранить изменения. Данные остались в форме.");
    } finally {
      setSaving(false);
    }
  }

  function updateTask(id: string, patch: Partial<RepairTask>) {
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, ...patch } : t));
  }

  function removeTask(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  function addTask() {
    const newTask: RepairTask = {
      id:          crypto.randomUUID(),
      description: "",
      assignees:   [],
      doneBy:      [],
      status:      "in_progress",
      createdBy:     uid,
      createdByName: myProfile?.name ?? "Неизвестно",
      createdAt:     new Date().toISOString(),
    };
    setTasks((prev) => [...prev, newTask]);
  }

  const inputStyle = {
    width: "100%", padding: "8px 12px", borderRadius: 8, fontSize: 13,
    background: "var(--bg3)", border: "1px solid var(--border2)",
    color: "var(--text)", outline: "none",
  };

  return (
    <Modal className="reports-modal" title="✏️ Редактировать ремонт" onClose={onClose}>

      {/* Freon */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <FormGroup label="Тип фреона">
          <Select value={freonType} onChange={(e) => setFreonType(e.target.value)}>
            <option value="">— не указан —</option>
            {FREON_TYPES.map((f) => <option key={f} value={f}>{f}</option>)}
          </Select>
        </FormGroup>
        <FormGroup label="Кол-во фреона (кг)">
          <input
            type="number"
            step={0.1}
            min={0}
            value={freonAmount}
            onChange={(e) => setFreonAmount(e.target.value)}
            placeholder="0.0"
            style={inputStyle}
          />
        </FormGroup>
      </div>

      {/* Cost + status */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <FormGroup label="Сумма ₽">
          <input
            type="number"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="0"
            style={inputStyle}
          />
        </FormGroup>
        <FormGroup label="Статус">
          <Select value={status} onChange={(e) => setStatus(e.target.value as "in_progress" | "done" | "cancelled")}>
            <option value="in_progress">В работе</option>
            <option value="done">Выполнено</option>
            <option value="cancelled">Отказ</option>
          </Select>
        </FormGroup>
      </div>

      {/* Date */}
      <FormGroup label="Дата начала">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={inputStyle}
        />
      </FormGroup>

      {/* Tasks */}
      <div style={{ marginTop: 4, marginBottom: 14 }}>
        <div style={{
          fontSize: 11, fontWeight: 700, color: "var(--text3)",
          textTransform: "uppercase" as const, letterSpacing: "0.5px",
          marginBottom: 8,
        }}>
          Задачи · {tasks.length}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {tasks.map((t) => (
            <div key={t.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="text"
                value={t.description}
                onChange={(e) => updateTask(t.id, { description: e.target.value })}
                placeholder="Описание задачи"
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                type="button"
                onClick={() => removeTask(t.id)}
                style={{
                  width: 30, height: 30, borderRadius: 8, border: "1px solid rgba(239,68,68,0.3)",
                  background: "rgba(239,68,68,0.08)", color: "#dc2626",
                  cursor: "pointer", fontSize: 16, flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addTask}
          style={{
            marginTop: 8, padding: "6px 14px", borderRadius: 8,
            fontSize: 12, fontWeight: 600,
            background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.25)",
            color: "var(--accent2)", cursor: "pointer",
          }}
        >
          + Добавить задачу
        </button>
      </div>

      {error&&<p className="reports-inline-error" role="alert">{error}</p>}
      <Button size="lg" onClick={() => void handleSave()} disabled={saving||blocked}>
        {saving ? "Сохранение..." : "Сохранить изменения"}
      </Button>
    </Modal>
  );
}

// ─── Freon report section ─────────────────────────────────────────────────────

function FreonSection({ clients,canManage }: { clients: Client[];canManage:boolean }) {
  const [open, setOpen] = useState(false);
  const [showFix, setShowFix] = useState(false);

  const stats = useMemo(() => {
    const byType:  Record<string, number>                 = {};
    const byMonth: Record<string, Record<string, number>> = {};
    const unknownItems: UnknownFreonItem[]                = [];
    let total      = 0;
    let unknownKg  = 0;

    clients.forEach((c) => {
      (c.repairs ?? []).forEach((r) => {
        const kg  = parseFloat(r.freonAmount ?? "0") || 0;
        const typ = (r.freonType ?? "").trim();
        if (kg <= 0) return;
        if (!typ) {
          unknownKg += kg;
          const vehicle = (c.vehicles ?? []).find((v) => v.id === r.vehicleId);
          unknownItems.push({ client: c, repair: r, vehicle });
          return;
        }
        const mk = r.date?.slice(0, 7) ?? "0000-00";
        byType[typ]  = (byType[typ]  ?? 0) + kg;
        if (!byMonth[mk]) byMonth[mk] = {};
        byMonth[mk][typ] = (byMonth[mk][typ] ?? 0) + kg;
        total += kg;
      });
    });

    const typeEntries = Object.entries(byType).sort((a, b) => b[1] - a[1]);
    const monthKeys   = Object.keys(byMonth).filter((mk) => mk !== "0000-00").sort((a, b) => b.localeCompare(a));
    const allTypes    = typeEntries.map(([t]) => t);
    const maxKg       = Math.max(typeEntries[0]?.[1] ?? 0, unknownKg, 1);
    return { total, byType, byMonth, typeEntries, monthKeys, allTypes, maxKg, unknownKg, unknownItems };
  }, [clients]);

  if (stats.total === 0 && stats.unknownKg === 0) return null;

  return (
    <div className="crm-section" style={{ animation: "fadeUp 0.5s ease 0.25s both" }}>
      <div className="section-header" style={{ background: "rgba(6,182,212,0.06)" }}>
        <i className="ti ti-snowflake" style={{ fontSize: 17, color: "#0891b2" }} />
        <span className="section-title">Расход фреона</span>
        <div className="section-actions">
          <span style={{ fontSize: 13, fontWeight: 700, color: "#0891b2", fontFamily: "JetBrains Mono, monospace" }}>
            {stats.total.toFixed(1)} кг
          </span>
        </div>
      </div>

      {/* Bar chart by type */}
      <div style={{ padding: "12px 16px 4px" }}>
        {stats.typeEntries.map(([typ, kg]) => (
          <div key={typ} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#0e7490" }}>❄️ {typ}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#0891b2", fontFamily: "JetBrains Mono, monospace" }}>
                {kg.toFixed(1)} кг
              </span>
            </div>
            <div style={{ height: 7, background: "rgba(6,182,212,0.15)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${(kg / stats.maxKg) * 100}%`,
                background: "linear-gradient(90deg,#06b6d4,#67e8f9)",
                borderRadius: 4,
                transition: "width 0.4s ease",
              }} />
            </div>
          </div>
        ))}

        {/* Unknown freon row */}
        {stats.unknownKg > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text3)" }}>
                  ❄️ Не определён
                </span>
                <button
                  type="button"
                  disabled={!canManage} onClick={() => setShowFix(true)}
                  style={{
                    fontSize: 10, fontWeight: 700, padding: "1px 8px", borderRadius: 5,
                    background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)",
                    color: "#b45309", cursor: "pointer",
                  }}
                >
                  Исправить {stats.unknownItems.length}
                </button>
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text3)", fontFamily: "JetBrains Mono, monospace" }}>
                {stats.unknownKg.toFixed(1)} кг
              </span>
            </div>
            <div style={{ height: 7, background: "rgba(6,182,212,0.15)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${(stats.unknownKg / stats.maxKg) * 100}%`,
                background: "rgba(107,114,128,0.5)",
                borderRadius: 4,
                transition: "width 0.4s ease",
              }} />
            </div>
          </div>
        )}
      </div>

      {/* Monthly table toggle */}
      {showFix && (
        <FreonFixModal items={stats.unknownItems} onClose={() => setShowFix(false)} />
      )}

      {stats.monthKeys.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 6,
              padding: "9px 16px", borderTop: "1px solid var(--border)",
              background: "transparent", border: "none", cursor: "pointer",
              color: "var(--text3)", fontSize: 12, textAlign: "left",
            }}
          >
            <span style={{ fontSize: 10, display: "inline-block", transition: "transform 0.2s", transform: open ? "rotate(90deg)" : "none" }}>▶</span>
            Расход по месяцам
          </button>

          {open && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "rgba(6,182,212,0.08)" }}>
                    <th style={{ padding: "7px 16px", textAlign: "left", color: "var(--text3)", fontWeight: 600, whiteSpace: "nowrap" }}>Месяц</th>
                    {stats.allTypes.map((t) => (
                      <th key={t} style={{ padding: "7px 10px", textAlign: "right", color: "#0e7490", fontWeight: 600, whiteSpace: "nowrap" }}>❄️ {t}</th>
                    ))}
                    <th style={{ padding: "7px 10px", textAlign: "right", color: "#0891b2", fontWeight: 700, whiteSpace: "nowrap" }}>Итого</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.monthKeys.map((mk) => {
                    const mData  = stats.byMonth[mk];
                    const mTotal = Object.values(mData).reduce((s, v) => s + v, 0);
                    const [y, mo] = mk.split("-");
                    const label  = mo ? `${MONTH_NAMES_FULL[parseInt(mo) - 1]} ${y}` : mk;
                    return (
                      <tr key={mk} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "7px 16px", color: "var(--text2)", whiteSpace: "nowrap" }}>{label}</td>
                        {stats.allTypes.map((t) => (
                          <td key={t} style={{ padding: "7px 10px", textAlign: "right", color: "#0e7490", fontFamily: "JetBrains Mono, monospace" }}>
                            {mData[t] ? `${mData[t].toFixed(1)} кг` : "—"}
                          </td>
                        ))}
                        <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, color: "#0891b2", fontFamily: "JetBrains Mono, monospace" }}>
                          {mTotal.toFixed(1)} кг
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: "2px solid rgba(6,182,212,0.3)", background: "rgba(6,182,212,0.06)" }}>
                    <td style={{ padding: "7px 16px", fontWeight: 700, color: "#0891b2" }}>Итого</td>
                    {stats.allTypes.map((t) => (
                      <td key={t} style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, color: "#0891b2", fontFamily: "JetBrains Mono, monospace" }}>
                        {stats.byType[t].toFixed(1)} кг
                      </td>
                    ))}
                    <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 800, color: "#0891b2", fontFamily: "JetBrains Mono, monospace" }}>
                      {stats.total.toFixed(1)} кг
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export function DoneTab({ onOpenClient }: { onOpenClient?: (client: Client, vehicleId?: string) => void } = {}) {
  const liveData=useData();const {sourceStatus}=liveData;
  const baseStatus=(['clients','staff','intakeRepairs','tasks'] as const).some(k=>sourceStatus[k]==='error')?'error':(['clients','staff','intakeRepairs','tasks'] as const).every(k=>sourceStatus[k]==='ready')?'ready':'loading';
  const lastConfirmed=useRef(liveData);if(baseStatus==='ready')lastConfirmed.current=liveData;
  const {clients,tasks,staff,freezers,finance:rawFinance,expenses,intakeRepairs}=confirmedReportData(liveData,lastConfirmed.current,baseStatus);
  const {myProfile,isOwner,user}=useAuth();const {canSeeReportsAmounts}=usePermissions();
  const isAdmin=isOwner||["owner","admin","manager"].includes(myProfile?.role||"");
  const showAmounts=isAdmin&&canSeeReportsAmounts,canReturn=isOwner||myProfile?.role==="admin",ownerUid=user?.uid||"";
  const [view,setView]=useState<ReportView>('queue');const [filters,setFilters]=useState<ReportFilters>(DEFAULT_REPORT_FILTERS);
  const [exportMK,setExportMK]=useState(new Date().toISOString().slice(0,7));

  const exportReady=baseStatus==='ready'&&(['finance','freezers','expenses'] as const).every(k=>sourceStatus[k]==='ready');
  const allQueue=useMemo(()=>selectReportItems(clients,staff,DEFAULT_REPORT_FILTERS,'queue'),[clients,staff]);
  const allIntake=useMemo(()=>selectReportIntake(intakeRepairs,staff,DEFAULT_REPORT_FILTERS),[intakeRepairs,staff]);
  const needsClose=useMemo(()=>selectReportItems(clients,staff,filters,'queue'),[clients,staff,filters]);
  const intakeReady=useMemo(()=>selectReportIntake(intakeRepairs,staff,filters),[intakeRepairs,staff,filters]);
  const closedItems=useMemo(()=>selectReportItems(clients,staff,DEFAULT_REPORT_FILTERS,'archive'),[clients,staff]);
  const filteredClosed=useMemo(()=>selectReportItems(clients,staff,filters,'archive'),[clients,staff,filters]);
  const doneTasks=useMemo(()=>filters.status==='closed'||filters.status==='cancelled'||(filters.kind!=='all'&&filters.kind!=='other')?[]:selectServiceRequests(tasks,reportScope(staff,filters,'archive')),[tasks,staff,filters]);
  const byMonth=useMemo(()=>{
    const map=new Map<string,{items:DoneItem[];tasks:ServiceTask[]}>();
    filteredClosed.forEach(i=>{const bucket=map.get(i.mk)||{items:[],tasks:[]};bucket.items.push(i);map.set(i.mk,bucket);});
    doneTasks.forEach(t=>{const mk=reportTaskMonth(t);if(filters.month!=='all'&&filters.month!==mk)return;const bucket=map.get(mk)||{items:[],tasks:[]};bucket.tasks.push(t);map.set(mk,bucket);});
    return [...map.entries()].sort(([a],[b])=>b.localeCompare(a));
  },[filteredClosed,doneTasks,filters.month]);
  const totalRevenue=closedItems.filter(i=>requestStage(i.repair)==='closed').reduce((sum,i)=>sum+(parseFloat(i.repair.cost||'0')||0),0);
  const archiveMonths=useMemo(()=>reportArchiveMonths(closedItems,tasks),[closedItems,tasks]);
  const exportMonths=useMemo(()=>[...new Set(closedItems.filter(i=>requestStage(i.repair)==='closed').map(i=>i.mk).filter(m=>m!=='0000-00'))].sort().reverse(),[closedItems]);
  const selectedExport=exportMonths.includes(exportMK)?exportMK:exportMonths[0]||'';
  function exportMonthExcel() {
    if(!showAmounts||!exportReady||!selectedExport)return;
    const exportMK=selectedExport;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const finance = rawFinance as any;
    const monthItems = closedItems.filter((i) => i.mk === exportMK && requestStage(i.repair) === "closed");
    const [, m]      = exportMK.split("-");
    const mLabel     = `${MONTH_NAMES_FULL[parseInt(m) - 1]} ${exportMK.slice(0, 4)}`;

    // ── Лист 1: Ремонты ────────────────────────────────────────────────────────
    const addFreon = (map: Record<string, number>, type?: string, amt?: string) => {
      if (!type) return;
      map[type] = (map[type] ?? 0) + (parseFloat(amt ?? "0") || 0);
    };
    // Freon is stored redundantly on the repair and on its "Заправка фреона"
    // task — count it once per repair (repair value wins, task is the fallback),
    // matching the per-row logic below.
    const freonMap: Record<string, number> = {};
    monthItems.forEach((i) => {
      const type = i.repair.freonType ?? (i.repair.tasks ?? []).find((t) => t.freonType)?.freonType;
      const amt  = i.repair.freonAmount ?? (i.repair.tasks ?? []).find((t) => t.freonKg)?.freonKg;
      addFreon(freonMap, type, amt);
    });

    const repHeaders = ["Клиент", "Телефон", "Авто", "Гос.номер", "Дата начала", "Дата закрытия", "Механики", "Создал заявку", "Фреон", "Кол-во кг", "Сумма ₽", "Описание"];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repRows: any[][] = monthItems.map((i) => {
      const freonType = i.repair.freonType ?? (i.repair.tasks ?? []).find((t) => t.freonType)?.freonType ?? "";
      const freonAmt  = i.repair.freonAmount ?? String((i.repair.tasks ?? []).find((t) => t.freonKg)?.freonKg ?? "");
      return [
        i.client.name,
        i.client.phone ?? "",
        i.vehicle?.brand ?? i.vehicle?.model ?? "",
        i.vehicle?.plate ?? "",
        i.repair.date ?? "",
        i.repair.closedAt?.slice(0, 10) ?? "",
        i.assigneeNames,
        i.createdByName,
        freonType,
        freonAmt,
        parseFloat(i.repair.cost ?? "0") || 0,
        i.repair.description ?? "",
      ];
    });
    const totalRevenue = monthItems.reduce((s, i) => s + (parseFloat(i.repair.cost ?? "0") || 0), 0);
    if (monthItems.length > 0) repRows.push(["", "", "", "", "", "", "", "", "", "ИТОГО:", totalRevenue, ""]);

    const ws1 = XLSX.utils.aoa_to_sheet([repHeaders, ...repRows]);
    ws1["!cols"] = [{wch:20},{wch:14},{wch:18},{wch:12},{wch:12},{wch:14},{wch:22},{wch:16},{wch:10},{wch:10},{wch:12},{wch:30}];

    // ── Лист 2: Расходы ────────────────────────────────────────────────────────
    const elecBills  = (finance.elecBills  ?? {}) as Record<string, number>;
    const purchases  = (finance.purchases  ?? []) as Array<{ id: string; date: string; addedAt: string; amount: number; comment: string }>;
    const boxes      = (finance.boxes      ?? []) as Array<{ id: string; name: string; cost: number }>;
    const salaries   = (finance.salaries   ?? []) as Array<{ uid: string; name: string; salary: number }>;

    const elecCost   = parseFloat(String(elecBills[exportMK] ?? 0)) || 0;
    const liveBoxCost = boxes.reduce((s, b) => s + (parseFloat(String(b.cost)) || 0), 0);
    const liveSalCost = salaries.reduce((s, s2) => s + (parseFloat(String(s2.salary)) || 0), 0);
    const liveRentalInc = freezers
      .filter((f) => (f as { rented?: boolean }).rented || (f as { status?: string }).status === "rented")
      .reduce((s, f) => s + (parseFloat(String((f as { rentAmount?: number }).rentAmount ?? 0)) || 0), 0);
    // Fixed costs frozen for the exported month (see finance.ts). When a snapshot
    // applies its total may not match the current per-item list, so those months
    // are itemised as one aggregated line instead of the live breakdown.
    const { boxCost, salCost, rentalIncome: rentalInc } = resolveFixedCosts(finance, liveRentalInc, exportMK);
    const boxIsLive = boxCost === liveBoxCost;
    const salIsLive = salCost === liveSalCost;
    const mkPurchases = purchases.filter((p) => p.date?.slice(0, 7) === exportMK);
    const purTotal   = mkPurchases.reduce((s, p) => s + (parseFloat(String(p.amount)) || 0), 0);
    const mkCommissions = expenses.filter((e) => e.category === "commission" && e.month === exportMK);
    const commTotal  = mkCommissions.reduce((s, e) => s + (parseFloat(String(e.amount)) || 0), 0);
    const totalExp   = boxCost + salCost + elecCost + purTotal + commTotal;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expRows: any[][] = [["Статья расхода", "Сумма ₽"]];
    if (boxIsLive) boxes.filter((b) => b.cost > 0).forEach((b) => expRows.push([`Аренда бокса: ${b.name || "Бокс"}`, parseFloat(String(b.cost)) || 0]));
    else if (boxCost > 0) expRows.push(["Аренда боксов (на тот период)", boxCost]);
    if (salIsLive) salaries.filter((s) => s.salary > 0).forEach((s) => expRows.push([`Зарплата: ${s.name || "Сотрудник"}`, parseFloat(String(s.salary)) || 0]));
    else if (salCost > 0) expRows.push(["Зарплаты (на тот период)", salCost]);
    if (elecCost > 0) expRows.push([`Электричество (${mLabel})`, elecCost]);
    mkPurchases.forEach((p) => expRows.push([`Закупка: ${p.comment}`, parseFloat(String(p.amount)) || 0]));
    mkCommissions.forEach((c) => expRows.push([`Комиссионные${c.comment ? `: ${c.comment}` : ""}`, parseFloat(String(c.amount)) || 0]));
    expRows.push([], ["ИТОГО РАСХОДЫ", totalExp]);

    const ws2 = XLSX.utils.aoa_to_sheet(expRows);
    ws2["!cols"] = [{ wch: 35 }, { wch: 14 }];

    // ── Лист 3: P&L ───────────────────────────────────────────────────────────
    const totalInc = totalRevenue + rentalInc;
    const profit   = totalInc - totalExp;
    const totalFreonKg = Object.values(freonMap).reduce((s, v) => s + v, 0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pnlRows: any[][] = [
      [`P&L ЗА ${mLabel.toUpperCase()}`],
      [],
      ["═══ ДОХОДЫ ═══"],
      ["Ремонты",      totalRevenue, "₽", `(${monthItems.length} нарядов)`],
      ["Аренда камер", rentalInc,    "₽"],
      ["ИТОГО ДОХОДЫ", totalInc,     "₽"],
      [],
      ["═══ РАСХОДЫ ═══"],
      ...(boxIsLive
        ? boxes.filter((b) => b.cost > 0).map((b) => [`  Аренда бокса: ${b.name || "Бокс"}`, parseFloat(String(b.cost)) || 0, "₽"])
        : boxCost > 0 ? [["  Аренда боксов (на тот период)", boxCost, "₽"]] : []),
      ...(salIsLive
        ? salaries.filter((s) => s.salary > 0).map((s) => [`  Зарплата: ${s.name || "Сотрудник"}`, parseFloat(String(s.salary)) || 0, "₽"])
        : salCost > 0 ? [["  Зарплаты (на тот период)", salCost, "₽"]] : []),
      ...(elecCost > 0  ? [[`  Электричество`, elecCost, "₽"]] : []),
      ...(purTotal > 0  ? [[`  Закупки и материалы`, purTotal, "₽"]] : []),
      ...(commTotal > 0 ? [[`  Комиссионные`, commTotal, "₽"]] : []),
      ["ИТОГО РАСХОДЫ", totalExp, "₽"],
      [],
      ["═══ ПРИБЫЛЬ ═══"],
      ["Прибыль за месяц", profit, "₽"],
    ];
    if (totalFreonKg > 0) {
      pnlRows.push([], ["═══ ФРЕОН ═══"]);
      Object.entries(freonMap).forEach(([type, kg]) => pnlRows.push([`  ${type}`, `${kg.toFixed(1)} кг`]));
      pnlRows.push(["  Итого", `${totalFreonKg.toFixed(1)} кг`]);
    }

    const ws3 = XLSX.utils.aoa_to_sheet(pnlRows);
    ws3["!cols"] = [{ wch: 32 }, { wch: 14 }, { wch: 5 }, { wch: 20 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, "Ремонты");
    XLSX.utils.book_append_sheet(wb, ws2, "Расходы");
    XLSX.utils.book_append_sheet(wb, ws3, "P&L");
    XLSX.writeFile(wb, `РефСервисДВ_Отчёт_${exportMK}.xlsx`);
  }

  return <ReportsWorkspace view={view} onView={setView} filters={filters} onFilters={setFilters} staff={staff} queueCount={allQueue.length+allIntake.length} intakeCount={allIntake.length} archiveCount={closedItems.length} total={totalRevenue} showAmounts={showAmounts} ready={baseStatus==='ready'} canManage={isAdmin}>
    <ReportSourceBoundary status={baseStatus}>
      <section className="reports-view-panel" hidden={view!=='queue'} aria-label="Заявки к закрытию">
        {isAdmin&&<>
          <div className="reports-section-heading"><h2>Проверка выполненных работ</h2><span>Найдено: {needsClose.length+intakeReady.length}</span></div>
          <p className="reports-note">Откройте заявку, проверьте отчёты и фотографии. Укажите итоговую стоимость, затем подтвердите закрытие.</p>
          {intakeReady.length>0&&<><div className="reports-section-heading is-intake"><h2>Приёмка — назначить клиента</h2><span>{intakeReady.length}</span></div><div className="reports-queue-list">{intakeReady.map(i=><ReportQueueCard key={i.id} title={intakeKind(i)==='chamber'?(i.chamber?.label||'Камера'):[i.vehicle?.brand,i.vehicle?.plate].filter(Boolean).join(' · ')||'Автомобиль'} subtitle={i.repair.description||'Проверка работ и привязка к клиенту'} meta={i.createdByName} kind="intake"><IntakeCloseCard intake={i} clients={clients}/></ReportQueueCard>)}</div></>}
          {needsClose.length>0&&<div className="reports-queue-list">{needsClose.map(i=><ReportQueueCard key={`${i.client.id}/${i.repair.id}`} title={i.objectLabel} subtitle={`${i.client.name}${i.repair.description?' · '+i.repair.description:''}`} meta={[i.assigneeNames,i.repair.date?fmtDate(i.repair.date):'Без даты'].filter(Boolean).join(' · ')} kind="client"><NeedsCloseCard item={i} onOpenClient={onOpenClient}/></ReportQueueCard>)}</div>}
          {!needsClose.length&&!intakeReady.length&&<div className="reports-message"><strong>Заявок к закрытию не найдено</strong><p>Проверьте фильтры. Здесь появляются выполненные работы, ожидающие подтверждения менеджера.</p></div>}
        </>}
      </section>
      <section className="reports-view-panel" hidden={view!=='archive'} aria-label="Архив работ">
        <div className="reports-archive-period"><label>Период архива<select aria-label="Период архива" value={filters.month} onChange={e=>setFilters({...filters,month:e.target.value})}><option value="all">Все периоды</option>{archiveMonths.map(m=><option key={m} value={m}>{monthLabel(m)}</option>)}</select></label><span>По фильтрам: {filteredClosed.length} заявок. Отдельные задачи показаны в своих месяцах.</span></div>
        {showAmounts&&exportMonths.length>0&&<section className="reports-export-toolbar" aria-label="Экспорт отчёта"><label>Месяц для Excel<select aria-label="Месяц для Excel" value={selectedExport} onChange={e=>setExportMK(e.target.value)}>{exportMonths.map(m=><option key={m} value={m}>{monthLabel(m)}</option>)}</select></label><button type="button" disabled={!exportReady} onClick={exportMonthExcel}>Скачать Excel за месяц</button><p>Полный месяц: ремонты, расходы и P&amp;L. Поиск и фильтры списка не ограничивают экспорт. {exportReady?'Суммы отражают учёт CRM, а не подтверждение оплаты.':'Для экспорта нужны подтверждённые данные финансов, расходов и склада.'}</p></section>}
        {!byMonth.length?<div className="reports-message">По выбранным условиям завершённых работ нет. Измените фильтры или период.</div>:byMonth.map(([mk,{items,tasks:mTasks}])=><MonthBlock key={mk} mk={mk} items={items} tasks={mTasks} isAdmin={isAdmin} showAmounts={showAmounts} isOwner={isOwner} ownerUid={ownerUid} canReturn={canReturn} onOpenClient={onOpenClient}/>)}
      </section>
      <section className="reports-view-panel" hidden={view!=='freon'} aria-label="Расход фреона"><p className="reports-note">Сводка по всем клиентским ремонтам, включая незакрытые. Группировка — по дате заявки. Фильтры очереди и архива здесь не применяются.</p><FreonSection clients={clients} canManage={isAdmin}/></section>
    </ReportSourceBoundary>
  </ReportsWorkspace>;
}
