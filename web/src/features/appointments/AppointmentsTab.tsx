import { useState, useEffect, useRef, useMemo } from "react";
import { serverTimestamp } from "firebase/firestore";
import { useAuth } from "../auth";
import { useData } from "../../shared/context/DataContext";
import {
  addAppointment,
  updateAppointment,
  addClient,
  updateClient,
} from "../../shared/firebase/firestore";
import { genId } from "../../shared/utils/format";
import { Modal } from "../../shared/ui/Modal";
import type { AppointmentDoc } from "../../shared/types/appointment";
import type { Repair, RepairTask, Vehicle } from "../../shared/types/client";

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

const APPT_TYPES: Record<AppointmentDoc["type"], { label: string; icon: string }> = {
  diagnostics:  { label: "Диагностика",  icon: "🔍" },
  repair:       { label: "Ремонт",       icon: "🔧" },
  consultation: { label: "Консультация", icon: "💬" },
};

// ─── AppointmentCard ──────────────────────────────────────────────────────────

function AppointmentCard({
  appt, myUid, role, onClose, onDelete, onEdit,
}: {
  appt:     AppointmentDoc;
  myUid:    string;
  role:     string;
  onClose:  (a: AppointmentDoc) => void;
  onDelete: (a: AppointmentDoc) => void;
  onEdit:   (a: AppointmentDoc) => void;
}) {
  const isPending  = appt.status === "pending";
  const isMine     = appt.assignees.includes(myUid);
  const canManage  = role === "admin" || role === "owner" || role === "manager";
  const canEdit    = isPending && (canManage || (role === "mechanic" && isMine));
  const showPulse  = isPending && isMine;
  const typeInfo   = APPT_TYPES[appt.type] ?? { label: appt.type, icon: "📋" };

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
      {(canManage || canEdit) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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

function AddAppointmentModal({ onClose }: { onClose: () => void }) {
  const { user, myProfile } = useAuth();
  const { staff } = useData();

  const today = new Date().toISOString().slice(0, 10);
  const [clientName,  setClientName]  = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [carBrand,    setCarBrand]    = useState("");
  const [carModel,    setCarModel]    = useState("");
  const [date,        setDate]        = useState(today);
  const [time,        setTime]        = useState("");
  const [apptType,    setApptType]    = useState<AppointmentDoc["type"]>("diagnostics");
  const [note,        setNote]        = useState("");
  const [selectedMechanics, setSelectedMechanics] = useState<string[]>([]);
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
    if (!clientName.trim()) { setError("Введите ФИО клиента"); return; }
    if (!date)              { setError("Укажите дату"); return; }
    if (!time)              { setError("Укажите время"); return; }

    const assigneeNames = selectedMechanics.map((uid) => {
      const s = staff.find((m) => m.id === uid);
      return s?.name ?? s?.email ?? uid;
    });

    setSaving(true);
    try {
      await addAppointment(clean({
        clientName:    clientName.trim(),
        clientPhone:   clientPhone.trim() || undefined,
        carBrand:      carBrand.trim() || undefined,
        carModel:      carModel.trim() || undefined,
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
            onChange={(e) => setApptType(e.target.value as AppointmentDoc["type"])}
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
  appt:    AppointmentDoc;
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
  const [apptType,    setApptType]    = useState<AppointmentDoc["type"]>(appt.type);
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
      await updateAppointment(appt.id, clean({
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
        updatedAt:     serverTimestamp() as unknown as AppointmentDoc["updatedAt"],
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
            onChange={(e) => setApptType(e.target.value as AppointmentDoc["type"])}
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
  appt:    AppointmentDoc;
  onClose: () => void;
}) {
  const { user, myProfile } = useAuth();
  const [step,   setStep]   = useState<1 | 2>(1);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  const [clientName,       setClientName]       = useState(appt.clientName);
  const [phone,            setPhone]            = useState(appt.clientPhone ?? "");
  const [plate,            setPlate]            = useState("");
  const [createdClientId,  setCreatedClientId]  = useState<string | null>(null);
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
        brand: appt.carBrand || undefined,
        model: appt.carModel || undefined,
      });
      const ref = await addClient(clean({
        name:         clientName.trim(),
        phone:        phone.trim() || undefined,
        clientType:   "phys" as const,
        vehicles:     [vehicle],
        repairs:      [],
        appointments: [],
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
    if (!createdClientId || !createdVehicleId) return;
    setSaving(true);
    try {
      const repairId = genId();
      const today    = new Date().toISOString().slice(0, 10);

      const freonTask: RepairTask = {
        id:          genId(),
        description: "Заправка фреона",
        assignees:   appt.assignees,
        doneBy:      [],
        status:      "in_progress",
        freonTask:   true,
      };
      const repair: Repair = clean({
        id:            repairId,
        vehicleId:     createdVehicleId,
        serviceType:   "refrigerator" as const,
        date:          today,
        status:        "in_progress" as const,
        tasks:         [freonTask],
        mechanics:     appt.assignees,
        createdBy:     user?.uid ?? "",
        createdByName: myProfile?.name ?? user?.email ?? "Неизвестно",
      });

      await updateClient(createdClientId, { repairs: [repair] });
      await updateAppointment(appt.id, {
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
      await updateAppointment(appt.id, clean({
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
      title={`Закрыть запись — Шаг ${step} из 2`}
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
            Клиент создан. Выберите исход записи:
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
  const { appointments }    = useData();

  const [showAdd,      setShowAdd]      = useState(false);
  const [closingAppt,  setClosingAppt]  = useState<AppointmentDoc | null>(null);
  const [editingAppt,  setEditingAppt]  = useState<AppointmentDoc | null>(null);

  const role     = myProfile?.role ?? "mechanic";
  const uid      = user?.uid ?? "";
  const canCreate = role === "admin" || role === "owner" || role === "manager";

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
        .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)),
    [visibleAppts],
  );

  const closed = useMemo(
    () =>
      visibleAppts
        .filter((a) => a.status === "closed")
        .sort((a, b) => b.date.localeCompare(a.date)),
    [visibleAppts],
  );

  async function handleDelete(appt: AppointmentDoc) {
    if (!confirm(`Удалить запись «${appt.clientName}»?`)) return;
    const { deleteAppointment } = await import("../../shared/firebase/firestore");
    await deleteAppointment(appt.id);
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
