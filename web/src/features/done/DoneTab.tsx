import { useState, useMemo } from "react";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import { repairStatus } from "../../shared/utils/repair";
import { fmtDate, fmtMoney } from "../../shared/utils/format";
import { Badge } from "../../shared/ui/Badge";
import { Input } from "../../shared/ui/Input";

export function DoneTab() {
  const { clients } = useData();
  const { myProfile } = useAuth();
  const role = myProfile?.role ?? "mechanic";
  const isAdmin = role === "admin";
  const [search, setSearch] = useState("");

  const doneRepairs = useMemo(() => {
    const result: Array<{
      clientName: string;
      plate?: string;
      repair: (typeof clients)[0]["repairs"][0];
    }> = [];

    clients.forEach((c) => {
      (c.repairs ?? [])
        .filter((r) => repairStatus(r) === "done")
        .forEach((r) => {
          const vehicle = (c.vehicles ?? []).find((v) => v.id === r.vehicleId);
          result.push({ clientName: c.name, plate: vehicle?.plate, repair: r });
        });
    });

    return result.sort((a, b) => {
      const da = a.repair.date ?? "";
      const db = b.repair.date ?? "";
      return db.localeCompare(da);
    });
  }, [clients]);

  const filtered = useMemo(() => {
    if (!search.trim()) return doneRepairs;
    const q = search.toLowerCase();
    return doneRepairs.filter(
      (r) =>
        r.clientName.toLowerCase().includes(q) ||
        (r.plate ?? "").toLowerCase().includes(q),
    );
  }, [doneRepairs, search]);

  const totalRevenue = isAdmin
    ? doneRepairs.reduce((s, r) => s + (parseFloat(r.repair.cost ?? "0") || 0), 0)
    : 0;

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="text-lg font-bold text-[#172033]">Отчёты</div>
        {isAdmin && (
          <div className="text-sm font-bold text-[#3B6D11]">{fmtMoney(totalRevenue)}</div>
        )}
      </div>
      <div className="text-xs text-[#667085] mb-3">Завершено: {doneRepairs.length}</div>

      <div className="mb-3">
        <Input
          placeholder="🔍 Поиск по клиенту или авто..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-[#98A2B3] text-sm">
          {search ? "Ничего не найдено" : "Нет завершённых работ"}
        </div>
      )}

      {filtered.map(({ clientName, plate, repair }) => (
        <div
          key={repair.id}
          className="bg-white rounded-[18px] border-l-4 border border-[#E2E8F0] p-3.5 mb-2.5 shadow-sm"
          style={{ borderLeftColor: "#3B6D11" }}
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="font-semibold text-[#172033] text-sm">{clientName}</div>
            <Badge variant="green">Готово</Badge>
          </div>
          {plate && (
            <span className="text-xs bg-[#F2F4F7] text-[#344054] px-2 py-0.5 rounded font-mono">
              {plate}
            </span>
          )}
          {repair.description && (
            <div className="text-sm text-[#344054] mt-1">{repair.description}</div>
          )}
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-xs text-[#98A2B3]">{fmtDate(repair.date)}</span>
            {repair.cost && isAdmin && (
              <span className="text-sm font-bold text-[#3B6D11]">{repair.cost} ₽</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
