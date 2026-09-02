import { useMemo, useState } from "react";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import { usePermissions } from "../../shared/hooks/usePermissions";
import {
  repairStatus,
  taskStatus,
  SERVICE_TYPES,
  repairFinancialMonth,
  repairFinancialDay,
  isRepairClosedInMonth,
} from "../../shared/utils/repair";
import { fmtMoney, fmtDate } from "../../shared/utils/format";
import { Modal } from "../../shared/ui/Modal";
import type { Tab } from "../../app/AppShell";
import type { Repair, Vehicle } from "../../shared/types/client";

const isClosedThisMonth = isRepairClosedInMonth;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMechanics(r: any): string[] {
  const uids = new Set<string>();
  for (const task of (r.tasks ?? [])) {
    if (Array.isArray(task.assignees)) task.assignees.forEach((uid: string) => uid && uids.add(uid));
    if (typeof task.assignee === "string" && task.assignee) uids.add(task.assignee);
  }
  if (uids.size === 0 && Array.isArray(r.mechanics)) r.mechanics.forEach((uid: string) => uid && uids.add(uid));
  if (uids.size === 0 && typeof r.mechanic === "string" && r.mechanic) uids.add(r.mechanic);
  return Array.from(uids);
}

interface EnrichedRepair extends Repair {
  clientId:   string;
  clientName: string;
  vehicle?:   Vehicle;
}

const MONTH_NAMES      = ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"];
const MONTH_NAMES_FULL = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];

function freonMonthLabel(mk: string): string {
  const [y, m] = mk.split("-");
  return `${MONTH_NAMES_FULL[parseInt(m) - 1]} ${y}`;
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, icon, accent, color, delta, deltaUp }: {
  label:    string;
  value:    string | number;
  icon:     string;
  accent:   string;
  color:    string;
  delta?:   string;
  deltaUp?: boolean;
}) {
  return (
    <div className={`kpi-card ${accent}`}>
      <i className={`ti ${icon} kpi-icon`} />
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color }}>{value}</div>
      {delta && (
        <div className={`kpi-delta ${deltaUp === false ? "down" : deltaUp ? "up" : "muted"}`}>
          <i className={`ti ${deltaUp === false ? "ti-trending-down" : deltaUp ? "ti-trending-up" : "ti-minus"}`} />
          {delta}
        </div>
      )}
    </div>
  );
}

// ─── Quick Actions ────────────────────────────────────────────────────────────

function QuickAction({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "var(--bg2)", border: "1px solid var(--border)",
        borderRadius: 12, padding: "14px 8px", cursor: "pointer",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
        transition: "all 0.18s", width: "100%",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--border2)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.transform = ""; }}
    >
      <i className={`ti ${icon}`} style={{ fontSize: 20, color: "var(--accent2)" }} />
      <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text2)" }}>{label}</span>
    </button>
  );
}

// ─── Revenue chart (CSS bars) ─────────────────────────────────────────────────

function fmtK(n: number): string {
  if (n === 0) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}М`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}К`;
  return String(n);
}

function RevenueChart({ monthData, onBarClick, hideAmounts }: {
  monthData:    { mk: string; label: string; rev: number; exp: number; cnt: number }[];
  onBarClick?:  (mk: string) => void;
  hideAmounts?: boolean;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const data  = monthData ?? [];
  const n     = data.length || 1;
  const maxVal = Math.max(
    ...data.flatMap((m) => [m.rev, m.exp, Math.max(0, m.rev - m.exp)]),
    1,
  );

  function barH(v: number): string {
    if (v <= 0) return "2px";
    return `${Math.max(6, (v / maxVal) * 100)}%`;
  }

  const hov = hovered !== null ? data[hovered] : null;

  return (
    <div style={{ padding: "4px 16px 0", userSelect: "none" }}>
      {/* Hover info row */}
      <div style={{ height: 36, display: "flex", alignItems: "center", justifyContent: "center", gap: 14 }}>
        {!hideAmounts && hov ? (() => {
          const profit = hov.rev - hov.exp;
          return (
            <>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text)", minWidth: 28 }}>{hov.label}</span>
              <span style={{ fontSize: 11.5, color: "#2563eb" }}>↑ {fmtK(hov.rev)}</span>
              {hov.exp > 0 && <span style={{ fontSize: 11.5, color: "#dc2626" }}>↓ {fmtK(hov.exp)}</span>}
              <span style={{ fontSize: 11.5, fontWeight: 700, color: profit >= 0 ? "#16a34a" : "#dc2626" }}>
                = {profit >= 0 ? "+" : "−"}{fmtK(Math.abs(profit))}
              </span>
              {onBarClick && (
                <span style={{ fontSize: 10, color: "var(--text3)" }}>· нажмите</span>
              )}
            </>
          );
        })() : (
          <span style={{ fontSize: 11, color: "var(--text3)" }}>
            {!hideAmounts && onBarClick ? "нажмите на месяц для деталей" : hideAmounts ? "" : "наведите на месяц"}
          </span>
        )}
      </div>

      {/* Bars */}
      <div style={{ display: "flex", gap: 4, height: 90, alignItems: "flex-end" }}>
        {data.map((m, i) => {
          const profit = m.rev - m.exp;
          const isLast = i === n - 1;
          const isHov  = hovered === i;
          return (
            <div
              key={i}
              style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "flex-end", height: "100%", cursor: onBarClick ? "pointer" : "default" }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onBarClick?.(m.mk)}
            >
              <div style={{
                display: "flex", gap: 2, alignItems: "flex-end", height: "100%",
                opacity: isHov ? 1 : undefined,
                filter: isHov ? "brightness(1.2)" : undefined,
                transition: "filter 0.15s",
              }}>
                {/* Revenue — blue */}
                <div style={{
                  width: 10, height: barH(m.rev),
                  background: isLast ? "#3b82f6" : "rgba(59,130,246,0.5)",
                  borderRadius: "3px 3px 0 0",
                  transition: "height 0.4s ease",
                }} />
                {/* Expenses — red */}
                <div style={{
                  width: 10, height: barH(m.exp),
                  background: m.exp > 0
                    ? (isLast ? "#ef4444" : "rgba(239,68,68,0.55)")
                    : "rgba(107,114,128,0.15)",
                  borderRadius: "3px 3px 0 0",
                  transition: "height 0.4s ease",
                }} />
                {/* Profit — green (0 if negative) */}
                <div style={{
                  width: 10, height: barH(Math.max(0, profit)),
                  background: profit > 0
                    ? (isLast ? "#22c55e" : "rgba(34,197,94,0.55)")
                    : "rgba(107,114,128,0.15)",
                  borderRadius: "3px 3px 0 0",
                  transition: "height 0.4s ease",
                }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Month labels */}
      <div style={{ display: "flex", gap: 4, marginTop: 5 }}>
        {data.map((m, i) => (
          <div key={i} style={{
            flex: 1, textAlign: "center", fontSize: 10,
            color: i === n - 1 ? "var(--cyan)" : "var(--text3)",
          }}>
            {m.label}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div style={{
        display: "flex", gap: 16, justifyContent: "center", alignItems: "center",
        fontSize: 11, padding: "9px 0 4px", marginTop: 6, borderTop: "1px solid var(--border)",
      }}>
        {([
          { color: "#3b82f6", label: "Выручка" },
          { color: "#ef4444", label: "Расходы" },
          { color: "#22c55e", label: "Прибыль" },
        ] as const).map(({ color, label }) => (
          <span key={label} style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text3)" }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: "inline-block", flexShrink: 0 }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Freon month chart (CSS bars, cyan palette) ───────────────────────────────

function FreonMonthChart({ months }: { months: { key: string; total: number }[] }) {
  const displayed = months.slice().reverse().slice(-6);
  const maxKg     = Math.max(...displayed.map((m) => m.total), 1);
  return (
    <div className="chart-bars">
      {displayed.map((m, i) => {
        const label = MONTH_NAMES[parseInt(m.key.split("-")[1]) - 1];
        const pct   = m.total > 0 ? Math.max(8, (m.total / maxKg) * 100) : 3;
        return (
          <div key={m.key} className="bar-wrap">
            {m.total > 0 && (
              <span className="bar-value" style={{ color: "#0891b2" }}>
                {m.total.toFixed(1)}
              </span>
            )}
            <div
              className="bar"
              style={{
                height: `${pct}%`,
                animationDelay: `${0.3 + i * 0.06}s`,
                background: "linear-gradient(180deg, #22d3ee, #0891b2)",
                opacity: m.total > 0 ? undefined : 0.2,
              }}
            />
            <span className="bar-label">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Bar row (for top clients / service types) ────────────────────────────────

function BarRow({ label, value, maxValue, valueLabel, sub }: {
  label: string; value: number; maxValue: number; valueLabel: string; sub?: string;
}) {
  const pct = maxValue > 0 ? Math.max(3, (value / maxValue) * 100) : 3;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)", flex: 1, marginRight: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--accent2)", flexShrink: 0, fontFamily: "JetBrains Mono, monospace" }}>
          {valueLabel}
        </span>
      </div>
      {sub && <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>{sub}</div>}
      <div style={{ height: 4, borderRadius: 2, background: "var(--bg3)", overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${pct}%`, borderRadius: 2,
          background: "linear-gradient(90deg, var(--accent), var(--cyan))",
          animation: "progressGrow 0.8s ease both",
        }} />
      </div>
    </div>
  );
}

// ─── Mechanic row ─────────────────────────────────────────────────────────────

const MECH_COLORS = [
  { bg: "rgba(59,130,246,0.15)",  color: "#2563eb", bar: "var(--yellow)" },
  { bg: "rgba(34,197,94,0.15)",   color: "#16a34a", bar: "var(--green)"  },
  { bg: "rgba(139,92,246,0.15)",  color: "#7c3aed", bar: "var(--accent)" },
  { bg: "rgba(6,182,212,0.15)",   color: "#0891b2", bar: "var(--cyan)"   },
];

function MechanicRow({ name, monthlyCars, monthLabel, idx, crownColor }: {
  name: string; monthlyCars: number; monthLabel: string; idx: number;
  crownColor?: string | null;
}) {
  const c        = MECH_COLORS[idx % MECH_COLORS.length];
  const initials = (name || "").split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  return (
    <div className="mechanic-row" style={{ animationDelay: `${0.5 + idx * 0.06}s` }}>
      <div className="mech-avatar" style={{ background: c.bg, color: c.color }}>{initials}</div>
      <div className="mech-info">
        <div className="mech-name">
          <span style={
            crownColor === "#FFD700"
              ? { animation: "glow 1.5s ease-in-out infinite", color: "#FFD700" }
              : crownColor === "#C0C0C0"
              ? { border: "1.5px solid #C0C0C0", borderRadius: "6px", padding: "1px 6px", color: "#C0C0C0" }
              : undefined
          }>
            {name}
          </span>
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: monthlyCars > 0 ? "var(--text)" : "var(--text3)" }}>
          🔧 {monthlyCars} машин
        </div>
        <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{monthLabel}</div>
      </div>
    </div>
  );
}

// ─── Repair detail modal (opens from Stats repair card) ───────────────────────

function RepairDetailModal({ repair, isAdmin, onClose }: {
  repair:  EnrichedRepair;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const { staff } = useData();

  function assigneeNames(r: Repair): string {
    const uids = new Set<string>();
    (r.tasks ?? []).forEach((t) => (t.assignees ?? []).forEach((uid) => uids.add(uid)));
    return Array.from(uids)
      .map((uid) => staff.find((s) => s.id === uid)?.name ?? "")
      .filter(Boolean).join(", ");
  }

  const names    = assigneeNames(repair);
  const freonType = repair.freonType  || (repair.tasks ?? []).find((t) => t.freonTask && t.freonType)?.freonType  || "";
  const freonAmt  = repair.freonAmount || (repair.tasks ?? []).find((t) => t.freonTask && t.freonKg)?.freonKg      || "";
  const cost      = parseFloat(repair.cost ?? "0") || 0;
  const brand     = repair.vehicle?.brand ?? repair.vehicle?.model;
  const st        = repairStatus(repair);
  const statusLabel = st === "done" ? "Закрыто" : st === "cancelled" ? "Отказ" : "В работе";
  const statusColor = st === "done" ? "#16a34a" : st === "cancelled" ? "var(--text3)" : "var(--accent2)";

  return (
    <Modal title={repair.clientName} onClose={onClose}>

      {/* Vehicle photo */}
      {repair.vehicle?.photo && (
        <div style={{ marginBottom: 12, borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)" }}>
          <img src={repair.vehicle.photo} alt="" style={{ width: "100%", maxHeight: 160, objectFit: "cover", display: "block" }} />
        </div>
      )}

      {/* Vehicle + status header */}
      <div style={{ background: "var(--bg3)", borderRadius: 12, padding: "10px 14px", marginBottom: 14, border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div>
            {repair.vehicle?.plate && (
              <span style={{ fontSize: 14, fontFamily: "monospace", fontWeight: 700, color: "#3b82f6" }}>{repair.vehicle.plate}</span>
            )}
            {brand && <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: 8 }}>{brand}</span>}
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 10, background: `${statusColor}22`, color: statusColor }}>
            {statusLabel}
          </span>
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
          {repair.date && (
            <div style={{ fontSize: 11, color: "var(--text3)" }}>📅 Начало: <span style={{ color: "var(--text2)" }}>{fmtDate(repair.date)}</span></div>
          )}
          {repair.closedAt && (
            <div style={{ fontSize: 11, color: "var(--text3)" }}>🔒 Закрыто: <span style={{ color: "var(--text2)" }}>{fmtDate(repair.closedAt)}</span></div>
          )}
        </div>
      </div>

      {/* Description */}
      {repair.description && (
        <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 12, lineHeight: 1.5 }}>{repair.description}</div>
      )}

      {/* Freon */}
      {(freonType || freonAmt) && (
        <div style={{ fontSize: 12, color: "#0e7490", background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.18)", borderRadius: 8, padding: "6px 12px", marginBottom: 12, display: "inline-block" }}>
          ❄️ {freonType}{freonAmt ? ` · ${freonAmt} кг` : ""}
        </div>
      )}

      {/* Mechanics */}
      {names && (
        <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>👨‍🔧 {names}</div>
      )}

      {/* Cost */}
      {isAdmin && cost > 0 && (
        <div style={{ fontSize: 15, fontWeight: 700, color: "#16a34a", fontFamily: "monospace", marginBottom: 12 }}>
          💰 {cost.toLocaleString("ru-RU")} ₽
        </div>
      )}

      {/* Tasks */}
      {(repair.tasks ?? []).length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase" as const, letterSpacing: "0.5px", marginBottom: 6 }}>Задачи</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {(repair.tasks ?? []).map((t) => (
              <div key={t.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "var(--bg3)", borderRadius: 8, padding: "6px 10px" }}>
                <span style={{ fontSize: 12, color: t.status === "done" ? "#16a34a" : "#b45309", flexShrink: 0, marginTop: 1 }}>
                  {t.status === "done" ? "✓" : "●"}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 12, color: t.status === "done" ? "var(--text3)" : "var(--text)" }}>{t.description}</span>
                  {t.freonType && <span style={{ fontSize: 11, color: "#0e7490" }}> · ❄️ {t.freonType}</span>}
                  {t.freonKg   && <span style={{ fontSize: 11, color: "#0e7490" }}> {t.freonKg} кг</span>}
                  {(t.assignees ?? []).length > 0 && (
                    <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 2 }}>
                      👤 {(t.assignees ?? []).map((uid) => staff.find((s) => s.id === uid)?.name ?? "").filter(Boolean).join(", ")}
                    </div>
                  )}
                  {t.workComment && (
                    <div style={{ fontSize: 10, color: "#6d28d9", marginTop: 2 }}>📝 {t.workComment}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Repair photos */}
      {(repair.photos ?? []).length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase" as const, letterSpacing: "0.5px", marginBottom: 6 }}>Фото</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 5 }}>
            {(repair.photos ?? []).map((p) => {
              const src = p.url ?? p.data ?? "";
              if (!src) return null;
              return <img key={p.id} src={src} alt="" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)", display: "block" }} />;
            })}
          </div>
        </div>
      )}

    </Modal>
  );
}

// ─── Month detail modal ───────────────────────────────────────────────────────

function MonthDetailModal({ mk, doneRepairs, rawFinance, expenses, rentalIncome, onClose }: {
  mk:            string;
  doneRepairs:   EnrichedRepair[];
  rawFinance:    unknown;
  expenses:      Array<{ id: string; category: string; month: string; amount: number; comment: string }>;
  rentalIncome:  number;
  onClose:       () => void;
}) {
  type FinDoc = {
    boxes?:     Array<{ id: string; name: string; cost: number }>;
    salaries?:  Array<{ uid: string; name: string; salary: number }>;
    elecBills?: Record<string, number>;
    purchases?: Array<{ id: string; date: string; amount: number; comment: string }>;
  };
  const fin = rawFinance as FinDoc;

  const [y, m] = mk.split("-");
  const title  = `${MONTH_NAMES_FULL[parseInt(m) - 1]} ${y}`;

  // Revenue by client
  const clientRevMap = new Map<string, { name: string; amount: number }>();
  doneRepairs
    .filter((r) => repairFinancialMonth(r) === mk)
    .forEach((r) => {
      const prev = clientRevMap.get(r.clientId) ?? { name: r.clientName, amount: 0 };
      clientRevMap.set(r.clientId, { name: r.clientName, amount: prev.amount + (parseFloat(r.cost ?? "0") || 0) });
    });
  const clientRevList = Array.from(clientRevMap.values()).filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount);
  const totalRevenue  = clientRevList.reduce((s, c) => s + c.amount, 0) + rentalIncome;

  // Expenses
  const salary      = (fin.salaries ?? []).reduce((s, s2) => s + (parseFloat(String(s2.salary)) || 0), 0);
  const rent        = (fin.boxes    ?? []).reduce((s, b)  => s + (parseFloat(String(b.cost))    || 0), 0);
  const electricity = parseFloat(String((fin.elecBills ?? {})[mk] ?? 0)) || 0;
  const purchases   = (fin.purchases ?? []).filter((p) => p.date?.slice(0, 7) === mk).reduce((s, p) => s + (parseFloat(String(p.amount)) || 0), 0);
  const commission  = expenses.filter((e) => e.category === "commission" && e.month === mk).reduce((s, e) => s + (parseFloat(String(e.amount)) || 0), 0);
  const totalExpenses = salary + rent + electricity + purchases + commission;

  const profit = totalRevenue - totalExpenses;

  const expenseRows = [
    { icon: "👥", label: "Зарплата",        amount: salary      },
    { icon: "⚡", label: "Электричество",   amount: electricity },
    { icon: "🏠", label: "Аренда",          amount: rent        },
    { icon: "🔧", label: "Закупки",         amount: purchases   },
    { icon: "🤝", label: "Комиссионные",    amount: commission  },
  ].filter((e) => e.amount > 0);

  const rowStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "7px 0", borderBottom: "1px solid var(--border)", fontSize: 13,
  };

  return (
    <Modal title={title} onClose={onClose}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>

        {/* Block 1: Revenues */}
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>
            💰 Доходы
          </div>
          {clientRevList.length === 0 && rentalIncome === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text3)", padding: "8px 0" }}>Нет данных</div>
          ) : (
            <>
              {clientRevList.map((c) => (
                <div key={c.name} style={rowStyle}>
                  <span style={{ color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, marginRight: 8, fontSize: 12.5 }}>
                    {c.name}
                  </span>
                  <span style={{ color: "#16a34a", fontFamily: "JetBrains Mono, monospace", fontWeight: 700, flexShrink: 0 }}>
                    {fmtMoney(c.amount)}
                  </span>
                </div>
              ))}
              {rentalIncome > 0 && (
                <div style={rowStyle}>
                  <span style={{ color: "var(--text)", fontSize: 12.5, flex: 1, marginRight: 8 }}>🏠 Аренда камер</span>
                  <span style={{ color: "#16a34a", fontFamily: "JetBrains Mono, monospace", fontWeight: 700, flexShrink: 0 }}>
                    {fmtMoney(rentalIncome)}
                  </span>
                </div>
              )}
            </>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 0 0", borderTop: "1px solid var(--border2)", marginTop: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text2)" }}>Итого</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: "#16a34a", fontFamily: "JetBrains Mono, monospace" }}>{fmtMoney(totalRevenue)}</span>
          </div>
        </div>

        {/* Block 2: Expenses */}
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>
            📤 Расходы
          </div>
          {expenseRows.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text3)", padding: "8px 0" }}>Нет данных</div>
          ) : (
            expenseRows.map((e) => (
              <div key={e.label} style={rowStyle}>
                <span style={{ color: "var(--text)", fontSize: 12.5 }}>{e.icon} {e.label}</span>
                <span style={{ color: "#dc2626", fontFamily: "JetBrains Mono, monospace", fontWeight: 700 }}>{fmtMoney(e.amount)}</span>
              </div>
            ))
          )}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 0 0", borderTop: "1px solid var(--border2)", marginTop: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text2)" }}>Итого</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: "#dc2626", fontFamily: "JetBrains Mono, monospace" }}>{fmtMoney(totalExpenses)}</span>
          </div>
        </div>
      </div>

      {/* Net profit row */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginTop: 16, padding: "12px 16px", borderRadius: 12,
        background:  profit >= 0 ? "rgba(34,197,94,0.1)"  : "rgba(239,68,68,0.1)",
        border: `1px solid ${profit >= 0 ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
      }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Чистая прибыль</span>
        <span style={{ fontSize: 16, fontWeight: 800, fontFamily: "JetBrains Mono, monospace", color: profit >= 0 ? "#16a34a" : "#dc2626" }}>
          {profit >= 0 ? "+" : ""}{fmtMoney(profit)}
        </span>
      </div>
    </Modal>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, icon, count, actions, children }: {
  title: string; icon: string; count?: string | number;
  actions?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="crm-section" style={{ animation: "fadeUp 0.45s ease 0.3s both" }}>
      <div className="section-header">
        <i className={`ti ${icon}`} style={{ fontSize: 17, color: "var(--text2)" }} />
        <span className="section-title">{title}</span>
        {count !== undefined && <span className="section-count">{count}</span>}
        {actions && <div className="section-actions">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

// ─── Repair card ──────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  in_progress: { label: "В работе", cls: "work" },
  done:        { label: "Готово",   cls: "done" },
  new:         { label: "Новая",    cls: "new"  },
};

const AVATAR_COLORS = [
  { bg: "rgba(239,68,68,0.15)",   color: "#dc2626" },
  { bg: "rgba(59,130,246,0.15)",  color: "#2563eb" },
  { bg: "rgba(34,197,94,0.15)",   color: "#16a34a" },
  { bg: "rgba(139,92,246,0.15)",  color: "#7c3aed" },
  { bg: "rgba(6,182,212,0.15)",   color: "#0891b2" },
  { bg: "rgba(245,158,11,0.15)",  color: "#b45309" },
];

function repairPriority(date?: string): { color: string; shadow?: string } {
  if (!date) return { color: "var(--text3)" };
  const days = (Date.now() - new Date(date).getTime()) / 86_400_000;
  if (days > 3) return { color: "var(--red)", shadow: "0 0 6px var(--red)" };
  if (days > 1) return { color: "var(--yellow)" };
  return { color: "var(--text3)" };
}

function RepairCard({ clientName, description, date, cost, status, plate, isAdmin, idx }: {
  clientName: string; description?: string; date?: string;
  cost?: string; status: string; plate?: string; isAdmin: boolean; idx: number;
}) {
  const s       = STATUS_MAP[status] ?? { label: status, cls: "new" };
  const initials = (clientName || "").split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  const costNum  = parseFloat(cost ?? "0") || 0;
  const av       = AVATAR_COLORS[idx % AVATAR_COLORS.length];
  const prio     = repairPriority(date);
  return (
    <div
      className="tr-animate"
      style={{
        padding: "12px 20px", borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", gap: 12,
        animationDelay: `${0.35 + idx * 0.07}s`,
      }}
    >
      {/* Priority dot */}
      <div style={{
        width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
        background: prio.color,
        boxShadow: prio.shadow,
      }} />
      {/* Colored client avatar */}
      <div style={{
        width: 28, height: 28, borderRadius: 6, flexShrink: 0,
        background: av.bg, color: av.color,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 700,
      }}>
        {initials}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{clientName}</span>
          {plate && (
            <span className="mono" style={{ background: "var(--bg3)", padding: "1px 6px", borderRadius: 5, flexShrink: 0 }}>
              {plate}
            </span>
          )}
        </div>
        {description && (
          <div style={{ fontSize: 12.5, color: "var(--text2)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {description}
          </div>
        )}
      </div>
      <span className={`status-badge ${s.cls}`}>{s.label}</span>
      {isAdmin && costNum > 0 && (
        <span className="mono" style={{ color: "#16a34a", flexShrink: 0 }}>{fmtMoney(costNum)}</span>
      )}
      {date && (
        <span style={{ fontSize: 11.5, color: "var(--text3)", flexShrink: 0 }}>{fmtDate(date)}</span>
      )}
    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export function StatsTab({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const { clients, tasks, staff, freezers, finance: rawFinance, expenses } = useData();
  const { myProfile, isOwner } = useAuth();
  const { canSeeDashboardFinancials } = usePermissions();
  const role           = myProfile?.role ?? "mechanic";
  const isAdmin        = role === "admin" || role === "owner";
  const showFinance    = role !== "mechanic";
  const showAmounts    = showFinance && canSeeDashboardFinancials;

  const [showAllActive,    setShowAllActive]    = useState(false);
  const [selectedRepair,   setSelectedRepair]   = useState<EnrichedRepair | null>(null);
  const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null);

  const now          = new Date();
  const curMonthKey  = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const prevDate     = new Date(now.getFullYear(), now.getMonth()-1, 1);
  const prevMonthKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth()+1).padStart(2,"0")}`;

  // ── Flat repairs ──────────────────────────────────────────────────────────
  const allRepairs = useMemo(
    () => clients.flatMap((c) =>
      (c.repairs ?? []).map((r) => ({
        ...r,
        clientId:   c.id,
        clientName: c.name,
        vehicle:    (c.vehicles ?? []).find((v) => v.id === r.vehicleId),
      }))
    ),
    [clients],
  );

  const inProgressRepairs = allRepairs.filter((r) => repairStatus(r) === "in_progress");
  const doneRepairs       = allRepairs.filter((r) => repairStatus(r) === "done");
  const doneToday         = doneRepairs.filter((r) => repairFinancialDay(r) === now.toISOString().slice(0,10)).length;
  const activeTasks       = tasks.filter((t) => t.status !== "done").length;

  const visibleRepairs = showAllActive ? inProgressRepairs : inProgressRepairs.slice(0, 5);

  // ── Freezer rental income (fixed monthly) ────────────────────────────────
  const totalRentIncome = freezers
    .filter((f) => f.rented === true || f.status === "rented")
    .reduce((s, f) => s + (parseFloat(String(f.rentAmount ?? 0)) || 0), 0);

  // ── Monthly revenue + expenses (last 6 months) ───────────────────────────
  const monthData = useMemo(() => {
    type FinDoc = {
      boxes?:     Array<{ cost: number }>;
      salaries?:  Array<{ salary: number }>;
      elecBills?: Record<string, number>;
      purchases?: Array<{ date?: string; amount: number }>;
    };
    const fin = rawFinance as FinDoc;

    // Fixed monthly costs (box rent + salaries — same every month)
    const fixedMonthly =
      (fin.boxes    ?? []).reduce((s, b)  => s + (parseFloat(String(b.cost))    || 0), 0) +
      (fin.salaries ?? []).reduce((s, s2) => s + (parseFloat(String(s2.salary)) || 0), 0);

    // One-off purchases grouped by month
    const purchByMonth: Record<string, number> = {};
    (fin.purchases ?? []).forEach((p) => {
      const mk = p.date?.slice(0, 7);
      if (mk) purchByMonth[mk] = (purchByMonth[mk] ?? 0) + (parseFloat(String(p.amount)) || 0);
    });

    // Commissions grouped by month
    const commByMonth: Record<string, number> = {};
    expenses
      .filter((e) => e.category === "commission")
      .forEach((e) => {
        if (e.month) commByMonth[e.month] = (commByMonth[e.month] ?? 0) + (parseFloat(String(e.amount)) || 0);
      });

    const map = new Map<string, { rev: number; exp: number; cnt: number }>();
    for (let i = 5; i >= 0; i--) {
      const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mk  = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const elec  = parseFloat(String((fin.elecBills ?? {})[mk] ?? 0)) || 0;
      const purch = purchByMonth[mk] ?? 0;
      const comm  = commByMonth[mk] ?? 0;
      map.set(mk, { rev: totalRentIncome, exp: fixedMonthly + elec + purch + comm, cnt: 0 });
    }
    doneRepairs.forEach((r) => {
      const mk = repairFinancialMonth(r);
      if (!mk || !map.has(mk)) return;
      const prev = map.get(mk)!;
      map.set(mk, { ...prev, rev: prev.rev + (parseFloat(r.cost ?? "0") || 0), cnt: prev.cnt + 1 });
    });
    return Array.from(map.entries()).map(([mk, v]) => ({
      mk,
      label: MONTH_NAMES[parseInt(mk.split("-")[1]) - 1],
      ...v,
    }));
  }, [doneRepairs, rawFinance, expenses, totalRentIncome]);

  const curMonthRev  = doneRepairs.filter((r) => repairFinancialMonth(r) === curMonthKey)
    .reduce((s,r) => s + (parseFloat(r.cost ?? "0") || 0), 0) + totalRentIncome;
  const prevMonthRev = doneRepairs.filter((r) => repairFinancialMonth(r) === prevMonthKey)
    .reduce((s,r) => s + (parseFloat(r.cost ?? "0") || 0), 0) + totalRentIncome;
  const revDiff = prevMonthRev > 0 ? Math.round(((curMonthRev-prevMonthRev)/prevMonthRev)*100) : null;

  // ── Top clients ───────────────────────────────────────────────────────────
  const topClients = useMemo(() => {
    const map = new Map<string, { name: string; rev: number; cnt: number }>();
    doneRepairs.forEach((r) => {
      const prev = map.get(r.clientId) ?? { name: r.clientName, rev: 0, cnt: 0 };
      map.set(r.clientId, { ...prev, rev: prev.rev + (parseFloat(r.cost ?? "0") || 0), cnt: prev.cnt + 1 });
    });
    return Array.from(map.values()).filter((c) => c.rev > 0).sort((a,b) => b.rev-a.rev).slice(0,5);
  }, [doneRepairs]);

  // ── Revenue by service type ───────────────────────────────────────────────
  const byServiceType = useMemo(() => {
    const map = new Map<string, { label: string; emoji: string; rev: number; cnt: number }>();
    SERVICE_TYPES.forEach((s) => map.set(s.id, { label: s.label, emoji: s.emoji, rev: 0, cnt: 0 }));
    doneRepairs.forEach((r) => {
      const key  = r.serviceType ?? "other";
      const prev = map.get(key) ?? { label: key, emoji: "⚙️", rev: 0, cnt: 0 };
      map.set(key, { ...prev, rev: prev.rev + (parseFloat(r.cost ?? "0") || 0), cnt: prev.cnt + 1 });
    });
    return Array.from(map.values()).filter((s) => s.rev > 0).sort((a,b) => b.rev-a.rev);
  }, [doneRepairs]);

  // ── Mechanic stats ────────────────────────────────────────────────────────
  const mechanicStats = useMemo(() => {
    const map = new Map<string, { name: string; closed: number; active: number }>();
    staff.forEach((s) => map.set(s.id, { name: s.name ?? s.email ?? s.id, closed: 0, active: 0 }));

    clients.forEach((c) => {
      (c.repairs ?? []).forEach((r) => {
        (r.tasks ?? []).forEach((t) => {
          const st = taskStatus(t);
          (t.assignees ?? []).forEach((uid) => {
            const prev = map.get(uid) ?? { name: uid, closed: 0, active: 0 };
            map.set(uid, {
              ...prev,
              closed: prev.closed + (st === "done" ? 1 : 0),
              active: prev.active + (st !== "done" ? 1 : 0),
            });
          });
        });
      });
    });
    tasks.forEach((t) => {
      const st = t.status === "done" ? "done" : "in_progress";
      (t.assignees ?? []).forEach((uid) => {
        const prev = map.get(uid) ?? { name: uid, closed: 0, active: 0 };
        map.set(uid, {
          ...prev,
          closed: prev.closed + (st === "done" ? 1 : 0),
          active: prev.active + (st !== "done" ? 1 : 0),
        });
      });
    });

    return Array.from(map.entries())
      .filter(([, s]) => s.closed > 0 || s.active > 0)
      .sort(([, a], [, b]) => (b.closed+b.active) - (a.closed+a.active))
      .map(([uid, s]) => ({ uid, ...s }));
  }, [clients, tasks, staff]);

  // ── Mechanic monthly car count ────────────────────────────────────────────
  const mechMonthlyCars = useMemo(() => {
    const map = new Map<string, number>();
    doneRepairs
      .filter((r) => isClosedThisMonth(r, curMonthKey))
      .forEach((r) => getMechanics(r).forEach((uid) => map.set(uid, (map.get(uid) ?? 0) + 1)));
    return map;
  }, [doneRepairs, curMonthKey]);

  // ── Mechanic crown rating (current month revenue share) ───────────────────
  const mechRating = useMemo(() => {
    const mechRevenueMap = new Map<string, number>();
    const closedThisMonthAll = allRepairs.filter(
      (r) => repairFinancialMonth(r) === curMonthKey,
    );
    closedThisMonthAll.forEach((r) => {
        const cost = parseFloat(String(r.cost ?? "0").replace(/\s/g, "").replace(",", ".")) || 0;
        if (cost <= 0) return;
        const mechs = getMechanics(r);
        if (mechs.length === 0) return;
        const share = cost / mechs.length;
        mechs.forEach((uid) => {
          mechRevenueMap.set(uid, (mechRevenueMap.get(uid) ?? 0) + share);
        });
      });
    const sorted = [...mechRevenueMap.entries()].filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
    let rank = 1;
    return sorted.map(([uid, total], i) => {
      if (i > 0 && total < sorted[i - 1][1]) rank = i + 1;
      return {
        uid,
        name: staff.find((s) => s.id === uid)?.name ?? "Механик",
        rank,
        total,
        crownColor: rank === 1 ? "#FFD700" : rank === 2 ? "#C0C0C0" : null,
      };
    });
  }, [allRepairs, curMonthKey, staff]);

  // ── Customer loyalty ──────────────────────────────────────────────────────
  const loyalty = useMemo(() => {
    const withRepairs = clients.filter((c) => (c.repairs ?? []).filter((r) => repairStatus(r) === "done").length > 0);
    const total   = withRepairs.length;
    const repeats = withRepairs.filter((c) => (c.repairs ?? []).filter((r) => repairStatus(r) === "done").length > 1).length;
    return { total, repeats, pct: total > 0 ? Math.round((repeats/total)*100) : 0 };
  }, [clients]);

  // ── Freon consumption report ──────────────────────────────────────────────
  const freonData = useMemo(() => {
    const byType:  Record<string, number>                 = {};
    const byMonth: Record<string, Record<string, number>> = {};
    let total = 0;

    allRepairs.forEach((r) => {
      let amt = parseFloat(r.freonAmount ?? "") || 0;
      if (amt <= 0) {
        (r.tasks ?? []).forEach((t) => {
          if (t.freonTask && t.freonKg) {
            const kg = parseFloat(t.freonKg) || 0;
            if (kg > 0) amt = kg;
          }
        });
      }
      if (amt <= 0) return;

      const typ = r.freonType || "Не указан";
      total += amt;
      byType[typ] = (byType[typ] ?? 0) + amt;

      if (r.date) {
        const mk = r.date.substring(0, 7);
        if (!byMonth[mk]) byMonth[mk] = {};
        byMonth[mk][typ] = (byMonth[mk][typ] ?? 0) + amt;
      }
    });

    const types = Object.entries(byType)
      .sort(([, a], [, b]) => b - a)
      .map(([type, kg]) => ({ type, kg }));

    const months = Object.entries(byMonth)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([key, data]) => ({
        key,
        total: Object.values(data).reduce((s, v) => s + v, 0),
        types: Object.entries(data)
          .sort(([, a], [, b]) => b - a)
          .map(([type, kg]) => ({ type, kg })),
      }));

    return { total, types, months };
  }, [allRepairs]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Quick Actions */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, animation: "fadeUp 0.45s ease 0.15s both" }}>
        <QuickAction icon="ti-plus"          label="Новая заявка" onClick={() => onNavigate("phys")}     />
        <QuickAction icon="ti-list-check"    label="Мои задачи"   onClick={() => onNavigate("mytasks")}  />
        <QuickAction icon="ti-calendar"      label="Записи"       onClick={() => onNavigate("calendar")} />
      </div>

      {/* KPI grid */}
      <div className="kpi-grid">
        <KpiCard
          label="В работе" icon="ti-tools" accent="blue" color="var(--accent2)"
          value={inProgressRepairs.length}
          delta={activeTasks > 0 ? `+${activeTasks} задач` : undefined}
          deltaUp={activeTasks > 0}
        />
        {showAmounts && (
          <KpiCard
            label="Выручка / месяц" icon="ti-currency-ruble" accent="green" color="#16a34a"
            value={curMonthRev > 0 ? fmtMoney(curMonthRev) : "—"}
            delta={revDiff !== null ? `${revDiff >= 0 ? "+" : ""}${revDiff}% к пр. мес` : undefined}
            deltaUp={revDiff !== null ? revDiff >= 0 : undefined}
          />
        )}
        <KpiCard
          label="Закрыто сегодня" icon="ti-clock" accent="yellow" color="#b45309"
          value={doneToday}
          delta={doneRepairs.length > 0 ? `всего ${doneRepairs.length}` : undefined}
        />
        <KpiCard
          label="Клиентов" icon="ti-users" accent="purple" color="#7c3aed"
          value={clients.length}
          delta={`${inProgressRepairs.length} в ремонте`}
        />
      </div>

      {/* Active repairs */}
      <Section
        title="Заявки в работе"
        icon="ti-clipboard-list"
        count={`${inProgressRepairs.length} записей`}
        actions={
          inProgressRepairs.length > 5 && (
            <button className="btn-ghost" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => setShowAllActive((v) => !v)}>
              {showAllActive ? "Свернуть" : `Все ${inProgressRepairs.length}`}
            </button>
          )
        }
      >
        {inProgressRepairs.length === 0 ? (
          <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
            Нет заявок в работе
          </div>
        ) : (
          (visibleRepairs || []).map((r, i) => (
            <div key={r.id} onClick={() => setSelectedRepair(r as EnrichedRepair)} style={{ cursor: "pointer" }}>
              <RepairCard
                idx={i}
                clientName={r.clientName}
                description={r.description}
                date={r.date}
                cost={r.cost}
                status="in_progress"
                plate={r.vehicle?.plate}
                isAdmin={showFinance}
              />
            </div>
          ))
        )}
      </Section>

      {/* Finance: Revenue chart */}
      {showFinance && (
        <div className="crm-section" style={{ animation: "fadeUp 0.45s ease 0.4s both" }}>
          <div className="section-header">
            <i className="ti ti-chart-bar" style={{ fontSize: 17, color: "var(--text2)" }} />
            <span className="section-title">Выручка по месяцам</span>
            {revDiff !== null && (
              <div className="section-actions">
                <span style={{ fontSize: 12, color: revDiff >= 0 ? "#16a34a" : "#dc2626", fontFamily: "JetBrains Mono, monospace" }}>
                  {revDiff >= 0 ? "↑" : "↓"} {Math.abs(revDiff)}%
                </span>
              </div>
            )}
          </div>
          <RevenueChart monthData={monthData} onBarClick={showAmounts ? setSelectedMonthKey : undefined} hideAmounts={!showAmounts} />
          {showAmounts && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 20px", borderTop: "1px solid var(--border)" }}>
              <div>
                <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.5px" }}>{MONTH_NAMES[now.getMonth()]}</div>
                <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: "#16a34a", marginTop: 2 }}>{fmtMoney(curMonthRev)}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.5px" }}>{MONTH_NAMES[prevDate.getMonth()]}</div>
                <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: "var(--text3)", marginTop: 2 }}>{fmtMoney(prevMonthRev)}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mechanic productivity — all users */}
      {mechanicStats.length > 0 && (
        <div className="crm-section" style={{ animation: "fadeUp 0.45s ease 0.4s both" }}>
          <div className="section-header">
            <i className="ti ti-users" style={{ fontSize: 17, color: "var(--text2)" }} />
            <span className="section-title">Механики</span>
            <span className="section-count">нагрузка</span>
          </div>
          <div className="mechanic-list">
            {(mechanicStats || []).slice(0, 4).map((m, i) => (
              <MechanicRow
                key={m.uid}
                name={m.name}
                monthlyCars={mechMonthlyCars.get(m.uid) ?? 0}
                monthLabel={`${MONTH_NAMES_FULL[now.getMonth()].toLowerCase()} ${now.getFullYear()}`}
                idx={i}
                crownColor={mechRating.find((e) => e.uid === m.uid)?.crownColor}
              />
            ))}
          </div>
        </div>
      )}

      {/* Finance: Mechanic revenue breakdown — owner only */}
      {isOwner && mechRating.length > 0 && (
        <>
          <style>{`@keyframes glow{0%,100%{text-shadow:0 0 6px #FFD700,0 0 12px #FFD700}50%{text-shadow:0 0 2px #FFD700}}`}</style>
          <Section
            title={`Выручка механиков — ${MONTH_NAMES_FULL[now.getMonth()]}`}
            icon="ti-currency-ruble"
            count={`${mechRating.length} чел.`}
          >
            <div style={{ padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
              {mechRating.map((m) => (
                <div key={m.uid} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{
                    fontSize: 12, color: "var(--text3)", width: 20,
                    textAlign: "right", flexShrink: 0, fontFamily: "JetBrains Mono, monospace",
                  }}>
                    {m.rank}.
                  </span>
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>
                    {m.name}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)", fontFamily: "JetBrains Mono, monospace", flexShrink: 0 }}>
                    {Math.round(m.total).toLocaleString("ru-RU")} ₽
                  </span>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}

      {/* Finance: Top clients */}
      {showAmounts && topClients.length > 0 && (
        <Section title="Топ клиентов по выручке" icon="ti-trophy" count={`${topClients.length}`}>
          <div style={{ padding: "16px 20px" }}>
            {(topClients || []).map((c) => (
              <BarRow
                key={c.name}
                label={c.name}
                value={c.rev}
                maxValue={topClients[0].rev}
                valueLabel={fmtMoney(c.rev)}
                sub={`${c.cnt} нарядов`}
              />
            ))}
          </div>
        </Section>
      )}

      {/* Finance: Revenue by service type */}
      {showAmounts && byServiceType.length > 0 && (
        <Section title="Выручка по типам услуг" icon="ti-chart-pie" count={`${byServiceType.length}`}>
          <div style={{ padding: "16px 20px" }}>
            {(byServiceType || []).map((s) => (
              <BarRow
                key={s.label}
                label={`${s.emoji} ${s.label}`}
                value={s.rev}
                maxValue={byServiceType[0].rev}
                valueLabel={fmtMoney(s.rev)}
                sub={`${s.cnt} нарядов · ср. чек ${s.cnt > 0 ? fmtMoney(Math.round(s.rev/s.cnt)) : "—"}`}
              />
            ))}
          </div>
        </Section>
      )}

      {/* Finance: Loyalty */}
      {showFinance && loyalty.total > 0 && (
        <Section title="Лояльность клиентов" icon="ti-heart">
          <div style={{ padding: "16px 20px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 16 }}>
              {[
                { n: loyalty.total,   label: "Всего",     color: "var(--accent2)" },
                { n: loyalty.repeats, label: "Повторно",  color: "#16a34a"        },
                { n: `${loyalty.pct}%`, label: "Возврат", color: "#7c3aed"        },
              ].map((item) => (
                <div key={item.label} style={{
                  background: "var(--bg3)", borderRadius: 10, padding: "12px 8px",
                  border: "1px solid var(--border)", textAlign: "center",
                }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: item.color, fontFamily: "JetBrains Mono, monospace" }}>
                    {item.n}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 3 }}>{item.label}</div>
                </div>
              ))}
            </div>
            <div style={{ height: 4, borderRadius: 2, background: "var(--bg3)", overflow: "hidden" }}>
              <div style={{
                height: "100%", width: `${loyalty.pct}%`, borderRadius: 2,
                background: "linear-gradient(90deg, var(--green), #84cc16)",
                animation: "progressGrow 1s ease 0.6s both",
              }} />
            </div>
            <div style={{ fontSize: 11, color: "var(--text3)", textAlign: "center", marginTop: 6 }}>
              Чем выше % — тем сильнее клиентская база
            </div>
          </div>
        </Section>
      )}

      {/* Finance: Freon consumption */}
      {showFinance && freonData.total > 0 && (
        <Section
          title="Расход фреона"
          icon="ti-snowflake"
          count={`${freonData.total.toFixed(1)} кг`}
        >
          {/* Bar chart by month */}
          {freonData.months.length > 0 && (
            <div>
              <div style={{ padding: "12px 20px 4px", fontSize: 10, color: "var(--text3)", textTransform: "uppercase" as const, letterSpacing: "0.5px" }}>
                По месяцам
              </div>
              <FreonMonthChart months={freonData.months} />
            </div>
          )}

          {/* Total by type */}
          <div style={{ padding: "12px 20px 4px", fontSize: 10, color: "var(--text3)", textTransform: "uppercase" as const, letterSpacing: "0.5px", borderTop: freonData.months.length > 0 ? "1px solid var(--border)" : undefined }}>
            Итого по типам фреона
          </div>
          <div style={{ padding: "4px 20px 12px" }}>
            {freonData.types.map((t) => (
              <BarRow
                key={t.type}
                label={`❄️ ${t.type}`}
                value={t.kg}
                maxValue={freonData.types[0].kg}
                valueLabel={`${t.kg.toFixed(1)} кг`}
              />
            ))}
          </div>

          {/* Monthly breakdown table */}
          {freonData.months.length > 0 && (
            <>
              <div style={{ padding: "4px 20px 8px", fontSize: 10, color: "var(--text3)", textTransform: "uppercase" as const, letterSpacing: "0.5px", borderTop: "1px solid var(--border)" }}>
                Детализация по месяцам
              </div>
              <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
                {freonData.months.map((m) => (
                  <div key={m.key} style={{ background: "var(--bg3)", borderRadius: 10, padding: "8px 12px", border: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: m.types.length > 1 ? 4 : 0 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{freonMonthLabel(m.key)}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#0891b2", fontFamily: "JetBrains Mono, monospace" }}>{m.total.toFixed(1)} кг</span>
                    </div>
                    {m.types.length > 1 && m.types.map((t) => (
                      <div key={t.type} style={{ display: "flex", justifyContent: "space-between", padding: "2px 6px", fontSize: 11 }}>
                        <span style={{ color: "var(--text3)" }}>❄️ {t.type}</span>
                        <span style={{ color: "#0e7490" }}>{t.kg.toFixed(1)} кг</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </Section>
      )}

      {selectedRepair && (
        <RepairDetailModal
          repair={selectedRepair}
          isAdmin={showFinance}
          onClose={() => setSelectedRepair(null)}
        />
      )}

      {selectedMonthKey && (
        <MonthDetailModal
          mk={selectedMonthKey}
          doneRepairs={doneRepairs}
          rawFinance={rawFinance}
          expenses={expenses}
          rentalIncome={totalRentIncome}
          onClose={() => setSelectedMonthKey(null)}
        />
      )}

    </div>
  );
}
