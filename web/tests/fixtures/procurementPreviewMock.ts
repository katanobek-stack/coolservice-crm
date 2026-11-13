import { useSyncExternalStore } from 'react';
import type { ProcurementCatalogItem, ProcurementOrder, ProcurementOrderDraft, ProcurementGroup, CatalogMutation, CatalogMergeInput } from '../../src/shared/types/procurement';
import type { MaterialItem, ResourceSnapshot } from '../../src/shared/types/resources';

declare global { interface Window { procurementSeed: { items: ProcurementCatalogItem[]; groups?: ProcurementGroup[]; materials?: MaterialItem[] }; procurementPreview: { logs: object[]; failNextMergeResponse?: boolean; setRole: (role: string) => void; state: () => unknown } } }
let version = 0, role = 'owner';
const listeners = new Set<() => void>(), logs: object[] = [];
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const notify = () => { version++; listeners.forEach(listener => listener()); };
const items = window.procurementSeed.items.map(item => ({ ...item, revision: 1 }));
let orders: ProcurementOrder[] = [];
let groups: ProcurementGroup[] = window.procurementSeed.groups ?? ['Электрика', 'Фитинги', 'Инструменты', 'Рефустановки', 'Электроника', 'Личные'].map((name, position) => ({ id: 'group-' + position, name, position, active: true, revision: 1 }));
let resources: ResourceSnapshot = { items: window.procurementSeed.materials ?? [], entries: [], confirmations: [], reworks: [], valuations: [], rates: [], costs: [], movements: [], ready: true, financialReady: true, error: '' };
const crm = { clients: [], intakeRepairs: [], staff: [{ id: 'preview-owner', name: 'Руководитель', role: 'owner' }], sourceStatus: { clients: 'ready', intakeRepairs: 'ready', staff: 'ready' } };
export function setRole(value: string) { role = value; notify(); }
export function useAuth() { useSyncExternalStore(subscribe, () => version); return { isOwner: role === 'owner', myProfile: { id: 'preview-owner', role: role === 'denied' ? 'manager' : role, permissions: { pl_panel: role !== 'denied' } } }; }
export function useData() { useSyncExternalStore(subscribe, () => version); return crm; }
export function useResources() { useSyncExternalStore(subscribe, () => version); return resources; }
export function useProcurement() { useSyncExternalStore(subscribe, () => version); return { items: [...items], orders, groups: [...groups], ready: true, error: '' }; }
export async function importProcurementCatalog(requestId: string, imported: ProcurementCatalogItem[]) { let added = 0; for (const item of imported) if (!items.some(old => old.id === item.id)) { items.push({ ...item, revision: 1 }); added++; } logs.push({ action: 'importCatalog', requestId, imported: added }); notify(); return { imported: added, skipped: imported.length - added }; }
export async function saveProcurementOrder(requestId: string, draft: ProcurementOrderDraft, expectedRevision: number) { await new Promise(resolve => setTimeout(resolve, 300)); const old = orders.find(order => order.id === draft.id); if ((old?.revision ?? 0) !== expectedRevision) throw new Error('Заказ изменился'); const revision = expectedRevision + 1; orders = [...orders.filter(order => order.id !== draft.id), { ...draft, revision }]; logs.push({ action: 'saveOrder', requestId, id: draft.id }); notify(); return { id: draft.id, revision }; }
export async function linkProcurementMaterial(requestId: string, input: { catalogId: string; materialId?: string; name?: string; unit?: MaterialItem['unit']; minimumMilli?: number }) {
  const item = items.find(item => item.id === input.catalogId)!;
  if (item.linkedMaterialId) return { id: item.linkedMaterialId };
  const id = input.materialId || 'material-' + item.id;
  if (!input.materialId) resources = { ...resources, items: [...resources.items, { id, name: input.name!, unit: input.unit!, minimumMilli: input.minimumMilli!, quantityMilli: 0, stockConfirmed: false, active: true, revision: 1, procurementCatalogIds: [item.id] }], valuations: [...resources.valuations, { id, valueCents: null }] };
  item.linkedMaterialId = id; item.revision++;
  logs.push({ action: 'linkMaterial', requestId, catalogId: item.id, materialId: id }); notify(); return { id };
}
export async function countMaterialStock(input: { materialId: string; quantityMilli: number }) { resources = { ...resources, items: resources.items.map(item => item.id === input.materialId ? { ...item, quantityMilli: input.quantityMilli, stockConfirmed: true, revision: item.revision + 1 } : item) }; logs.push({ action: 'countMaterialStock', ...input }); notify(); return { id: input.materialId }; }
export async function saveMaterial(input: MaterialItem) { resources = { ...resources, items: resources.items.some(item => item.id === input.id) ? resources.items.map(item => item.id === input.id ? { ...item, ...input, revision: item.revision + 1 } : item) : [...resources.items, { ...input, quantityMilli: 0, revision: 1 }] }; notify(); return { id: input.id }; }
export async function receiveMaterial() { return {}; }
export async function saveResourceRate() { return {}; }
export async function setMaterialValuation() { return {}; }
window.procurementPreview = { logs, setRole, state: () => ({ items, orders, groups, resources, role }) };

export async function initializeProcurementGroups() { return {}; }
export async function saveProcurementGroup(requestId: string, input: { id: string; name: string; expectedRevision: number }) {
  const old = groups.find(group => group.id === input.id);
  if ((old?.revision ?? 0) !== input.expectedRevision) throw new Error('Группа изменена');
  groups = [...groups.filter(group => group.id !== input.id), { id: input.id, name: input.name, active: true, revision: input.expectedRevision + 1, position: old?.position ?? 100 }];
  logs.push({ action: 'saveGroup', requestId, ...input }); notify(); return { id: input.id };
}
export async function deleteProcurementGroup(requestId: string, input: { id: string; expectedRevision: number }) {
  const group = groups.find(group => group.id === input.id)!;
  if (group.revision !== input.expectedRevision) throw new Error('Группа изменена');
  group.active = false; group.revision++; logs.push({ action: 'deleteGroup', requestId, ...input }); notify(); return { id: input.id };
}
export async function updateProcurementCatalog(requestId: string, input: CatalogMutation) {
  const selected = input.items.map(ref => { const item = items.find(item => item.id === ref.id)!; if (item.revision !== ref.revision) throw new Error('Товар изменён'); return item; });
  selected.forEach(item => { if (input.operation === 'move') item.groupId = input.groupId; else if (input.operation === 'rename') { item.name = input.name!; item.variant = input.variant!; } else item.archived = input.operation === 'trash'; item.revision++; });
  logs.push({ action: 'updateCatalog', requestId, ...input }); notify(); return { updated: selected.length };
}

export async function setProcurementSupplier(requestId: string, input: { catalogId: string; expectedRevision: number; url: string; disabled: boolean }) {
  const item = items.find(item => item.id === input.catalogId)!;
  if (item.revision !== input.expectedRevision) throw new Error('Карточка изменена');
  item.suppliers = item.suppliers.map(supplier => supplier.url === input.url ? { ...supplier, disabled: input.disabled } : supplier); item.revision++; logs.push({ action: 'setSupplierEnabled', requestId, ...input }); notify(); return { id: item.id };
}
const mergeResults = new Map<string, { fingerprint: string; id: string }>();
export async function mergeProcurementCatalog(requestId: string, input: CatalogMergeInput) {
  const fingerprint = JSON.stringify(input), previous = mergeResults.get(requestId);
  if (previous) { if (previous.fingerprint !== fingerprint) throw new Error('Повтор с другими данными'); return { id: previous.id }; }
  const chosen = input.items.map(ref => { const item = items.find(item => item.id === ref.id)!; if (item.revision !== ref.revision || item.archived || item.mergedIntoId) throw new Error('Карточка изменена'); return item; });
  const primary = chosen.find(item => item.id === input.primaryId)!, photo = chosen.find(item => item.id === input.photoId)!;
  const ordered = [primary, ...chosen.filter(item => item.id !== primary.id)];
  const suppliers = [...new Map([...ordered].reverse().flatMap(item => item.suppliers).map(supplier => [supplier.url, supplier])).values()];
  const sources = [...new Map(ordered.flatMap(item => item.sources).map(source => [JSON.stringify(source), source])).values()];
  const materialId = ordered.find(item => item.linkedMaterialId)?.linkedMaterialId;
  const mergedCardIds = [...new Set(ordered.flatMap(item => [item.id, ...(item.mergedCardIds ?? [])]).filter(id => id !== primary.id))];
  chosen.filter(item => item.id !== primary.id).forEach(item => { item.archived = true; item.mergedIntoId = primary.id; item.revision++; });
  Object.assign(primary, { name: input.name, variant: input.variant, suppliers, sources, mergedCardIds, imageDataUrl: photo.imageDataUrl, ...(materialId ? { linkedMaterialId: materialId } : {}), revision: primary.revision + 1 });
  if (input.renameMaterial && materialId) resources = { ...resources, items: resources.items.map(item => item.id === materialId ? { ...item, name: input.name, revision: item.revision + 1 } : item) };
  logs.push({ action: 'mergeCatalog', requestId, ...input }); mergeResults.set(requestId, { fingerprint, id: primary.id }); notify();
  if (window.procurementPreview.failNextMergeResponse) { window.procurementPreview.failNextMergeResponse = false; throw new Error('Ответ не получен. Повторите сохранение.'); }
  return { id: primary.id };
}
