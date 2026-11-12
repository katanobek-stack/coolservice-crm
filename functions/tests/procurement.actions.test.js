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
