import { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import { repairStatus } from "../../shared/utils/repair";
import { fmtDate, fmtMoney } from "../../shared/utils/format";
import { Badge } from "../../shared/ui/Badge";
import { Modal } from "../../shared/ui/Modal";
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

// ─── Repair detail modal ─────────────────────────────────────────────────────

function RepairDetailModal({ item, isAdmin, onClose }: {
  item:    DoneItem;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const { staff }  = useData();
  const { repair, client, vehicle, assigneeNames } = item;
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const brand       = vehicle?.brand ?? vehicle?.model ?? "";
  const isCancelled = repairStatus(repair) === "cancelled";
  const costNum     = parseFloat(repair.cost ?? "0") || 0;

  return (
    <Modal title="Детали ремонта" onClose={onClose}>

      {/* Vehicle + client header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, padding: "12px 14px", background: "var(--bg3)", borderRadius: 12, border: "1px solid var(--border)" }}>
        {vehicle?.photo ? (
          <img src={vehicle.photo} alt="" style={{ width: 52, height: 52, borderRadius: 8, objectFit: "cover", flexShrink: 0, border: "1px solid var(--border)" }} />
        ) : (
          <div style={{ width: 52, height: 52, borderRadius: 8, flexShrink: 0, background: "rgba(59,130,246,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>
            🚗
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {vehicle?.plate && (
            <div style={{ marginBottom: 3 }}>
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, fontWeight: 700, color: "#93c5fd", background: "rgba(59,130,246,0.12)", padding: "2px 8px", borderRadius: 6 }}>
                {vehicle.plate}
              </span>
            </div>
          )}
          {brand && <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 2 }}>{brand}</div>}
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{client.name}</div>
        </div>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 10, flexShrink: 0,
          background: isCancelled ? "var(--bg2)" : "rgba(34,197,94,0.15)",
          color: isCancelled ? "var(--text3)" : "#4ade80",
          border: `1px solid ${isCancelled ? "var(--border)" : "rgba(34,197,94,0.3)"}`,
        }}>
          {isCancelled ? "Отказ" : repair.closedByManager ? "Закрыто" : "Выполнено"}
        </span>
      </div>

      {/* Meta rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14, padding: "12px 14px", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 12 }}>
        {repair.date && (
          <div style={{ display: "flex", gap: 10, fontSize: 12.5 }}>
            <span style={{ color: "var(--text3)", minWidth: 88 }}>📅 Начало</span>
            <span style={{ color: "var(--text)", fontWeight: 600 }}>{fmtDate(repair.date)}</span>
          </div>
        )}
        {repair.closedAt && (
          <div style={{ display: "flex", gap: 10, fontSize: 12.5 }}>
            <span style={{ color: "var(--text3)", minWidth: 88 }}>✓ Закрыто</span>
            <span style={{ color: "#4ade80", fontWeight: 600 }}>{fmtDate(repair.closedAt.slice(0, 10))}</span>
          </div>
        )}
        {assigneeNames && (
          <div style={{ display: "flex", gap: 10, fontSize: 12.5 }}>
            <span style={{ color: "var(--text3)", minWidth: 88 }}>👨‍🔧 Механик</span>
            <span style={{ color: "var(--text)" }}>{assigneeNames}</span>
          </div>
        )}
        {repair.freonType && (
          <div style={{ display: "flex", gap: 10, fontSize: 12.5 }}>
            <span style={{ color: "var(--text3)", minWidth: 88 }}>❄️ Фреон</span>
            <span style={{ color: "#67e8f9" }}>{repair.freonType}{repair.freonAmount ? ` · ${repair.freonAmount} кг` : ""}</span>
          </div>
        )}
        {isAdmin && costNum > 0 && (
          <div style={{ display: "flex", gap: 10, fontSize: 12.5 }}>
            <span style={{ color: "var(--text3)", minWidth: 88 }}>💰 Итого</span>
            <span style={{ color: "#4ade80", fontWeight: 700, fontFamily: "JetBrains Mono, monospace", fontSize: 14 }}>
              {fmtMoney(costNum)}
            </span>
          </div>
        )}
      </div>

      {/* Description */}
      {repair.description && (
        <div style={{ marginBottom: 14, padding: "10px 14px", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase" as const, letterSpacing: "0.5px", marginBottom: 5 }}>Описание</div>
          <div style={{ fontSize: 13, color: "var(--text)" }}>{repair.description}</div>
        </div>
      )}

      {/* Tasks */}
      {(repair.tasks ?? []).length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase" as const, letterSpacing: "0.5px", marginBottom: 8 }}>
            Задачи · {(repair.tasks ?? []).length}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {(repair.tasks ?? []).map((t) => {
              const isDone     = t.status === "done";
              const taskNames  = (t.assignees ?? [])
                .map((uid) => staff.find((s) => s.id === uid)?.name ?? "")
                .filter(Boolean).join(", ");
              return (
                <div key={t.id} style={{
                  background: "var(--bg3)", border: "1px solid var(--border)",
                  borderRadius: 8, padding: "8px 10px", opacity: isDone ? 0.75 : 1,
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
                    <span style={{ color: isDone ? "#4ade80" : "#fbbf24", fontSize: 12, marginTop: 1, flexShrink: 0 }}>
                      {isDone ? "✓" : "●"}
                    </span>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 13, color: isDone ? "var(--text3)" : "var(--text)" }}>
                        {t.description}
                        {t.freonType && <span style={{ color: "#67e8f9" }}> · ❄️ {t.freonType}</span>}
                        {t.freonKg   && <span style={{ color: "#67e8f9" }}> {t.freonKg} кг</span>}
                      </span>
                      {taskNames && <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>👤 {taskNames}</div>}
                      {t.workComment && (
                        <div style={{ fontSize: 11, color: "var(--text2)", background: "rgba(139,92,246,0.08)", borderRadius: 5, padding: "3px 7px", marginTop: 4, border: "1px solid rgba(139,92,246,0.15)" }}>
                          <span style={{ color: "#c4b5fd", fontWeight: 600 }}>📝 </span>{t.workComment}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* All photos: repair-level + task-level combined */}
      {(() => {
        const allPhotos = [
          ...(repair.photos ?? []),
          ...(repair.tasks ?? []).flatMap((t) => t.photos ?? []),
        ];
        if (!allPhotos.length) return null;
        return (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase" as const, letterSpacing: "0.5px", marginBottom: 8 }}>
              Фото · {allPhotos.length}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {allPhotos.map((p) => {
                const src = p.url ?? p.data;
                if (!src) return null;
                return (
                  <img
                    key={p.id}
                    src={src}
                    alt=""
                    onClick={() => setLightboxUrl(src)}
                    style={{ width: 80, height: 80, borderRadius: 8, objectFit: "cover", cursor: "pointer", border: "1px solid var(--border)" }}
                  />
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Featured cost block */}
      {isAdmin && costNum > 0 && (
        <div style={{
          padding: "14px 16px",
          background: "rgba(34,197,94,0.08)",
          border: "1px solid rgba(34,197,94,0.25)",
          borderRadius: 12,
          textAlign: "center",
          marginBottom: 14,
        }}>
          <div style={{ fontSize: 11, color: "#4ade80", fontWeight: 700, marginBottom: 4, textTransform: "uppercase" as const, letterSpacing: "0.5px" }}>
            Итоговая сумма
          </div>
          <div style={{ fontSize: 30, fontWeight: 900, color: "#4ade80", fontFamily: "JetBrains Mono, monospace" }}>
            {fmtMoney(costNum)}
          </div>
        </div>
      )}

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[600] flex items-center justify-center bg-black/90 cursor-pointer"
          onClick={() => setLightboxUrl(null)}
        >
          <img src={lightboxUrl} alt="" className="max-w-[95%] max-h-[90%] object-contain rounded-xl" />
        </div>
      )}
    </Modal>
  );
}

// ─── Repair card (closed history) ────────────────────────────────────────────

function RepairCard({ item, isAdmin }: { item: DoneItem; isAdmin: boolean }) {
  const { repair, client, vehicle, assigneeNames } = item;
  const [showDetail, setShowDetail] = useState(false);
  const isCancelled = repairStatus(repair) === "cancelled";

  function openDetail() {
    console.log("[RepairCard] opening detail:", { repair, client, vehicle, assigneeNames, isAdmin });
    setShowDetail(true);
  }
  const costNum     = parseFloat(repair.cost ?? "0") || 0;

  const av       = avatarColor(client.id);
  const brand    = vehicle?.brand ?? "";
  const initials = brand.slice(0, 2).toUpperCase() || (vehicle?.plate ?? client.name).slice(0, 2).toUpperCase();

  return (
    <>
      <div
        onClick={openDetail}
        style={{
          background:   "var(--bg2)",
          borderRadius: 16,
          border:       "1px solid var(--border)",
          borderLeft:   `4px solid ${isCancelled ? "var(--text3)" : repair.closedByManager ? "var(--green)" : "var(--accent)"}`,
          padding:      "14px 16px",
          boxShadow:    "0 2px 8px rgba(0,0,0,0.07)",
          display:      "flex",
          gap:          14,
          alignItems:   "center",
          cursor:       "pointer",
        }}
      >
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
      {showDetail && <RepairDetailModal item={item} isAdmin={isAdmin} onClose={() => setShowDetail(false)} />}
    </>
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

// ─── Freon report section ─────────────────────────────────────────────────────

function FreonSection({ clients }: { clients: Client[] }) {
  const [open, setOpen] = useState(false);

  const stats = useMemo(() => {
    const byType:  Record<string, number>                    = {};
    const byMonth: Record<string, Record<string, number>>    = {};
    let total = 0;

    clients.forEach((c) => {
      (c.repairs ?? []).forEach((r) => {
        const kg  = parseFloat(r.freonAmount ?? "0") || 0;
        const typ = r.freonType;
        if (kg <= 0 || !typ) return;
        const mk = r.date?.slice(0, 7) ?? "0000-00";
        byType[typ]  = (byType[typ]  ?? 0) + kg;
        if (!byMonth[mk]) byMonth[mk] = {};
        byMonth[mk][typ] = (byMonth[mk][typ] ?? 0) + kg;
        total += kg;
      });
    });

    const typeEntries = Object.entries(byType).sort((a, b) => b[1] - a[1]);
    const monthKeys   = Object.keys(byMonth).filter((mk) => mk !== "0000-00").sort((a, b) => b.localeCompare(a));
    const allTypes    = typeEntries.map(([t]) => t);
    const maxKg       = typeEntries[0]?.[1] ?? 1;
    return { total, byType, byMonth, typeEntries, monthKeys, allTypes, maxKg };
  }, [clients]);

  if (stats.total === 0) return null;

  return (
    <div className="crm-section" style={{ animation: "fadeUp 0.5s ease 0.25s both" }}>
      <div className="section-header" style={{ background: "rgba(6,182,212,0.06)" }}>
        <i className="ti ti-snowflake" style={{ fontSize: 17, color: "#22d3ee" }} />
        <span className="section-title">Расход фреона</span>
        <div className="section-actions">
          <span style={{ fontSize: 13, fontWeight: 700, color: "#22d3ee", fontFamily: "JetBrains Mono, monospace" }}>
            {stats.total.toFixed(1)} кг
          </span>
        </div>
      </div>

      {/* Bar chart by type */}
      <div style={{ padding: "12px 16px 4px" }}>
        {stats.typeEntries.map(([typ, kg]) => (
          <div key={typ} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#67e8f9" }}>❄️ {typ}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#22d3ee", fontFamily: "JetBrains Mono, monospace" }}>
                {kg.toFixed(1)} кг
              </span>
            </div>
            <div style={{ height: 7, background: "rgba(6,182,212,0.15)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${(kg / stats.maxKg) * 100}%`,
                background: "linear-gradient(90deg,#06b6d4,#67e8f9)",
                borderRadius: 4,
                transition: "width 0.4s ease",
              }} />
            </div>
          </div>
        ))}
      </div>

      {/* Monthly table toggle */}
      {stats.monthKeys.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 6,
              padding: "9px 16px", borderTop: "1px solid var(--border)",
              background: "transparent", border: "none", cursor: "pointer",
              color: "var(--text3)", fontSize: 12, textAlign: "left",
            }}
          >
            <span style={{ fontSize: 10, display: "inline-block", transition: "transform 0.2s", transform: open ? "rotate(90deg)" : "none" }}>▶</span>
            Расход по месяцам
          </button>

          {open && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "rgba(6,182,212,0.08)" }}>
                    <th style={{ padding: "7px 16px", textAlign: "left", color: "var(--text3)", fontWeight: 600, whiteSpace: "nowrap" }}>Месяц</th>
                    {stats.allTypes.map((t) => (
                      <th key={t} style={{ padding: "7px 10px", textAlign: "right", color: "#67e8f9", fontWeight: 600, whiteSpace: "nowrap" }}>❄️ {t}</th>
                    ))}
                    <th style={{ padding: "7px 10px", textAlign: "right", color: "#22d3ee", fontWeight: 700, whiteSpace: "nowrap" }}>Итого</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.monthKeys.map((mk) => {
                    const mData  = stats.byMonth[mk];
                    const mTotal = Object.values(mData).reduce((s, v) => s + v, 0);
                    const [y, mo] = mk.split("-");
                    const label  = mo ? `${MONTH_NAMES_FULL[parseInt(mo) - 1]} ${y}` : mk;
                    return (
                      <tr key={mk} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "7px 16px", color: "var(--text2)", whiteSpace: "nowrap" }}>{label}</td>
                        {stats.allTypes.map((t) => (
                          <td key={t} style={{ padding: "7px 10px", textAlign: "right", color: "#67e8f9", fontFamily: "JetBrains Mono, monospace" }}>
                            {mData[t] ? `${mData[t].toFixed(1)} кг` : "—"}
                          </td>
                        ))}
                        <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, color: "#22d3ee", fontFamily: "JetBrains Mono, monospace" }}>
                          {mTotal.toFixed(1)} кг
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: "2px solid rgba(6,182,212,0.3)", background: "rgba(6,182,212,0.06)" }}>
                    <td style={{ padding: "7px 16px", fontWeight: 700, color: "#22d3ee" }}>Итого</td>
                    {stats.allTypes.map((t) => (
                      <td key={t} style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, color: "#22d3ee", fontFamily: "JetBrains Mono, monospace" }}>
                        {stats.byType[t].toFixed(1)} кг
                      </td>
                    ))}
                    <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 800, color: "#22d3ee", fontFamily: "JetBrains Mono, monospace" }}>
                      {stats.total.toFixed(1)} кг
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export function DoneTab() {
  const { clients, tasks, staff, freezers, finance: rawFinance } = useData();
  const { myProfile }             = useAuth();
  const isAdmin   = (myProfile?.role ?? "mechanic") !== "mechanic";
  const [search, setSearch] = useState("");

  const now   = new Date();
  const curMK = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [exportMK, setExportMK] = useState(curMK);

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

  const exportMonths = useMemo(() => {
    const months = new Set(closedItems.map((i) => i.mk).filter((mk) => mk !== "0000-00"));
    return Array.from(months).sort((a, b) => b.localeCompare(a));
  }, [closedItems]);

  function exportMonthExcel() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const finance = rawFinance as any;
    const monthItems = closedItems.filter((i) => i.mk === exportMK && i.repair.closedByManager);
    const [, m]      = exportMK.split("-");
    const mLabel     = `${MONTH_NAMES_FULL[parseInt(m) - 1]} ${exportMK.slice(0, 4)}`;

    // ── Лист 1: Ремонты ────────────────────────────────────────────────────────
    const addFreon = (map: Record<string, number>, type?: string, amt?: string) => {
      if (!type) return;
      map[type] = (map[type] ?? 0) + (parseFloat(amt ?? "0") || 0);
    };
    const freonMap: Record<string, number> = {};
    monthItems.forEach((i) => {
      addFreon(freonMap, i.repair.freonType, i.repair.freonAmount);
      (i.repair.tasks ?? []).forEach((t) => addFreon(freonMap, t.freonType, t.freonKg));
    });

    const repHeaders = ["Клиент", "Телефон", "Авто", "Гос.номер", "Дата начала", "Дата закрытия", "Механики", "Фреон", "Кол-во кг", "Сумма ₽", "Описание"];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repRows: any[][] = monthItems.map((i) => {
      const freonType = i.repair.freonType ?? (i.repair.tasks ?? []).find((t) => t.freonType)?.freonType ?? "";
      const freonAmt  = i.repair.freonAmount ?? String((i.repair.tasks ?? []).find((t) => t.freonKg)?.freonKg ?? "");
      return [
        i.client.name,
        i.client.phone ?? "",
        i.vehicle?.brand ?? i.vehicle?.model ?? "",
        i.vehicle?.plate ?? "",
        i.repair.date ?? "",
        i.repair.closedAt?.slice(0, 10) ?? "",
        i.assigneeNames,
        freonType,
        freonAmt,
        parseFloat(i.repair.cost ?? "0") || 0,
        i.repair.description ?? "",
      ];
    });
    const totalRevenue = monthItems.reduce((s, i) => s + (parseFloat(i.repair.cost ?? "0") || 0), 0);
    if (monthItems.length > 0) repRows.push(["", "", "", "", "", "", "", "", "ИТОГО:", totalRevenue, ""]);

    const ws1 = XLSX.utils.aoa_to_sheet([repHeaders, ...repRows]);
    ws1["!cols"] = [{wch:20},{wch:14},{wch:18},{wch:12},{wch:12},{wch:14},{wch:22},{wch:10},{wch:10},{wch:12},{wch:30}];

    // ── Лист 2: Расходы ────────────────────────────────────────────────────────
    const elecBills  = (finance.elecBills  ?? {}) as Record<string, number>;
    const purchases  = (finance.purchases  ?? []) as Array<{ id: string; date: string; addedAt: string; amount: number; comment: string }>;
    const boxes      = (finance.boxes      ?? []) as Array<{ id: string; name: string; cost: number }>;
    const salaries   = (finance.salaries   ?? []) as Array<{ uid: string; name: string; salary: number }>;

    const elecCost   = parseFloat(String(elecBills[exportMK] ?? 0)) || 0;
    const boxCost    = boxes.reduce((s, b) => s + (parseFloat(String(b.cost)) || 0), 0);
    const salCost    = salaries.reduce((s, s2) => s + (parseFloat(String(s2.salary)) || 0), 0);
    const mkPurchases = purchases.filter((p) => p.date?.slice(0, 7) === exportMK);
    const purTotal   = mkPurchases.reduce((s, p) => s + (parseFloat(String(p.amount)) || 0), 0);
    const rentalInc  = freezers
      .filter((f) => (f as { rented?: boolean }).rented || (f as { status?: string }).status === "rented")
      .reduce((s, f) => s + (parseFloat(String((f as { rentAmount?: number }).rentAmount ?? 0)) || 0), 0);
    const totalExp   = boxCost + salCost + elecCost + purTotal;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expRows: any[][] = [["Статья расхода", "Сумма ₽"]];
    boxes.filter((b) => b.cost > 0).forEach((b) => expRows.push([`Аренда бокса: ${b.name || "Бокс"}`, parseFloat(String(b.cost)) || 0]));
    salaries.filter((s) => s.salary > 0).forEach((s) => expRows.push([`Зарплата: ${s.name || "Сотрудник"}`, parseFloat(String(s.salary)) || 0]));
    if (elecCost > 0) expRows.push([`Электричество (${mLabel})`, elecCost]);
    mkPurchases.forEach((p) => expRows.push([`Закупка: ${p.comment}`, parseFloat(String(p.amount)) || 0]));
    expRows.push([], ["ИТОГО РАСХОДЫ", totalExp]);

    const ws2 = XLSX.utils.aoa_to_sheet(expRows);
    ws2["!cols"] = [{ wch: 35 }, { wch: 14 }];

    // ── Лист 3: P&L ───────────────────────────────────────────────────────────
    const totalInc = totalRevenue + rentalInc;
    const profit   = totalInc - totalExp;
    const totalFreonKg = Object.values(freonMap).reduce((s, v) => s + v, 0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pnlRows: any[][] = [
      [`P&L ЗА ${mLabel.toUpperCase()}`],
      [],
      ["═══ ДОХОДЫ ═══"],
      ["Ремонты",      totalRevenue, "₽", `(${monthItems.length} нарядов)`],
      ["Аренда камер", rentalInc,    "₽"],
      ["ИТОГО ДОХОДЫ", totalInc,     "₽"],
      [],
      ["═══ РАСХОДЫ ═══"],
      ...boxes.filter((b) => b.cost > 0).map((b) => [`  Аренда бокса: ${b.name || "Бокс"}`, parseFloat(String(b.cost)) || 0, "₽"]),
      ...salaries.filter((s) => s.salary > 0).map((s) => [`  Зарплата: ${s.name || "Сотрудник"}`, parseFloat(String(s.salary)) || 0, "₽"]),
      ...(elecCost > 0  ? [[`  Электричество`, elecCost, "₽"]] : []),
      ...(purTotal > 0  ? [[`  Закупки и материалы`, purTotal, "₽"]] : []),
      ["ИТОГО РАСХОДЫ", totalExp, "₽"],
      [],
      ["═══ ПРИБЫЛЬ ═══"],
      ["Прибыль за месяц", profit, "₽"],
    ];
    if (totalFreonKg > 0) {
      pnlRows.push([], ["═══ ФРЕОН ═══"]);
      Object.entries(freonMap).forEach(([type, kg]) => pnlRows.push([`  ${type}`, `${kg.toFixed(1)} кг`]));
      pnlRows.push(["  Итого", `${totalFreonKg.toFixed(1)} кг`]);
    }

    const ws3 = XLSX.utils.aoa_to_sheet(pnlRows);
    ws3["!cols"] = [{ wch: 32 }, { wch: 14 }, { wch: 5 }, { wch: 20 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, "Ремонты");
    XLSX.utils.book_append_sheet(wb, ws2, "Расходы");
    XLSX.utils.book_append_sheet(wb, ws3, "P&L");
    XLSX.writeFile(wb, `РефСервисДВ_Отчёт_${exportMK}.xlsx`);
  }

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

        {/* Export toolbar */}
        {isAdmin && exportMonths.length > 0 && (
          <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={exportMK}
              onChange={(e) => setExportMK(e.target.value)}
              style={{
                padding: "6px 10px", borderRadius: 8, fontSize: 13,
                background: "var(--bg3)", border: "1px solid var(--border2)",
                color: "var(--text)", outline: "none", cursor: "pointer",
              }}
            >
              {exportMonths.map((mk) => {
                const [y, mo] = mk.split("-");
                return <option key={mk} value={mk}>{`${MONTH_NAMES_FULL[parseInt(mo) - 1]} ${y}`}</option>;
              })}
            </select>
            <button
              type="button"
              onClick={() => exportMonthExcel()}
              style={{
                padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)",
                color: "#4ade80", cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
              }}
            >
              <i className="ti ti-table-export" style={{ fontSize: 14 }} /> Скачать Excel
            </button>
          </div>
        )}

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

      {/* Freon report */}
      <FreonSection clients={clients} />
    </div>
  );
}
