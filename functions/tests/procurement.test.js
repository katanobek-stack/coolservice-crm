const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateCatalogItem, validateOrder, materialIdForCatalog, assertStockConfirmed, canManageProcurement } = require('../lib/procurementLogic');

const item = { id: 'source-1', name: 'Контактор', variant: 'NXC-25 220V', suppliers: [{ url: 'https://item.taobao.com/item.htm?id=123', site: 'Taobao', product: '123', priceFen: 1200 }], sources: [{ file: 'B2-52.xls', row: 10, year: '2026', quantity: '2', priceFen: 1200, description: 'NXC-25' }], imageDataUrl: '', needsReview: false, reviewNote: '' };
test('catalogue validation preserves sources and rejects unsafe links or oversized photos', () => {
  assert.deepEqual(validateCatalogItem(item), item);
  assert.throws(() => validateCatalogItem({ ...item, suppliers: [{ ...item.suppliers[0], url: 'https://evil.test/' }] }));
  assert.throws(() => validateCatalogItem({ ...item, imageDataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(40000) }));
  assert.throws(() => validateCatalogItem({ ...item, sources: [] }));
});
test('draft orders reject invalid quantities and duplicate catalogue lines', () => {
  const line = { catalogId: 'source-1', name: 'Контактор', variant: '220V', supplierUrl: item.suppliers[0].url, quantity: '2', unitPrice: '12', chinaDelivery: '0', receivedQuantity: '', weightKg: '' };
  const order = { id: 'order-1', name: 'Заказ', commission: '3', exchange: '', freightRate: '', lines: [line] };
  assert.deepEqual(validateOrder(order), order);
  assert.throws(() => validateOrder({ ...order, lines: [line, line] }));
  assert.throws(() => validateOrder({ ...order, lines: [{ ...line, quantity: '-1' }] }));
  assert.throws(() => validateOrder({ ...order, commission: '101' }));
});
test('catalogue stock IDs are stable and uncounted stock cannot be consumed or received', () => {
  assert.equal(materialIdForCatalog('source-1'), materialIdForCatalog('source-1'));
  assert.notEqual(materialIdForCatalog('source-1'), materialIdForCatalog('source-2'));
  assert.throws(() => assertStockConfirmed({ stockConfirmed: false }));
  assert.doesNotThrow(() => assertStockConfirmed({}));
  assert.doesNotThrow(() => assertStockConfirmed({ stockConfirmed: true }));
});
test('procurement requires a management role and financial permission', () => {
  assert.equal(canManageProcurement('mechanic', true, false), false);
  assert.equal(canManageProcurement('admin', false, false), false);
  assert.equal(canManageProcurement('manager', undefined, false), true);
  assert.equal(canManageProcurement(undefined, undefined, true), true);
});
