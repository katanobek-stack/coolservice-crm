import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import { repairStatus } from "../../shared/utils/repair";
import { fmtMoney } from "../../shared/utils/format";
import type { Tab } from "../../app/AppShell";

interface StatCardProps {
  label: string;
  value: string | number;
  color?: string;
  sub?: string;
}

function StatCard({ label, value, color = "#185FA5", sub }: StatCardProps) {
  return (
    <div className="bg-white rounded-[18px] p-4 border border-[#E2E8F0] shadow-sm flex flex-col gap-1">
      <div className="text-2xl font-bold" style={{ color }}>
        {value}
      </div>
      <div className="text-xs text-[#667085]">{label}</div>
      {sub && <div className="text-[10px] text-[#98A2B3]">{sub}</div>}
    </div>
  );
}

interface QuickActionProps {
  icon: string;
  label: string;
  color: string;
  bg: string;
  onClick: () => void;
}

function QuickAction({ icon, label, color, bg, onClick }: QuickActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-white rounded-[18px] border border-[#E2E8F0] flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all active:scale-95 shadow-sm"
      style={{ minHeight: 74 }}
    >
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center text-xl"
        style={{ background: bg, color }}
      >
        {icon}
      </div>
      <span className="text-xs font-bold text-[#172033]">{label}</span>
    </button>
  );
}

interface Props {
  onNavigate: (tab: Tab) => void;
}

export function StatsTab({ onNavigate }: Props) {
  const { clients, tasks } = useData();
  const { myProfile } = useAuth();
  const role = myProfile?.role ?? "mechanic";
  const isAdmin = role === "admin";

  const inProgress = clients.flatMap((c) => c.repairs ?? []).filter(
    (r) => repairStatus(r) === "in_progress",
  ).length;

  const doneToday = clients.flatMap((c) => c.repairs ?? []).filter((r) => {
    if (repairStatus(r) !== "done") return false;
    const today = new Date().toDateString();
    return r.date ? new Date(r.date).toDateString() === today : false;
  }).length;

  const totalRevenue = isAdmin
    ? clients
        .flatMap((c) => c.repairs ?? [])
        .filter((r) => repairStatus(r) === "done")
        .reduce((s, r) => s + (parseFloat(r.cost ?? "0") || 0), 0)
    : 0;

  const activeTasks = tasks.filter((t) => t.status !== "done").length;

  const totalClients = clients.length;

  return (
    <div className="p-4">
      <div className="mb-4">
        <div className="text-lg font-bold text-[#172033]">Сводка</div>
        <div className="text-xs text-[#667085]">
          {new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-3 gap-2.5 mb-4">
        <QuickAction
          icon="➕"
          label="Заявка"
          color="#185FA5"
          bg="#E6F1FB"
          onClick={() => onNavigate("phys")}
        />
        <QuickAction
          icon="🔧"
          label="Задачи"
          color="#3B6D11"
          bg="#EAF3DE"
          onClick={() => onNavigate("mytasks")}
        />
        <QuickAction
          icon="📦"
          label="Склад"
          color="#854F0B"
          bg="#FAEEDA"
          onClick={() => onNavigate("freezers")}
        />
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-2.5 mb-4">
        <StatCard label="В работе" value={inProgress} color="#BA7517" />
        <StatCard label="Завершено сегодня" value={doneToday} color="#3B6D11" />
        <StatCard label="Задачи" value={activeTasks} color="#185FA5" />
        <StatCard label="Клиентов" value={totalClients} color="#667085" />
      </div>

      {isAdmin && (
        <div className="bg-white rounded-[18px] p-4 border border-[#E2E8F0] shadow-sm">
          <div className="text-xs text-[#667085] mb-1 font-semibold uppercase tracking-wide">
            Общая выручка
          </div>
          <div className="text-2xl font-bold text-[#3B6D11]">{fmtMoney(totalRevenue)}</div>
        </div>
      )}
    </div>
  );
}
