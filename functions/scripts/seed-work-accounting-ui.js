const admin = require("firebase-admin");
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error("Local emulators required");
admin.initializeApp({ projectId: "demo-coolservice-crm" });
async function run() {
  for (const [uid, role, name, email] of [["demo-admin", "admin", "Сергей (пример)", "admin@example.test"], ["demo-worker", "mechanic", "Владимир (пример)", "worker@example.test"]]) {
    await admin.auth().createUser({ uid, email, password: "DemoPPZ2026!" });
    await admin.firestore().doc(`staff/${uid}`).set({ name, role, email });
  }
  const api = require("../lib/ppzTasks").savePpzTask;
  const call = (uid, data) => api.run({ auth: { uid, token: {} }, data });
  for (const [id, title] of [["demo-open", "Установить окна в малом боксе"], ["demo-done", "Подключить розетки в офисе"]]) {
    await call("demo-admin", { action: "create", id, title, assignees: ["demo-admin", "demo-worker"] });
    await call("demo-worker", { action: "start", id });
  }
  await call("demo-worker", { action: "report", id: "demo-done", report: "Проложил кабель и установил розетки.", reportRevision: 0 });
  await call("demo-admin", { action: "complete", id: "demo-done", report: "Подключил питание и проверил работу.", reportRevision: 0 });
  await require("../lib/workAccounting").recordWorkChanges({ eventId: "demo-reception", sourceKind: "intake", documentId: "car", sourcePath: "intakeRepairs/car", after: { vehicle: { plate: "А123АА125" }, repair: { id: "demo-repair", tasks: [] } }, authId: "demo-worker", occurredAt: admin.firestore.Timestamp.now() });
  console.log("Local work accounting UI fixture ready");
}
run().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>admin.app().delete());
