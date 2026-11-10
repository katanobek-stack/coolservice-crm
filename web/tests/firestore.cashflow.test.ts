import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDocs, collection, setDoc, updateDoc, deleteDoc, serverTimestamp, getDoc, type Firestore } from 'firebase/firestore';
import { createCashflowAccount, createCashflowEntry, postCashflowPlan, voidCashflowEntry } from '../src/shared/firebase/cashflow';
import type { CashflowAccount, CashflowEntry } from '../src/features/cashflow/cashflowLogic';

let env: RulesTestEnvironment;
const a: CashflowAccount = { id: 'bank', name: 'Банк', openedOn: '2020-01-01', openingCents: 100000, createdBy: 'manager' };
const payment = (id: string, extra: Partial<CashflowEntry> = {}): CashflowEntry => ({ id, date: '2020-02-01', kind: 'income', status: 'actual', accountId: 'bank', targetAccountId: '', category: 'repairs', amountCents: 10000, counterparty: 'Клиент', comment: 'Оплата ремонта', sourceType: 'manual', sourceKey: '', createdBy: 'manager', ...extra });
const db = (uid: string) => env.authenticatedContext(uid).firestore() as unknown as Firestore;
before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-cashflow', firestore: { rules: await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8') } }); });
after(async () => { if (env) await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    for (const [uid, role, permissions] of [['owner', 'owner', {}], ['manager', 'manager', {}], ['mechanic', 'mechanic', {}], ['denied', 'admin', { pl_panel: false }]] as const) await setDoc(doc(ctx.firestore(), 'staff', uid), { name: uid, role, permissions });
  });
  await createCashflowAccount(a, db('manager'));
});
test('cashflow data is unreadable and unwritable to mechanics, unapproved admins and anonymous users', async () => {
  for (const uid of ['mechanic', 'denied']) {
    await assertFails(getDocs(collection(db(uid), 'cashflowAccounts'))); await assertFails(getDocs(collection(db(uid), 'cashflowEntries')));
    await assertFails(createCashflowEntry(payment(uid, { createdBy: uid }), db(uid)));
  }
  await assertFails(getDocs(collection(env.unauthenticatedContext().firestore(), 'cashflowAccounts')));
  await assertSucceeds(getDocs(collection(db('owner'), 'cashflowAccounts')));
});
test('create and retry are idempotent; changed retries cannot overwrite an actual payment', async () => {
  const manager = db('manager'), e = payment('one');
  await createCashflowEntry(e, manager); await createCashflowEntry(e, manager);
  assert.equal((await getDocs(collection(manager, 'cashflowEntries'))).size, 1);
  await assert.rejects(createCashflowEntry({ ...e, amountCents: 20000 }, manager));
  await assertFails(updateDoc(doc(manager, 'cashflowEntries', e.id), { amountCents: 20000 }));
  await assertFails(deleteDoc(doc(manager, 'cashflowEntries', e.id)));
});
test('posting a plan preserves a single document, expected date and amount; concurrent post is harmless', async () => {
  const manager = db('manager'), e = payment('plan', { status: 'planned', date: '2020-02-01' });
  await createCashflowEntry(e, manager);
  await Promise.all([postCashflowPlan(e, '2020-02-02', 'manager', manager), postCashflowPlan(e, '2020-02-02', 'manager', manager)]);
  const saved = (await getDoc(doc(manager, 'cashflowEntries', e.id))).data();
  assert.equal(saved?.status, 'actual'); assert.equal(saved?.plannedDate, '2020-02-01'); assert.equal(saved?.amountCents, 10000);
  assert.equal((await getDocs(collection(manager, 'cashflowEntries'))).size, 1);
});
test('void retains immutable audit history and needs a reason and the true actor', async () => {
  const manager = db('manager'), e = payment('void'); await createCashflowEntry(e, manager);
  await assert.rejects(voidCashflowEntry(e, '', 'manager', manager));
  await assertFails(voidCashflowEntry(e, 'Ошибка', 'owner', manager));
  await voidCashflowEntry(e, 'Повторная запись', 'manager', manager); await voidCashflowEntry(e, 'Повторная запись', 'manager', manager);
  const saved = (await getDoc(doc(manager, 'cashflowEntries', e.id))).data(); assert.equal(saved?.status, 'void'); assert.equal(saved?.amountCents, 10000);
  await assertFails(updateDoc(doc(manager, 'cashflowEntries', e.id), { status: 'actual' }));
});
test('server rejects forged direct writes with invalid money, categories, dates, account or actor', async () => {
  const manager = db('manager'), { id: _, ...base } = payment('raw');
  for (const extra of [{ amountCents: 1.5 }, { amountCents: -1 }, { amountCents: 0 }, { kind: 'expense' }, { accountId: 'unknown' }, { createdBy: 'owner' }, { date: '2020-02-30' }, { date: '2099-12-01' }, { kind: 'transfer', category: 'transfer', targetAccountId: 'bank' }]) {
    await assertFails(setDoc(doc(manager, 'cashflowEntries', 'bad'), { ...base, ...extra, createdAt: serverTimestamp() }));
  }
  await assertFails(updateDoc(doc(manager, 'cashflowAccounts', 'bank'), { openingCents: 0 }));
});
test('transfer is stored atomically and requires both real accounts', async () => {
  const manager = db('manager'); await createCashflowAccount({ ...a, id: 'cash', name: 'Касса', openingCents: 0 }, manager);
  await createCashflowEntry(payment('transfer', { kind: 'transfer', category: 'transfer', targetAccountId: 'cash' }), manager);
  assert.equal((await getDocs(collection(manager, 'cashflowEntries'))).size, 1);
});
