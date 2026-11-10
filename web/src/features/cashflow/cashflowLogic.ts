import type { Client } from '../../shared/types/client';
import type { Freezer } from '../../shared/types/freezer';
import { requestStage } from '../../shared/requests/workspaceLogic';
import { repairFinancialDay } from '../../shared/utils/repair';

export type CashflowKind = 'income' | 'expense' | 'transfer';
export type CashflowStatus = 'actual' | 'planned' | 'void';
export type CashflowSourceType = 'manual' | 'repair' | 'salary' | 'rent' | 'rental' | 'subscription';
export interface CashflowAccount { id: string; name: string; openedOn: string; openingCents: number; createdBy: string; }
export interface CashflowEntry {
  id: string; kind: CashflowKind; status: CashflowStatus; date: string;
  accountId: string; targetAccountId: string; amountCents: number; category: string;
  counterparty: string; comment: string; sourceKey: string; sourceType: CashflowSourceType;
  createdBy: string; createdAt?: unknown; plannedDate?: string;
  postedBy?: string; postedAt?: unknown; voidReason?: string; voidedBy?: string; voidedAt?: unknown;
}
export const CASHFLOW_CATEGORIES: Array<{ id: string; label: string; kind: CashflowKind; activity: string }> = [
  { id: 'repairs', label: 'Ремонты и услуги', kind: 'income', activity: 'Операционная' },
  { id: 'rental', label: 'Аренда камер', kind: 'income', activity: 'Операционная' },
  { id: 'subscription', label: 'Абонентское обслуживание', kind: 'income', activity: 'Операционная' },
  { id: 'partsSale', label: 'Продажа запчастей', kind: 'income', activity: 'Операционная' },
  { id: 'supplierRefund', label: 'Возврат от поставщика', kind: 'income', activity: 'Операционная' },
  { id: 'otherIncome', label: 'Прочие поступления', kind: 'income', activity: 'Операционная' },
  { id: 'parts', label: 'Запчасти и материалы', kind: 'expense', activity: 'Операционная' },
  { id: 'freon', label: 'Хладагент и газы', kind: 'expense', activity: 'Операционная' },
  { id: 'salary', label: 'Зарплата и выплаты мастерам', kind: 'expense', activity: 'Операционная' },
  { id: 'rent', label: 'Аренда боксов и площадки', kind: 'expense', activity: 'Операционная' },
  { id: 'utilities', label: 'Электричество и коммунальные', kind: 'expense', activity: 'Операционная' },
  { id: 'transport', label: 'Транспорт и выезды', kind: 'expense', activity: 'Операционная' },
  { id: 'contractor', label: 'Подрядчики', kind: 'expense', activity: 'Операционная' },
  { id: 'marketing', label: 'Реклама', kind: 'expense', activity: 'Операционная' },
  { id: 'tax', label: 'Налоги и взносы', kind: 'expense', activity: 'Операционная' },
  { id: 'bank', label: 'Комиссии банка и эквайринг', kind: 'expense', activity: 'Операционная' },
  { id: 'overhead', label: 'Связь, программы и прочие расходы', kind: 'expense', activity: 'Операционная' },
  { id: 'clientRefund', label: 'Возврат клиенту', kind: 'expense', activity: 'Операционная' },
  { id: 'equipment', label: 'Покупка оборудования', kind: 'expense', activity: 'Инвестиционная' },
  { id: 'equipmentSale', label: 'Продажа оборудования', kind: 'income', activity: 'Инвестиционная' },
  { id: 'loan', label: 'Получение займа', kind: 'income', activity: 'Финансовая' },
  { id: 'loanRepayment', label: 'Возврат основного долга', kind: 'expense', activity: 'Финансовая' },
  { id: 'interest', label: 'Проценты', kind: 'expense', activity: 'Операционная' },
  { id: 'ownerIn', label: 'Вклад собственника', kind: 'income', activity: 'Финансовая' },
  { id: 'ownerOut', label: 'Изъятие собственника', kind: 'expense', activity: 'Финансовая' },
  { id: 'depositIn', label: 'Получение возвратного залога', kind: 'income', activity: 'Финансовая' },
  { id: 'depositOut', label: 'Возврат залога', kind: 'expense', activity: 'Финансовая' },
  { id: 'transfer', label: 'Перевод между своими счетами', kind: 'transfer', activity: 'Внутренняя' },
];
export const cashflowCategory = (id: string) => CASHFLOW_CATEGORIES.find(c => c.id === id);
export const cashflowMoney = (cents: number) => (cents / 100).toLocaleString('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 2 });
export const cashflowToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Vladivostok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export function validCashflowDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === date && date >= '1900-01-01';
}
export function cashflowShift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
export function cashflowPeriod(month: string): { start: string; end: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !validCashflowDate(`${month}-01`)) throw new Error('Укажите месяц отчёта.');
  const start = `${month}-01`, d = new Date(`${start}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1);
  return { start, end: d.toISOString().slice(0, 10) };
}
export function parseCashflowMoney(value: string, signed = false): number | null {
  const normal = value.trim().replace(/\s/g, '').replace(',', '.');
  if (!(signed ? /^-?\d+(?:\.\d{1,2})?$/ : /^\d+(?:\.\d{1,2})?$/).test(normal)) return null;
  const cents = Math.round(Number(normal) * 100);
  return Number.isSafeInteger(cents) && Math.abs(cents) <= 1_000_000_000_000 ? cents : null;
}
export function cashflowAccess(role: string | undefined, financialPanel?: boolean): boolean {
  return role === 'owner' || ((role === 'admin' || role === 'manager') && financialPanel !== false);
}
export function validateCashflowAccount(a: CashflowAccount): void {
  if (!a.id || a.id.includes('/') || !a.name?.trim() || a.name.length > 80 || !validCashflowDate(a.openedOn) || !Number.isSafeInteger(a.openingCents) || Math.abs(a.openingCents) > 1_000_000_000_000 || !a.createdBy) throw new Error('Проверьте название счёта, дату начала и начальный остаток.');
}
export function validateCashflowEntry(e: CashflowEntry, accounts: readonly CashflowAccount[], today = cashflowToday()): void {
  const account = accounts.find(a => a.id === e.accountId), target = accounts.find(a => a.id === e.targetAccountId), category = cashflowCategory(e.category);
  if (!e.id || e.id.includes('/') || !['actual', 'planned', 'void'].includes(e.status) || !validCashflowDate(e.date) || !Number.isSafeInteger(e.amountCents) || e.amountCents <= 0 || e.amountCents > 1_000_000_000_000 || !account || e.date < account.openedOn || category?.kind !== e.kind || !e.createdBy || typeof e.comment !== 'string' || e.comment.length > 1000 || typeof e.counterparty !== 'string' || e.counterparty.length > 200 || typeof e.sourceKey !== 'string' || e.sourceKey.length > 300 || !['manual', 'repair', 'salary', 'rent', 'rental', 'subscription'].includes(e.sourceType)) throw new Error('Проверьте дату, сумму, счёт и статью операции.');
  if (e.kind === 'transfer' ? !target || target.id === account.id || e.date < target.openedOn : e.targetAccountId !== '') throw new Error('Для перевода выберите два разных счёта.');
  if (e.status === 'actual' && e.date > today) throw new Error('Будущую оплату сохраните в план. Фактическая дата не может быть позже сегодняшней.');
  if (e.status === 'void' && (!e.voidReason?.trim() || !e.voidedBy)) throw new Error('Укажите причину аннулирования.');
}
export function cashflowEffect(e: CashflowEntry, accountId = ''): number {
  if (e.kind === 'transfer') return accountId ? (e.accountId === accountId ? -e.amountCents : e.targetAccountId === accountId ? e.amountCents : 0) : 0;
  return !accountId || e.accountId === accountId ? e.amountCents * (e.kind === 'income' ? 1 : -1) : 0;
}
const relevant = (e: CashflowEntry, id: string) => !id || e.accountId === id || (e.kind === 'transfer' && e.targetAccountId === id);
export function buildCashflow(accounts: readonly CashflowAccount[], entries: readonly CashflowEntry[], month: string, accountId = '', today = cashflowToday()) {
  const { start, end } = cashflowPeriod(month);
  if (accountId && !accounts.some(a => a.id === accountId)) throw new Error('Выбранный счёт не найден.');
  const selected = accounts.filter(a => !accountId || a.id === accountId);
  const actual = entries.filter(e => e.status === 'actual' && e.date <= today);
  const periodEntries = entries.filter(e => e.date >= start && e.date < end && relevant(e, accountId)).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const periodActual = periodEntries.filter(e => e.status === 'actual' && e.date <= today);
  const sum = (rows: readonly CashflowEntry[], predicate: (e: CashflowEntry) => boolean) => rows.filter(predicate).reduce((total, e) => total + e.amountCents, 0);
  const openingCents = selected.filter(a => a.openedOn <= start && a.openedOn <= today).reduce((n, a) => n + a.openingCents, 0) + actual.filter(e => e.date < start).reduce((n, e) => n + cashflowEffect(e, accountId), 0);
  const introducedCents = selected.filter(a => a.openedOn > start && a.openedOn < end && a.openedOn <= today).reduce((n, a) => n + a.openingCents, 0);
  const incomeCents = sum(periodActual, e => e.kind === 'income'), expenseCents = sum(periodActual, e => e.kind === 'expense');
  const transferCents = periodActual.filter(e => e.kind === 'transfer').reduce((n, e) => n + cashflowEffect(e, accountId), 0);
  const closingCents = openingCents + introducedCents + incomeCents - expenseCents + transferCents;
  // A posted plan keeps its original budget date. Posting changes cash, not the approved plan.
  const planned = entries.filter(e => {
    const date = e.status === 'planned' ? e.date : e.plannedDate;
    return e.status !== 'void' && date && date >= start && date < end && relevant(e, accountId);
  });
  const plannedIncomeCents = sum(planned, e => e.kind === 'income'), plannedExpenseCents = sum(planned, e => e.kind === 'expense');
  const accountBalances = selected.map(a => ({ ...a, available: a.openedOn <= today, balanceCents: a.openedOn <= today ? a.openingCents + actual.reduce((n, e) => n + cashflowEffect(e, a.id), 0) : null }));
  const categories = CASHFLOW_CATEGORIES.filter(c => c.kind !== 'transfer').map(c => ({ ...c, actualCents: sum(periodActual, e => e.category === c.id), plannedCents: sum(planned, e => e.category === c.id) }));
  let forecastBalance = accountBalances.reduce((n, a) => n + (a.balanceCents ?? 0), 0);
  const forecast = Array.from({ length: 13 }, (_, week) => {
    const from = cashflowShift(today, week * 7), until = cashflowShift(from, 7);
    const rows = entries.filter(e => e.status === 'planned' && relevant(e, accountId) && e.date < until && (week === 0 || e.date >= from));
    const inCents = sum(rows, e => e.kind === 'income'), outCents = sum(rows, e => e.kind === 'expense');
    const transfers = rows.filter(e => e.kind === 'transfer').reduce((n, e) => n + cashflowEffect(e, accountId), 0);
    forecastBalance += inCents - outCents + transfers;
    return { from, through: cashflowShift(until, -1), inCents, outCents, transferCents: transfers, balanceCents: forecastBalance };
  });
  return { month, today, accountId, accountName: accountId ? selected[0].name : 'Все счета', start, end, openingCents, introducedCents, incomeCents, expenseCents, transferCents, closingCents, plannedIncomeCents, plannedExpenseCents, periodEntries, budgetEntries: planned, categories, accountBalances, forecast, accounts };
}
export type CashflowReport = ReturnType<typeof buildCashflow>;
export interface CashflowSource { key: string; type: CashflowSourceType; kind: 'income' | 'expense'; category: string; counterparty: string; title: string; comment: string; amountCents: number; paidCents: number; reservedCents: number; remainingCents: number; }
export interface CashflowSourceData { clients: readonly Client[]; freezers: readonly Freezer[]; finance: Record<string, unknown>; }
export function cashflowSources(data: CashflowSourceData, entries: readonly CashflowEntry[], month: string, today = cashflowToday()): CashflowSource[] {
  cashflowPeriod(month);
  const sources: CashflowSource[] = [];
  const add = (input: Omit<CashflowSource, 'paidCents' | 'reservedCents' | 'remainingCents'>) => {
    if (input.amountCents <= 0) return;
    const linked = entries.filter(e => e.sourceKey === input.key && e.kind !== 'transfer' && e.status !== 'void');
    const paidCents = linked.filter(e => e.status === 'actual' && e.date <= today).reduce((n, e) => n + e.amountCents * (e.kind === input.kind ? 1 : -1), 0);
    const reservedCents = linked.filter(e => e.status === 'planned').reduce((n, e) => n + e.amountCents * (e.kind === input.kind ? 1 : -1), 0);
    sources.push({ ...input, paidCents, reservedCents, remainingCents: Math.max(0, input.amountCents - paidCents - reservedCents) });
  };
  for (const client of data.clients) {
    for (const repair of client.repairs ?? []) {
      const day = repairFinancialDay(repair), amount = parseCashflowMoney(String(repair.cost ?? ''));
      if (requestStage(repair) !== 'closed' || day.slice(0, 7) !== month || amount === null) continue;
      const vehicle = client.vehicles?.find(v => v.id === repair.vehicleId);
      add({ key: `repair:${client.id}:${repair.id}`, type: 'repair', kind: 'income', category: 'repairs', counterparty: client.name, title: [client.name, vehicle?.plate].filter(Boolean).join(' · '), comment: [repair.description, ...(repair.tasks ?? []).map(t => t.description)].filter(Boolean).join('; ').slice(0, 1000), amountCents: amount });
    }
    const subscription = parseCashflowMoney(String(client.subscription ?? ''));
    if (subscription !== null && subscription > 0) add({ key: `subscription:${client.id}:${month}`, type: 'subscription', kind: 'income', category: 'subscription', counterparty: client.name, title: `${client.name} · абонплата`, comment: `Абонентское обслуживание за ${month}. Проверьте договор и период.`, amountCents: subscription });
  }
  for (const freezer of data.freezers) if (freezer.rented || freezer.status === 'rented') {
    const amount = parseCashflowMoney(String(freezer.rentAmount ?? ''));
    if (amount !== null) add({ key: `rental:${freezer.id}:${month}`, type: 'rental', kind: 'income', category: 'rental', counterparty: freezer.tenant ?? '', title: freezer.name || freezer.type || 'Аренда камеры', comment: `Аренда за ${month}. Проверьте срок аренды и сумму.`, amountCents: amount });
  }
  for (const [field, category, type] of [['salaries', 'salary', 'salary'], ['boxes', 'rent', 'rent']] as const) {
    const rows = data.finance[field];
    if (!Array.isArray(rows)) continue;
    for (const item of rows as Array<Record<string, unknown>>) {
      const amount = parseCashflowMoney(String(item[field === 'salaries' ? 'salary' : 'cost'] ?? '')), id = item.uid ?? item.id;
      if (amount === null || typeof id !== 'string') continue;
      const title = String(item.name ?? (type === 'salary' ? 'Сотрудник' : 'Аренда бокса'));
      add({ key: `${type}:${id}:${month}`, type, kind: 'expense', category, counterparty: title, title, comment: `${type === 'salary' ? 'Выплата зарплаты' : 'Оплата аренды'} за ${month}. Проверьте начисление и дату оплаты.`, amountCents: amount });
    }
  }
  return sources;
}
export function cashflowExportRows(m: CashflowReport) {
  const accountName = (id: string) => m.accounts.find(a => a.id === id)?.name ?? id;
  return {
    summary: [['ДДС РефСервисДВ', m.month], ['Счета', m.accountName], ['Дата среза', m.today], ['Учёт', 'Реальное движение денег, все суммы с НДС. Не отчёт о прибыли.'], ['Остаток на начало', m.openingCents / 100], ['Начальные остатки счетов, введённых в периоде', m.introducedCents / 100], ['Поступления', m.incomeCents / 100], ['Выплаты', m.expenseCents / 100], ['Внутренние переводы, нетто', m.transferCents / 100], ['Остаток на конец / дату среза', m.closingCents / 100], ['План поступлений', m.plannedIncomeCents / 100], ['План выплат', m.plannedExpenseCents / 100]],
    operations: [['ID', 'Дата', 'Статус', 'Операция', 'Статья', 'Счёт', 'Счёт получателя', 'Сумма ₽', 'Контрагент', 'Назначение', 'Источник', 'Создал', 'Плановая дата', 'Аннулировал', 'Причина'], ...m.periodEntries.map(e => [e.id, e.date, { actual: 'Факт', planned: 'План', void: 'Аннулировано' }[e.status], { income: 'Поступление', expense: 'Выплата', transfer: 'Перевод' }[e.kind], cashflowCategory(e.category)?.label ?? e.category, accountName(e.accountId), e.targetAccountId ? accountName(e.targetAccountId) : '', e.amountCents / 100, e.counterparty, e.comment, e.sourceKey, e.createdBy, e.plannedDate ?? '', e.voidedBy ?? '', e.voidReason ?? ''])],
    categories: [['Статья', 'Деятельность', 'Поступление / Выплата', 'Факт ₽', 'План ₽', 'Факт − план ₽'], ...m.categories.map(c => [c.label, c.activity, c.kind === 'income' ? 'Поступление' : 'Выплата', c.actualCents / 100, c.plannedCents / 100, (c.actualCents - c.plannedCents) / 100])],
    accounts: [['Счёт', 'Дата начала учёта', 'Начальный остаток ₽', `Остаток на ${m.today}, ₽`], ...m.accountBalances.map(a => [a.name, a.openedOn, a.openingCents / 100, a.balanceCents === null ? 'Учёт ещё не начат' : a.balanceCents / 100])],
    forecast: [['С', 'По', 'План поступлений ₽', 'План выплат ₽', 'Переводы, нетто ₽', 'Ожидаемый остаток ₽'], ...m.forecast.map(row => [row.from, row.through, row.inCents / 100, row.outCents / 100, row.transferCents / 100, row.balanceCents / 100])],
    budget: [['ID', 'Плановая дата', 'Фактическая дата', 'Статья', 'Сумма ₽', 'Контрагент', 'Состояние'], ...m.budgetEntries.map(e => [e.id, e.plannedDate ?? e.date, e.status === 'actual' ? e.date : '', cashflowCategory(e.category)?.label ?? e.category, e.amountCents / 100, e.counterparty, e.status === 'actual' ? 'Оплачен' : 'Ожидается'])],
  };
}
