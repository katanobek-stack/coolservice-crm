import { useState, useMemo, useCallback } from "react";
import { useData } from "../context/DataContext";
import { useAuth } from "../../features/auth";
import { repairStatus } from "../utils/repair";
import { fmtDate } from "../utils/format";
import { Modal } from "./Modal";
import { Input } from "./Input";
import { Badge } from "./Badge";

interface SearchResult {
  type: "client" | "repair" | "vehicle";
  clientId:   string;
  clientName: string;
  title:      string;
  sub?:       string;
  badge?:     string;
  badgeVariant?: "blue" | "green" | "amber" | "red" | "gray";
}

export function GlobalSearch({ onClose }: { onClose: () => void }) {
  const { clients } = useData();
  const { myProfile } = useAuth();
  const role    = myProfile?.role ?? "mechanic";
  const isAdmin = role === "admin" || role === "manager";

  const [query, setQuery] = useState("");

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];

    const out: SearchResult[] = [];

    clients.forEach((c) => {
      // Match client name / phone
      const nameMatch  = c.name.toLowerCase().includes(q);
      const phoneMatch = (c.phone ?? "").includes(q);
      if (nameMatch || phoneMatch) {
        const activeR = (c.repairs ?? []).filter((r) => repairStatus(r) === "in_progress").length;
        out.push({
          type:       "client",
          clientId:   c.id,
          clientName: c.name,
          title:      c.name,
          sub:        c.phone ?? "",
          badge:      activeR > 0 ? `В работе: ${activeR}` : undefined,
          badgeVariant: "amber",
        });
      }

      // Match vehicles by plate or brand
      (c.vehicles ?? []).forEach((v) => {
        const brandName = v.brand ?? v.model ?? "";
        if (v.plate.toLowerCase().includes(q) || brandName.toLowerCase().includes(q)) {
          out.push({
            type:       "vehicle",
            clientId:   c.id,
            clientName: c.name,
            title:      v.plate,
            sub:        `${c.name}${brandName ? " · " + brandName : ""}`,
          });
        }
      });

      // Match repairs by description / date / cost
      (c.repairs ?? []).forEach((r) => {
        const descMatch = (r.description ?? "").toLowerCase().includes(q);
        const costMatch = isAdmin && (r.cost ?? "").includes(q);
        const dateMatch = fmtDate(r.date).toLowerCase().includes(q);
        if (descMatch || costMatch || dateMatch) {
          const status = repairStatus(r);
          const v      = (c.vehicles ?? []).find((vv) => vv.id === r.vehicleId);
          out.push({
            type:       "repair",
            clientId:   c.id,
            clientName: c.name,
            title:      r.description || "Ремонт",
            sub:        `${c.name}${v ? " · " + v.plate : ""} · ${fmtDate(r.date)}`,
            badge:      status === "done" ? "Готово" : status === "cancelled" ? "Отказ" : "В работе",
            badgeVariant: status === "done" ? "green" : status === "cancelled" ? "gray" : "amber",
          });
        }
      });
    });

    return out.slice(0, 30);
  }, [query, clients, isAdmin]);

  const icons: Record<SearchResult["type"], string> = {
    client:  "👤",
    repair:  "🔧",
    vehicle: "🚗",
  };

  return (
    <Modal title="Поиск" onClose={onClose}>
      <div className="mb-4">
        <Input
          placeholder="Имя клиента, номер авто, описание ремонта..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      {query.trim().length > 0 && query.trim().length < 2 && (
        <div style={{ textAlign: "center", fontSize: 13, color: "var(--text3)", padding: "16px 0" }}>
          Введите минимум 2 символа
        </div>
      )}

      {query.trim().length >= 2 && results.length === 0 && (
        <div style={{ textAlign: "center", fontSize: 13, color: "var(--text3)", padding: "32px 0" }}>
          Ничего не найдено
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {results.map((r, i) => (
          <div
            key={i}
            style={{
              background: "var(--bg3)", borderRadius: 10, padding: "10px 14px",
              border: "1px solid var(--border)", cursor: "pointer", transition: "all 0.15s",
            }}
            onClick={onClose}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--border2)"; e.currentTarget.style.background = "rgba(59,130,246,0.06)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg3)"; }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>{icons[r.type]}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>{r.title}</span>
                  {r.badge && (
                    <Badge variant={r.badgeVariant ?? "gray"}>{r.badge}</Badge>
                  )}
                </div>
                {r.sub && (
                  <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>{r.sub}</div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {query.trim().length < 2 && (
        <div style={{ textAlign: "center", fontSize: 12, color: "var(--text3)", padding: "24px 0" }}>
          Поиск по клиентам, авто и ремонтам
        </div>
      )}
    </Modal>
  );
}
