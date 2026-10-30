import type { Client, Repair } from '../../shared/types/client';
import type { Freezer } from '../../shared/types/freezer';
import type { Expense } from '../../shared/context/DataContext';
import { repairStatus, repairFinancialMonth, repairFinancialDay } from '../../shared/utils/repair';
import { resolveFixedCosts, shiftMonth, type FixedCosts } from '../../shared/utils/finance';
import { parseClosureAmount } from '../../shared/utils/repairClosure';
export interface PnlBox {
    id: string;
    name: string;
    cost: number;
}
export interface PnlSalary {
    uid: string;
    name: string;
    salary: number;
}
export interface PnlPurchase {
    id: string;
    date: string;
    addedAt: string;
    amount: number;
    comment: string;
    addedByName?: string;
}
export interface PnlFinance {
    boxes?: PnlBox[];
    salaries?: PnlSalary[];
    kwPrice?: number;
    elecBills?: Record<string, number>;
    purchases?: PnlPurchase[];
    fixedCostHistory?: Record<string, Partial<FixedCosts>>;
}
export interface PnlData {
    clients: Client[];
    freezers: Freezer[];
    finance: PnlFinance;
    expenses: Expense[];
}
export type PnlKind = 'purchase' | 'commission';
export interface PnlOperation {
    id: string;
    kind: PnlKind;
    date: string;
    amount: number;
    comment: string;
    author?: string;
    purchase?: PnlPurchase;
    expense?: Expense;
}
export interface PnlRepair {
    key: string;
    client: string;
    object: string;
    description: string;
    date: string;
    amount: number;
    repair: Repair;
}
export interface PnlMonth extends FixedCosts {
    month: string;
    repairRevenue: number;
    repairs: PnlRepair[];
    income: number;
    electricity: number;
    purchases: number;
    commissions: number;
    totalExpenses: number;
    profit: number;
    margin: number | null;
    journal: PnlOperation[];
    liveFixedFields: (keyof FixedCosts)[];
}
export function pnlAccess(role: string | undefined, panel: boolean | undefined): boolean { return role === 'owner' || (['admin', 'manager'].includes(role ?? '') && panel !== false); }
export function parsePnlAmount(value: string, positive = false): number | null { const parsed = parseClosureAmount(value); if (parsed === null)
    return null; const amount = Number(parsed); return positive && amount <= 0 ? null : amount; }
export function pnlNumber(value: unknown): number { const n = Number.parseFloat(String(value ?? 0)); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; }
const sum = (values: number[]) => values.reduce((s, v) => s + Math.round(v * 100), 0) / 100;
export function validPnlMonth(value: string): boolean { return /^\d{4}-(0[1-9]|1[0-2])$/.test(value); }
export function pnlMonthLabel(month: string): string { if (!validPnlMonth(month))
    return month; const [y, m] = month.split('-').map(Number); return new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1))); }
export const pnlMoney = (amount: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
export function localPnlDate(now = new Date()): string { return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
export function pnlMonths(data: PnlData, current: string): string[] { const months = new Set(Array.from({ length: 12 }, (_, i) => shiftMonth(current, -i))); for (const c of data.clients)
    for (const r of c.repairs ?? [])
        if (repairStatus(r) === 'done')
            months.add(repairFinancialMonth(r)); for (const p of data.finance.purchases ?? [])
    months.add(p.date?.slice(0, 7)); for (const e of data.expenses)
    if (e.category === 'commission')
        months.add(e.month); for (const m of Object.keys(data.finance.elecBills ?? {}))
    months.add(m); for (const m of Object.keys(data.finance.fixedCostHistory ?? {}))
    months.add(m); return [...months].filter(m => typeof m === 'string' && validPnlMonth(m)).sort().reverse(); }
export function buildPnlMonth(data: PnlData, month: string): PnlMonth {
    const repairs: PnlRepair[] = [];
    for (const c of data.clients)
        for (const r of c.repairs ?? []) {
            if (repairStatus(r) !== 'done' || repairFinancialMonth(r) !== month)
                continue;
            const v = c.vehicles?.find(x => x.id === r.vehicleId);
            repairs.push({ key: `${c.id}/${r.id}`, client: c.name, object: v ? [v.brand ?? v.model, v.plate].filter(Boolean).join(' · ') : r.chamberId ? 'Холодильная камера' : 'Без привязки', description: r.description ?? 'Ремонт', date: repairFinancialDay(r), amount: pnlNumber(r.cost), repair: r });
        }
    const liveRent = sum(data.freezers.filter(f => f.rented === true || f.status === 'rented').map(f => pnlNumber(f.rentAmount)));
    const fixed = resolveFixedCosts(data.finance, liveRent, month);
    for (const field of ['boxCost', 'salCost', 'rentalIncome'] as const)
        fixed[field] = pnlNumber(fixed[field]);
    const snap = data.finance.fixedCostHistory?.[month];
    const liveFixedFields = (['boxCost', 'salCost', 'rentalIncome'] as const).filter(f => snap?.[f] == null);
    const journal: PnlOperation[] = [...(data.finance.purchases ?? []).filter(p => p.date?.slice(0, 7) === month).map(p => ({ id: p.id, kind: 'purchase' as const, date: p.date, amount: pnlNumber(p.amount), comment: p.comment, author: p.addedByName, purchase: p })), ...data.expenses.filter(e => e.category === 'commission' && e.month === month).map(e => ({ id: e.id, kind: 'commission' as const, date: e.month, amount: pnlNumber(e.amount), comment: e.comment || 'Комиссионные', expense: e }))];
    const repairRevenue = sum(repairs.map(r => r.amount)), income = sum([repairRevenue, fixed.rentalIncome]), electricity = pnlNumber(data.finance.elecBills?.[month]);
    const purchases = sum(journal.filter(x => x.kind === 'purchase').map(x => x.amount)), commissions = sum(journal.filter(x => x.kind === 'commission').map(x => x.amount));
    const totalExpenses = sum([fixed.boxCost, fixed.salCost, electricity, purchases, commissions]);
    const profit = sum([income, -totalExpenses]);
    return { month, ...fixed, repairRevenue, repairs, income, electricity, purchases, commissions, totalExpenses, profit, margin: income > 0 ? profit / income * 100 : null, journal, liveFixedFields };
}
export function selectPnlJournal(rows: PnlOperation[], filters: {
    kind: 'all' | PnlKind;
    search: string;
    sort: 'newest' | 'oldest' | 'amount';
}): PnlOperation[] { const words = filters.search.trim().toLocaleLowerCase('ru-RU').split(/\s+/).filter(Boolean); return rows.filter(r => (filters.kind === 'all' || r.kind === filters.kind) && words.every(w => `${r.comment} ${r.author ?? ''} ${r.date} ${r.kind === 'purchase' ? 'закупки материалы' : 'комиссионные'}`.toLocaleLowerCase('ru-RU').includes(w))).sort((a, b) => filters.sort === 'amount' ? b.amount - a.amount : filters.sort === 'oldest' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)); }
export function pnlExportRows(m: PnlMonth): {
    summary: (string | number)[][];
    operations: (string | number)[][];
    repairs: (string | number)[][];
} { return { summary: [['P&L', pnlMonthLabel(m.month)], ['Учёт', 'Выполненные ремонты; не подтверждение оплаты'], ['Ремонты', m.repairRevenue], ['Аренда камер', m.rentalIncome], ['Доходы', m.income], ['Аренда боксов', m.boxCost], ['Зарплаты и услуги', m.salCost], ['Электричество', m.electricity], ['Закупки и материалы', m.purchases], ['Комиссионные', m.commissions], ['Расходы', m.totalExpenses], ['Результат', m.profit], ['Источник постоянных сумм', m.liveFixedFields.length ? `Текущие настройки: ${m.liveFixedFields.map(k=>({boxCost:'аренда боксов',salCost:'зарплаты и услуги',rentalIncome:'аренда камер'}[k])).join(', ')}. Остальные постоянные суммы сохранены для периода.` : 'Сохранённые суммы периода']], operations: [['Период / дата', 'Статья', 'Описание', 'Сумма ₽'], ...m.journal.map(r => [r.date, r.kind === 'purchase' ? 'Закупки и материалы' : 'Комиссионные', r.comment, r.amount])], repairs: [['Дата учёта', 'Клиент', 'Техника', 'Работа', 'Сумма ₽'], ...m.repairs.map(r => [r.date, r.client, r.object, r.description, r.amount])] }; }

export interface PnlAttempt {id:string;addedAt:string}
/** Keep the identity even when a user edits an uncertain submission. */
export function preparePnlAttempt(previous:PnlAttempt|null,newId:string,now:string):PnlAttempt{return previous??{id:newId,addedAt:now};}
/** Only an untouched/new form follows the viewing month; unfinished input stays put. */
export function pnlEntryPeriodOnOpen(period:{date:string;month:string},dirty:boolean,selected:string,today:string):{date:string;month:string}{return dirty?period:{date:selected===today.slice(0,7)?today:`${selected}-01`,month:selected};}
