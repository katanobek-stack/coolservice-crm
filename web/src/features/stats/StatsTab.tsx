import { useMemo, useState } from "react";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import { repairStatus, taskStatus, SERVICE_TYPES } from "../../shared/utils/repair";
import { fmtMoney, fmtDate } from "../../shared/utils/format";
import type { Tab } from "../../app/AppShell";

const MONTH_NAMES = ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"];

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

function RevenueChart({ monthData }: { monthData: { label: string; rev: number; cnt: number }[] }) {
  const maxRev  = Math.max(...monthData.map((m) => m.rev), 1);
  const hasData = monthData.some((m) => m.rev > 0);
  return (
    <div className="chart-bars">
      {monthData.map((m, i) => {
        const isLast = i === monthData.length - 1;
        const pct    = m.rev > 0 ? Math.max(8, (m.rev / maxRev) * 100) : 3;
        return (
          <div key={i} className="bar-wrap">
            {m.rev > 0 && (
              <span className="bar-value" style={isLast ? { color: "var(--cyan)" } : undefined}>
                {fmtK(m.rev)}
              </span>
            )}
            <div
              className={`bar ${isLast && hasData ? "active" : ""}`}
              style={{ height: `${pct}%`, animationDelay: `${0.5 + i * 0.06}s`, opacity: m.rev > 0 ? undefined : 0.2 }}
            />
            <span className="bar-label" style={isLast ? { color: "var(--cyan)" } : undefined}>
              {m.label}
            </span>
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
  { bg: "rgba(59,130,246,0.15)",  color: "#60a5fa", bar: "var(--yellow)" },
  { bg: "rgba(34,197,94,0.15)",   color: "#4ade80", bar: "var(--green)"  },
  { bg: "rgba(139,92,246,0.15)",  color: "#a78bfa", bar: "var(--accent)" },
  { bg: "rgba(6,182,212,0.15)",   color: "#22d3ee", bar: "var(--cyan)"   },
];

function MechanicRow({ name, active, total, idx }: { name: string; active: number; total: number; idx: number }) {
  const c      = MECH_COLORS[idx % MECH_COLORS.length];
  const initials = name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  const pct    = total > 0 ? Math.round((active / total) * 100) : 0;
  return (
    <div className="mechanic-row" style={{ animationDelay: `${0.5 + idx * 0.06}s` }}>
      <div className="mech-avatar" style={{ background: c.bg, color: c.color }}>{initials}</div>
      <div className="mech-info">
        <div className="mech-name">{name}</div>
        <div className="mech-tasks">{active} в работе · {total - active} закрыто</div>
      </div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${pct}%`, background: c.bar }} />
      </div>
    </div>
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
  { bg: "rgba(239,68,68,0.15)",   color: "#f87171" },
  { bg: "rgba(59,130,246,0.15)",  color: "#60a5fa" },
  { bg: "rgba(34,197,94,0.15)",   color: "#4ade80" },
  { bg: "rgba(139,92,246,0.15)",  color: "#a78bfa" },
  { bg: "rgba(6,182,212,0.15)",   color: "#22d3ee" },
  { bg: "rgba(245,158,11,0.15)",  color: "#fbbf24" },
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
  const initials = clientName.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
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
        <span className="mono" style={{ color: "#4ade80", flexShrink: 0 }}>{fmtMoney(costNum)}</span>
      )}
      {date && (
        <span style={{ fontSize: 11.5, color: "var(--text3)", flexShrink: 0 }}>{fmtDate(date)}</span>
      )}
    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export function StatsTab({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const { clients, tasks, staff } = useData();
  const { myProfile } = useAuth();
  const role    = myProfile?.role ?? "mechanic";
  const isAdmin = role === "admin";

  const [showAllActive, setShowAllActive] = useState(false);

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
  const doneToday         = doneRepairs.filter((r) => r.date?.slice(0,10) === now.toISOString().slice(0,10)).length;
  const activeTasks       = tasks.filter((t) => t.status !== "done").length;

  const visibleRepairs = showAllActive ? inProgressRepairs : inProgressRepairs.slice(0, 5);

  // ── Monthly revenue (last 6 months) ──────────────────────────────────────
  const monthData = useMemo(() => {
    const map = new Map<string, { rev: number; cnt: number }>();
    for (let i = 5; i >= 0; i--) {
      const d  = new Date(now.getFullYear(), now.getMonth()-i, 1);
      const mk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      map.set(mk, { rev: 0, cnt: 0 });
    }
    doneRepairs.forEach((r) => {
      const mk = r.date?.slice(0,7);
      if (!mk || !map.has(mk)) return;
      const prev = map.get(mk)!;
      map.set(mk, { rev: prev.rev + (parseFloat(r.cost ?? "0") || 0), cnt: prev.cnt + 1 });
    });
    return Array.from(map.entries()).map(([mk, v]) => ({
      label: MONTH_NAMES[parseInt(mk.split("-")[1])-1],
      ...v,
    }));
  }, [doneRepairs]);

  const curMonthRev  = doneRepairs.filter((r) => r.date?.slice(0,7) === curMonthKey)
    .reduce((s,r) => s + (parseFloat(r.cost ?? "0") || 0), 0);
  const prevMonthRev = doneRepairs.filter((r) => r.date?.slice(0,7) === prevMonthKey)
    .reduce((s,r) => s + (parseFloat(r.cost ?? "0") || 0), 0);
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

    return Array.from(map.values())
      .filter((s) => s.closed > 0 || s.active > 0)
      .sort((a,b) => (b.closed+b.active) - (a.closed+a.active));
  }, [clients, tasks, staff]);

  // ── Customer loyalty ──────────────────────────────────────────────────────
  const loyalty = useMemo(() => {
    const withRepairs = clients.filter((c) => (c.repairs ?? []).filter((r) => repairStatus(r) === "done").length > 0);
    const total   = withRepairs.length;
    const repeats = withRepairs.filter((c) => (c.repairs ?? []).filter((r) => repairStatus(r) === "done").length > 1).length;
    return { total, repeats, pct: total > 0 ? Math.round((repeats/total)*100) : 0 };
  }, [clients]);

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
        <KpiCard
          label="Выручка / месяц" icon="ti-currency-ruble" accent="green" color="#4ade80"
          value={curMonthRev > 0 ? fmtMoney(curMonthRev) : "—"}
          delta={revDiff !== null ? `${revDiff >= 0 ? "+" : ""}${revDiff}% к пр. мес` : undefined}
          deltaUp={revDiff !== null ? revDiff >= 0 : undefined}
        />
        <KpiCard
          label="Закрыто сегодня" icon="ti-clock" accent="yellow" color="#fbbf24"
          value={doneToday}
          delta={doneRepairs.length > 0 ? `всего ${doneRepairs.length}` : undefined}
        />
        <KpiCard
          label="Клиентов" icon="ti-users" accent="purple" color="#a78bfa"
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
          visibleRepairs.map((r, i) => (
            <RepairCard
              key={r.id}
              idx={i}
              clientName={r.clientName}
              description={r.description}
              date={r.date}
              cost={r.cost}
              status="in_progress"
              plate={r.vehicle?.plate}
              isAdmin={isAdmin}
            />
          ))
        )}
      </Section>

      {/* Admin: Revenue chart + mechanics */}
      {isAdmin && (
        <div className="bottom-grid">
          {/* Revenue chart */}
          <div className="crm-section" style={{ animation: "fadeUp 0.45s ease 0.4s both" }}>
            <div className="section-header">
              <i className="ti ti-chart-bar" style={{ fontSize: 17, color: "var(--text2)" }} />
              <span className="section-title">Выручка по месяцам</span>
              {revDiff !== null && (
                <div className="section-actions">
                  <span style={{ fontSize: 12, color: revDiff >= 0 ? "#4ade80" : "#f87171", fontFamily: "JetBrains Mono, monospace" }}>
                    {revDiff >= 0 ? "↑" : "↓"} {Math.abs(revDiff)}%
                  </span>
                </div>
              )}
            </div>
            <RevenueChart monthData={monthData} />
            <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 20px", borderTop: "1px solid var(--border)" }}>
              <div>
                <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.5px" }}>{MONTH_NAMES[now.getMonth()]}</div>
                <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: "#4ade80", marginTop: 2 }}>{fmtMoney(curMonthRev)}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.5px" }}>{MONTH_NAMES[prevDate.getMonth()]}</div>
                <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: "var(--text3)", marginTop: 2 }}>{fmtMoney(prevMonthRev)}</div>
              </div>
            </div>
          </div>

          {/* Mechanic productivity */}
          {mechanicStats.length > 0 && (
            <div className="crm-section" style={{ animation: "fadeUp 0.45s ease 0.4s both" }}>
              <div className="section-header">
                <i className="ti ti-users" style={{ fontSize: 17, color: "var(--text2)" }} />
                <span className="section-title">Механики</span>
                <span className="section-count">нагрузка</span>
              </div>
              <div className="mechanic-list">
                {mechanicStats.slice(0, 4).map((m, i) => (
                  <MechanicRow
                    key={m.name}
                    name={m.name}
                    active={m.active}
                    total={m.active + m.closed}
                    idx={i}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Admin: Top clients */}
      {isAdmin && topClients.length > 0 && (
        <Section title="Топ клиентов по выручке" icon="ti-trophy" count={`${topClients.length}`}>
          <div style={{ padding: "16px 20px" }}>
            {topClients.map((c) => (
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

      {/* Admin: Revenue by service type */}
      {isAdmin && byServiceType.length > 0 && (
        <Section title="Выручка по типам услуг" icon="ti-chart-pie" count={`${byServiceType.length}`}>
          <div style={{ padding: "16px 20px" }}>
            {byServiceType.map((s) => (
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

      {/* Admin: Loyalty */}
      {isAdmin && loyalty.total > 0 && (
        <Section title="Лояльность клиентов" icon="ti-heart">
          <div style={{ padding: "16px 20px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 16 }}>
              {[
                { n: loyalty.total,   label: "Всего",     color: "var(--accent2)" },
                { n: loyalty.repeats, label: "Повторно",  color: "#4ade80"        },
                { n: `${loyalty.pct}%`, label: "Возврат", color: "#a78bfa"        },
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

    </div>
  );
}
