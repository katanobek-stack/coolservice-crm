import { useState, useMemo, useEffect, useRef, type CSSProperties } from "react";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import {
  repairStatus, taskStatus, SERVICE_TYPES, FREON_TYPES,
} from "../../shared/utils/repair";
import { fmtDate, daysAgo, genId } from "../../shared/utils/format";
import { Badge } from "../../shared/ui/Badge";
import { Modal } from "../../shared/ui/Modal";
import { Button } from "../../shared/ui/Button";
import { Input, Textarea, Select, FormGroup } from "../../shared/ui/Input";
import { PhotoGrid, DualPhotoButton } from "../../shared/ui/PhotoUploader";
import { addClient, updateClient, deleteClient, updateClientArray } from "../../shared/firebase/firestore";
import type { Appointment, Client, Repair, RepairTask, ClientType, ServiceType, Vehicle } from "../../shared/types/client";
import { uploadPhoto } from "../../shared/utils/photos";
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
    try {
      // Firestore rejects undefined values — build update without them
      const data: Record<string, unknown> = { name: name.trim() };
      if (phone.trim())   data.phone         = phone.trim();
      if (note.trim())    data.note          = note.trim();
      if (inn.trim())     data.inn           = inn.trim();
      if (contact.trim()) data.contactPerson = contact.trim();
      if (isLegal && sub.trim()) {
        const s = parseFloat(sub);
        if (!isNaN(s)) data.subscription = s;
      }
      await updateClient(client.id, data as Partial<Client>);
      onClose();
    } catch (err) {
      console.error("[EditClientModal] handleSave failed:", err);
      setSaving(false);
    }
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

// ─── Convert to Company Modal ─────────────────────────────────────────────────

function ConvertToCompanyModal({ client, onClose }: { client: Client; onClose: () => void }) {
  const { user } = useAuth();
  const [companyName,  setCompanyName]  = useState("");
  const [inn,          setInn]          = useState(client.inn ?? "");
  const [bankAccount,  setBankAccount]  = useState("");
  const [legalAddress, setLegalAddress] = useState("");
  const [comment,      setComment]      = useState("");
  const [saving,       setSaving]       = useState(false);

  async function handleConvert() {
    if (!companyName.trim()) return;
    setSaving(true);
    try {
      const data: Record<string, unknown> = {
        clientType: "legal",
        name: companyName.trim(),
        companyName: companyName.trim(),
        convertedFrom: "individual",
        convertedAt: new Date().toISOString(),
        convertedBy: user?.uid ?? "",
        previousName: client.name,
      };
      if (inn.trim())          data.inn          = inn.trim();
      if (bankAccount.trim())  data.bankAccount  = bankAccount.trim();
      if (legalAddress.trim()) data.legalAddress = legalAddress.trim();
      if (comment.trim())      data.comment      = comment.trim();
      await updateClient(client.id, data as Partial<Client>);
      onClose();
    } catch (err) {
      console.error("[ConvertToCompanyModal] handleConvert failed:", err);
      setSaving(false);
    }
  }

  return (
    <Modal title="Перевести в юр. лицо" onClose={onClose}>
      <div style={{
        background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.25)",
        borderRadius: 12, padding: "10px 14px", marginBottom: 16,
        fontSize: 12.5, color: "#fcd34d", lineHeight: 1.5,
      }}>
        ⚠️ Все заявки и машины клиента будут сохранены и привязаны к новому юр. лицу
      </div>
      <FormGroup label="Название компании *">
        <Input placeholder="ООО «Пример»" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
      </FormGroup>
      <FormGroup label="ИНН">
        <Input placeholder="1234567890" value={inn} onChange={(e) => setInn(e.target.value)} />
      </FormGroup>
      <FormGroup label="Расчётный счёт">
        <Input placeholder="40702810..." value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} />
      </FormGroup>
      <FormGroup label="Юридический адрес">
        <Input placeholder="г. Владивосток, ул. ..." value={legalAddress} onChange={(e) => setLegalAddress(e.target.value)} />
      </FormGroup>
      <FormGroup label="Комментарий">
        <Textarea placeholder="бывший ИП Иванов С.А." value={comment} onChange={(e) => setComment(e.target.value)} />
      </FormGroup>
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button
          type="button"
          onClick={onClose}
          style={{
            flex: 1, padding: "13px 0", borderRadius: 14,
            background: "var(--bg2)", border: "1px solid var(--border2)",
            color: "var(--text2)", fontSize: 14, fontWeight: 700,
            cursor: "pointer", fontFamily: "Manrope, sans-serif",
          }}
        >
          Отмена
        </button>
        <Button size="lg" onClick={() => void handleConvert()} disabled={saving || !companyName.trim()}>
          {saving ? "..." : "Конвертировать"}
        </Button>
      </div>
    </Modal>
  );
}

// ─── Add Client Modal ─────────────────────────────────────────────────────────

function AddClientModal({ type, onClose }: { type: ClientType; onClose: () => void }) {
  const [name, setName] = useState(""); const [phone, setPhone] = useState("");
  const [note, setNote] = useState(""); const [inn,   setInn]   = useState("");
  const [contact, setContact] = useState(""); const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const data: Record<string, unknown> = {
        name: name.trim(), clientType: type,
        vehicles: [], repairs: [], appointments: [],
      };
      if (phone.trim())   data.phone         = phone.trim();
      if (note.trim())    data.note          = note.trim();
      if (type === "legal" && inn.trim())     data.inn           = inn.trim();
      if (type === "legal" && contact.trim()) data.contactPerson = contact.trim();
      await addClient(data as Omit<Client, "id" | "createdAt">);
      onClose();
    } catch (err) {
      console.error("[AddClientModal] handleSave failed:", err);
      setSaving(false);
    }
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

// ─── Vehicle Types ────────────────────────────────────────────────────────────

const VEHICLE_TYPES = [
  { id: "refrigerator", label: "Рефрижератор", emoji: "🚛" },
  { id: "ac",           label: "Кондиционер",  emoji: "❄️" },
] as const;

function vehicleTypeIcon(serviceType?: string): string {
  if (serviceType === "ac") return "❄️";
  return "🚛";
}

// ─── Vehicle Modal ────────────────────────────────────────────────────────────

function VehicleModal({ client, vehicle, onClose }: { client: Client; vehicle?: Vehicle; onClose: () => void }) {
  const [plate,          setPlate]          = useState(vehicle?.plate ?? "");
  const [brand,          setBrand]          = useState(vehicle?.brand ?? vehicle?.model ?? "");
  const [serviceType,    setServiceType]    = useState(vehicle?.serviceType ?? "refrigerator");
  const [photo,          setPhoto]          = useState(vehicle?.photo ?? "");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [saving,         setSaving]         = useState(false);
  const isEdit = !!vehicle;

  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);

  async function handlePhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const result = await uploadPhoto(file, "vehicles");
      setPhoto(result.url ?? "");
    } catch (err) {
      alert("Ошибка загрузки: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setUploadingPhoto(false);
      e.target.value = "";
    }
  }

  async function handleSave() {
    if (!plate.trim()) return;
    setSaving(true);
    try {
      const norm     = plate.trim().toUpperCase();
      const brandVal = brand.trim() || undefined;
      if (isEdit) {
        await updateClient(client.id, {
          vehicles: (client.vehicles ?? []).map((v): Vehicle => {
            if (v.id !== vehicle.id) return v;
            const upd: Vehicle = { ...v, plate: norm, serviceType };
            if (brandVal) upd.brand = brandVal; else delete upd.brand;
            if (photo)    upd.photo = photo;    else delete upd.photo;
            return upd;
          }),
        });
      } else {
        const newV: Vehicle = { id: genId(), plate: norm, serviceType };
        if (brandVal) newV.brand = brandVal;
        if (photo)    newV.photo = photo;
        await updateClient(client.id, { vehicles: [...(client.vehicles ?? []), newV] });
      }
      onClose();
    } catch (err) {
      console.error("[VehicleModal] handleSave failed:", err);
      setSaving(false);
    }
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

  const btnStyle: CSSProperties = {
    padding: "6px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer",
    border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text2)",
    display: "flex", alignItems: "center", gap: 5,
  };

  return (
    <Modal title={isEdit ? "Редактировать авто" : "Добавить авто"} onClose={onClose}>

      {/* Photo */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
          Фото авто
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {photo ? (
            <div style={{ position: "relative", flexShrink: 0 }}>
              <img src={photo} alt="" style={{ width: 72, height: 72, borderRadius: 10, objectFit: "cover", border: "1px solid var(--border)" }} />
              <button
                type="button"
                onClick={() => setPhoto("")}
                style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: "50%", background: "var(--red)", border: "none", color: "white", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
              >×</button>
            </div>
          ) : (
            <div style={{ width: 72, height: 72, borderRadius: 10, flexShrink: 0, background: "var(--bg3)", border: "1.5px dashed var(--border2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30 }}>
              {vehicleTypeIcon(serviceType)}
            </div>
          )}
          <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoFile} />
          <input ref={galRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoFile} />
          {uploadingPhoto ? (
            <span style={{ fontSize: 12, color: "var(--text3)" }}>⏳ Загрузка...</span>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button type="button" style={btnStyle} onClick={() => camRef.current?.click()}>📷 Камера</button>
              <button type="button" style={btnStyle} onClick={() => galRef.current?.click()}>🖼️ Галерея</button>
            </div>
          )}
        </div>
      </div>

      {/* Service type */}
      <FormGroup label="Тип транспорта">
        <div style={{ display: "flex", gap: 6 }}>
          {VEHICLE_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setServiceType(t.id)}
              style={{
                flex: 1, padding: "8px 4px", borderRadius: 10, cursor: "pointer",
                border: `1.5px solid ${serviceType === t.id ? "var(--accent)" : "var(--border2)"}`,
                background: serviceType === t.id ? "rgba(59,130,246,0.15)" : "transparent",
                color: serviceType === t.id ? "var(--accent2)" : "var(--text2)",
                fontSize: 11, fontWeight: 600,
                display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              }}
            >
              <span style={{ fontSize: 20 }}>{t.emoji}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </FormGroup>

      <FormGroup label="Гос. номер">
        <Input placeholder="А123БВ 125" value={plate} onChange={(e) => setPlate(e.target.value)} style={{ fontFamily: "monospace", fontWeight: 700, textTransform: "uppercase" }} />
      </FormGroup>
      <FormGroup label="Марка / модель">
        <Input placeholder="Toyota Dyna" value={brand} onChange={(e) => setBrand(e.target.value)} />
      </FormGroup>

      <Button size="lg" onClick={() => void handleSave()} disabled={saving || uploadingPhoto}>
        {saving ? "..." : isEdit ? "Сохранить" : "Добавить"}
      </Button>
      {isEdit && (
        <div className="mt-3 pt-3 border-t border-[#E2E8F0]">
          <button type="button" onClick={() => void handleDelete()} className="text-xs text-red-400 cursor-pointer bg-transparent border-none">
            🗑 Удалить авто
          </button>
        </div>
      )}
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

const FREON_BADGES = ["R134a", "R404A", "R410A", "R507", "R22"] as const;

// ─── Add Repair Modal ─────────────────────────────────────────────────────────

function AddRepairModal({ client, preVehicleId, onClose }: { client: Client; preVehicleId?: string; onClose: () => void }) {
  const { staff } = useData();
  const { myProfile } = useAuth();
  const [vehicleId,   setVehicleId]   = useState(preVehicleId ?? client.vehicles[0]?.id ?? "");
  const [newPlate,    setNewPlate]    = useState("");
  const [serviceType, setServiceType] = useState<ServiceType>("refrigerator");
  const [desc,        setDesc]        = useState("");
  const [date,        setDate]        = useState(new Date().toISOString().slice(0, 10));
  const [assignee,    setAssignee]    = useState("");
  const [taskDesc,    setTaskDesc]    = useState("");
  const [saving,      setSaving]      = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      let finalVehicleId = vehicleId;
      let vehicles = client.vehicles ?? [];
      if (!vehicleId && newPlate.trim()) {
        const newV: Vehicle = { id: genId(), plate: newPlate.trim().toUpperCase() };
        vehicles = [...vehicles, newV];
        finalVehicleId = newV.id;
        await updateClient(client.id, { vehicles });
      }
      // Freon-задача создаётся автоматически при каждом новом ремонте
      const tasks: RepairTask[] = [
        { id: genId(), description: "Заправка фреона", assignees: [], doneBy: [], status: "in_progress", freonTask: true },
        ...(taskDesc.trim()
          ? [{ id: genId(), description: taskDesc.trim(), assignees: assignee ? [assignee] : [], doneBy: [], status: "in_progress" as const }]
          : []),
      ];
      // Firestore rejects undefined values — only include defined fields
      const repair: Repair = {
        id: genId(),
        serviceType,
        description: desc.trim(),
        date,
        status: "in_progress",
        photos: [],
        tasks,
        ...(finalVehicleId ? { vehicleId: finalVehicleId } : {}),
      };
      console.log("[AddRepairModal] saving repair:", repair);
      await updateClientArray(client.id, "repairs", [...(client.repairs ?? []), repair]);
      onClose();
    } catch (err) {
      console.error("[AddRepairModal] handleSave failed:", err);
      setSaving(false);
    }
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
              className={`py-2.5 rounded-xl border text-sm font-semibold cursor-pointer transition-all ${serviceType === s.id ? "bg-[#185FA5] text-white border-[#185FA5]" : "bg-transparent text-[var(--text2)] border-[var(--border2)]"}`}>
              {s.emoji} {s.label}
            </button>
          ))}
        </div>
      </FormGroup>
      <FormGroup label="Описание"><Textarea placeholder="Что нужно сделать..." value={desc} onChange={(e) => setDesc(e.target.value)} /></FormGroup>
      <FormGroup label="Дата"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></FormGroup>
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
              className={`py-2 rounded-xl border text-sm font-semibold cursor-pointer transition-all ${serviceType === s.id ? "bg-[#185FA5] text-white border-[#185FA5]" : "bg-transparent text-[var(--text2)] border-[var(--border2)]"}`}>
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

  async function saveFreonType(taskId: string, freonType: string) {
    await updateClientArray(client.id, "repairs",
      (client.repairs ?? []).map((r) =>
        r.id === repair.id
          ? { ...r, tasks: (r.tasks ?? []).map((t) => t.id === taskId ? { ...t, freonType } : t) }
          : r,
      ),
    );
  }

  const borderLeft = status === "done" ? "var(--green)" : isCancelled ? "var(--text3)" : "var(--accent)";

  return (
    <div style={{
      background: "var(--bg2)", borderRadius: 14,
      borderLeft: `3px solid ${borderLeft}`, border: `1px solid var(--border)`,
      borderLeftWidth: 3, borderLeftColor: borderLeft,
      padding: "12px 14px", opacity: isCancelled ? 0.55 : 1,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          <Badge variant="blue">{svc.emoji} {svc.label}</Badge>
          <RepairStatusBadge status={status} />
          {status === "in_progress" && days > 3 && (
            <Badge variant={days > 7 ? "red" : "amber"}>{days} дн.</Badge>
          )}
        </div>
        {isAdmin && (
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            <button type="button" onClick={() => setShowEdit(true)} style={{ fontSize: 11, color: "var(--text2)", background: "var(--bg3)", border: "1px solid var(--border)", padding: "2px 7px", borderRadius: 7, cursor: "pointer" }}>✏️</button>
            {isCancelled ? (
              <button type="button" onClick={() => void setRepairStatus("in_progress")} style={{ fontSize: 11, color: "#fcd34d", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.25)", padding: "2px 7px", borderRadius: 7, cursor: "pointer" }}>↩ Вернуть</button>
            ) : status === "in_progress" ? (
              <>
                <button type="button" onClick={() => void setRepairStatus("done")} style={{ fontSize: 11, color: "#6ee7b7", background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.25)", padding: "2px 7px", borderRadius: 7, cursor: "pointer" }}>Закрыть</button>
                <button type="button" onClick={() => void setRepairStatus("cancelled")} style={{ fontSize: 11, color: "var(--text2)", background: "var(--bg3)", border: "1px solid var(--border)", padding: "2px 7px", borderRadius: 7, cursor: "pointer" }}>Отказ</button>
              </>
            ) : null}
            <button type="button" onClick={() => void handleDelete()} style={{ fontSize: 16, color: "var(--text3)", background: "transparent", border: "none", cursor: "pointer", lineHeight: 1, padding: "0 2px" }}>×</button>
          </div>
        )}
      </div>

      {vehicle && (
        <span style={{ fontSize: 11.5, fontFamily: "monospace", fontWeight: 700, color: "#93c5fd", background: "rgba(59,130,246,0.10)", border: "1px solid rgba(59,130,246,0.20)", padding: "2px 8px", borderRadius: 6, marginRight: 6 }}>{vehicle.plate}</span>
      )}
      {repair.description && <div style={{ fontSize: 13, color: "var(--text)", marginTop: 6 }}>{repair.description}</div>}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
        <span style={{ fontSize: 11, color: "var(--text3)" }}>{fmtDate(repair.date)}</span>
        {repair.cost && isAdmin && <span style={{ fontSize: 13, fontWeight: 700, color: "#4ade80" }}>{repair.cost} ₽</span>}
      </div>

      {(repair.freonType || repair.freonAmount) && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: "#67e8f9", background: "rgba(6,182,212,0.10)", border: "1px solid rgba(6,182,212,0.20)", borderRadius: 8, padding: "4px 10px", display: "inline-block" }}>
          ❄️ {repair.freonType} {repair.freonAmount && `${repair.freonAmount} кг`}
        </div>
      )}

      <PhotoGrid photos={repair.photos ?? []} readOnly onView={setLightbox} />

      {isAdmin && status === "in_progress" && (
        <div style={{ marginTop: 8 }}>
          <DualPhotoButton onUploaded={addPhotos} folder="repairs" />
        </div>
      )}

      {(repair.tasks ?? []).length > 0 && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {(repair.tasks ?? []).map((t) => {
            const ts = taskStatus(t);
            return (
              <div key={t.id} style={{ background: "var(--bg3)", borderRadius: 8, padding: "6px 10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                  <span style={{ color: ts === "done" ? "#4ade80" : "#fbbf24" }}>{ts === "done" ? "✓" : "●"}</span>
                  <span style={{ color: "var(--text)", flex: 1 }}>{t.description}</span>
                  {t.freonType && <span style={{ fontSize: 10, color: "#67e8f9", fontWeight: 700 }}>❄️ {t.freonType}</span>}
                  {t.freonKg   && <span style={{ fontSize: 10, color: "#67e8f9" }}>{t.freonKg} кг</span>}
                  {t.workComment && <span style={{ fontSize: 10, color: "#c4b5fd" }}>📝</span>}
                </div>
                {t.freonTask && ts !== "done" && (
                  <div style={{ display: "flex", gap: 4, marginTop: 5, flexWrap: "wrap" }}>
                    {FREON_BADGES.map((fr) => {
                      const active = t.freonType === fr;
                      return (
                        <button
                          key={fr}
                          type="button"
                          onClick={() => void saveFreonType(t.id, fr)}
                          style={{
                            padding: "2px 8px", borderRadius: 6,
                            fontSize: 10, fontWeight: 700, cursor: "pointer",
                            border: `1px solid ${active ? "#22d3ee" : "var(--border)"}`,
                            background: active ? "rgba(6,182,212,0.2)" : "transparent",
                            color: active ? "#22d3ee" : "var(--text3)",
                            fontFamily: "Manrope, sans-serif",
                          }}
                        >
                          {fr}
                        </button>
                      );
                    })}
                  </div>
                )}
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
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>
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
    <div style={{ marginBottom: 8 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          background: "var(--bg3)", borderRadius: 10, padding: "10px 12px",
          border: "1px solid var(--border)", cursor: "pointer", textAlign: "left",
          fontFamily: "Manrope, sans-serif",
        }}
      >
        <span style={{ fontSize: 10, color: "var(--text3)", transition: "transform 0.2s", display: "inline-block", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", flex: 1 }}>{label}</span>
        <span style={{ fontSize: 11, color: "var(--text3)" }}>{count} ремонтов</span>
        {totalCost > 0 && isAdmin && (
          <span style={{ fontSize: 12, fontWeight: 700, color: "#4ade80" }}>{totalCost.toLocaleString("ru-RU")} ₽</span>
        )}
      </button>
      {open && (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
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
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8, marginTop: 4, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>
        Записи ({appts.length})
      </div>
      {appts.map((a) => (
        <div key={a.id} style={{ background: "var(--bg2)", borderRadius: 10, border: "1px solid var(--border)", padding: "10px 12px", marginBottom: 6, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <div>
            <Badge variant="amber">📅 {fmtDate(a.date)}</Badge>
            {a.description && <div style={{ fontSize: 11.5, color: "var(--text2)", marginTop: 4 }}>{a.description}</div>}
          </div>
          {isAdmin && (
            <button type="button" onClick={() => void deleteAppt(a.id)} style={{ fontSize: 18, color: "var(--text3)", background: "transparent", border: "none", cursor: "pointer", lineHeight: 1, flexShrink: 0, padding: "0 2px" }}>×</button>
          )}
        </div>
      ))}
    </>
  );
}

// ─── Detail section helpers ───────────────────────────────────────────────────

function SectionHeader({ title, count, accent }: { title: string; count?: number; accent?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, paddingBottom: 7, borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: accent ? "var(--accent2)" : "var(--text2)", textTransform: "uppercase" as const, letterSpacing: "0.5px" }}>
        {title}
      </span>
      {count !== undefined && (
        <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text3)", background: "var(--bg)", border: "1px solid var(--border)", padding: "1px 6px", borderRadius: 10 }}>
          {count}
        </span>
      )}
    </div>
  );
}

function VehicleRow({ vehicle, onEdit, onView }: { vehicle: Vehicle; onEdit?: () => void; onView?: () => void }) {
  const [imgError, setImgError] = useState(false);
  const brand = vehicle.brand ?? vehicle.model;
  return (
    <div
      onClick={onView}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 12px", borderRadius: 12,
        background: "var(--bg2)", border: "1px solid var(--border)", marginBottom: 6,
        cursor: onView ? "pointer" : "default",
      }}
    >
      {vehicle.photo && !imgError ? (
        <img src={vehicle.photo} alt="" style={{ width: 42, height: 42, borderRadius: 8, objectFit: "cover", flexShrink: 0, border: "1px solid var(--border)" }} onError={() => setImgError(true)} />
      ) : (
        <span style={{ fontSize: 22, flexShrink: 0 }}>{vehicleTypeIcon(vehicle.serviceType)}</span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontFamily: "monospace", fontWeight: 700, color: "#93c5fd" }}>{vehicle.plate}</div>
        {brand && <div style={{ fontSize: 11.5, color: "var(--text2)", marginTop: 1 }}>{brand}</div>}
      </div>
      {onView && (
        <span style={{ fontSize: 10, color: "var(--text3)", flexShrink: 0 }}>История →</span>
      )}
      {onEdit && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onEdit(); }} style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 9px", cursor: "pointer", fontSize: 13, color: "var(--text2)", flexShrink: 0 }}>
          ✏️
        </button>
      )}
    </div>
  );
}

function VehiclePickerModal({ client, onPick, onClose }: {
  client: Client;
  onPick: (vehicleId: string | undefined) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Выберите автомобиль" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {(client.vehicles ?? []).map((v) => {
          const brand = v.brand ?? v.model;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => onPick(v.id)}
              style={{
                display: "flex", alignItems: "center", gap: 14,
                padding: "13px 16px", borderRadius: 14,
                background: "var(--bg2)", border: "1px solid var(--border2)",
                cursor: "pointer", textAlign: "left", fontFamily: "Manrope, sans-serif",
                transition: "border-color 0.15s, background 0.15s",
              }}
            >
              {v.photo ? (
                <img src={v.photo} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover", flexShrink: 0, border: "1px solid var(--border)" }} />
              ) : (
                <span style={{ fontSize: 24, flexShrink: 0 }}>{vehicleTypeIcon(v.serviceType)}</span>
              )}
              <div>
                <div style={{ fontSize: 16, fontFamily: "monospace", fontWeight: 700, color: "#93c5fd" }}>{v.plate}</div>
                {brand && <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>{brand}</div>}
              </div>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onPick(undefined)}
          style={{
            padding: "12px", borderRadius: 12, background: "transparent",
            border: "1.5px dashed var(--border2)", color: "var(--text3)",
            fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "Manrope, sans-serif",
          }}
        >
          Без привязки к авто
        </button>
        <button
          type="button"
          onClick={onClose}
          style={{
            padding: "12px", borderRadius: 12, background: "var(--bg2)",
            border: "1px solid var(--border)", color: "var(--text2)",
            fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "Manrope, sans-serif",
          }}
        >
          Отмена
        </button>
      </div>
    </Modal>
  );
}

// ─── Vehicle history modal ────────────────────────────────────────────────────

function VehicleHistoryModal({ client, vehicle, onClose }: {
  client:  Client;
  vehicle: Vehicle;
  onClose: () => void;
}) {
  const { staff }     = useData();
  const { myProfile } = useAuth();
  const isAdmin = (myProfile?.role ?? "mechanic") !== "mechanic";
  const brand   = vehicle.brand ?? vehicle.model;

  const repairs = (client.repairs ?? [])
    .filter((r) => r.vehicleId === vehicle.id)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  function getAssigneeNames(repair: Repair): string {
    const uids = new Set<string>();
    (repair.tasks ?? []).forEach((t) => (t.assignees ?? []).forEach((uid) => uids.add(uid)));
    return Array.from(uids)
      .map((uid) => staff.find((s) => s.id === uid)?.name ?? "")
      .filter(Boolean).join(", ");
  }

  function statusInfo(repair: Repair): { label: string; color: string; bg: string } {
    const st = repairStatus(repair);
    if (st === "cancelled")              return { label: "Отказ",     color: "var(--text3)", bg: "var(--bg3)" };
    if (st === "done" && repair.closedByManager) return { label: "Закрыто",   color: "#4ade80",     bg: "rgba(34,197,94,0.15)" };
    if (st === "done")                   return { label: "Выполнено", color: "#4ade80",     bg: "rgba(34,197,94,0.15)" };
    return { label: "В работе", color: "var(--accent2)", bg: "rgba(59,130,246,0.15)" };
  }

  const repairWord = repairs.length === 1 ? "ремонт" : repairs.length < 5 ? "ремонта" : "ремонтов";

  return (
    <Modal title={`${vehicle.plate}${brand ? ` · ${brand}` : ""}`} onClose={onClose}>

      {/* Vehicle photo */}
      {vehicle.photo && (
        <div style={{ marginBottom: 14, borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)" }}>
          <img src={vehicle.photo} alt={vehicle.plate} style={{ width: "100%", maxHeight: 180, objectFit: "cover", display: "block" }} />
        </div>
      )}

      {/* Vehicle summary */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, padding: "10px 12px", background: "var(--bg3)", borderRadius: 12, border: "1px solid var(--border)" }}>
        {!vehicle.photo && <span style={{ fontSize: 24 }}>{vehicleTypeIcon(vehicle.serviceType)}</span>}
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 700, color: "#93c5fd" }}>{vehicle.plate}</div>
          {brand && <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>{brand}</div>}
        </div>
        <div style={{ fontSize: 12, color: "var(--text3)" }}>
          {repairs.length} {repairWord}
        </div>
      </div>

      {/* Repairs */}
      {repairs.length === 0 ? (
        <div style={{ padding: "24px", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
          Ремонтов для этого авто не найдено
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {repairs.map((r) => {
            const names = getAssigneeNames(r);
            const si    = statusInfo(r);
            const cost  = parseFloat(r.cost ?? "0") || 0;
            return (
              <div key={r.id} style={{
                background: "var(--bg2)", border: "1px solid var(--border)",
                borderLeft: `3px solid ${si.color}`, borderRadius: 12, padding: "12px 14px",
              }}>
                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color: "var(--text3)" }}>📅 {fmtDate(r.date)}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: si.bg, color: si.color }}>
                    {si.label}
                  </span>
                  {isAdmin && cost > 0 && (
                    <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color: "#4ade80", fontFamily: "monospace" }}>
                      {cost.toLocaleString("ru-RU")} ₽
                    </span>
                  )}
                </div>

                {r.description && (
                  <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 5 }}>{r.description}</div>
                )}

                {/* Freon — repair level + task level */}
                {(() => {
                  const ft  = r.freonType  || (r.tasks ?? []).find((t) => t.freonTask && t.freonType)?.freonType  || "";
                  const fkg = r.freonAmount || (r.tasks ?? []).find((t) => t.freonTask && t.freonKg)?.freonKg      || "";
                  if (!ft && !fkg) return null;
                  return (
                    <div style={{ fontSize: 11.5, color: "#67e8f9", marginBottom: 5 }}>
                      ❄️ {ft}{fkg ? ` · ${fkg} кг` : ""}
                    </div>
                  );
                })()}

                {names && (
                  <div style={{ fontSize: 11.5, color: "var(--text3)", marginBottom: 6 }}>👨‍🔧 {names}</div>
                )}

                {r.closedAt && (
                  <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>
                    🔒 Закрыто: {fmtDate(r.closedAt)}
                  </div>
                )}

                {/* Task list */}
                {(r.tasks ?? []).length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {(r.tasks ?? []).map((t) => (
                      <div key={t.id} style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12 }}>
                        <span style={{ color: t.status === "done" ? "#4ade80" : "#fbbf24", flexShrink: 0, marginTop: 1 }}>
                          {t.status === "done" ? "✓" : "●"}
                        </span>
                        <span style={{ color: t.status === "done" ? "var(--text3)" : "var(--text)" }}>
                          {t.description}
                          {t.freonType && <span style={{ color: "#67e8f9" }}> · ❄️ {t.freonType}</span>}
                          {t.freonKg   && <span style={{ color: "#67e8f9" }}> {t.freonKg} кг</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Repair photos */}
                {(r.photos ?? []).length > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 4, marginTop: 8 }}>
                    {(r.photos ?? []).map((p) => {
                      const src = p.url ?? p.data ?? "";
                      if (!src) return null;
                      return (
                        <img key={p.id} src={src} alt="" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)", display: "block" }} />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

// ─── Client Detail ────────────────────────────────────────────────────────────

function ClientDetail({ client, onClose }: { client: Client; onClose: () => void }) {
  const { myProfile, isOwner } = useAuth();
  const { staff } = useData();
  const role    = myProfile?.role ?? "mechanic";
  const isAdmin = role === "admin" || role === "manager" || isOwner;

  const [showPickVehicle, setShowPickVehicle] = useState(false);
  const [pickedVehicleId, setPickedVehicleId] = useState<string | undefined>();
  const [showRepair,      setShowRepair]      = useState(false);
  const [showEditClient,  setShowEditClient]  = useState(false);
  const [showAddAppt,     setShowAddAppt]     = useState(false);
  const [vehicleEdit,     setVehicleEdit]     = useState<Vehicle | null>(null);
  const [showAddVehicle,  setShowAddVehicle]  = useState(false);
  const [historyVehicle,  setHistoryVehicle]  = useState<Vehicle | null>(null);
  const [showConvert,     setShowConvert]     = useState(false);

  const isIndividual = (client.clientType ?? client.type ?? "phys") === "phys";
  const convertedByName = client.convertedBy
    ? (staff.find((s) => s.id === client.convertedBy)?.name ?? client.convertedBy)
    : null;

  const activeRepairs = (client.repairs ?? []).filter((r) => repairStatus(r) === "in_progress");
  const vehicles      = client.vehicles ?? [];

  function handleNewRepair() {
    if (vehicles.length === 0) {
      setPickedVehicleId(undefined);
      setShowRepair(true);
    } else {
      setShowPickVehicle(true);
    }
  }

  function handleVehiclePicked(vId: string | undefined) {
    setPickedVehicleId(vId);
    setShowPickVehicle(false);
    setShowRepair(true);
  }

  async function handleDeleteClient() {
    if (!confirm(`Удалить клиента "${client.name}"?`)) return;
    await deleteClient(client.id);
    onClose();
  }

  const sec: CSSProperties = { marginBottom: 20 };

  return (
    <Modal title={client.name} onClose={onClose}>

      {/* ── КОНТАКТЫ ── */}
      <div style={{ background: "var(--bg2)", borderRadius: 14, padding: "12px 14px", marginBottom: 20, border: "1px solid var(--border)" }}>
        {client.phone && (
          <a href={`tel:${client.phone}`} style={{ display: "flex", alignItems: "center", gap: 6, textDecoration: "none", marginBottom: 5 }}>
            <span style={{ fontSize: 13 }}>📞</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--accent2)" }}>{client.phone}</span>
          </a>
        )}
        {client.inn           && <div style={{ fontSize: 11.5, color: "var(--text3)", marginBottom: 3 }}>ИНН: {client.inn}</div>}
        {client.contactPerson && <div style={{ fontSize: 12, color: "var(--text2)" }}>👤 {client.contactPerson}</div>}
        {client.subscription  && <div style={{ fontSize: 12, color: "#4ade80", fontWeight: 600, marginTop: 5 }}>💰 Абонплата: {client.subscription} ₽/мес</div>}
        {client.note          && <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 6, fontStyle: "italic" }}>{client.note}</div>}
        {client.convertedFrom === "individual" && client.previousName && (
          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 6 }}>
            📋 Ранее: физлицо · {client.previousName}
          </div>
        )}
        {client.legalAddress && (
          <div style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 4 }}>📍 {client.legalAddress}</div>
        )}
        {client.bankAccount && (
          <div style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 3 }}>🏦 р/с {client.bankAccount}</div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: isAdmin || (isOwner && isIndividual) ? 10 : 0 }}>
          {isAdmin && (
            <button type="button" onClick={() => setShowEditClient(true)} style={{ fontSize: 11.5, color: "var(--text2)", background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontFamily: "Manrope, sans-serif" }}>
              ✏️ Редактировать
            </button>
          )}
          {isOwner && isIndividual && (
            <button type="button" onClick={() => setShowConvert(true)} style={{ fontSize: 11.5, color: "#c4b5fd", background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.28)", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontFamily: "Manrope, sans-serif" }}>
              🏢 Перевести в юр. лицо
            </button>
          )}
        </div>
      </div>

      {/* ── АВТОМОБИЛИ ── */}
      <div style={sec}>
        <SectionHeader title="Автомобили" count={vehicles.length} />
        {vehicles.map((v) => (
          <VehicleRow key={v.id} vehicle={v} onEdit={isAdmin ? () => setVehicleEdit(v) : undefined} onView={() => setHistoryVehicle(v)} />
        ))}
        {vehicles.length === 0 && !isAdmin && (
          <div style={{ fontSize: 12, color: "var(--text3)", padding: "6px 0" }}>Нет автомобилей</div>
        )}
        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowAddVehicle(true)}
            style={{
              width: "100%", padding: "11px 0", borderRadius: 12,
              border: "1.5px dashed rgba(255,255,255,0.15)",
              background: "transparent", color: "var(--text3)",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
              fontFamily: "Manrope, sans-serif",
              marginTop: vehicles.length > 0 ? 4 : 0,
            }}
          >
            + Добавить авто
          </button>
        )}
      </div>

      {/* ── ДЕЙСТВИЯ ── */}
      {isAdmin && (
        <div style={sec}>
          <SectionHeader title="Действия" />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              type="button"
              onClick={handleNewRepair}
              style={{
                width: "100%", padding: "14px 0", borderRadius: 14,
                background: "var(--accent)", border: "none",
                color: "#fff", fontSize: 14, fontWeight: 700,
                cursor: "pointer", fontFamily: "Manrope, sans-serif",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              <i className="ti ti-tools" style={{ fontSize: 16 }} /> + Новый ремонт
            </button>
            <button
              type="button"
              onClick={() => setShowAddAppt(true)}
              style={{
                width: "100%", padding: "13px 0", borderRadius: 14,
                background: "var(--bg2)", border: "1px solid var(--border2)",
                color: "var(--text)", fontSize: 14, fontWeight: 700,
                cursor: "pointer", fontFamily: "Manrope, sans-serif",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              <i className="ti ti-calendar" style={{ fontSize: 16 }} /> Записать на приём
            </button>
          </div>
        </div>
      )}

      {/* ── В РАБОТЕ ── */}
      {activeRepairs.length > 0 && (
        <div style={sec}>
          <SectionHeader title="В работе" count={activeRepairs.length} accent />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {activeRepairs.map((r) => <RepairCard key={r.id} client={client} repair={r} isAdmin={isAdmin} />)}
          </div>
        </div>
      )}

      {/* ── ИСТОРИЯ ── */}
      <div style={sec}>
        <RepairHistory client={client} isAdmin={isAdmin} />
      </div>

      {/* ── ЗАПИСИ ── */}
      <AppointmentsList client={client} isAdmin={isAdmin} />

      {/* ── ИСТОРИЯ ИЗМЕНЕНИЙ ── */}
      {client.convertedFrom === "individual" && (
        <div style={sec}>
          <SectionHeader title="История изменений" />
          <div style={{ background: "var(--bg2)", borderRadius: 12, border: "1px solid var(--border)", padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 16 }}>🏢</span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>Конвертация из физлица</span>
            </div>
            {client.previousName && (
              <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 4 }}>
                <span style={{ color: "var(--text3)" }}>Ранее: </span>{client.previousName}
              </div>
            )}
            {client.convertedAt && (
              <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 4 }}>
                Дата: {fmtDate(client.convertedAt)}
              </div>
            )}
            {convertedByName && (
              <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 4 }}>
                Кто: {convertedByName}
              </div>
            )}
            {client.comment && (
              <div style={{ fontSize: 12, color: "var(--text3)", fontStyle: "italic" }}>
                {client.comment}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── УДАЛИТЬ ── */}
      {isAdmin && (
        <div style={{ marginTop: 8, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <button type="button" onClick={() => void handleDeleteClient()} style={{ fontSize: 12, color: "var(--red)", background: "transparent", border: "none", cursor: "pointer", fontFamily: "Manrope, sans-serif" }}>
            🗑 Удалить клиента
          </button>
        </div>
      )}

      {showPickVehicle && <VehiclePickerModal client={client} onPick={handleVehiclePicked} onClose={() => setShowPickVehicle(false)} />}
      {showRepair      && <AddRepairModal      client={client} preVehicleId={pickedVehicleId} onClose={() => setShowRepair(false)} />}
      {showEditClient  && <EditClientModal     client={client} onClose={() => setShowEditClient(false)} />}
      {showAddAppt     && <AddAppointmentModal client={client} onClose={() => setShowAddAppt(false)} />}
      {showAddVehicle  && <VehicleModal           client={client} onClose={() => setShowAddVehicle(false)} />}
      {vehicleEdit     && <VehicleModal           client={client} vehicle={vehicleEdit} onClose={() => setVehicleEdit(null)} />}
      {historyVehicle  && <VehicleHistoryModal    client={client} vehicle={historyVehicle} onClose={() => setHistoryVehicle(null)} />}
      {showConvert     && <ConvertToCompanyModal  client={client} onClose={() => setShowConvert(false)} />}
    </Modal>
  );
}

// ─── Client cards ─────────────────────────────────────────────────────────────

const AVATAR_PALETTES = [
  { bg: "rgba(59,130,246,0.20)",  border: "rgba(59,130,246,0.40)",  text: "#93c5fd" },
  { bg: "rgba(16,185,129,0.18)",  border: "rgba(16,185,129,0.38)",  text: "#6ee7b7" },
  { bg: "rgba(245,158,11,0.18)",  border: "rgba(245,158,11,0.38)",  text: "#fcd34d" },
  { bg: "rgba(239,68,68,0.18)",   border: "rgba(239,68,68,0.38)",   text: "#fca5a5" },
  { bg: "rgba(139,92,246,0.18)",  border: "rgba(139,92,246,0.38)",  text: "#c4b5fd" },
  { bg: "rgba(6,182,212,0.18)",   border: "rgba(6,182,212,0.38)",   text: "#67e8f9"  },
  { bg: "rgba(249,115,22,0.18)",  border: "rgba(249,115,22,0.38)",  text: "#fdba74" },
  { bg: "rgba(236,72,153,0.18)",  border: "rgba(236,72,153,0.38)",  text: "#f9a8d4" },
];

function avatarPalette(name: string) {
  const sum = (name || "").split("").reduce((s, c) => s + c.charCodeAt(0), 0);
  return AVATAR_PALETTES[sum % AVATAR_PALETTES.length];
}

function getInitials(name: string): string {
  return (name || "").split(" ").map((w) => w[0] ?? "").join("").toUpperCase().slice(0, 2) || "?";
}

const cardBase: CSSProperties = {
  display: "flex", gap: 12, padding: "12px 14px",
  background: "var(--bg3)", borderRadius: 16,
  cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.22)",
  transition: "background 0.12s",
};

function PhysClientCard({ client, onClick }: { client: Client; onClick: () => void }) {
  const [pressed, setPressed] = useState(false);
  const activeRepairs = (client.repairs ?? []).filter((r) => repairStatus(r) === "in_progress").length;
  const lastDate = (client.repairs ?? []).map((r) => r.date ?? "").filter(Boolean).sort().at(-1);
  const days     = daysAgo(lastDate);
  const palette  = avatarPalette(client.name);
  const vehicles = client.vehicles ?? [];

  return (
    <div
      onClick={onClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={{
        ...cardBase,
        background: pressed ? "var(--bg2)" : "var(--bg3)",
        border: activeRepairs > 0 ? "1px solid rgba(59,130,246,0.22)" : "1px solid var(--border)",
      }}
    >
      {/* Avatar */}
      <div style={{
        width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
        background: palette.bg, border: `1.5px solid ${palette.border}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 14, fontWeight: 800, color: palette.text, marginTop: 1,
      }}>
        {getInitials(client.name)}
      </div>

      {/* Right side */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Name row */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)", lineHeight: 1.3, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {client.name}
          </div>
          {activeRepairs > 0 && (
            <span style={{
              fontSize: 9.5, fontWeight: 700, flexShrink: 0,
              color: "#fbbf24", background: "rgba(251,191,36,0.12)",
              border: "1px solid rgba(251,191,36,0.22)",
              padding: "2px 6px", borderRadius: 6,
            }}>
              В работе: {activeRepairs}
            </span>
          )}
        </div>

        {/* Phone */}
        {client.phone && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3 }}>
            <span style={{ fontSize: 11, color: "var(--text3)" }}>📞</span>
            <span style={{ fontSize: 11.5, color: "var(--text2)" }}>{client.phone}</span>
          </div>
        )}

        {/* Vehicles */}
        {vehicles.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
            {vehicles.slice(0, 3).map((v) => {
              const brand = v.brand ?? v.model;
              return (
                <div key={v.id} style={{
                  display: "flex", alignItems: "center", gap: 4,
                  background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.18)",
                  borderRadius: 8, padding: "2px 7px 2px 3px",
                }}>
                  {v.photo ? (
                    <img src={v.photo} alt="" style={{ width: 22, height: 22, borderRadius: 4, objectFit: "cover", flexShrink: 0 }} />
                  ) : (
                    <span style={{ fontSize: 13, flexShrink: 0 }}>{vehicleTypeIcon(v.serviceType)}</span>
                  )}
                  <span style={{ fontSize: 10.5, fontFamily: "monospace", fontWeight: 700, color: "#93c5fd" }}>{v.plate}</span>
                  {brand && <span style={{ fontSize: 10, color: "var(--text3)" }}>{brand}</span>}
                </div>
              );
            })}
          </div>
        )}

        {/* Last visit */}
        {lastDate && (
          <div style={{ textAlign: "right", marginTop: 5 }}>
            <span style={{ fontSize: 10, color: days > 60 ? "#f59e0b" : "var(--text3)" }}>
              {days === 0 ? "Сегодня" : days === 1 ? "Вчера" : `${days} дн. назад`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function LegalClientCard({ client, onClick }: { client: Client; onClick: () => void }) {
  const [pressed, setPressed] = useState(false);
  const activeRepairs = (client.repairs ?? []).filter((r) => repairStatus(r) === "in_progress").length;

  return (
    <div
      onClick={onClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={{
        ...cardBase,
        background: pressed ? "var(--bg2)" : "var(--bg3)",
        border: activeRepairs > 0 ? "1px solid rgba(139,92,246,0.25)" : "1px solid var(--border)",
      }}
    >
      {/* Building icon */}
      <div style={{
        width: 44, height: 44, borderRadius: 12, flexShrink: 0,
        background: "rgba(139,92,246,0.15)", border: "1.5px solid rgba(139,92,246,0.30)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 20, marginTop: 1,
      }}>
        🏢
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)", lineHeight: 1.3, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {client.name}
          </div>
          {activeRepairs > 0 && (
            <span style={{
              fontSize: 9.5, fontWeight: 700, flexShrink: 0,
              color: "#fbbf24", background: "rgba(251,191,36,0.12)",
              border: "1px solid rgba(251,191,36,0.22)",
              padding: "2px 6px", borderRadius: 6,
            }}>
              В работе: {activeRepairs}
            </span>
          )}
        </div>
        {client.inn && (
          <div style={{ fontSize: 10.5, color: "var(--text3)", marginTop: 2 }}>ИНН: {client.inn}</div>
        )}
        {client.contactPerson && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
            <span style={{ fontSize: 11, color: "var(--text3)" }}>👤</span>
            <span style={{ fontSize: 11.5, color: "var(--text2)" }}>{client.contactPerson}</span>
          </div>
        )}
        {client.phone && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3 }}>
            <span style={{ fontSize: 11, color: "var(--text3)" }}>📞</span>
            <span style={{ fontSize: 11.5, color: "var(--text2)" }}>{client.phone}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ClientCard({ client, onClick }: { client: Client; onClick: () => void }) {
  const isLegal = (client.clientType ?? client.type ?? "phys") === "legal";
  return isLegal
    ? <LegalClientCard client={client} onClick={onClick} />
    : <PhysClientCard  client={client} onClick={onClick} />;
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

export function ClientsTab({ type }: { type: ClientType }) {
  const { clients }   = useData();
  const { myProfile } = useAuth();
  const isAdmin = (myProfile?.role ?? "mechanic") !== "mechanic";

  const [activeType, setActiveType] = useState<ClientType>(type);
  const [search,     setSearch]     = useState("");
  const [showAdd,    setShowAdd]    = useState(false);
  const [selected,   setSelected]   = useState<Client | null>(null);

  // Sync with sidebar navigation (desktop switches phys↔legal via tab state)
  useEffect(() => { setActiveType(type); setSearch(""); }, [type]);

  const filtered = useMemo(
    () => clients
      .filter((c) => (c.clientType ?? c.type ?? "phys") === activeType)
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
    [clients, activeType, search],
  );

  const selectedLive = selected ? (clients.find((c) => c.id === selected.id) ?? selected) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      <div className="crm-section" style={{ animation: "fadeUp 0.45s ease 0.1s both" }}>
        <div className="section-header">
          <i className={`ti ${activeType === "phys" ? "ti-users" : "ti-building"}`} style={{ fontSize: 17, color: "var(--text2)" }} />
          <span className="section-title">{activeType === "phys" ? "Клиенты" : "Компании"}</span>
          <span className="section-count">{filtered.length} записей</span>
          {isAdmin && (
            <div className="section-actions">
              <button className="btn-primary" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => setShowAdd(true)}>
                <i className="ti ti-plus" /> {activeType === "phys" ? "Клиент" : "Компания"}
              </button>
            </div>
          )}
        </div>

        {/* Физ. лица / Компании switcher */}
        <div style={{ padding: "10px 14px 0" }}>
          <div style={{
            display: "flex", background: "var(--bg2)",
            border: "1px solid var(--border)", borderRadius: 12, padding: 3,
          }}>
            {(["phys", "legal"] as ClientType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { setActiveType(t); setSearch(""); }}
                style={{
                  flex: 1, padding: "7px 0", borderRadius: 9, border: "none",
                  cursor: "pointer", fontFamily: "Manrope, sans-serif",
                  fontSize: 12.5, fontWeight: 600, transition: "all 0.15s",
                  background: activeType === t ? "var(--accent)" : "transparent",
                  color: activeType === t ? "#fff" : "var(--text2)",
                }}
              >
                {t === "phys" ? "👤 Физ. лица" : "🏢 Компании"}
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>
          <Input placeholder="Поиск по имени, телефону, авто..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
            {search ? "Ничего не найдено" : `Нет ${activeType === "phys" ? "клиентов" : "компаний"}`}
          </div>
        ) : (
          <div style={{ padding: "8px 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.map((c) => <ClientCard key={c.id} client={c} onClick={() => setSelected(c)} />)}
          </div>
        )}
      </div>

      {showAdd      && <AddClientModal type={activeType} onClose={() => setShowAdd(false)} />}
      {selectedLive && <ClientDetail client={selectedLive} onClose={() => setSelected(null)} />}
    </div>
  );
}
