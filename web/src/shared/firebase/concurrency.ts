import {
  doc,
  getDoc,
  runTransaction,
  type DocumentData,
  type Firestore,
  type Transaction,
} from "firebase/firestore";
import { getFirebaseDb } from "./app";
import {
  backfillFixedCostHistory,
  sumBoxCost,
  sumSalaries,
  type FixedCosts,
} from "../utils/finance";
import type {
  Chamber,
  Client,
  Repair,
  RepairTask,
  Vehicle,
} from "../types/client";
import type { ServiceTask, Subtask } from "../types/task";
import type { Freezer, RentHistoryEntry } from "../types/freezer";

type Entity = Record<string, unknown> & { id?: string };
type ClientArrayField = "repairs" | "vehicles" | "chambers";

export class ConcurrentMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConcurrentMutationError";
  }
}

async function runSafeTransaction<T>(
  firestore: Firestore,
  callback: (transaction: Transaction) => Promise<T>,
): Promise<T> {
  try {
    return await runTransaction(firestore, callback);
  } catch (error) {
    // This notification is deliberately outside the transaction callback:
    // Firestore may retry the callback multiple times.
    if (error instanceof ConcurrentMutationError && typeof window !== "undefined") {
      window.alert(`Данные уже изменены другим сотрудником. Обновите страницу и повторите действие.\n\n${error.message}`);
    }
    throw error;
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

export function canonicalEntityJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

export function assertFieldsUnchanged<T extends object>(
  current: T,
  expected: T,
  fields: readonly (keyof T)[],
  label: string,
): void {
  for (const field of fields) {
    if (canonicalEntityJson(current[field]) !== canonicalEntityJson(expected[field])) {
      throw new ConcurrentMutationError(`${label}: поле ${String(field)} уже изменено другим сотрудником`);
    }
  }
}

export function findEntityIndex<T extends object>(
  items: readonly T[],
  target: T,
  label: string,
): number {
  const targetId = (target as Entity).id;
  if (typeof targetId === "string" && targetId.length > 0) {
    const matches = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => (item as Entity).id === targetId);
    if (matches.length === 1) return matches[0].index;
    if (matches.length > 1) {
      throw new ConcurrentMutationError(`${label}: найден дублирующийся id ${targetId}`);
    }
    throw new ConcurrentMutationError(`${label}: элемент ${targetId} уже изменён или удалён`);
  }

  // Legacy records may not have an id. Exact snapshot matching is deliberately
  // conservative: a concurrent change becomes an explicit conflict, not a
  // silent overwrite of the changed record.
  const signature = canonicalEntityJson(target);
  const matches = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => canonicalEntityJson(item) === signature);
  if (matches.length === 1) return matches[0].index;
  if (matches.length > 1) {
    throw new ConcurrentMutationError(`${label}: legacy-элемент без id неоднозначен`);
  }
  throw new ConcurrentMutationError(`${label}: legacy-элемент был изменён или удалён`);
}

function requireNewEntityId(entity: object, label: string): string {
  const id = (entity as Entity).id;
  if (typeof id !== "string" || id.length === 0) {
    throw new ConcurrentMutationError(`${label}: новый элемент должен иметь стабильный id`);
  }
  return id;
}

function cleanForFirestore<T>(value: T): T {
  return canonical(value) as T;
}

export function replaceEntity<T extends object>(
  items: readonly T[],
  target: T,
  replacement: T,
  label: string,
): T[] {
  const index = findEntityIndex(items, target, label);
  return items.map((item, itemIndex) => itemIndex === index ? replacement : item);
}

export function removeEntity<T extends object>(
  items: readonly T[],
  target: T,
  label: string,
): T[] {
  const index = findEntityIndex(items, target, label);
  return items.filter((_, itemIndex) => itemIndex !== index);
}

export function removeEntityIfUnchanged<T extends object>(
  items: readonly T[],
  target: T,
  label: string,
): T[] {
  const index = findEntityIndex(items, target, label);
  if (canonicalEntityJson(items[index]) !== canonicalEntityJson(target)) {
    throw new ConcurrentMutationError(`${label}: элемент изменён другим сотрудником`);
  }
  return items.filter((_, itemIndex) => itemIndex !== index);
}

async function mutateClientDocument(
  clientId: string,
  mutation: (client: Client) => Partial<Client>,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  const ref = doc(firestore, "clients", clientId);
  await runSafeTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new ConcurrentMutationError("Клиент уже удалён");
    const client = { id: snapshot.id, ...snapshot.data() } as Client;
    const updates = cleanForFirestore(mutation(client)) as DocumentData;
    if (Object.keys(updates).length > 0) transaction.update(ref, updates);
  });
}

async function mutateClientArray<T extends object>(
  clientId: string,
  field: ClientArrayField,
  mutation: (items: T[], client: Client) => T[],
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  await mutateClientDocument(clientId, (client) => {
    const items = ([...(client[field] ?? [])] as unknown) as T[];
    return { [field]: mutation(items, client) } as Partial<Client>;
  }, firestore);
}

export async function addClientArrayEntity<T extends object>(
  clientId: string,
  field: ClientArrayField,
  entity: T,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  const id = requireNewEntityId(entity, field);
  await mutateClientArray<T>(clientId, field, (items) => {
    if (items.some((item) => (item as Entity).id === id)) return items;
    return [...items, entity];
  }, firestore);
}

export async function updateClientArrayEntity<T extends object>(
  clientId: string,
  field: ClientArrayField,
  target: T,
  mutation: (current: T) => T,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  await mutateClientArray<T>(clientId, field, (items) => {
    const index = findEntityIndex(items, target, field);
    const current = items[index];
    return items.map((item, itemIndex) => itemIndex === index ? mutation(current) : item);
  }, firestore);
}

export async function removeClientArrayEntity<T extends object>(
  clientId: string,
  field: ClientArrayField,
  target: T,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  await mutateClientArray<T>(clientId, field, (items) => removeEntityIfUnchanged(items, target, field), firestore);
}

export function addClientRepair(
  clientId: string,
  repair: Repair,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  return addClientArrayEntity(clientId, "repairs", repair, firestore);
}

export function mutateClientRepair(
  clientId: string,
  repair: Repair,
  mutation: (current: Repair) => Repair,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  return updateClientArrayEntity(clientId, "repairs", repair, mutation, firestore);
}

export function removeClientRepair(
  clientId: string,
  repair: Repair,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  return removeClientArrayEntity(clientId, "repairs", repair, firestore);
}

export function addRepairTask(
  clientId: string,
  repair: Repair,
  task: RepairTask,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  const id = requireNewEntityId(task, "repair task");
  return mutateClientRepair(clientId, repair, (current) => {
    const tasks = [...(current.tasks ?? [])];
    if (tasks.some((item) => item.id === id)) return current;
    return { ...current, tasks: [...tasks, task] };
  }, firestore);
}

export function mutateRepairTask(
  clientId: string,
  repair: Repair,
  task: RepairTask,
  mutation: (current: RepairTask) => RepairTask,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  return mutateClientRepair(clientId, repair, (currentRepair) => {
    const tasks = [...(currentRepair.tasks ?? [])];
    const index = findEntityIndex(tasks, task, "repair task");
    const currentTask = tasks[index];
    return {
      ...currentRepair,
      tasks: tasks.map((item, itemIndex) => itemIndex === index ? mutation(currentTask) : item),
    };
  }, firestore);
}

export function removeRepairTask(
  clientId: string,
  repair: Repair,
  task: RepairTask,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  return mutateClientRepair(clientId, repair, (currentRepair) => ({
    ...currentRepair,
    tasks: removeEntityIfUnchanged(currentRepair.tasks ?? [], task, "repair task"),
  }), firestore);
}

export function addClientVehicle(
  clientId: string,
  vehicle: Vehicle,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  return addClientArrayEntity(clientId, "vehicles", vehicle, firestore);
}

export function mutateClientVehicle(
  clientId: string,
  vehicle: Vehicle,
  mutation: (current: Vehicle) => Vehicle,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  return updateClientArrayEntity(clientId, "vehicles", vehicle, mutation, firestore);
}

export async function ensureClientVehicle(
  clientId: string,
  candidate: Vehicle,
  matches: (current: Vehicle) => boolean = (current) =>
    current.plate.trim().toUpperCase() === candidate.plate.trim().toUpperCase(),
  firestore: Firestore = getFirebaseDb(),
): Promise<string> {
  requireNewEntityId(candidate, "vehicle");
  const ref = doc(firestore, "clients", clientId);
  return runSafeTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new ConcurrentMutationError("Клиент уже удалён");
    const client = { id: snapshot.id, ...snapshot.data() } as Client;
    const existing = (client.vehicles ?? []).find(matches);
    if (existing?.id) return existing.id;
    transaction.update(ref, { vehicles: cleanForFirestore([...(client.vehicles ?? []), candidate]) });
    return candidate.id;
  });
}

export async function addClientRepairWithVehicle(
  clientId: string,
  repair: Repair,
  candidate?: Vehicle,
  matches: (current: Vehicle) => boolean = (current) =>
    !!candidate && current.plate.trim().toUpperCase() === candidate.plate.trim().toUpperCase(),
  firestore: Firestore = getFirebaseDb(),
): Promise<string | undefined> {
  const repairId = requireNewEntityId(repair, "repair");
  if (candidate) requireNewEntityId(candidate, "vehicle");
  const ref = doc(firestore, "clients", clientId);

  return runSafeTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new ConcurrentMutationError("Клиент уже удалён");
    const client = { id: snapshot.id, ...snapshot.data() } as Client;
    const vehicles = [...(client.vehicles ?? [])];
    const existingVehicle = candidate ? vehicles.find(matches) : undefined;
    const vehicleId = existingVehicle?.id ?? candidate?.id ?? repair.vehicleId;
    const repairs = [...(client.repairs ?? [])];
    const updates: DocumentData = {};

    if (candidate && !existingVehicle) updates.vehicles = cleanForFirestore([...vehicles, candidate]);
    if (!repairs.some((item) => item.id === repairId)) {
      const finalRepair = vehicleId ? { ...repair, vehicleId } : repair;
      updates.repairs = cleanForFirestore([...repairs, finalRepair]);
    }
    if (Object.keys(updates).length > 0) transaction.update(ref, updates);
    return vehicleId;
  });
}

export async function removeClientVehicle(
  clientId: string,
  vehicle: Vehicle,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  await mutateClientDocument(clientId, (client) => {
    const vehicles = removeEntityIfUnchanged(client.vehicles ?? [], vehicle, "vehicle");
    const vehicleId = vehicle.id;
    return {
      vehicles,
      repairs: (client.repairs ?? []).filter((repair) => !vehicleId || repair.vehicleId !== vehicleId),
    };
  }, firestore);
}

export function addClientChamber(
  clientId: string,
  chamber: Chamber,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  return addClientArrayEntity(clientId, "chambers", chamber, firestore);
}

export function mutateClientChamber(
  clientId: string,
  chamber: Chamber,
  mutation: (current: Chamber) => Chamber,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  return updateClientArrayEntity(clientId, "chambers", chamber, mutation, firestore);
}

export async function removeClientChamber(
  clientId: string,
  chamber: Chamber,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  await mutateClientDocument(clientId, (client) => ({
    chambers: removeEntityIfUnchanged(client.chambers ?? [], chamber, "chamber"),
    repairs: (client.repairs ?? []).filter((repair) => !chamber.id || repair.chamberId !== chamber.id),
  }), firestore);
}

async function mutateServiceTaskDocument(
  taskId: string,
  mutation: (task: ServiceTask) => Partial<ServiceTask>,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  const ref = doc(firestore, "servicetasks", taskId);
  await runSafeTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new ConcurrentMutationError("Задача уже удалена");
    const task = { id: snapshot.id, ...snapshot.data() } as ServiceTask;
    const updates = cleanForFirestore(mutation(task)) as DocumentData;
    if (Object.keys(updates).length > 0) transaction.update(ref, updates);
  });
}

export function addServiceSubtask(
  taskId: string,
  subtask: Subtask,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  const id = requireNewEntityId(subtask, "subtask");
  return mutateServiceTaskDocument(taskId, (task) => {
    const subtasks = [...(task.subtasks ?? [])];
    if (subtasks.some((item) => item.id === id)) return {};
    return { subtasks: [...subtasks, subtask] };
  }, firestore);
}

export function mutateServiceSubtask(
  taskId: string,
  subtask: Subtask,
  mutation: (current: Subtask) => Subtask,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  return mutateServiceTaskDocument(taskId, (task) => {
    const subtasks = [...(task.subtasks ?? [])];
    const index = findEntityIndex(subtasks, subtask, "subtask");
    const current = subtasks[index];
    return { subtasks: subtasks.map((item, itemIndex) => itemIndex === index ? mutation(current) : item) };
  }, firestore);
}

export function removeServiceSubtask(
  taskId: string,
  subtask: Subtask,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  return mutateServiceTaskDocument(taskId, (task) => ({
    subtasks: removeEntityIfUnchanged(task.subtasks ?? [], subtask, "subtask"),
  }), firestore);
}

export function mutateStandaloneServiceTask(
  taskId: string,
  mutation: (current: ServiceTask) => Partial<ServiceTask>,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  return mutateServiceTaskDocument(taskId, mutation, firestore);
}

export async function endFreezerRental(
  freezerId: string,
  rentTo: string,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  const ref = doc(firestore, "freezers", freezerId);
  await runSafeTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new ConcurrentMutationError("Камера уже удалена");
    const freezer = { id: snapshot.id, ...snapshot.data() } as Freezer;
    const history: RentHistoryEntry = {
      tenant: freezer.tenant ?? "",
      rentFrom: freezer.rentFrom ?? "",
      rentTo,
      rentAmount: Number(freezer.rentAmount ?? 0),
      meterStart: freezer.meterStart ?? null,
      meterEnd: freezer.meterCurrent ?? null,
      ...(freezer.paidUntil ? { paidUntil: freezer.paidUntil } : {}),
    };
    transaction.update(ref, cleanForFirestore({
      rented: false,
      tenant: "",
      rentFrom: "",
      rentAmount: 0,
      meterStart: null,
      meterCurrent: null,
      paidUntil: "",
      status: "active",
      rentHistory: [...(freezer.rentHistory ?? []), history],
    }));
  });
}

interface FinancePurchase { id: string; [field: string]: unknown }

async function mutateFinance(
  mutation: (finance: Record<string, unknown>) => Record<string, unknown>,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  const ref = doc(firestore, "settings", "finance");
  await runSafeTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(ref);
    const finance = snapshot.exists() ? snapshot.data() : {};
    const updates = cleanForFirestore(mutation(finance));
    if (Object.keys(updates).length > 0) transaction.set(ref, updates, { merge: true });
  });
}

export function setFinanceMapValue(
  field: string,
  key: string,
  value: unknown,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  return mutateFinance((finance) => ({
    [field]: {
      ...((finance[field] as Record<string, unknown> | undefined) ?? {}),
      [key]: value,
    },
  }), firestore);
}

export function addFinancePurchase<T extends object & { id: string }>(
  purchase: T,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  requireNewEntityId(purchase, "purchase");
  return mutateFinance((finance) => {
    const purchases = (finance.purchases as T[] | undefined) ?? [];
    if (purchases.some((item) => item.id === purchase.id)) return {};
    return { purchases: [...purchases, purchase] };
  }, firestore);
}

export function removeFinancePurchase(
  purchaseId: string,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  return mutateFinance((finance) => {
    const purchases = (finance.purchases as FinancePurchase[] | undefined) ?? [];
    if (!purchases.some((item) => item.id === purchaseId)) {
      throw new ConcurrentMutationError("Закупка уже удалена");
    }
    return { purchases: purchases.filter((item) => item.id !== purchaseId) };
  }, firestore);
}

export function saveFinanceConfiguration(
  expected: Record<string, unknown>,
  updates: Record<string, unknown>,
  liveRentalIncome: number,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  const guardedFields = ["boxes", "salaries", "kwPrice"];
  return mutateFinance((current) => {
    for (const field of guardedFields) {
      if (canonicalEntityJson(current[field]) !== canonicalEntityJson(expected[field])) {
        throw new ConcurrentMutationError("Финансовые настройки уже изменены другим сотрудником");
      }
    }
    // Freeze the fixed costs that applied up to this change onto past months
    // so historical P&L is not rewritten by the new configuration.
    const priorSnapshot: FixedCosts = {
      boxCost: sumBoxCost(current.boxes as Parameters<typeof sumBoxCost>[0]),
      salCost: sumSalaries(current.salaries as Parameters<typeof sumSalaries>[0]),
      rentalIncome: liveRentalIncome,
    };
    const nowMk = new Date().toISOString().slice(0, 7);
    const fixedCostHistory = backfillFixedCostHistory(
      current.fixedCostHistory as Record<string, Partial<FixedCosts> | undefined> | undefined,
      priorSnapshot,
      nowMk,
    );
    return { ...updates, fixedCostHistory };
  }, firestore);
}

export async function restoreDocumentFromBackup(
  collectionName: string,
  documentId: string,
  backupData: Record<string, unknown>,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  const ref = doc(firestore, collectionName, documentId);
  const baselineSnapshot = await getDoc(ref);
  const baseline = baselineSnapshot.exists() ? baselineSnapshot.data() : null;

  await runSafeTransaction(firestore, async (transaction) => {
    const currentSnapshot = await transaction.get(ref);
    const current = currentSnapshot.exists() ? currentSnapshot.data() : null;
    if (canonicalEntityJson(current) !== canonicalEntityJson(baseline)) {
      throw new ConcurrentMutationError(
        `${collectionName}/${documentId}: документ изменён после начала восстановления`,
      );
    }
    transaction.set(ref, cleanForFirestore(backupData), { merge: true });
  });
}

export async function removeDocumentIfUnchanged<T extends object & { id: string }>(
  collectionName: string,
  target: T,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  const ref = doc(firestore, collectionName, target.id);
  await runSafeTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) {
      throw new ConcurrentMutationError(`${collectionName}/${target.id}: документ уже удалён`);
    }
    const current = { id: snapshot.id, ...snapshot.data() };
    if (canonicalEntityJson(current) !== canonicalEntityJson(target)) {
      throw new ConcurrentMutationError(
        `${collectionName}/${target.id}: документ изменён другим сотрудником`,
      );
    }
    transaction.delete(ref);
  });
}

export async function updateDocumentFieldsIfUnchanged<
  T extends object & { id: string },
>(
  collectionName: string,
  target: T,
  updates: Partial<T>,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  const ref = doc(firestore, collectionName, target.id);
  await runSafeTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) {
      throw new ConcurrentMutationError(`${collectionName}/${target.id}: документ уже удалён`);
    }
    const current = { id: snapshot.id, ...snapshot.data() } as T;
    assertFieldsUnchanged(
      current,
      target,
      Object.keys(updates) as (keyof T)[],
      `${collectionName}/${target.id}`,
    );
    const cleanUpdates = cleanForFirestore(updates) as DocumentData;
    if (Object.keys(cleanUpdates).length > 0) transaction.update(ref, cleanUpdates);
  });
}
