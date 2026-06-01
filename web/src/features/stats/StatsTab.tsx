import { useMemo } from "react";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import { repairStatus } from "../../shared/utils/repair";
import { fmtMoney } from "../../shared/utils/format";
import type { Tab } from "../../app/AppShell";

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  color = "#185FA5",
  sub,
}: {
  label: string;
  value: string | number;
  color?: string;
  sub?: string;
}) {
  return (
    <div className="bg-white rounded-[18px] p-4 border border-[#E2E8F0] shadow-sm flex flex-col gap-1">
      <div className="text-2xl font-bold" style={{ color }}>{value}</div>
      <div className="text-xs text-[#667085]">{label}</div>
      {sub && <div className="text-[10px] text-[#98A2B3]">{sub}</div>}
    </div>
  );
}

// ─── Quick action ─────────────────────────────────────────────────────────────

function QuickAction({
  icon, label, color, bg, onClick,
}: {
  icon: string; label: string; color: string; bg: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-white rounded-[18px] border border-[#E2E8F0] flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all active:scale-95 shadow-sm"
      style={{ minHeight: 74 }}
    >
      <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xl" style={{ background: bg, color }}>
        {icon}
      </div>
      <span className="text-xs font-bold text-[#172033]">{label}</span>
    </button>
  );
}

// ─── Bar chart (SVG, 6 months) ────────────────────────────────────────────────

function RevenueChart({ monthData }: { monthData: { label: string; rev: number; cnt: number }[] }) {
  const maxRev = Math.max(...monthData.map((m) => m.rev), 1);
  const W = 320, H = 120, PL = 8, PR = 8, PT = 20, PB = 28;
  const cW = W - PL - PR;
  const cH = H - PT - PB;
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
      {/* Grid lines */}
      {[0, 1, 2, 3].map((i) => {
        const gy = PT + cH * (i / 3);
        return <line key={i} x1={PL} y1={gy} x2={W - PR} y2={gy} stroke="rgba(15,23,42,.06)" strokeWidth="1" />;
      })}
      {monthData.map((m, i) => {
        const x    = PL + i * barGap + (barGap - barW) / 2;
        const barH = m.rev > 0 ? Math.max(4, Math.round((m.rev / maxRev) * cH)) : 2;
        const y    = PT + cH - barH;
        const isLast = i === monthData.length - 1;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} rx="4"
              fill={isLast ? "url(#barGrad)" : "rgba(24,95,165,.25)"} />
            {m.cnt > 0 && (
              <text x={x + barW / 2} y={y - 4} textAnchor="middle"
                fill="rgba(24,95,165,.8)" fontSize="9" fontWeight="700">
                {m.cnt}
              </text>
            )}
            {m.rev > 0 && (
              <text x={x + barW / 2} y={y - 14} textAnchor="middle"
                fill="rgba(24,95,165,.55)" fontSize="8">
                {(m.rev / 1000).toFixed(0)}к
              </text>
            )}
            <text x={x + barW / 2} y={H - 6} textAnchor="middle"
              fill="rgba(148,163,184,.7)" fontSize="9">
              {m.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Top clients bar ──────────────────────────────────────────────────────────

function TopClients({
  items,
}: {
  items: { name: string; rev: number; cnt: number }[];
}) {
  const maxRev = items[0]?.rev || 1;
  return (
    <div className="space-y-2.5">
      {items.map((c, i) => (
        <div key={i}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-[#344054] truncate flex-1 pr-2">{c.name}</span>
            <span className="text-xs font-bold text-[#185FA5] whitespace-nowrap">{fmtMoney(c.rev)}</span>
          </div>
          <div className="h-1 rounded-full bg-[#E2E8F0] overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#185FA5] to-[#7CB7EA]"
              style={{ width: `${(c.rev / maxRev) * 100}%` }}
            />
          </div>
          <div className="text-[10px] text-[#98A2B3] mt-0.5">{c.cnt} нарядов</div>
        </div>
      ))}
    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export function StatsTab({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const { clients, tasks } = useData();
  const { myProfile } = useAuth();
  const role    = myProfile?.role ?? "mechanic";
  const isAdmin = role === "admin";

  const now = new Date();
  const curMonthKey  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prevDate     = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

  // All repairs flat
  const allRepairs = useMemo(
    () => clients.flatMap((c) => (c.repairs ?? []).map((r) => ({ ...r, clientId: c.id, clientName: c.name }))),
    [clients],
  );

  const inProgress  = allRepairs.filter((r) => repairStatus(r) === "in_progress").length;
  const doneAll     = allRepairs.filter((r) => repairStatus(r) === "done");
  const doneToday   = doneAll.filter((r) => r.date?.slice(0, 10) === now.toISOString().slice(0, 10)).length;
  const activeTasks = tasks.filter((t) => t.status !== "done").length;
  const totalClients = clients.length;

  // Monthly revenue data (last 6 months)
  const MONTH_NAMES = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
  const monthData = useMemo(() => {
    const map = new Map<string, { rev: number; cnt: number }>();
    for (let i = 5; i >= 0; i--) {
      const d  = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      map.set(mk, { rev: 0, cnt: 0 });
    }
    doneAll.forEach((r) => {
      const mk = r.date?.slice(0, 7);
      if (!mk || !map.has(mk)) return;
      const prev = map.get(mk)!;
      map.set(mk, { rev: prev.rev + (parseFloat(r.cost ?? "0") || 0), cnt: prev.cnt + 1 });
    });
    return Array.from(map.entries()).map(([mk, v]) => ({
      label: MONTH_NAMES[parseInt(mk.split("-")[1]) - 1],
      ...v,
    }));
  }, [doneAll]);

  const curMonthRev  = doneAll.filter((r) => r.date?.slice(0, 7) === curMonthKey)
    .reduce((s, r) => s + (parseFloat(r.cost ?? "0") || 0), 0);
  const prevMonthRev = doneAll.filter((r) => r.date?.slice(0, 7) === prevMonthKey)
    .reduce((s, r) => s + (parseFloat(r.cost ?? "0") || 0), 0);
  const revDiff = prevMonthRev > 0 ? Math.round(((curMonthRev - prevMonthRev) / prevMonthRev) * 100) : null;

  // Top clients by revenue
  const topClients = useMemo(() => {
    const map = new Map<string, { name: string; rev: number; cnt: number }>();
    doneAll.forEach((r) => {
      const prev = map.get(r.clientId) ?? { name: r.clientName, rev: 0, cnt: 0 };
      map.set(r.clientId, { ...prev, rev: prev.rev + (parseFloat(r.cost ?? "0") || 0), cnt: prev.cnt + 1 });
    });
    return Array.from(map.values())
      .filter((c) => c.rev > 0)
      .sort((a, b) => b.rev - a.rev)
      .slice(0, 5);
  }, [doneAll]);

  const totalRevenue = doneAll.reduce((s, r) => s + (parseFloat(r.cost ?? "0") || 0), 0);

  return (
    <div className="p-4">
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

      {/* KPI Grid */}
      <div className="grid grid-cols-2 gap-2.5 mb-4">
        <StatCard label="В работе"          value={inProgress}   color="#BA7517" />
        <StatCard label="Закрыто сегодня"   value={doneToday}    color="#3B6D11" />
        <StatCard label="Активные задачи"   value={activeTasks}  color="#185FA5" />
        <StatCard label="Всего клиентов"    value={totalClients} color="#667085" />
      </div>

      {/* Revenue chart — admin only */}
      {isAdmin && (
        <>
          <div className="bg-white rounded-[18px] p-4 border border-[#E2E8F0] shadow-sm mb-3">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-bold text-[#667085] uppercase tracking-wide">
                Выручка по месяцам
              </div>
              {revDiff !== null && (
                <span className={`text-xs font-bold ${revDiff >= 0 ? "text-[#3B6D11]" : "text-[#A32D2D]"}`}>
                  {revDiff >= 0 ? "↑" : "↓"} {Math.abs(revDiff)}%
                </span>
              )}
            </div>
            <RevenueChart monthData={monthData} />
            {/* Month comparison */}
            <div className="flex justify-between mt-3 pt-3 border-t border-[#E2E8F0]">
              <div>
                <div className="text-[10px] text-[#98A2B3] font-semibold uppercase">
                  {MONTH_NAMES[now.getMonth()]}
                </div>
                <div className="text-base font-bold text-[#185FA5]">{fmtMoney(curMonthRev)}</div>
                <div className="text-[10px] text-[#98A2B3]">
                  {monthData.at(-1)?.cnt ?? 0} нарядов
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-[#98A2B3] font-semibold uppercase">
                  {MONTH_NAMES[prevDate.getMonth()]}
                </div>
                <div className="text-base font-bold text-[#98A2B3]">{fmtMoney(prevMonthRev)}</div>
                <div className="text-[10px] text-[#98A2B3]">
                  {monthData.at(-2)?.cnt ?? 0} нарядов
                </div>
              </div>
            </div>
          </div>

          {/* Total revenue */}
          <div className="bg-white rounded-[18px] p-4 border border-[#E2E8F0] shadow-sm mb-3">
            <div className="text-xs text-[#667085] mb-1 font-semibold uppercase tracking-wide">
              Общая выручка
            </div>
            <div className="text-2xl font-bold text-[#3B6D11]">{fmtMoney(totalRevenue)}</div>
            <div className="text-xs text-[#98A2B3]">{doneAll.length} закрытых нарядов</div>
          </div>

          {/* Top clients */}
          {topClients.length > 0 && (
            <div className="bg-white rounded-[18px] p-4 border border-[#E2E8F0] shadow-sm mb-3">
              <div className="text-xs font-bold text-[#667085] uppercase tracking-wide mb-3">
                🏆 Топ клиентов
              </div>
              <TopClients items={topClients} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
