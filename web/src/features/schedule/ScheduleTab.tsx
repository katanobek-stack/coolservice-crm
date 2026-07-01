import { useState, useMemo, useEffect } from "react";
import {
  collection,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { getFirebaseDb } from "../../shared/firebase/app";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import { Modal } from "../../shared/ui/Modal";
import { Button } from "../../shared/ui/Button";
import { Textarea, FormGroup } from "../../shared/ui/Input";
import type { AppointmentDoc } from "../../shared/types/appointment";
import type { Repair } from "../../shared/types/client";
import type { StaffMember } from "../../shared/types/staff";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ScheduleType = "dayoff" | "vacation" | "sick";

export interface ScheduleEntry {
  id: string;
  staffId: string;
  date: string;
  type: ScheduleType;
  note?: string;
  createdBy?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTHS = [
  "Январь","Февраль","Март","Апрель","Май","Июнь",
  "Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь",
];
const DOW = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];
const DOW_FULL = ["Воскресенье","Понедельник","Вторник","Среда","Четверг","Пятница","Суббота"];

const COLORS = [
  { bg: "#3b82f6", text: "#3b82f6", fill: "rgba(59,130,246,0.13)",  border: "rgba(59,130,246,0.28)" },
  { bg: "#ef4444", text: "#ef4444", fill: "rgba(239,68,68,0.13)",   border: "rgba(239,68,68,0.28)" },
  { bg: "#16a34a", text: "#16a34a", fill: "rgba(22,163,74,0.13)",   border: "rgba(22,163,74,0.28)" },
  { bg: "#f59e0b", text: "#b45309", fill: "rgba(245,158,11,0.13)",  border: "rgba(245,158,11,0.28)" },
  { bg: "#8b5cf6", text: "#7c3aed", fill: "rgba(139,92,246,0.13)",  border: "rgba(139,92,246,0.28)" },
  { bg: "#06b6d4", text: "#0e7490", fill: "rgba(6,182,212,0.13)",   border: "rgba(6,182,212,0.28)" },
  { bg: "#ec4899", text: "#be185d", fill: "rgba(236,72,153,0.13)",  border: "rgba(236,72,153,0.28)" },
  { bg: "#f97316", text: "#c2410c", fill: "rgba(249,115,22,0.13)",  border: "rgba(249,115,22,0.28)" },
] as const;

const SCHED_TYPES = [
  { id: "dayoff"   as ScheduleType, label: "Выходной",   short: "В", color: "#6b7280", fill: "rgba(107,114,128,0.12)" },
  { id: "vacation" as ScheduleType, label: "Отпуск",     short: "О", color: "#16a34a", fill: "rgba(22,163,74,0.12)"   },
  { id: "sick"     as ScheduleType, label: "Больничный", short: "Б", color: "#f59e0b", fill: "rgba(245,158,11,0.12)"  },
];

function schedInfo(type: ScheduleType) {
  return SCHED_TYPES.find((t) => t.id === type) ?? SCHED_TYPES[0];
}

// ─── Calendar helpers ─────────────────────────────────────────────────────────

function buildGrid(year: number, month: number): Array<string | null> {
  const first = new Date(year, month, 1);
  const days  = new Date(year, month + 1, 0).getDate();
  const start = (first.getDay() + 6) % 7; // Mon=0

  const cells: Array<string | null> = Array(start).fill(null);
  for (let d = 1; d <= days; d++) {
    cells.push(
      `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    );
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function isWeekend(date: string): boolean {
  const d = new Date(date + "T00:00:00").getDay();
  return d === 0 || d === 6;
}

function isToday(date: string): boolean {
  return date === new Date().toISOString().slice(0, 10);
}

function fmtDate(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
}

// ─── Firestore helpers ────────────────────────────────────────────────────────

async function saveScheduleEntry(
  existing: ScheduleEntry | undefined,
  data: Omit<ScheduleEntry, "id">,
) {
  const db = getFirebaseDb();
  if (existing) await deleteDoc(doc(db, "schedules", existing.id));
  return addDoc(collection(db, "schedules"), { ...data, createdAt: serverTimestamp() });
}

async function removeScheduleEntry(id: string) {
  return deleteDoc(doc(getFirebaseDb(), "schedules", id));
}

// ─── AddScheduleModal ─────────────────────────────────────────────────────────

function AddScheduleModal({
  day,
  staffId,
  allStaff,
  existing,
  createdBy,
  onClose,
}: {
  day: string;
  staffId: string;
  allStaff: StaffMember[];
  existing?: ScheduleEntry;
  createdBy: string;
  onClose: () => void;
}) {
  const [type, setType] = useState<ScheduleType>(existing?.type ?? "dayoff");
  const [note, setNote] = useState(existing?.note ?? "");
  const [busy, setBusy] = useState(false);

  const member = allStaff.find((s) => s.id === staffId);
  const title = `${member?.name ?? "Сотрудник"} · ${fmtDate(day)}`;

  async function handleSave() {
    setBusy(true);
    try {
      await saveScheduleEntry(existing, { staffId, date: day, type, note: note.trim() || undefined, createdBy });
      onClose();
    } catch { setBusy(false); }
  }

  async function handleDelete() {
    if (!existing) return;
    setBusy(true);
    try {
      await removeScheduleEntry(existing.id);
      onClose();
    } catch { setBusy(false); }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <FormGroup label="Тип">
        <div style={{ display: "flex", gap: 8 }}>
          {SCHED_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setType(t.id)}
              style={{
                flex: 1, padding: "8px 4px", borderRadius: 10, cursor: "pointer",
                border: `1.5px solid ${type === t.id ? t.color : "var(--border2)"}`,
                background: type === t.id ? t.fill : "transparent",
                color: type === t.id ? t.color : "var(--text2)",
                fontSize: 12, fontWeight: 600, fontFamily: "Manrope, sans-serif",
                transition: "all 0.12s",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </FormGroup>
      <FormGroup label="Примечание">
        <Textarea
          placeholder="Необязательно"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{ minHeight: 64 }}
        />
      </FormGroup>
      <Button size="lg" onClick={() => void handleSave()} disabled={busy}>
        {busy ? "..." : existing ? "Обновить" : "Добавить"}
      </Button>
      {existing && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={busy}
            style={{
              fontSize: 12, color: "var(--red)", background: "none", border: "none",
              cursor: "pointer", fontFamily: "Manrope, sans-serif",
            }}
          >
            🗑 Удалить отметку
          </button>
        </div>
      )}
    </Modal>
  );
}

// ─── DayDetailModal ───────────────────────────────────────────────────────────

interface DayDetailProps {
  day: string;
  selectedStaff: string[];
  colorMap: Record<string, typeof COLORS[number]>;
  allStaff: StaffMember[];
  schedules: ScheduleEntry[];
  allRepairs: Array<Repair & { clientName: string }>;
  appointments: AppointmentDoc[];
  isAdmin: boolean;
  currentUserId: string;
  onClose: () => void;
}

function DayDetailModal(props: DayDetailProps) {
  const { day, selectedStaff, colorMap, allStaff, schedules, allRepairs, appointments, isAdmin, currentUserId, onClose } = props;
  const [addFor, setAddFor] = useState<string | null>(null);

  const dow = DOW_FULL[new Date(day + "T00:00:00").getDay()];
  const title = `${dow}, ${fmtDate(day)}`;

  return (
    <>
      <Modal title={title} onClose={onClose}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: "65vh", overflowY: "auto" }}>
          {selectedStaff.map((uid) => {
            const member  = allStaff.find((s) => s.id === uid);
            if (!member) return null;
            const color   = colorMap[uid] ?? COLORS[0];
            const entry   = schedules.find((s) => s.staffId === uid && s.date === day);
            const repairs = allRepairs.filter((r) => r.date?.slice(0,10) === day && (r.mechanics ?? []).includes(uid));
            const appts   = appointments.filter((a) => a.date === day && a.assignees.includes(uid));
            const si      = entry ? schedInfo(entry.type) : null;
            const initials = (member.name ?? "?").trim().split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

            return (
              <div
                key={uid}
                style={{
                  background: "var(--bg2)", borderRadius: 12,
                  border: `1px solid var(--border)`,
                  borderLeft: `3px solid ${color.bg}`,
                  padding: "12px 14px",
                }}
              >
                {/* Staff header */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: si || repairs.length || appts.length ? 10 : 0 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%",
                    background: color.fill, border: `2px solid ${color.border}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, fontWeight: 800, color: color.text, flexShrink: 0,
                  }}>
                    {initials}
                  </div>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)", flex: 1 }}>
                    {member.name ?? member.email ?? uid}
                  </span>
                  {si && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
                      background: si.fill, color: si.color, border: `1px solid ${si.color}44`,
                    }}>
                      {si.label}
                    </span>
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => setAddFor(uid)}
                      style={{
                        fontSize: 11, color: "var(--text3)", background: "var(--bg3)",
                        border: "1px solid var(--border)", borderRadius: 6,
                        padding: "2px 8px", cursor: "pointer", fontFamily: "Manrope, sans-serif",
                      }}
                    >
                      {entry ? "✏️ Изменить" : "+ Отметка"}
                    </button>
                  )}
                </div>

                {entry?.note && (
                  <div style={{ fontSize: 11.5, color: "var(--text3)", fontStyle: "italic", marginBottom: 8 }}>
                    {entry.note}
                  </div>
                )}

                {repairs.length === 0 && appts.length === 0 && !entry && (
                  <div style={{ fontSize: 11.5, color: "var(--text3)" }}>Нет заявок и записей</div>
                )}

                {repairs.length > 0 && (
                  <div style={{ marginBottom: appts.length ? 8 : 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 5 }}>
                      🔧 Заявки ({repairs.length})
                    </div>
                    {repairs.map((r) => (
                      <div key={r.id} style={{
                        fontSize: 12, color: "var(--text2)", padding: "5px 8px",
                        background: "var(--bg3)", borderRadius: 7, marginBottom: 3,
                        display: "flex", alignItems: "center", gap: 6,
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: color.bg, flexShrink: 0 }} />
                        <span style={{ flex: 1 }}>{r.clientName} · {r.description || "Ремонт"}</span>
                        {r.cost && (
                          <span style={{ fontSize: 11, color: "#16a34a", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                            {r.cost} ₽
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {appts.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 5 }}>
                      📅 Записи ({appts.length})
                    </div>
                    {appts.map((a) => (
                      <div key={a.id} style={{
                        fontSize: 12, color: "var(--text2)", padding: "5px 8px",
                        background: "var(--bg3)", borderRadius: 7, marginBottom: 3,
                        display: "flex", alignItems: "center", gap: 6,
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: color.bg, flexShrink: 0 }} />
                        <span style={{ flex: 1 }}>{a.clientName}</span>
                        {a.time && (
                          <span style={{ fontSize: 11, color: "var(--text3)", whiteSpace: "nowrap" }}>
                            {a.time}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Modal>

      {addFor && (
        <AddScheduleModal
          day={day}
          staffId={addFor}
          allStaff={allStaff}
          existing={schedules.find((s) => s.staffId === addFor && s.date === day)}
          createdBy={currentUserId}
          onClose={() => setAddFor(null)}
        />
      )}
    </>
  );
}

// ─── ScheduleTab ──────────────────────────────────────────────────────────────

export function ScheduleTab() {
  const { staff, clients, appointments } = useData();
  const { myProfile } = useAuth();
  const role = myProfile?.role ?? "mechanic";
  const isAdmin = role === "owner" || role === "admin";
  const currentUserId = myProfile?.id ?? "";

  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selStaff, setSelStaff] = useState<string[]>([]);
  const [schedules, setSchedules] = useState<ScheduleEntry[]>([]);
  const [selDay, setSelDay] = useState<string | null>(null);

  // Auto-select first 5 staff on load
  useEffect(() => {
    if (staff.length > 0 && selStaff.length === 0) {
      setSelStaff(staff.slice(0, Math.min(staff.length, 5)).map((s) => s.id));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff]);

  // Live schedules from Firestore
  useEffect(() => {
    const unsub = onSnapshot(
      collection(getFirebaseDb(), "schedules"),
      (snap) => setSchedules(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ScheduleEntry)),
      () => setSchedules([]),
    );
    return () => unsub();
  }, []);

  // Color map: staffId → color
  const colorMap = useMemo<Record<string, typeof COLORS[number]>>(() => {
    const m: Record<string, typeof COLORS[number]> = {};
    staff.forEach((s, i) => { m[s.id] = COLORS[i % COLORS.length]; });
    return m;
  }, [staff]);

  // Flatten all repairs
  const allRepairs = useMemo(
    () => clients.flatMap((c) =>
      (c.repairs ?? []).map((r) => ({ ...r, clientName: c.name })),
    ),
    [clients],
  );

  // Calendar grid (array of 35-42 strings or nulls)
  const grid = useMemo(() => buildGrid(year, month), [year, month]);

  // Month bounds for filtering
  const monthStr = `${year}-${String(month + 1).padStart(2, "0")}`;

  // Pre-compute per-day, per-staff counts for the displayed month
  const repairCountByDayStaff = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    allRepairs.forEach((r) => {
      const d = r.date?.slice(0, 10);
      if (!d || !d.startsWith(monthStr)) return;
      (r.mechanics ?? []).forEach((uid) => {
        if (!selStaff.includes(uid)) return;
        if (!m.has(d)) m.set(d, new Map());
        m.get(d)!.set(uid, (m.get(d)!.get(uid) ?? 0) + 1);
      });
    });
    return m;
  }, [allRepairs, monthStr, selStaff]);

  const apptCountByDayStaff = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    appointments.forEach((a) => {
      if (!a.date.startsWith(monthStr)) return;
      a.assignees.forEach((uid) => {
        if (!selStaff.includes(uid)) return;
        if (!m.has(a.date)) m.set(a.date, new Map());
        m.get(a.date)!.set(uid, (m.get(a.date)!.get(uid) ?? 0) + 1);
      });
    });
    return m;
  }, [appointments, monthStr, selStaff]);

  const schedulesByDayStaff = useMemo(() => {
    const m = new Map<string, Map<string, ScheduleEntry>>();
    schedules.forEach((s) => {
      if (!s.date.startsWith(monthStr)) return;
      if (!selStaff.includes(s.staffId)) return;
      if (!m.has(s.date)) m.set(s.date, new Map());
      m.get(s.date)!.set(s.staffId, s);
    });
    return m;
  }, [schedules, monthStr, selStaff]);

  function prevMonth() {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
  }

  function toggleStaff(id: string) {
    setSelStaff((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  // Compute cell min height based on selected staff count
  const cellMinH = 48 + selStaff.length * 17;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="crm-section" style={{ animation: "fadeUp 0.45s ease 0.1s both" }}>

        {/* Section header */}
        <div className="section-header">
          <i className="ti ti-calendar-user" style={{ fontSize: 17, color: "var(--text2)" }} />
          <span className="section-title">График работы</span>
          <span className="section-count">{selStaff.length} из {staff.length}</span>
        </div>

        {/* Staff color picker */}
        <div style={{ padding: "12px 14px 0", display: "flex", flexWrap: "wrap", gap: 7 }}>
          {staff.map((s) => {
            const c = colorMap[s.id] ?? COLORS[0];
            const active = selStaff.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleStaff(s.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "5px 11px 5px 8px", borderRadius: 20, cursor: "pointer",
                  border: `1.5px solid ${active ? c.border : "var(--border2)"}`,
                  background: active ? c.fill : "transparent",
                  fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: 600,
                  color: active ? c.text : "var(--text3)",
                  transition: "all 0.15s",
                }}
              >
                <span style={{
                  width: 9, height: 9, borderRadius: "50%", flexShrink: 0,
                  background: active ? c.bg : "var(--border2)",
                  transition: "background 0.15s",
                }} />
                {s.name ?? s.email ?? s.id}
              </button>
            );
          })}
        </div>

        {/* Month navigator */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
          padding: "16px 14px 10px",
        }}>
          <button
            type="button"
            onClick={prevMonth}
            style={{
              width: 32, height: 32, borderRadius: 8, cursor: "pointer",
              border: "1px solid var(--border2)", background: "var(--bg3)",
              color: "var(--text2)", fontSize: 18, lineHeight: 1,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            ‹
          </button>
          <span style={{
            fontSize: 15, fontWeight: 700, color: "var(--text)",
            minWidth: 160, textAlign: "center", letterSpacing: "-0.2px",
          }}>
            {MONTHS[month]} {year}
          </span>
          <button
            type="button"
            onClick={nextMonth}
            style={{
              width: 32, height: 32, borderRadius: 8, cursor: "pointer",
              border: "1px solid var(--border2)", background: "var(--bg3)",
              color: "var(--text2)", fontSize: 18, lineHeight: 1,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            ›
          </button>
        </div>

        {/* Calendar grid */}
        <div style={{ padding: "0 10px 14px", overflowX: "auto" }}>
          <div style={{ minWidth: 280 }}>
            {/* Day-of-week headers */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 3 }}>
              {DOW.map((d, i) => (
                <div
                  key={d}
                  style={{
                    textAlign: "center", fontSize: 10, fontWeight: 700,
                    color: i >= 5 ? "#ef4444" : "var(--text3)",
                    padding: "3px 0", textTransform: "uppercase", letterSpacing: "0.5px",
                  }}
                >
                  {d}
                </div>
              ))}
            </div>

            {/* Day cells */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
              {grid.map((day, idx) => {
                if (!day) {
                  return <div key={`e${idx}`} style={{ minHeight: cellMinH }} />;
                }

                const dayNum   = parseInt(day.slice(8, 10));
                const weekend  = isWeekend(day);
                const today    = isToday(day);
                const schedMap = schedulesByDayStaff.get(day);
                const repMap   = repairCountByDayStaff.get(day);
                const apptMap  = apptCountByDayStaff.get(day);

                return (
                  <div
                    key={day}
                    onClick={() => selStaff.length > 0 && setSelDay(day)}
                    style={{
                      minHeight: cellMinH, borderRadius: 8,
                      border: today
                        ? "1.5px solid var(--accent)"
                        : "1px solid var(--border)",
                      background: weekend
                        ? "rgba(239,68,68,0.04)"
                        : today
                        ? "rgba(59,130,246,0.04)"
                        : "var(--bg2)",
                      padding: "4px 3px 4px 3px",
                      cursor: selStaff.length > 0 ? "pointer" : "default",
                      display: "flex", flexDirection: "column", gap: 2,
                    }}
                  >
                    {/* Day number */}
                    <div style={{
                      fontSize: 11, fontWeight: today ? 800 : 600, textAlign: "right",
                      color: today ? "var(--accent2)" : weekend ? "#ef4444" : "var(--text2)",
                      lineHeight: 1, padding: "1px 2px 2px",
                    }}>
                      {dayNum}
                    </div>

                    {/* Per-staff indicators */}
                    {selStaff.map((uid) => {
                      const c      = colorMap[uid] ?? COLORS[0];
                      const entry  = schedMap?.get(uid);
                      const rCount = (repMap?.get(uid) ?? 0) + (apptMap?.get(uid) ?? 0);

                      if (entry) {
                        const si = schedInfo(entry.type);
                        return (
                          <div key={uid} style={{
                            display: "flex", alignItems: "center", justifyContent: "center",
                            borderRadius: 4, padding: "0 2px", height: 15,
                            background: si.fill, border: `1px solid ${si.color}44`,
                            fontSize: 9, fontWeight: 800, color: si.color, lineHeight: 1,
                          }}>
                            {si.short}
                          </div>
                        );
                      }

                      if (rCount > 0) {
                        return (
                          <div key={uid} style={{
                            display: "flex", alignItems: "center", gap: 2, height: 15,
                            borderRadius: 4, padding: "0 3px",
                            background: c.fill, border: `1px solid ${c.border}`,
                          }}>
                            <span style={{ width: 4, height: 4, borderRadius: "50%", background: c.bg, flexShrink: 0 }} />
                            <span style={{ fontSize: 9, fontWeight: 700, color: c.text, lineHeight: 1 }}>{rCount}</span>
                          </div>
                        );
                      }

                      return (
                        <div key={uid} style={{ height: 15, display: "flex", alignItems: "center", paddingLeft: 4 }}>
                          <span style={{ width: 4, height: 4, borderRadius: "50%", background: c.bg, opacity: 0.22 }} />
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Legend */}
        <div style={{
          padding: "0 14px 14px",
          display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center",
        }}>
          <span style={{ fontSize: 10, color: "var(--text3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.4px" }}>
            Обозначения:
          </span>
          {SCHED_TYPES.map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{
                fontSize: 9, fontWeight: 800, padding: "1px 6px", borderRadius: 4,
                background: t.fill, color: t.color, border: `1px solid ${t.color}44`,
              }}>
                {t.short}
              </span>
              <span style={{ fontSize: 10, color: "var(--text3)" }}>{t.label}</span>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{
              fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 4,
              background: "rgba(59,130,246,0.12)", color: "#3b82f6", border: "1px solid rgba(59,130,246,0.25)",
            }}>
              3
            </span>
            <span style={{ fontSize: 10, color: "var(--text3)" }}>Заявок/записей</span>
          </div>
          {!isAdmin && (
            <span style={{ fontSize: 10, color: "var(--text3)", marginLeft: "auto", fontStyle: "italic" }}>
              Редактирование доступно владельцу и администратору
            </span>
          )}
        </div>
      </div>

      {/* Day detail modal */}
      {selDay && (
        <DayDetailModal
          day={selDay}
          selectedStaff={selStaff}
          colorMap={colorMap}
          allStaff={staff}
          schedules={schedules}
          allRepairs={allRepairs}
          appointments={appointments}
          isAdmin={isAdmin}
          currentUserId={currentUserId}
          onClose={() => setSelDay(null)}
        />
      )}
    </div>
  );
}
