import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateProcurement, parseDecimal, safeSupplierUrl } from '../src/features/procurement/procurementLogic';
import { buildProcurementWorkbook } from '../src/features/procurement/procurementExport';
import { filterMaterials } from '../src/features/materials/materialsLogic';

const line = { catalogId: 'part', name: 'Деталь', supplierUrl: 'https://item.taobao.com/item.htm?id=123', variant: '12V', quantity: '10', unitPrice: '20', chinaDelivery: '10', receivedQuantity: '10', weightKg: '2' };

test('commission excludes freight, unit cost uses actual quantity and total line weight', () => {
  const result = calculateProcurement([line], { commission: '3', exchange: '13', freightRate: '480' });
  assert.equal(result.productsFen, 20000);
  assert.equal(result.chinaFen, 1000);
  assert.equal(result.commissionFen, 630);
  assert.equal(result.totalFen, 21630);
  assert.equal(result.lines[0].freightCents, 96000);
  assert.equal(result.lines[0].unitCostCents, 37719);
});

test('missing delivery and unknown weight never become free freight', () => {
  const result = calculateProcurement([{ ...line, chinaDelivery: '', weightKg: '' }], { commission: '3', exchange: '13', freightRate: '480' });
  assert.equal(result.totalFen, null);
  assert.equal(result.lines[0].unitCostCents, null);
  const free = calculateProcurement([{ ...line, unitPrice: '0', chinaDelivery: '0', weightKg: '0' }], { commission: '3', exchange: '13', freightRate: '0' });
  assert.equal(free.lines[0].unitCostCents, 0);
});

test('actual received quantity is the divisor even when it differs from ordered quantity', () => {
  const result = calculateProcurement([{ ...line, receivedQuantity: '8' }], { commission: '3', exchange: '13', freightRate: '480' });
  assert.equal(result.lines[0].receiptMismatch, true);
  assert.equal(result.lines[0].unitCostCents, 47149);
});

test('commission rounding reconciles across all order lines', () => {
  const lines = Array.from({ length: 3 }, (_, index) => ({ ...line, catalogId: String(index), quantity: '1', unitPrice: '0.05', chinaDelivery: '0' }));
  const result = calculateProcurement(lines, { commission: '10', exchange: '13', freightRate: '0' });
  assert.equal(result.commissionFen, 2);
  assert.equal(result.lines.reduce((sum, row) => sum + (row.commissionFen ?? 0), 0), 2);
});

test('decimal precision and safe supplier URLs are validated', () => {
  assert.equal(parseDecimal('1,25', 100), 125);
  assert.equal(parseDecimal('', 100), null);
  assert.equal(parseDecimal('1.001', 100), null);
  assert.equal(parseDecimal('-1', 100), null);
  assert.equal(safeSupplierUrl('javascript:alert(1)'), null);
  assert.equal(safeSupplierUrl('https://taobao.com.evil.test/item?id=1'), null);
  assert.equal(safeSupplierUrl('https://u:p@item.taobao.com/item.htm?id=1'), null);
  assert.equal(safeSupplierUrl(line.supplierUrl), line.supplierUrl);
});

test('supplier Excel keeps real hyperlinks and separate commission and freight', () => {
  const book = buildProcurementWorkbook({ id: 'order', name: 'Заказ', commission: '3', exchange: '13', freightRate: '480', lines: [line] });
  const sheet = book.Sheets['Заказ посреднику'];
  assert.equal(sheet.B3.l?.Target, line.supplierUrl);
  assert.equal(sheet.E3.v, 10);
  assert.equal(sheet.G3.v, 200);
  assert.equal(sheet.H3.v, 10);
  assert.equal(book.Sheets['Себестоимость'].G3.v, 377.19);
});

test('uncounted stock does not appear as low or zero stock in reorder filtering', () => {
  const common = { name: 'Деталь', unit: 'pcs' as const, quantityMilli: 0, minimumMilli: 1000, active: true, revision: 1 };
  assert.deepEqual(filterMaterials([{ ...common, id: 'unknown', stockConfirmed: false }, { ...common, id: 'known' }], '', true).map(item => item.id), ['known']);
});
