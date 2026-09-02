import { useMemo, useState } from "react";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import { repairStatus, repairFinancialMonth } from "../../shared/utils/repair";
import { fmtMoney, fmtDate, genId } from "../../shared/utils/format";
import { Button } from "../../shared/ui/Button";
import { Input, FormGroup } from "../../shared/ui/Input";
import { addExpense, deleteExpense } from "../../shared/firebase/firestore";
import {
  addFinancePurchase,
  removeFinancePurchase,
  saveFinanceConfiguration,
  setFinanceMapValue,
} from "../../shared/firebase/concurrency";

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
  // Per-month frozen fixed costs, written on each config change (see finance.ts).
  fixedCostHistory?: Record<string, { boxCost?: number; salCost?: number; rentalIncome?: number }>;
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

function ExpensesModal({ finance, rentalIncome, onClose }: { finance: FinanceDoc; rentalIncome: number; onClose: () => void }) {
  const [boxes,    setBoxes]    = useState<Box[]>(finance.boxes?.length ? [...finance.boxes] : [{ id: genId(), name: "", cost: 0 }]);
  const [salaries, setSalaries] = useState<Salary[]>(finance.salaries?.length ? [...finance.salaries] : [{ uid: genId(), name: "", salary: 0 }]);
  const [kwPrice,  setKwPrice]  = useState(String(finance.kwPrice ?? ""));
  const [saving,   setSaving]   = useState(false);

  async function handleSave() {
    setSaving(true);
    await saveFinanceConfiguration({
      boxes: finance.boxes,
      salaries: finance.salaries,
      kwPrice: finance.kwPrice,
    }, {
      boxes:    boxes.map((b) => ({ id: b.id || genId(), name: b.name, cost: parseFloat(String(b.cost)) || 0 })),
      salaries: salaries.map((s) => ({ uid: s.uid || genId(), name: s.name, salary: parseFloat(String(s.salary)) || 0 })),
      kwPrice:  parseFloat(kwPrice) || 0,
    }, rentalIncome);
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
  const { clients, freezers, finance: rawFinance, expenses } = useData();
  const { user } = useAuth();
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
  const [newComMK,     setNewComMK]     = useState(curMK);
  const [newComAmt,    setNewComAmt]    = useState("");
  const [newComCmt,    setNewComCmt]    = useState("");
  const [savingCom,    setSavingCom]    = useState(false);

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
      const mk = repairFinancialMonth(r);
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

  // ── Commissions (current month) ───────────────────────────────────────────
  const commissions    = expenses.filter((e) => e.category === "commission");
  const curCommissions = commissions.filter((e) => e.month === curMK);
  const curCommTotal   = curCommissions.reduce((s, e) => s + (parseFloat(String(e.amount)) || 0), 0);

  // ── P&L ──────────────────────────────────────────────────────────────────
  const curMonthRev = monthStats.find((m) => m.month === curMK)?.revenue ?? 0;
  const curIncome   = curMonthRev + rentalIncome;
  const curProfit   = curIncome - totalExpenses - curPurTotal - curCommTotal;

  async function addCommission() {
    const amt = parseFloat(newComAmt);
    if (isNaN(amt) || amt <= 0) return;
    setSavingCom(true);
    await addExpense({
      category:  "commission",
      month:     newComMK,
      amount:    amt,
      comment:   newComCmt.trim(),
      createdBy: user?.uid ?? "",
    });
    setNewComAmt("");
    setNewComCmt("");
    setSavingCom(false);
  }

  async function saveElecBill() {
    const val = parseFloat(elecInput);
    if (isNaN(val)) return;
    setSavingElec(true);
    await setFinanceMapValue("elecBills", elecMK, val);
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
    await addFinancePurchase(newP);
    setNewPurAmt("");
    setNewPurCmt("");
    setSavingPur(false);
  }

  async function deletePurchase(id: string) {
    await removeFinancePurchase(id);
  }

  const CURMONTH_LABEL = `${MONTH_NAMES_FULL[now.getMonth()]} ${now.getFullYear()}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      {/* ── KPI: Доходы / Расходы / Прибыль ─────────────────────────────── */}
      <div className="kpi-grid" style={{ animation: "fadeUp 0.45s ease 0.1s both" }}>
        <div className="kpi-card green">
          <i className="ti ti-trending-up kpi-icon" />
          <div className="kpi-label">Доходы / {MONTH_NAMES[now.getMonth()]}</div>
          <div className="kpi-value" style={{ color: "#16a34a" }}>{fmtMoney(curIncome)}</div>
          <div className="kpi-delta muted">
            Рем. {fmtMoney(curMonthRev)} + Аренда {fmtMoney(rentalIncome)}
          </div>
        </div>
        <div className="kpi-card" style={{ borderTop: "2px solid var(--red)" }}>
          <i className="ti ti-trending-down kpi-icon" />
          <div className="kpi-label">Расходы</div>
          <div className="kpi-value" style={{ color: "#dc2626" }}>{fmtMoney(totalExpenses + curPurTotal + curCommTotal)}</div>
          <div className="kpi-delta muted">Пост. + закупки + ком.</div>
        </div>
        <div className="kpi-card blue" style={{ gridColumn: "span 2" }}>
          <i className={`ti ${curProfit >= 0 ? "ti-trophy" : "ti-alert-circle"} kpi-icon`} />
          <div className="kpi-label">Прибыль / {CURMONTH_LABEL}</div>
          <div className="kpi-value" style={{ color: curProfit >= 0 ? "#16a34a" : "#dc2626" }}>
            {curProfit >= 0 ? "+" : ""}{fmtMoney(curProfit)}
          </div>
          <button
            type="button"
            onClick={() => setShowExpenses(true)}
            style={{
              marginTop: 6, padding: "4px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600,
              background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text2)",
              cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4,
            }}
          >
            <i className="ti ti-settings" style={{ fontSize: 12 }} /> Настроить расходы
          </button>
        </div>
      </div>

      {/* ── Закупки и материалы ──────────────────────────────────────────── */}
      <div className="crm-section" style={{ animation: "fadeUp 0.45s ease 0.2s both" }}>
        <div className="section-header" style={{ background: "rgba(139,92,246,0.06)" }}>
          <i className="ti ti-shopping-cart" style={{ fontSize: 17, color: "#7c3aed" }} />
          <span className="section-title">Закупки и материалы</span>
          <span className="section-count">{CURMONTH_LABEL}</span>
          {curPurTotal > 0 && (
            <div className="section-actions">
              <span style={{ fontSize: 13, fontWeight: 700, color: "#7c3aed", fontFamily: "JetBrains Mono, monospace" }}>
                {fmtMoney(curPurTotal)}
              </span>
            </div>
          )}
        </div>

        {/* Add form */}
        <div style={{ display: "flex", gap: 8, padding: "12px 16px", flexWrap: "wrap" as const, borderBottom: "1px solid var(--border)" }}>
          <input
            type="number"
            placeholder="Сумма ₽"
            value={newPurAmt}
            onChange={(e) => setNewPurAmt(e.target.value)}
            style={{
              width: 120, padding: "8px 12px", borderRadius: 8, fontSize: 14, fontWeight: 600,
              background: "var(--bg3)", border: "1px solid var(--border2)", color: "var(--text)",
              outline: "none", fontFamily: "JetBrains Mono, monospace",
            }}
            onKeyDown={(e) => e.key === "Enter" && void addPurchase()}
          />
          <input
            type="text"
            placeholder="Что закупили..."
            value={newPurCmt}
            onChange={(e) => setNewPurCmt(e.target.value)}
            style={{
              flex: 1, minWidth: 140, padding: "8px 12px", borderRadius: 8, fontSize: 13,
              background: "var(--bg3)", border: "1px solid var(--border2)", color: "var(--text)",
              outline: "none",
            }}
            onKeyDown={(e) => e.key === "Enter" && void addPurchase()}
          />
          <button
            type="button"
            onClick={() => void addPurchase()}
            disabled={savingPur}
            style={{
              padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700,
              background: "rgba(139,92,246,0.2)", border: "1px solid rgba(139,92,246,0.3)",
              color: "#7c3aed", cursor: savingPur ? "not-allowed" : "pointer",
            }}
          >
            {savingPur ? "..." : "+ Добавить"}
          </button>
        </div>

        {/* Purchases list */}
        {curPurchases.length === 0 ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
            Нет закупок в этом месяце
          </div>
        ) : (
          <div style={{ maxHeight: 280, overflowY: "auto" }}>
            {[...curPurchases].sort((a,b) => b.addedAt.localeCompare(a.addedAt)).map((p, i) => (
              <div
                key={p.id}
                className="tr-animate"
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "11px 16px", borderBottom: "1px solid var(--border)",
                  animationDelay: `${i * 0.06}s`,
                }}
              >
                <div style={{
                  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                  background: "rgba(139,92,246,0.12)", color: "#7c3aed",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
                }}>
                  🛒
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.comment}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 1 }}>
                    {fmtDate(p.date)}{p.addedByName ? ` · ${p.addedByName}` : ""}
                  </div>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#7c3aed", fontFamily: "JetBrains Mono, monospace", flexShrink: 0 }}>
                  {fmtMoney(p.amount)}
                </span>
                <button
                  type="button"
                  onClick={() => void deletePurchase(p.id)}
                  style={{ width: 24, height: 24, borderRadius: 6, background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text3)", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                >
                  ×
                </button>
              </div>
            ))}
            {curPurTotal > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 16px", borderTop: "1px solid var(--border2)" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text2)" }}>Итого закупки</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: "#7c3aed", fontFamily: "JetBrains Mono, monospace" }}>
                  {fmtMoney(curPurTotal)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Комиссионные ────────────────────────────────────────────────── */}
      <div className="crm-section" style={{ animation: "fadeUp 0.45s ease 0.25s both" }}>
        <div className="section-header" style={{ background: "rgba(245,158,11,0.06)" }}>
          <i className="ti ti-handshake" style={{ fontSize: 17, color: "#b45309" }} />
          <span className="section-title">Комиссионные</span>
          <span className="section-count">{CURMONTH_LABEL}</span>
          {curCommTotal > 0 && (
            <div className="section-actions">
              <span style={{ fontSize: 13, fontWeight: 700, color: "#b45309", fontFamily: "JetBrains Mono, monospace" }}>
                {fmtMoney(curCommTotal)}
              </span>
            </div>
          )}
        </div>

        {/* Add form */}
        <div style={{ display: "flex", gap: 8, padding: "12px 16px", flexWrap: "wrap" as const, borderBottom: "1px solid var(--border)" }}>
          <select
            value={newComMK}
            onChange={(e) => setNewComMK(e.target.value)}
            style={{
              padding: "8px 10px", borderRadius: 8, fontSize: 13,
              background: "var(--bg3)", border: "1px solid var(--border2)",
              color: "var(--text)", outline: "none", cursor: "pointer", flexShrink: 0,
            }}
          >
            {Array.from({ length: 6 }, (_, i) => {
              const d  = new Date(now.getFullYear(), now.getMonth() - i, 1);
              const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
              return <option key={mk} value={mk}>{MONTH_NAMES[d.getMonth()]} {d.getFullYear()}</option>;
            })}
          </select>
          <input
            type="number"
            placeholder="Сумма ₽"
            value={newComAmt}
            onChange={(e) => setNewComAmt(e.target.value)}
            style={{
              width: 110, padding: "8px 12px", borderRadius: 8, fontSize: 14, fontWeight: 600,
              background: "var(--bg3)", border: "1px solid var(--border2)", color: "var(--text)",
              outline: "none", fontFamily: "JetBrains Mono, monospace",
            }}
            onKeyDown={(e) => e.key === "Enter" && void addCommission()}
          />
          <input
            type="text"
            placeholder="Комментарий (необязательно)"
            value={newComCmt}
            onChange={(e) => setNewComCmt(e.target.value)}
            style={{
              flex: 1, minWidth: 130, padding: "8px 12px", borderRadius: 8, fontSize: 13,
              background: "var(--bg3)", border: "1px solid var(--border2)", color: "var(--text)",
              outline: "none",
            }}
            onKeyDown={(e) => e.key === "Enter" && void addCommission()}
          />
          <button
            type="button"
            onClick={() => void addCommission()}
            disabled={savingCom}
            style={{
              padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700,
              background: "rgba(245,158,11,0.18)", border: "1px solid rgba(245,158,11,0.35)",
              color: "#b45309", cursor: savingCom ? "not-allowed" : "pointer",
            }}
          >
            {savingCom ? "..." : "+ Добавить"}
          </button>
        </div>

        {/* Commission list */}
        {commissions.length === 0 ? (
          <div style={{ padding: "18px 16px", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
            Нет записей о комиссионных
          </div>
        ) : (
          <div style={{ maxHeight: 280, overflowY: "auto" }}>
            {[...commissions].sort((a, b) => b.month.localeCompare(a.month)).map((e, i) => (
              <div
                key={e.id}
                className="tr-animate"
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "11px 16px", borderBottom: "1px solid var(--border)",
                  animationDelay: `${i * 0.05}s`,
                }}
              >
                <div style={{
                  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                  background: "rgba(245,158,11,0.12)", color: "#b45309",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
                }}>
                  🤝
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text2)" }}>
                    {mkLabel(e.month)}
                  </div>
                  {e.comment && (
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {e.comment}
                    </div>
                  )}
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#b45309", fontFamily: "JetBrains Mono, monospace", flexShrink: 0 }}>
                  {fmtMoney(e.amount)}
                </span>
                <button
                  type="button"
                  onClick={() => void deleteExpense(e.id)}
                  style={{ width: 24, height: 24, borderRadius: 6, background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text3)", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Постоянные расходы ──────────────────────────────────────────── */}
      {((finance.boxes ?? []).some((b) => b.cost > 0) || (finance.salaries ?? []).some((s) => s.salary > 0)) && (
        <div className="crm-section" style={{ animation: "fadeUp 0.45s ease 0.3s both" }}>
          <div className="section-header">
            <i className="ti ti-receipt" style={{ fontSize: 17, color: "var(--text2)" }} />
            <span className="section-title">Постоянные расходы</span>
            <span className="section-count">{fmtMoney(boxCost + salCost)}/мес</span>
          </div>
          <div style={{ padding: "8px 16px 12px" }}>
            {(finance.boxes ?? []).filter((b) => b.cost > 0).map((b) => (
              <div key={b.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontSize: 13.5, color: "var(--text)" }}>🏠 {b.name || "Бокс"}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#dc2626", fontFamily: "JetBrains Mono, monospace" }}>{fmtMoney(b.cost)}/мес</span>
              </div>
            ))}
            {(finance.salaries ?? []).filter((s) => s.salary > 0).map((s) => (
              <div key={s.uid} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontSize: 13.5, color: "var(--text)" }}>👤 {s.name || "Сотрудник"}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#dc2626", fontFamily: "JetBrains Mono, monospace" }}>{fmtMoney(s.salary)}/мес</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Электричество ──────────────────────────────────────────────── */}
      <div className="crm-section" style={{ animation: "fadeUp 0.45s ease 0.35s both" }}>
        <div className="section-header">
          <i className="ti ti-bolt" style={{ fontSize: 17, color: "var(--yellow)" }} />
          <span className="section-title">Электричество</span>
        </div>
        <div style={{ padding: "12px 16px" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" as const }}>
            <select
              value={elecMK}
              onChange={(e) => setElecMK(e.target.value)}
              style={{
                flex: 1, minWidth: 120, padding: "8px 12px", borderRadius: 8, fontSize: 13,
                background: "var(--bg3)", border: "1px solid var(--border2)", color: "var(--text)",
                outline: "none", cursor: "pointer",
              }}
            >
              {Array.from({ length: 6 }, (_, i) => {
                const d  = new Date(now.getFullYear(), now.getMonth()-i, 1);
                const mk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
                return <option key={mk} value={mk}>{MONTH_NAMES[d.getMonth()]} {d.getFullYear()}</option>;
              })}
            </select>
            <input
              type="number"
              placeholder="Сумма ₽"
              value={elecInput}
              onChange={(e) => setElecInput(e.target.value)}
              style={{
                width: 120, padding: "8px 12px", borderRadius: 8, fontSize: 13,
                background: "var(--bg3)", border: "1px solid var(--border2)", color: "var(--text)",
                outline: "none", fontFamily: "JetBrains Mono, monospace",
              }}
            />
            <Button size="sm" onClick={() => void saveElecBill()} disabled={savingElec}>💾</Button>
          </div>
          {Object.entries(elecBills).filter(([, v]) => v > 0).sort(([a],[b]) => b.localeCompare(a)).slice(0, 4).map(([mk, v]) => (
            <div key={mk} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
              <span style={{ fontSize: 13, color: "var(--text2)" }}>{mkLabel(mk)}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#dc2626", fontFamily: "JetBrains Mono, monospace" }}>{fmtMoney(v as number)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Выручка по месяцам ──────────────────────────────────────────── */}
      <div className="crm-section" style={{ animation: "fadeUp 0.45s ease 0.4s both" }}>
        <div className="section-header">
          <i className="ti ti-chart-bar" style={{ fontSize: 17, color: "var(--text2)" }} />
          <span className="section-title">Выручка по месяцам</span>
          <div className="section-actions">
            <span style={{ fontSize: 12, color: "#16a34a", fontFamily: "JetBrains Mono, monospace" }}>
              {fmtMoney(totalRevenue)}
            </span>
          </div>
        </div>

        {monthStats.filter((m) => m.revenue > 0).length === 0 ? (
          <div style={{ padding: "28px 20px", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
            Нет данных — закрывайте наряды через «Закрыть наряд»
          </div>
        ) : (
          monthStats.filter((m) => m.revenue > 0).map((m, i, arr) => (
            <div
              key={m.month}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "11px 20px",
                borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none",
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>{m.label}</div>
                <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                  <i className="ti ti-tools" style={{ fontSize: 10 }} /> {m.repairs} ремонтов
                </div>
              </div>
              <span style={{ fontSize: 14, fontWeight: 800, color: "#16a34a", fontFamily: "JetBrains Mono, monospace" }}>
                {fmtMoney(m.revenue)}
              </span>
            </div>
          ))
        )}
        <div style={{
          display: "flex", justifyContent: "space-between", padding: "10px 20px",
          borderTop: "1px solid var(--border2)", background: "rgba(0,0,0,0.1)",
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text2)" }}>Всего выручка</span>
          <span style={{ fontSize: 15, fontWeight: 800, color: "#16a34a", fontFamily: "JetBrains Mono, monospace" }}>
            {fmtMoney(totalRevenue)}
          </span>
        </div>
      </div>

      {showExpenses && (
        <ExpensesModal finance={finance} rentalIncome={rentalIncome} onClose={() => setShowExpenses(false)} />
      )}
    </div>
  );
}
