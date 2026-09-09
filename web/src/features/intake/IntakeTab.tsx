import { useMemo, useState } from "react";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import { repairStatus, taskStatus } from "../../shared/utils/repair";
import { fmtDate } from "../../shared/utils/format";
import { Modal } from "../../shared/ui/Modal";
import { Button } from "../../shared/ui/Button";
import { Input, Textarea, FormGroup } from "../../shared/ui/Input";
import { InlinePhotoButton } from "../../shared/ui/PhotoUploader";
import { CreatorLine } from "../../shared/ui/CreatorLine";
import { RepairTaskWork, AddRepairTaskModal, intakeRepairEditor } from "../../shared/repair-work";
import {
  createIntakeRepair,
  createChamberIntake,
  updateIntakeVehicle,
  updateIntakeChamber,
  deleteIntakeRepair,
} from "../../shared/firebase/intake";
import { intakeKind, type IntakeRepair, type IntakeServiceType } from "../../shared/types/intake";

const SERVICE_TYPE_LABELS: Record<IntakeServiceType, string> = {
  refrigerator: "Рефрижератор",
  ac: "Кондиционер",
};

function num(v: string): number | undefined {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function chamberSummary(c?: { length?: number; width?: number; height?: number }): string {
  if (!c) return "";
  const { length: l, width: w, height: h } = c;
  if (l && w && h) return `${((l * w * h) / 1_000_000_000).toFixed(2)} м³ · ${l}×${w}×${h} мм`;
  if (l || w || h) return `${l ?? "?"}×${w ?? "?"}×${h ?? "?"} мм`;
  return "";
}

// ─── Photo picker (shared by both modals) ────────────────────────────────────

function PhotoField({ photo, onPick, onClear }: { photo: string; onPick: (url: string, path: string) => void; onClear: () => void }) {
  return (
    <FormGroup label="Фото">
      <div className="flex items-center gap-3">
        {photo && <img src={photo} alt="" style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover", border: "1px solid var(--border)" }} />}
        <InlinePhotoButton
          folder="intake"
          capture="environment"
          label={photo ? "Заменить фото" : "Сделать фото"}
          onUploaded={async (photos) => {
            const p = photos[0];
            if (p) onPick(p.url ?? "", p.path ?? "");
          }}
        />
        {photo && (
          <button type="button" onClick={onClear} style={{ fontSize: 12, color: "#dc2626", background: "transparent", border: "none", cursor: "pointer" }}>
            Убрать
          </button>
        )}
      </div>
    </FormGroup>
  );
}

// ─── Create / edit car modal ─────────────────────────────────────────────────

function IntakeVehicleModal({ intake, onClose }: { intake?: IntakeRepair; onClose: () => void }) {
  const { myProfile, user } = useAuth();
  const isEdit = !!intake;
  const v = intake?.vehicle;

  const [plate, setPlate] = useState(v?.plate ?? "");
  const [brand, setBrand] = useState(v?.brand ?? "");
  const [model, setModel] = useState(v?.model ?? "");
  const [serviceType, setServiceType] = useState<IntakeServiceType>(v?.serviceType ?? "refrigerator");
  const [photo, setPhoto] = useState(v?.photo ?? "");
  const [photoPath, setPhotoPath] = useState(v?.photoPath ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const editor = { uid: user?.uid ?? "", name: myProfile?.name ?? user?.email ?? "Неизвестно" };

  async function handleSave() {
    if (!plate.trim()) { setError("Укажите гос. номер"); return; }
    setSaving(true);
    setError("");
    try {
      if (isEdit) {
        await updateIntakeVehicle(intake!.id, { plate, brand, model, photo, photoPath, serviceType }, editor);
      } else {
        await createIntakeRepair({
          plate,
          brand: brand || undefined,
          model: model || undefined,
          photo: photo || undefined,
          photoPath: photoPath || undefined,
          serviceType,
          creatorUid: editor.uid,
          creatorName: editor.name,
        });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? "Изменить машину" : "Новая машина на ремонт"} onClose={onClose}>
      <FormGroup label="Гос. номер *">
        <Input placeholder="А123ВС 77" value={plate} onChange={(e) => setPlate(e.target.value)} autoFocus />
      </FormGroup>
      <div className="flex gap-2">
        <FormGroup label="Марка"><Input placeholder="Hyundai" value={brand} onChange={(e) => setBrand(e.target.value)} /></FormGroup>
        <FormGroup label="Модель"><Input placeholder="Porter" value={model} onChange={(e) => setModel(e.target.value)} /></FormGroup>
      </div>
      <FormGroup label="Тип">
        <div className="flex gap-2">
          {(Object.keys(SERVICE_TYPE_LABELS) as IntakeServiceType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setServiceType(t)}
              style={{
                flex: 1, padding: "9px 12px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer",
                border: serviceType === t ? "1px solid var(--accent)" : "1px solid var(--border2)",
                background: serviceType === t ? "var(--accent)" : "var(--bg3)",
                color: serviceType === t ? "white" : "var(--text2)",
              }}
            >
              {SERVICE_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </FormGroup>
      <PhotoField photo={photo} onPick={(u, p) => { setPhoto(u); setPhotoPath(p); }} onClear={() => { setPhoto(""); setPhotoPath(""); }} />
      {error && <div style={{ fontSize: 12, color: "#dc2626", fontWeight: 600, marginBottom: 8 }}>⚠ {error}</div>}
      <Button size="lg" onClick={() => void handleSave()} disabled={saving}>
        {saving ? "Сохранение..." : isEdit ? "Сохранить" : "Создать заявку"}
      </Button>
    </Modal>
  );
}

// ─── Create / edit chamber modal ─────────────────────────────────────────────

function IntakeChamberModal({ intake, onClose }: { intake?: IntakeRepair; onClose: () => void }) {
  const { myProfile, user } = useAuth();
  const isEdit = !!intake;
  const c = intake?.chamber;

  const [label, setLabel] = useState(c?.label ?? "");
  const [length, setLength] = useState(String(c?.length ?? ""));
  const [width, setWidth] = useState(String(c?.width ?? ""));
  const [height, setHeight] = useState(String(c?.height ?? ""));
  const [wall, setWall] = useState(String(c?.wallThickness ?? ""));
  const [notes, setNotes] = useState(c?.notes ?? "");
  const [photo, setPhoto] = useState(c?.photo ?? "");
  const [photoPath, setPhotoPath] = useState(c?.photoPath ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const editor = { uid: user?.uid ?? "", name: myProfile?.name ?? user?.email ?? "Неизвестно" };

  async function handleSave() {
    if (!label.trim()) { setError("Укажите метку (магазин / адрес / описание)"); return; }
    setSaving(true);
    setError("");
    const dims = { length: num(length), width: num(width), height: num(height), wallThickness: num(wall) };
    try {
      if (isEdit) {
        await updateIntakeChamber(intake!.id, { label, ...dims, notes, photo, photoPath }, editor);
      } else {
        await createChamberIntake({
          label,
          ...dims,
          notes: notes || undefined,
          photo: photo || undefined,
          photoPath: photoPath || undefined,
          creatorUid: editor.uid,
          creatorName: editor.name,
        });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? "Изменить камеру" : "Новая камера на ремонт"} onClose={onClose}>
      <FormGroup label="Метка (магазин / адрес / описание) *">
        <Input placeholder="Магазин на Светланской, склад №2" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
      </FormGroup>
      <FormGroup label="Размеры (Д × Ш × В), мм">
        <div className="flex gap-2">
          <Input type="number" placeholder="Д" value={length} onChange={(e) => setLength(e.target.value)} />
          <Input type="number" placeholder="Ш" value={width} onChange={(e) => setWidth(e.target.value)} />
          <Input type="number" placeholder="В" value={height} onChange={(e) => setHeight(e.target.value)} />
        </div>
      </FormGroup>
      <FormGroup label="Толщина стенки, мм">
        <Input type="number" placeholder="80" value={wall} onChange={(e) => setWall(e.target.value)} />
      </FormGroup>
      <FormGroup label="Примечание">
        <Textarea placeholder="Что с камерой, что нужно сделать..." value={notes} onChange={(e) => setNotes(e.target.value)} />
      </FormGroup>
      <PhotoField photo={photo} onPick={(u, p) => { setPhoto(u); setPhotoPath(p); }} onClear={() => { setPhoto(""); setPhotoPath(""); }} />
      {error && <div style={{ fontSize: 12, color: "#dc2626", fontWeight: 600, marginBottom: 8 }}>⚠ {error}</div>}
      <Button size="lg" onClick={() => void handleSave()} disabled={saving}>
        {saving ? "Сохранение..." : isEdit ? "Сохранить" : "Создать заявку"}
      </Button>
    </Modal>
  );
}

// ─── Intake card ─────────────────────────────────────────────────────────────

function IntakeCard({ intake }: { intake: IntakeRepair }) {
  const { myProfile, user } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const editor = intakeRepairEditor(intake.id, {
    uid: user?.uid ?? "",
    name: myProfile?.name ?? user?.email ?? "Неизвестно",
  });

  const kind = intakeKind(intake);
  const isChamber = kind === "chamber";
  const { repair } = intake;
  const tasks = repair.tasks ?? [];
  const doneTasks = tasks.filter((t) => taskStatus(t) === "done").length;
  const allDone = tasks.length > 0 && doneTasks === tasks.length;
  const stripe = allDone ? "var(--green)" : "var(--accent)";
  const photo = isChamber ? intake.chamber?.photo : intake.vehicle?.photo;

  const title = isChamber
    ? (intake.chamber?.label || "Камера")
    : ([intake.vehicle?.brand, intake.vehicle?.model].filter(Boolean).join(" ") || "Автомобиль");

  async function handleDelete() {
    const what = isChamber ? `камере «${intake.chamber?.label}»` : `машине ${intake.vehicle?.plate}`;
    if (!confirm(`Удалить заявку по ${what}? Все задачи и фото будут удалены.`)) return;
    await deleteIntakeRepair(intake);
  }

  return (
    <div style={{
      background: "var(--bg2)", border: "1px solid var(--border)", borderLeft: `3px solid ${stripe}`,
      borderRadius: 14, overflow: "hidden", marginBottom: 12, boxShadow: "0 2px 10px rgba(0,0,0,0.18)",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px 10px" }}>
        {photo ? (
          <img src={photo} alt="" style={{ width: 52, height: 52, borderRadius: 10, objectFit: "cover", flexShrink: 0, border: "1px solid var(--border)" }} />
        ) : (
          <div style={{ width: 52, height: 52, borderRadius: 10, flexShrink: 0, background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>
            {isChamber ? "🧊" : "🚚"}
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 5 }}>{title}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
            {isChamber ? (
              chamberSummary(intake.chamber) && (
                <span style={{ fontSize: 11, color: "var(--text3)", fontFamily: "JetBrains Mono, monospace" }}>{chamberSummary(intake.chamber)}</span>
              )
            ) : (
              <>
                <span style={{
                  fontFamily: "JetBrains Mono, monospace", fontSize: 12, fontWeight: 700, color: "#3b82f6",
                  background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.25)", padding: "2px 8px", borderRadius: 6,
                }}>
                  {intake.vehicle?.plate}
                </span>
                {intake.vehicle && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: "rgba(139,92,246,0.12)", color: "#7c3aed" }}>
                    {SERVICE_TYPE_LABELS[intake.vehicle.serviceType]}
                  </span>
                )}
              </>
            )}
            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: "rgba(139,92,246,0.12)", color: "#7c3aed" }}>
              {isChamber ? "Камера" : "Машина"}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
              background: allDone ? "rgba(34,197,94,0.15)" : "rgba(59,130,246,0.15)",
              color: allDone ? "#16a34a" : "var(--accent2)",
            }}>
              {allDone ? "✓ Задачи закрыты" : "В работе"}
            </span>
            {tasks.length > 0 && (
              <span style={{ fontSize: 10, color: "var(--text3)", fontFamily: "JetBrains Mono, monospace" }}>{doneTasks}/{tasks.length}</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--text3)" }}>Клиент назначит менеджер при закрытии</div>
          <CreatorLine name={intake.createdByName} date={intake.createdAt} style={{ marginTop: 2 }} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
          {repair.date && <span style={{ fontSize: 11, color: "var(--text3)" }}>{fmtDate(repair.date)}</span>}
          <div style={{ display: "flex", gap: 4 }}>
            <button type="button" onClick={() => setShowEdit(true)} title="Изменить" style={{ padding: "5px 7px", borderRadius: 8, background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text2)", cursor: "pointer", fontSize: 13, lineHeight: 1 }}>
              <i className="ti ti-pencil" />
            </button>
            <button type="button" onClick={() => void handleDelete()} title="Удалить заявку" style={{ padding: "5px 7px", borderRadius: 8, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)", color: "#dc2626", cursor: "pointer", fontSize: 13, lineHeight: 1 }}>
              <i className="ti ti-trash" />
            </button>
          </div>
        </div>
      </div>

      <RepairTaskWork repair={repair} tasks={tasks} editor={editor} canManageTasks />

      <div style={{ padding: "4px 12px 12px" }}>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          style={{
            alignSelf: "flex-start", padding: "5px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
            background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text2)", cursor: "pointer",
          }}
        >
          <i className="ti ti-plus" style={{ fontSize: 12 }} /> Задача
        </button>
      </div>

      {showAdd && (
        <AddRepairTaskModal editor={editor} repairFreonType={repair.freonType} onClose={() => setShowAdd(false)} />
      )}
      {showEdit && (isChamber
        ? <IntakeChamberModal intake={intake} onClose={() => setShowEdit(false)} />
        : <IntakeVehicleModal intake={intake} onClose={() => setShowEdit(false)} />)}
    </div>
  );
}

// ─── Tab ─────────────────────────────────────────────────────────────────────

export function IntakeTab() {
  const { intakeRepairs } = useData();
  const [newKind, setNewKind] = useState<null | "vehicle" | "chamber">(null);

  const sorted = useMemo(
    () => [...intakeRepairs]
      .filter((i) => i && i.repair && (i.vehicle || i.chamber))
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")),
    [intakeRepairs],
  );
  const ready = sorted.filter((i) => repairStatus(i.repair) === "done");
  const active = sorted.filter((i) => repairStatus(i.repair) !== "done");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="crm-section" style={{ animation: "fadeUp 0.45s ease 0.1s both" }}>
        <div className="section-header">
          <i className="ti ti-car-garage" style={{ fontSize: 17, color: "var(--text2)" }} />
          <span className="section-title">Приёмка</span>
          {sorted.length > 0 && <span className="section-count">{sorted.length}</span>}
          <div className="section-actions" style={{ display: "flex", gap: 6 }}>
            <button className="btn-primary" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => setNewKind("vehicle")}>
              <i className="ti ti-plus" /> Машина
            </button>
            <button className="btn-primary" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => setNewKind("chamber")}>
              <i className="ti ti-plus" /> Камера
            </button>
          </div>
        </div>

        {sorted.length === 0 ? (
          <div style={{ padding: "36px 20px", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
            Нет заявок в приёмке.<br />Нажмите «Машина» или «Камера», когда объект заедет на ремонт.
          </div>
        ) : (
          <div style={{ padding: "10px 12px 12px" }}>
            {ready.length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#16a34a", textTransform: "uppercase", letterSpacing: "0.6px", margin: "4px 2px 8px" }}>
                  Задачи закрыты — ждут менеджера ({ready.length})
                </div>
                {ready.map((i) => <IntakeCard key={i.id} intake={i} />)}
              </>
            )}
            {active.length > 0 && (
              <>
                {ready.length > 0 && (
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.6px", margin: "10px 2px 8px" }}>
                    В работе ({active.length})
                  </div>
                )}
                {active.map((i) => <IntakeCard key={i.id} intake={i} />)}
              </>
            )}
          </div>
        )}
      </div>

      {newKind === "vehicle" && <IntakeVehicleModal onClose={() => setNewKind(null)} />}
      {newKind === "chamber" && <IntakeChamberModal onClose={() => setNewKind(null)} />}
    </div>
  );
}
