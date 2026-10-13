/* Local UI fixture only: explicitly refuses production databases and Auth. */
const admin = require("firebase-admin");
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error("Both Firestore and Auth emulators are required");
}
admin.initializeApp({ projectId: "demo-coolservice-crm" });
async function main() {
  const db = admin.firestore();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Vladivostok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  for (const [uid, email, name, role] of [
    ["demo-ppz-manager", "ppz-manager@example.test", "Руководитель", "manager"],
    ["demo-ppz-worker", "ppz-worker@example.test", "Владимир", "mechanic"],
  ]) {
    try { await admin.auth().createUser({ uid, email, password: "DemoPPZ2026!", displayName: name }); }
    catch (err) { if (err.code !== "auth/uid-already-exists" && err.code !== "auth/email-already-exists") throw err; }
    await db.doc(`staff/${uid}`).set({ name, email, role });
  }
  const items = [
    { id: "clean", source: { kind: "service", documentId: "demo-ppz-clean" }, title: "Убрать бокс", order: 0, priority: "high", deadline: "17:00", note: "После завершения диагностики" },
    { id: "wood", source: { kind: "service", documentId: "demo-ppz-wood" }, title: "Нарубить дрова", order: 1, priority: "normal", deadline: "18:00", note: "Подготовить запас на завтра" },
  ];
  const plan = db.doc(`dailyPlans/demo-ppz-worker_${date}`);
  await plan.set({ staffId: "demo-ppz-worker", date, revision: 2, version: 1, status: "published", hasDraft: false, deliveryStatus: "sent" });
  for (const item of items) {
    await db.doc(`servicetasks/${item.source.documentId}`).set({ title: item.title, assignees: ["demo-ppz-worker"], doneBy: [], status: "in_progress", taskType: "task" });
    await plan.collection("items").doc(item.id).set(item);
    await plan.collection("draftItems").doc(item.id).set(item);
  }
  await db.doc("appointments/demo-ppz-visit").set({ clientName: "Тестовый клиент", carBrand: "Toyota", date, time: "10:00", type: "diagnostics", assignees: ["demo-ppz-worker"], assigneeNames: ["Владимир"], status: "pending", createdAt: admin.firestore.FieldValue.serverTimestamp(), createdBy: "demo-ppz-manager", createdByName: "Руководитель" });
  console.log("Local PPZ demo ready. Login: ppz-manager@example.test / ppz-worker@example.test. Password: DemoPPZ2026!");
  await admin.app().delete();
}
main().catch(err => { console.error(err.message); process.exitCode = 1; });
