import { collection, doc, getDocFromServer, onSnapshot, serverTimestamp, type Firestore } from 'firebase/firestore';
import { getFirebaseDb } from './app';
import { canonicalEntityJson, ConcurrentMutationError, runSafeTransaction } from './concurrency';
import { cashflowToday, validateCashflowAccount, validateCashflowEntry, type CashflowAccount, type CashflowEntry } from '../../features/cashflow/cashflowLogic';

const payload = (entry: CashflowEntry) => {
  const { id: _, createdAt: _c, postedAt: _p, voidedAt: _v, ...data } = entry;
  return data;
};
export function listenCashflow(
  onAccounts: (accounts: CashflowAccount[]) => void,
  onEntries: (entries: CashflowEntry[]) => void,
  onError: (message: string, source: 'accounts' | 'entries') => void,
  db: Firestore = getFirebaseDb(),
): () => void {
  const fail = (source: 'accounts' | 'entries') => onError('Не удалось получить ДДС. Проверьте соединение и доступ к финансовому разделу.', source);
  const a = onSnapshot(collection(db, 'cashflowAccounts'), { includeMetadataChanges: true }, snap => {
    if (snap.metadata.fromCache || snap.metadata.hasPendingWrites) { onError('Ожидаем подтверждение счетов от сервера.', 'accounts'); return; }
    try {
      const accounts = snap.docs.map(d => ({ ...d.data(), id: d.id }) as CashflowAccount);
      accounts.forEach(validateCashflowAccount); onAccounts(accounts.sort((a, b) => a.name.localeCompare(b.name, 'ru')));
    } catch { onError('В счетах ДДС есть некорректные данные. Итоги временно недоступны.', 'accounts'); }
  }, () => fail('accounts'));
  const b = onSnapshot(collection(db, 'cashflowEntries'), { includeMetadataChanges: true }, snap => {
    if (snap.metadata.fromCache || snap.metadata.hasPendingWrites) { onError('Ожидаем подтверждение денежных операций от сервера.', 'entries'); return; }
    const entries = snap.docs.map(d => ({ ...d.data(), id: d.id }) as CashflowEntry);
    onEntries(entries);
  }, () => fail('entries'));
  return () => { a(); b(); };
}

/** Stable IDs make a retry after an uncertain network response idempotent. */
export async function createCashflowAccount(account: CashflowAccount, db = getFirebaseDb()): Promise<void> {
  validateCashflowAccount(account);
  const { id, ...data } = account, ref = doc(db, 'cashflowAccounts', id);
  await runSafeTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (snap.exists()) {
      const { createdAt: _, ...old } = snap.data();
      if (canonicalEntityJson(old) !== canonicalEntityJson(data)) throw new ConcurrentMutationError('Этот счёт уже сохранён с другими данными.');
      return;
    }
    tx.set(ref, { ...data, createdAt: serverTimestamp() });
  });
}
export async function createCashflowEntry(entry: CashflowEntry, db = getFirebaseDb()): Promise<void> {
  if (entry.status === 'void' || entry.voidedBy || entry.postedBy || entry.plannedDate) throw new Error('Новая операция должна быть фактом или планом.');
  const ref = doc(db, 'cashflowEntries', entry.id);
  await runSafeTransaction(db, async tx => {
    const existing = await tx.get(ref);
    if (existing.exists()) {
      if (canonicalEntityJson(payload({ ...existing.data(), id: entry.id } as CashflowEntry)) !== canonicalEntityJson(payload(entry))) throw new ConcurrentMutationError('Операция уже сохранена с другими значениями. Проверьте журнал.');
      return;
    }
    const accountSnap = await tx.get(doc(db, 'cashflowAccounts', entry.accountId));
    const accounts: CashflowAccount[] = accountSnap.exists() ? [{ ...accountSnap.data(), id: accountSnap.id } as CashflowAccount] : [];
    if (entry.kind === 'transfer' && entry.targetAccountId) {
      const target = await tx.get(doc(db, 'cashflowAccounts', entry.targetAccountId));
      if (target.exists()) accounts.push({ ...target.data(), id: target.id } as CashflowAccount);
    }
    validateCashflowEntry(entry, accounts);
    tx.set(ref, { ...payload(entry), createdAt: serverTimestamp() });
  });
}
export async function postCashflowPlan(expected: CashflowEntry, date: string, uid: string, db = getFirebaseDb()): Promise<void> {
  const ref = doc(db, 'cashflowEntries', expected.id);
  const alreadyPosted = (current: CashflowEntry) => current.status === 'actual' && current.plannedDate === expected.date && current.date === date && current.postedBy === uid
    && canonicalEntityJson(payload({ ...current, status: 'planned', date: expected.date, plannedDate: undefined, postedBy: undefined })) === canonicalEntityJson(payload(expected));
  try { await runSafeTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Платёж не найден.');
    const current = { ...snap.data(), id: snap.id } as CashflowEntry;
    if (alreadyPosted(current)) return;
    if (current.status !== 'planned' || canonicalEntityJson(payload(current)) !== canonicalEntityJson(payload(expected))) throw new ConcurrentMutationError('Плановый платёж уже изменён. Обновите журнал.');
    const from = await tx.get(doc(db, 'cashflowAccounts', current.accountId));
    const accounts = from.exists() ? [{ ...from.data(), id: from.id } as CashflowAccount] : [];
    if (current.kind === 'transfer') {
      const to = await tx.get(doc(db, 'cashflowAccounts', current.targetAccountId));
      if (to.exists()) accounts.push({ ...to.data(), id: to.id } as CashflowAccount);
    }
    validateCashflowEntry({ ...current, date, status: 'actual' }, accounts, cashflowToday());
    tx.update(ref, { status: 'actual', date, plannedDate: expected.date, postedBy: uid, postedAt: serverTimestamp() });
  }); } catch (error) {
    // A competing identical commit can make the write fail its planned→actual rule
    // before the SDK retries. Accept only an exact, server-confirmed completed operation.
    try { const snap = await getDocFromServer(ref); if (snap.exists() && alreadyPosted({ ...snap.data(), id: snap.id } as CashflowEntry)) return; } catch { /* Preserve the original failure if access/connection is lost. */ }
    throw error;
  }
}
export async function voidCashflowEntry(expected: CashflowEntry, reason: string, uid: string, db = getFirebaseDb()): Promise<void> {
  if (!reason.trim() || reason.trim().length > 500) throw new Error('Укажите причину аннулирования, до 500 символов.');
  const ref = doc(db, 'cashflowEntries', expected.id);
  await runSafeTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Операция не найдена.');
    const current = { ...snap.data(), id: snap.id } as CashflowEntry;
    if (current.status === 'void' && current.voidReason === reason.trim() && current.voidedBy === uid) return;
    if (current.status === 'void' || canonicalEntityJson(payload(current)) !== canonicalEntityJson(payload(expected))) throw new ConcurrentMutationError('Операция уже изменена. Обновите журнал.');
    tx.update(ref, { status: 'void', voidReason: reason.trim(), voidedBy: uid, voidedAt: serverTimestamp() });
  });
}
