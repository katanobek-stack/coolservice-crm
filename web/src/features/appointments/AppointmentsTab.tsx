import { useState, useEffect, useRef, useMemo } from "react";
import { serverTimestamp } from "firebase/firestore";
import { useAuth } from "../auth";
import { useData } from "../../shared/context/DataContext";
import {
  addClient,
} from "../../shared/firebase/firestore";
import {
  createAppointment,
  deleteAppointment,
  updateAppointment,
} from "../../shared/firebase/appointments";
import {
  addClientRepair,
  ensureClientVehicle,
} from "../../shared/firebase/concurrency";
import { genId } from "../../shared/utils/format";
import { Modal } from "../../shared/ui/Modal";
import type { Appointment } from "../../shared/types/appointment";
import type { Client, Repair, RepairTask, Vehicle } from "../../shared/types/client";

// ─── Helper ───────────────────────────────────────────────────────────────────

function clean<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clean) as unknown as T;
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, val]) => val !== undefined)
        .map(([key, val]) => [key, clean(val)]),
    ) as T;
  }
  return v;
}

function fmtApptDate(d: string) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  const months = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  return `${Number(day)} ${months[Number(m) - 1]} ${y}`;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const APPT_TYPES: Record<Appointment["type"], { label: string; icon: string }> = {
  diagnostics:  { label: "Диагностика",  icon: "🔍" },
  repair:       { label: "Ремонт",       icon: "🔧" },
  consultation: { label: "Консультация", icon: "💬" },
};

// ─── AppointmentCard ──────────────────────────────────────────────────────────

function AppointmentCard({
  appt, myUid, role, onClose, onDelete, onEdit, onCreateRepair, creatingRepair,
}: {
  appt:            Appointment;
  myUid:           string;
  role:            string;
  onClose:         (a: Appointment) => void;
  onDelete:        (a: Appointment) => void;
  onEdit:          (a: Appointment) => void;
  onCreateRepair:  (a: Appointment) => void;
  creatingRepair:  string | null;
}) {
  const isPending  = appt.status === "pending";
  const isMine     = appt.assignees.includes(myUid);
  const canManage  = role === "admin" || role === "owner" || role === "manager";
  const canEdit    = isPending && (canManage || (role === "mechanic" && isMine));
  const showPulse  = isPending && isMine;
  const typeInfo   = APPT_TYPES[appt.type] ?? { label: appt.type, icon: "📋" };
  const isCreating = creatingRepair === appt.id;

  return (
    <div style={{
      background: "var(--card)", borderRadius: 12, padding: 16,
      border: "1px solid var(--border)", marginBottom: 10,
      position: "relative",
    }}>
      {/* Pulse dot */}
      {showPulse && (
        <span style={{
          position: "absolute", top: 12, right: 12,
          width: 10, height: 10, borderRadius: "50%",
          background: "var(--accent)",
          animation: "apptPulse 1.5s ease-in-out infinite",
          display: "inline-block",
        }} />
      )}

      {/* Date + time */}
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 3 }}>
        {fmtApptDate(appt.date)}{appt.time ? ` в ${appt.time}` : ""}
      </div>

      {/* Client + car */}
      <div style={{ fontSize: 14, marginBottom: appt.clientPhone ? 3 : 5 }}>
        <span style={{ fontWeight: 600 }}>{appt.clientName}</span>
        {(appt.carBrand || appt.carModel) && (
          <span style={{ color: "var(--text2)", marginLeft: 8 }}>
            · {[appt.carBrand, appt.carModel].filter(Boolean).join(" ")}
          </span>
        )}
      </div>

      {/* Phone */}
      {appt.clientPhone && (
        <div style={{ marginBottom: 5 }}>
          <a
            href={`tel:${appt.clientPhone}`}
            style={{ fontSize: 13, color: "var(--accent2)", textDecoration: "none", fontWeight: 500 }}
          >
            📞 {appt.clientPhone}
          </a>
        </div>
      )}

      {/* Type + outcome badges */}
      <div style={{ marginBottom: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span style={{
          background: "var(--bg2)", borderRadius: 6, padding: "2px 8px",
          fontSize: 12, fontWeight: 600,
        }}>
          {typeInfo.icon} {typeInfo.label}
        </span>
        {!isPending && appt.outcome === "repair" && (
          <span style={{
            background: "#16a34a", borderRadius: 6, padding: "2px 8px",
            fontSize: 12, fontWeight: 600, color: "#fff",
          }}>
            ✅ Ремонт
          </span>
        )}
        {!isPending && appt.outcome === "declined" && (
          <span style={{
            background: "#6b7280", borderRadius: 6, padding: "2px 8px",
            fontSize: 12, fontWeight: 600, color: "#fff",
          }}>
            ❌ Отказался
          </span>
        )}
      </div>

      {/* Assignees */}
      {appt.assigneeNames?.length > 0 && (
        <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 4 }}>
          👨‍🔧 {appt.assigneeNames.join(", ")}
        </div>
      )}

      {/* Note */}
      {appt.note && (
        <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 6, fontStyle: "italic" }}>
          💬 {appt.note}
        </div>
      )}

      {/* Creator + editor */}
      <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: (canManage || canEdit) ? 10 : 0 }}>
        🖊 Создал: {appt.createdByName}
        {appt.updatedByName && (
          <span style={{ display: "block", marginTop: 2 }}>
            ✏️ Изменил: {appt.updatedByName}
          </span>
        )}
      </div>

      {/* Actions */}
      {(canManage || canEdit || (isPending && isMine)) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {isPending && (canManage || isMine) && (
            <button
              type="button"
              onClick={() => onCreateRepair(appt)}
              disabled={isCreating}
              style={{
                background: "#16a34a", color: "#fff", border: "none",
                borderRadius: 8, padding: "6px 14px", fontSize: 13,
                fontWeight: 600, cursor: isCreating ? "default" : "pointer",
                opacity: isCreating ? 0.7 : 1,
                display: "flex", alignItems: "center", gap: 4,
              }}
            >
              {isCreating ? "Создание..." : "🔧 Создать заявку на ремонт"}
            </button>
          )}
          {isPending && canManage && (
            <button
              type="button"
              onClick={() => onClose(appt)}
              style={{
                background: "var(--accent)", color: "#fff", border: "none",
                borderRadius: 8, padding: "6px 14px", fontSize: 13,
                fontWeight: 600, cursor: "pointer",
              }}
            >
              Закрыть запись
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => onEdit(appt)}
              style={{
                background: "var(--bg3)", color: "var(--text2)",
                border: "1px solid var(--border)",
                borderRadius: 8, padding: "6px 12px", fontSize: 13,
                fontWeight: 600, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 4,
              }}
            >
              ✏️ Редактировать
            </button>
          )}
          {canManage && (
            <button
              type="button"
              onClick={() => onDelete(appt)}
              style={{
                background: "transparent", color: "var(--text3)", border: "1px solid var(--border)",
                borderRadius: 8, padding: "6px 10px", fontSize: 12, cursor: "pointer",
              }}
            >
              Удалить
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── AddAppointmentModal ──────────────────────────────────────────────────────

function normalizePhone(p: string) { return p.replace(/\D/g, ""); }
function normalizePlate(p: string) { return p.replace(/\s/g, "").toUpperCase(); }

function AddAppointmentModal({ onClose }: { onClose: () => void }) {
  const { user, myProfile } = useAuth();
  const { staff, clients } = useData();

  const today = new Date().toISOString().slice(0, 10);
  const [clientName,  setClientName]  = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [carBrand,    setCarBrand]    = useState("");
  const [carModel,    setCarModel]    = useState("");
  const [carPlate,    setCarPlate]    = useState("");
  const [clientId,    setClientId]    = useState<string | null>(null);
  const [date,        setDate]        = useState(today);
  const [time,        setTime]        = useState("");
  const [apptType,    setApptType]    = useState<Appointment["type"]>("diagnostics");
  const [note,        setNote]        = useState("");
  const [selectedMechanics, setSelectedMechanics] = useState<string[]>([]);
  const [mechanicsOpen,     setMechanicsOpen]     = useState(false);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const matched = useMemo<{ client: Client; vehicle?: Vehicle } | null>(() => {
    if (clientId) return null;
    const normPhone = normalizePhone(clientPhone);
    const normPlate = normalizePlate(carPlate);
    const phoneOk = normPhone.length >= 4;
    const plateOk = normPlate.length >= 3;
    if (!phoneOk && !plateOk) return null;

    for (const c of clients) {
      if (phoneOk && c.phone) {
        const cp = normalizePhone(c.phone);
        if (cp.length >= 4 && (cp.includes(normPhone) || normPhone.includes(cp))) {
          return { client: c, vehicle: c.vehicles?.[0] };
        }
      }
      if (plateOk && c.vehicles?.length) {
        const v = c.vehicles.find((veh) => {
          const vp = normalizePlate(veh.plate ?? "");
          return vp.length >= 3 && (vp.includes(normPlate) || normPlate.includes(vp));
        });
        if (v) return { client: c, vehicle: v };
      }
    }
    return null;
  }, [clients, clientPhone, carPlate, clientId]);

  function applyMatch(m: { client: Client; vehicle?: Vehicle }) {
    setClientName(m.client.name);
    if (m.client.phone) setClientPhone(m.client.phone);
    const v = m.vehicle ?? m.client.vehicles?.[0];
    if (v) {
      if (v.brand) setCarBrand(v.brand);
      if (v.model) setCarModel(v.model);
      if (v.plate && v.plate !== "—") setCarPlate(v.plate);
    }
    setClientId(m.client.id);
  }

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMechanicsOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function toggleMechanic(uid: string) {
    setSelectedMechanics((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid],
    );
  }

  async function handleSave() {
    setError("");
    if (!clientName.trim()) { setError("Введите ФИО клиента"); return; }
    if (!date)              { setError("Укажите дату"); return; }
    if (!time)              { setError("Укажите время"); return; }

    const assigneeNames = selectedMechanics.map((uid) => {
      const s = staff.find((m) => m.id === uid);
      return s?.name ?? s?.email ?? uid;
    });

    setSaving(true);
    try {
      await createAppointment(clean({
        clientName:    clientName.trim(),
        clientPhone:   clientPhone.trim() || undefined,
        carBrand:      carBrand.trim() || undefined,
        carModel:      carModel.trim() || undefined,
        carPlate:      carPlate.trim() || undefined,
        clientId:      clientId ?? undefined,
        date,
        time,
        type:          apptType,
        assignees:     selectedMechanics,
        assigneeNames,
        status:        "pending" as const,
        note:          note.trim() || undefined,
        createdBy:     user?.uid ?? "",
        createdByName: myProfile?.name ?? user?.email ?? "Неизвестно",
      }));
      onClose();
    } catch (e) {
      setError("Ошибка сохранения");
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  const mechanics = staff.filter((s) => s.name || s.email);

  return (
    <Modal onClose={onClose} title="Новая запись">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

        {/* ФИО */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
            ФИО клиента *
          </label>
          <input
            className="input"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="Иван Петров"
          />
        </div>

        {/* Телефон */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
            Телефон клиента
          </label>
          <input
            type="tel"
            className="input"
            value={clientPhone}
            onChange={(e) => setClientPhone(e.target.value)}
            placeholder="+7 (___) ___-__-__"
          />
        </div>

        {/* Авто */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
              Марка авто
            </label>
            <input
              className="input"
              value={carBrand}
              onChange={(e) => setCarBrand(e.target.value)}
              placeholder="Toyota"
            />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
              Модель
            </label>
            <input
              className="input"
              value={carModel}
              onChange={(e) => setCarModel(e.target.value)}
              placeholder="Hiace"
            />
          </div>
        </div>

        {/* Гос. номер */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
            Гос. номер
          </label>
          <input
            className="input"
            value={carPlate}
            onChange={(e) => setCarPlate(e.target.value)}
            placeholder="А123ВС125"
          />
        </div>

        {/* Подсказка совпадения */}
        {matched && !clientId && (
          <div style={{
            background: "rgba(22,163,74,0.08)", border: "1px solid #16a34a",
            borderRadius: 8, padding: "10px 14px",
            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
          }}>
            <div style={{ fontSize: 13, lineHeight: 1.4 }}>
              <span style={{ color: "#16a34a", fontWeight: 700 }}>✓ Найден клиент: </span>
              <span style={{ fontWeight: 600 }}>{matched.client.name}</span>
              {matched.vehicle && (
                <span style={{ color: "var(--text2)" }}>
                  {" · "}{[matched.vehicle.brand, matched.vehicle.model].filter(Boolean).join(" ")}
                  {matched.vehicle.plate && matched.vehicle.plate !== "—"
                    ? ` (${matched.vehicle.plate})` : ""}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => applyMatch(matched)}
              style={{
                background: "#16a34a", color: "#fff", border: "none",
                borderRadius: 6, padding: "5px 12px", fontSize: 12,
                fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
              }}
            >
              Использовать
            </button>
          </div>
        )}
        {clientId && (
          <div style={{
            background: "rgba(22,163,74,0.06)", border: "1px solid #16a34a",
            borderRadius: 8, padding: "8px 14px",
            display: "flex", justifyContent: "space-between", alignItems: "center",
            fontSize: 12, color: "#16a34a", fontWeight: 600,
          }}>
            <span>✓ Привязан к существующему клиенту</span>
            <button
              type="button"
              onClick={() => setClientId(null)}
              style={{
                background: "transparent", border: "none", color: "#16a34a",
                cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 4px",
              }}
              title="Отвязать"
            >
              ×
            </button>
          </div>
        )}

        {/* Дата + время */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
              Дата *
            </label>
            <input
              type="date"
              className="input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
              Время *
            </label>
            <input
              type="time"
              className="input"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
        </div>

        {/* Тип */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
            Тип записи
          </label>
          <select
            className="input"
            value={apptType}
            onChange={(e) => setApptType(e.target.value as Appointment["type"])}
          >
            <option value="diagnostics">🔍 Диагностика</option>
            <option value="repair">🔧 Ремонт</option>
            <option value="consultation">💬 Консультация</option>
          </select>
        </div>

        {/* Ответственные (multi-select) */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
            Ответственные
          </label>
          <div ref={dropdownRef} style={{ position: "relative" }}>
            <div
              onClick={() => setMechanicsOpen((p) => !p)}
              style={{
                border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px",
                cursor: "pointer", background: "var(--bg2)", minHeight: 38,
                display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6,
              }}
            >
              {selectedMechanics.length === 0 ? (
                <span style={{ color: "var(--text3)", fontSize: 13 }}>Выберите сотрудников...</span>
              ) : (
                selectedMechanics.map((uid) => {
                  const s = staff.find((m) => m.id === uid);
                  return (
                    <span key={uid} style={{
                      background: "var(--accent)", color: "#fff",
                      borderRadius: 6, padding: "2px 8px", fontSize: 12,
                      display: "flex", alignItems: "center", gap: 4,
                    }}>
                      {s?.name ?? s?.email ?? uid}
                      <span
                        style={{ cursor: "pointer", fontWeight: 700 }}
                        onClick={(e) => { e.stopPropagation(); toggleMechanic(uid); }}
                      >
                        ×
                      </span>
                    </span>
                  );
                })
              )}
            </div>
            {mechanicsOpen && (
              <div style={{
                position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
                background: "var(--card)", border: "1px solid var(--border)",
                borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
                zIndex: 100, maxHeight: 200, overflowY: "auto",
              }}>
                {mechanics.map((m) => {
                  const selected = selectedMechanics.includes(m.id);
                  return (
                    <div
                      key={m.id}
                      onClick={() => toggleMechanic(m.id)}
                      style={{
                        padding: "10px 14px", cursor: "pointer", display: "flex",
                        alignItems: "center", gap: 10, fontSize: 14,
                        background: selected ? "var(--accent-alpha, rgba(99,102,241,0.1))" : "transparent",
                      }}
                    >
                      <span style={{ width: 18, textAlign: "center" }}>{selected ? "✓" : ""}</span>
                      {m.name ?? m.email}
                    </div>
                  );
                })}
                <div
                  onClick={() => setMechanicsOpen(false)}
                  style={{
                    padding: "8px 14px", cursor: "pointer", fontWeight: 700,
                    borderTop: "1px solid var(--border)", fontSize: 13,
                    color: "var(--accent)", textAlign: "right",
                  }}
                >
                  Готово ✓
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Примечание */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
            Примечание
          </label>
          <textarea
            className="input"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Доп. информация..."
            style={{ resize: "none" }}
          />
        </div>

        {error && (
          <div style={{ color: "#ef4444", fontSize: 13 }}>{error}</div>
        )}

        <button
          type="button"
          className="btn-primary"
          onClick={() => void handleSave()}
          disabled={saving}
          style={{ alignSelf: "flex-end" }}
        >
          {saving ? "Сохранение..." : "Создать запись"}
        </button>
      </div>
    </Modal>
  );
}

// ─── EditAppointmentModal ─────────────────────────────────────────────────────

function EditAppointmentModal({
  appt, onClose,
}: {
  appt:    Appointment;
  onClose: () => void;
}) {
  const { user, myProfile } = useAuth();
  const { staff } = useData();

  const [clientName,  setClientName]  = useState(appt.clientName);
  const [clientPhone, setClientPhone] = useState(appt.clientPhone ?? "");
  const [carBrand,    setCarBrand]    = useState(appt.carBrand ?? "");
  const [carModel,    setCarModel]    = useState(appt.carModel ?? "");
  const [date,        setDate]        = useState(appt.date);
  const [time,        setTime]        = useState(appt.time);
  const [apptType,    setApptType]    = useState<Appointment["type"]>(appt.type);
  const [note,        setNote]        = useState(appt.note ?? "");
  const [selectedMechanics, setSelectedMechanics] = useState<string[]>(appt.assignees);
  const [mechanicsOpen,     setMechanicsOpen]     = useState(false);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMechanicsOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function toggleMechanic(uid: string) {
    setSelectedMechanics((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid],
    );
  }

  async function handleSave() {
    setError("");
    if (!clientName.trim())        { setError("Введите ФИО клиента"); return; }
    if (!date)                     { setError("Укажите дату"); return; }
    if (!time)                     { setError("Укажите время"); return; }
    if (selectedMechanics.length === 0) { setError("Выберите хотя бы одного ответственного"); return; }

    const assigneeNames = selectedMechanics.map((uid) => {
      const s = staff.find((m) => m.id === uid);
      return s?.name ?? s?.email ?? uid;
    });

    setSaving(true);
    try {
      await updateAppointment(appt, clean({
        clientName:    clientName.trim(),
        clientPhone:   clientPhone.trim() || undefined,
        carBrand:      carBrand.trim() || undefined,
        carModel:      carModel.trim() || undefined,
        date,
        time,
        type:          apptType,
        assignees:     selectedMechanics,
        assigneeNames,
        note:          note.trim() || undefined,
        updatedAt:     serverTimestamp() as unknown as Appointment["updatedAt"],
        updatedBy:     user?.uid ?? "",
        updatedByName: myProfile?.name ?? user?.email ?? "Неизвестно",
      }));
      onClose();
    } catch (e) {
      setError("Ошибка сохранения");
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  const mechanics = staff.filter((s) => s.name || s.email);

  return (
    <Modal onClose={onClose} title="Редактировать запись">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

        {/* ФИО */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
            ФИО клиента *
          </label>
          <input
            className="input"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="Иван Петров"
          />
        </div>

        {/* Телефон */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
            Телефон клиента
          </label>
          <input
            type="tel"
            className="input"
            value={clientPhone}
            onChange={(e) => setClientPhone(e.target.value)}
            placeholder="+7 (___) ___-__-__"
          />
        </div>

        {/* Авто */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
              Марка авто
            </label>
            <input
              className="input"
              value={carBrand}
              onChange={(e) => setCarBrand(e.target.value)}
              placeholder="Toyota"
            />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
              Модель
            </label>
            <input
              className="input"
              value={carModel}
              onChange={(e) => setCarModel(e.target.value)}
              placeholder="Hiace"
            />
          </div>
        </div>

        {/* Дата + время */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
              Дата *
            </label>
            <input
              type="date"
              className="input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
              Время *
            </label>
            <input
              type="time"
              className="input"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
        </div>

        {/* Тип */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
            Тип записи
          </label>
          <select
            className="input"
            value={apptType}
            onChange={(e) => setApptType(e.target.value as Appointment["type"])}
          >
            <option value="diagnostics">🔍 Диагностика</option>
            <option value="repair">🔧 Ремонт</option>
            <option value="consultation">💬 Консультация</option>
          </select>
        </div>

        {/* Ответственные (multi-select) */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
            Ответственные *
          </label>
          <div ref={dropdownRef} style={{ position: "relative" }}>
            <div
              onClick={() => setMechanicsOpen((p) => !p)}
              style={{
                border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px",
                cursor: "pointer", background: "var(--bg2)", minHeight: 38,
                display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6,
              }}
            >
              {selectedMechanics.length === 0 ? (
                <span style={{ color: "var(--text3)", fontSize: 13 }}>Выберите сотрудников...</span>
              ) : (
                selectedMechanics.map((uid) => {
                  const s = staff.find((m) => m.id === uid);
                  return (
                    <span key={uid} style={{
                      background: "var(--accent)", color: "#fff",
                      borderRadius: 6, padding: "2px 8px", fontSize: 12,
                      display: "flex", alignItems: "center", gap: 4,
                    }}>
                      {s?.name ?? s?.email ?? uid}
                      <span
                        style={{ cursor: "pointer", fontWeight: 700 }}
                        onClick={(e) => { e.stopPropagation(); toggleMechanic(uid); }}
                      >
                        ×
                      </span>
                    </span>
                  );
                })
              )}
            </div>
            {mechanicsOpen && (
              <div style={{
                position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
                background: "var(--bg2)", border: "1px solid var(--border)",
                borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
                zIndex: 100, maxHeight: 200, overflowY: "auto",
              }}>
                {mechanics.map((m) => {
                  const selected = selectedMechanics.includes(m.id);
                  return (
                    <div
                      key={m.id}
                      onClick={() => toggleMechanic(m.id)}
                      style={{
                        padding: "10px 14px", cursor: "pointer", display: "flex",
                        alignItems: "center", gap: 10, fontSize: 14,
                        background: selected ? "rgba(59,130,246,0.08)" : "transparent",
                      }}
                    >
                      <span style={{ width: 18, textAlign: "center", color: "var(--accent)" }}>
                        {selected ? "✓" : ""}
                      </span>
                      {m.name ?? m.email}
                    </div>
                  );
                })}
                <div
                  onClick={() => setMechanicsOpen(false)}
                  style={{
                    padding: "8px 14px", cursor: "pointer", fontWeight: 700,
                    borderTop: "1px solid var(--border)", fontSize: 13,
                    color: "var(--accent)", textAlign: "right",
                  }}
                >
                  Готово ✓
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Примечание */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
            Примечание
          </label>
          <textarea
            className="input"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Доп. информация..."
            style={{ resize: "none" }}
          />
        </div>

        {error && (
          <div style={{ color: "#dc2626", fontSize: 13 }}>{error}</div>
        )}

        <button
          type="button"
          className="btn-primary"
          onClick={() => void handleSave()}
          disabled={saving}
          style={{ alignSelf: "flex-end" }}
        >
          {saving ? "Сохранение..." : "Сохранить изменения"}
        </button>
      </div>
    </Modal>
  );
}

// ─── CloseAppointmentModal ────────────────────────────────────────────────────

function CloseAppointmentModal({
  appt, onClose,
}: {
  appt:    Appointment;
  onClose: () => void;
}) {
  const { user, myProfile } = useAuth();
  const { clients } = useData();

  const hasExistingClient = !!appt.clientId;

  const [step,   setStep]   = useState<1 | 2>(hasExistingClient ? 2 : 1);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  const [clientName,       setClientName]       = useState(appt.clientName);
  const [phone,            setPhone]            = useState(appt.clientPhone ?? "");
  const [carBrand,         setCarBrand]         = useState(appt.carBrand ?? "");
  const [carModel,         setCarModel]         = useState(appt.carModel ?? "");
  const [plate,            setPlate]            = useState(appt.carPlate ?? "");
  const [createdClientId,  setCreatedClientId]  = useState<string | null>(appt.clientId ?? null);
  const [createdVehicleId, setCreatedVehicleId] = useState<string | null>(null);

  async function handleNextStep() {
    setError("");
    if (!clientName.trim()) { setError("Введите ФИО"); return; }
    setSaving(true);
    try {
      const vId = genId();
      const vehicle: Vehicle = clean({
        id:    vId,
        plate: plate.trim() || "—",
        brand: carBrand.trim() || undefined,
        model: carModel.trim() || undefined,
      });
      const ref = await addClient(clean({
        name:         clientName.trim(),
        phone:        phone.trim() || undefined,
        clientType:   "phys" as const,
        vehicles:     [vehicle],
        repairs:      [],
      }));
      setCreatedClientId(ref.id);
      setCreatedVehicleId(vId);
      setStep(2);
    } catch (e) {
      setError("Ошибка создания клиента");
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  async function handleRepair() {
    if (!createdClientId) return;
    setSaving(true);
    try {
      let vId = createdVehicleId;

      if (!vId) {
        const existingClient = clients.find((c) => c.id === createdClientId);
        if (existingClient) {
          const matchV = existingClient.vehicles.find(
            (v) =>
              (!carBrand || v.brand === carBrand) &&
              (!carModel || v.model === carModel),
          );
          if (matchV) {
            vId = matchV.id;
          } else {
            const newVehicle = clean<Vehicle>({
              id:    genId(),
              plate: plate.trim() || "—",
              brand: carBrand.trim() || undefined,
              model: carModel.trim() || undefined,
            });
            vId = await ensureClientVehicle(createdClientId, newVehicle, (current) =>
              (!carBrand || current.brand === carBrand) &&
              (!carModel || current.model === carModel));
          }
        }
      }

      if (!vId) { setError("Не удалось определить автомобиль"); setSaving(false); return; }

      const repairId = genId();
      const today    = new Date().toISOString().slice(0, 10);

      const freonTask: RepairTask = {
        id:          genId(),
        description: "Заправка фреона",
        assignees:   appt.assignees,
        doneBy:      [],
        status:      "in_progress",
        freonTask:   true,
        createdBy:     user?.uid ?? "",
        createdByName: myProfile?.name ?? user?.email ?? "Неизвестно",
        createdAt:     new Date().toISOString(),
      };
      const repair: Repair = clean({
        id:            repairId,
        vehicleId:     vId,
        serviceType:   "refrigerator" as const,
        date:          today,
        status:        "in_progress" as const,
        tasks:         [freonTask],
        mechanics:     appt.assignees,
        createdBy:     user?.uid ?? "",
        createdByName: myProfile?.name ?? user?.email ?? "Неизвестно",
        createdAt:     new Date().toISOString(),
      });

      await addClientRepair(createdClientId, repair);
      await updateAppointment(appt, {
        status:   "closed",
        outcome:  "repair",
        clientId: createdClientId,
        repairId,
      });
      onClose();
    } catch (e) {
      setError("Ошибка создания заявки");
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeclined() {
    setSaving(true);
    try {
      await updateAppointment(appt, clean({
        status:   "closed" as const,
        outcome:  "declined" as const,
        clientId: createdClientId ?? undefined,
      }));
      onClose();
    } catch (e) {
      setError("Ошибка");
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      title={hasExistingClient ? "Закрыть запись" : `Закрыть запись — Шаг ${step} из 2`}
    >
      {step === 1 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{
            background: "var(--bg2)", borderRadius: 8, padding: "10px 12px",
            fontSize: 13, color: "var(--text2)",
          }}>
            {appt.clientName} · {[appt.carBrand, appt.carModel].filter(Boolean).join(" ")}
          </div>

          <div>
            <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
              ФИО клиента *
            </label>
            <input
              className="input"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
            />
          </div>

          <div>
            <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
              Телефон
            </label>
            <input
              className="input"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="89147771234"
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
                Марка авто
              </label>
              <input
                className="input"
                value={carBrand}
                onChange={(e) => setCarBrand(e.target.value)}
                placeholder="Toyota"
              />
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
                Модель
              </label>
              <input
                className="input"
                value={carModel}
                onChange={(e) => setCarModel(e.target.value)}
                placeholder="Land Cruiser 200"
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
              Гос. номер (опционально)
            </label>
            <input
              className="input"
              value={plate}
              onChange={(e) => setPlate(e.target.value)}
              placeholder="К123АВ125"
            />
          </div>

          {error && <div style={{ color: "#ef4444", fontSize: 13 }}>{error}</div>}

          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleNextStep()}
            disabled={saving}
            style={{ alignSelf: "flex-end" }}
          >
            {saving ? "Создание..." : "Далее →"}
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 14, color: "var(--text2)" }}>
            {hasExistingClient ? "Выберите исход записи:" : "Клиент создан. Выберите исход записи:"}
          </div>

          <button
            type="button"
            onClick={() => void handleRepair()}
            disabled={saving}
            style={{
              padding: "16px 20px", borderRadius: 12, border: "2px solid #16a34a",
              background: "rgba(22,163,74,0.08)", cursor: "pointer",
              fontSize: 15, fontWeight: 700, color: "#16a34a",
              display: "flex", alignItems: "center", gap: 10,
            }}
          >
            ✅ Создать заявку на ремонт
          </button>

          <button
            type="button"
            onClick={() => void handleDeclined()}
            disabled={saving}
            style={{
              padding: "16px 20px", borderRadius: 12, border: "2px solid #6b7280",
              background: "rgba(107,114,128,0.08)", cursor: "pointer",
              fontSize: 15, fontWeight: 700, color: "#6b7280",
              display: "flex", alignItems: "center", gap: 10,
            }}
          >
            ❌ Клиент отказался
          </button>

          {error && <div style={{ color: "#ef4444", fontSize: 13 }}>{error}</div>}
          {saving && <div style={{ fontSize: 13, color: "var(--text2)" }}>Сохранение...</div>}
        </div>
      )}
    </Modal>
  );
}

// ─── AppointmentsTab ──────────────────────────────────────────────────────────

export function AppointmentsTab() {
  const { myProfile, user } = useAuth();
  const { appointments, clients } = useData();

  const [showAdd,        setShowAdd]        = useState(false);
  const [closingAppt,    setClosingAppt]    = useState<Appointment | null>(null);
  const [editingAppt,    setEditingAppt]    = useState<Appointment | null>(null);
  const [creatingRepair, setCreatingRepair] = useState<string | null>(null);

  const role      = myProfile?.role ?? "mechanic";
  const uid       = user?.uid ?? "";
  const canCreate = role === "admin" || role === "owner" || role === "manager";

  async function handleCreateRepair(appt: Appointment) {
    if (creatingRepair) return;
    setCreatingRepair(appt.id);
    try {
      const today = new Date().toISOString().slice(0, 10);
      let clientId: string | null = appt.clientId ?? null;
      let vehicleId: string = "";

      // Build a Vehicle object without undefined fields
      function makeVehicle(id: string): Vehicle {
        const v: Vehicle = { id, plate: appt.carPlate || "—" };
        if (appt.carBrand) v.brand = appt.carBrand;
        if (appt.carModel) v.model = appt.carModel;
        return v;
      }

      if (clientId) {
        const existingClient = clients.find((c) => c.id === clientId);
        if (existingClient) {
          const matchVehicle = existingClient.vehicles.find(
            (v) =>
              (!appt.carBrand || v.brand === appt.carBrand) &&
              (!appt.carModel || v.model === appt.carModel),
          );
          if (matchVehicle) {
            vehicleId = matchVehicle.id;
          } else {
            vehicleId = await ensureClientVehicle(
              clientId,
              makeVehicle(genId()),
              (current) =>
                (!appt.carBrand || current.brand === appt.carBrand) &&
                (!appt.carModel || current.model === appt.carModel),
            );
          }
        } else {
          clientId = null;
        }
      }

      if (!clientId) {
        vehicleId = genId();
        const newVehicle = makeVehicle(vehicleId);
        const ref = await addClient(clean({
          name:         appt.clientName,
          phone:        appt.clientPhone,
          clientType:   "phys" as const,
          vehicles:     [newVehicle],
          repairs:      [],
        }));
        clientId = ref.id;
      }

      const repairId = genId();
      const freonTask: RepairTask = {
        id:          genId(),
        description: "Заправка фреона",
        assignees:   appt.assignees,
        doneBy:      [],
        status:      "in_progress",
        freonTask:   true,
        createdBy:     user?.uid ?? "",
        createdByName: myProfile?.name ?? user?.email ?? "Неизвестно",
        createdAt:     new Date().toISOString(),
      };
      const repair: Repair = clean({
        id:            repairId,
        vehicleId,
        serviceType:   "refrigerator" as const,
        date:          today,
        status:        "in_progress" as const,
        tasks:         [freonTask],
        mechanics:     appt.assignees,
        createdBy:     user?.uid ?? "",
        createdByName: myProfile?.name ?? user?.email ?? "Неизвестно",
        createdAt:     new Date().toISOString(),
      });

      await addClientRepair(clientId!, repair);

      await updateAppointment(appt, {
        status:   "closed",
        outcome:  "repair",
        clientId: clientId!,
        repairId,
      });
    } catch (e) {
      console.error("[handleCreateRepair]", e);
      alert("Ошибка создания заявки на ремонт");
    } finally {
      setCreatingRepair(null);
    }
  }

  const visibleAppts = useMemo(() => {
    if (role === "mechanic") {
      return appointments.filter((a) => a.assignees.includes(uid));
    }
    return appointments;
  }, [appointments, role, uid]);

  const pending = useMemo(
    () =>
      visibleAppts
        .filter((a) => a.status === "pending")
        .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis()),
    [visibleAppts],
  );

  const closed = useMemo(
    () =>
      visibleAppts
        .filter((a) => a.status === "closed")
        .sort((a, b) => b.date.localeCompare(a.date)),
    [visibleAppts],
  );

  async function handleDelete(appt: Appointment) {
    if (!confirm(`Удалить запись «${appt.clientName}»?`)) return;
    await deleteAppointment(appt);
  }


  return (
    <>
      {/* Pulse animation keyframe */}
      <style>{`
        @keyframes apptPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.35; transform: scale(0.8); }
        }
      `}</style>

      <div style={{ paddingBottom: 80 }}>
        {/* Header */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20,
        }}>
          <div />
          {canCreate && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => setShowAdd(true)}
            >
              <i className="ti ti-plus" /> Новая запись
            </button>
          )}
        </div>

        {/* Pending */}
        <div style={{ marginBottom: 28 }}>
          <div style={{
            fontWeight: 700, fontSize: 13, letterSpacing: "0.06em",
            color: "var(--text3)", marginBottom: 10, textTransform: "uppercase",
          }}>
            Ожидают · {pending.length}
          </div>
          {pending.length === 0 ? (
            <div style={{
              color: "var(--text3)", fontSize: 14, textAlign: "center",
              padding: "32px 0", border: "1px dashed var(--border)", borderRadius: 12,
            }}>
              Нет предстоящих записей
            </div>
          ) : (
            pending.map((a) => (
              <AppointmentCard
                key={a.id}
                appt={a}
                myUid={uid}
                role={role}
                onClose={setClosingAppt}
                onDelete={(appt) => void handleDelete(appt)}
                onEdit={setEditingAppt}
                onCreateRepair={(appt) => void handleCreateRepair(appt)}
                creatingRepair={creatingRepair}
              />
            ))
          )}
        </div>

        {/* Closed */}
        <div>
          <div style={{
            fontWeight: 700, fontSize: 13, letterSpacing: "0.06em",
            color: "var(--text3)", marginBottom: 10, textTransform: "uppercase",
          }}>
            Закрытые · {closed.length}
          </div>
          {closed.length === 0 ? (
            <div style={{ color: "var(--text3)", fontSize: 14 }}>—</div>
          ) : (
            closed.map((a) => (
              <AppointmentCard
                key={a.id}
                appt={a}
                myUid={uid}
                role={role}
                onClose={setClosingAppt}
                onDelete={(appt) => void handleDelete(appt)}
                onEdit={setEditingAppt}
                onCreateRepair={(appt) => void handleCreateRepair(appt)}
                creatingRepair={creatingRepair}
              />
            ))
          )}
        </div>
      </div>

      {showAdd && (
        <AddAppointmentModal onClose={() => setShowAdd(false)} />
      )}
      {closingAppt && (
        <CloseAppointmentModal
          appt={closingAppt}
          onClose={() => setClosingAppt(null)}
        />
      )}
      {editingAppt && (
        <EditAppointmentModal
          appt={editingAppt}
          onClose={() => setEditingAppt(null)}
        />
      )}
    </>
  );
}
