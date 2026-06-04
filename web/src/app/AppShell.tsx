import { useState, useEffect, useRef, useMemo } from "react";
import { useAuth } from "../features/auth";
import { DataProvider, useData } from "../shared/context/DataContext";
import { repairStatus } from "../shared/utils/repair";
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
import { FloatingMicButton } from "../features/voice/FloatingMicButton";
import type { StaffMember, StaffRole } from "../shared/types/staff";

export type Tab =
  | "stats" | "mytasks" | "phys" | "legal"
  | "calendar" | "freezers" | "done"
  | "pnl" | "staff" | "backup";

// ─── Tab config ───────────────────────────────────────────────────────────────

interface TabDef {
  id:     Tab;
  label:  string;
  icon:   string;        // Tabler icon class
  emoji:  string;        // fallback / mobile
  group:  "main" | "service" | "finance";
  roles?: StaffRole[];   // if defined, only these roles can see this tab
}

const TABS: TabDef[] = [
  { id: "stats",    label: "Дашборд",   icon: "ti-layout-dashboard", emoji: "📊", group: "main" },
  { id: "mytasks",  label: "Заявки",    icon: "ti-clipboard-list",   emoji: "🔧", group: "main" },
  { id: "phys",     label: "Клиенты",   icon: "ti-users",            emoji: "👤", group: "main" },
  { id: "legal",    label: "Компании",  icon: "ti-building",         emoji: "🏢", group: "main" },
  { id: "calendar", label: "Записи",    icon: "ti-calendar",         emoji: "📅", group: "service", roles: ["manager", "admin"] },
  { id: "freezers", label: "Склад",     icon: "ti-package",          emoji: "📦", group: "service" },
  { id: "done",     label: "Отчёты",    icon: "ti-file-export",      emoji: "✅", group: "finance", roles: ["manager", "admin"] },
  { id: "pnl",      label: "P&L",       icon: "ti-chart-bar",        emoji: "💰", group: "finance", roles: ["manager", "admin"] },
  { id: "staff",    label: "Персонал",  icon: "ti-id-badge",         emoji: "👥", group: "finance", roles: ["admin"] },
  { id: "backup",   label: "Бэкап",     icon: "ti-database-export",  emoji: "💾", group: "finance", roles: ["admin"] },
];

function canSeeTab(t: TabDef, role: StaffRole): boolean {
  return !t.roles || t.roles.includes(role);
}

const TAB_TITLES: Record<Tab, { title: string; sub: string }> = {
  stats:    { title: "Дашборд",   sub: "главные показатели" },
  mytasks:  { title: "Заявки",    sub: "ремонты и задачи" },
  phys:     { title: "Клиенты",   sub: "физические лица" },
  legal:    { title: "Компании",  sub: "юридические лица" },
  calendar: { title: "Записи",    sub: "предстоящие визиты" },
  freezers: { title: "Склад",     sub: "камеры и аренда" },
  done:     { title: "Отчёты",    sub: "завершённые работы" },
  pnl:      { title: "P&L",       sub: "доходы и расходы" },
  staff:    { title: "Персонал",  sub: "сотрудники" },
  backup:   { title: "Бэкап",     sub: "экспорт и импорт данных" },
};

// ─── FCM hook ─────────────────────────────────────────────────────────────────

function useFCMAndNotifications(myProfile: StaffMember | undefined) {
  const { tasks, clients } = useData();
  const lastCountRef = useRef(-1);
  const uid = myProfile?.id ?? "";

  useEffect(() => {
    if (!uid) return;
    const timer = setTimeout(() => {
      void requestNotificationPermission(uid, myProfile?.fcmTokens ?? []);
    }, 3000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    let count = 0;
    tasks.forEach((t) => {
      if ((t.assignees ?? []).includes(uid) && t.status !== "done" && !(t.doneBy ?? []).includes(uid)) count++;
    });
    clients.forEach((c) => {
      (c.repairs ?? []).forEach((r) => {
        (r.tasks ?? []).forEach((t) => {
          if ((t.assignees ?? []).includes(uid) && t.status !== "done" && !(t.doneBy ?? []).includes(uid)) count++;
        });
      });
    });
    if (lastCountRef.current >= 0 && count > lastCountRef.current) {
      const diff = count - lastCountRef.current;
      showBrowserNotification(diff === 1 ? "Новая задача" : `Новых задач: ${diff}`, "Откройте CRM");
    }
    lastCountRef.current = count;
  }, [tasks, clients, uid]);
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({ tab, onTab, myProfile, onSignOut, activeRepairs, totalClients, freezersCount }: {
  tab:           Tab;
  onTab:         (t: Tab) => void;
  myProfile:     StaffMember | undefined;
  onSignOut:     () => void;
  activeRepairs: number;
  totalClients:  number;
  freezersCount: number;
}) {
  const role = myProfile?.role ?? "mechanic";

  const groups: Array<{ key: string; label: string; tabs: TabDef[] }> = [
    { key: "main",    label: "Главное",  tabs: TABS.filter((t) => t.group === "main"    && canSeeTab(t, role)) },
    { key: "service", label: "Сервис",   tabs: TABS.filter((t) => t.group === "service" && canSeeTab(t, role)) },
    { key: "finance", label: "Финансы",  tabs: TABS.filter((t) => t.group === "finance" && canSeeTab(t, role)) },
  ].filter((g) => g.tabs.length > 0);

  const initials = (myProfile?.name ?? myProfile?.email ?? "?")
    .split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

  const roleLabel = { admin: "Администратор", manager: "Менеджер", mechanic: "Механик" }[role];

  function getBadge(id: Tab): { count: number; variant: "red" | "blue" | "" } | null {
    if (id === "mytasks" && activeRepairs > 0) return { count: activeRepairs, variant: "red" };
    if ((id === "phys" || id === "legal") && totalClients > 0) return { count: totalClients, variant: "blue" };
    if (id === "freezers" && freezersCount > 0) return { count: freezersCount, variant: "red" };
    return null;
  }

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-top">
          <div className="sidebar-logo-icon">❄️</div>
          <div className="sidebar-logo-name">RefServiceDV</div>
        </div>
        <div className="sidebar-logo-sub">crm.refservicedv.ru</div>
      </div>

      {/* Nav */}
      <nav className="sidebar-nav">
        {groups.map((g) => (
          <div key={g.key}>
            <div className="nav-group-label">{g.label}</div>
            {g.tabs.map((t) => {
              const isActive = tab === t.id;
              const badge    = getBadge(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`nav-item ${isActive ? "active" : ""}`}
                  onClick={() => onTab(t.id)}
                >
                  <i className={`ti ${t.icon}`} />
                  {t.label}
                  {badge && (
                    <span className={`nav-badge ${badge.variant}`}>{badge.count}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="sidebar-footer">
        <div className="user-card" onClick={() => void onSignOut()}>
          <div className="user-avatar">{initials}</div>
          <div className="user-info">
            <div className="user-name">{myProfile?.name ?? myProfile?.email?.split("@")[0] ?? "—"}</div>
            <div className="user-role">{roleLabel}</div>
          </div>
          <i className="ti ti-settings" style={{ fontSize: 15, color: "var(--text3)" }} />
        </div>
      </div>
    </aside>
  );
}

// ─── Topbar ───────────────────────────────────────────────────────────────────

function Topbar({ tab, onSearch, activeMine, onNewRepair }: {
  tab:        Tab;
  onSearch:   () => void;
  activeMine: number;
  onNewRepair: () => void;
}) {
  const info = TAB_TITLES[tab];
  const today = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long" });

  return (
    <div className="topbar">
      <div>
        <span className="topbar-title">{info.title}</span>
        <span className="topbar-sub">— {tab === "stats" ? `сегодня, ${today}` : info.sub}</span>
      </div>
      <div className="topbar-right">
        <div className="topbar-icon" onClick={onSearch} title="Поиск">
          <i className="ti ti-search" />
        </div>
        <div className="topbar-icon" style={{ position: "relative" }}>
          <i className="ti ti-bell" />
          {activeMine > 0 && <div className="notif-dot" />}
        </div>
        <button type="button" className="btn-primary" onClick={onNewRepair}>
          <i className="ti ti-plus" /> Новая заявка
        </button>
      </div>
    </div>
  );
}

// ─── Mobile bottom nav ────────────────────────────────────────────────────────

const MOBILE_TAB_IDS: Tab[] = ["stats", "mytasks", "phys", "freezers", "done", "pnl"];

function MobileNav({ tab, onTab, activeMine, role, onSignOut }: {
  tab:        Tab;
  onTab:      (t: Tab) => void;
  activeMine: number;
  role:       StaffRole;
  onSignOut:  () => void;
}) {
  const visibleTabs = TABS.filter((t) => MOBILE_TAB_IDS.includes(t.id) && canSeeTab(t, role));

  return (
    <nav className="mobile-nav">
      {/* Кнопка голосового агента — первая слева, приподнята над панелью */}
      <FloatingMicButton />

      {/* Прокручиваемые вкладки */}
      <div className="mobile-nav-tabs">
        {visibleTabs.map((t) => {
          const isActive  = tab === t.id;
          const showBadge = t.id === "mytasks" && activeMine > 0;
          return (
            <button
              key={t.id}
              type="button"
              className={`mobile-nav-btn ${isActive ? "active" : ""}`}
              onClick={() => onTab(t.id)}
            >
              <i className={`ti ${t.icon}`} />
              {t.label}
              {showBadge && (
                <span style={{
                  position: "absolute", top: 4, right: 4,
                  width: 16, height: 16,
                  background: "var(--red)", borderRadius: "50%",
                  fontSize: 9, fontWeight: 700, color: "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {activeMine}
                </span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          className="mobile-nav-btn"
          onClick={onSignOut}
          style={{ color: "var(--text3)" }}
        >
          <i className="ti ti-logout" />
          Выйти
        </button>
      </div>
    </nav>
  );
}

// ─── Shell ────────────────────────────────────────────────────────────────────

function Shell() {
  const { myProfile, signOutUser }  = useAuth();
  const { tasks, clients, freezers } = useData();
  const [tab, setTab]               = useState<Tab>("stats");
  const [showSearch, setShowSearch] = useState(false);

  const role    = myProfile?.role ?? "mechanic";
  const isAdmin = role === "admin";
  const uid     = myProfile?.id ?? "";

  // Redirect to stats if current tab is not accessible for this role
  useEffect(() => {
    const t = TABS.find((t) => t.id === tab);
    if (t && !canSeeTab(t, role)) setTab("stats");
  }, [role, tab]);

  const activeMine = tasks.filter(
    (t) =>
      (t.assignees ?? []).includes(uid) &&
      t.status !== "done" &&
      !(t.doneBy ?? []).includes(uid),
  ).length;

  const activeRepairs = useMemo(
    () => clients.flatMap((c) => c.repairs ?? []).filter((r) => repairStatus(r) === "in_progress").length,
    [clients],
  );

  useFCMAndNotifications(myProfile);

  function renderTab() {
    switch (tab) {
      case "stats":    return <StatsTab onNavigate={setTab} />;
      case "mytasks":  return <MyTasksTab />;
      case "phys":     return <ClientsTab type="phys" />;
      case "legal":    return <ClientsTab type="legal" />;
      case "calendar": return role !== "mechanic" ? <CalendarTab />  : null;
      case "freezers": return <FreezersTab />;
      case "done":     return role !== "mechanic" ? <DoneTab />      : null;
      case "pnl":      return role !== "mechanic" ? <PnlTab />       : null;
      case "staff":    return isAdmin             ? <StaffTab />     : null;
      case "backup":   return isAdmin             ? <BackupTab />    : null;
      default:         return null;
    }
  }

  return (
    <>
      {/* Animated background */}
      <div className="bg-grid" />
      <div className="bg-glow" />

      <div className="crm-layout">
        {/* Desktop sidebar */}
        <Sidebar
          tab={tab}
          onTab={setTab}
          myProfile={myProfile}
          onSignOut={() => void signOutUser()}
          activeRepairs={activeRepairs}
          totalClients={clients.length}
          freezersCount={freezers.length}
        />

        {/* Main area */}
        <div className="crm-main">
          <Topbar
            tab={tab}
            onSearch={() => setShowSearch(true)}
            activeMine={activeRepairs}
            onNewRepair={() => setTab("phys")}
          />
          <div className="crm-content">
            {renderTab()}
          </div>
        </div>

        {/* Mobile bottom nav */}
        <MobileNav tab={tab} onTab={setTab} activeMine={activeRepairs} role={role} onSignOut={() => void signOutUser()} />
      </div>

      {showSearch && <GlobalSearch onClose={() => setShowSearch(false)} />}
    </>
  );
}

export function AppShell() {
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  );
}
