import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResourceReport, filterMaterials, orphanResourceEntries, type ResourceRepair } from '../src/features/materials/materialsLogic';
import type { MaterialItem, RepairResource } from '../src/shared/types/resources';

const repair = (id: string, cost?: string): ResourceRepair => ({ repair: { id, serviceType: 'other', tasks: [{ id: 'task', description: 'Работа', assignees: ['staff'], doneBy: ['staff'], status: 'done' }], status: 'done', closedByManager: true, cost }, client: 'Клиент', object: 'А001АА' });
const entry = (id: string, type: RepairResource['type'], repairId = 'original'): RepairResource => ({ id, type, repairId, taskId: 'task', createdBy: 'staff', note: '' });
const confirmed = (...ids: string[]) => ids.map(id => ({ id: `${id}_task`, repairId: id, taskId: 'task', assigneeIds: ['staff'], confirmedBy: 'manager' }));
const ledger = (source: ResourceRepair) => [{ ...source.repair.rework!, id: source.repair.id }];

test('missing material valuation never produces a zero cost or final profit', () => {
  const [row] = buildResourceReport([repair('original', '1000')], [entry('material', 'material')], []);
  assert.equal(row.materialCents, null);
  assert.equal(row.directMarginCents, null);
  assert.equal(row.fullMarginCents, null);
});
test('piece cost and allocated hourly work are separate margins and voided time is excluded', () => {
  const [row] = buildResourceReport([repair('original', '1000')], [entry('mat', 'material'), entry('return', 'return'), entry('piece', 'piece'), { ...entry('time', 'time'), minutes: 60 }, { ...entry('void', 'time'), minutes: 100, voided: true }], [
    { id: 'mat', repairId: 'original', costCents: 20000 }, { id: 'return', repairId: 'original', costCents: -5000 }, { id: 'piece', repairId: 'original', costCents: 10000 }, { id: 'time', repairId: 'original', costCents: 30000 },
  ], confirmed('original'));
  assert.equal(row.materialCents, 15000);
  assert.equal(row.pieceCents, 10000);
  assert.equal(row.hourlyCents, 30000);
  assert.equal(row.directMarginCents, 75000);
  assert.equal(row.fullMarginCents, 45000);
  assert.equal(row.minutes, 60);
});
test('unknown revenue and missing hourly rate remain incomplete', () => {
  const [row] = buildResourceReport([repair('original')], [{ ...entry('time', 'time'), minutes: 30 }], []);
  assert.equal(row.hourlyCents, null);
  assert.equal(row.directMarginCents, null);
  assert.equal(row.fullMarginCents, null);
});
test('inventory search matches normalized Russian names and low-stock includes minimum boundary', () => {
  const item: MaterialItem = { id: 'one', name: 'Фреон R404', unit: 'kg', active: true, quantityMilli: 1000, minimumMilli: 1000, revision: 1 };
  assert.deepEqual(filterMaterials([item, { ...item, id: 'two', quantityMilli: 2000 }], '  ФРЕОН ', true).map(i => i.id), ['one']);
});
test('linked rework costs reduce original result, with responsibility only after confirmed workmanship', () => {
  const child = repair('child');
  child.repair.rework = { originalClientId: 'client', originalRepairId: 'original', originalTaskId: 'task', cause: 'workmanship', responsibleStaffIds: ['mechanic'], decisionNote: '', confirmedBy: 'manager' };
  const [row] = buildResourceReport([repair('original', '1000'), child], [entry('piece', 'piece', 'child')], [{ id: 'piece', repairId: 'child', costCents: 15000 }], confirmed('original', 'child'), ledger(child));
  assert.equal(row.reworks, 1);
  assert.equal(row.reworkCents, 15000);
  assert.equal(row.directMarginCents, 85000);
  assert.deepEqual(row.responsibleStaffIds, ['mechanic']);
  child.repair.rework.confirmedBy = undefined;
  assert.deepEqual(buildResourceReport([repair('original', '1000'), child], [], [])[0].responsibleStaffIds, []);
});
test('piece work replaces same employee task hourly cost without hiding recorded time or other staff cost', () => {
  const [row] = buildResourceReport([repair('original', '1000')], [
    { ...entry('piece', 'piece'), staffId: 'one' }, { ...entry('hour1', 'time'), staffId: 'one', minutes: 60 }, { ...entry('hour2', 'time'), staffId: 'two', minutes: 30 },
  ], [{ id: 'piece', repairId: 'original', costCents: 15000 }, { id: 'hour2', repairId: 'original', costCents: 10000 }], confirmed('original'));
  assert.equal(row.minutes, 90);
  assert.equal(row.hourlyCents, 10000);
  assert.equal(row.fullMarginCents, 75000);
  assert.equal(row.unknownEntries, 0);
});
test('missing parent repair preserves diagnostics and does not show complete margin for orphan rework', () => {
  const child = repair('child', '0');
  child.repair.rework = { originalClientId: 'deleted', originalRepairId: 'original', originalTaskId: 'task', cause: 'pending', responsibleStaffIds: [], decisionNote: '' };
  const entries = [entry('orphan', 'material', 'deleted'), entry('childpiece', 'piece', 'child')];
  assert.deepEqual(orphanResourceEntries([child], entries).map(item => item.id), ['orphan']);
  const [row] = buildResourceReport([child], entries, [{ id: 'childpiece', repairId: 'child', costCents: 5000 }], [], ledger(child));
  assert.equal(row.missingOriginal, true);
  assert.equal(row.directMarginCents, null);
});
test('fully returned unknown-cost material has no net cost but partial return stays incomplete', () => {
  const entries = [{ ...entry('material', 'material'), quantityMilli: 1500, returnedMilli: 1500 }, { ...entry('return', 'return'), originalId: 'material', quantityMilli: 1500 }];
  const [row] = buildResourceReport([repair('original', '1000')], entries, [], confirmed('original'));
  assert.equal(row.materialCents, 0);
  assert.equal(row.fullMarginCents, 100000);
  assert.equal(row.unknownEntries, 0);
  entries[0].returnedMilli = 1000;
  entries[1].quantityMilli = 1000;
  assert.equal(buildResourceReport([repair('original', '1000')], entries, [])[0].materialCents, null);
});
test('resource analytics uses confirmed repair completion and Vladivostok financial day', () => {
  const source = repair('original', '1000');
  source.repair.status = 'in_progress';
  source.repair.closedByManager = true;
  source.repair.workCompletedAt = '2026-10-31T23:00:00.000Z';
  const [row] = buildResourceReport([source], [], []);
  assert.equal(row.date, '2026-11-01');
  assert.equal(row.revenueCents, 100000);
});
test('legacy repairs without confirmed accounting never show revenue as complete profit', () => {
  const [row] = buildResourceReport([repair('original', '1000')], [], []);
  assert.equal(row.accountingComplete, false);
  assert.equal(row.directMarginCents, null);
  assert.equal(row.fullMarginCents, null);
});
test('changing task assignees invalidates accounting confirmation and child repairs need their own confirmation', () => {
  const original = repair('original', '1000');
  const child = repair('child', '0');
  child.repair.rework = { originalClientId: 'client', originalRepairId: 'original', originalTaskId: 'task', cause: 'pending', responsibleStaffIds: [], decisionNote: '' };
  const row = buildResourceReport([original, child], [], [], confirmed('original'), ledger(child))[0];
  assert.equal(row.accountingComplete, false);
  original.repair.tasks[0].assignees = ['staff', 'new'];
  assert.equal(buildResourceReport([original], [], [], confirmed('original'))[0].accountingComplete, false);
});
test('mechanic completion with preliminary price never becomes approved revenue', () => {
  const source = repair('original', '1000');
  source.repair.closedByManager = false;
  source.repair.closedAt = '2026-11-10';
  const [row] = buildResourceReport([source], [entry('piece', 'piece')], [{ id: 'piece', repairId: 'original', costCents: 10000 }], confirmed('original'));
  assert.equal(row.pieceCents, 10000);
  assert.equal(row.revenueCents, null);
  assert.equal(row.fullMarginCents, null);
});
test('untrusted nested rework metadata cannot link costs or attribute responsibility', () => {
  const child = repair('child', '0');
  child.repair.rework = { originalClientId: 'client', originalRepairId: 'original', originalTaskId: 'task', cause: 'workmanship', responsibleStaffIds: ['victim'], decisionNote: '', confirmedBy: 'forged' };
  const rows = buildResourceReport([repair('original', '1000'), child], [], [], confirmed('original', 'child'));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].reworks, 0);
  assert.deepEqual(rows[0].responsibleStaffIds, []);
  assert.equal(rows[1].unverifiedRework, true);
  assert.equal(rows[1].fullMarginCents, null);
});
test('deleted linked rework keeps its immutable costs on the original and blocks complete margin', () => {
  const child = repair('deleted-child', '0');
  child.repair.rework = { originalClientId: 'client', originalRepairId: 'original', originalTaskId: 'task', cause: 'workmanship', responsibleStaffIds: ['staff'], confirmedBy: 'manager', decisionNote: '' };
  const [row] = buildResourceReport([repair('original', '1000')], [entry('child-piece', 'piece', 'deleted-child')], [{ id: 'child-piece', repairId: 'deleted-child', costCents: 15000 }], confirmed('original', 'deleted-child'), ledger(child));
  assert.equal(row.pieceCents, 15000);
  assert.equal(row.reworkCents, 15000);
  assert.equal(row.reworks, 1);
  assert.deepEqual(row.linkedIds, ['original', 'deleted-child']);
  assert.deepEqual(row.responsibleStaffIds, ['staff']);
  assert.equal(row.missingLinkedRework, true);
  assert.equal(row.accountingComplete, false);
  assert.equal(row.directMarginCents, null);
  assert.equal(row.fullMarginCents, null);
});
