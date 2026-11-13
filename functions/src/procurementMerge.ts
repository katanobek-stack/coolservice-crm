import { getFirestore, FieldValue, type DocumentData, type Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { procurementId } from './procurementLogic';

const fail = (message: string): never => { throw new HttpsError('failed-precondition', message); };
const text = (value: unknown, max: number, required = false) => { if (typeof value !== 'string' || value.trim().length > max || required && !value.trim()) throw new HttpsError('invalid-argument', 'Проверьте название и модификацию'); return value.trim(); };
const revision = (value: unknown): number => { if (!Number.isSafeInteger(value) || (value as number) < 1) throw new HttpsError('invalid-argument', 'Некорректная версия'); return value as number; };
export async function runMergeAction(tx: Transaction, action: string, data: DocumentData, uid: string): Promise<DocumentData> {
  const db = getFirestore(), audit = { updatedBy: uid, updatedAt: FieldValue.serverTimestamp() };
  if (action === 'setSupplierEnabled') {
    const ref = db.doc('procurementCatalog/' + procurementId(data.catalogId)), item = (await tx.get(ref)).data();
    if (!item || item.archived || item.mergedIntoId) return fail('Товар недоступен для изменения');
    if (item.revision !== revision(data.expectedRevision)) throw new HttpsError('aborted', 'Карточка изменилась. Откройте её заново.');
    if (typeof data.disabled !== 'boolean' || !item.suppliers.some((supplier: DocumentData) => supplier.url === data.url)) throw new HttpsError('invalid-argument', 'Ссылка не найдена');
    tx.update(ref, { suppliers: item.suppliers.map((supplier: DocumentData) => supplier.url === data.url ? { ...supplier, disabled: data.disabled } : supplier), revision: item.revision + 1, ...audit });
    return { id: ref.id };
  }
  const mergeId = procurementId(data.mergeId), primaryId = procurementId(data.primaryId), groupId = procurementId(data.groupId);
  if (!Array.isArray(data.items) || data.items.length < 2 || data.items.length > 20 || data.confirmed !== true) throw new HttpsError('invalid-argument', 'Выберите от 2 до 20 товаров и подтвердите одинаковую модификацию');
  const items = data.items.map((item: DocumentData) => ({ id: procurementId(item?.id), revision: revision(item?.revision) }));
  if (new Set(items.map(item => item.id)).size !== items.length || !items.some(item => item.id === primaryId)) throw new HttpsError('invalid-argument', 'Проверьте основную карточку и повторы');
  const name = text(data.name, 160, true), variant = text(data.variant, 1000);
  const groupRef = db.doc('procurementGroups/' + groupId), journalRef = db.doc('procurementMerges/' + mergeId);
  const [groupSnapshot, previousMerge] = await tx.getAll(groupRef, journalRef), group = groupSnapshot.data();
  if (previousMerge.exists) throw new HttpsError('already-exists', 'Это объединение уже выполнено. Обновите каталог.');
  if (!group?.active) return fail('Выберите существующую группу');
  if (group.revision !== revision(data.expectedGroupRevision)) throw new HttpsError('aborted', 'Группа изменилась. Откройте сравнение заново.');
  const refs = items.map(item => db.doc('procurementCatalog/' + item.id)), snapshots = await tx.getAll(...refs);
  const cards = snapshots.map((snapshot, index) => {
    const item = snapshot.data();
    if (!item || item.archived || item.mergedIntoId) return fail('Один из товаров уже убран или объединён. Обновите сравнение.');
    if (item.revision !== items[index].revision) throw new HttpsError('aborted', 'Один из товаров изменился. Откройте сравнение заново.');
    if (item.groupId !== groupId) return fail('Объединение разрешено только внутри одной группы');
    return { ...item, id: items[index].id } as DocumentData;
  });
  const primary = cards.find(item => item.id === primaryId)!, ordered = [primary, ...cards.filter(item => item.id !== primaryId)];
  const photoId = data.photoId === undefined ? primaryId : procurementId(data.photoId), photo = cards.find(item => item.id === photoId);
  if (!photo) throw new HttpsError('invalid-argument', 'Выберите фотографию из сравниваемых карточек');
  const materialIds = [...new Set(cards.map(item => item.linkedMaterialId).filter(Boolean))];
  if (materialIds.length > 1) return fail('У товаров разные складские позиции. Сначала требуется отдельная сверка склада; остатки не объединены.');
  const materialId = materialIds[0], materialRef = materialId ? db.doc('materialItems/' + procurementId(materialId)) : null;
  const material = materialRef ? (await tx.get(materialRef)).data() : undefined;
  if (materialId && !material) return fail('Связанная складская позиция удалена');
  if (material && material.revision !== revision(data.expectedMaterialRevision)) throw new HttpsError('aborted', 'Складская позиция изменилась. Откройте сравнение заново.');
  if (data.renameMaterial !== undefined && typeof data.renameMaterial !== 'boolean') throw new HttpsError('invalid-argument', 'Подтвердите изменение складского названия');
  const suppliers = [...new Map(ordered.flatMap(item => item.suppliers).map(supplier => [supplier.url, supplier])).values()];
  // Prefer the explicitly selected primary's quote; originals remain immutable in
  // absorbed cards and the primary snapshot, including conflicting old prices.
  const primaryQuotes = new Map(primary.suppliers.map((supplier: DocumentData) => [supplier.url, supplier]));
  suppliers.forEach((supplier, index) => { if (primaryQuotes.has(supplier.url)) suppliers[index] = primaryQuotes.get(supplier.url); });
  const sources = [...new Map(ordered.flatMap(item => item.sources).map(source => [JSON.stringify([source.file, source.row, source.year, source.quantity, source.priceFen, source.description]), source])).values()];
  const mergedCardIds = [...new Set(ordered.flatMap(item => [item.id, ...(item.mergedCardIds ?? [])]).filter(id => id !== primaryId))];
  if (suppliers.length > 20 || sources.length > 100 || mergedCardIds.length > 1000) return fail('Слишком много ссылок или записей истории для одной карточки. Объедините меньшую группу или уточните каталог; данные не изменены.');
  const merged = { name, variant, suppliers, sources, mergedCardIds, imageDataUrl: photo.imageDataUrl, groupId, needsReview: cards.some(item => item.needsReview), ...(materialId ? { linkedMaterialId: materialId } : {}), revision: primary.revision + 1, ...audit };
  const journal = { primaryId, absorbedIds: cards.filter(item => item.id !== primaryId).map(item => item.id), beforePrimary: primary, groupId, materialId: materialId ?? null, renamedMaterial: data.renameMaterial === true, ...audit };
  if (Buffer.byteLength(JSON.stringify({ ...primary, ...merged }), 'utf8') > 900000 || Buffer.byteLength(JSON.stringify(journal), 'utf8') > 900000) return fail('Карточка превышает допустимый размер. Объедините меньше товаров.');
  const catalogIds = material ? [...new Set([...(material.procurementCatalogIds ?? []), ...cards.map(item => item.id)])] : [];
  if (catalogIds.length > 100) return fail('Слишком много связей у складской позиции. Требуется отдельная сверка.');
  const renameStock = !!material && data.renameMaterial === true && material.name !== name;
  if (materialRef && material && (renameStock || catalogIds.length !== (material.procurementCatalogIds ?? []).length)) tx.update(materialRef, { ...(renameStock ? { name } : {}), procurementCatalogIds: catalogIds, revision: material.revision + 1, ...audit });
  tx.update(db.doc('procurementCatalog/' + primaryId), merged);
  cards.filter(item => item.id !== primaryId).forEach(item => tx.update(db.doc('procurementCatalog/' + item.id), { archived: true, mergedIntoId: primaryId, revision: item.revision + 1, ...audit }));
  tx.create(journalRef, journal);
  return { id: primaryId, merged: cards.length };
}
