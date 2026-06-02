import { useState, useMemo } from "react";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import { repairStatus } from "../../shared/utils/repair";
import { fmtDate, fmtMoney } from "../../shared/utils/format";
import { Badge } from "../../shared/ui/Badge";
import { Input } from "../../shared/ui/Input";
import type { Repair, Client } from "../../shared/types/client";
import type { ServiceTask } from "../../shared/types/task";

const MONTH_NAMES_FULL = [
  "Январь","Февраль","Март","Апрель","Май","Июнь",
  "Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь",
];

function monthLabel(mk: string): string {
  if (mk === "0000-00" || !mk.includes("-")) return "Без даты";
  const [y, m] = mk.split("-");
  const month = MONTH_NAMES_FULL[parseInt(m) - 1];
  if (!month) return mk;
  return `${month} ${y}`;
}

// ─── Repair row ───────────────────────────────────────────────────────────────

function RepairRow({ repair, clientName, plate, isAdmin }: {
  repair: Repair; clientName: string; plate?: string; isAdmin: boolean;
}) {
  const isCancelled = repairStatus(repair) === "cancelled";
  return (
    <div
      className={`bg-white rounded-[16px] border-l-4 border border-[#E2E8F0] p-3.5 mb-2 shadow-sm ${isCancelled ? "opacity-50" : ""}`}
      style={{ borderLeftColor: isCancelled ? "var(--text3)" : "var(--green)" }}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="font-semibold text-[#172033] text-sm">{clientName}</div>
        <Badge variant={isCancelled ? "gray" : "green"}>{isCancelled ? "Отказ" : "Готово"}</Badge>
      </div>
      {plate && (
        <span className="text-xs bg-[#F2F4F7] text-[#344054] px-2 py-0.5 rounded font-mono mr-1">{plate}</span>
      )}
      {repair.description && <div className="text-sm text-[#344054] mt-1">{repair.description}</div>}
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-xs text-[#98A2B3]">{fmtDate(repair.date)}</span>
        {repair.cost && isAdmin && <span className="text-sm font-bold text-[#3B6D11]">{repair.cost} ₽</span>}
      </div>
      {(repair.freonType || repair.freonAmount) && (
        <div className="mt-1 text-xs text-cyan-600">❄️ {repair.freonType} {repair.freonAmount && `${repair.freonAmount} кг`}</div>
      )}
    </div>
  );
}

// ─── Month block (collapsible) ────────────────────────────────────────────────

function MonthBlock({ mk, repairs, tasks, isAdmin }: {
  mk:      string;
  repairs: Array<{ repair: Repair; clientName: string; plate?: string }>;
  tasks:   ServiceTask[];
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const totalCost = isAdmin
    ? repairs.reduce((s, r) => s + (parseFloat(r.repair.cost ?? "0") || 0), 0)
    : 0;

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 bg-[#F7F9FC] rounded-[16px] px-4 py-3 border border-[#E2E8F0] shadow-sm cursor-pointer text-left"
      >
        <span className={`text-xs transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        <span className="text-sm font-semibold text-[#172033] flex-1">{monthLabel(mk)}</span>
        <span className="text-xs text-[#98A2B3]">
          {repairs.length > 0 && `${repairs.length} рем.`}
          {tasks.length > 0 && ` · ${tasks.length} задач`}
        </span>
        {totalCost > 0 && (
          <span className="text-xs font-bold text-[#3B6D11] ml-1">{fmtMoney(totalCost)}</span>
        )}
      </button>

      {open && (
        <div className="mt-1.5 pl-1">
          {repairs.map(({ repair, clientName, plate }) => (
            <RepairRow key={repair.id} repair={repair} clientName={clientName} plate={plate} isAdmin={isAdmin} />
          ))}
          {tasks.map((t) => (
            <div key={t.id} className="bg-white rounded-[16px] border-l-4 border-[#E2E8F0] border p-3 mb-2 shadow-sm"
              style={{ borderLeftColor: t.taskType === "project" ? "var(--yellow)" : "var(--accent)" }}>
              <div className="flex items-center gap-2 mb-0.5">
                {t.taskType === "project" && (
                  <span className="text-[10px] font-bold text-[#854F0B] bg-[#FAEEDA] px-2 py-0.5 rounded-full">Проект</span>
                )}
                <span className="text-sm font-semibold text-[#172033]">{t.title ?? t.description ?? "—"}</span>
                <Badge variant="green">✓</Badge>
              </div>
              {t.title && t.description && <div className="text-xs text-[#667085]">{t.description}</div>}
              {t.workComment && (
                <div className="mt-1 text-xs text-[#344054] bg-[#F7F9FC] rounded-lg p-1.5 border border-[#E2E8F0]">
                  <span className="text-purple-400 font-semibold">Отчёт: </span>{t.workComment}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export function DoneTab() {
  const { clients, tasks } = useData();
  const { myProfile }      = useAuth();
  const isAdmin = (myProfile?.role ?? "mechanic") !== "mechanic";
  const [search, setSearch] = useState("");

  // All done/cancelled repairs flat
  const doneRepairs = useMemo(() => {
    const result: Array<{ repair: Repair; clientName: string; plate?: string; mk: string }> = [];
    clients.forEach((c) => {
      (c.repairs ?? [])
        .filter((r) => repairStatus(r) !== "in_progress")
        .forEach((r) => {
          const v  = (c.vehicles ?? []).find((vv) => vv.id === r.vehicleId);
          const mk = r.date?.slice(0, 7) ?? "0000-00";
          result.push({ repair: r, clientName: c.name, plate: v?.plate, mk });
        });
    });
    return result.sort((a, b) => b.repair.date?.localeCompare(a.repair.date ?? "") ?? 0);
  }, [clients]);

  // Done service tasks
  const doneTasks = useMemo(
    () => tasks.filter((t) => t.status === "done"),
    [tasks],
  );

  // Filter by search
  const filtered = useMemo(() => {
    if (!search.trim()) return doneRepairs;
    const q = search.toLowerCase();
    return doneRepairs.filter(
      (r) =>
        r.clientName.toLowerCase().includes(q) ||
        (r.plate ?? "").toLowerCase().includes(q) ||
        (r.repair.description ?? "").toLowerCase().includes(q),
    );
  }, [doneRepairs, search]);

  // Group by month
  const byMonth = useMemo(() => {
    const map = new Map<string, {
      repairs: typeof filtered;
      tasks:   ServiceTask[];
    }>();

    filtered.forEach((item) => {
      const mk = item.mk;
      const prev = map.get(mk) ?? { repairs: [], tasks: [] };
      prev.repairs.push(item);
      map.set(mk, prev);
    });

    // Add tasks to their month
    if (!search.trim()) {
      doneTasks.forEach((t) => {
        let mk = "0000-00";
        if (t.createdAt && typeof t.createdAt === "object" && "seconds" in t.createdAt) {
          mk = new Date((t.createdAt as { seconds: number }).seconds * 1000).toISOString().slice(0, 7);
        }
        const prev = map.get(mk) ?? { repairs: [], tasks: [] };
        prev.tasks.push(t);
        map.set(mk, prev);
      });
    }

    return Array.from(map.entries())
      .filter(([, v]) => v.repairs.length + v.tasks.length > 0)
      .sort(([a], [b]) => b.localeCompare(a));
  }, [filtered, doneTasks, search]);

  const totalRevenue = isAdmin
    ? doneRepairs
        .filter((r) => repairStatus(r.repair) === "done")
        .reduce((s, r) => s + (parseFloat(r.repair.cost ?? "0") || 0), 0)
    : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      {/* Section with search */}
      <div className="crm-section" style={{ animation: "fadeUp 0.45s ease 0.1s both" }}>
        <div className="section-header">
          <i className="ti ti-file-export" style={{ fontSize: 17, color: "var(--text2)" }} />
          <span className="section-title">Отчёты</span>
          <span className="section-count">
            {doneRepairs.length} рем.{doneTasks.length > 0 ? ` · ${doneTasks.length} задач` : ""}
          </span>
          {isAdmin && totalRevenue > 0 && (
            <div className="section-actions">
              <span style={{ fontSize: 13, fontWeight: 700, color: "#4ade80", fontFamily: "JetBrains Mono, monospace" }}>
                {fmtMoney(totalRevenue)}
              </span>
            </div>
          )}
        </div>

        {/* Search bar */}
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>
          <Input
            placeholder="Поиск по клиенту, авто, описанию..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {byMonth.length === 0 ? (
          <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
            {search ? "Ничего не найдено" : "Нет завершённых работ"}
          </div>
        ) : (
          <div style={{ padding: "8px 12px 12px" }}>
            {byMonth.map(([mk, { repairs, tasks: mTasks }]) => (
              <MonthBlock key={mk} mk={mk} repairs={repairs} tasks={mTasks} isAdmin={isAdmin} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
