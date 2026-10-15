// Create-only import. Existing documents are never overwritten, even on retry.
const fs = require("node:fs");
const admin = require("firebase-admin");
const args = process.argv.slice(2);
const file = args[0];
const execute = args.includes("--execute");
if (!file) throw new Error("Usage: node import-ppz-tasks.js manifest.json [--execute --project=coolservice-crm]");
const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
if (manifest.projectId !== "coolservice-crm" || (execute && !args.includes("--project=coolservice-crm"))) throw new Error("Explicit CRM project required");
if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Production import must not target an emulator");
admin.initializeApp({ projectId: manifest.projectId });
const db = admin.firestore();
async function run() {
  const staff = (await db.collection("staff").get()).docs;
  const byId = new Map(staff.map(d => [d.id, d.data()]));
  const creator = manifest.nameMapping["Егор"];
  if (byId.get(creator)?.role !== "owner") throw new Error("Expected owner profile missing");
  const ids = new Set();
  const documents = manifest.tasks.map(t => {
    if (!/^[\w-]{1,128}$/.test(t.id) || ids.has(t.id) || !t.title?.trim() || t.title.length > 200 || !t.assignees?.length) throw new Error("Invalid import row");
    ids.add(t.id);
    const assignees = [...new Set(t.assignees.map(name => {
      const id = manifest.nameMapping[name];
      const expected = name === "Владимир" ? "Вова" : name;
      if (!id || byId.get(id)?.name !== expected) throw new Error(`Staff mapping mismatch: ${name}`);
      return id;
    }))];
    return { id: t.id, title: t.title, assignees, status: "open", description: t.description || "",
      source: { system: "clickup", taskId: t.taskId, ...(t.commentId ? { commentId: t.commentId } : {}), url: `https://app.clickup.com/t/${t.taskId}` },
      meetingDate: manifest.meetingDate, createdBy: creator, importedBy: "codex-clickup-import", createdAt: admin.firestore.FieldValue.serverTimestamp() };
  });
  const report = await db.runTransaction(async tx => {
    const refs = documents.map(t => db.doc(`ppzTasks/${t.id}`));
    const old = await tx.getAll(...refs);
    for (let i = 0; i < old.length; i++) {
      if (old[i].exists) {
        const existing = old[i].data();
        if (existing.source?.taskId !== documents[i].source.taskId || existing.title !== documents[i].title
          || JSON.stringify(existing.assignees) !== JSON.stringify(documents[i].assignees)) throw new Error(`Existing task differs: ${old[i].id}`);
      }
    }
    const created = [], existing = [];
    documents.forEach(({ id, ...data }, i) => {
      if (old[i].exists) existing.push(id);
      else { created.push(id); if (execute) tx.create(refs[i], data); }
    });
    return { execute, created, existing };
  });
  const counts = staff.map(s => ({ name: s.data().name, assigned: documents.filter(t => t.assignees.includes(s.id)).length }));
  console.log(JSON.stringify({ ...report, total: documents.length, counts }, null, 2));
}
run().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => admin.app().delete());
