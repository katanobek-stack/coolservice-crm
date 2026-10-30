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
  endFreezerRental,
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
  updateDocumentFieldsIfUnchanged,
} from "../src/shared/firebase/concurrency";
import type { Client, Repair, RepairTask } from "../src/shared/types/client";
import type { StaffMember } from "../src/shared/types/staff";

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

test("staff profile edit preserves concurrent email changes and rejects a stale name", async () => {
  const original: StaffMember = { id: 'staff-editor', name: 'Before', email: 'before@example.test', role: 'admin' };
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'staff/staff-editor'), { name: original.name, email: 'new@example.test', role: 'admin' });
  });
  await updateDocumentFieldsIfUnchanged('staff', original, { name: 'After' }, dbFor('staff-editor'));
  let saved = (await getDoc(doc(dbFor('staff-editor'), 'staff/staff-editor'))).data();
  assert.equal(saved?.email, 'new@example.test');
  assert.equal(saved?.name, 'After');
  await assert.rejects(updateDocumentFieldsIfUnchanged('staff', original, { name: 'Overwrite' }, dbFor('staff-editor')), ConcurrentMutationError);
  saved = (await getDoc(doc(dbFor('staff-editor'), 'staff/staff-editor'))).data();
  assert.equal(saved?.name, 'After');
});

test("owner saves permissions atomically and stale permission editors cannot undo them", async () => {
  const permissions = { dashboard_financials: true, reports_amounts: true, pl_panel: true };
  const original: StaffMember = { id: 'staff-admin', name: 'Admin', email: 'admin@example.test', role: 'admin', permissions };
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'staff/staff-owner'), { name: 'Owner', role: 'owner' });
    await setDoc(doc(context.firestore(), 'staff/staff-admin'), { name: original.name, email: original.email, role: original.role, permissions });
  });
  await updateDocumentFieldsIfUnchanged('staff', original, { permissions: { ...permissions, pl_panel: false } }, dbFor('staff-owner'));
  await assert.rejects(updateDocumentFieldsIfUnchanged('staff', original, { permissions: { ...permissions, reports_amounts: false } }, dbFor('staff-owner')), ConcurrentMutationError);
  const saved = (await getDoc(doc(dbFor('staff-owner'), 'staff/staff-admin'))).data();
  assert.deepEqual(saved?.permissions, { dashboard_financials: true, reports_amounts: true, pl_panel: false });
});

test("ending rental snapshots contact phone and clears it for the next tenant", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore() as unknown as Firestore;
    const ref = doc(db, "freezers/contact-test");
    await setDoc(ref, {
      name: "Demo", rented: true, status: "rented", tenant: "Demo tenant", tenantPhone: "+7 (000) 000-00-00",
      rentFrom: "2026-10-01", rentAmount: 100, meterStart: 10, meterCurrent: 15, rentHistory: [],
    });
    await endFreezerRental("contact-test", "2026-10-14", db);
    const result = (await getDoc(ref)).data()!;
    assert.equal(result.rented, false);
    assert.equal(result.tenant, "");
    assert.equal(result.tenantPhone, "");
    assert.equal(result.rentHistory.length, 1);
    assert.equal(result.rentHistory[0].tenant, "Demo tenant");
    assert.equal(result.rentHistory[0].tenantPhone, "+7 (000) 000-00-00");
    assert.equal(result.rentHistory[0].meterEnd, 15);
  });
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

// Reports closes through the same transactional array mutation used by the UI.
import {prepareRepairClose} from '../src/shared/firebase/repairClose';
test('reports close rejects a stale task review then atomically stores a fresh close',async()=>{
 const original=repair('report-close',[{...task('checked'),status:'done',doneBy:['worker-a','worker-b']}]);await seedClient([original]);
 await mutateRepairTask('client-1',original,original.tasks[0],t=>({...t,workComment:'Новые сведения'}),dbFor('worker-a'));
 await assert.rejects(mutateClientRepair('client-1',original,current=>prepareRepairClose(current,original,'1500','2026-10-27T01:00:00Z','manager'),dbFor('manager')),ConcurrentMutationError);
 const fresh=(await currentRepairs())[0];assert.equal(fresh.closedByManager,undefined);
 await mutateClientRepair('client-1',fresh,current=>prepareRepairClose(current,fresh,'1 500,50','2026-10-27T01:00:00Z','manager'),dbFor('manager'));
 const closed=(await currentRepairs())[0];assert.equal(closed.cost,'1500.50');assert.equal(closed.closedByManager,true);assert.equal(closed.tasks[0].workComment,'Новые сведения');assert.equal(closed.closedAt,'2026-10-27T01:00:00Z');
});

import {savePnlElectricity,addPnlCommission,removePnlPurchase} from '../src/shared/firebase/pnl';
async function pnlDb():Promise<Firestore>{await testEnv.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore(),'staff/pnl-manager'),{role:'manager'});});return dbFor('pnl-manager');}
test('P&L electricity rejects a stale bill and preserves other months on a fresh save',async()=>{const db=await pnlDb();const ref=doc(db,'settings/finance');await setDoc(ref,{elecBills:{'2026-09':30,'2026-10':100},boxes:[{id:'b',cost:500}]});await assert.rejects(savePnlElectricity('2026-10',80,50,db),ConcurrentMutationError);assert.equal((await getDoc(ref)).data()?.elecBills['2026-10'],100);await savePnlElectricity('2026-10',0,100,db);const f=(await getDoc(ref)).data()!;assert.equal(f.elecBills['2026-09'],30);assert.equal(f.elecBills['2026-10'],0);assert.equal(f.boxes[0].cost,500);});
test('P&L commission retry uses one id and rejects changed payload',async()=>{const db=await pnlDb();const e={id:'commission-once',category:'commission',month:'2026-10',amount:12.5,comment:'Демо',createdBy:'pnl-manager'};await addPnlCommission(e,db);await addPnlCommission(e,db);assert.equal((await getDoc(doc(db,'expenses/commission-once'))).data()?.amount,12.5);await assert.rejects(addPnlCommission({...e,amount:20},db),ConcurrentMutationError);});
test('P&L purchase deletion checks exact entry and preserves concurrent neighbors',async()=>{const db=await pnlDb();const ref=doc(db,'settings/finance');const p={id:'p',date:'2026-10-01',addedAt:'2026-10-01',amount:10,comment:'Фильтр'};await setDoc(ref,{purchases:[{...p,amount:15},{...p,id:'neighbor'}]});await assert.rejects(removePnlPurchase(p,db),ConcurrentMutationError);await removePnlPurchase({...p,amount:15},db);assert.deepEqual((await getDoc(ref)).data()?.purchases.map((x:{id:string})=>x.id),['neighbor']);});
test('P&L direct commission and bill writes stay denied to mechanics',async()=>{await pnlDb();const db=dbFor('pnl-mechanic');await assert.rejects(addPnlCommission({id:'denied',category:'commission',month:'2026-10',amount:10,comment:'Demo',createdBy:'pnl-mechanic'},db));await assert.rejects(savePnlElectricity('2026-10',10,undefined,db));});
import * as pnlWrites from '../src/shared/firebase/pnl';
test('P&L purchase uncertain retry with edited payload cannot create a second purchase',async()=>{const db=await pnlDb(),add=(pnlWrites as any).addPnlPurchase;assert.equal(typeof add,'function');const p={id:'purchase-once',date:'2026-10-01',addedAt:'2026-10-01',amount:10.25,comment:'Демо'};await add(p,db);await add(p,db);await assert.rejects(add({...p,comment:'Другое описание',amount:20},db),ConcurrentMutationError);const purchases=(await getDoc(doc(db,'settings/finance'))).data()?.purchases;assert.equal(purchases.length,1);assert.equal(purchases[0].amount,10.25);});
