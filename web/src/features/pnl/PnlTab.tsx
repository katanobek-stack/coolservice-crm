import { useMemo, useState } from "react";
import { useData } from "../../shared/context/DataContext";
import { repairStatus } from "../../shared/utils/repair";
import { fmtMoney } from "../../shared/utils/format";

interface MonthStats {
  month: string;
  label: string;
  revenue: number;
  repairs: number;
}

export function PnlTab() {
  const { clients, freezers, finance } = useData();

  const monthStats = useMemo<MonthStats[]>(() => {
    const map = new Map<string, MonthStats>();

    clients.forEach((c) => {
      (c.repairs ?? [])
        .filter((r) => repairStatus(r) === "done" && r.date)
        .forEach((r) => {
          const d = new Date(r.date!);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          const label = d.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
          const prev = map.get(key) ?? { month: key, label, revenue: 0, repairs: 0 };
          map.set(key, {
            ...prev,
            revenue: prev.revenue + (parseFloat(r.cost ?? "0") || 0),
            repairs: prev.repairs + 1,
          });
        });
    });

    return Array.from(map.values()).sort((a, b) => b.month.localeCompare(a.month));
  }, [clients]);

  const rentalIncome = freezers
    .filter((f) => f.status === "rented")
    .reduce((s, f) => s + (parseFloat(f.rentalRate ?? "0") || 0), 0);

  const totalRevenue = monthStats.reduce((s, m) => s + m.revenue, 0);
  const expenses = parseFloat(String(finance.expenses ?? "0")) || 0;
  const profit = totalRevenue + rentalIncome * 12 - expenses;

  return (
    <div className="p-4">
      <div className="text-lg font-bold text-[#172033] mb-1">P&amp;L</div>
      <div className="text-xs text-[#667085] mb-4">Только для администратора</div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-2.5 mb-4">
        <div className="bg-white rounded-[18px] p-4 border border-[#E2E8F0] shadow-sm">
          <div className="text-xl font-bold text-[#3B6D11]">{fmtMoney(totalRevenue)}</div>
          <div className="text-xs text-[#667085]">Выручка (ремонты)</div>
        </div>
        <div className="bg-white rounded-[18px] p-4 border border-[#E2E8F0] shadow-sm">
          <div className="text-xl font-bold text-[#185FA5]">{fmtMoney(rentalIncome)}</div>
          <div className="text-xs text-[#667085]">Аренда (в мес.)</div>
        </div>
        <div className="bg-white rounded-[18px] p-4 border border-[#E2E8F0] shadow-sm">
          <div className="text-xl font-bold text-[#BA7517]">{fmtMoney(expenses)}</div>
          <div className="text-xs text-[#667085]">Расходы</div>
        </div>
        <div className="bg-white rounded-[18px] p-4 border border-[#E2E8F0] shadow-sm">
          <div className={`text-xl font-bold ${profit >= 0 ? "text-[#3B6D11]" : "text-[#A32D2D]"}`}>
            {fmtMoney(profit)}
          </div>
          <div className="text-xs text-[#667085]">Прибыль</div>
        </div>
      </div>

      {/* Monthly breakdown */}
      <div className="text-xs font-bold text-[#667085] uppercase tracking-wide mb-2">
        По месяцам
      </div>
      {monthStats.length === 0 && (
        <div className="text-center py-8 text-[#98A2B3] text-sm">
          Нет данных о завершённых ремонтах
        </div>
      )}
      {monthStats.map((m) => (
        <div
          key={m.month}
          className="bg-white rounded-[16px] border border-[#E2E8F0] p-3.5 mb-2 shadow-sm flex items-center justify-between"
        >
          <div>
            <div className="text-sm font-semibold text-[#172033] capitalize">{m.label}</div>
            <div className="text-xs text-[#667085]">{m.repairs} ремонтов</div>
          </div>
          <div className="text-base font-bold text-[#3B6D11]">{fmtMoney(m.revenue)}</div>
        </div>
      ))}
    </div>
  );
}
