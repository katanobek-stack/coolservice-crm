import { doc, serverTimestamp, type Firestore } from 'firebase/firestore';
import { getFirebaseDb } from './app';
import { runSafeTransaction, canonicalEntityJson, ConcurrentMutationError, removeEntityIfUnchanged } from './concurrency';
import { parsePnlAmount, validPnlMonth, type PnlPurchase } from '../../features/pnl/pnlLogic';
function validate(month: string, amount: number, positive = false) { if (!validPnlMonth(month) || parsePnlAmount(String(amount), positive) === null)
    throw new Error('Проверьте период и сумму.'); }
export async function savePnlElectricity(month: string, amount: number, expected: unknown, db: Firestore = getFirebaseDb()): Promise<void> { validate(month, amount); const ref = doc(db, 'settings/finance'); await runSafeTransaction(db, async (tx) => { const snap = await tx.get(ref); const bills = (snap.data()?.elecBills ?? {}) as Record<string, unknown>; if (canonicalEntityJson(bills[month]) !== canonicalEntityJson(expected))
    throw new ConcurrentMutationError('Счёт за электричество уже изменён другим сотрудником. Сверьте актуальную сумму.'); tx.set(ref, { elecBills: { ...bills, [month]: amount } }, { merge: true }); }); }
export interface PnlCommissionInput {
    id: string;
    category: 'commission' | string;
    month: string;
    amount: number;
    comment: string;
    createdBy: string;
}
export async function addPnlCommission(entry: PnlCommissionInput, db: Firestore = getFirebaseDb()): Promise<void> { validate(entry.month, entry.amount, true); if (!entry.id || entry.id.includes('/') || entry.category !== 'commission')
    throw new Error('Некорректная операция.'); const { id, ...payload } = entry; const ref = doc(db, 'expenses', id); await runSafeTransaction(db, async (tx) => { const snap = await tx.get(ref); if (snap.exists()) {
    const { createdAt: _, ...old } = snap.data();
    if (canonicalEntityJson(old) !== canonicalEntityJson(payload))
        throw new ConcurrentMutationError('Операция с этим номером уже существует с другими данными.');
    return;
} tx.set(ref, { ...payload, createdAt: serverTimestamp() }); }); }
export async function removePnlPurchase(expected: PnlPurchase, db: Firestore = getFirebaseDb()): Promise<void> { const ref = doc(db, 'settings/finance'); await runSafeTransaction(db, async (tx) => { const snap = await tx.get(ref); const purchases = (snap.data()?.purchases ?? []) as PnlPurchase[]; const next = removeEntityIfUnchanged(purchases, expected, 'Закупка'); tx.set(ref, { purchases: next }, { merge: true }); }); }
/** A retry with an already-committed ID must agree with the stored operation. */
export async function addPnlPurchase(purchase:PnlPurchase,db:Firestore=getFirebaseDb()):Promise<void>{validate(purchase.date?.slice(0,7),purchase.amount,true);if(!purchase.id||!purchase.comment.trim())throw new Error('Укажите описание закупки.');const ref=doc(db,'settings/finance');await runSafeTransaction(db,async tx=>{const snap=await tx.get(ref);const purchases=(snap.data()?.purchases??[]) as PnlPurchase[];const old=purchases.find(p=>p.id===purchase.id);if(old){if(canonicalEntityJson(old)!==canonicalEntityJson(purchase))throw new ConcurrentMutationError('Закупка уже сохранена с другими значениями. Сверьте журнал перед новой операцией.');return;}tx.set(ref,{purchases:[...purchases,purchase]},{merge:true});});}
