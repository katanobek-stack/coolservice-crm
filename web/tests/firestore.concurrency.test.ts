import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, type Firestore } from "firebase/firestore";
import {
  ConcurrentMutationError,
  addClientRepair,
  addClientRepairWithVehicle,
  addRepairTask,
  assertFieldsUnchanged,
  findEntityIndex,
  mutateClientRepair,
  mutateRepairTask,
  removeClientArrayEntity,
  removeClientRepair,
  removeEntity,
  removeEntityIfUnchanged,
  replaceEntity,
  updateClientArrayEntity,
} from "../src/shared/firebase/concurrency";
import type { Client, Repair, RepairTask } from "../src/shared/types/client";

const PROJECT_ID = "coolservice-crm-concurrency-test";
const RULES_PATH = new URL("../../firestore.rules", import.meta.url);

let testEnv: RulesTestEnvironment;

function dbFor(uid: string): Firestore {
  return testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;
}

function task(id: string, description = id): RepairTask {
  return {
    id,
    description,
    assignees: ["worker-a", "worker-b"],
    doneBy: [],
    status: "in_progress",
    photos: [],
  };
}

function repair(id: string, tasks: RepairTask[] = []): Repair {
  return {
    id,
    serviceType: "refrigerator",
    date: "2026-08-28",
    status: "in_progress",
    cost: "100",
    photos: [],
    tasks,
  };
}

async function seedClient(repairs: Repair[]): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const client: Omit<Client, "id"> = {
      name: "Concurrency Test",
      clientType: "phys",
      vehicles: [],
      appointments: [],
      repairs,
    };
    await setDoc(doc(context.firestore(), "clients/client-1"), client);
  });
}

async function currentRepairs(): Promise<Repair[]> {
  const snapshot = await getDoc(doc(dbFor("reader"), "clients/client-1"));
  return (snapshot.data()?.repairs ?? []) as Repair[];
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

describe("transactional client array mutations with two independent clients", () => {
  test("concurrent add repair preserves both repairs", async () => {
    const original = repair("repair-1");
    await seedClient([original]);

    await Promise.all([
      addClientRepair("client-1", repair("repair-2"), dbFor("worker-a")),
      addClientRepair("client-1", repair("repair-3"), dbFor("worker-b")),
    ]);

    assert.deepEqual((await currentRepairs()).map((item) => item.id).sort(), ["repair-1", "repair-2", "repair-3"]);
  });

  test("concurrent edits of different repairs preserve both changes", async () => {
    const first = repair("repair-1");
    const second = repair("repair-2");
    await seedClient([first, second]);

    await Promise.all([
      mutateClientRepair("client-1", first, (current) => ({ ...current, cost: "250" }), dbFor("worker-a")),
      mutateClientRepair("client-1", second, (current) => ({ ...current, description: "updated" }), dbFor("worker-b")),
    ]);

    const result = await currentRepairs();
    assert.equal(result.find((item) => item.id === first.id)?.cost, "250");
    assert.equal(result.find((item) => item.id === second.id)?.description, "updated");
  });

  test("concurrent add tasks preserves both tasks", async () => {
    const original = repair("repair-1", [task("task-1")]);
    await seedClient([original]);

    await Promise.all([
      addRepairTask("client-1", original, task("task-2"), dbFor("worker-a")),
      addRepairTask("client-1", original, task("task-3"), dbFor("worker-b")),
    ]);

    const tasks = (await currentRepairs())[0].tasks ?? [];
    assert.deepEqual(tasks.map((item) => item.id).sort(), ["task-1", "task-2", "task-3"]);
  });

  test("concurrent complete task and add task preserves both operations", async () => {
    const originalTask = task("task-1");
    const original = repair("repair-1", [originalTask]);
    await seedClient([original]);

    await Promise.all([
      mutateRepairTask("client-1", original, originalTask, (current) => ({
        ...current,
        doneBy: ["worker-a", "worker-b"],
        status: "done",
      }), dbFor("worker-a")),
      addRepairTask("client-1", original, task("task-2"), dbFor("worker-b")),
    ]);

    const tasks = (await currentRepairs())[0].tasks ?? [];
    assert.equal(tasks.find((item) => item.id === "task-1")?.status, "done");
    assert.ok(tasks.some((item) => item.id === "task-2"));
  });

  test("concurrent price update and photo append preserve both fields", async () => {
    const original = repair("repair-1");
    await seedClient([original]);

    await Promise.all([
      mutateClientRepair("client-1", original, (current) => ({ ...current, cost: "999" }), dbFor("worker-a")),
      mutateClientRepair("client-1", original, (current) => ({
        ...current,
        photos: [...(current.photos ?? []), { id: "photo-1", url: "https://example.test/photo.jpg" }],
      }), dbFor("worker-b")),
    ]);

    const result = (await currentRepairs())[0];
    assert.equal(result.cost, "999");
    assert.deepEqual(result.photos?.map((photo) => photo.id), ["photo-1"]);
  });

  test("concurrent close repair and edit another repair preserve both operations", async () => {
    const first = repair("repair-1");
    const second = repair("repair-2");
    await seedClient([first, second]);

    await Promise.all([
      mutateClientRepair("client-1", first, (current) => ({
        ...current,
        status: "done",
        closedByManager: true,
      }), dbFor("worker-a")),
      mutateClientRepair("client-1", second, (current) => ({ ...current, cost: "500" }), dbFor("worker-b")),
    ]);

    const result = await currentRepairs();
    assert.equal(result.find((item) => item.id === first.id)?.closedByManager, true);
    assert.equal(result.find((item) => item.id === second.id)?.cost, "500");
  });

  test("voice-style repair add and manual edit preserve both operations", async () => {
    const original = repair("repair-1");
    await seedClient([original]);

    await Promise.all([
      addClientRepair("client-1", repair("voice-repair"), dbFor("voice-user")),
      mutateClientRepair("client-1", original, (current) => ({
        ...current,
        description: "manual edit",
      }), dbFor("manual-user")),
    ]);

    const result = await currentRepairs();
    assert.ok(result.some((item) => item.id === "voice-repair"));
    assert.equal(result.find((item) => item.id === original.id)?.description, "manual edit");
  });

  test("same repair field conflict is explicit and the first update is preserved", async () => {
    const original = repair("repair-1");
    await seedClient([original]);

    const results = await Promise.allSettled([
      mutateClientRepair("client-1", original, (current) => {
        assertFieldsUnchanged(current, original, ["cost"], "repair");
        return { ...current, cost: "200" };
      }, dbFor("worker-a")),
      mutateClientRepair("client-1", original, (current) => {
        assertFieldsUnchanged(current, original, ["cost"], "repair");
        return { ...current, cost: "300" };
      }, dbFor("worker-b")),
    ]);

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    assert.ok(rejected.reason instanceof ConcurrentMutationError);
    assert.ok(["200", "300"].includes((await currentRepairs())[0].cost ?? ""));
  });

  test("same task field conflict never becomes silent last-write-wins", async () => {
    const originalTask = task("task-1");
    const original = repair("repair-1", [originalTask]);
    await seedClient([original]);

    const update = (comment: string, firestore: Firestore) =>
      mutateRepairTask("client-1", original, originalTask, (current) => {
        assertFieldsUnchanged(current, originalTask, ["workComment"], "task");
        return { ...current, workComment: comment };
      }, firestore);
    const results = await Promise.allSettled([
      update("worker-a", dbFor("worker-a")),
      update("worker-b", dbFor("worker-b")),
    ]);

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.ok(results.some((result) =>
      result.status === "rejected" && result.reason instanceof ConcurrentMutationError));
    const currentTask = (await currentRepairs())[0].tasks[0];
    assert.ok(["worker-a", "worker-b"].includes(currentTask.workComment ?? ""));
  });

  test("edit racing with delete cannot resurrect a repair", async () => {
    const original = repair("repair-1");
    await seedClient([original]);

    const results = await Promise.allSettled([
      removeClientRepair("client-1", original, dbFor("worker-a")),
      mutateClientRepair("client-1", original, (current) => ({
        ...current,
        description: "edited",
      }), dbFor("worker-b")),
    ]);
    const repairs = await currentRepairs();
    const deleteResult = results[0];

    if (deleteResult.status === "fulfilled") {
      assert.equal(repairs.some((item) => item.id === original.id), false);
    } else {
      assert.ok(deleteResult.reason instanceof ConcurrentMutationError);
      assert.equal(repairs.find((item) => item.id === original.id)?.description, "edited");
    }
  });

  test("concurrent legacy update/delete conflicts without touching a neighbor", async () => {
    const legacy = { serviceType: "refrigerator", status: "in_progress", tasks: [], description: "legacy" };
    const neighbor = repair("stable-neighbor");
    await seedClient([legacy as unknown as Repair, neighbor]);

    const results = await Promise.allSettled([
      updateClientArrayEntity("client-1", "repairs", legacy, (current) => ({
        ...current,
        description: "changed",
      }), dbFor("worker-a")),
      removeClientArrayEntity("client-1", "repairs", legacy, dbFor("worker-b")),
    ]);
    const repairs = await currentRepairs();

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.ok(results.some((result) =>
      result.status === "rejected" && result.reason instanceof ConcurrentMutationError));
    assert.ok(repairs.some((item) => item.id === neighbor.id));
  });

  test("transaction retry keeps pre-generated repair/task IDs and avoids duplicates", async () => {
    const original = repair("repair-1");
    const retryRepair = repair("stable-repair-id", [task("stable-task-id")]);
    await seedClient([original]);

    await Promise.all([
      addClientRepair("client-1", retryRepair, dbFor("worker-a")),
      addClientRepair("client-1", retryRepair, dbFor("worker-b")),
    ]);
    const repairs = await currentRepairs();
    assert.equal(repairs.filter((item) => item.id === retryRepair.id).length, 1);
    assert.equal(repairs.find((item) => item.id === retryRepair.id)?.tasks
      .filter((item) => item.id === "stable-task-id").length, 1);
  });

  test("atomic voice add does not duplicate vehicle or repair on retry", async () => {
    await seedClient([]);
    const voiceRepair = repair("voice-repair-id", [task("voice-task-id")]);
    const vehicle = { id: "voice-vehicle-id", plate: "A123BC" };

    await Promise.all([
      addClientRepairWithVehicle("client-1", voiceRepair, vehicle, undefined, dbFor("voice-a")),
      addClientRepairWithVehicle("client-1", voiceRepair, vehicle, undefined, dbFor("voice-b")),
    ]);
    const snapshot = await getDoc(doc(dbFor("reader"), "clients/client-1"));
    const data = snapshot.data() as Client;
    assert.equal(data.vehicles.filter((item) => item.id === vehicle.id).length, 1);
    assert.equal(data.repairs.filter((item) => item.id === voiceRepair.id).length, 1);
    assert.equal(data.repairs[0].tasks.filter((item) => item.id === "voice-task-id").length, 1);
  });
});

describe("entity addressing helpers", () => {
  test("finds, replaces, and removes by stable id without changing neighbors", () => {
    const items = [{ id: "a", value: 1 }, { id: "b", value: 2 }, { id: "c", value: 3 }];
    assert.equal(findEntityIndex(items, items[1], "item"), 1);
    assert.deepEqual(replaceEntity(items, items[1], { id: "b", value: 20 }, "item"), [
      items[0], { id: "b", value: 20 }, items[2],
    ]);
    assert.deepEqual(removeEntity(items, items[1], "item"), [items[0], items[2]]);
  });

  test("legacy element without id uses one exact snapshot match", () => {
    const legacy = { description: "legacy", status: "in_progress" };
    const items = [{ id: "a", description: "stable" }, legacy, { id: "c", description: "neighbor" }];
    assert.equal(findEntityIndex(items, { ...legacy }, "task"), 1);
    assert.deepEqual(replaceEntity(items, { ...legacy }, { ...legacy, status: "done" }, "task")[2], items[2]);
  });

  test("legacy changed, missing, or ambiguous snapshot fails explicitly", () => {
    assert.throws(
      () => findEntityIndex([{ description: "changed" }], { description: "stale" }, "task"),
      ConcurrentMutationError,
    );
    assert.throws(
      () => findEntityIndex([{ description: "same" }, { description: "same" }], { description: "same" }, "task"),
      ConcurrentMutationError,
    );
    assert.throws(
      () => removeEntityIfUnchanged([{ id: "task-1", status: "done" }], { id: "task-1", status: "in_progress" }, "task"),
      ConcurrentMutationError,
    );
  });
});
