import type { ProcurementCatalogItem, ProcurementGroup } from '../../shared/types/procurement';

export function catalogViewItems(items: ProcurementCatalogItem[], groups: ProcurementGroup[], view: string) {
  const active = new Set(groups.filter(group => group.active).map(group => group.id));
  return items.filter(item => view === 'trash' ? item.archived === true : !item.archived && (view === 'all' || view === 'ungrouped' && (!item.groupId || !active.has(item.groupId)) || item.groupId === view));
}
export function catalogGroupCounts(items: ProcurementCatalogItem[], groups: ProcurementGroup[]): Record<string, number> {
  const active = new Set(groups.filter(group => group.active).map(group => group.id)), counts: Record<string, number> = Object.assign(Object.create(null), { all: 0, ungrouped: 0, trash: 0 });
  for (const item of items) {
    if (item.archived) { counts.trash++; continue; }
    counts.all++;
    const id = item.groupId && active.has(item.groupId) ? item.groupId : 'ungrouped';
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}
