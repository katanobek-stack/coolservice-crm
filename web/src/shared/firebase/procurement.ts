import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseDb, getFirebaseFunctions } from './app';
import type { ProcurementCatalogItem, ProcurementOrder, ProcurementOrderDraft, ProcurementGroup, CatalogMutation } from '../types/procurement';
import type { MaterialUnit } from '../types/resources';

const api = async (action: string, requestId: string, payload: object) => {
  const result = await httpsCallable(getFirebaseFunctions(), 'manageProcurement')({ action, requestId, ...payload });
  return result.data as { id?: string; revision?: number; imported?: number; skipped?: number };
};
export const importProcurementCatalog = (requestId: string, items: ProcurementCatalogItem[]) => api('importCatalog', requestId, { items });
export const saveProcurementOrder = (requestId: string, order: ProcurementOrderDraft, expectedRevision: number) => api('saveOrder', requestId, { order, expectedRevision });
export const linkProcurementMaterial = (requestId: string, input: { catalogId: string; expectedCatalogRevision: number; reviewed: boolean; materialId?: string; expectedMaterialRevision?: number; name?: string; unit?: MaterialUnit; minimumMilli?: number }) => api('linkMaterial', requestId, input);
export const initializeProcurementGroups = (requestId: string) => api('initializeGroups', requestId, {});
export const saveProcurementGroup = (requestId: string, input: { id: string; name: string; expectedRevision: number }) => api('saveGroup', requestId, input);
export const deleteProcurementGroup = (requestId: string, input: { id: string; expectedRevision: number }) => api('deleteGroup', requestId, input);
export const updateProcurementCatalog = (requestId: string, input: CatalogMutation) => api('updateCatalog', requestId, input);

export function useProcurement() {
  const [state, setState] = useState<{ items: ProcurementCatalogItem[]; orders: ProcurementOrder[]; groups: ProcurementGroup[]; ready: boolean; error: string }>({ items: [], orders: [], groups: [], ready: false, error: '' });
  useEffect(() => {
    const ready = new Set<string>(), errors = new Map<string, string>();
    const unsubscribes = ['procurementCatalog', 'procurementOrders', 'procurementGroups'].map(name => onSnapshot(collection(getFirebaseDb(), name), { includeMetadataChanges: true }, snapshot => {
      if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) ready.delete(name); else { ready.add(name); errors.delete(name); }
      const rows = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      setState(previous => ({ ...previous, [name === 'procurementCatalog' ? 'items' : name === 'procurementGroups' ? 'groups' : 'orders']: rows, ready: ready.size === 3, error: [...errors.values()].join(' ') }));
    }, () => {
      ready.delete(name); errors.set(name, 'Закуп недоступен: проверьте соединение, права и публикацию серверной функции и правил.');
      setState(previous => ({ ...previous, ready: false, error: [...errors.values()].join(' ') }));
    }));
    return () => unsubscribes.forEach(unsubscribe => unsubscribe());
  }, []);
  return state;
}
