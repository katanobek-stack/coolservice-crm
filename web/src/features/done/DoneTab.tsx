import { useState, useMemo } from "react";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import { repairStatus } from "../../shared/utils/repair";
import { fmtDate, fmtMoney } from "../../shared/utils/format";
import { Badge } from "../../shared/ui/Badge";
import { Input } from "../../shared/ui/Input";
import { updateClientArray } from "../../shared/firebase/firestore";
import type { Repair, Client, Vehicle } from "../../shared/types/client";
import type { ServiceTask } from "../../shared/types/task";

const MONTH_NAMES_FULL = [
  "Январь","Февраль","Март","Апрель","Май","Июнь",
  "Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь",
];

function monthLabel(mk: string): string {
  if (mk === "0000-00" || !mk.includes("-")) return "Без даты";
  const [y, m] = mk.split("-");
  const month = MONTH_NAMES_FULL[parseInt(m) - 1];
  return month ? `${month} ${y}` : mk;
}

// ─── Avatar color helper ──────────────────────────────────────────────────────

const AVATAR_COLORS = [
  { bg: "rgba(59,130,246,0.15)",  color: "#60a5fa" },
  { bg: "rgba(34,197,94,0.15)",   color: "#4ade80" },
  { bg: "rgba(139,92,246,0.15)",  color: "#a78bfa" },
  { bg: "rgba(245,158,11,0.15)",  color: "#fbbf24" },
  { bg: "rgba(6,182,212,0.15)",   color: "#22d3ee" },
  { bg: "rgba(239,68,68,0.15)",   color: "#f87171" },
];

function avatarColor(str: string) {
  let n = 0;
  for (const c of str) n += c.charCodeAt(0);
  return AVATAR_COLORS[n % AVATAR_COLORS.length];
}

// ─── Data shape ───────────────────────────────────────────────────────────────

interface DoneItem {
  repair:        Repair;
  client:        Client;
  vehicle?:      Vehicle;
  assigneeNames: string;
  mk:            string;
}

// ─── Close repair card (needs manager action) ─────────────────────────────────

function NeedsCloseCard({ item }: { item: DoneItem }) {
  const { repair, client, vehicle, assigneeNames } = item;
  const [closeSum, setCloseSum] = useState(repair.cost ?? "");
  const [closing, setClosing]   = useState(false);

  const av       = avatarColor(client.id);
  const brand    = vehicle?.brand ?? "";
  const initials = brand.slice(0, 2).toUpperCase() || (vehicle?.plate ?? client.name).slice(0, 2).toUpperCase();

  async function handleClose() {
    const trimmed = closeSum.trim();
    if (!trimmed) return;
    setClosing(true);
    const repairs = (client.repairs ?? []).map((r) =>
      r.id !== repair.id ? r : {
        ...r,
        cost:            trimmed,
        closedByManager: true,
        closedAt:        new Date().toISOString(),
        status:          "done" as const,
      },
    );
    await updateClientArray(client.id, "repairs", repairs);
    setClosing(false);
  }

  return (
    <div style={{
      background:   "var(--bg2)",
      borderRadius: 16,
      border:       "1px solid rgba(34,197,94,0.3)",
      borderLeft:   "4px solid var(--green)",
      padding:      "14px 16px",
      boxShadow:    "0 2px 12px rgba(34,197,94,0.1)",
      display:      "flex",
      gap:          14,
    }}>
      {/* Avatar */}
      {vehicle?.photo ? (
        <img
          src={vehicle.photo}
          alt=""
          style={{ width: 60, height: 60, borderRadius: 10, objectFit: "cover", flexShrink: 0, border: "1px solid var(--border)" }}
        />
      ) : (
        <div style={{
          width: 60, height: 60, borderRadius: 10, flexShrink: 0,
          background: av.bg, color: av.color,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 18, fontWeight: 800,
        }}>
          {initials}
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
          {vehicle?.plate && (
            <span style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 13, fontWeight: 700,
              color: "var(--accent2)",
              background: "rgba(59,130,246,0.12)",
              padding: "2px 8px", borderRadius: 6,
            }}>
              {vehicle.plate}
            </span>
          )}
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>
            {brand ? `${brand} · ` : ""}{client.name}
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#4ade80", background: "rgba(34,197,94,0.12)", padding: "1px 8px", borderRadius: 10 }}>
            ✓ все задачи выполнены
          </span>
        </div>

        {repair.description && (
          <div style={{ fontSize: 12.5, color: "var(--text2)", marginBottom: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {repair.description}
          </div>
        )}

        {assigneeNames && (
          <div style={{ fontSize: 11.5, color: "var(--text3)", marginBottom: 10 }}>
            👨‍🔧 {assigneeNames}
          </div>
        )}

        {/* Close form */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="number"
            placeholder="Сумма ₽"
            value={closeSum}
            onChange={(e) => setCloseSum(e.target.value)}
            style={{
              width: 130, padding: "8px 12px", borderRadius: 8,
              fontSize: 14, fontWeight: 700,
              background: "var(--bg3)", border: "1px solid rgba(34,197,94,0.35)",
              color: "var(--text)", outline: "none",
              fontFamily: "JetBrains Mono, monospace",
            }}
          />
          <span style={{ fontSize: 14, color: "var(--text2)" }}>₽</span>
          <button
            type="button"
            onClick={() => void handleClose()}
            disabled={closing || !closeSum.trim()}
            style={{
              padding: "8px 18px", borderRadius: 8,
              fontSize: 13, fontWeight: 700,
              background: closing || !closeSum.trim() ? "rgba(34,197,94,0.25)" : "var(--green)",
              border: "none", color: "white",
              cursor: closing || !closeSum.trim() ? "not-allowed" : "pointer",
              transition: "all 0.18s",
            }}
          >
            {closing ? "Сохранение..." : "✓ Закрыть наряд"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Repair card (closed history) ────────────────────────────────────────────

function RepairCard({ item, isAdmin }: { item: DoneItem; isAdmin: boolean }) {
  const { repair, client, vehicle, assigneeNames } = item;
  const isCancelled = repairStatus(repair) === "cancelled";
  const costNum     = parseFloat(repair.cost ?? "0") || 0;

  const av       = avatarColor(client.id);
  const brand    = vehicle?.brand ?? "";
  const initials = brand.slice(0, 2).toUpperCase() || (vehicle?.plate ?? client.name).slice(0, 2).toUpperCase();

  return (
    <div style={{
      background:   "var(--bg2)",
      borderRadius: 16,
      border:       "1px solid var(--border)",
      borderLeft:   `4px solid ${isCancelled ? "var(--text3)" : repair.closedByManager ? "var(--green)" : "var(--accent)"}`,
      padding:      "14px 16px",
      boxShadow:    "0 2px 8px rgba(0,0,0,0.07)",
      display:      "flex",
      gap:          14,
      alignItems:   "center",
    }}>
      {/* Avatar */}
      {vehicle?.photo ? (
        <img
          src={vehicle.photo}
          alt=""
          style={{ width: 60, height: 60, borderRadius: 10, objectFit: "cover", flexShrink: 0, border: "1px solid var(--border)" }}
        />
      ) : (
        <div style={{
          width: 60, height: 60, borderRadius: 10, flexShrink: 0,
          background: av.bg, color: av.color,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 18, fontWeight: 800,
        }}>
          {initials}
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Plate + brand + client */}
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 4 }}>
          {vehicle?.plate && (
            <span style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 13, fontWeight: 700,
              color: "var(--accent2)",
              background: "rgba(59,130,246,0.12)",
              padding: "2px 8px", borderRadius: 6,
            }}>
              {vehicle.plate}
            </span>
          )}
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {brand ? `${brand} · ` : ""}{client.name}
          </span>
        </div>

        {repair.description && (
          <div style={{ fontSize: 12.5, color: "var(--text2)", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {repair.description}
          </div>
        )}

        {repair.freonType && (
          <div style={{ fontSize: 11.5, color: "var(--cyan)", marginBottom: 4 }}>
            ❄️ {repair.freonType}{repair.freonAmount ? ` · ${repair.freonAmount} кг` : ""}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {assigneeNames && (
            <span style={{ fontSize: 11.5, color: "var(--text3)" }}>👨‍🔧 {assigneeNames}</span>
          )}
          <span style={{ fontSize: 11.5, color: "var(--text3)" }}>{fmtDate(repair.date)}</span>
        </div>
      </div>

      {/* Right: cost + badge */}
      <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
        {isAdmin && costNum > 0 && (
          <span style={{ fontSize: 15, fontWeight: 800, color: "#4ade80", fontFamily: "JetBrains Mono, monospace" }}>
            {fmtMoney(costNum)}
          </span>
        )}
        <Badge variant={isCancelled ? "gray" : "green"}>
          {isCancelled ? "Отказ" : repair.closedByManager ? "Закрыто" : "Готово"}
        </Badge>
      </div>
    </div>
  );
}

// ─── Month block (collapsible) ────────────────────────────────────────────────

function MonthBlock({ mk, items, tasks, isAdmin }: {
  mk:      string;
  items:   DoneItem[];
  tasks:   ServiceTask[];
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);

  const totalCost = isAdmin
    ? items.reduce((s, i) => s + (parseFloat(i.repair.cost ?? "0") || 0), 0)
    : 0;

  return (
    <div style={{ marginBottom: 8 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10,
          background: "var(--bg3)", borderRadius: 14,
          padding: "12px 16px",
          border: "1px solid var(--border)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ fontSize: 11, color: "var(--text3)", transition: "transform 0.2s", transform: open ? "rotate(90deg)" : "none" }}>▶</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", flex: 1 }}>{monthLabel(mk)}</span>
        <span style={{ fontSize: 12, color: "var(--text3)" }}>
          {items.length > 0 && `${items.length} рем.`}
          {tasks.length > 0 && ` · ${tasks.length} задач`}
        </span>
        {totalCost > 0 && (
          <span style={{ fontSize: 13, fontWeight: 700, color: "#4ade80", fontFamily: "JetBrains Mono, monospace" }}>
            {fmtMoney(totalCost)}
          </span>
        )}
      </button>

      {open && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 12 }}>
          {items.map((i) => (
            <RepairCard key={i.repair.id} item={i} isAdmin={isAdmin} />
          ))}
          {tasks.map((t) => (
            <div
              key={t.id}
              style={{
                background: "var(--bg2)", borderRadius: 16,
                border: "1px solid var(--border)",
                borderLeft: `4px solid ${t.taskType === "project" ? "var(--yellow)" : "var(--accent)"}`,
                padding: "12px 16px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {t.taskType === "project" && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#854F0B", background: "#FAEEDA", padding: "1px 7px", borderRadius: 10 }}>Проект</span>
                )}
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)", flex: 1 }}>{t.title ?? t.description ?? "—"}</span>
                <Badge variant="green">✓</Badge>
              </div>
              {t.title && t.description && (
                <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 3 }}>{t.description}</div>
              )}
              {t.workComment && (
                <div style={{ marginTop: 6, fontSize: 12, color: "var(--text)", background: "var(--bg3)", borderRadius: 8, padding: "6px 10px", border: "1px solid var(--border)" }}>
                  <span style={{ color: "#a78bfa", fontWeight: 600 }}>Отчёт: </span>{t.workComment}
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
  const { clients, tasks, staff } = useData();
  const { myProfile }             = useAuth();
  const isAdmin   = (myProfile?.role ?? "mechanic") !== "mechanic";
  const [search, setSearch] = useState("");

  // Collect all non-in-progress repairs enriched with client/vehicle/assignees
  const allItems = useMemo<DoneItem[]>(() => {
    const result: DoneItem[] = [];
    clients.forEach((c) => {
      (c.repairs ?? []).forEach((r) => {
        if (repairStatus(r) === "in_progress") return;
        const vehicle = (c.vehicles ?? []).find((v) => v.id === r.vehicleId);
        const mk      = r.date?.slice(0, 7) ?? "0000-00";

        // Collect unique assignees from all tasks
        const uids = new Set<string>();
        (r.tasks ?? []).forEach((t) => (t.assignees ?? []).forEach((uid) => uids.add(uid)));
        const assigneeNames = Array.from(uids)
          .map((uid) => staff.find((s) => s.id === uid)?.name ?? "")
          .filter(Boolean)
          .join(", ");

        result.push({ repair: r, client: c, vehicle, assigneeNames, mk });
      });
    });
    return result.sort((a, b) => (b.repair.date ?? "").localeCompare(a.repair.date ?? ""));
  }, [clients, staff]);

  // Done service tasks
  const doneTasks = useMemo(
    () => tasks.filter((t) => t.status === "done"),
    [tasks],
  );

  // Repairs needing close: all tasks done but not yet closedByManager
  const needsClose = useMemo(
    () => allItems.filter((i) => repairStatus(i.repair) === "done" && !i.repair.closedByManager),
    [allItems],
  );

  // Closed history: closedByManager OR cancelled
  const closedItems = useMemo(
    () => allItems.filter((i) => i.repair.closedByManager || i.repair.status === "cancelled"),
    [allItems],
  );

  // Filter closed by search
  const filteredClosed = useMemo(() => {
    if (!search.trim()) return closedItems;
    const q = search.toLowerCase();
    return closedItems.filter(
      (i) =>
        i.client.name.toLowerCase().includes(q) ||
        (i.vehicle?.plate ?? "").toLowerCase().includes(q) ||
        (i.vehicle?.brand ?? "").toLowerCase().includes(q) ||
        (i.repair.description ?? "").toLowerCase().includes(q),
    );
  }, [closedItems, search]);

  // Group by month
  const byMonth = useMemo(() => {
    const map = new Map<string, { items: DoneItem[]; tasks: ServiceTask[] }>();

    filteredClosed.forEach((item) => {
      const mk   = item.mk;
      const prev = map.get(mk) ?? { items: [], tasks: [] };
      prev.items.push(item);
      map.set(mk, prev);
    });

    if (!search.trim()) {
      doneTasks.forEach((t) => {
        let mk = "0000-00";
        if (t.createdAt && typeof t.createdAt === "object" && "seconds" in t.createdAt) {
          mk = new Date((t.createdAt as { seconds: number }).seconds * 1000).toISOString().slice(0, 7);
        }
        const prev = map.get(mk) ?? { items: [], tasks: [] };
        prev.tasks.push(t);
        map.set(mk, prev);
      });
    }

    return Array.from(map.entries())
      .filter(([, v]) => v.items.length + v.tasks.length > 0)
      .sort(([a], [b]) => b.localeCompare(a));
  }, [filteredClosed, doneTasks, search]);

  const totalRevenue = isAdmin
    ? closedItems
        .filter((i) => i.repair.closedByManager)
        .reduce((s, i) => s + (parseFloat(i.repair.cost ?? "0") || 0), 0)
    : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      {/* Needs close section — admin/manager only */}
      {isAdmin && needsClose.length > 0 && (
        <div className="crm-section" style={{ animation: "fadeUp 0.4s ease 0.1s both" }}>
          <div className="section-header">
            <i className="ti ti-clock-check" style={{ fontSize: 17, color: "#4ade80" }} />
            <span className="section-title" style={{ color: "#4ade80" }}>Ожидают закрытия</span>
            <span className="section-count">{needsClose.length} нарядов</span>
          </div>
          <div style={{ padding: "8px 12px 12px", display: "flex", flexDirection: "column", gap: 12 }}>
            {needsClose.map((i) => (
              <NeedsCloseCard key={`${i.client.id}-${i.repair.id}`} item={i} />
            ))}
          </div>
        </div>
      )}

      {/* Closed history */}
      <div className="crm-section" style={{ animation: "fadeUp 0.45s ease 0.15s both" }}>
        <div className="section-header">
          <i className="ti ti-file-export" style={{ fontSize: 17, color: "var(--text2)" }} />
          <span className="section-title">Отчёты</span>
          <span className="section-count">
            {closedItems.length} рем.{doneTasks.length > 0 ? ` · ${doneTasks.length} задач` : ""}
          </span>
          {isAdmin && totalRevenue > 0 && (
            <div className="section-actions">
              <span style={{ fontSize: 13, fontWeight: 700, color: "#4ade80", fontFamily: "JetBrains Mono, monospace" }}>
                {fmtMoney(totalRevenue)}
              </span>
            </div>
          )}
        </div>

        {/* Search */}
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>
          <Input
            placeholder="Поиск по клиенту, авто, марке, описанию..."
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
            {byMonth.map(([mk, { items, tasks: mTasks }]) => (
              <MonthBlock key={mk} mk={mk} items={items} tasks={mTasks} isAdmin={isAdmin} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
