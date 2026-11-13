import { getFirestore, FieldValue, type DocumentData, type Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { procurementId } from './procurementLogic';

const defaults = [['electrics', 'Электрика'], ['fittings', 'Фитинги'], ['tools', 'Инструменты'], ['refrigeration', 'Рефустановки'], ['electronics', 'Электроника'], ['personal', 'Личные']];
const text = (value: unknown, max: number) => { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new HttpsError('invalid-argument', 'Проверьте название'); return value.trim(); };
const revision = (value: unknown) => { if (!Number.isSafeInteger(value) || (value as number) < 0) throw new HttpsError('invalid-argument', 'Некорректная версия'); return value as number; };

export async function runCatalogAction(tx: Transaction, action: string, data: DocumentData, uid: string): Promise<DocumentData> {
  const db = getFirestore(), audit = { updatedBy: uid, updatedAt: FieldValue.serverTimestamp() };
  if (action === 'initializeGroups') {
    const marker = db.doc('procurementSettings/groups'), refs = defaults.map(([id]) => db.doc('procurementGroups/' + id));
    const snapshots = await tx.getAll(marker, ...refs);
    if (snapshots[0].exists) return { initialized: false };
    defaults.forEach(([id, name], index) => { if (!snapshots[index + 1].exists) tx.create(refs[index], { name, active: true, revision: 1, position: index, ...audit }); });
    tx.create(marker, { initialized: true, ...audit });
    return { initialized: true };
  }
  if (action === 'saveGroup' || action === 'deleteGroup') {
    const id = procurementId(data.id);
    if (['all', 'ungrouped', 'trash', 'ungrouped-choice'].includes(id)) throw new HttpsError('invalid-argument', 'Некорректный идентификатор группы');
    const ref = db.doc('procurementGroups/' + id), old = (await tx.get(ref)).data();
    if ((old?.revision ?? 0) !== revision(data.expectedRevision)) throw new HttpsError('aborted', 'Группа изменена. Откройте её заново.');
    if (action === 'deleteGroup') {
      if (!old?.active) throw new HttpsError('failed-precondition', 'Группа уже удалена');
      // Keep the tombstone: cards referencing it appear in Ungrouped without
      // rewriting thousands of documents or racing with a concurrent move.
      tx.update(ref, { active: false, revision: old.revision + 1, ...audit });
    } else {
      if (old?.active === false) throw new HttpsError('failed-precondition', 'Группа удалена');
      tx.set(ref, { ...old, name: text(data.name, 80), active: true, revision: (old?.revision ?? 0) + 1, position: old?.position ?? 100, ...audit });
    }
    return { id };
  }
  if (action !== 'updateCatalog' || !['move', 'rename', 'trash', 'restore'].includes(data.operation)) throw new HttpsError('invalid-argument', 'Неизвестное действие каталога');
  if (!Array.isArray(data.items) || !data.items.length || data.items.length > 100) throw new HttpsError('invalid-argument', 'Выберите от 1 до 100 товаров');
  const items = data.items.map((item: DocumentData) => ({ id: procurementId(item?.id), revision: revision(item?.revision) }));
  if (new Set(items.map(item => item.id)).size !== items.length) throw new HttpsError('invalid-argument', 'Товар выбран дважды');
  const patch: DocumentData = {};
  if (data.operation === 'move') {
    patch.groupId = data.groupId === '' ? '' : procurementId(data.groupId);
    if (patch.groupId && !(await tx.get(db.doc('procurementGroups/' + patch.groupId))).data()?.active) throw new HttpsError('failed-precondition', 'Группа удалена. Выберите другую.');
  } else if (data.operation === 'rename') {
    if (items.length !== 1 || typeof data.variant !== 'string' || data.variant.trim().length > 1000) throw new HttpsError('invalid-argument', 'Проверьте модификацию');
    patch.name = text(data.name, 160); patch.variant = data.variant.trim();
  } else patch.archived = data.operation === 'trash';
  const refs = items.map(item => db.doc('procurementCatalog/' + item.id)), snapshots = await tx.getAll(...refs);
  snapshots.forEach((snapshot, index) => {
    const old = snapshot.data();
    if (!old) throw new HttpsError('not-found', 'Товар не найден');
    if (old.mergedIntoId) throw new HttpsError('failed-precondition', 'Товар объединён. Используйте итоговую карточку.');
    if (old.revision !== items[index].revision) throw new HttpsError('aborted', 'Один из товаров изменён. Выберите товары заново.');
    if (old.archived && ['move', 'rename'].includes(data.operation)) throw new HttpsError('failed-precondition', 'Сначала восстановите товар из корзины');
  });
  refs.forEach((ref, index) => tx.update(ref, { ...patch, revision: items[index].revision + 1, ...audit }));
  return { updated: items.length };
}
