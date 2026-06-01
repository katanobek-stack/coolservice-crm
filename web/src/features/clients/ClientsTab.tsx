import { useState, useMemo } from "react";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import {
  repairStatus,
  taskStatus,
  getAssignees,
  SERVICE_TYPES,
  FREON_TYPES,
} from "../../shared/utils/repair";
import { fmtDate, daysAgo, genId } from "../../shared/utils/format";
import { Badge } from "../../shared/ui/Badge";
import { Modal } from "../../shared/ui/Modal";
import { Button } from "../../shared/ui/Button";
import { Input, Textarea, Select, FormGroup } from "../../shared/ui/Input";
import {
  addClient,
  updateClient,
  deleteClient,
  updateClientArray,
} from "../../shared/firebase/firestore";
import type {
  Client,
  Repair,
  RepairTask,
  ClientType,
  ServiceType,
  Vehicle,
} from "../../shared/types/client";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function RepairStatusBadge({ status }: { status: ReturnType<typeof repairStatus> }) {
  if (status === "done")      return <Badge variant="green">Готово</Badge>;
  if (status === "cancelled") return <Badge variant="gray">Отказ</Badge>;
  return <Badge variant="amber">В работе</Badge>;
}

// ─── Edit Client Modal ────────────────────────────────────────────────────────

function EditClientModal({
  client,
  onClose,
}: {
  client: Client;
  onClose: () => void;
}) {
  const [name, setName] = useState(client.name);
  const [phone, setPhone] = useState(client.phone ?? "");
  const [note, setNote] = useState(client.note ?? "");
  const [inn, setInn] = useState(client.inn ?? "");
  const [contact, setContact] = useState(client.contactPerson ?? "");
  const [subscription, setSubscription] = useState(
    (client as Client & { subscription?: string }).subscription ?? "",
  );
  const [saving, setSaving] = useState(false);
  const isLegal = (client.type ?? "phys") === "legal";

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    await updateClient(client.id, {
      name: name.trim(),
      phone: phone.trim() || undefined,
      note: note.trim() || undefined,
      inn: inn.trim() || undefined,
      contactPerson: contact.trim() || undefined,
      ...(isLegal && subscription ? { subscription: subscription.trim() } : {}),
    });
    onClose();
  }

  return (
    <Modal title="Редактировать клиента" onClose={onClose}>
      <FormGroup label="Название / ФИО">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </FormGroup>
      <FormGroup label="Телефон">
        <Input type="tel" placeholder="+7 924 000 00 00" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </FormGroup>
      {isLegal && (
        <>
          <FormGroup label="ИНН">
            <Input placeholder="1234567890" value={inn} onChange={(e) => setInn(e.target.value)} />
          </FormGroup>
          <FormGroup label="Контактное лицо">
            <Input placeholder="Директор Петров" value={contact} onChange={(e) => setContact(e.target.value)} />
          </FormGroup>
          <FormGroup label="Абонплата (₽/мес)">
            <Input type="number" placeholder="0" value={subscription} onChange={(e) => setSubscription(e.target.value)} />
          </FormGroup>
        </>
      )}
      <FormGroup label="Примечание">
        <Textarea placeholder="..." value={note} onChange={(e) => setNote(e.target.value)} />
      </FormGroup>
      <Button size="lg" onClick={() => void handleSave()} disabled={saving}>
        {saving ? "Сохранение..." : "Сохранить"}
      </Button>
    </Modal>
  );
}

// ─── Add Client Modal ─────────────────────────────────────────────────────────

function AddClientModal({ type, onClose }: { type: ClientType; onClose: () => void }) {
  const [name, setName]       = useState("");
  const [phone, setPhone]     = useState("");
  const [note, setNote]       = useState("");
  const [inn, setInn]         = useState("");
  const [contact, setContact] = useState("");
  const [saving, setSaving]   = useState(false);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    await addClient({
      name: name.trim(),
      type,
      phone: phone.trim() || undefined,
      note: note.trim() || undefined,
      inn: type === "legal" ? inn.trim() || undefined : undefined,
      contactPerson: type === "legal" ? contact.trim() || undefined : undefined,
      vehicles: [],
      repairs: [],
      appointments: [],
    });
    onClose();
  }

  return (
    <Modal title={type === "phys" ? "Новый клиент" : "Новая компания"} onClose={onClose}>
      <FormGroup label="Название / ФИО">
        <Input
          placeholder={type === "phys" ? "Иван Иванов" : "ООО «Пример»"}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </FormGroup>
      <FormGroup label="Телефон">
        <Input type="tel" placeholder="+7 924 000 00 00" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </FormGroup>
      {type === "legal" && (
        <>
          <FormGroup label="ИНН">
            <Input placeholder="1234567890" value={inn} onChange={(e) => setInn(e.target.value)} />
          </FormGroup>
          <FormGroup label="Контактное лицо">
            <Input placeholder="Директор Петров" value={contact} onChange={(e) => setContact(e.target.value)} />
          </FormGroup>
        </>
      )}
      <FormGroup label="Примечание">
        <Textarea placeholder="..." value={note} onChange={(e) => setNote(e.target.value)} />
      </FormGroup>
      <Button size="lg" onClick={() => void handleSave()} disabled={saving}>
        {saving ? "Сохранение..." : "Создать"}
      </Button>
    </Modal>
  );
}

// ─── Add Repair Modal ─────────────────────────────────────────────────────────

function AddRepairModal({ client, onClose }: { client: Client; onClose: () => void }) {
  const { staff } = useData();
  const { myProfile } = useAuth();
  const role = myProfile?.role ?? "mechanic";
  const isAdmin = role === "admin" || role === "manager";

  const [vehicleId, setVehicleId]   = useState(client.vehicles[0]?.id ?? "");
  const [newPlate, setNewPlate]     = useState("");
  const [serviceType, setServiceType] = useState<ServiceType>("refrigerator");
  const [desc, setDesc]             = useState("");
  const [date, setDate]             = useState(new Date().toISOString().slice(0, 10));
  const [cost, setCost]             = useState("");
  const [freonType, setFreonType]   = useState("");
  const [freonAmt, setFreonAmt]     = useState("");
  const [assignee, setAssignee]     = useState("");
  const [taskDesc, setTaskDesc]     = useState("");
  const [saving, setSaving]         = useState(false);

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
      id: genId(),
      vehicleId: finalVehicleId || undefined,
      serviceType,
      description: desc.trim(),
      date,
      cost: isAdmin && cost.trim() ? cost.trim() : undefined,
      status: "in_progress",
      freonType: freonType || undefined,
      freonAmount: freonAmt.trim() || undefined,
      photos: [],
      tasks,
    };

    const repairs = [...(client.repairs ?? []), repair];
    await updateClientArray(client.id, "repairs", repairs);
    onClose();
  }

  return (
    <Modal title="Новый ремонт" onClose={onClose}>
      <FormGroup label="Автомобиль">
        <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
          <option value="">— новый авто —</option>
          {(client.vehicles ?? []).map((v) => (
            <option key={v.id} value={v.id}>{v.plate}{v.model ? ` · ${v.model}` : ""}</option>
          ))}
        </Select>
      </FormGroup>
      {!vehicleId && (
        <FormGroup label="Номер нового авто">
          <Input placeholder="А123БВ 125" value={newPlate} onChange={(e) => setNewPlate(e.target.value)} />
        </FormGroup>
      )}
      <FormGroup label="Тип услуги">
        <div className="grid grid-cols-2 gap-2">
          {SERVICE_TYPES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setServiceType(s.id)}
              className={`py-2.5 rounded-xl border text-sm font-semibold cursor-pointer transition-all
                ${serviceType === s.id ? "bg-[#185FA5] text-white border-[#185FA5]" : "bg-white text-[#667085] border-[#E2E8F0]"}`}
            >
              {s.emoji} {s.label}
            </button>
          ))}
        </div>
      </FormGroup>
      <FormGroup label="Описание работ">
        <Textarea placeholder="Что нужно сделать..." value={desc} onChange={(e) => setDesc(e.target.value)} />
      </FormGroup>
      <FormGroup label="Дата">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </FormGroup>
      {isAdmin && (
        <FormGroup label="Стоимость (₽)">
          <Input type="number" placeholder="0" value={cost} onChange={(e) => setCost(e.target.value)} />
        </FormGroup>
      )}
      <FormGroup label="Фреон">
        <div className="flex gap-2">
          <Select value={freonType} onChange={(e) => setFreonType(e.target.value)}>
            {FREON_TYPES.map((f) => <option key={f} value={f}>{f || "— не указан —"}</option>)}
          </Select>
          <Input placeholder="кг" value={freonAmt} onChange={(e) => setFreonAmt(e.target.value)} className="w-24" />
        </div>
      </FormGroup>
      <FormGroup label="Задача механику">
        <Textarea placeholder="Задача (необязательно)" value={taskDesc} onChange={(e) => setTaskDesc(e.target.value)} />
      </FormGroup>
      {taskDesc.trim() && (
        <FormGroup label="Назначить">
          <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">— не назначен —</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.name ?? s.email}</option>
            ))}
          </Select>
        </FormGroup>
      )}
      <Button size="lg" onClick={() => void handleSave()} disabled={saving}>
        {saving ? "Сохранение..." : "Создать заявку"}
      </Button>
    </Modal>
  );
}

// ─── Repair Card ──────────────────────────────────────────────────────────────

function RepairCard({
  client,
  repair,
  isAdmin,
  isHistory,
}: {
  client: Client;
  repair: Repair;
  isAdmin: boolean;
  isHistory?: boolean;
}) {
  const vehicle = (client.vehicles ?? []).find((v) => v.id === repair.vehicleId);
  const status  = repairStatus(repair);
  const svc     = SERVICE_TYPES.find((s) => s.id === repair.serviceType) ?? SERVICE_TYPES[3];
  const days    = daysAgo(repair.date);
  const isCancelled = status === "cancelled";

  async function setRepairStatus(newStatus: "in_progress" | "cancelled" | "done") {
    const updates: Partial<Repair> =
      newStatus === "done"
        ? { closedByManager: true, status: "in_progress" }
        : newStatus === "cancelled"
        ? { status: "cancelled", closedByManager: false }
        : { status: "in_progress", closedByManager: false };

    const repairs = (client.repairs ?? []).map((r) =>
      r.id === repair.id ? { ...r, ...updates } : r,
    );
    await updateClientArray(client.id, "repairs", repairs);
  }

  async function handleDelete() {
    if (!confirm("Удалить заказ-наряд?")) return;
    const repairs = (client.repairs ?? []).filter((r) => r.id !== repair.id);
    await updateClientArray(client.id, "repairs", repairs);
  }

  return (
    <div
      className={`bg-white rounded-[16px] border-l-4 border border-[#E2E8F0] p-3.5 mb-2.5 shadow-sm ${
        isCancelled ? "opacity-50" : ""
      }`}
      style={{
        borderLeftColor:
          status === "done" ? "#3B6D11" : isCancelled ? "#98A2B3" : "#185FA5",
      }}
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

        {/* Actions */}
        {isAdmin && (
          <div className="flex gap-1 flex-shrink-0">
            {isCancelled ? (
              <button
                type="button"
                onClick={() => void setRepairStatus("in_progress")}
                className="text-[10px] text-[#BA7517] bg-[#FAEEDA] px-2 py-0.5 rounded-lg cursor-pointer border-none"
              >
                ↩ Вернуть
              </button>
            ) : status === "in_progress" ? (
              <>
                <button
                  type="button"
                  onClick={() => void setRepairStatus("done")}
                  className="text-[10px] text-[#3B6D11] bg-[#EAF3DE] px-2 py-0.5 rounded-lg cursor-pointer border-none"
                >
                  Закрыть
                </button>
                <button
                  type="button"
                  onClick={() => void setRepairStatus("cancelled")}
                  className="text-[10px] text-[#667085] bg-[#F2F4F7] px-2 py-0.5 rounded-lg cursor-pointer border-none"
                >
                  Отказ
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={handleDelete}
              className="text-[#98A2B3] cursor-pointer bg-transparent border-none text-base leading-none"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {vehicle && (
        <span className="text-xs bg-[#F2F4F7] text-[#344054] px-2 py-0.5 rounded font-mono mr-1">
          {vehicle.plate}
        </span>
      )}
      {repair.description && (
        <div className="text-sm text-[#344054] mt-1">{repair.description}</div>
      )}

      <div className="flex items-center justify-between mt-1.5">
        <span className="text-xs text-[#98A2B3]">{fmtDate(repair.date)}</span>
        {repair.cost && isAdmin && (
          <span className="text-sm font-bold text-[#3B6D11]">{repair.cost} ₽</span>
        )}
      </div>

      {(repair.freonType || repair.freonAmount) && (
        <div className="mt-1.5 text-xs text-cyan-600 bg-cyan-50 rounded-lg px-2 py-1 border border-cyan-100 inline-block">
          ❄️ {repair.freonType} {repair.freonAmount && `${repair.freonAmount} кг`}
        </div>
      )}

      {/* Tasks */}
      {(repair.tasks ?? []).length > 0 && (
        <div className="mt-2 space-y-1">
          {(repair.tasks ?? []).map((t) => {
            const ts = taskStatus(t);
            return (
              <div key={t.id} className="flex items-center gap-2 text-xs bg-[#F7F9FC] rounded-lg px-2.5 py-1.5">
                <span className={ts === "done" ? "text-[#3B6D11]" : "text-[#BA7517]"}>
                  {ts === "done" ? "✓" : "●"}
                </span>
                <span className="text-[#344054] flex-1">{t.description}</span>
                {t.workComment && (
                  <span className="text-purple-400 text-[10px]">📝</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Client Detail ────────────────────────────────────────────────────────────

function ClientDetail({ client, onClose }: { client: Client; onClose: () => void }) {
  const { myProfile } = useAuth();
  const role    = myProfile?.role ?? "mechanic";
  const isAdmin = role === "admin" || role === "manager";

  const [showRepair,     setShowRepair]     = useState(false);
  const [showEditClient, setShowEditClient] = useState(false);

  async function handleDeleteClient() {
    if (!confirm(`Удалить клиента "${client.name}"?`)) return;
    await deleteClient(client.id);
    onClose();
  }

  const activeRepairs = (client.repairs ?? []).filter((r) => repairStatus(r) === "in_progress");
  const doneRepairs   = (client.repairs ?? []).filter((r) => repairStatus(r) !== "in_progress");

  return (
    <Modal title={client.name} onClose={onClose}>
      {/* Info block */}
      <div className="bg-[#F7F9FC] rounded-xl p-3 mb-3 border border-[#E2E8F0]">
        {client.phone && (
          <div className="text-sm mb-1">
            📞{" "}
            <a href={`tel:${client.phone}`} className="text-[#185FA5] font-semibold">
              {client.phone}
            </a>
          </div>
        )}
        {client.inn         && <div className="text-xs text-[#667085]">ИНН: {client.inn}</div>}
        {client.contactPerson && <div className="text-xs text-[#667085]">Контакт: {client.contactPerson}</div>}
        {(client as Client & { subscription?: string }).subscription && (
          <div className="text-xs text-[#3B6D11] font-semibold mt-0.5">
            💰 Абонплата: {(client as Client & { subscription?: string }).subscription} ₽/мес
          </div>
        )}
        {client.note && <div className="text-xs text-[#98A2B3] mt-1">{client.note}</div>}
      </div>

      {/* Vehicles */}
      {(client.vehicles ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {(client.vehicles ?? []).map((v) => (
            <span key={v.id} className="text-xs bg-[#F2F4F7] text-[#344054] px-2.5 py-1 rounded-lg font-mono border border-[#E2E8F0]">
              {v.plate}
              {v.model && <span className="text-[#98A2B3] ml-1 font-sans">{v.model}</span>}
            </span>
          ))}
        </div>
      )}

      {/* Toolbar */}
      {isAdmin && (
        <div className="flex gap-2 mb-3">
          <Button variant="secondary" size="sm" className="flex-1" onClick={() => setShowRepair(true)}>
            + Ремонт
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowEditClient(true)}>
            ✏️ Изменить
          </Button>
        </div>
      )}

      {/* Active repairs */}
      {activeRepairs.length > 0 && (
        <>
          <div className="text-xs font-bold text-[#667085] uppercase tracking-wide mb-2">
            В работе ({activeRepairs.length})
          </div>
          {activeRepairs.map((r) => (
            <RepairCard key={r.id} client={client} repair={r} isAdmin={isAdmin} />
          ))}
        </>
      )}

      {/* History */}
      {doneRepairs.length > 0 && (
        <>
          <div className="text-xs font-bold text-[#667085] uppercase tracking-wide mb-2 mt-3">
            История ({doneRepairs.length})
          </div>
          {doneRepairs.map((r) => (
            <RepairCard key={r.id} client={client} repair={r} isAdmin={isAdmin} isHistory />
          ))}
        </>
      )}

      {/* Delete client */}
      {isAdmin && (
        <div className="mt-4 pt-3 border-t border-[#E2E8F0]">
          <button
            type="button"
            onClick={() => void handleDeleteClient()}
            className="text-xs text-red-400 cursor-pointer bg-transparent border-none"
          >
            🗑 Удалить клиента
          </button>
        </div>
      )}

      {showRepair     && <AddRepairModal     client={client} onClose={() => setShowRepair(false)} />}
      {showEditClient && <EditClientModal    client={client} onClose={() => setShowEditClient(false)} />}
    </Modal>
  );
}

// ─── Client Card (list item) ──────────────────────────────────────────────────

function ClientCard({ client, onClick }: { client: Client; onClick: () => void }) {
  const activeRepairs = (client.repairs ?? []).filter(
    (r) => repairStatus(r) === "in_progress",
  ).length;

  const lastDate = (client.repairs ?? [])
    .map((r) => r.date ?? "")
    .filter(Boolean)
    .sort()
    .at(-1);

  const days = daysAgo(lastDate);

  return (
    <div
      className="bg-white rounded-[18px] border-l-4 border border-[#E2E8F0] p-4 mb-2.5 cursor-pointer shadow-sm active:scale-[.99] transition-all"
      style={{ borderLeftColor: activeRepairs > 0 ? "#185FA5" : "#E2E8F0" }}
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
            </span>
          ))}
        </div>
      )}
      {lastDate && (
        <div className="text-[10px] text-[#98A2B3] mt-1.5">
          {days > 60 ? "⚠️ " : ""}
          {days === 0 ? "Сегодня" : `${days} дн. назад`}
        </div>
      )}
    </div>
  );
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

export function ClientsTab({ type }: { type: ClientType }) {
  const { clients } = useData();
  const { myProfile } = useAuth();
  const role    = myProfile?.role ?? "mechanic";
  const isAdmin = role === "admin" || role === "manager";

  const [search,   setSearch]   = useState("");
  const [showAdd,  setShowAdd]  = useState(false);
  const [selected, setSelected] = useState<Client | null>(null);

  const filtered = useMemo(
    () =>
      clients
        .filter((c) => (c.type ?? "phys") === type)
        .filter((c) => {
          if (!search.trim()) return true;
          const q = search.toLowerCase();
          return (
            c.name.toLowerCase().includes(q) ||
            (c.phone ?? "").includes(q) ||
            (c.vehicles ?? []).some((v) => v.plate.toLowerCase().includes(q))
          );
        }),
    [clients, type, search],
  );

  // Keep selected in sync when Firestore updates arrive
  const selectedLive = selected
    ? (clients.find((c) => c.id === selected.id) ?? selected)
    : null;

  const title = type === "phys" ? "Клиенты" : "Компании";

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-lg font-bold text-[#172033]">{title}</div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="text-xs text-[#185FA5] bg-[#E6F1FB] px-3 py-1.5 rounded-xl border border-[#185FA5]/10 cursor-pointer font-semibold"
          >
            + {type === "phys" ? "Клиент" : "Компания"}
          </button>
        )}
      </div>

      <div className="mb-3">
        <Input
          placeholder="🔍 Поиск по имени, телефону, авто..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-[#98A2B3] text-sm">
          {search ? "Ничего не найдено" : `Нет ${type === "phys" ? "клиентов" : "компаний"}`}
        </div>
      )}

      {filtered.map((c) => (
        <ClientCard key={c.id} client={c} onClick={() => setSelected(c)} />
      ))}

      {showAdd && <AddClientModal type={type} onClose={() => setShowAdd(false)} />}
      {selectedLive && (
        <ClientDetail client={selectedLive} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
