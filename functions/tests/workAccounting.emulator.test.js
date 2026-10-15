const { beforeEach, after, test } = require("node:test");
const assert = require("node:assert/strict");
const admin = require("firebase-admin");
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Firestore emulator required");
admin.initializeApp({ projectId: "demo-work-accounting" });
const db = admin.firestore();
const { recordWorkChanges } = require("../lib/workAccounting");
beforeEach(async () => {
  for (const c of ["staff", "workEvents"]) for (const d of (await db.collection(c).get()).docs) await d.ref.delete();
  await db.doc("staff/a").set({ name: "А", role: "mechanic" });
  await db.doc("staff/admin").set({ name: "Руководитель", role: "admin" });
});
after(() => admin.app().delete());
const task = extra => ({ title: "Работа", assignees: ["a"], status: "in_progress", doneBy: [], ...extra });
const input = extra => ({ eventId: "event", sourceKind: "service", documentId: "s", sourcePath: "servicetasks/s", before: task(), after: task({ doneBy: ["a"], status: "done" }), occurredAt: admin.firestore.Timestamp.fromMillis(1000), authId: "a", ...extra });
test("duplicate trigger delivery cannot duplicate history, source time and actor survive", async () => {
  await Promise.all([recordWorkChanges(input()), recordWorkChanges(input())]);
  const events = (await db.collection("workEvents").get()).docs.map(d => d.data());
  assert.equal(events.length, 2);
  const completion = events.find(e => e.type === "completed");
  assert.equal(completion.selfReported, true);
  assert.equal(completion.actorId, "a");
  assert.equal(completion.occurredAt.toMillis(), 1000);
  await recordWorkChanges(input({ eventId: "earlier", before: task({ doneBy: ["a"], status: "done" }), after: task(), occurredAt: admin.firestore.Timestamp.fromMillis(500) }));
  assert.equal((await db.collection("workEvents").get()).size, 4);
});
test("a manager or system marking another worker is not their personal action", async () => {
  for (const [eventId, authId] of [["manager", "admin"], ["system", undefined]]) await recordWorkChanges(input({ eventId, authId }));
  const events = (await db.collection("workEvents").where("type", "==", "completed").get()).docs.map(d => d.data());
  assert.equal(events.length, 2);
  assert.ok(events.every(e => e.staffId === "a" && !e.selfReported));
  assert.ok(events.some(e => e.actorId === null));
});
