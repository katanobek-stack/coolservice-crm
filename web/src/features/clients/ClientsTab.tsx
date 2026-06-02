import { useState, useMemo } from "react";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import {
  repairStatus, taskStatus, getAssignees, SERVICE_TYPES, FREON_TYPES,
} from "../../shared/utils/repair";
import { fmtDate, daysAgo, genId } from "../../shared/utils/format";
import { Badge } from "../../shared/ui/Badge";
import { Modal } from "../../shared/ui/Modal";
import { Button } from "../../shared/ui/Button";
import { Input, Textarea, Select, FormGroup } from "../../shared/ui/Input";
import { PhotoGrid, InlinePhotoButton } from "../../shared/ui/PhotoUploader";
import { addClient, updateClient, deleteClient, updateClientArray } from "../../shared/firebase/firestore";
import type { Appointment, Client, Repair, RepairTask, ClientType, ServiceType, Vehicle } from "../../shared/types/client";
import type { PhotoData } from "../../shared/utils/photos";

// ─── Lightbox ─────────────────────────────────────────────────────────────────

function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/90 cursor-pointer" onClick={onClose}>
      <img src={url} alt="" className="max-w-[95%] max-h-[90%] object-contain rounded-xl" />
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function RepairStatusBadge({ status }: { status: ReturnType<typeof repairStatus> }) {
  if (status === "done")      return <Badge variant="green">Готово</Badge>;
  if (status === "cancelled") return <Badge variant="gray">Отказ</Badge>;
  return <Badge variant="amber">В работе</Badge>;
}

// ─── Edit Client Modal ────────────────────────────────────────────────────────

function EditClientModal({ client, onClose }: { client: Client; onClose: () => void }) {
  const [name,   setName]   = useState(client.name);
  const [phone,  setPhone]  = useState(client.phone ?? "");
  const [note,   setNote]   = useState(client.note ?? "");
  const [inn,    setInn]    = useState(client.inn ?? "");
  const [contact, setContact] = useState(client.contactPerson ?? "");
  const [sub,    setSub]    = useState(String(client.subscription ?? ""));
  const [saving, setSaving] = useState(false);
  // clientType — поле в старом Firebase; type — в новом коде
  const isLegal = (client.clientType ?? client.type ?? "phys") === "legal";

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    await updateClient(client.id, {
      name: name.trim(),
      phone: phone.trim() || undefined,
      note: note.trim() || undefined,
      inn: inn.trim() || undefined,
      contactPerson: contact.trim() || undefined,
      ...(isLegal && sub ? { subscription: parseFloat(sub) || undefined } : {}),
    });
    onClose();
  }

  return (
    <Modal title="Редактировать" onClose={onClose}>
      <FormGroup label="ФИО / Название"><Input value={name} onChange={(e) => setName(e.target.value)} /></FormGroup>
      <FormGroup label="Телефон"><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></FormGroup>
      {isLegal && (
        <>
          <FormGroup label="ИНН"><Input value={inn} onChange={(e) => setInn(e.target.value)} /></FormGroup>
          <FormGroup label="Контакт"><Input value={contact} onChange={(e) => setContact(e.target.value)} /></FormGroup>
          <FormGroup label="Абонплата (₽/мес)"><Input type="number" value={sub} onChange={(e) => setSub(e.target.value)} /></FormGroup>
        </>
      )}
      <FormGroup label="Примечание"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></FormGroup>
      <Button size="lg" onClick={() => void handleSave()} disabled={saving}>{saving ? "..." : "Сохранить"}</Button>
    </Modal>
  );
}

// ─── Add Client Modal ─────────────────────────────────────────────────────────

function AddClientModal({ type, onClose }: { type: ClientType; onClose: () => void }) {
  const [name, setName] = useState(""); const [phone, setPhone] = useState("");
  const [note, setNote] = useState(""); const [inn,   setInn]   = useState("");
  const [contact, setContact] = useState(""); const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) return; setSaving(true);
    await addClient({ name: name.trim(), clientType: type, phone: phone.trim() || undefined, note: note.trim() || undefined, inn: type === "legal" ? inn.trim() || undefined : undefined, contactPerson: type === "legal" ? contact.trim() || undefined : undefined, vehicles: [], repairs: [], appointments: [] });
    onClose();
  }
  return (
    <Modal title={type === "phys" ? "Новый клиент" : "Новая компания"} onClose={onClose}>
      <FormGroup label="ФИО / Название"><Input placeholder={type === "phys" ? "Иван Иванов" : "ООО «Пример»"} value={name} onChange={(e) => setName(e.target.value)} /></FormGroup>
      <FormGroup label="Телефон"><Input type="tel" placeholder="+7 924 000 00 00" value={phone} onChange={(e) => setPhone(e.target.value)} /></FormGroup>
      {type === "legal" && (<><FormGroup label="ИНН"><Input value={inn} onChange={(e) => setInn(e.target.value)} /></FormGroup><FormGroup label="Контакт"><Input value={contact} onChange={(e) => setContact(e.target.value)} /></FormGroup></>)}
      <FormGroup label="Примечание"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></FormGroup>
      <Button size="lg" onClick={() => void handleSave()} disabled={saving}>{saving ? "..." : "Создать"}</Button>
    </Modal>
  );
}

// ─── Vehicle Modal ────────────────────────────────────────────────────────────

function VehicleModal({ client, vehicle, onClose }: { client: Client; vehicle?: Vehicle; onClose: () => void }) {
  const [plate, setPlate] = useState(vehicle?.plate ?? "");
  // Firebase хранит поле как brand (не model)
  const [brand, setBrand] = useState(vehicle?.brand ?? vehicle?.model ?? "");
  const [saving, setSaving] = useState(false);
  const isEdit = !!vehicle;

  async function handleSave() {
    if (!plate.trim()) return; setSaving(true);
    const norm = plate.trim().toUpperCase();
    if (isEdit) {
      await updateClient(client.id, { vehicles: (client.vehicles ?? []).map((v) => v.id === vehicle.id ? { ...v, plate: norm, brand: brand.trim() || undefined } : v) });
    } else {
      await updateClient(client.id, { vehicles: [...(client.vehicles ?? []), { id: genId(), plate: norm, brand: brand.trim() || undefined }] });
    }
    onClose();
  }

  async function handleDelete() {
    if (!vehicle || !confirm(`Удалить авто ${vehicle.plate}?`)) return;
    await updateClient(client.id, {
      vehicles:     (client.vehicles ?? []).filter((v) => v.id !== vehicle.id),
      repairs:      (client.repairs ?? []).filter((r) => r.vehicleId !== vehicle.id),
      appointments: (client.appointments ?? []).filter((a) => (a as Appointment & { vehicleId?: string }).vehicleId !== vehicle.id),
    });
    onClose();
  }

  return (
    <Modal title={isEdit ? "Редактировать авто" : "Добавить авто"} onClose={onClose}>
      <FormGroup label="Гос. номер"><Input placeholder="А123БВ 125" value={plate} onChange={(e) => setPlate(e.target.value)} style={{ fontFamily: "monospace", fontWeight: 700, textTransform: "uppercase" }} /></FormGroup>
      <FormGroup label="Марка / модель"><Input placeholder="Toyota Dyna" value={brand} onChange={(e) => setBrand(e.target.value)} /></FormGroup>
      <Button size="lg" onClick={() => void handleSave()} disabled={saving}>{saving ? "..." : isEdit ? "Сохранить" : "Добавить"}</Button>
      {isEdit && (<div className="mt-3 pt-3 border-t border-[#E2E8F0]"><button type="button" onClick={() => void handleDelete()} className="text-xs text-red-400 cursor-pointer bg-transparent border-none">🗑 Удалить авто</button></div>)}
    </Modal>
  );
}

// ─── Add Appointment Modal ────────────────────────────────────────────────────

function AddAppointmentModal({ client, onClose }: { client: Client; onClose: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate]   = useState(today);
  const [time, setTime]   = useState("");
  const [desc, setDesc]   = useState("");
  const [vId,  setVId]    = useState(client.vehicles[0]?.id ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    const appt: Appointment & { vehicleId?: string } = {
      id:          genId(),
      date:        time ? `${date}T${time}:00` : date,
      description: desc.trim() || undefined,
      vehicleId:   vId || undefined,
    };
    await updateClientArray(client.id, "appointments", [...(client.appointments ?? []), appt]);
    onClose();
  }

  return (
    <Modal title="Новая запись" onClose={onClose}>
      <FormGroup label="Дата"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></FormGroup>
      <FormGroup label="Время"><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></FormGroup>
      {(client.vehicles ?? []).length > 0 && (
        <FormGroup label="Авто">
          <Select value={vId} onChange={(e) => setVId(e.target.value)}>
            <option value="">— не указан —</option>
            {(client.vehicles ?? []).map((v) => <option key={v.id} value={v.id}>{v.plate}</option>)}
          </Select>
        </FormGroup>
      )}
      <FormGroup label="Описание"><Textarea placeholder="Что планируется..." value={desc} onChange={(e) => setDesc(e.target.value)} /></FormGroup>
      <Button size="lg" onClick={() => void handleSave()} disabled={saving}>{saving ? "..." : "Создать запись"}</Button>
    </Modal>
  );
}

// ─── Add Repair Modal ─────────────────────────────────────────────────────────

function AddRepairModal({ client, onClose }: { client: Client; onClose: () => void }) {
  const { staff } = useData();
  const { myProfile } = useAuth();
  const role    = myProfile?.role ?? "mechanic";
  const isAdmin = role === "admin" || role === "manager";

  const [vehicleId,   setVehicleId]   = useState(client.vehicles[0]?.id ?? "");
  const [newPlate,    setNewPlate]    = useState("");
  const [serviceType, setServiceType] = useState<ServiceType>("refrigerator");
  const [desc,        setDesc]        = useState("");
  const [date,        setDate]        = useState(new Date().toISOString().slice(0, 10));
  const [cost,        setCost]        = useState("");
  const [freonType,   setFreonType]   = useState("");
  const [freonAmt,    setFreonAmt]    = useState("");
  const [assignee,    setAssignee]    = useState("");
  const [taskDesc,    setTaskDesc]    = useState("");
  const [saving,      setSaving]      = useState(false);

  async function handleSave() {
    setSaving(true);
    let finalVehicleId = vehicleId;
    let vehicles = client.vehicles ?? [];
    if (!vehicleId && newPlate.trim()) {
      const newV: Vehicle = { id: genId(), plate: newPlate.trim().toUpperCase() };
      vehicles = [...vehicles, newV];
      finalVehicleId = newV.id;
      await updateClient(client.id, { vehicles });
    }
    const tasks: RepairTask[] = taskDesc.trim()
      ? [{ id: genId(), description: taskDesc.trim(), assignees: assignee ? [assignee] : [], doneBy: [], status: "in_progress" }]
      : [];
    const repair: Repair = {
      id: genId(), vehicleId: finalVehicleId || undefined, serviceType,
      description: desc.trim(), date,
      cost: isAdmin && cost.trim() ? cost.trim() : undefined,
      status: "in_progress", freonType: freonType || undefined,
      freonAmount: freonAmt.trim() || undefined, photos: [], tasks,
    };
    await updateClientArray(client.id, "repairs", [...(client.repairs ?? []), repair]);
    onClose();
  }

  return (
    <Modal title="Новый ремонт" onClose={onClose}>
      <FormGroup label="Автомобиль">
        <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
          <option value="">— новый авто —</option>
          {(client.vehicles ?? []).map((v) => <option key={v.id} value={v.id}>{v.plate}{(v.brand ?? v.model) ? ` · ${v.brand ?? v.model}` : ""}</option>)}
        </Select>
      </FormGroup>
      {!vehicleId && <FormGroup label="Номер нового авто"><Input placeholder="А123БВ 125" value={newPlate} onChange={(e) => setNewPlate(e.target.value)} /></FormGroup>}
      <FormGroup label="Тип услуги">
        <div className="grid grid-cols-2 gap-2">
          {SERVICE_TYPES.map((s) => (
            <button key={s.id} type="button" onClick={() => setServiceType(s.id)}
              className={`py-2.5 rounded-xl border text-sm font-semibold cursor-pointer transition-all ${serviceType === s.id ? "bg-[#185FA5] text-white border-[#185FA5]" : "bg-white text-[#667085] border-[#E2E8F0]"}`}>
              {s.emoji} {s.label}
            </button>
          ))}
        </div>
      </FormGroup>
      <FormGroup label="Описание"><Textarea placeholder="Что нужно сделать..." value={desc} onChange={(e) => setDesc(e.target.value)} /></FormGroup>
      <FormGroup label="Дата"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></FormGroup>
      {isAdmin && <FormGroup label="Стоимость (₽)"><Input type="number" placeholder="0" value={cost} onChange={(e) => setCost(e.target.value)} /></FormGroup>}
      <FormGroup label="Фреон">
        <div className="flex gap-2">
          <Select value={freonType} onChange={(e) => setFreonType(e.target.value)}>
            {FREON_TYPES.map((f) => <option key={f} value={f}>{f || "— не указан —"}</option>)}
          </Select>
          <Input placeholder="кг" value={freonAmt} onChange={(e) => setFreonAmt(e.target.value)} className="w-24" />
        </div>
      </FormGroup>
      <FormGroup label="Задача механику"><Textarea placeholder="Необязательно" value={taskDesc} onChange={(e) => setTaskDesc(e.target.value)} /></FormGroup>
      {taskDesc.trim() && (
        <FormGroup label="Назначить">
          <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">— не назначен —</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name ?? s.email}</option>)}
          </Select>
        </FormGroup>
      )}
      <Button size="lg" onClick={() => void handleSave()} disabled={saving}>{saving ? "..." : "Создать заявку"}</Button>
    </Modal>
  );
}

// ─── Edit Repair Modal ────────────────────────────────────────────────────────

function EditRepairModal({ client, repair, onClose }: { client: Client; repair: Repair; onClose: () => void }) {
  const { myProfile } = useAuth();
  const role    = myProfile?.role ?? "mechanic";
  const isAdmin = role === "admin" || role === "manager";

  const [serviceType, setServiceType] = useState<ServiceType>(repair.serviceType);
  const [desc,        setDesc]        = useState(repair.description ?? "");
  const [date,        setDate]        = useState(repair.date ?? new Date().toISOString().slice(0, 10));
  const [cost,        setCost]        = useState(repair.cost ?? "");
  const [freonType,   setFreonType]   = useState(repair.freonType ?? "");
  const [freonAmt,    setFreonAmt]    = useState(repair.freonAmount ?? "");
  const [saving,      setSaving]      = useState(false);

  async function handleSave() {
    setSaving(true);
    const updates: Partial<Repair> = {
      serviceType, description: desc.trim(), date,
      freonType: freonType || undefined, freonAmount: freonAmt.trim() || undefined,
    };
    if (isAdmin) updates.cost = cost.trim() || undefined;
    const repairs = (client.repairs ?? []).map((r) => r.id === repair.id ? { ...r, ...updates } : r);
    await updateClientArray(client.id, "repairs", repairs);
    onClose();
  }

  return (
    <Modal title="Редактировать наряд" onClose={onClose}>
      {(repair.closedByManager || repair.status === "cancelled") && (
        <div className="mb-3 p-3 bg-blue-50 rounded-xl border border-blue-100 text-xs text-blue-600">
          ℹ️ Редактирование закрытого/отменённого наряда
        </div>
      )}
      <FormGroup label="Тип услуги">
        <div className="grid grid-cols-2 gap-2">
          {SERVICE_TYPES.map((s) => (
            <button key={s.id} type="button" onClick={() => setServiceType(s.id)}
              className={`py-2 rounded-xl border text-sm font-semibold cursor-pointer transition-all ${serviceType === s.id ? "bg-[#185FA5] text-white border-[#185FA5]" : "bg-white text-[#667085] border-[#E2E8F0]"}`}>
              {s.emoji} {s.label}
            </button>
          ))}
        </div>
      </FormGroup>
      <FormGroup label="Дата"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></FormGroup>
      <FormGroup label="Описание"><Textarea value={desc} onChange={(e) => setDesc(e.target.value)} /></FormGroup>
      {isAdmin && <FormGroup label="Стоимость (₽)"><Input type="number" value={cost} onChange={(e) => setCost(e.target.value)} /></FormGroup>}
      <FormGroup label="Фреон">
        <div className="flex gap-2">
          <Select value={freonType} onChange={(e) => setFreonType(e.target.value)}>
            {FREON_TYPES.map((f) => <option key={f} value={f}>{f || "— не указан —"}</option>)}
          </Select>
          <Input placeholder="кг" value={freonAmt} onChange={(e) => setFreonAmt(e.target.value)} className="w-24" />
        </div>
      </FormGroup>
      <Button size="lg" onClick={() => void handleSave()} disabled={saving}>{saving ? "..." : "Сохранить"}</Button>
    </Modal>
  );
}

// ─── Repair Card ──────────────────────────────────────────────────────────────

function RepairCard({ client, repair, isAdmin, isHistory }: {
  client: Client; repair: Repair; isAdmin: boolean; isHistory?: boolean;
}) {
  const vehicle     = (client.vehicles ?? []).find((v) => v.id === repair.vehicleId);
  const status      = repairStatus(repair);
  const svc         = SERVICE_TYPES.find((s) => s.id === repair.serviceType) ?? SERVICE_TYPES[3];
  const days        = daysAgo(repair.date);
  const isCancelled = status === "cancelled";

  const [showEdit, setShowEdit] = useState(false);
  const [lightbox,  setLightbox]  = useState<string | null>(null);

  async function setRepairStatus(newStatus: "in_progress" | "cancelled" | "done") {
    const updates: Partial<Repair> =
      newStatus === "done"      ? { closedByManager: true, status: "in_progress" } :
      newStatus === "cancelled" ? { status: "cancelled", closedByManager: false } :
                                  { status: "in_progress", closedByManager: false };
    await updateClientArray(client.id, "repairs",
      (client.repairs ?? []).map((r) => r.id === repair.id ? { ...r, ...updates } : r));
  }

  async function handleDelete() {
    if (!confirm("Удалить заказ-наряд?")) return;
    await updateClientArray(client.id, "repairs", (client.repairs ?? []).filter((r) => r.id !== repair.id));
  }

  async function addPhotos(photos: PhotoData[]) {
    await updateClientArray(client.id, "repairs",
      (client.repairs ?? []).map((r) =>
        r.id === repair.id ? { ...r, photos: [...(r.photos ?? []), ...photos] } : r));
  }

  return (
    <div
      className={`bg-white rounded-[16px] border-l-4 border border-[#E2E8F0] p-3.5 mb-2.5 shadow-sm ${isCancelled ? "opacity-50" : ""}`}
      style={{ borderLeftColor: status === "done" ? "var(--green)" : isCancelled ? "var(--text3)" : "var(--accent)" }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="blue">{svc.emoji} {svc.label}</Badge>
          <RepairStatusBadge status={status} />
          {status === "in_progress" && days > 3 && (
            <Badge variant={days > 7 ? "red" : "amber"}>{days} дн.</Badge>
          )}
        </div>
        {isAdmin && (
          <div className="flex gap-1 flex-shrink-0">
            <button type="button" onClick={() => setShowEdit(true)}
              className="text-[10px] text-[#667085] bg-[#F2F4F7] px-2 py-0.5 rounded-lg cursor-pointer border-none">
              ✏️
            </button>
            {isCancelled ? (
              <button type="button" onClick={() => void setRepairStatus("in_progress")}
                className="text-[10px] text-[#BA7517] bg-[#FAEEDA] px-2 py-0.5 rounded-lg cursor-pointer border-none">
                ↩ Вернуть
              </button>
            ) : status === "in_progress" ? (
              <>
                <button type="button" onClick={() => void setRepairStatus("done")}
                  className="text-[10px] text-[#3B6D11] bg-[#EAF3DE] px-2 py-0.5 rounded-lg cursor-pointer border-none">
                  Закрыть
                </button>
                <button type="button" onClick={() => void setRepairStatus("cancelled")}
                  className="text-[10px] text-[#667085] bg-[#F2F4F7] px-2 py-0.5 rounded-lg cursor-pointer border-none">
                  Отказ
                </button>
              </>
            ) : null}
            <button type="button" onClick={() => void handleDelete()}
              className="text-[#98A2B3] cursor-pointer bg-transparent border-none text-base leading-none">
              ×
            </button>
          </div>
        )}
      </div>

      {vehicle && (
        <span className="text-xs bg-[#F2F4F7] text-[#344054] px-2 py-0.5 rounded font-mono mr-1">{vehicle.plate}</span>
      )}
      {repair.description && <div className="text-sm text-[#344054] mt-1">{repair.description}</div>}

      <div className="flex items-center justify-between mt-1.5">
        <span className="text-xs text-[#98A2B3]">{fmtDate(repair.date)}</span>
        {repair.cost && isAdmin && <span className="text-sm font-bold text-[#3B6D11]">{repair.cost} ₽</span>}
      </div>

      {(repair.freonType || repair.freonAmount) && (
        <div className="mt-1.5 text-xs text-cyan-600 bg-cyan-50 rounded-lg px-2 py-1 border border-cyan-100 inline-block">
          ❄️ {repair.freonType} {repair.freonAmount && `${repair.freonAmount} кг`}
        </div>
      )}

      {/* Photos */}
      <PhotoGrid photos={repair.photos ?? []} readOnly onView={setLightbox} />

      {/* Add photo button (active repairs only) */}
      {isAdmin && status === "in_progress" && (
        <div className="mt-2">
          <InlinePhotoButton onUploaded={addPhotos} label="Фото к наряду" capture="environment" folder="repairs" />
        </div>
      )}

      {/* Tasks */}
      {(repair.tasks ?? []).length > 0 && (
        <div className="mt-2 space-y-1">
          {(repair.tasks ?? []).map((t) => {
            const ts = taskStatus(t);
            return (
              <div key={t.id} className="flex items-center gap-2 text-xs bg-[#F7F9FC] rounded-lg px-2.5 py-1.5">
                <span className={ts === "done" ? "text-[#3B6D11]" : "text-[#BA7517]"}>{ts === "done" ? "✓" : "●"}</span>
                <span className="text-[#344054] flex-1">{t.description}</span>
                {t.freonKg && <span className="text-cyan-500 text-[10px]">❄️ {t.freonKg} кг</span>}
                {t.workComment && <span className="text-purple-400 text-[10px]">📝</span>}
              </div>
            );
          })}
        </div>
      )}

      {showEdit && <EditRepairModal client={client} repair={repair} onClose={() => setShowEdit(false)} />}
      {lightbox  && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

// ─── History grouped by date ──────────────────────────────────────────────────

function RepairHistory({ client, isAdmin }: { client: Client; isAdmin: boolean }) {
  const doneRepairs = (client.repairs ?? []).filter((r) => repairStatus(r) !== "in_progress");
  if (!doneRepairs.length) return null;

  // Group by date key (YYYY-MM)
  const byMonth = new Map<string, Repair[]>();
  doneRepairs
    .slice()
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .forEach((r) => {
      const mk = r.date?.slice(0, 7) ?? "Без даты";
      const arr = byMonth.get(mk) ?? [];
      arr.push(r);
      byMonth.set(mk, arr);
    });

  const MONTH_NAMES_RU = ["Января","Февраля","Марта","Апреля","Мая","Июня","Июля","Августа","Сентября","Октября","Ноября","Декабря"];

  function monthLabel(mk: string): string {
    if (mk === "Без даты") return mk;
    const [y, m] = mk.split("-");
    return `${MONTH_NAMES_RU[parseInt(m) - 1]} ${y}`;
  }

  return (
    <>
      <div className="text-xs font-bold text-[#667085] uppercase tracking-wide mb-2 mt-3">
        История ({doneRepairs.length})
      </div>
      {Array.from(byMonth.entries()).map(([mk, repairs]) => (
        <CollapsibleMonth key={mk} label={monthLabel(mk)} count={repairs.length} isAdmin={isAdmin} client={client} repairs={repairs} />
      ))}
    </>
  );
}

function CollapsibleMonth({ label, count, isAdmin, client, repairs }: {
  label: string; count: number; isAdmin: boolean; client: Client; repairs: Repair[];
}) {
  const [open, setOpen] = useState(false);
  const totalCost = repairs.reduce((s, r) => s + (parseFloat(r.cost ?? "0") || 0), 0);

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 bg-[#F7F9FC] rounded-xl px-3 py-2.5 border border-[#E2E8F0] cursor-pointer text-left"
      >
        <span className={`text-xs transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        <span className="text-sm font-semibold text-[#344054] flex-1">{label}</span>
        <span className="text-xs text-[#98A2B3]">{count} ремонтов</span>
        {totalCost > 0 && isAdmin && (
          <span className="text-xs font-bold text-[#3B6D11]">{totalCost.toLocaleString("ru-RU")} ₽</span>
        )}
      </button>
      {open && (
        <div className="mt-1.5">
          {repairs.map((r) => <RepairCard key={r.id} client={client} repair={r} isAdmin={isAdmin} isHistory />)}
        </div>
      )}
    </div>
  );
}

// ─── Appointments list in client detail ──────────────────────────────────────

function AppointmentsList({ client, isAdmin }: { client: Client; isAdmin: boolean }) {
  const appts = (client.appointments ?? []).slice().sort((a, b) => b.date.localeCompare(a.date));
  if (!appts.length) return null;

  async function deleteAppt(id: string) {
    await updateClientArray(client.id, "appointments", (client.appointments ?? []).filter((a) => a.id !== id));
  }

  return (
    <>
      <div className="text-xs font-bold text-[#667085] uppercase tracking-wide mb-2 mt-3">
        Записи ({appts.length})
      </div>
      {appts.map((a) => (
        <div key={a.id} className="bg-white rounded-xl border border-[#E2E8F0] p-3 mb-1.5 flex items-start justify-between gap-2">
          <div>
            <Badge variant="amber">📅 {fmtDate(a.date)}</Badge>
            {a.description && <div className="text-xs text-[#667085] mt-1">{a.description}</div>}
          </div>
          {isAdmin && (
            <button type="button" onClick={() => void deleteAppt(a.id)}
              className="text-[#98A2B3] text-base cursor-pointer bg-transparent border-none leading-none flex-shrink-0">
              ×
            </button>
          )}
        </div>
      ))}
    </>
  );
}

// ─── Client Detail ────────────────────────────────────────────────────────────

function ClientDetail({ client, onClose }: { client: Client; onClose: () => void }) {
  const { myProfile } = useAuth();
  const role    = myProfile?.role ?? "mechanic";
  const isAdmin = role === "admin" || role === "manager";

  const [showRepair,     setShowRepair]     = useState(false);
  const [showEditClient, setShowEditClient] = useState(false);
  const [showAddAppt,    setShowAddAppt]    = useState(false);
  const [vehicleEdit,    setVehicleEdit]    = useState<Vehicle | null>(null);
  const [showAddVehicle, setShowAddVehicle] = useState(false);

  const activeRepairs = (client.repairs ?? []).filter((r) => repairStatus(r) === "in_progress");

  async function handleDeleteClient() {
    if (!confirm(`Удалить клиента "${client.name}"?`)) return;
    await deleteClient(client.id);
    onClose();
  }

  return (
    <Modal title={client.name} onClose={onClose}>
      {/* Info */}
      <div className="bg-[#F7F9FC] rounded-xl p-3 mb-3 border border-[#E2E8F0]">
        {client.phone && <div className="text-sm mb-1">📞 <a href={`tel:${client.phone}`} className="text-[#185FA5] font-semibold">{client.phone}</a></div>}
        {client.inn          && <div className="text-xs text-[#667085]">ИНН: {client.inn}</div>}
        {client.contactPerson && <div className="text-xs text-[#667085]">Контакт: {client.contactPerson}</div>}
        {client.subscription && (
          <div className="text-xs text-[#3B6D11] font-semibold mt-0.5">
            💰 Абонплата: {client.subscription} ₽/мес
          </div>
        )}
        {client.note && <div className="text-xs text-[#98A2B3] mt-1">{client.note}</div>}
      </div>

      {/* Vehicles */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-bold text-[#667085] uppercase tracking-wide">Авто ({(client.vehicles ?? []).length})</span>
          {isAdmin && <button type="button" onClick={() => setShowAddVehicle(true)} className="text-xs text-[#185FA5] cursor-pointer bg-transparent border-none font-semibold">+ Добавить</button>}
        </div>
        {(client.vehicles ?? []).length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {(client.vehicles ?? []).map((v) => {
              const brandName = v.brand ?? v.model;
              return (
              <button key={v.id} type="button" onClick={() => isAdmin && setVehicleEdit(v)}
                className={`flex items-center gap-1.5 text-xs bg-[#F2F4F7] text-[#344054] px-2.5 py-1 rounded-lg border border-[#E2E8F0] ${isAdmin ? "cursor-pointer hover:bg-[#E6F1FB]" : ""}`}>
                {v.photo && (
                  <img src={v.photo} alt="" className="w-5 h-5 rounded object-cover flex-shrink-0" />
                )}
                <span className="font-mono">{v.plate}</span>
                {brandName && <span className="text-[#98A2B3] font-sans">{brandName}</span>}
                {isAdmin && <span>✏️</span>}
              </button>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-[#98A2B3]">Нет автомобилей</div>
        )}
      </div>

      {/* Toolbar */}
      {isAdmin && (
        <div className="flex gap-2 mb-3 flex-wrap">
          <Button variant="secondary" size="sm" className="flex-1" onClick={() => setShowRepair(true)}>+ Ремонт</Button>
          <Button variant="secondary" size="sm" onClick={() => setShowAddAppt(true)}>📅 Запись</Button>
          <Button variant="ghost"     size="sm" onClick={() => setShowEditClient(true)}>✏️</Button>
        </div>
      )}

      {/* Active repairs */}
      {activeRepairs.length > 0 && (
        <>
          <div className="text-xs font-bold text-[#667085] uppercase tracking-wide mb-2">В работе ({activeRepairs.length})</div>
          {activeRepairs.map((r) => <RepairCard key={r.id} client={client} repair={r} isAdmin={isAdmin} />)}
        </>
      )}

      {/* History grouped by month */}
      <RepairHistory client={client} isAdmin={isAdmin} />

      {/* Appointments */}
      <AppointmentsList client={client} isAdmin={isAdmin} />

      {/* Delete */}
      {isAdmin && (
        <div className="mt-4 pt-3 border-t border-[#E2E8F0]">
          <button type="button" onClick={() => void handleDeleteClient()} className="text-xs text-red-400 cursor-pointer bg-transparent border-none">🗑 Удалить клиента</button>
        </div>
      )}

      {showRepair      && <AddRepairModal      client={client} onClose={() => setShowRepair(false)} />}
      {showEditClient  && <EditClientModal     client={client} onClose={() => setShowEditClient(false)} />}
      {showAddAppt     && <AddAppointmentModal client={client} onClose={() => setShowAddAppt(false)} />}
      {showAddVehicle  && <VehicleModal        client={client} onClose={() => setShowAddVehicle(false)} />}
      {vehicleEdit     && <VehicleModal        client={client} vehicle={vehicleEdit} onClose={() => setVehicleEdit(null)} />}
    </Modal>
  );
}

// ─── Client Card ──────────────────────────────────────────────────────────────

function ClientCard({ client, onClick }: { client: Client; onClick: () => void }) {
  const activeRepairs = (client.repairs ?? []).filter((r) => repairStatus(r) === "in_progress").length;
  const lastDate = (client.repairs ?? []).map((r) => r.date ?? "").filter(Boolean).sort().at(-1);
  const days     = daysAgo(lastDate);

  return (
    <div
      className="bg-white rounded-[18px] border-l-4 border border-[#E2E8F0] p-4 mb-2.5 cursor-pointer shadow-sm active:scale-[.99] transition-all"
      style={{ borderLeftColor: activeRepairs > 0 ? "var(--accent)" : "var(--border)" }}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="font-semibold text-[#172033] text-sm">{client.name}</div>
        {activeRepairs > 0 && <Badge variant="amber">В работе: {activeRepairs}</Badge>}
      </div>
      {client.phone && <div className="text-xs text-[#667085] mb-1">📞 {client.phone}</div>}
      {(client.vehicles ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {(client.vehicles ?? []).slice(0, 3).map((v) => (
            <span key={v.id} className="text-xs bg-[#F2F4F7] px-1.5 py-0.5 rounded font-mono text-[#344054]">
              {v.plate}
              {(v.brand ?? v.model) && <span className="text-[#98A2B3] font-sans ml-1">{v.brand ?? v.model}</span>}
            </span>
          ))}
        </div>
      )}
      {lastDate && (
        <div className="text-[10px] text-[#98A2B3] mt-1.5">
          {days > 60 ? "⚠️ " : ""}{days === 0 ? "Сегодня" : `${days} дн. назад`}
        </div>
      )}
    </div>
  );
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

export function ClientsTab({ type }: { type: ClientType }) {
  const { clients }   = useData();
  const { myProfile } = useAuth();
  const isAdmin = (myProfile?.role ?? "mechanic") !== "mechanic";

  const [search,   setSearch]   = useState("");
  const [showAdd,  setShowAdd]  = useState(false);
  const [selected, setSelected] = useState<Client | null>(null);

  const filtered = useMemo(
    () => clients
      // Поддерживаем оба поля: clientType (старый формат Firebase) и type (новый)
      .filter((c) => (c.clientType ?? c.type ?? "phys") === type)
      .filter((c) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          (c.phone ?? "").includes(q) ||
          (c.vehicles ?? []).some((v) =>
            v.plate.toLowerCase().includes(q) ||
            (v.brand ?? v.model ?? "").toLowerCase().includes(q),
          )
        );
      }),
    [clients, type, search],
  );

  const selectedLive = selected ? (clients.find((c) => c.id === selected.id) ?? selected) : null;
  const title = type === "phys" ? "Клиенты" : "Компании";

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-lg font-bold text-[#172033]">{title}</div>
        {isAdmin && (
          <button type="button" onClick={() => setShowAdd(true)}
            className="text-xs text-[#185FA5] bg-[#E6F1FB] px-3 py-1.5 rounded-xl border border-[#185FA5]/10 cursor-pointer font-semibold">
            + {type === "phys" ? "Клиент" : "Компания"}
          </button>
        )}
      </div>

      <div className="mb-3">
        <Input placeholder="🔍 Поиск по имени, телефону, авто..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-[#98A2B3] text-sm">
          {search ? "Ничего не найдено" : `Нет ${type === "phys" ? "клиентов" : "компаний"}`}
        </div>
      )}

      {filtered.map((c) => <ClientCard key={c.id} client={c} onClick={() => setSelected(c)} />)}

      {showAdd      && <AddClientModal type={type} onClose={() => setShowAdd(false)} />}
      {selectedLive && <ClientDetail client={selectedLive} onClose={() => setSelected(null)} />}
    </div>
  );
}
