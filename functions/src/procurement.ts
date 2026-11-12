import { getFirestore, FieldValue, type DocumentData, type Transaction } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { createHash } from 'node:crypto';
import { canManageProcurement, materialIdForCatalog, procurementId, validateCatalogItem, validateOrder } from './procurementLogic';
import { runCatalogAction } from './procurementCatalog';

const stamp = () => FieldValue.serverTimestamp();

export async function runProcurementAction(tx: Transaction, action: string, data: DocumentData, uid: string): Promise<DocumentData> {
  if (['initializeGroups', 'saveGroup', 'deleteGroup', 'updateCatalog'].includes(action)) return runCatalogAction(tx, action, data, uid);
  const db = getFirestore();
  if (action === 'importCatalog') {
    if (!Array.isArray(data.items) || !data.items.length || data.items.length > 25) throw new HttpsError('invalid-argument', 'Загружайте от 1 до 25 позиций за запрос');
    const items = data.items.map(validateCatalogItem);
    if (new Set(items.map(item => item.id)).size !== items.length) throw new HttpsError('invalid-argument', 'Повторяющиеся ID в файле');
    const refs = items.map(item => db.collection('procurementCatalog').doc(item.id));
    const old = await tx.getAll(...refs);
    let imported = 0;
    items.forEach((item, index) => {
      // An import never replaces a manually reviewed item or its stock linkage.
      if (old[index].exists) return;
      tx.create(refs[index], { ...item, revision: 1, createdBy: uid, createdAt: stamp() }); imported++;
    });
    return { imported, skipped: items.length - imported };
  }
  if (action === 'saveOrder') {
    const order = validateOrder(data.order), orderRef = db.collection('procurementOrders').doc(order.id);
    const old = (await tx.get(orderRef)).data();
    if ((old?.revision ?? 0) !== data.expectedRevision) throw new HttpsError('aborted', 'Заказ изменён другим сотрудником. Откройте сохранённую версию.');
    const catalog = await tx.getAll(...order.lines.map(line => db.collection('procurementCatalog').doc(line.catalogId)));
    order.lines.forEach((line, index) => {
      const item = catalog[index].data();
      if (item?.archived && !old?.lines?.some((previous: { catalogId: string }) => previous.catalogId === line.catalogId)) throw new HttpsError('failed-precondition', 'Товар в корзине. Сначала восстановите его.');
      if (!item || !item.suppliers?.some((supplier: { url: string }) => supplier.url === line.supplierUrl)) throw new HttpsError('failed-precondition', 'Товар или ссылка поставщика отсутствует в каталоге');
    });
    const revision = (old?.revision ?? 0) + 1;
    tx.set(orderRef, { ...order, revision, updatedBy: uid, updatedAt: stamp(), createdBy: old?.createdBy ?? uid, createdAt: old?.createdAt ?? stamp() });
    return { id: order.id, revision };
  }
  if (action === 'linkMaterial') {
    const catalogId = procurementId(data.catalogId), catalogRef = db.collection('procurementCatalog').doc(catalogId);
    const catalog = (await tx.get(catalogRef)).data();
    if (!catalog) throw new HttpsError('not-found', 'Товар не найден');
    if (catalog.archived) throw new HttpsError('failed-precondition', 'Товар в корзине. Сначала восстановите его.');
    if (catalog.linkedMaterialId) {
      const linked = await tx.get(db.collection('materialItems').doc(catalog.linkedMaterialId));
      if (!linked.exists) throw new HttpsError('failed-precondition', 'Связанная позиция склада удалена. Требуется проверка.');
      if (data.materialId && data.materialId !== catalog.linkedMaterialId) throw new HttpsError('failed-precondition', 'Товар уже связан с другой позицией склада');
      return { id: catalog.linkedMaterialId, existing: true };
    }
    if (catalog.revision !== data.expectedCatalogRevision) throw new HttpsError('aborted', 'Карточка каталога изменилась. Откройте её заново.');
    if (catalog.needsReview && data.reviewed !== true) throw new HttpsError('failed-precondition', 'Сначала проверьте модификацию товара');
    const materialId = data.materialId ? procurementId(data.materialId) : materialIdForCatalog(catalogId);
    const materialRef = db.collection('materialItems').doc(materialId), material = (await tx.get(materialRef)).data();
    if (data.materialId) {
      if (!material) throw new HttpsError('not-found', 'Позиция склада не найдена');
      if (material.revision !== data.expectedMaterialRevision) throw new HttpsError('aborted', 'Позиция склада изменилась. Откройте форму заново.');
      const catalogIds = [...new Set([...(material.procurementCatalogIds ?? []), catalogId])];
      if (catalogIds.length > 100) throw new HttpsError('failed-precondition', 'Слишком много связей у позиции склада');
      tx.update(materialRef, { procurementCatalogIds: catalogIds, revision: material.revision + 1, updatedBy: uid, updatedAt: stamp() });
    } else {
      if (material) throw new HttpsError('already-exists', 'Позиция склада уже существует. Выберите связь с существующей позицией.');
      const name = typeof data.name === 'string' ? data.name.trim() : '';
      if (!name || name.length > 160 || !['pcs', 'kg', 'ml', 'm'].includes(data.unit) || !Number.isSafeInteger(data.minimumMilli) || data.minimumMilli < 0 || data.minimumMilli > 1e12 || (data.unit === 'pcs' && data.minimumMilli % 1000 !== 0)) throw new HttpsError('invalid-argument', 'Укажите название, единицу и корректный минимальный остаток');
      tx.create(materialRef, { name, unit: data.unit, minimumMilli: data.minimumMilli, quantityMilli: 0, stockConfirmed: false, active: true, revision: 1, procurementCatalogIds: [catalogId], updatedBy: uid, updatedAt: stamp() });
      tx.create(db.collection('materialValuations').doc(materialId), { valueCents: null });
    }
    tx.update(catalogRef, { linkedMaterialId: materialId, revision: catalog.revision + 1, ...(data.reviewed === true ? { needsReview: false, reviewedBy: uid, reviewedAt: stamp() } : {}), updatedBy: uid, updatedAt: stamp() });
    return { id: materialId, existing: !!data.materialId };
  }
  throw new HttpsError('invalid-argument', 'Неизвестное действие закупа');
}

export const manageProcurement = onCall({ region: 'europe-west1', timeoutSeconds: 120 }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Войдите в CRM');
  const uid = request.auth.uid, db = getFirestore();
  const staff = (await db.collection('staff').doc(uid).get()).data();
  if (!canManageProcurement(staff?.role, staff?.permissions?.pl_panel, request.auth.token.role === 'owner')) throw new HttpsError('permission-denied', 'Закуп доступен менеджеру с финансовым доступом');
  try {
    const { action, requestId, ...payload } = request.data ?? {};
    procurementId(requestId);
    if (typeof action !== 'string') throw new Error('Не указано действие');
    const digest = createHash('sha256').update(JSON.stringify({ action, payload })).digest('hex');
    const scope = createHash('sha256').update(uid).digest('hex').slice(0, 32);
    const requestRef = db.collection('procurementRequests').doc(scope + '_' + requestId);
    return await db.runTransaction(async tx => {
      const old = (await tx.get(requestRef)).data();
      if (old) {
        if (old.digest !== digest) throw new HttpsError('already-exists', 'Повторный запрос содержит другие данные');
        return old.result;
      }
      const result = await runProcurementAction(tx, action, payload, uid);
      tx.create(requestRef, { uid, digest, action, result, createdAt: stamp() });
      return result;
    });
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('invalid-argument', error instanceof Error ? error.message : 'Некорректные данные закупа');
  }
});
