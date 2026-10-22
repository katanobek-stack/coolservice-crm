const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const admin = require("firebase-admin");
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Firestore emulator required");
admin.initializeApp({ projectId: "demo-ppz-tasks" });
const db = admin.firestore();
const api = require("../lib/ppzTasks").savePpzTask;
const request = (action, uid = "admin", extra = {}) => ({ auth: { uid, token: {} }, data: { action, id: "shared", ...extra } });
const create = (extra = {}) => api.run(request("create", "admin", { title: "Общая работа", assignees: ["a", "b"], ...extra }));
const photo = (uid = "a", id = "p1") => { const path = `work-reports/${uid}/ppz/shared/${id}.jpg`; return { id, path, url: `https://firebasestorage.googleapis.com/v0/b/demo-ppz-tasks.firebasestorage.app/o/${encodeURIComponent(path)}?alt=media&token=demo` }; };
beforeEach(async () => {
  for (const c of ["staff", "ppzTasks", "workEvents"]) for (const d of (await db.collection(c).get()).docs) await db.recursiveDelete(d.ref);
  for (const [id, role] of [["admin", "admin"], ["owner", "owner"], ["manager", "manager"], ["a", "mechanic"], ["b", "mechanic"]]) await db.doc(`staff/${id}`).set({ role, name: id });
});
after(() => admin.app().delete());

test("admin and owner attach task photos without assignment, completion or rewriting author/assignees", async () => {
  await create();
  const original = (await db.doc("ppzTasks/shared").get()).data();
  for (const uid of ["admin", "owner"]) await api.run(request("attach_photos", uid, {
    requestId: `photo-${uid}`, photos: [photo(uid, `p-${uid}`)], actorId: "a", actorName: "Подмена", status: "done", assignees: [uid],
  }));
  const saved = (await db.doc("ppzTasks/shared").get()).data();
  const { photoAttachments, ...unchanged } = saved;
  assert.deepEqual(unchanged, original);
  assert.equal(Object.keys(photoAttachments).length, 2);
  for (const uid of ["admin", "owner"]) {
    const batch = Object.values(photoAttachments).find(batch => batch.actorId === uid);
    assert.equal(batch.actorName, uid); assert.ok(batch.createdAt.toMillis() > 0);
    assert.deepEqual(batch.photos, [photo(uid, `p-${uid}`)]);
  }
  const events = (await db.collection("workEvents").get()).docs.map(d => d.data());
  assert.equal(events.filter(e => e.type === "completed" || e.type === "task_closed").length, 0);
  const additions = events.filter(e => e.type === "photo_added");
  assert.equal(additions.length, 2); assert.ok(additions.every(e => !e.selfReported && e.visibleTo.includes("a") && e.visibleTo.includes(e.actorId)));
});

test("photo attachment retries, changed request IDs and a closed task preserve all personal reports", async () => {
  await create();
  await api.run(request("complete", "a", { report: "Выполнил", reportRevision: 0 }));
  const original = (await db.doc("ppzTasks/shared").get()).data();
  const data = { requestId: "admin-attachment", photos: [photo("admin", "p-admin")] };
  await Promise.all([api.run(request("attach_photos", "admin", data)), api.run(request("attach_photos", "admin", data))]);
  await api.run(request("attach_photos", "admin", { ...data, requestId: "new-request-same-photos" }));
  await assert.rejects(api.run(request("attach_photos", "admin", { ...data, photos: [photo("admin", "other")] })), { code: "already-exists" });
  const { photoAttachments, ...saved } = (await db.doc("ppzTasks/shared").get()).data();
  assert.deepEqual(saved, original); assert.equal(Object.keys(photoAttachments).length, 1);
  assert.equal((await db.collection("workEvents").where("type", "==", "photo_added").get()).size, 1);
  assert.equal((await db.collection("workEvents").where("type", "==", "completed").get()).size, 1);
});

test("task-photo action never grants manager/mechanic new rights and rejects foreign paths or empty uploads", async () => {
  await create();
  for (const uid of ["manager", "a", "b"]) await assert.rejects(api.run(request("attach_photos", uid, { photos: [photo(uid)] })), { code: "permission-denied" });
  await assert.rejects(api.run({ data: { action: "attach_photos", id: "shared" } }), { code: "unauthenticated" });
  await assert.rejects(api.run(request("attach_photos", "admin", { photos: [photo("a")] })), { code: "invalid-argument" });
  await assert.rejects(api.run(request("attach_photos", "admin", { photos: [] })), { code: "invalid-argument" });
  assert.equal((await db.doc("ppzTasks/shared").get()).data().photoAttachments, undefined);
});

test("shared task photos keep the existing 60-photo bound across all batches", async () => {
  await create();
  await db.doc("ppzTasks/shared").update({ photoAttachments: { seed: { actorId: "admin", actorName: "admin", createdAt: admin.firestore.Timestamp.now(), photos: Array.from({ length: 60 }, (_, i) => photo("admin", `seed-${i}`)) } } });
  await assert.rejects(api.run(request("attach_photos", "admin", { photos: [photo("admin", "extra")] })), { code: "resource-exhausted" });
  assert.equal((await db.collection("workEvents").where("type", "==", "photo_added").get()).size, 0);
});

test("creation attribution and assignment snapshots come from auth and staff, including self-assignment", async () => {
  await create({ assignees: ["admin", "a"], createdBy: "forged", createdByName: "Подмена", assigneeNames: { a: "Подмена" } });
  const first = (await db.doc("ppzTasks/shared").get()).data();
  assert.equal(first.createdBy, "admin"); assert.equal(first.createdByName, "admin");
  assert.deepEqual(first.assigneeNames, { admin: "admin", a: "a" }); assert.ok(first.createdAt.toMillis() > 0);
  await db.doc("staff/admin").update({ name: "Новое имя" });
  await api.run(request("report", "admin", { report: "Выполнил сам", reportRevision: 0, requestId: "self-report" }));
  await api.run(request("report", "admin", { report: "Выполнил сам", reportRevision: 0, requestId: "self-report" }));
  const history = (await db.collection("workEvents").get()).docs.map(d => d.data());
  assert.equal(history.length, 2);
  assert.ok(history.every(e => e.createdBy === "admin" && e.createdByName === "admin" && e.createdAt.isEqual(first.createdAt)));
  assert.ok(history.every(e => e.assigneeIds.includes("admin") && e.assigneeNames.a === "a"));
  assert.equal(history.filter(e => e.type === "completed").length, 1);
});
test("only administrators create; all assignees must exist; no deadline is stored", async () => {
  for (const uid of ["a", "manager"]) await assert.rejects(api.run(request("create", uid)), { code: "permission-denied" });
  await assert.rejects(create({ assignees: ["missing"] }), { code: "not-found" });
  await assert.rejects(create({ assignees: [] }), { code: "invalid-argument" });
  assert.equal((await db.doc("ppzTasks/shared").get()).exists, false);
  await create();
  const data = (await db.doc("ppzTasks/shared").get()).data();
  assert.deepEqual(data.assignees, ["a", "b"]);
  assert.equal(data.deadline, undefined);
  await assert.rejects(create(), { code: "already-exists" });
});
test("unassigned users cannot change work; first completion wins for everyone", async () => {
  await create();
  await assert.rejects(api.run(request("start", "admin")), { code: "permission-denied" });
  await api.run(request("start", "a"));
  assert.equal((await db.doc("ppzTasks/shared").get()).data().status, "in_progress");
  await Promise.all([api.run(request("complete", "a", { report: "Мой результат A", reportRevision: 0 })), api.run(request("complete", "b", { report: "Мой результат B", reportRevision: 0 }))]);
  const done = (await db.doc("ppzTasks/shared").get()).data();
  assert.equal(done.status, "done");
  assert.ok(["a", "b"].includes(done.completedBy));
  assert.equal(done.completedByName, done.completedBy);
  assert.ok(done.completedAt.toMillis() > 0);
  assert.equal(Object.keys(done.participants).length, 2);
  assert.equal((await db.collection("workEvents").where("type", "==", "task_closed").get()).size, 1);
  await api.run(request("complete", done.completedBy === "a" ? "b" : "a"));
  await api.run(request("start", "a"));
  assert.deepEqual((await db.doc("ppzTasks/shared").get()).data(), done);
});

test("each worker can start and report; shared closure never credits silent assignees", async () => {
  await create();
  await Promise.all([api.run(request("start", "a")), api.run(request("start", "b"))]);
  await assert.rejects(api.run(request("complete", "a", { reportRevision: 0 })), { code: "failed-precondition" });
  await api.run(request("complete", "a", { report: "Собрал раму", reportRevision: 0 }));
  let task = (await db.doc("ppzTasks/shared").get()).data();
  assert.ok(task.participants.a.reportedAt);
  assert.equal(task.participants.b.reportedAt, undefined);
  await api.run(request("report", "b", { report: "Подключил проводку", reportRevision: 0 }));
  task = (await db.doc("ppzTasks/shared").get()).data();
  assert.equal(task.completedBy, "a");
  assert.ok(task.participants.b.reportedAt);
  await assert.rejects(api.run(request("report", "admin", { report: "Чужой результат", reportRevision: 0 })), { code: "permission-denied" });
});

test("report retries are idempotent, stale edits fail and prior report text survives", async () => {
  await create();
  const payload = { report: "Первый результат", reportRevision: 0, requestId: "report-one" };
  await Promise.all([api.run(request("report", "a", payload)), api.run(request("report", "a", payload))]);
  assert.equal((await db.doc("ppzTasks/shared").get()).data().participants.a.revision, 1);
  await assert.rejects(api.run(request("report", "a", { ...payload, report: "Изменённый повтор" })), { code: "already-exists" });
  await assert.rejects(api.run(request("report", "a", { ...payload, requestId: "stale" })), { code: "aborted" });
  await api.run(request("report", "a", { report: "Уточнённый результат", reportRevision: 1, requestId: "report-two" }));
  const history = (await db.collection("workEvents").where("staffId", "==", "a").get()).docs.map(d => d.data());
  assert.equal(history.filter(e => e.type === "completed").length, 1);
  assert.ok(history.some(e => e.text === "Первый результат"));
  assert.ok(history.some(e => e.type === "report_updated" && e.text === "Уточнённый результат"));
});

test("legacy browser closure remains compatible without inventing personal completion", async () => {
  await create();
  await api.run(request("complete", "a"));
  assert.equal((await db.doc("ppzTasks/shared").get()).data().status, "done");
  assert.equal((await db.collection("workEvents").where("type", "==", "completed").get()).size, 0);
  assert.equal((await db.collection("workEvents").where("type", "==", "task_closed").get()).size, 1);
});

test("photo report survives retries, closure and text-only edits without crediting other assignees", async () => {
  await create();
  const data = { report: "Собрал корпус", reportRevision: 0, photos: [photo()], requestId: "photo-report" };
  await Promise.all([api.run(request("complete", "a", data)), api.run(request("complete", "a", data))]);
  let task = (await db.doc("ppzTasks/shared").get()).data();
  assert.deepEqual(task.participants.a.photos, [photo()]);
  assert.equal(task.participants.b, undefined);
  assert.equal((await db.collection("workEvents").where("type", "==", "completed").get()).size, 1);
  const first = (await db.collection("workEvents").where("type", "==", "completed").get()).docs[0].data();
  assert.deepEqual(first.photos, [photo()]); assert.equal(first.staffId, "a");
  await assert.rejects(api.run(request("complete", "a", { ...data, photos: [photo("a", "different")] })), { code: "already-exists" });
  await api.run(request("report", "a", { report: "Уточнил результат", reportRevision: 1, requestId: "text-edit" }));
  await api.run(request("report", "a", { report: "", photos: [photo("a", "p2")], reportRevision: 2, requestId: "more-photos" }));
  task = (await db.doc("ppzTasks/shared").get()).data();
  assert.equal(task.participants.a.photos.length, 2);
  assert.deepEqual(first.photos, [photo()]); // Immutable old event snapshot.
  assert.equal((await db.collection("workEvents").where("type", "==", "completed").get()).size, 1);
});

test("cross-employee photos and unassigned uploads are rejected without writes", async () => {
  await create();
  await assert.rejects(api.run(request("report", "a", { report: "X", photos: [photo("b")], reportRevision: 0 })), { code: "invalid-argument" });
  await assert.rejects(api.run(request("report", "admin", { report: "X", photos: [photo("admin")], reportRevision: 0 })), { code: "permission-denied" });
  assert.equal((await db.doc("ppzTasks/shared").get()).data().participants, undefined);
});
