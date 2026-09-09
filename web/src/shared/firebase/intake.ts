import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";
import { getFirebaseDb } from "./app";
import {
  ConcurrentMutationError,
  cleanForFirestore,
  findEntityIndex,
  runSafeTransaction,
} from "./concurrency";
import { genId } from "../utils/format";
import { normalizePlate, platesMatch } from "../utils/plate";
import { deletePhoto, deletePhotoObjects, repairPhotos } from "../utils/photos";
import {
  intakeKind,
  type IntakeChamber,
  type IntakeRepair,
  type IntakeServiceType,
  type IntakeVehicle,
} from "../types/intake";
import type { Chamber, Client, Repair, RepairTask, Vehicle } from "../types/client";

const COLLECTION = "intakeRepairs";

function intakeRef(firestore: Firestore, id: string) {
  return doc(firestore, COLLECTION, id);
}

interface Creator {
  creatorUid: string;
  creatorName: string;
  /** Assignees for the auto "Заправка фреона" task. Defaults to the creator. */
  assignees?: string[];
}

/** The embedded repair every intake starts with: one auto "Заправка фреона" task. */
function buildIntakeRepair(serviceType: Repair["serviceType"], creator: Creator, now: string): Repair {
  const assignees = creator.assignees?.length ? creator.assignees : [creator.creatorUid];
  const freonTask: RepairTask = {
    id: genId(),
    description: "Заправка фреона",
    assignees,
    doneBy: [],
    status: "in_progress",
    freonTask: true,
    createdBy: creator.creatorUid,
    createdByName: creator.creatorName,
    createdAt: now,
  };
  return {
    id: genId(),
    serviceType,
    date: now.slice(0, 10),
    status: "in_progress",
    tasks: [freonTask],
    photos: [],
    mechanics: assignees,
    createdBy: creator.creatorUid,
    createdByName: creator.creatorName,
    createdAt: now,
  };
}

// ─── Create ───────────────────────────────────────────────────────────────────

export interface NewVehicleIntakeInput extends Creator {
  plate: string;
  brand?: string;
  model?: string;
  photo?: string;
  photoPath?: string;
  serviceType: IntakeServiceType;
}

/** Opens a walk-in repair on a car that has no client yet. Returns the new doc id. */
export async function createIntakeRepair(
  input: NewVehicleIntakeInput,
  firestore: Firestore = getFirebaseDb(),
): Promise<string> {
  const id = genId();
  const now = new Date().toISOString();

  const vehicle: IntakeVehicle = {
    plate: input.plate.trim(),
    plateNormalized: normalizePlate(input.plate),
    serviceType: input.serviceType,
    ...(input.brand?.trim() ? { brand: input.brand.trim() } : {}),
    ...(input.model?.trim() ? { model: input.model.trim() } : {}),
    ...(input.photo ? { photo: input.photo } : {}),
    ...(input.photoPath ? { photoPath: input.photoPath } : {}),
  };

  const document: IntakeRepair = {
    id,
    kind: "vehicle",
    vehicle,
    repair: buildIntakeRepair(input.serviceType, input, now),
    createdBy: input.creatorUid,
    createdByName: input.creatorName,
    createdAt: now,
  };

  await setDoc(intakeRef(firestore, id), cleanForFirestore(document) as DocumentData);
  return id;
}

export interface NewChamberIntakeInput extends Creator {
  label: string;
  length?: number;
  width?: number;
  height?: number;
  wallThickness?: number;
  notes?: string;
  photo?: string;
  photoPath?: string;
}

function chamberFromInput(input: NewChamberIntakeInput): IntakeChamber {
  return {
    label: input.label.trim(),
    ...(input.length ? { length: input.length } : {}),
    ...(input.width ? { width: input.width } : {}),
    ...(input.height ? { height: input.height } : {}),
    ...(input.wallThickness ? { wallThickness: input.wallThickness } : {}),
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    ...(input.photo ? { photo: input.photo } : {}),
    ...(input.photoPath ? { photoPath: input.photoPath } : {}),
  };
}

/** Opens a walk-in repair on a production chamber that has no client yet. */
export async function createChamberIntake(
  input: NewChamberIntakeInput,
  firestore: Firestore = getFirebaseDb(),
): Promise<string> {
  const id = genId();
  const now = new Date().toISOString();

  const document: IntakeRepair = {
    id,
    kind: "chamber",
    chamber: chamberFromInput(input),
    repair: buildIntakeRepair("refrigerator", input, now),
    createdBy: input.creatorUid,
    createdByName: input.creatorName,
    createdAt: now,
  };

  await setDoc(intakeRef(firestore, id), cleanForFirestore(document) as DocumentData);
  return id;
}

// ─── Mutate ───────────────────────────────────────────────────────────────────

/** Transactional full-document update — `mutation` receives the fresh document. */
export async function mutateIntakeRepair(
  id: string,
  mutation: (current: IntakeRepair) => IntakeRepair,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  await runSafeTransaction(firestore, async (transaction) => {
    const ref = intakeRef(firestore, id);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) {
      throw new ConcurrentMutationError("Заявка в приёмке уже удалена или обработана");
    }
    const current = { id: snapshot.id, ...snapshot.data() } as IntakeRepair;
    const next = mutation(current);
    transaction.set(ref, cleanForFirestore(next) as DocumentData);
  });
}

/** Update the embedded repair (tasks, photos, freon…) and stamp `editedAt`. */
export function mutateIntakeRepairEmbedded(
  id: string,
  repairMutation: (repair: Repair) => Repair,
  editor: { uid: string; name: string },
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  return mutateIntakeRepair(id, (current) => ({
    ...current,
    repair: repairMutation(current.repair),
    editedBy: editor.uid,
    editedAt: new Date().toISOString(),
  }), firestore);
}

/** Update one task inside the embedded repair; `taskMutation` gets the fresh task. */
export function mutateIntakeRepairTask(
  id: string,
  task: RepairTask,
  taskMutation: (task: RepairTask) => RepairTask,
  editor: { uid: string; name: string },
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  return mutateIntakeRepairEmbedded(id, (repair) => {
    const tasks = [...(repair.tasks ?? [])];
    const index = findEntityIndex(tasks, task, "задача приёмки");
    return {
      ...repair,
      tasks: tasks.map((item, i) => (i === index ? taskMutation(item) : item)),
    };
  }, editor, firestore);
}

/** Append a task to the embedded repair. */
export function addIntakeRepairTask(
  id: string,
  task: RepairTask,
  editor: { uid: string; name: string },
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  return mutateIntakeRepairEmbedded(id, (repair) => {
    const tasks = repair.tasks ?? [];
    if (tasks.some((t) => t.id === task.id)) return repair;
    return { ...repair, tasks: [...tasks, task] };
  }, editor, firestore);
}

/** Remove a task from the embedded repair. */
export function removeIntakeRepairTask(
  id: string,
  task: RepairTask,
  editor: { uid: string; name: string },
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  return mutateIntakeRepairEmbedded(id, (repair) => {
    const tasks = [...(repair.tasks ?? [])];
    const index = findEntityIndex(tasks, task, "задача приёмки");
    return { ...repair, tasks: tasks.filter((_, i) => i !== index) };
  }, editor, firestore);
}

export interface IntakeVehiclePatch {
  plate?: string;
  brand?: string;
  model?: string;
  photo?: string;
  photoPath?: string;
  serviceType?: IntakeServiceType;
}

/** Edit the car description before it is assigned to a client. */
export function updateIntakeVehicle(
  id: string,
  patch: IntakeVehiclePatch,
  editor: { uid: string; name: string },
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  return mutateIntakeRepair(id, (current) => {
    const base = current.vehicle ?? { plate: "", plateNormalized: "", serviceType: "refrigerator" as IntakeServiceType };
    const vehicle: IntakeVehicle = { ...base };
    if (patch.plate !== undefined) {
      vehicle.plate = patch.plate.trim();
      vehicle.plateNormalized = normalizePlate(patch.plate);
    }
    if (patch.brand !== undefined) vehicle.brand = patch.brand.trim() || undefined;
    if (patch.model !== undefined) vehicle.model = patch.model.trim() || undefined;
    if (patch.photo !== undefined) vehicle.photo = patch.photo || undefined;
    if (patch.photoPath !== undefined) vehicle.photoPath = patch.photoPath || undefined;

    let repair = current.repair;
    if (patch.serviceType && patch.serviceType !== base.serviceType) {
      vehicle.serviceType = patch.serviceType;
      if (repair.serviceType === base.serviceType) {
        repair = { ...repair, serviceType: patch.serviceType };
      }
    }

    return { ...current, vehicle, repair, editedBy: editor.uid, editedAt: new Date().toISOString() };
  }, firestore);
}

export interface IntakeChamberPatch {
  label?: string;
  length?: number;
  width?: number;
  height?: number;
  wallThickness?: number;
  notes?: string;
  photo?: string;
  photoPath?: string;
}

/** Edit the chamber description before it is assigned to a client. */
export function updateIntakeChamber(
  id: string,
  patch: IntakeChamberPatch,
  editor: { uid: string; name: string },
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  return mutateIntakeRepair(id, (current) => {
    const chamber: IntakeChamber = { label: "", ...current.chamber };
    if (patch.label !== undefined) chamber.label = patch.label.trim();
    for (const key of ["length", "width", "height", "wallThickness"] as const) {
      if (patch[key] !== undefined) chamber[key] = patch[key] || undefined;
    }
    if (patch.notes !== undefined) chamber.notes = patch.notes.trim() || undefined;
    if (patch.photo !== undefined) chamber.photo = patch.photo || undefined;
    if (patch.photoPath !== undefined) chamber.photoPath = patch.photoPath || undefined;
    return { ...current, chamber, editedBy: editor.uid, editedAt: new Date().toISOString() };
  }, firestore);
}

// ─── Delete ───────────────────────────────────────────────────────────────────

/** Remove an intake repair (mistake / duplicate) and clean up its Storage files. */
export async function deleteIntakeRepair(
  intake: IntakeRepair,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  await runSafeTransaction(firestore, async (transaction) => {
    const ref = intakeRef(firestore, intake.id);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) return;
    transaction.delete(ref);
  });
  void deletePhotoObjects(repairPhotos(intake.repair));
  if (intake.vehicle?.photoPath) void deletePhoto(intake.vehicle.photoPath);
  if (intake.chamber?.photoPath) void deletePhoto(intake.chamber.photoPath);
}

// ─── Assign to a client (close) ───────────────────────────────────────────────

export interface NewClientData {
  name: string;
  clientType?: "phys" | "legal";
  phone?: string;
  inn?: string;
  contactPerson?: string;
  companyName?: string;
  legalAddress?: string;
  bankAccount?: string;
  note?: string;
}

export interface AssignIntakeTarget {
  /** Attach to an existing client, or create a new one. */
  client: { existingId: string } | { create: NewClientData };
  /** Attach to an existing car/chamber of the client, or create a new one from the intake. */
  equipment: { existingId: string } | { create: true };
  cost: string;
  closedBy: string;
  closedByName: string;
}

/**
 * Moves the intake repair into `clients/{id}.repairs[]` as a closed job and
 * deletes the intake document — all in one transaction. Creates the client
 * and/or the car/chamber when requested. Returns the client id.
 */
export async function assignIntakeRepairToClient(
  intake: IntakeRepair,
  target: AssignIntakeTarget,
  firestore: Firestore = getFirebaseDb(),
): Promise<{ clientId: string }> {
  const now = new Date().toISOString();
  const clientsCol = collection(firestore, "clients");
  const clientRef =
    "existingId" in target.client
      ? doc(clientsCol, target.client.existingId)
      : doc(clientsCol);

  await runSafeTransaction(firestore, async (transaction) => {
    // ---- reads first (Firestore requires all reads before writes) ----
    const intakeR = intakeRef(firestore, intake.id);
    const intakeSnap = await transaction.get(intakeR);
    if (!intakeSnap.exists()) {
      throw new ConcurrentMutationError("Заявка в приёмке уже обработана другим сотрудником");
    }
    const current = { id: intakeSnap.id, ...intakeSnap.data() } as IntakeRepair;
    if (current.repair.id !== intake.repair.id) {
      throw new ConcurrentMutationError("Ремонт в приёмке изменился — обновите страницу");
    }
    const kind = intakeKind(current);

    let existingClient: Client | null = null;
    if ("existingId" in target.client) {
      const clientSnap = await transaction.get(clientRef);
      if (!clientSnap.exists()) throw new ConcurrentMutationError("Выбранный клиент уже удалён");
      existingClient = { id: clientSnap.id, ...clientSnap.data() } as Client;
    }

    // ---- resolve the car / chamber ----
    const vehicles: Vehicle[] = [...(existingClient?.vehicles ?? [])];
    const chambers: Chamber[] = [...(existingClient?.chambers ?? [])];
    const movedRepair: Repair = {
      ...current.repair,
      cost: target.cost.trim(),
      status: "done",
      closedByManager: true,
      closedAt: now,
      editedBy: target.closedBy,
      editedAt: now,
    };

    if (kind === "chamber") {
      const c = current.chamber;
      let chamberId: string;
      if ("existingId" in target.equipment) {
        chamberId = target.equipment.existingId;
        if (!chambers.some((x) => x.id === chamberId)) {
          throw new ConcurrentMutationError("Выбранная камера не найдена у клиента");
        }
      } else {
        chamberId = genId();
        chambers.push({
          id: chamberId,
          ...(c?.label ? { notes: [c.label, c.notes].filter(Boolean).join(" — ") } : (c?.notes ? { notes: c.notes } : {})),
          ...(c?.length ? { length: c.length } : {}),
          ...(c?.width ? { width: c.width } : {}),
          ...(c?.height ? { height: c.height } : {}),
          ...(c?.wallThickness ? { wallThickness: c.wallThickness } : {}),
          ...(c?.photo ? { photo: c.photo } : {}),
        });
      }
      movedRepair.chamberId = chamberId;
    } else {
      const v = current.vehicle;
      let vehicleId: string;
      if ("existingId" in target.equipment) {
        vehicleId = target.equipment.existingId;
        if (!vehicles.some((x) => x.id === vehicleId)) {
          throw new ConcurrentMutationError("Выбранная машина не найдена у клиента");
        }
      } else {
        vehicleId = genId();
        vehicles.push({
          id: vehicleId,
          plate: v?.plate ?? "—",
          serviceType: v?.serviceType ?? "refrigerator",
          ...(v?.brand ? { brand: v.brand } : {}),
          ...(v?.model ? { model: v.model } : {}),
          ...(v?.photo ? { photo: v.photo } : {}),
        });
      }
      movedRepair.vehicleId = vehicleId;
    }

    // ---- writes ----
    if (existingClient) {
      transaction.update(clientRef, cleanForFirestore({
        vehicles,
        chambers,
        repairs: [...(existingClient.repairs ?? []), movedRepair],
      }) as DocumentData);
    } else {
      const data = (target.client as { create: NewClientData }).create;
      transaction.set(clientRef, cleanForFirestore({
        name: data.name.trim(),
        clientType: data.clientType ?? "phys",
        ...(data.phone?.trim() ? { phone: data.phone.trim() } : {}),
        ...(data.inn?.trim() ? { inn: data.inn.trim() } : {}),
        ...(data.contactPerson?.trim() ? { contactPerson: data.contactPerson.trim() } : {}),
        ...(data.companyName?.trim() ? { companyName: data.companyName.trim() } : {}),
        ...(data.legalAddress?.trim() ? { legalAddress: data.legalAddress.trim() } : {}),
        ...(data.bankAccount?.trim() ? { bankAccount: data.bankAccount.trim() } : {}),
        ...(data.note?.trim() ? { note: data.note.trim() } : {}),
        vehicles,
        chambers,
        repairs: [movedRepair],
        createdAt: serverTimestamp(),
      }) as DocumentData);
    }

    transaction.delete(intakeR);
  });

  return { clientId: clientRef.id };
}

// ─── Plate matching (close-time suggestion) ───────────────────────────────────

export interface PlateMatch {
  client: Client;
  vehicle: Vehicle;
}

/** Existing client vehicles whose plate matches the intake car (normalised). */
export function findPlateMatches(
  clients: readonly Client[],
  plate: string,
): PlateMatch[] {
  const normalized = normalizePlate(plate);
  if (!normalized) return [];
  const matches: PlateMatch[] = [];
  for (const client of clients) {
    for (const vehicle of client.vehicles ?? []) {
      if (platesMatch(vehicle.plate, plate)) matches.push({ client, vehicle });
    }
  }
  return matches;
}

// ─── One-off backfill helper (not wired to UI) ────────────────────────────────

/** Adds `plateNormalized` to any intake docs written before it existed. */
export async function backfillIntakePlateNormalized(
  firestore: Firestore = getFirebaseDb(),
): Promise<number> {
  const snap = await getDocs(collection(firestore, COLLECTION));
  let fixed = 0;
  for (const docSnap of snap.docs) {
    const data = docSnap.data() as IntakeRepair;
    const want = normalizePlate(data.vehicle?.plate);
    if (data.vehicle && data.vehicle.plateNormalized !== want) {
      await setDoc(docSnap.ref, { vehicle: { ...data.vehicle, plateNormalized: want } }, { merge: true });
      fixed += 1;
    }
  }
  return fixed;
}
