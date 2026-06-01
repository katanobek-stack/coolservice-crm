import { useState } from "react";
import { useAuth } from "../features/auth";
import { DataProvider, useData } from "../shared/context/DataContext";
import { StatsTab } from "../features/stats/StatsTab";
import { MyTasksTab } from "../features/mytasks/MyTasksTab";
import { ClientsTab } from "../features/clients/ClientsTab";
import { FreezersTab } from "../features/freezers/FreezersTab";
import { DoneTab } from "../features/done/DoneTab";
import { PnlTab } from "../features/pnl/PnlTab";

export type Tab = "stats" | "mytasks" | "phys" | "legal" | "freezers" | "done" | "pnl";

const TABS: Array<{ id: Tab; label: string; icon: string; adminOnly?: boolean }> = [
  { id: "stats",    label: "Сводка",   icon: "📊" },
  { id: "mytasks",  label: "Заявки",   icon: "🔧" },
  { id: "phys",     label: "Клиенты",  icon: "👤" },
  { id: "legal",    label: "Компании", icon: "🏢" },
  { id: "freezers", label: "Склад",    icon: "📦" },
  { id: "done",     label: "Отчёты",   icon: "✅" },
  { id: "pnl",      label: "P&L",      icon: "💰", adminOnly: true },
];

function Shell() {
  const { myProfile, signOutUser } = useAuth();
  const { tasks, clients } = useData();
  const [tab, setTab] = useState<Tab>("stats");

  const role = myProfile?.role ?? "mechanic";
  const isAdmin = role === "admin";
  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);

  // Count active tasks for badge
  const uid = myProfile?.id ?? "";
  const activeMine = tasks.filter(
    (t) =>
      (t.assignees ?? []).includes(uid) &&
      t.status !== "done" &&
      !(t.doneBy ?? []).includes(uid),
  ).length;

  function renderTab() {
    switch (tab) {
      case "stats":    return <StatsTab onNavigate={setTab} />;
      case "mytasks":  return <MyTasksTab />;
      case "phys":     return <ClientsTab type="phys" />;
      case "legal":    return <ClientsTab type="legal" />;
      case "freezers": return <FreezersTab />;
      case "done":     return <DoneTab />;
      case "pnl":      return isAdmin ? <PnlTab /> : null;
      default:         return null;
    }
  }

  return (
    <div className="flex flex-col h-full relative" style={{ background: "var(--cs-bg)" }}>
      {/* Header */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-3 bg-white border-b border-[#E2E8F0]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-[#185FA5] flex items-center justify-center text-sm">
            ❄️
          </div>
          <div>
            <div className="text-sm font-bold text-[#172033] leading-tight">CoolService CRM</div>
            <div className="text-xs text-[#667085]">
              {myProfile?.name ?? myProfile?.email?.split("@")[0] ?? ""}
              {" · "}
              {{ admin: "Админ", manager: "Менеджер", mechanic: "Механик" }[role]}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void signOutUser()}
          className="text-xs text-[#667085] bg-[#F2F4F7] px-3 py-1.5 rounded-xl border border-[#E2E8F0] cursor-pointer"
        >
          Выйти
        </button>
      </header>

      {/* Content */}
      <div className="scroll-area" style={{ paddingBottom: "80px" }}>
        {renderTab()}
      </div>

      {/* Bottom Navigation */}
      <nav className="absolute left-0 right-0 bottom-0 z-10 flex overflow-x-auto bg-white/95 backdrop-blur border-t border-[#E2E8F0]"
        style={{ boxShadow: "0 -10px 30px rgba(15,23,42,.07)", paddingBottom: "env(safe-area-inset-bottom)" }}>
        {visibleTabs.map((t) => {
          const isActive = tab === t.id;
          const showBadge = t.id === "mytasks" && activeMine > 0;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex-1 min-w-[60px] flex flex-col items-center justify-center gap-0.5 py-2 px-1 text-[11px] font-semibold border-none cursor-pointer transition-all relative rounded-2xl mx-0.5
                ${isActive
                  ? "bg-[#E6F1FB] text-[#185FA5]"
                  : "bg-transparent text-[#98A2B3]"
                }`}
              style={{ height: 58 }}
            >
              <span className="text-lg leading-none">{t.icon}</span>
              <span className="leading-tight">{t.label}</span>
              {showBadge && (
                <span className="absolute top-1 right-1 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                  {activeMine}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export function AppShell() {
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  );
}
