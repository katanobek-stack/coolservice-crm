import { useState, useMemo } from "react";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import { SERVICE_TYPES } from "../../shared/utils/repair";
import { fmtDate, genId } from "../../shared/utils/format";
import { Badge } from "../../shared/ui/Badge";
import { Modal } from "../../shared/ui/Modal";
import { Button } from "../../shared/ui/Button";
import { Input, Textarea, Select, FormGroup } from "../../shared/ui/Input";
import { updateClientArray } from "../../shared/firebase/firestore";
import type { Appointment, Client, ServiceType } from "../../shared/types/client";

// ─── Add appointment modal ────────────────────────────────────────────────────

function AddAppointmentModal({
  client,
  onClose,
}: {
  client: Client;
  onClose: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate]             = useState(today);
  const [time, setTime]             = useState("");
  const [desc, setDesc]             = useState("");
  const [vehicleId, setVehicleId]   = useState(client.vehicles[0]?.id ?? "");
  const [serviceType, setServiceType] = useState<ServiceType>("refrigerator");
  const [saving, setSaving]         = useState(false);

  async function handleSave() {
    setSaving(true);
    const appt: Appointment = {
      id: genId(),
      date: time ? `${date}T${time}:00` : date,
      description: desc.trim() || undefined,
      ...(vehicleId ? { vehicleId } : {}),
    } as Appointment & { vehicleId?: string; serviceType?: string };

    (appt as Appointment & { serviceType?: string }).serviceType = serviceType;

    const appointments = [...(client.appointments ?? []), appt];
    await updateClientArray(client.id, "appointments", appointments);
    onClose();
  }

  return (
    <Modal title="Новая запись" onClose={onClose}>
      <FormGroup label="Дата">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </FormGroup>
      <FormGroup label="Время">
        <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </FormGroup>
      {(client.vehicles ?? []).length > 0 && (
        <FormGroup label="Автомобиль">
          <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">— не указан —</option>
            {(client.vehicles ?? []).map((v) => (
              <option key={v.id} value={v.id}>{v.plate}</option>
            ))}
          </Select>
        </FormGroup>
      )}
      <FormGroup label="Тип услуги">
        <div className="grid grid-cols-2 gap-2">
          {SERVICE_TYPES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setServiceType(s.id)}
              className={`py-2 rounded-xl border text-sm font-semibold cursor-pointer transition-all
                ${serviceType === s.id ? "bg-[#185FA5] text-white border-[#185FA5]" : "bg-white text-[#667085] border-[#E2E8F0]"}`}
            >
              {s.emoji} {s.label}
            </button>
          ))}
        </div>
      </FormGroup>
      <FormGroup label="Описание">
        <Textarea
          placeholder="Плановое ТО, проверка давления..."
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
        />
      </FormGroup>
      <Button size="lg" onClick={() => void handleSave()} disabled={saving}>
        {saving ? "Сохранение..." : "Создать запись"}
      </Button>
    </Modal>
  );
}

// ─── Add appointment — choose client first ────────────────────────────────────

function AddAppointmentFlow({ onClose }: { onClose: () => void }) {
  const { clients } = useData();
  const [search, setSearch]           = useState("");
  const [selected, setSelected]       = useState<Client | null>(null);

  const filtered = clients.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      (c.phone ?? "").includes(q) ||
      (c.vehicles ?? []).some((v) => v.plate.toLowerCase().includes(q))
    );
  });

  if (selected) {
    return <AddAppointmentModal client={selected} onClose={onClose} />;
  }

  return (
    <Modal title="Выбрать клиента" onClose={onClose}>
      <div className="mb-3">
        <Input
          placeholder="🔍 Поиск..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
      </div>
      <div className="max-h-80 overflow-y-auto space-y-1.5">
        {filtered.slice(0, 30).map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setSelected(c)}
            className="w-full text-left bg-[#F7F9FC] hover:bg-[#E6F1FB] rounded-xl px-3 py-2.5 border border-[#E2E8F0] cursor-pointer transition-all"
          >
            <div className="text-sm font-semibold text-[#172033]">{c.name}</div>
            {c.phone && <div className="text-xs text-[#667085]">{c.phone}</div>}
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-6 text-sm text-[#98A2B3]">Клиент не найден</div>
        )}
      </div>
    </Modal>
  );
}

// ─── Appointment card ─────────────────────────────────────────────────────────

interface ApptWithMeta extends Appointment {
  clientId:   string;
  clientName: string;
  plate?:     string;
  serviceType?: string;
}

function fmtApptDate(dateStr: string): string {
  const d = new Date(dateStr);
  const day  = d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", weekday: "short" });
  const time = dateStr.includes("T")
    ? " " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : "";
  return day + time;
}

function ApptCard({
  appt,
  faded,
  isAdmin,
  onDelete,
}: {
  appt:     ApptWithMeta;
  faded?:   boolean;
  isAdmin:  boolean;
  onDelete: () => void;
}) {
  const svc = SERVICE_TYPES.find((s) => s.id === appt.serviceType) ?? null;

  return (
    <div
      className={`bg-white rounded-[18px] border-l-4 border border-[#E2E8F0] p-3.5 mb-2.5 shadow-sm transition-opacity ${
        faded ? "opacity-50" : ""
      }`}
      style={{ borderLeftColor: faded ? "#E2E8F0" : "#BA7517" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <Badge variant="amber">📅 {fmtApptDate(appt.date)}</Badge>
          <div className="text-sm font-semibold text-[#172033] mt-1.5">{appt.clientName}</div>
          {appt.plate && (
            <span className="text-xs bg-[#F2F4F7] text-[#344054] px-2 py-0.5 rounded font-mono mr-1">
              {appt.plate}
            </span>
          )}
          {svc && <Badge variant="blue">{svc.emoji} {svc.label}</Badge>}
          {appt.description && (
            <div className="text-sm text-[#667085] mt-1">{appt.description}</div>
          )}
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={onDelete}
            className="text-[#98A2B3] hover:text-red-400 cursor-pointer bg-transparent border-none text-lg leading-none flex-shrink-0"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export function CalendarTab() {
  const { clients } = useData();
  const { myProfile } = useAuth();
  const role    = myProfile?.role ?? "mechanic";
  const isAdmin = role === "admin" || role === "manager";

  const [showAdd, setShowAdd] = useState(false);
  const [showPast, setShowPast] = useState(false);

  // Flatten all appointments with client info
  const allAppts = useMemo<ApptWithMeta[]>(() => {
    const result: ApptWithMeta[] = [];
    clients.forEach((c) => {
      (c.appointments ?? []).forEach((a) => {
        const vehicle = (c.vehicles ?? []).find(
          (v) => v.id === (a as Appointment & { vehicleId?: string }).vehicleId,
        );
        result.push({
          ...a,
          clientId:   c.id,
          clientName: c.name,
          plate:      vehicle?.plate,
          serviceType: (a as Appointment & { serviceType?: string }).serviceType,
        });
      });
    });
    // Sort ascending by date
    return result.sort((a, b) => a.date.localeCompare(b.date));
  }, [clients]);

  const todayStr = new Date().toISOString().slice(0, 10);

  const upcoming = allAppts.filter(
    (a) => a.date.slice(0, 10) >= todayStr,
  );
  const past = allAppts.filter(
    (a) => a.date.slice(0, 10) < todayStr,
  ).reverse();

  async function deleteAppt(clientId: string, apptId: string) {
    const client = clients.find((c) => c.id === clientId);
    if (!client) return;
    const appointments = (client.appointments ?? []).filter((a) => a.id !== apptId);
    await updateClientArray(clientId, "appointments", appointments);
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-lg font-bold text-[#172033]">Записи</div>
          <div className="text-xs text-[#667085]">Предстоящие: {upcoming.length}</div>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="text-xs text-[#185FA5] bg-[#E6F1FB] px-3 py-1.5 rounded-xl border border-[#185FA5]/10 cursor-pointer font-semibold"
          >
            + Запись
          </button>
        )}
      </div>

      {allAppts.length === 0 && (
        <div className="text-center py-16 text-[#98A2B3] text-sm">
          Нет записей
        </div>
      )}

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <>
          <div className="text-xs font-bold text-[#667085] uppercase tracking-wide mb-2">
            Предстоящие ({upcoming.length})
          </div>
          {upcoming.map((a) => (
            <ApptCard
              key={a.id}
              appt={a}
              isAdmin={isAdmin}
              onDelete={() => void deleteAppt(a.clientId, a.id)}
            />
          ))}
        </>
      )}

      {/* Past — collapsible */}
      {past.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowPast((p) => !p)}
            className="w-full flex items-center gap-2 text-left bg-[#F7F9FC] border border-[#E2E8F0] rounded-xl px-3 py-2.5 mt-3 mb-2 cursor-pointer"
          >
            <span className={`text-xs transition-transform ${showPast ? "rotate-90" : ""}`}>▶</span>
            <span className="text-sm font-semibold text-[#667085]">
              История записей ({past.length})
            </span>
          </button>
          {showPast &&
            past.map((a) => (
              <ApptCard
                key={a.id}
                appt={a}
                faded
                isAdmin={isAdmin}
                onDelete={() => void deleteAppt(a.clientId, a.id)}
              />
            ))}
        </>
      )}

      {showAdd && <AddAppointmentFlow onClose={() => setShowAdd(false)} />}
    </div>
  );
}
