import { useMemo, useState } from "react";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import { repairStatus, taskStatus, SERVICE_TYPES } from "../../shared/utils/repair";
import { fmtMoney, fmtDate } from "../../shared/utils/format";
import type { Tab } from "../../app/AppShell";

const MONTH_NAMES = ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"];
const MONTH_NAMES_FULL = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];

// ─── UI primitives ────────────────────────────────────────────────────────────

function StatCard({ label, value, color = "#185FA5", sub }: {
  label: string; value: string | number; color?: string; sub?: string;
}) {
  return (
    <div className="bg-white rounded-[18px] p-4 border border-[#E2E8F0] shadow-sm flex flex-col gap-1">
      <div className="text-2xl font-bold" style={{ color }}>{value}</div>
      <div className="text-xs text-[#667085]">{label}</div>
      {sub && <div className="text-[10px] text-[#98A2B3]">{sub}</div>}
    </div>
  );
}

function SectionCard({ title, children, icon }: {
  title: string; children: React.ReactNode; icon?: string;
}) {
  return (
    <div className="bg-white rounded-[18px] p-4 border border-[#E2E8F0] shadow-sm mb-3">
      <div className="text-xs font-bold text-[#667085] uppercase tracking-wide mb-3">
        {icon && <span className="mr-1">{icon}</span>}{title}
      </div>
      {children}
    </div>
  );
}

function QuickAction({ icon, label, color, bg, onClick }: {
  icon: string; label: string; color: string; bg: string; onClick: () => void;
}) {
  return (
    <button
      type="button" onClick={onClick}
      className="bg-white rounded-[18px] border border-[#E2E8F0] flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all active:scale-95 shadow-sm"
      style={{ minHeight: 74 }}
    >
      <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xl" style={{ background: bg, color }}>{icon}</div>
      <span className="text-xs font-bold text-[#172033]">{label}</span>
    </button>
  );
}

// Collapsible section
function Collapsible({ label, badge, badgeColor = "#185FA5", children }: {
  label: string; badge?: string | number; badgeColor?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 bg-white rounded-[16px] px-4 py-3 border border-[#E2E8F0] shadow-sm cursor-pointer text-left"
      >
        <span className={`text-xs transition-transform duration-200 ${open ? "rotate-90" : ""}`}>▶</span>
        <span className="text-sm font-semibold text-[#172033] flex-1">{label}</span>
        {badge !== undefined && (
          <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: `${badgeColor}18`, color: badgeColor }}>
            {badge}
          </span>
        )}
      </button>
      {open && <div className="mt-1.5 space-y-1.5">{children}</div>}
    </div>
  );
}

// Horizontal bar row
function BarRow({ label, value, maxValue, valueLabel, sub, color = "#185FA5" }: {
  label: string; value: number; maxValue: number; valueLabel: string; sub?: string; color?: string;
}) {
  const pct = maxValue > 0 ? Math.max(2, (value / maxValue) * 100) : 2;
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-[#344054] truncate flex-1 pr-2">{label}</span>
        <span className="text-xs font-bold whitespace-nowrap" style={{ color }}>{valueLabel}</span>
      </div>
      {sub && <div className="text-[10px] text-[#98A2B3] mb-1">{sub}</div>}
      <div className="h-1 rounded-full bg-[#E2E8F0] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

// SVG revenue bar chart
function RevenueChart({ monthData }: { monthData: { label: string; rev: number; cnt: number }[] }) {
  const maxRev = Math.max(...monthData.map((m) => m.rev), 1);
  const W = 320, H = 120, PL = 8, PR = 8, PT = 20, PB = 28;
  const cW = W - PL - PR, cH = H - PT - PB;
  const barGap = Math.floor(cW / monthData.length);
  const barW   = Math.floor(barGap * 0.55);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H, display: "block" }}>
      <defs>
        <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#185FA5" stopOpacity=".9" />
          <stop offset="100%" stopColor="#7CB7EA" stopOpacity=".5" />
        </linearGradient>
      </defs>
      {[0,1,2,3].map((i) => (
        <line key={i} x1={PL} y1={PT + cH*(i/3)} x2={W-PR} y2={PT + cH*(i/3)} stroke="rgba(15,23,42,.06)" strokeWidth="1" />
      ))}
      {monthData.map((m, i) => {
        const x    = PL + i*barGap + (barGap-barW)/2;
        const barH = m.rev > 0 ? Math.max(4, Math.round((m.rev/maxRev)*cH)) : 2;
        const y    = PT + cH - barH;
        const isLast = i === monthData.length - 1;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} rx="4" fill={isLast ? "url(#barGrad)" : "rgba(24,95,165,.25)"} />
            {m.cnt > 0 && <text x={x+barW/2} y={y-4} textAnchor="middle" fill="rgba(24,95,165,.8)" fontSize="9" fontWeight="700">{m.cnt}</text>}
            {m.rev > 0 && <text x={x+barW/2} y={y-14} textAnchor="middle" fill="rgba(24,95,165,.55)" fontSize="8">{(m.rev/1000).toFixed(0)}к</text>}
            <text x={x+barW/2} y={H-6} textAnchor="middle" fill="rgba(148,163,184,.7)" fontSize="9">{m.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// Average check mini bar chart
function AvgCheckChart({ data }: { data: { label: string; avg: number }[] }) {
  const maxAvg = Math.max(...data.map((d) => d.avg), 1);
  return (
    <div className="flex items-end gap-1.5 h-16 px-1">
      {data.map((d, i) => {
        const hPct = (d.avg / maxAvg) * 100;
        const isLast = i === data.length - 1;
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div className="text-[9px] text-[#667085] font-bold">{d.avg > 0 ? `${(d.avg/1000).toFixed(0)}к` : ""}</div>
            <div
              className="w-full rounded-t-sm"
              style={{
                height: `${Math.max(hPct, 4)}%`,
                background: isLast ? "linear-gradient(180deg,#185FA5,#7CB7EA)" : "rgba(24,95,165,.3)",
                minHeight: 4,
              }}
            />
            <div className="text-[8px] text-[#98A2B3] font-semibold">{d.label}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export function StatsTab({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const { clients, tasks, staff } = useData();
  const { myProfile } = useAuth();
  const role    = myProfile?.role ?? "mechanic";
  const isAdmin = role === "admin";

  const now          = new Date();
  const curMonthKey  = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const prevDate     = new Date(now.getFullYear(), now.getMonth()-1, 1);
  const prevMonthKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth()+1).padStart(2,"0")}`;

  // ── Flat repairs ──────────────────────────────────────────────────────────
  const allRepairs = useMemo(
    () => clients.flatMap((c) =>
      (c.repairs ?? []).map((r) => ({
        ...r,
        clientId: c.id,
        clientName: c.name,
        vehicle: (c.vehicles ?? []).find((v) => v.id === r.vehicleId),
      }))
    ),
    [clients],
  );

  const inProgressRepairs = allRepairs.filter((r) => repairStatus(r) === "in_progress");
  const doneRepairs       = allRepairs.filter((r) => repairStatus(r) === "done");
  const doneToday         = doneRepairs.filter((r) => r.date?.slice(0,10) === now.toISOString().slice(0,10)).length;
  const activeTasks       = tasks.filter((t) => t.status !== "done").length;
  const totalRevenue      = doneRepairs.reduce((s, r) => s + (parseFloat(r.cost ?? "0") || 0), 0);

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

  // ── Mechanic productivity ─────────────────────────────────────────────────
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

  // ── Average check by month (last 6) ──────────────────────────────────────
  const avgCheckData = useMemo(() => {
    const map = new Map<string, { sum: number; cnt: number }>();
    for (let i = 5; i >= 0; i--) {
      const d  = new Date(now.getFullYear(), now.getMonth()-i, 1);
      const mk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      map.set(mk, { sum: 0, cnt: 0 });
    }
    doneRepairs.forEach((r) => {
      const mk = r.date?.slice(0,7);
      if (!mk || !map.has(mk) || !(parseFloat(r.cost ?? "0") > 0)) return;
      const prev = map.get(mk)!;
      map.set(mk, { sum: prev.sum + parseFloat(r.cost!), cnt: prev.cnt + 1 });
    });
    return Array.from(map.entries()).map(([mk, v]) => ({
      label: MONTH_NAMES[parseInt(mk.split("-")[1])-1],
      avg: v.cnt > 0 ? Math.round(v.sum/v.cnt) : 0,
    }));
  }, [doneRepairs]);

  const hasAvgData = avgCheckData.some((d) => d.avg > 0);

  return (
    <div className="p-4">
      {/* Header */}
      <div className="mb-4">
        <div className="text-lg font-bold text-[#172033]">Сводка</div>
        <div className="text-xs text-[#667085]">
          {now.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-3 gap-2.5 mb-4">
        <QuickAction icon="➕" label="Заявка"  color="#185FA5" bg="#E6F1FB" onClick={() => onNavigate("phys")} />
        <QuickAction icon="🔧" label="Задачи"  color="#3B6D11" bg="#EAF3DE" onClick={() => onNavigate("mytasks")} />
        <QuickAction icon="📅" label="Записи"  color="#854F0B" bg="#FAEEDA" onClick={() => onNavigate("calendar")} />
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-2.5 mb-4">
        <StatCard label="В работе"        value={inProgressRepairs.length} color="#BA7517" sub={`+ ${activeTasks} задач`} />
        <StatCard label="Закрыто сегодня" value={doneToday}                color="#3B6D11" />
        <StatCard label="Клиентов"        value={clients.length}           color="#667085" />
        <StatCard label="Всего закрыто"   value={doneRepairs.length}       color="#185FA5" />
      </div>

      {/* Active repairs — collapsible */}
      <Collapsible
        label="Заказ-наряды в работе"
        badge={inProgressRepairs.length}
        badgeColor="#BA7517"
      >
        {inProgressRepairs.length === 0 ? (
          <div className="text-center py-4 text-sm text-[#98A2B3] bg-white rounded-xl border border-[#E2E8F0]">Нет машин в ремонте</div>
        ) : (
          inProgressRepairs.map((r) => {
            const svc = SERVICE_TYPES.find((s) => s.id === r.serviceType) ?? SERVICE_TYPES[3];
            const doneTasks  = (r.tasks ?? []).filter((t) => taskStatus(t) === "done").length;
            const totalTasks = (r.tasks ?? []).length;
            return (
              <div key={r.id} className="bg-white rounded-xl border border-[#E2E8F0] p-3 shadow-sm">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-sm font-semibold text-[#172033] truncate">{r.clientName}</span>
                  {r.vehicle?.plate && (
                    <span className="text-xs bg-[#F2F4F7] px-2 py-0.5 rounded font-mono text-[#344054] flex-shrink-0">
                      {r.vehicle.plate}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap text-xs text-[#667085]">
                  <span>{svc.emoji} {svc.label}</span>
                  {r.date && <span>📅 {fmtDate(r.date)}</span>}
                </div>
                {totalTasks > 0 && (
                  <div className="mt-2">
                    <div className="flex justify-between text-[10px] text-[#98A2B3] mb-1">
                      <span>Задачи</span>
                      <span>{doneTasks}/{totalTasks}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[#E2E8F0] overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${totalTasks > 0 ? (doneTasks/totalTasks)*100 : 0}%`,
                          background: doneTasks === totalTasks ? "#3B6D11" : "linear-gradient(90deg,#BA7517,#F59E0B)",
                        }}
                      />
                    </div>
                  </div>
                )}
                {r.description && (
                  <div className="text-xs text-[#667085] mt-1.5 truncate">{r.description}</div>
                )}
              </div>
            );
          })
        )}
      </Collapsible>

      {/* Completed — collapsible */}
      {doneRepairs.length > 0 && (
        <Collapsible label="Выполненные машины" badge={doneRepairs.length} badgeColor="#3B6D11">
          {doneRepairs
            .slice()
            .sort((a,b) => (b.date ?? "").localeCompare(a.date ?? ""))
            .slice(0, 20)
            .map((r) => {
              const svc = SERVICE_TYPES.find((s) => s.id === r.serviceType) ?? SERVICE_TYPES[3];
              return (
                <div key={r.id} className="bg-white rounded-xl border border-[#E2E8F0] p-3 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-[#172033] truncate">{r.clientName}</div>
                      <div className="text-xs text-[#667085] flex items-center gap-2 mt-0.5 flex-wrap">
                        {r.vehicle?.plate && (
                          <span className="bg-[#F2F4F7] px-1.5 py-0.5 rounded font-mono text-[#344054]">
                            {r.vehicle.plate}
                          </span>
                        )}
                        <span>{svc.emoji} {svc.label}</span>
                        {r.date && <span>{fmtDate(r.date)}</span>}
                      </div>
                    </div>
                    {r.cost && isAdmin && (
                      <span className="text-sm font-bold text-[#3B6D11] flex-shrink-0">{r.cost} ₽</span>
                    )}
                  </div>
                </div>
              );
            })}
        </Collapsible>
      )}

      {/* ── Admin analytics ────────────────────────────────────────────── */}
      {isAdmin && (
        <>
          {/* Revenue chart */}
          <SectionCard title="Выручка по месяцам">
            <div className="flex items-center justify-between mb-2">
              <div />
              {revDiff !== null && (
                <span className={`text-xs font-bold ${revDiff >= 0 ? "text-[#3B6D11]" : "text-[#A32D2D]"}`}>
                  {revDiff >= 0 ? "↑" : "↓"} {Math.abs(revDiff)}% к пред. мес.
                </span>
              )}
            </div>
            <RevenueChart monthData={monthData} />
            <div className="flex justify-between mt-3 pt-3 border-t border-[#E2E8F0]">
              <div>
                <div className="text-[10px] text-[#98A2B3] font-semibold uppercase">{MONTH_NAMES[now.getMonth()]}</div>
                <div className="text-base font-bold text-[#185FA5]">{fmtMoney(curMonthRev)}</div>
                <div className="text-[10px] text-[#98A2B3]">{monthData.at(-1)?.cnt ?? 0} нарядов</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-[#98A2B3] font-semibold uppercase">{MONTH_NAMES[prevDate.getMonth()]}</div>
                <div className="text-base font-bold text-[#98A2B3]">{fmtMoney(prevMonthRev)}</div>
                <div className="text-[10px] text-[#98A2B3]">{monthData.at(-2)?.cnt ?? 0} нарядов</div>
              </div>
            </div>
          </SectionCard>

          {/* Total revenue */}
          <div className="bg-white rounded-[18px] p-4 border border-[#E2E8F0] shadow-sm mb-3">
            <div className="text-xs text-[#667085] mb-1 font-semibold uppercase tracking-wide">Общая выручка</div>
            <div className="text-2xl font-bold text-[#3B6D11]">{fmtMoney(totalRevenue)}</div>
            <div className="text-xs text-[#98A2B3]">{doneRepairs.length} закрытых нарядов</div>
          </div>

          {/* Revenue by service type */}
          {byServiceType.length > 0 && (
            <SectionCard title="Выручка по типам услуг" icon="📊">
              {byServiceType.map((s, i) => (
                <BarRow
                  key={s.label}
                  label={`${s.emoji} ${s.label}`}
                  value={s.rev}
                  maxValue={byServiceType[0].rev}
                  valueLabel={fmtMoney(s.rev)}
                  sub={`${s.cnt} нарядов · ср. чек ${s.cnt > 0 ? fmtMoney(Math.round(s.rev/s.cnt)) : "—"}`}
                  color={i === 0 ? "#185FA5" : "#7CB7EA"}
                />
              ))}
            </SectionCard>
          )}

          {/* Top clients */}
          {topClients.length > 0 && (
            <SectionCard title="Топ клиентов по выручке" icon="🏆">
              {topClients.map((c, i) => (
                <BarRow
                  key={c.name}
                  label={c.name}
                  value={c.rev}
                  maxValue={topClients[0].rev}
                  valueLabel={fmtMoney(c.rev)}
                  sub={`${c.cnt} нарядов`}
                  color={i === 0 ? "#185FA5" : "#7CB7EA"}
                />
              ))}
            </SectionCard>
          )}

          {/* Mechanic productivity */}
          {mechanicStats.length > 0 && (
            <SectionCard title="Производительность механиков" icon="🔧">
              {mechanicStats.map((m) => (
                <div key={m.name} className="flex items-center gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-[#344054] truncate">{m.name}</div>
                    <div className="text-[10px] text-[#98A2B3] mt-0.5">
                      Закрыто: {m.closed} · В работе: {m.active}
                    </div>
                    <div className="h-1 rounded-full bg-[#E2E8F0] mt-1 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#185FA5]"
                        style={{
                          width: `${(m.closed + m.active) > 0
                            ? Math.max(4, (m.closed / (m.closed + m.active)) * 100)
                            : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="text-lg font-bold text-[#3B6D11] flex-shrink-0">{m.closed}</div>
                </div>
              ))}
            </SectionCard>
          )}

          {/* Customer loyalty */}
          {loyalty.total > 0 && (
            <SectionCard title="Лояльность клиентов" icon="👥">
              <div className="grid grid-cols-3 gap-2 mb-3">
                {[
                  { n: loyalty.total,   label: "Всего",    color: "#185FA5" },
                  { n: loyalty.repeats, label: "Повторно", color: "#3B6D11" },
                  { n: loyalty.pct,     label: "% возврат",color: "#854F0B", suffix: "%" },
                ].map((item) => (
                  <div key={item.label} className="bg-[#F7F9FC] rounded-xl p-2.5 text-center border border-[#E2E8F0]">
                    <div className="text-xl font-bold" style={{ color: item.color }}>
                      {item.n}{item.suffix ?? ""}
                    </div>
                    <div className="text-[10px] text-[#98A2B3] mt-0.5">{item.label}</div>
                  </div>
                ))}
              </div>
              <div className="h-2 rounded-full bg-[#E2E8F0] overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#3B6D11] to-[#84CC16]"
                  style={{ width: `${loyalty.pct}%` }}
                />
              </div>
              <div className="text-[10px] text-[#98A2B3] mt-1.5 text-center">
                Чем выше % — тем сильнее клиентская база
              </div>
            </SectionCard>
          )}

          {/* Average check by month */}
          {hasAvgData && (
            <SectionCard title="Средний чек по месяцам" icon="💰">
              <AvgCheckChart data={avgCheckData} />
            </SectionCard>
          )}
        </>
      )}
    </div>
  );
}
