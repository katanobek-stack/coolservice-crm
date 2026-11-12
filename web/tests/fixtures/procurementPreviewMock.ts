import { useSyncExternalStore } from 'react';
import type { ProcurementCatalogItem, ProcurementOrder, ProcurementOrderDraft } from '../../src/shared/types/procurement';
import type { MaterialItem, ResourceSnapshot } from '../../src/shared/types/resources';

declare global { interface Window { procurementSeed: { items: ProcurementCatalogItem[] }; procurementPreview: { logs: object[]; setRole: (role: string) => void; state: () => unknown } } }
let version = 0, role = 'owner';
const listeners = new Set<() => void>(), logs: object[] = [];
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const notify = () => { version++; listeners.forEach(listener => listener()); };
const items = window.procurementSeed.items.map(item => ({ ...item, revision: 1 }));
let orders: ProcurementOrder[] = [];
let resources: ResourceSnapshot = { items: [], entries: [], confirmations: [], reworks: [], valuations: [], rates: [], costs: [], movements: [], ready: true, financialReady: true, error: '' };
const crm = { clients: [], intakeRepairs: [], staff: [{ id: 'preview-owner', name: 'Руководитель', role: 'owner' }], sourceStatus: { clients: 'ready', intakeRepairs: 'ready', staff: 'ready' } };
export function setRole(value: string) { role = value; notify(); }
export function useAuth() { useSyncExternalStore(subscribe, () => version); return { isOwner: role === 'owner', myProfile: { id: 'preview-owner', role: role === 'denied' ? 'manager' : role, permissions: { pl_panel: role !== 'denied' } } }; }
export function useData() { useSyncExternalStore(subscribe, () => version); return crm; }
export function useResources() { useSyncExternalStore(subscribe, () => version); return resources; }
export function useProcurement() { useSyncExternalStore(subscribe, () => version); return { items, orders, ready: true, error: '' }; }
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
window.procurementPreview = { logs, setRole, state: () => ({ items, orders, resources, role }) };
