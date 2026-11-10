import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCashflow, cashflowSources, cashflowExportRows, parseCashflowMoney, validateCashflowEntry, type CashflowAccount, type CashflowEntry } from '../src/features/cashflow/cashflowLogic';
import { cashflowAccess } from '../src/features/cashflow/cashflowLogic';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CashflowSummary, CashflowJournal } from '../src/features/cashflow/CashflowWorkspace';

const accounts: CashflowAccount[] = [
  { id: 'bank', name: 'Банк', openedOn: '2026-10-01', openingCents: 10000000, createdBy: 'owner' },
  { id: 'cash', name: 'Касса', openedOn: '2026-10-01', openingCents: 0, createdBy: 'owner' },
];
const entry = (id: string, extra: Partial<CashflowEntry> = {}): CashflowEntry => ({ id, kind: 'income', status: 'actual', date: '2026-11-03', accountId: 'bank', targetAccountId: '', amountCents: 100050, category: 'repairs', counterparty: 'Клиент', comment: 'Оплата', sourceKey: '', sourceType: 'manual', createdBy: 'owner', ...extra });

test('money is parsed strictly to integer kopecks, including explicit opening zero and negatives', () => {
  assert.equal(parseCashflowMoney('1 250,50'), 125050); assert.equal(parseCashflowMoney('0'), 0);
  assert.equal(parseCashflowMoney('-20,01', true), -2001);
  for (const x of ['', '2e3', '1руб', '-2', '1.234', 'Infinity', '99999999999999999']) assert.equal(parseCashflowMoney(x), null, x);
});
test('monthly balances roll prior actuals, exclude plans and voids, keep cents', () => {
  const m = buildCashflow(accounts, [entry('old', { date: '2026-10-20', amountCents: 500000 }), entry('in'), entry('out', { kind: 'expense', category: 'salary', amountCents: 200000 }), entry('plan', { status: 'planned', amountCents: 900000 }), entry('void', { status: 'void', amountCents: 900000, voidReason: 'Ошибка', voidedBy: 'owner' })], '2026-11', '', '2026-11-10');
  assert.equal(m.openingCents, 10500000); assert.equal(m.incomeCents, 100050); assert.equal(m.expenseCents, 200000); assert.equal(m.closingCents, 10400050); assert.equal(m.plannedIncomeCents, 900000);
});
test('a single transfer is atomic and changes account balances without external receipts or expenses', () => {
  const entries = [entry('transfer', { kind: 'transfer', category: 'transfer', targetAccountId: 'cash', amountCents: 300000 })];
  const total = buildCashflow(accounts, entries, '2026-11', '', '2026-11-10');
  assert.equal(total.incomeCents, 0); assert.equal(total.expenseCents, 0); assert.equal(total.closingCents, 10000000);
  const bank = buildCashflow(accounts, entries, '2026-11', 'bank', '2026-11-10'); const cash = buildCashflow(accounts, entries, '2026-11', 'cash', '2026-11-10');
  assert.equal(bank.transferCents, -300000); assert.equal(bank.closingCents, 9700000); assert.equal(cash.closingCents, 300000);
});
test('opening an account within a month adds a disclosed initial balance rather than invented revenue', () => {
  const m = buildCashflow([{ ...accounts[0], openedOn: '2026-11-05' }], [], '2026-11', '', '2026-11-10');
  assert.equal(m.openingCents, 0); assert.equal(m.introducedCents, 10000000); assert.equal(m.incomeCents, 0); assert.equal(m.closingCents, 10000000);
});
test('future planned receipts never improve actual cash and overdue planned payments are retained in forecast', () => {
  const m = buildCashflow(accounts, [entry('p', { status: 'planned', kind: 'expense', category: 'rent', date: '2026-10-20', amountCents: 2000000 }), entry('q', { status: 'planned', date: '2026-11-20', amountCents: 300000 })], '2026-11', '', '2026-11-10');
  assert.equal(m.closingCents, 10000000); assert.equal(m.forecast[0].outCents, 2000000); assert.equal(m.forecast.at(-1)?.balanceCents, 8300000);
});
test('entry validation rejects fake dates, future actuals, zero and mismatched categories or accounts', () => {
  for (const extra of [{ date: '2026-02-30' }, { date: '2026-11-11' }, { amountCents: 0 }, { amountCents: 1.2 }, { accountId: 'missing' }, { kind: 'transfer' as const, category: 'transfer', targetAccountId: 'bank' }, { kind: 'expense' as const, category: 'repairs' }]) assert.throws(() => validateCashflowEntry(entry('x', extra), accounts, '2026-11-10'));
  assert.doesNotThrow(() => validateCashflowEntry(entry('x', { date: '2026-12-01', status: 'planned' }), accounts, '2026-11-10'));
});
test('closed repairs suggest unpaid balance and work descriptions without posting money or assuming materials', () => {
  const data = { clients: [{ id: 'c', name: 'Клиент', vehicles: [], repairs: [{ id: 'r', serviceType: 'ac' as const, closedByManager: true, closedAt: '2026-11-02', cost: '10000', tasks: [{ id: 't', description: 'Поиск утечки', status: 'done' as const, assignees: [], doneBy: [] }] }] }], freezers: [], finance: {} };
  const sources = cashflowSources(data, [entry('paid', { sourceKey: 'repair:c:r', amountCents: 300000 })], '2026-11', '2026-11-10');
  assert.equal(sources.length, 1); assert.equal(sources[0].remainingCents, 700000); assert.match(sources[0].comment, /Поиск утечки/);
  assert.equal(buildCashflow(accounts, [], '2026-11', '', '2026-11-10').incomeCents, 0);
});
test('rental and salaries are suggestions, zero costs and unfinished repairs do not become actual cash', () => {
  const sources = cashflowSources({ clients: [], freezers: [{ id: 'f', name: 'Камера', rented: true, rentAmount: 5000 }], finance: { salaries: [{ uid: 's', name: 'Мастер', salary: 2000 }], boxes: [{ id: 'b', name: 'Бокс', cost: 1000 }] } }, [], '2026-11', '2026-11-10');
  assert.deepEqual(sources.map(s => s.amountCents).sort((a, b) => a - b), [100000, 200000, 500000]);
});
test('report exports all period entries regardless of UI search and retains void and plan labels', () => {
  const m = buildCashflow(accounts, [entry('a'), entry('p', { status: 'planned' }), entry('v', { status: 'void', voidReason: 'Ошибка', voidedBy: 'owner' })], '2026-11', '', '2026-11-10');
  const rows = cashflowExportRows(m); assert.equal(rows.operations.length, 4); assert(rows.operations.some(row => row.includes('Аннулировано'))); assert(rows.summary.some(row => row.includes(m.closingCents / 100)));
});
test('posting an expected payment retains the original monthly budget even if it was paid later', () => {
  const e = entry('posted', { date: '2026-11-05', plannedDate: '2026-10-25' });
  const october = buildCashflow(accounts, [e], '2026-10', '', '2026-11-10'), november = buildCashflow(accounts, [e], '2026-11', '', '2026-11-10');
  assert.equal(october.plannedIncomeCents, e.amountCents); assert.equal(october.incomeCents, 0); assert.equal(november.incomeCents, e.amountCents); assert.equal(november.plannedIncomeCents, 0);
  assert.equal(cashflowExportRows(october).budget.length, 2);
});
test('unconfirmed totals display no made-up zero balances and negative cash is explicitly labelled', () => {
  const html = renderToStaticMarkup(createElement(CashflowSummary, { report: null }));
  assert.match(html, /—/); assert.doesNotMatch(html, /0,00/);
  const report = buildCashflow(accounts, [entry('big', { kind: 'expense', category: 'salary', amountCents: 11000000 })], '2026-11', '', '2026-11-10');
  assert.match(renderToStaticMarkup(createElement(CashflowSummary, { report })), /Отрицательный остаток/);
});
test('void history is visible, and actual payment has no action to post it twice', () => {
  const html = renderToStaticMarkup(createElement(CashflowJournal, { entries: [entry('v', { status: 'void', voidReason: 'Повторная запись', voidedBy: 'owner' }), entry('actual')], accounts, onPost() {}, onVoid() {} }));
  assert.match(html, /Аннулировано/); assert.match(html, /Повторная запись/); assert.doesNotMatch(html, /Провести оплату/);
});
test('cashflow access follows finance permissions with an owner override', () => {
  assert.equal(cashflowAccess('mechanic', true), false); assert.equal(cashflowAccess('admin', false), false); assert.equal(cashflowAccess('manager', false), false); assert.equal(cashflowAccess(undefined, true), false); assert.equal(cashflowAccess('manager'), true); assert.equal(cashflowAccess('owner', false), true);
});
