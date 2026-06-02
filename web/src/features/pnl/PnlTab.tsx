import { useMemo, useState } from "react";
import { useData } from "../../shared/context/DataContext";
import { repairStatus } from "../../shared/utils/repair";
import { fmtMoney, fmtDate, genId } from "../../shared/utils/format";
import { Button } from "../../shared/ui/Button";
import { Input, FormGroup } from "../../shared/ui/Input";
import { saveFinance } from "../../shared/firebase/firestore";

// ─── Types for finance document ───────────────────────────────────────────────

interface Box      { id: string; name: string; cost: number }
interface Salary   { uid: string; name: string; salary: number }
interface Purchase { id: string; date: string; addedAt: string; amount: number; comment: string; addedByName?: string }
type ElecBills = Record<string, number>;

interface FinanceDoc {
  boxes?:     Box[];
  salaries?:  Salary[];
  kwPrice?:   number;
  elecBills?: ElecBills;
  purchases?: Purchase[];
}

// ─── Month names ──────────────────────────────────────────────────────────────

const MONTH_NAMES = ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"];
const MONTH_NAMES_FULL = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];

function mkLabel(mk: string): string {
  const [y, m] = mk.split("-");
  return `${MONTH_NAMES_FULL[parseInt(m)-1]} ${y}`;
}

// ─── Section card ─────────────────────────────────────────────────────────────

function SectionCard({ title, icon, children }: { title: string; icon?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-[18px] p-4 border border-[#E2E8F0] shadow-sm mb-3">
      <div className="text-xs font-bold text-[#667085] uppercase tracking-wide mb-3">
        {icon && <span className="mr-1">{icon}</span>}{title}
      </div>
      {children}
    </div>
  );
}

// ─── Expenses settings modal ──────────────────────────────────────────────────

function ExpensesModal({ finance, onClose }: { finance: FinanceDoc; onClose: () => void }) {
  const [boxes,    setBoxes]    = useState<Box[]>(finance.boxes?.length ? [...finance.boxes] : [{ id: genId(), name: "", cost: 0 }]);
  const [salaries, setSalaries] = useState<Salary[]>(finance.salaries?.length ? [...finance.salaries] : [{ uid: genId(), name: "", salary: 0 }]);
  const [kwPrice,  setKwPrice]  = useState(String(finance.kwPrice ?? ""));
  const [saving,   setSaving]   = useState(false);

  async function handleSave() {
    setSaving(true);
    await saveFinance({
      boxes:    boxes.map((b) => ({ id: b.id || genId(), name: b.name, cost: parseFloat(String(b.cost)) || 0 })),
      salaries: salaries.map((s) => ({ uid: s.uid || genId(), name: s.name, salary: parseFloat(String(s.salary)) || 0 })),
      kwPrice:  parseFloat(kwPrice) || 0,
      elecBills: finance.elecBills ?? {},
      purchases: finance.purchases ?? [],
    });
    onClose();
  }

  function updateBox(i: number, field: keyof Box, value: string | number) {
    setBoxes((prev) => prev.map((b, j) => j === i ? { ...b, [field]: value } : b));
  }

  function updateSalary(i: number, field: keyof Salary, value: string | number) {
    setSalaries((prev) => prev.map((s, j) => j === i ? { ...s, [field]: value } : s));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(15,23,42,.38)", backdropFilter: "blur(8px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-[560px] rounded-t-[28px] overflow-y-auto bg-white"
        style={{ maxHeight: "92vh", padding: "20px 18px 40px", boxShadow: "0 -20px 60px rgba(15,23,42,.20)", borderBottom: "none" }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[#172033]">⚙️ Настройки расходов</h2>
          <button type="button" onClick={onClose} className="text-2xl text-[#8A96A8] leading-none cursor-pointer bg-transparent border-none">×</button>
        </div>

        {/* Boxes */}
        <div className="mb-4">
          <div className="text-xs font-bold text-[#667085] uppercase tracking-wide mb-2">Аренда боксов</div>
          {boxes.map((b, i) => (
            <div key={b.id} className="flex gap-2 mb-2">
              <Input placeholder="Название бокса" value={b.name} onChange={(e) => updateBox(i, "name", e.target.value)} className="flex-[2]" />
              <Input type="number" placeholder="₽/мес" value={b.cost > 0 ? b.cost : ""} onChange={(e) => updateBox(i, "cost", e.target.value)} className="flex-1 !min-h-0" />
              <button type="button" onClick={() => setBoxes((prev) => prev.filter((_, j) => j !== i))}
                className="text-red-400 bg-white border border-red-100 rounded-xl px-2.5 cursor-pointer text-sm flex-shrink-0">×</button>
            </div>
          ))}
          <button type="button" onClick={() => setBoxes((prev) => [...prev, { id: genId(), name: "", cost: 0 }])}
            className="w-full py-2 rounded-xl border border-dashed border-[#7CB7EA] text-[#185FA5] text-xs font-semibold cursor-pointer bg-white">
            + Добавить бокс
          </button>
        </div>

        {/* Salaries */}
        <div className="mb-4">
          <div className="text-xs font-bold text-[#667085] uppercase tracking-wide mb-2">Зарплаты и услуги</div>
          {salaries.map((s, i) => (
            <div key={s.uid} className="flex gap-2 mb-2">
              <Input placeholder="Имя / должность" value={s.name} onChange={(e) => updateSalary(i, "name", e.target.value)} className="flex-[2]" />
              <Input type="number" placeholder="₽/мес" value={s.salary > 0 ? s.salary : ""} onChange={(e) => updateSalary(i, "salary", e.target.value)} className="flex-1 !min-h-0" />
              <button type="button" onClick={() => setSalaries((prev) => prev.filter((_, j) => j !== i))}
                className="text-red-400 bg-white border border-red-100 rounded-xl px-2.5 cursor-pointer text-sm flex-shrink-0">×</button>
            </div>
          ))}
          <button type="button" onClick={() => setSalaries((prev) => [...prev, { uid: genId(), name: "", salary: 0 }])}
            className="w-full py-2 rounded-xl border border-dashed border-[#7CB7EA] text-[#185FA5] text-xs font-semibold cursor-pointer bg-white">
            + Добавить
          </button>
        </div>

        {/* kWh price */}
        <div className="mb-4">
          <div className="text-xs font-bold text-[#667085] uppercase tracking-wide mb-2">Цена электричества (₽/кВт·ч)</div>
          <Input type="number" step="0.01" placeholder="6.50" value={kwPrice} onChange={(e) => setKwPrice(e.target.value)} />
        </div>

        <Button size="lg" onClick={() => void handleSave()} disabled={saving}>{saving ? "Сохранение..." : "💾 Сохранить"}</Button>
      </div>
    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export function PnlTab() {
  const { clients, freezers, finance: rawFinance } = useData();
  const finance = rawFinance as unknown as FinanceDoc;
  const now     = new Date();
  const curMK   = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;

  const [showExpenses, setShowExpenses] = useState(false);
  const [elecInput,    setElecInput]    = useState("");
  const [elecMK,       setElecMK]       = useState(curMK);
  const [newPurAmt,    setNewPurAmt]    = useState("");
  const [newPurCmt,    setNewPurCmt]    = useState("");
  const [savingPur,    setSavingPur]    = useState(false);
  const [savingElec,   setSavingElec]   = useState(false);

  // ── Revenue ──────────────────────────────────────────────────────────────
  const allDone = useMemo(
    () => clients.flatMap((c) => (c.repairs ?? []).filter((r) => repairStatus(r) === "done")
      .map((r) => ({ ...r, clientId: c.id, clientName: c.name }))),
    [clients],
  );

  const monthStats = useMemo(() => {
    const map = new Map<string, { revenue: number; repairs: number; label: string }>();
    for (let i = 11; i >= 0; i--) {
      const d  = new Date(now.getFullYear(), now.getMonth()-i, 1);
      const mk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      map.set(mk, { revenue: 0, repairs: 0, label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}` });
    }
    allDone.forEach((r) => {
      const mk = r.date?.slice(0,7);
      if (!mk || !map.has(mk)) return;
      const prev = map.get(mk)!;
      map.set(mk, { ...prev, revenue: prev.revenue + (parseFloat(r.cost ?? "0") || 0), repairs: prev.repairs + 1 });
    });
    return Array.from(map.entries()).map(([mk, v]) => ({ month: mk, ...v })).sort((a,b) => b.month.localeCompare(a.month));
  }, [allDone]);

  const totalRevenue = allDone.reduce((s,r) => s + (parseFloat(r.cost ?? "0") || 0), 0);

  // ── Rental income ─────────────────────────────────────────────────────────
  const rentalIncome = freezers
    .filter((f) => f.rented === true || f.status === "rented")
    .reduce((s, f) => s + (parseFloat(String(f.rentAmount ?? 0)) || 0), 0);

  // ── Expenses ──────────────────────────────────────────────────────────────
  const boxCost  = (finance.boxes    ?? []).reduce((s, b) => s + (parseFloat(String(b.cost))   || 0), 0);
  const salCost  = (finance.salaries ?? []).reduce((s, s2) => s + (parseFloat(String(s2.salary)) || 0), 0);
  const elecBills = finance.elecBills ?? {};
  const curElec  = parseFloat(String(elecBills[curMK] ?? 0)) || 0;
  const totalExpenses = boxCost + salCost + curElec;

  // ── Purchases (current month) ─────────────────────────────────────────────
  const purchases = finance.purchases ?? [];
  const curPurchases = purchases.filter((p) => p.date?.slice(0,7) === curMK);
  const curPurTotal  = curPurchases.reduce((s, p) => s + (parseFloat(String(p.amount)) || 0), 0);

  // ── P&L ──────────────────────────────────────────────────────────────────
  const curMonthRev = monthStats.find((m) => m.month === curMK)?.revenue ?? 0;
  const curIncome   = curMonthRev + rentalIncome;
  const curProfit   = curIncome - totalExpenses - curPurTotal;

  async function saveElecBill() {
    const val = parseFloat(elecInput);
    if (isNaN(val)) return;
    setSavingElec(true);
    await saveFinance({ elecBills: { ...elecBills, [elecMK]: val } });
    setSavingElec(false);
    setElecInput("");
  }

  async function addPurchase() {
    const amt = parseFloat(newPurAmt);
    if (isNaN(amt) || amt <= 0 || !newPurCmt.trim()) return;
    setSavingPur(true);
    const newP: Purchase = {
      id:         genId(),
      date:       now.toISOString().slice(0,10),
      addedAt:    now.toISOString(),
      amount:     amt,
      comment:    newPurCmt.trim(),
    };
    await saveFinance({ purchases: [...purchases, newP] });
    setNewPurAmt("");
    setNewPurCmt("");
    setSavingPur(false);
  }

  async function deletePurchase(id: string) {
    await saveFinance({ purchases: purchases.filter((p) => p.id !== id) });
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="text-lg font-bold text-[#172033]">P&amp;L</div>
        <button
          type="button"
          onClick={() => setShowExpenses(true)}
          className="text-xs text-[#667085] bg-[#F2F4F7] px-3 py-1.5 rounded-xl border border-[#E2E8F0] cursor-pointer"
        >
          ⚙️ Расходы
        </button>
      </div>
      <div className="text-xs text-[#667085] mb-4">Текущий месяц: {MONTH_NAMES_FULL[now.getMonth()]} {now.getFullYear()}</div>

      {/* Current month P&L */}
      <div className="grid grid-cols-2 gap-2.5 mb-4">
        <div className="bg-white rounded-[18px] p-4 border border-[#E2E8F0] shadow-sm">
          <div className="text-xl font-bold text-[#3B6D11]">{fmtMoney(curIncome)}</div>
          <div className="text-xs text-[#667085]">Доходы</div>
          <div className="text-[10px] text-[#98A2B3] mt-0.5">
            Ремонты {fmtMoney(curMonthRev)} + Аренда {fmtMoney(rentalIncome)}
          </div>
        </div>
        <div className="bg-white rounded-[18px] p-4 border border-[#E2E8F0] shadow-sm">
          <div className="text-xl font-bold text-[#A32D2D]">{fmtMoney(totalExpenses + curPurTotal)}</div>
          <div className="text-xs text-[#667085]">Расходы</div>
          <div className="text-[10px] text-[#98A2B3] mt-0.5">Пост. + закупки</div>
        </div>
        <div className="col-span-2 bg-white rounded-[18px] p-4 border border-[#E2E8F0] shadow-sm">
          <div className={`text-2xl font-bold ${curProfit >= 0 ? "text-[#3B6D11]" : "text-[#A32D2D]"}`}>
            {curProfit >= 0 ? "+" : ""}{fmtMoney(curProfit)}
          </div>
          <div className="text-xs text-[#667085]">Прибыль</div>
        </div>
      </div>

      {/* Permanent expenses breakdown */}
      {(finance.boxes?.length || finance.salaries?.length) && (
        <SectionCard title="Постоянные расходы" icon="📋">
          {(finance.boxes ?? []).filter((b) => b.cost > 0).map((b) => (
            <div key={b.id} className="flex justify-between text-sm mb-1.5">
              <span className="text-[#344054]">🏠 {b.name || "Бокс"}</span>
              <span className="font-semibold text-[#A32D2D]">{fmtMoney(b.cost)}/мес</span>
            </div>
          ))}
          {(finance.salaries ?? []).filter((s) => s.salary > 0).map((s) => (
            <div key={s.uid} className="flex justify-between text-sm mb-1.5">
              <span className="text-[#344054]">👤 {s.name || "Сотрудник"}</span>
              <span className="font-semibold text-[#A32D2D]">{fmtMoney(s.salary)}/мес</span>
            </div>
          ))}
          <div className="border-t border-[#E2E8F0] mt-2 pt-2 flex justify-between text-sm font-bold">
            <span>Итого</span>
            <span className="text-[#A32D2D]">{fmtMoney(boxCost + salCost)}/мес</span>
          </div>
        </SectionCard>
      )}

      {/* Electricity */}
      <SectionCard title="Электричество" icon="⚡">
        <div className="flex gap-2 mb-3">
          <select
            value={elecMK}
            onChange={(e) => setElecMK(e.target.value)}
            className="flex-1 px-3 py-2 rounded-xl border border-[#E2E8F0] text-sm bg-white text-[#172033] outline-none"
          >
            {Array.from({ length: 6 }, (_, i) => {
              const d  = new Date(now.getFullYear(), now.getMonth()-i, 1);
              const mk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
              return <option key={mk} value={mk}>{MONTH_NAMES[d.getMonth()]} {d.getFullYear()}</option>;
            })}
          </select>
          <Input
            type="number"
            placeholder="Сумма ₽"
            value={elecInput}
            onChange={(e) => setElecInput(e.target.value)}
            className="w-28 !min-h-0 !py-2"
          />
          <Button size="sm" onClick={() => void saveElecBill()} disabled={savingElec}>💾</Button>
        </div>
        {/* Show saved bills */}
        {Object.entries(elecBills).filter(([, v]) => v > 0).sort(([a],[b]) => b.localeCompare(a)).slice(0, 4).map(([mk, v]) => (
          <div key={mk} className="flex justify-between text-xs text-[#667085] mb-1">
            <span>{mkLabel(mk)}</span>
            <span className="font-semibold text-[#A32D2D]">{fmtMoney(v as number)}</span>
          </div>
        ))}
      </SectionCard>

      {/* Purchases / materials */}
      <SectionCard title={`Закупки и материалы (${curMK.slice(0,7)})`} icon="🛒">
        <div className="flex gap-2 mb-3 flex-wrap">
          <Input
            type="number"
            placeholder="Сумма ₽"
            value={newPurAmt}
            onChange={(e) => setNewPurAmt(e.target.value)}
            className="w-28 !min-h-0 !py-2"
          />
          <Input
            placeholder="Что закупили"
            value={newPurCmt}
            onChange={(e) => setNewPurCmt(e.target.value)}
            className="flex-1 !min-h-0 !py-2"
          />
          <Button size="sm" onClick={() => void addPurchase()} disabled={savingPur}>+ Добавить</Button>
        </div>
        {curPurchases.length > 0 && (
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {[...curPurchases].sort((a,b) => b.addedAt.localeCompare(a.addedAt)).map((p) => (
              <div key={p.id} className="flex items-center gap-2 bg-[#F7F9FC] rounded-xl px-3 py-2 border border-[#E2E8F0]">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-[#172033] truncate">{p.comment}</div>
                  <div className="text-[10px] text-[#98A2B3]">{fmtDate(p.date)}</div>
                </div>
                <span className="text-xs font-bold text-purple-600 whitespace-nowrap">{fmtMoney(p.amount)}</span>
                <button type="button" onClick={() => void deletePurchase(p.id)}
                  className="text-[#98A2B3] text-sm cursor-pointer bg-transparent border-none">×</button>
              </div>
            ))}
          </div>
        )}
        {curPurTotal > 0 && (
          <div className="border-t border-[#E2E8F0] mt-2 pt-2 flex justify-between text-sm font-bold">
            <span>Итого</span>
            <span className="text-purple-600">{fmtMoney(curPurTotal)}</span>
          </div>
        )}
      </SectionCard>

      {/* Monthly breakdown */}
      <SectionCard title="Выручка по месяцам" icon="📊">
        {monthStats.filter((m) => m.revenue > 0).length === 0 ? (
          <div className="text-center py-4 text-sm text-[#98A2B3]">Нет данных</div>
        ) : (
          monthStats.filter((m) => m.revenue > 0).map((m) => (
            <div key={m.month} className="flex items-center justify-between py-2 border-b border-[#E2E8F0] last:border-0">
              <div>
                <div className="text-sm font-semibold text-[#172033]">{m.label}</div>
                <div className="text-xs text-[#667085]">{m.repairs} ремонтов</div>
              </div>
              <span className="text-base font-bold text-[#3B6D11]">{fmtMoney(m.revenue)}</span>
            </div>
          ))
        )}
        <div className="border-t border-[#E2E8F0] mt-2 pt-2 flex justify-between text-sm font-bold">
          <span>Итого выручка</span>
          <span className="text-[#3B6D11]">{fmtMoney(totalRevenue)}</span>
        </div>
      </SectionCard>

      {showExpenses && (
        <ExpensesModal finance={finance} onClose={() => setShowExpenses(false)} />
      )}
    </div>
  );
}
