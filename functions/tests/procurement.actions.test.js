const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
// Only document-reference construction uses Admin SDK. Every read/write goes through
// this in-memory transaction; this test never contacts a database.
admin.initializeApp({ projectId: 'demo-procurement-unit' });
const { runProcurementAction } = require('../lib/procurement');
const { materialIdForCatalog } = require('../lib/procurementLogic');
after(() => admin.app().delete());

const item = { id: 'source-1', name: 'Контактор', variant: 'NXC-25 220V', suppliers: [{ url: 'https://item.taobao.com/item.htm?id=123', site: 'Taobao', product: '123', priceFen: 1200 }], sources: [{ file: 'B2-52.xls', row: 10, year: '2026', quantity: '2', priceFen: 1200, description: 'NXC-25' }], imageDataUrl: '', needsReview: false, reviewNote: '' };
function transaction(store) {
  let written = false;
  const get = async ref => { assert.equal(written, false, 'Firestore transactions must perform all reads before writes'); const value = store.get(ref.path); return { exists: value !== undefined, data: () => value }; };
  return { get, getAll: async (...refs) => Promise.all(refs.map(get)), create(ref, value) { written = true; assert.equal(store.has(ref.path), false); store.set(ref.path, value); }, set(ref, value) { written = true; store.set(ref.path, value); }, update(ref, value) { written = true; assert.equal(store.has(ref.path), true); store.set(ref.path, { ...store.get(ref.path), ...value }); } };
}
const call = (store, action, payload) => runProcurementAction(transaction(store), action, payload, 'owner');

test('reimport preserves manual review and stock linkage; does not create material stock', async () => {
  const store = new Map();
  assert.deepEqual(await call(store, 'importCatalog', { items: [item] }), { imported: 1, skipped: 0 });
  store.get('procurementCatalog/source-1').name = 'Проверенное название';
  assert.deepEqual(await call(store, 'importCatalog', { items: [item] }), { imported: 0, skipped: 1 });
  assert.equal(store.get('procurementCatalog/source-1').name, 'Проверенное название');
  assert.equal([...store.keys()].some(key => key.startsWith('materialItems/')), false);
});
test('creating stock requires review and a unit, starts uncounted and links only once', async () => {
  const store = new Map(); await call(store, 'importCatalog', { items: [{ ...item, needsReview: true }] });
  const payload = { catalogId: item.id, expectedCatalogRevision: 1, name: 'Контактор', unit: 'pcs', minimumMilli: 2000 };
  await assert.rejects(call(store, 'linkMaterial', payload), { code: 'failed-precondition' });
  const id = (await call(store, 'linkMaterial', { ...payload, reviewed: true })).id;
  assert.equal(id, materialIdForCatalog(item.id));
  const stock = store.get('materialItems/' + id);
  assert.equal(stock.quantityMilli, 0); assert.equal(stock.stockConfirmed, false);
  assert.deepEqual(stock.procurementCatalogIds, [item.id]);
  assert.equal(store.get('materialValuations/' + id).valueCents, null);
  assert.equal((await call(store, 'linkMaterial', { ...payload, reviewed: true })).id, id);
  assert.equal([...store.keys()].some(key => /cashflow|Movements|resourceCosts/.test(key)), false);
});
test('existing stock linkage preserves quantity and rejects a stale revision', async () => {
  const store = new Map(); await call(store, 'importCatalog', { items: [item] });
  store.set('materialItems/old', { revision: 3, quantityMilli: 15000, unit: 'pcs', active: true });
  const payload = { catalogId: item.id, expectedCatalogRevision: 1, materialId: 'old', expectedMaterialRevision: 2 };
  await assert.rejects(call(store, 'linkMaterial', payload), { code: 'aborted' });
  await call(store, 'linkMaterial', { ...payload, expectedMaterialRevision: 3 });
  assert.equal(store.get('materialItems/old').quantityMilli, 15000);
  assert.equal(store.get('materialItems/old').revision, 4);
});
test('order save validates catalogue supplier, checks revision, and never changes stock', async () => {
  const store = new Map(); await call(store, 'importCatalog', { items: [item] });
  const order = { id: 'order-1', name: 'Заказ', commission: '3', exchange: '13', freightRate: '480', lines: [{ catalogId: item.id, name: item.name, variant: item.variant, supplierUrl: item.suppliers[0].url, quantity: '2', unitPrice: '12', chinaDelivery: '0', receivedQuantity: '', weightKg: '' }] };
  assert.deepEqual(await call(store, 'saveOrder', { order, expectedRevision: 0 }), { id: order.id, revision: 1 });
  await assert.rejects(call(store, 'saveOrder', { order, expectedRevision: 0 }), { code: 'aborted' });
  await assert.rejects(call(store, 'saveOrder', { order: { ...order, lines: [{ ...order.lines[0], supplierUrl: 'https://item.taobao.com/item.htm?id=999' }] }, expectedRevision: 1 }), { code: 'failed-precondition' });
  assert.equal([...store.keys()].some(key => /materialItems|cashflow/.test(key)), false);
});
const batch = (id, revision) => [{ id, revision }];
test('groups initialize once, rename without changing membership, and deletion leaves cards recoverable', async () => {
  const store = new Map(); await call(store, 'initializeGroups', {});
  const groups = [...store.entries()].filter(([path]) => path.startsWith('procurementGroups/'));
  assert.equal(groups.length, 6); assert.equal(groups.some(([, g]) => g.name === 'Личные'), true);
  const [path, group] = groups[0], id = path.split('/')[1];
  await call(store, 'saveGroup', { id, name: 'Новая электрика', expectedRevision: group.revision });
  await call(store, 'importCatalog', { items: [item] });
  await call(store, 'updateCatalog', { operation: 'move', items: batch(item.id, 1), groupId: id });
  assert.equal(store.get('procurementCatalog/' + item.id).groupId, id);
  await call(store, 'deleteGroup', { id, expectedRevision: 2 });
  assert.equal(store.get(path).active, false);
  await call(store, 'initializeGroups', {});
  assert.equal(store.get(path).active, false);
  await assert.rejects(call(store, 'updateCatalog', { operation: 'move', items: batch(item.id, 2), groupId: id }), { code: 'failed-precondition' });
  assert.equal(store.get('procurementCatalog/' + item.id).revision, 2);
});
test('catalogue batches validate every revision before writing; rename, basket and restore preserve sources and links', async () => {
  const store = new Map(); await call(store, 'importCatalog', { items: [item, { ...item, id: 'source-2' }] });
  const ref = 'procurementCatalog/' + item.id;
  store.get(ref).linkedMaterialId = 'existing-stock';
  await assert.rejects(call(store, 'updateCatalog', { operation: 'trash', items: [...batch(item.id, 1), ...batch('source-2', 9)] }), { code: 'aborted' });
  assert.equal(store.get(ref).revision, 1);
  await call(store, 'updateCatalog', { operation: 'rename', items: batch(item.id, 1), name: 'Контактор 25 А', variant: '220V' });
  await call(store, 'updateCatalog', { operation: 'trash', items: batch(item.id, 2) });
  assert.equal(store.get(ref).archived, true);
  await call(store, 'importCatalog', { items: [item] });
  assert.equal(store.get(ref).archived, true);
  await call(store, 'updateCatalog', { operation: 'restore', items: batch(item.id, 3) });
  assert.equal(store.get(ref).archived, false); assert.equal(store.get(ref).name, 'Контактор 25 А');
  assert.deepEqual(store.get(ref).sources, item.sources); assert.equal(store.get(ref).linkedMaterialId, 'existing-stock');
  assert.equal([...store.keys()].some(key => /materialItems|cashflow/.test(key)), false);
  await assert.rejects(call(store, 'updateCatalog', { operation: 'move', items: [...batch(item.id, 4), ...batch(item.id, 4)], groupId: '' }));
});
test('basket blocks new orders and stock links, preserves edits of orders already containing that item', async () => {
  const store = new Map(); await call(store, 'importCatalog', { items: [item] });
  const order = { id: 'existing-order', name: 'Заказ', commission: '3', exchange: '', freightRate: '', lines: [{ catalogId: item.id, name: item.name, variant: item.variant, supplierUrl: item.suppliers[0].url, quantity: '1', unitPrice: '', chinaDelivery: '', receivedQuantity: '', weightKg: '' }] };
  await call(store, 'saveOrder', { order, expectedRevision: 0 });
  await call(store, 'updateCatalog', { operation: 'trash', items: batch(item.id, 1) });
  await assert.rejects(call(store, 'saveOrder', { order: { ...order, id: 'new-order' }, expectedRevision: 0 }), { code: 'failed-precondition' });
  await call(store, 'saveOrder', { order, expectedRevision: 1 });
  await assert.rejects(call(store, 'linkMaterial', { catalogId: item.id, expectedCatalogRevision: 2, name: 'Товар', unit: 'pcs', minimumMilli: 0 }), { code: 'failed-precondition' });
});

test('group and batch payload limits reject invalid requests without modifying catalogue', async () => {
  const store = new Map(); await call(store, 'importCatalog', { items: [item] });
  await assert.rejects(call(store, 'saveGroup', { id: 'all', name: 'Ошибка', expectedRevision: 0 }));
  await assert.rejects(call(store, 'saveGroup', { id: 'new', name: ' ', expectedRevision: 0 }));
  await assert.rejects(call(store, 'updateCatalog', { operation: 'trash', items: Array.from({length: 101}, (_, i) => ({ id: 'a-' + i, revision: 1 })) }));
  await assert.rejects(call(store, 'updateCatalog', { operation: 'rename', items: batch(item.id, 1), name: 'x'.repeat(161), variant: '' }));
  assert.equal(store.get('procurementCatalog/' + item.id).revision, 1);
});

test('merge is group-scoped, preserves seller links and history, keeps aliases and never changes stock amounts', async () => {
  const store = new Map(); await call(store, 'initializeGroups', {});
  await call(store, 'importCatalog', { items: [item, { ...item, id: 'other', suppliers: [{ ...item.suppliers[0], url: 'https://detail.1688.com/offer/456.html' }], sources: [{ ...item.sources[0], file: 'other.xls' }] }] });
  await call(store, 'updateCatalog', { operation: 'move', items: [...batch(item.id, 1), ...batch('other', 1)], groupId: 'electrics' });
  const payload = { mergeId: 'merge-1', primaryId: item.id, items: [...batch(item.id, 2), ...batch('other', 2)], groupId: 'electrics', expectedGroupRevision: 1, name: 'Контактор 25А 220В', variant: '220В', confirmed: true, photoId: item.id };
  const result = await call(store, 'mergeCatalog', payload);
  assert.equal(result.id, item.id); const target = store.get('procurementCatalog/' + item.id);
  assert.equal(target.suppliers.length, 2); assert.equal(target.sources.length, 2); assert.equal(target.groupId, 'electrics'); assert.equal(target.name, payload.name);
  const alias = store.get('procurementCatalog/other'); assert.equal(alias.mergedIntoId, item.id); assert.equal(alias.archived, true);
  assert.equal(store.has('procurementMerges/merge-1'), true);
  for (const operation of ['restore', 'rename', 'move']) await assert.rejects(call(store, 'updateCatalog', { operation, items: batch('other', 3), name: 'Новое', variant: '', groupId: 'tools' }), { code: 'failed-precondition' });
  await call(store, 'importCatalog', { items: [{ ...item, id: 'other' }] }); assert.equal(store.get('procurementCatalog/other').mergedIntoId, item.id);
  assert.equal([...store.keys()].some(key => /materialItems|cashflow|materialMovements/.test(key)), false);
});
test('merge rejects different groups, different stock links and stale revisions; stock rename requires opt-in', async () => {
  const store = new Map(); await call(store, 'initializeGroups', {}); await call(store, 'importCatalog', { items: [item, { ...item, id: 'other' }] });
  const a = store.get('procurementCatalog/' + item.id), b = store.get('procurementCatalog/other'); a.groupId = 'electrics'; b.groupId = 'tools';
  const payload = { mergeId: 'merge-2', primaryId: item.id, items: [...batch(item.id, 1), ...batch('other', 1)], groupId: 'electrics', expectedGroupRevision: 1, name: 'Новое имя', variant: '', confirmed: true };
  await assert.rejects(call(store, 'mergeCatalog', payload), { code: 'failed-precondition' }); b.groupId = 'electrics'; a.linkedMaterialId = 'stock-a'; b.linkedMaterialId = 'stock-b';
  await assert.rejects(call(store, 'mergeCatalog', payload), { code: 'failed-precondition' }); b.linkedMaterialId = 'stock-a';
  store.set('materialItems/stock-a', { name: 'Складское имя', unit: 'pcs', quantityMilli: 5000, minimumMilli: 1000, revision: 3, procurementCatalogIds: [item.id, 'other'] });
  store.set('materialValuations/stock-a', { valueCents: 12000 });
  await assert.rejects(call(store, 'mergeCatalog', { ...payload, expectedMaterialRevision: 2 }), { code: 'aborted' });
  await call(store, 'mergeCatalog', { ...payload, expectedMaterialRevision: 3, renameMaterial: true });
  assert.equal(store.get('materialItems/stock-a').name, 'Новое имя'); assert.equal(store.get('materialItems/stock-a').quantityMilli, 5000); assert.equal(store.get('materialValuations/stock-a').valueCents, 12000);
});
test('disabled suppliers prevent new purchases without invalidating saved orders', async () => {
  const store = new Map(); await call(store, 'importCatalog', { items: [item] });
  const order = { id: 'old-order', name: 'История', commission: '3', exchange: '', freightRate: '', lines: [{ catalogId: item.id, name: item.name, variant: item.variant, supplierUrl: item.suppliers[0].url, quantity: '1', unitPrice: '', chinaDelivery: '', receivedQuantity: '', weightKg: '' }] };
  await call(store, 'saveOrder', { order, expectedRevision: 0 });
  await call(store, 'setSupplierEnabled', { catalogId: item.id, expectedRevision: 1, url: item.suppliers[0].url, disabled: true });
  await assert.rejects(call(store, 'saveOrder', { order: { ...order, id: 'new-order' }, expectedRevision: 0 }), { code: 'failed-precondition' });
  await call(store, 'saveOrder', { order, expectedRevision: 1 });
});

test('merged aliases remain usable in historical orders but cannot enter a new order or stock link', async () => {
  const store = new Map(); await call(store, 'initializeGroups', {}); await call(store, 'importCatalog', { items: [item, { ...item, id: 'alias' }] });
  store.get('procurementCatalog/' + item.id).groupId = 'electrics'; store.get('procurementCatalog/alias').groupId = 'electrics';
  const order = { id: 'old-order', name: 'История', commission: '3', exchange: '', freightRate: '', lines: [{ catalogId: 'alias', name: 'Старое название', variant: '', supplierUrl: item.suppliers[0].url, quantity: '1', unitPrice: '', chinaDelivery: '', receivedQuantity: '', weightKg: '' }] };
  await call(store, 'saveOrder', { order, expectedRevision: 0 });
  await call(store, 'mergeCatalog', { mergeId: 'merge-old-order', primaryId: item.id, items: [...batch(item.id, 1), ...batch('alias', 1)], groupId: 'electrics', expectedGroupRevision: 1, name: 'Итоговое название', variant: '', confirmed: true });
  await call(store, 'saveOrder', { order, expectedRevision: 1 });
  assert.equal(store.get('procurementOrders/old-order').lines[0].name, 'Старое название');
  await assert.rejects(call(store, 'saveOrder', { order: { ...order, id: 'new-order' }, expectedRevision: 0 }), { code: 'failed-precondition' });
  await assert.rejects(call(store, 'linkMaterial', { catalogId: 'alias', expectedCatalogRevision: 2, name: 'Товар', unit: 'pcs', minimumMilli: 0 }), { code: 'failed-precondition' });
});
test('merging linked cards without rename opt-in keeps stock name and value', async () => {
  const store = new Map(); await call(store, 'initializeGroups', {}); await call(store, 'importCatalog', { items: [item, { ...item, id: 'b' }] });
  for (const id of [item.id, 'b']) { const card = store.get('procurementCatalog/' + id); card.groupId = 'electrics'; card.linkedMaterialId = 'stock'; }
  store.set('materialItems/stock', { name: 'Складское имя', revision: 2, quantityMilli: 1000, procurementCatalogIds: [item.id, 'b'] }); store.set('materialValuations/stock', { valueCents: 5000 });
  await call(store, 'mergeCatalog', { mergeId: 'no-rename', primaryId: item.id, items: [...batch(item.id, 1), ...batch('b', 1)], groupId: 'electrics', expectedGroupRevision: 1, name: 'Только каталог', variant: '', confirmed: true, expectedMaterialRevision: 2, renameMaterial: false });
  assert.equal(store.get('materialItems/stock').name, 'Складское имя'); assert.equal(store.get('materialItems/stock').revision, 2); assert.equal(store.get('materialValuations/stock').valueCents, 5000);
});
