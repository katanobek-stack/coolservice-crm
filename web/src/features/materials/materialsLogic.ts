import type { Repair } from '../../shared/types/client';
import type { MaterialItem, RepairResource, ResourceCost } from '../../shared/types/resources';
import { repairFinancialDay } from '../../shared/utils/repair';
import { requestStage } from '../../shared/requests/workspaceLogic';
export interface ResourceRepair { repair: Repair; client: string; object: string; unverifiedRework?: boolean }
export function orphanResourceEntries(repairs: ResourceRepair[], entries: RepairResource[]): RepairResource[] {
  const ids = new Set(repairs.map(item => item.repair.id));
  return entries.filter(entry => !ids.has(entry.repairId));
}
export const materialUnits = { pcs: 'шт.', kg: 'кг', ml: 'мл', m: 'м' } as const;
export function filterMaterials(items: MaterialItem[], search: string, lowOnly: boolean): MaterialItem[] {
  const query = search.trim().toLocaleLowerCase('ru-RU');
  return items.filter(item => item.name.toLocaleLowerCase('ru-RU').includes(query) && (!lowOnly || (item.active && item.quantityMilli <= item.minimumMilli))).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'ru'));
}
export function resourceMoney(cents: number | null): string { return cents === null ? 'Нет данных' : new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 }).format(cents / 100); }
export function resourceQuantity(milli: number): string { return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(milli / 1000); }
export function resourceNumber(value: string, scale: number): number | null {
  if (!/^\d+(?:[.,]\d+)?$/.test(value.trim())) return null;
  const scaled = Number(value.replace(',', '.')) * scale;
  return Number.isSafeInteger(Math.round(scaled)) && Math.abs(Math.round(scaled) - scaled) < 0.00001 ? Math.round(scaled) : null;
}
export interface ResourceReportRow extends ResourceRepair {
  id: string; date: string; revenueCents: number | null; materialCents: number | null; pieceCents: number | null; hourlyCents: number | null; rawHourlyCents: number | null;
  directMarginCents: number | null; fullMarginCents: number | null; minutes: number; reworkCents: number | null; reworkHourlyCents: number | null; reworks: number;
  responsibleStaffIds: string[]; performerIds: string[]; linkedIds: string[]; unknownEntries: number; missingOriginal: boolean; accountingComplete: boolean;
  missingLinkedRework: boolean; missingLinkedReworkIds: string[];
}
export function buildResourceReport(repairs: ResourceRepair[], entries: RepairResource[], costs: ResourceCost[], confirmations: { repairId: string; taskId: string; assigneeIds: string[]; confirmedBy: string }[] = [], reworkRecords: (NonNullable<Repair['rework']> & { id: string })[] = []): ResourceReportRow[] {
  repairs = repairs.map(source => {
    const trusted = reworkRecords.find(record => record.id === source.repair.id);
    return { ...source, unverifiedRework: !trusted && (!!source.repair.rework || !!source.unverifiedRework), repair: { ...source.repair, rework: trusted } };
  });
  const costMap = new Map(costs.map(cost => [cost.id, cost.costCents]));
  const active = entries.filter(entry => !entry.voided);
  const fullyReturned = new Set(active.filter(entry => entry.type === 'material' && (entry.quantityMilli ?? 0) > 0 && entry.returnedMilli === entry.quantityMilli).map(entry => entry.id));
  const cancelledMaterial = (entry: RepairResource) => (entry.type === 'material' && fullyReturned.has(entry.id)) || (entry.type === 'return' && !!entry.originalId && fullyReturned.has(entry.originalId));
  const sum = (selected: RepairResource[]) => {
    const net = selected.filter(entry => !cancelledMaterial(entry));
    return net.some(entry => costMap.get(entry.id) == null) ? null : net.reduce((total, entry) => total + (costMap.get(entry.id) ?? 0), 0);
  };
  return repairs.filter(item => !item.repair.rework || !repairs.some(parent => parent.repair.id === item.repair.rework?.originalRepairId)).map(item => {
    const linkedReworks = reworkRecords.filter(record => record.originalRepairId === item.repair.id);
    const childIds = [...new Set(linkedReworks.map(record => record.id))];
    const children = repairs.filter(child => childIds.includes(child.repair.id));
    const missingLinkedReworkIds = childIds.filter(id => !repairs.some(source => source.repair.id === id));
    const missingLinkedRework = missingLinkedReworkIds.length > 0;
    const accountingComplete = !missingLinkedRework && [item, ...children].every(source => !source.unverifiedRework && source.repair.tasks.length > 0 && source.repair.tasks.every(task => confirmations.some(confirmation => {
      const assigned = [...new Set(task.assignees ?? [])].sort();
      const confirmed = [...new Set(confirmation.assigneeIds)].sort();
      return confirmation.repairId === source.repair.id && confirmation.taskId === task.id && !!confirmation.confirmedBy && assigned.length === confirmed.length && assigned.every((id, index) => id === confirmed[index]);
    })));
    const linkedIds = [item.repair.id, ...childIds];
    const selected = active.filter(entry => linkedIds.includes(entry.repairId));
    const materialCents = sum(selected.filter(entry => entry.type === 'material' || entry.type === 'return'));
    const pieceCents = sum(selected.filter(entry => entry.type === 'piece'));
    const pieceKeys = new Set(selected.filter(entry => entry.type === 'piece' && entry.staffId).map(entry => JSON.stringify([entry.repairId, entry.taskId, entry.staffId])));
    const covered = (entry: RepairResource) => entry.type === 'time' && !!entry.staffId && pieceKeys.has(JSON.stringify([entry.repairId, entry.taskId, entry.staffId]));
    const appliedEntries = selected.filter(entry => !covered(entry) && !cancelledMaterial(entry));
    const hourlyCents = sum(appliedEntries.filter(entry => entry.type === 'time'));
    const rawHourlyCents = sum(selected.filter(entry => entry.type === 'time'));
    const missingOriginal = !!item.repair.rework && !repairs.some(parent => parent.repair.id === item.repair.rework?.originalRepairId);
    const revenueCents = !missingOriginal && !item.unverifiedRework && requestStage(item.repair) === 'closed' && item.repair.cost?.trim() ? resourceNumber(item.repair.cost, 100) : null;
    const directMarginCents = !accountingComplete || revenueCents === null || materialCents === null || pieceCents === null ? null : revenueCents - materialCents - pieceCents;
    const reworkEntries = selected.filter(entry => entry.repairId !== item.repair.id);
    return { ...item, id: item.repair.id, date: repairFinancialDay(item.repair), revenueCents, materialCents, pieceCents, hourlyCents, rawHourlyCents, directMarginCents, missingOriginal, accountingComplete, missingLinkedRework, missingLinkedReworkIds,
      fullMarginCents: directMarginCents === null || hourlyCents === null ? null : directMarginCents - hourlyCents,
      minutes: selected.reduce((total, entry) => total + (entry.type === 'time' ? entry.minutes ?? 0 : 0), 0), reworks: childIds.length,
      reworkCents: sum(reworkEntries.filter(entry => entry.type !== 'time')), reworkHourlyCents: sum(reworkEntries.filter(entry => entry.type === 'time' && !covered(entry))),
      responsibleStaffIds: [...new Set(linkedReworks.flatMap(record => record.cause === 'workmanship' && record.confirmedBy ? record.responsibleStaffIds : []))],
      performerIds: [...new Set(selected.flatMap(entry => entry.staffId ? [entry.staffId] : []))], linkedIds,
      unknownEntries: appliedEntries.filter(entry => costMap.get(entry.id) == null).length,
    };
  });
}
