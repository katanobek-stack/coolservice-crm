// Isolated interactive visual fixture. No Firebase credentials or production writes.
import { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { CashflowTab } from '../../src/features/cashflow/CashflowTab';
import { cashflowToday, type CashflowAccount, type CashflowEntry } from '../../src/features/cashflow/cashflowLogic';

const today = cashflowToday(), month = today.slice(0, 7);
const accounts: CashflowAccount[] = [{ id: 'bank', name: 'Расчётный счёт', openedOn: `${month}-01`, openingCents: 10000000, createdBy: 'demo' }, { id: 'cash', name: 'Касса', openedOn: `${month}-01`, openingCents: 2000000, createdBy: 'demo' }];
let entries: CashflowEntry[] = [{ id: 'demo-in', kind: 'income', status: 'actual', date: today, accountId: 'bank', targetAccountId: '', category: 'repairs', amountCents: 1000000, counterparty: 'ДальТранс', comment: 'Диагностика и ремонт рефрижератора', sourceKey: '', sourceType: 'manual', createdBy: 'demo' }, { id: 'demo-out', kind: 'expense', status: 'actual', date: today, accountId: 'bank', targetAccountId: '', category: 'rent', amountCents: 2500000, counterparty: 'Аренда бокса', comment: 'Арендная плата за текущий месяц', sourceKey: '', sourceType: 'manual', createdBy: 'demo' }];
let snapshot = { accounts, entries, ready: true, error: '', retry() {} }; const listeners = new Set<() => void>();
function notify() { snapshot = { ...snapshot, accounts: [...accounts], entries: [...entries] }; listeners.forEach(fn => fn()); }
export function useCashflow() { return useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => snapshot); }
export function useAuth() { return { user: { uid: 'demo' }, myProfile: { id: 'demo', name: 'Владелец', role: 'owner' }, isOwner: true }; }
export function useData() {
  return { clients: [{ id: 'c', name: 'Холод Логистик', vehicles: [{ id: 'v', plate: 'А123АА125' }], repairs: [{ id: 'r', serviceType: 'refrigerator', vehicleId: 'v', closedByManager: true, closedAt: today, cost: '15000', tasks: [{ id: 't', description: 'Поиск утечки и заправка', assignees: [], doneBy: [], status: 'done' }] }] }], freezers: [{ id: 'f', name: 'Камера 20 м³', rented: true, tenant: 'Продукты ДВ', rentAmount: 20000 }], finance: { salaries: [{ uid: 's', name: 'Мастер', salary: 50000 }], boxes: [{ id: 'b', name: 'Аренда бокса', cost: 25000 }] }, sourceStatus: { clients: 'ready', freezers: 'ready', finance: 'ready' } };
}
export async function createCashflowAccount(account: CashflowAccount) { if (!accounts.some(a => a.id === account.id)) accounts.push(account); notify(); }
export async function createCashflowEntry(entry: CashflowEntry) { if (!entries.some(e => e.id === entry.id)) entries.push(entry); notify(); }
export async function postCashflowPlan(entry: CashflowEntry, date: string) { entries = entries.map(e => e.id === entry.id ? { ...e, status: 'actual', date, plannedDate: e.date } : e); notify(); }
export async function voidCashflowEntry(entry: CashflowEntry, reason: string) { entries = entries.map(e => e.id === entry.id ? { ...e, status: 'void', voidReason: reason, voidedBy: 'demo' } : e); notify(); }
createRoot(document.getElementById('root')!).render(<CashflowTab />);
