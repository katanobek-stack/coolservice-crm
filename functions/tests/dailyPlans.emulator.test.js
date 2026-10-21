const { before, beforeEach, after, test } = require("node:test");
const assert = require("node:assert/strict");
const admin = require("firebase-admin");
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Firestore emulator required; never run against production");
process.env.TELEGRAM_BOT_TOKEN = "test-bot";
process.env.TELEGRAM_GROUP_CHAT_ID = "-100123";
const projectId = "demo-coolservice-crm";
admin.initializeApp({ projectId });
const db = admin.firestore();
const api = require("../lib/dailyPlans");
const originalFetch = global.fetch;
const planId = "worker_2026-10-13";
const planRef = () => db.doc(`dailyPlans/${planId}`);
const item = (id = "task-1") => ({ id, source: { kind: "service", documentId: id }, title: "Убрать бокс", deadline: "", priority: "normal", note: "" });
const request = (data, uid = "manager") => ({ data, auth: { uid, token: {} } });
const input = (revision, extra = {}) => ({ staffId: "worker", date: "2026-10-13", revision, ...extra });
async function save(items, revision = 0) { return api.saveDailyPlan.run(request(input(revision, { items }))); }
async function publish(revision = 1) { return api.publishDailyPlan.run(request(input(revision))); }
async function task(id = "task-1", extra = {}) { await db.doc(`servicetasks/${id}`).set({ title: id, assignees: ["worker"], doneBy: [], status: "in_progress", ...extra }); }
async function queue() { return (await db.collection("dailyPlanNotifications").get()).docs; }
before(async () => { await db.doc("staff/manager").set({ role: "manager", name: "Руководитель" }); });
beforeEach(async () => {
  global.fetch = originalFetch;
  process.env.TELEGRAM_GROUP_CHAT_ID = "-100123";
  for (const collection of ["dailyPlans", "dailyPlanNotifications", "servicetasks", "clients", "intakeRepairs", "staff", "workEvents"]) {
    const docs = await db.collection(collection).get();
    for (const doc of docs.docs) await db.recursiveDelete(doc.ref);
  }
  await db.doc("staff/manager").set({ role: "manager", name: "Руководитель" });
  await db.doc("staff/worker").set({ role: "mechanic", name: "Владимир" });
  await db.doc("staff/other").set({ role: "mechanic", name: "Другой" });
});
after(async () => { global.fetch = originalFetch; await admin.app().delete(); });

test("plan author and destination survive edits and self-assignment; personal marks are atomic and idempotent", async () => {
  await task(); await save([item()]);
  const created = (await planRef().get()).data();
  assert.equal(created.createdBy, "manager"); assert.equal(created.createdByName, "Руководитель"); assert.equal(created.staffName, "Владимир");
  await save([item()], 1); await publish(2);
  const updated = (await planRef().get()).data();
  assert.ok(updated.createdAt.isEqual(created.createdAt)); assert.equal(updated.publishedByName, "Руководитель");
  const publications = (await db.collection("workEvents").where("type", "==", "plan_published").get()).docs.map(d => d.data());
  assert.equal(publications.length, 1); assert.equal(publications[0].assigneeIds[0], "worker");
  assert.equal(publications[0].createdByName, "Руководитель"); assert.equal(publications[0].planItems[0].workKey, "service/task-1");
  const data = { planId, itemId: "task-1", done: true, comment: "" };
  await Promise.all([api.updateDailyPlanWork.run(request(data, "worker")), api.updateDailyPlanWork.run(request(data, "worker"))]);
  let events = (await db.collection("workEvents").get()).docs.map(d => d.data()).filter(e => e.type !== "plan_published");
  assert.equal(events.length, 1); assert.equal(events[0].selfReported, true); assert.equal(events[0].actorId, "worker"); assert.equal(events[0].type, "completed");
  await api.updateDailyPlanWork.run(request({ ...data, done: false }, "worker"));
  events = (await db.collection("workEvents").get()).docs.map(d => d.data()).filter(e => e.type !== "plan_published");
  assert.equal(events.length, 2); assert.ok(events.some(e => e.type === "completion_revoked"));
  await api.saveDailyPlan.run(request({ ...input(0), staffId: "manager", items: [] }));
  const self = (await db.doc("dailyPlans/manager_2026-10-13").get()).data();
  assert.equal(self.createdBy, self.staffId); assert.equal(self.createdByName, "Руководитель");
});

test("plan photos attach to the original task and employee history exactly once", async () => {
  await task(); await save([item()]); await publish();
  const path = `work-reports/worker/plan/${planId}/task-1/p1.jpg`;
  const photo = { id: "p1", path, url: `https://firebasestorage.googleapis.com/v0/b/${projectId}.firebasestorage.app/o/${encodeURIComponent(path)}?alt=media&token=demo` };
  const data = { planId, itemId: "task-1", done: true, comment: "", photos: [photo] };
  await assert.rejects(api.updateDailyPlanWork.run(request(data, "other")));
  await api.updateDailyPlanWork.run(request(data, "worker"));
  await api.updateDailyPlanWork.run(request(data, "worker"));
  const result = (await db.doc("servicetasks/task-1").get()).data();
  assert.deepEqual(result.photos, [photo]);
  const events = (await db.collection("workEvents").where("type", "==", "photo_added").get()).docs;
  assert.equal(events.length, 1); assert.equal(events[0].data().staffId, "worker");
  assert.deepEqual(events[0].data().photos, [photo]);
});

test("mechanics cannot author plans; saves validate existing assignees", async () => {
  await task();
  await assert.rejects(api.saveDailyPlan.run(request(input(0, { items: [item()] }), "worker")), { code: "permission-denied" });
  await db.doc("servicetasks/task-1").update({ assignees: ["other"] });
  await assert.rejects(save([item()]), { code: "failed-precondition" });
  assert.equal((await planRef().get()).exists, false);
});
test("draft saves are atomic and a concurrent manager cannot overwrite them", async () => {
  await task();
  const results = await Promise.allSettled([save([item()]), save([])]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected")[0].reason.code, "aborted");
});
test("new service work is created once and published items survive draft edits", async () => {
  await save([{ ...item(), newService: true }]);
  assert.deepEqual((await db.doc("servicetasks/task-1").get()).data().assignees, ["worker"]);
  await publish();
  await save([{ ...item(), newService: true, note: "Изменённый черновик" }], 2);
  assert.equal((await planRef().collection("items").doc("task-1").get()).data().note, "");
  assert.equal((await planRef().collection("draftItems").doc("task-1").get()).data().note, "Изменённый черновик");
  assert.equal((await db.collection("servicetasks").get()).size, 1);
});
test("publication validates sources again and duplicate publication queues once", async () => {
  await task(); await save([item()]);
  await db.doc("servicetasks/task-1").update({ assignees: ["other"] });
  await assert.rejects(publish(), { code: "failed-precondition" });
  assert.equal((await queue()).length, 0);
  await db.doc("servicetasks/task-1").update({ assignees: ["worker"] });
  await publish(); await publish(2);
  assert.equal((await queue()).length, 1);
});
test("completion touches only own share, preserves joint work and rejects another worker", async () => {
  await task("task-1", { assignees: ["worker", "other"] }); await save([item()]); await publish();
  const data = { planId, itemId: "task-1", done: true, comment: "Бокс готов" };
  await assert.rejects(api.updateDailyPlanWork.run(request(data, "other")), { code: "permission-denied" });
  await api.updateDailyPlanWork.run(request(data, "worker"));
  let current = (await db.doc("servicetasks/task-1").get()).data();
  assert.deepEqual(current.doneBy, ["worker"]); assert.equal(current.status, "in_progress");
  assert.match(current.workComment, /Владимир: Бокс готов/);
  await db.doc("servicetasks/task-1").update({ doneBy: ["worker", "other"], status: "done" });
  await api.updateDailyPlanWork.run(request({ ...data, done: false, comment: "" }, "worker"));
  current = (await db.doc("servicetasks/task-1").get()).data();
  assert.deepEqual(current.doneBy, ["other"]); assert.equal(current.status, "in_progress");
});
test("embedded repair and intake work preserve unrelated tasks", async () => {
  const repair = { id: "repair", tasks: [{ id: "a", description: "A", assignees: ["worker"], doneBy: [], status: "in_progress" }, { id: "b", description: "B", assignees: ["other"], doneBy: [], status: "in_progress" }] };
  await db.doc("clients/client").set({ repairs: [repair], name: "Клиент" });
  await db.doc("intakeRepairs/intake").set({ repair });
  await save([{ ...item("a"), source: { kind: "repair", documentId: "client", repairId: "repair", taskId: "a" } }, { ...item("intake-a"), source: { kind: "intake", documentId: "intake", taskId: "a" } }]);
  await publish();
  for (const itemId of ["a", "intake-a"]) await api.updateDailyPlanWork.run(request({ planId, itemId, done: true, comment: "" }, "worker"));
  const client = (await db.doc("clients/client").get()).data();
  const intake = (await db.doc("intakeRepairs/intake").get()).data();
  assert.equal(client.repairs[0].tasks[0].status, "done"); assert.equal(client.repairs[0].tasks[1].status, "in_progress");
  assert.equal(intake.repair.tasks[0].status, "done"); assert.equal(intake.repair.tasks[1].status, "in_progress");
});
test("comment-only updates do not reopen completed legacy tasks", async () => {
  await task("task-1", { status: "done", doneBy: [] }); await save([item()]); await publish();
  await api.updateDailyPlanWork.run(request({ planId, itemId: "task-1", comment: "Проверено" }, "worker"));
  const current = (await db.doc("servicetasks/task-1").get()).data();
  assert.equal(current.status, "done"); assert.deepEqual(current.doneBy, []);
});
test("a removed source cannot be completed and publication supports an empty day", async () => {
  await task(); await save([item()]); await publish(); await db.doc("servicetasks/task-1").delete();
  await assert.rejects(api.updateDailyPlanWork.run(request({ planId, itemId: "task-1", done: true, comment: "" }, "worker")), { code: "failed-precondition" });
  await save([], 2); await publish(3);
  assert.equal((await planRef().collection("items").get()).size, 0);
});
test("concurrent delivery attempts send once and record Telegram message id", async () => {
  await task(); await save([item()]); await publish();
  let calls = 0;
  global.fetch = async () => { calls++; return { json: async () => ({ ok: true, result: { message_id: 123 } }) }; };
  const id = (await queue())[0].id;
  await Promise.all([api.deliverDailyPlanNotification(id), api.deliverDailyPlanNotification(id)]);
  assert.equal(calls, 1); assert.equal((await db.doc(`dailyPlanNotifications/${id}`).get()).data().messageId, 123);
  assert.equal((await planRef().get()).data().deliveryStatus, "sent");
});
test("ambiguous sends require manager retry; explicit throttling is delayed", async () => {
  await task(); await save([item()]); await publish();
  const id = (await queue())[0].id;
  global.fetch = async () => { throw new Error("network"); };
  await api.deliverDailyPlanNotification(id);
  assert.equal((await planRef().get()).data().deliveryStatus, "unknown");
  let calls = 0;
  global.fetch = async () => { calls++; return { status: 429, json: async () => ({ ok: false, error_code: 429, parameters: { retry_after: 90 } }) }; };
  await api.deliverDailyPlanNotification(id); assert.equal(calls, 0);
  await assert.rejects(api.retryDailyPlanNotification.run(request({ planId }, "worker")), { code: "permission-denied" });
  await api.retryDailyPlanNotification.run(request({ planId }));
  await api.deliverDailyPlanNotification(id);
  const record = (await db.doc(`dailyPlanNotifications/${id}`).get()).data();
  assert.equal(record.status, "pending"); assert.ok(record.nextAttemptAt.toMillis() > Date.now() + 80000);
});
test("queued old revisions are superseded instead of arriving after a newer plan", async () => {
  await task(); await save([item()]); await publish();
  const old = (await queue())[0].id;
  await save([], 2); await publish(3);
  global.fetch = async () => { throw new Error("should not send"); };
  await api.deliverDailyPlanNotification(old);
  assert.equal((await db.doc(`dailyPlanNotifications/${old}`).get()).data().status, "superseded");
});
test("publication reuses existing CRM groups with independent delivery and no personal messages", async () => {
  process.env.TELEGRAM_GROUP_CHAT_ID = "-100123, -100456, -100123";
  process.env.TELEGRAM_CHAT_ID = "999999";
  await task(); await save([item()]); await publish();
  const messages = await queue();
  assert.equal(messages.length, 2);
  assert.deepEqual(messages.map(doc => doc.data().chatId).sort(), ["-100123", "-100456"]);
  global.fetch = async (_url, options) => {
    const chatId = JSON.parse(options.body).chat_id;
    return { json: async () => chatId === "-100123" ? { ok: true, result: { message_id: 1 } } : { ok: false, error_code: 403 } };
  };
  for (const message of messages) await api.deliverDailyPlanNotification(message.id);
  assert.deepEqual((await queue()).map(doc => doc.data().status).sort(), ["failed", "sent"]);
  assert.equal((await planRef().get()).data().deliveryStatus, "failed");
});
test("multi-part plans arrive in order and the scheduler recovers abandoned sends", async () => {
  const items = [];
  for (let i = 0; i < 10; i++) { await task(`task-${i}`); items.push({ ...item(`task-${i}`), note: "Подробности ".repeat(40) }); }
  await save(items); await publish();
  const messages = (await queue()).sort((a, b) => a.data().part - b.data().part);
  assert.ok(messages.length > 1);
  let calls = 0;
  global.fetch = async () => { calls++; return { json: async () => ({ ok: true, result: { message_id: calls } }) }; };
  await api.deliverDailyPlanNotification(messages[1].id); assert.equal(calls, 0);
  await api.deliverDailyPlanNotification(messages[0].id); assert.equal(calls, 1);
  await api.deliverDailyPlanNotification(messages[1].id); assert.equal(calls, 2);
  await messages[0].ref.update({ status: "sending", startedAt: admin.firestore.Timestamp.fromMillis(Date.now() - 10 * 60000) });
  await api.retryDailyPlanDeliveries.run({});
  assert.equal((await messages[0].ref.get()).data().status, "unknown");
  assert.equal((await planRef().get()).data().deliveryStatus, "unknown");
});
