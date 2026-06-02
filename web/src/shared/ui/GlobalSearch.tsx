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
        <div className="text-center text-sm text-[#98A2B3] py-4">
          Введите минимум 2 символа
        </div>
      )}

      {query.trim().length >= 2 && results.length === 0 && (
        <div className="text-center text-sm text-[#98A2B3] py-8">
          Ничего не найдено
        </div>
      )}

      <div className="space-y-2">
        {results.map((r, i) => (
          <div
            key={i}
            className="bg-[#F7F9FC] rounded-xl px-3 py-3 border border-[#E2E8F0] hover:bg-[#E6F1FB] transition-all cursor-pointer"
            onClick={onClose}
          >
            <div className="flex items-start gap-2">
              <span className="text-base flex-shrink-0">{icons[r.type]}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-[#172033]">{r.title}</span>
                  {r.badge && (
                    <Badge variant={r.badgeVariant ?? "gray"}>{r.badge}</Badge>
                  )}
                </div>
                {r.sub && (
                  <div className="text-xs text-[#667085] mt-0.5">{r.sub}</div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {query.trim().length < 2 && (
        <div className="text-center text-xs text-[#98A2B3] py-8">
          Поиск по клиентам, авто и ремонтам
        </div>
      )}
    </Modal>
  );
}
