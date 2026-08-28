import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  type Firestore,
} from "firebase/firestore";
import {
  createAppointment,
  deleteAppointment,
  updateAppointment,
  type NewAppointment,
} from "../src/shared/firebase/appointments";
import {
  ConcurrentMutationError,
  restoreDocumentFromBackup,
} from "../src/shared/firebase/concurrency";
import { findExistingAppointmentClient } from "../src/shared/appointments/matching";
import { legacyAppointmentsForDisplay } from "../src/shared/appointments/legacy";
import {
  buildJsonBackupData,
  clientsFromBackup,
  standaloneAppointmentsFromBackup,
} from "../src/shared/backup/appointments";
import type { Appointment } from "../src/shared/types/appointment";
import type { Client } from "../src/shared/types/client";

const PROJECT_ID = "coolservice-crm-appointments-test";
const RULES_PATH = new URL("../../firestore.rules", import.meta.url);

let testEnv: RulesTestEnvironment;

function dbFor(uid: string): Firestore {
  return testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;
}

const baseAppointment: NewAppointment = {
  clientName: "Иван Петров",
  clientPhone: "+7 914 000-00-00",
  carBrand: "Toyota",
  carModel: "Corolla",
  carPlate: "А123ВС",
  date: "2026-08-29",
  time: "15:00",
  type: "diagnostics",
  assignees: ["mechanic-1"],
  assigneeNames: ["Механик"],
  status: "pending",
  note: "Диагностика",
  createdBy: "manager-1",
  createdByName: "Менеджер",
};

async function seedRole(uid: string, role: string): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `staff/${uid}`), { name: uid, role });
  });
}

async function seedClient(client: Client): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const { id, ...data } = client;
    await setDoc(doc(context.firestore(), `clients/${id}`), data);
  });
}

async function readAppointment(id: string, firestore = dbFor("manager-1")): Promise<Appointment> {
  const snapshot = await getDoc(doc(firestore, "appointments", id));
  assert.equal(snapshot.exists(), true);
  return { id: snapshot.id, ...snapshot.data() } as Appointment;
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: await readFile(RULES_PATH, "utf8") },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedRole("manager-1", "manager");
  await seedRole("manager-2", "manager");
  await seedRole("mechanic-1", "mechanic");
});

after(async () => {
  await testEnv?.cleanup();
});

describe("canonical appointment operations", () => {
  test("AppointmentsTab create writes one standalone document", async () => {
    const ref = await createAppointment(baseAppointment, dbFor("manager-1"));
    const result = await readAppointment(ref.id);
    assert.equal(result.clientName, baseAppointment.clientName);
    assert.equal((await getDocs(collection(dbFor("manager-1"), "appointments"))).size, 1);
  });

  test("calendar route create uses the same standalone collection", async () => {
    const ref = await createAppointment({ ...baseAppointment, time: "16:00" }, dbFor("manager-1"));
    assert.equal((await readAppointment(ref.id)).time, "16:00");
  });

  test("client-card create never adds client.appointments", async () => {
    const client: Client = {
      id: "client-1", name: "Иван Петров", vehicles: [], repairs: [],
    };
    await seedClient(client);
    await createAppointment({ ...baseAppointment, clientId: client.id }, dbFor("manager-1"));
    const clientSnapshot = await getDoc(doc(dbFor("manager-1"), "clients/client-1"));
    assert.equal("appointments" in (clientSnapshot.data() ?? {}), false);
  });

  test("voice create finds an existing client and writes exactly one appointment with clientId", async () => {
    const client: Client = {
      id: "client-1", name: "Иван Петров", phone: "+7 914 000-00-00",
      vehicles: [{ id: "vehicle-1", plate: "А123ВС", brand: "Toyota", model: "Corolla" }], repairs: [],
    };
    await seedClient(client);
    const existing = findExistingAppointmentClient([client], baseAppointment);
    assert.equal(existing?.id, client.id);
    await createAppointment({ ...baseAppointment, clientId: existing?.id }, dbFor("manager-1"));

    assert.equal((await getDocs(collection(dbFor("manager-1"), "appointments"))).size, 1);
    const clientSnapshot = await getDoc(doc(dbFor("manager-1"), "clients/client-1"));
    assert.equal("appointments" in (clientSnapshot.data() ?? {}), false);
  });

  test("unknown-client appointment works without clientId", async () => {
    const ref = await createAppointment({
      ...baseAppointment,
      clientName: "Новый клиент",
      clientPhone: undefined,
      clientId: undefined,
    }, dbFor("manager-1"));
    assert.equal((await readAppointment(ref.id)).clientId, undefined);
  });

  test("canonical onSnapshot sees an update made through the shared helper", async () => {
    const ref = await createAppointment(baseAppointment, dbFor("manager-1"));
    const target = await readAppointment(ref.id);
    const observed = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("onSnapshot timeout")), 5000);
      const unsubscribe = onSnapshot(doc(dbFor("manager-2"), "appointments", ref.id), (snapshot) => {
        if (snapshot.data()?.note === "Обновлено") {
          clearTimeout(timer);
          unsubscribe();
          resolve(snapshot.data()?.note as string);
        }
      }, reject);
    });
    await updateAppointment(target, { note: "Обновлено" }, dbFor("manager-1"));
    assert.equal(await observed, "Обновлено");
  });

  test("guarded delete removes the standalone document", async () => {
    const ref = await createAppointment(baseAppointment, dbFor("manager-1"));
    await deleteAppointment(await readAppointment(ref.id), dbFor("manager-1"));
    assert.equal((await getDoc(ref)).exists(), false);
  });

  test("manager can update assignees through the guarded helper", async () => {
    const ref = await createAppointment(baseAppointment, dbFor("manager-1"));
    const target = await readAppointment(ref.id);
    await updateAppointment(target, {
      assignees: ["mechanic-1", "manager-2"],
      assigneeNames: ["Механик", "Менеджер 2"],
    }, dbFor("manager-1"));
    assert.deepEqual((await readAppointment(ref.id)).assignees, ["mechanic-1", "manager-2"]);
  });

  test("same-field concurrent update produces one explicit conflict", async () => {
    const ref = await createAppointment(baseAppointment, dbFor("manager-1"));
    const target = await readAppointment(ref.id);
    const results = await Promise.allSettled([
      updateAppointment(target, { note: "Первый" }, dbFor("manager-1")),
      updateAppointment(target, { note: "Второй" }, dbFor("manager-2")),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.ok(results.some((result) =>
      result.status === "rejected" && result.reason instanceof ConcurrentMutationError));
  });

  test("concurrent updates of different fields merge safely", async () => {
    const ref = await createAppointment(baseAppointment, dbFor("manager-1"));
    const target = await readAppointment(ref.id);
    await Promise.all([
      updateAppointment(target, { note: "Новая заметка" }, dbFor("manager-1")),
      updateAppointment(target, { status: "closed" }, dbFor("manager-2")),
    ]);
    const result = await readAppointment(ref.id);
    assert.equal(result.note, "Новая заметка");
    assert.equal(result.status, "closed");
  });

  test("edit racing with guarded delete never resurrects a deleted appointment", async () => {
    const ref = await createAppointment(baseAppointment, dbFor("manager-1"));
    const target = await readAppointment(ref.id);
    const results = await Promise.allSettled([
      deleteAppointment(target, dbFor("manager-1")),
      updateAppointment(target, { note: "Позднее изменение" }, dbFor("manager-2")),
    ]);
    const snapshot = await getDoc(ref);
    if (results[0].status === "fulfilled") {
      assert.equal(snapshot.exists(), false);
    } else {
      assert.ok(results[0].reason instanceof ConcurrentMutationError);
      assert.equal(snapshot.data()?.note, "Позднее изменение");
    }
  });
});

describe("legacy and backup compatibility", () => {
  const client: Client = {
    id: "client-1", name: "Иван Петров",
    vehicles: [{ id: "vehicle-1", plate: "А123ВС", brand: "Toyota", model: "Corolla" }],
    repairs: [],
    appointments: [{
      id: "legacy-1", date: "2026-08-29T15:00:00", description: "Диагностика", vehicleId: "vehicle-1",
    }],
  };
  const canonical: Appointment = {
    id: "appointment-1", ...baseAppointment, clientId: client.id, createdAt: Timestamp.now(),
  };

  test("legacy-only client remains visible as read-only compatibility data", () => {
    assert.deepEqual(legacyAppointmentsForDisplay(client, []), client.appointments);
  });

  test("one unique exact standalone/legacy pair is not displayed twice", () => {
    assert.deepEqual(legacyAppointmentsForDisplay(client, [canonical]), []);
  });

  test("two identical standalone candidates make the match ambiguous", () => {
    assert.equal(legacyAppointmentsForDisplay(client, [
      canonical,
      { ...canonical, id: "appointment-2" },
    ]).length, 1);
  });

  test("two identical legacy records are never hidden", () => {
    const ambiguous = { ...client, appointments: [client.appointments![0], { ...client.appointments![0], id: "legacy-2" }] };
    assert.equal(legacyAppointmentsForDisplay(ambiguous, [canonical]).length, 2);
  });

  test("different vehicle never matches", () => {
    const differentCar = { ...canonical, carPlate: "В999ВВ", carBrand: "Nissan", carModel: "Note" };
    assert.equal(legacyAppointmentsForDisplay(client, [differentCar]).length, 1);
  });

  test("different local time never matches and no timezone conversion is applied", () => {
    assert.equal(legacyAppointmentsForDisplay(client, [{ ...canonical, time: "16:00" }]).length, 1);
    const offsetDateClient = {
      ...client,
      appointments: [{ ...client.appointments![0], date: "2026-08-29T15:00:00+10:00" }],
    };
    assert.equal(legacyAppointmentsForDisplay(offsetDateClient, [canonical]).length, 0);
    const separateTimeClient = {
      ...client,
      appointments: [{ ...client.appointments![0], date: "2026-08-29", time: "15:00" }],
    };
    assert.equal(legacyAppointmentsForDisplay(separateTimeClient, [canonical]).length, 0);
  });

  test("missing distinguishing fields never cause a dangerous match", () => {
    const sparseClient: Client = {
      id: client.id, name: client.name, vehicles: [], repairs: [],
      appointments: [{ id: "sparse", date: "2026-08-29T15:00:00" }],
    };
    const sparseCanonical = { ...canonical, note: undefined, carPlate: undefined, carBrand: undefined, carModel: undefined };
    assert.equal(legacyAppointmentsForDisplay(sparseClient, [sparseCanonical]).length, 1);
  });

  test("explicit standaloneAppointmentId hides only an existing exact ID link", () => {
    const linked = {
      ...client,
      appointments: [{ ...client.appointments![0], standaloneAppointmentId: canonical.id }],
    };
    const broken = {
      ...client,
      appointments: [{ ...client.appointments![0], standaloneAppointmentId: "missing" }],
    };
    assert.equal(legacyAppointmentsForDisplay(linked, [canonical]).length, 0);
    assert.equal(legacyAppointmentsForDisplay(broken, [canonical]).length, 1);
  });

  test("version 2 backup exports canonical appointments and decodes timestamps on import", () => {
    const backup = buildJsonBackupData({
      exportedBy: "admin@example.test", clients: [client], staff: [], servicetasks: [], freezers: [],
      appointments: [canonical], settings: { finance: {} },
    }, "2026-08-28T00:00:00.000Z");
    const parsed = JSON.parse(JSON.stringify(backup)) as Record<string, unknown>;
    const restored = standaloneAppointmentsFromBackup(parsed);
    assert.equal(backup.version, 2);
    assert.equal(restored.length, 1);
    assert.ok(restored[0].createdAt instanceof Timestamp);
    assert.equal((clientsFromBackup(parsed)[0].appointments as unknown[]).length, 1);
  });

  test("version 2 round-trip preserves standalone and legacy categories without conversion", () => {
    const backup = buildJsonBackupData({
      exportedBy: "admin@example.test", clients: [client], staff: [], servicetasks: [], freezers: [],
      appointments: [canonical], settings: { finance: {} },
    }, "2026-08-28T00:00:00.000Z");
    const parsed = JSON.parse(JSON.stringify(backup)) as Record<string, unknown>;
    const restoredClients = clientsFromBackup(parsed);
    const restoredStandalone = standaloneAppointmentsFromBackup(parsed);
    assert.equal((restoredClients[0].appointments as unknown[]).length, 1);
    assert.equal(restoredStandalone.length, 1);
    assert.equal(restoredStandalone[0].id, canonical.id);
    assert.equal(restoredClients[0].id, client.id);
  });

  test("version 2 restore round-trip writes one standalone and preserves the legacy archive", async () => {
    const backup = buildJsonBackupData({
      exportedBy: "admin@example.test", clients: [client], staff: [], servicetasks: [], freezers: [],
      appointments: [canonical], settings: { finance: {} },
    });
    const parsed = JSON.parse(JSON.stringify(backup)) as Record<string, unknown>;
    const [clientData] = clientsFromBackup(parsed);
    const [appointmentData] = standaloneAppointmentsFromBackup(parsed);
    const { id: clientId, ...clientFields } = clientData;
    const { id: appointmentId, ...appointmentFields } = appointmentData;
    await restoreDocumentFromBackup("clients", clientId as string, clientFields, dbFor("manager-1"));
    await restoreDocumentFromBackup("appointments", appointmentId as string, appointmentFields, dbFor("manager-1"));

    const restoredClient = await getDoc(doc(dbFor("manager-1"), `clients/${client.id}`));
    const standalone = await getDocs(collection(dbFor("manager-1"), "appointments"));
    assert.equal((restoredClient.data()?.appointments as unknown[]).length, 1);
    assert.equal(standalone.size, 1);
    assert.equal(standalone.docs[0].id, canonical.id);
  });

  test("version 1 backup without standalone appointments remains import-compatible", () => {
    const v1 = { version: 1, clients: [client] };
    assert.deepEqual(standaloneAppointmentsFromBackup(v1), []);
    assert.equal((clientsFromBackup(v1)[0].appointments as unknown[]).length, 1);
  });

  test("version 1 restore keeps embedded data legacy-only", async () => {
    const v1 = JSON.parse(JSON.stringify({ version: 1, clients: [client] })) as Record<string, unknown>;
    const [clientData] = clientsFromBackup(v1);
    const { id, ...fields } = clientData;
    await restoreDocumentFromBackup("clients", id as string, fields, dbFor("manager-1"));
    const restoredClient = await getDoc(doc(dbFor("manager-1"), `clients/${client.id}`));
    assert.equal((restoredClient.data()?.appointments as unknown[]).length, 1);
    assert.equal((await getDocs(collection(dbFor("manager-1"), "appointments"))).size, 0);
  });

  test("restore never clears an existing legacy archive with an empty or absent field", async () => {
    await seedClient(client);
    for (const source of [
      { id: client.id, name: "Обновлённое имя", vehicles: [], repairs: [], appointments: [] },
      { id: client.id, name: "Ещё одно имя", vehicles: [], repairs: [] },
    ]) {
      const [clientData] = clientsFromBackup({ version: 2, clients: [source], appointments: [] });
      const { id, ...fields } = clientData;
      await restoreDocumentFromBackup("clients", id as string, fields, dbFor("manager-1"));
      const restored = await getDoc(doc(dbFor("manager-1"), `clients/${client.id}`));
      assert.equal((restored.data()?.appointments as unknown[]).length, 1);
    }
  });

  test("client matching prefers a unique phone and rejects an ambiguous exact name", () => {
    const first = { ...client, id: "client-1", phone: "+7 914 000-00-01" };
    const second = { ...client, id: "client-2", phone: "+7 914 000-00-02" };
    assert.equal(findExistingAppointmentClient([first, second], {
      clientName: client.name,
      clientPhone: second.phone,
    })?.id, second.id);
    assert.equal(findExistingAppointmentClient([first, second], { clientName: client.name }), undefined);
  });
});
