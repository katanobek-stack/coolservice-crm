import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, type Firestore } from "firebase/firestore";
import {
  createIntakeRepair,
  createChamberIntake,
  mutateIntakeRepairEmbedded,
  assignIntakeRepairToClient,
  deleteIntakeRepair,
  findPlateMatches,
} from "../src/shared/firebase/intake";
import { ConcurrentMutationError } from "../src/shared/firebase/concurrency";
import type { IntakeRepair } from "../src/shared/types/intake";
import type { Client, Repair, RepairTask } from "../src/shared/types/client";

const PROJECT_ID = "coolservice-crm-intake-test";
const RULES_PATH = new URL("../../firestore.rules", import.meta.url);

let testEnv: RulesTestEnvironment;

function dbFor(uid: string): Firestore {
  return testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;
}

const editor = { uid: "mech-1", name: "Механик Иван" };

async function readIntake(id: string): Promise<IntakeRepair | undefined> {
  const snap = await getDoc(doc(dbFor("reader"), "intakeRepairs", id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as IntakeRepair) : undefined;
}

async function newIntake(plate = "а123вс 77"): Promise<string> {
  return createIntakeRepair(
    { plate, brand: "Hyundai", model: "Porter", serviceType: "refrigerator", creatorUid: "mech-1", creatorName: "Механик Иван" },
    dbFor("mech-1"),
  );
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: await readFile(RULES_PATH, "utf8") },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

after(async () => {
  await testEnv?.cleanup();
});

describe("intakeRepairs rules", () => {
  test("unauthenticated cannot read or write", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "intakeRepairs/x")));
    await assertFails(setDoc(doc(db, "intakeRepairs/x"), { vehicle: {} }));
  });

  test("any authenticated worker can create, edit and delete", async () => {
    const db = dbFor("mech-1");
    await assertSucceeds(setDoc(doc(db, "intakeRepairs/x"), { vehicle: { plate: "A" }, repair: { id: "r", tasks: [] } }));
    await assertSucceeds(setDoc(doc(db, "intakeRepairs/x"), { vehicle: { plate: "B" }, repair: { id: "r", tasks: [] } }));
    await assertSucceeds(getDoc(doc(dbFor("mech-2"), "intakeRepairs/x")));
    await assertSucceeds(deleteDoc(doc(dbFor("mech-2"), "intakeRepairs/x")));
  });
});

describe("createIntakeRepair", () => {
  test("stores the car, a normalised plate and the auto freon task", async () => {
    const id = await newIntake("к 483 ер 61");
    const intake = await readIntake(id);
    assert.ok(intake);
    assert.equal(intake!.vehicle!.plate, "к 483 ер 61");
    assert.equal(intake!.vehicle!.plateNormalized, "K483EP61");
    assert.equal(intake!.vehicle!.serviceType, "refrigerator");
    const tasks = intake!.repair.tasks ?? [];
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].description, "Заправка фреона");
    assert.equal(tasks[0].freonTask, true);
    assert.deepEqual(tasks[0].assignees, ["mech-1"]);
  });
});

describe("mutateIntakeRepairEmbedded", () => {
  test("adds and removes repair tasks", async () => {
    const id = await newIntake();
    const extra: RepairTask = { id: "t2", description: "Замена ремня", assignees: ["mech-1"], doneBy: [], status: "in_progress" };
    await mutateIntakeRepairEmbedded(id, (r) => ({ ...r, tasks: [...(r.tasks ?? []), extra] }), editor, dbFor("mech-1"));
    assert.equal((await readIntake(id))!.repair.tasks!.length, 2);

    await mutateIntakeRepairEmbedded(id, (r) => ({ ...r, tasks: (r.tasks ?? []).filter((t) => t.id !== "t2") }), editor, dbFor("mech-1"));
    assert.equal((await readIntake(id))!.repair.tasks!.length, 1);
  });

  test("throws once the document is gone", async () => {
    const id = await newIntake();
    await deleteIntakeRepair((await readIntake(id))!, dbFor("mech-1"));
    await assert.rejects(
      mutateIntakeRepairEmbedded(id, (r) => r, editor, dbFor("mech-1")),
      ConcurrentMutationError,
    );
  });
});

describe("assignIntakeRepairToClient", () => {
  test("creates a new client with the car and the closed repair, deletes the intake", async () => {
    const id = await newIntake("О777ОО");
    const intake = (await readIntake(id))!;

    const { clientId } = await assignIntakeRepairToClient(
      intake,
      {
        client: { create: { name: "Иван Петров", clientType: "phys", phone: "+7 900 000-00-00" } },
        equipment: { create: true },
        cost: "15000",
        closedBy: "manager-1",
        closedByName: "Менеджер",
      },
      dbFor("manager-1"),
    );

    assert.equal(await readIntake(id), undefined);

    const clientSnap = await getDoc(doc(dbFor("reader"), "clients", clientId));
    const client = clientSnap.data() as Client;
    assert.equal(client.name, "Иван Петров");
    assert.equal(client.vehicles.length, 1);
    assert.equal(client.vehicles[0].plate, "О777ОО");
    assert.equal(client.repairs.length, 1);
    const moved = client.repairs[0] as Repair;
    assert.equal(moved.vehicleId, client.vehicles[0].id);
    assert.equal(moved.cost, "15000");
    assert.equal(moved.closedByManager, true);
    assert.ok(moved.closedAt);
  });

  test("attaches to an existing client and an existing vehicle", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "clients/c1"), {
        name: "ООО Ромашка", clientType: "legal",
        vehicles: [{ id: "v1", plate: "А111АА", serviceType: "refrigerator" }],
        repairs: [], chambers: [],
      });
    });

    const id = await newIntake("а111аа");
    const intake = (await readIntake(id))!;

    await assignIntakeRepairToClient(
      intake,
      { client: { existingId: "c1" }, equipment: { existingId: "v1" }, cost: "9000", closedBy: "manager-1", closedByName: "Менеджер" },
      dbFor("manager-1"),
    );

    const client = (await getDoc(doc(dbFor("reader"), "clients/c1"))).data() as Client;
    assert.equal(client.vehicles.length, 1);
    assert.equal(client.repairs.length, 1);
    assert.equal((client.repairs[0] as Repair).vehicleId, "v1");
    assert.equal(await readIntake(id), undefined);
  });

  test("a second concurrent assignment fails instead of double-booking", async () => {
    const id = await newIntake();
    const intake = (await readIntake(id))!;
    const target = {
      client: { create: { name: "Дубль" } },
      equipment: { create: true as const },
      cost: "1000",
      closedBy: "manager-1",
      closedByName: "Менеджер",
    };

    const results = await Promise.allSettled([
      assignIntakeRepairToClient(intake, target, dbFor("manager-1")),
      assignIntakeRepairToClient(intake, target, dbFor("manager-2")),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    assert.equal(ok.length, 1);
    assert.equal(await readIntake(id), undefined);
  });
});

describe("chamber intake", () => {
  test("createChamberIntake stores the chamber and the auto freon task", async () => {
    const id = await createChamberIntake(
      { label: "Магазин на Светланской", length: 3000, width: 2000, height: 2400, creatorUid: "mech-1", creatorName: "Механик" },
      dbFor("mech-1"),
    );
    const intake = (await readIntake(id))!;
    assert.equal(intake.kind, "chamber");
    assert.equal(intake.chamber?.label, "Магазин на Светланской");
    assert.equal(intake.chamber?.length, 3000);
    assert.equal(intake.vehicle, undefined);
    assert.equal((intake.repair.tasks ?? [])[0].description, "Заправка фреона");
  });

  test("assign creates a new chamber on a new client with the repair by chamberId", async () => {
    const id = await createChamberIntake(
      { label: "Кафе «Уют»", notes: "не морозит", creatorUid: "mech-1", creatorName: "Механик" },
      dbFor("mech-1"),
    );
    const intake = (await readIntake(id))!;

    const { clientId } = await assignIntakeRepairToClient(
      intake,
      {
        client: { create: { name: "ИП Сидоров" } },
        equipment: { create: true },
        cost: "8000", closedBy: "manager-1", closedByName: "Менеджер",
      },
      dbFor("manager-1"),
    );

    const client = (await getDoc(doc(dbFor("reader"), "clients", clientId))).data() as Client;
    assert.equal(client.chambers?.length, 1);
    assert.equal((client.vehicles ?? []).length, 0);
    assert.equal(client.repairs.length, 1);
    const moved = client.repairs[0] as Repair;
    assert.equal(moved.chamberId, client.chambers![0].id);
    assert.equal(moved.vehicleId, undefined);
    assert.equal(moved.closedByManager, true);
    assert.equal(await readIntake(id), undefined);
  });

  test("assign to an existing chamber of an existing client", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "clients/cc"), {
        name: "ООО Холод", clientType: "legal",
        vehicles: [], repairs: [], chambers: [{ id: "ch1", notes: "склад" }],
      });
    });
    const id = await createChamberIntake({ label: "склад", creatorUid: "mech-1", creatorName: "Механик" }, dbFor("mech-1"));
    const intake = (await readIntake(id))!;

    await assignIntakeRepairToClient(
      intake,
      { client: { existingId: "cc" }, equipment: { existingId: "ch1" }, cost: "5000", closedBy: "m", closedByName: "М" },
      dbFor("manager-1"),
    );

    const client = (await getDoc(doc(dbFor("reader"), "clients/cc"))).data() as Client;
    assert.equal(client.chambers!.length, 1);
    assert.equal(client.repairs.length, 1);
    assert.equal((client.repairs[0] as Repair).chamberId, "ch1");
  });
});

describe("findPlateMatches", () => {
  const clients: Client[] = [
    { id: "c1", name: "A", vehicles: [{ id: "v1", plate: "А123ВС77" }], repairs: [] } as unknown as Client,
    { id: "c2", name: "B", vehicles: [{ id: "v2", plate: "H777HH" }, { id: "v3", plate: "О000ОО" }], repairs: [] } as unknown as Client,
    { id: "c3", name: "C", repairs: [] } as unknown as Client,
  ];

  test("matches across scripts and formatting", () => {
    assert.deepEqual(findPlateMatches(clients, "a123bc 77").map((m) => m.client.id), ["c1"]);
    assert.deepEqual(findPlateMatches(clients, "Н777НН").map((m) => m.vehicle.id), ["v2"]);
  });

  test("no match and empty plate return nothing", () => {
    assert.deepEqual(findPlateMatches(clients, "X999XX"), []);
    assert.deepEqual(findPlateMatches(clients, ""), []);
  });
});
