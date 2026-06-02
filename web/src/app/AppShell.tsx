import { useState, useEffect, useRef } from "react";
import { useAuth } from "../features/auth";
import { DataProvider, useData } from "../shared/context/DataContext";
import { GlobalSearch } from "../shared/ui/GlobalSearch";
import { StatsTab } from "../features/stats/StatsTab";
import { MyTasksTab } from "../features/mytasks/MyTasksTab";
import { ClientsTab } from "../features/clients/ClientsTab";
import { CalendarTab } from "../features/calendar/CalendarTab";
import { FreezersTab } from "../features/freezers/FreezersTab";
import { DoneTab } from "../features/done/DoneTab";
import { PnlTab } from "../features/pnl/PnlTab";
import { StaffTab } from "../features/staff/StaffTab";
import { BackupTab } from "../features/backup/BackupTab";
import { requestNotificationPermission, showBrowserNotification } from "../shared/utils/fcm";
import type { StaffMember } from "../shared/types/staff";

export type Tab = "stats" | "mytasks" | "phys" | "legal" | "calendar" | "freezers" | "done" | "pnl" | "staff" | "backup";

const TABS: Array<{ id: Tab; label: string; icon: string; adminOnly?: boolean }> = [
  { id: "stats",    label: "Сводка",   icon: "📊" },
  { id: "mytasks",  label: "Заявки",   icon: "🔧" },
  { id: "phys",     label: "Клиенты",  icon: "👤" },
  { id: "legal",    label: "Компании", icon: "🏢" },
  { id: "calendar", label: "Записи",   icon: "📅" },
  { id: "freezers", label: "Склад",    icon: "📦" },
  { id: "done",     label: "Отчёты",   icon: "✅" },
  { id: "pnl",      label: "P&L",      icon: "💰", adminOnly: true },
  { id: "staff",    label: "Персонал", icon: "👥", adminOnly: true },
  { id: "backup",   label: "Бэкап",    icon: "💾", adminOnly: true },
];

// ─── FCM + task-change notifier ───────────────────────────────────────────────

function useFCMAndNotifications(myProfile: StaffMember | undefined) {
  const { tasks, clients } = useData();
  const lastCountRef = useRef(-1);
  const uid = myProfile?.id ?? "";

  // Init FCM once after login + 3s delay
  useEffect(() => {
    if (!uid) return;
    const timer = setTimeout(() => {
      void requestNotificationPermission(uid, myProfile?.fcmTokens ?? []);
    }, 3000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // Watch active task count → notify if increases
  useEffect(() => {
    if (!uid) return;

    let count = 0;
    tasks.forEach((t) => {
      if ((t.assignees ?? []).includes(uid) && t.status !== "done" && !(t.doneBy ?? []).includes(uid)) count++;
    });
    clients.forEach((c) => {
      (c.repairs ?? []).forEach((r) => {
        (r.tasks ?? []).forEach((t) => {
          const assignees = t.assignees ?? [];
          const doneBy    = t.doneBy    ?? [];
          if (assignees.includes(uid) && t.status !== "done" && !doneBy.includes(uid)) count++;
        });
      });
    });

    if (lastCountRef.current >= 0 && count > lastCountRef.current) {
      const diff = count - lastCountRef.current;
      showBrowserNotification(
        diff === 1 ? "Новая задача" : `Новых задач: ${diff}`,
        "Откройте CRM, чтобы посмотреть",
      );
    }
    lastCountRef.current = count;
  }, [tasks, clients, uid]);
}

// ─── Shell ────────────────────────────────────────────────────────────────────

function Shell() {
  const { myProfile, signOutUser } = useAuth();
  const { tasks, clients }         = useData();
  const [tab, setTab]              = useState<Tab>("stats");
  const [showSearch, setShowSearch] = useState(false);

  const role    = myProfile?.role ?? "mechanic";
  const isAdmin = role === "admin";
  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);

  // Active task badge count
  const uid = myProfile?.id ?? "";
  const activeMine = tasks.filter(
    (t) =>
      (t.assignees ?? []).includes(uid) &&
      t.status !== "done" &&
      !(t.doneBy ?? []).includes(uid),
  ).length;

  // FCM + notifications
  useFCMAndNotifications(myProfile);

  function renderTab() {
    switch (tab) {
      case "stats":    return <StatsTab onNavigate={setTab} />;
      case "mytasks":  return <MyTasksTab />;
      case "phys":     return <ClientsTab type="phys" />;
      case "legal":    return <ClientsTab type="legal" />;
      case "calendar": return <CalendarTab />;
      case "freezers": return <FreezersTab />;
      case "done":     return <DoneTab />;
      case "pnl":      return isAdmin ? <PnlTab />    : null;
      case "staff":    return isAdmin ? <StaffTab />  : null;
      case "backup":   return isAdmin ? <BackupTab /> : null;
      default:         return null;
    }
  }

  return (
    <div className="flex flex-col h-full relative" style={{ background: "var(--cs-bg)" }}>
      {/* Header */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-3 bg-white border-b border-[#E2E8F0]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-[#185FA5] flex items-center justify-center text-sm">❄️</div>
          <div>
            <div className="text-sm font-bold text-[#172033] leading-tight">CoolService CRM</div>
            <div className="text-xs text-[#667085]">
              {myProfile?.name ?? myProfile?.email?.split("@")[0] ?? ""}
              {" · "}
              {{ admin: "Админ", manager: "Менеджер", mechanic: "Механик" }[role]}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSearch(true)}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-[#F2F4F7] border border-[#E2E8F0] cursor-pointer text-base"
            title="Поиск"
          >
            🔍
          </button>
          <button
            type="button"
            onClick={() => void signOutUser()}
            className="text-xs text-[#667085] bg-[#F2F4F7] px-3 py-1.5 rounded-xl border border-[#E2E8F0] cursor-pointer"
          >
            Выйти
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="scroll-area" style={{ paddingBottom: "80px" }}>
        {renderTab()}
      </div>

      {/* Bottom Navigation */}
      <nav
        className="absolute left-0 right-0 bottom-0 z-10 flex overflow-x-auto bg-white/95 backdrop-blur border-t border-[#E2E8F0]"
        style={{ boxShadow: "0 -10px 30px rgba(15,23,42,.07)", paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {visibleTabs.map((t) => {
          const isActive  = tab === t.id;
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

      {showSearch && <GlobalSearch onClose={() => setShowSearch(false)} />}
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
