const { test } = require("node:test");
const assert = require("node:assert/strict");
const { workChanges, auditId } = require("../lib/workAccountingLogic");
const task = (extra = {}) => ({ id: "t", description: "Работа", assignees: ["a", "b"], doneBy: [], status: "in_progress", ...extra });
const intake = t => ({ vehicle: { plate: "А123АА125" }, repair: { id: "repair", tasks: [t] } });
test("completion and revocation retain the actual employee, not every assignee", () => {
  const events = workChanges("intake", "one", intake(task()), intake(task({ doneBy: ["a"] })));
  assert.deepEqual(events.map(e => [e.type, e.staffId]), [["completed", "a"]]);
  const reversed = workChanges("intake", "one", intake(task({ doneBy: ["a"] })), intake(task()));
  assert.deepEqual(reversed.map(e => [e.type, e.staffId]), [["completion_revoked", "a"]]);
});
test("manager closing globally without personal marks does not complete work for staff", () => {
  const events = workChanges("service", "s", task(), task({ status: "done" }));
  assert.deepEqual(events.map(e => e.type), ["task_closed"]);
  assert.equal(events[0].staffId, null);
});
test("reception counts vehicles once; moving intake and old completed imports add no completions", () => {
  const data = intake(task({ doneBy: ["a", "b"], status: "done" }));
  assert.deepEqual(workChanges("intake", "one", undefined, data).map(e => e.type), ["vehicle_received"]);
  assert.deepEqual(workChanges("intake", "one", data, undefined), []);
  assert.deepEqual(workChanges("repair", "client", { repairs: [] }, { repairs: [data.repair] }), []);
  assert.deepEqual(workChanges("intake", "chamber", undefined, { ...data, kind: "chamber" }), []);
  const next = { repair: { ...data.repair, tasks: [task({ doneBy: ["a"] })] } };
  const inIntake = workChanges("intake", "one", intake(task()), next)[0];
  const inClient = workChanges("repair", "client", { repairs: [intake(task()).repair] }, { repairs: [next.repair] })[0];
  assert.equal(inIntake.workKey, inClient.workKey);
});
test("subtask changes and text edits are preserved separately", () => {
  const events = workChanges("service", "s", { subtasks: [task()] }, { subtasks: [task({ doneBy: ["b"], workComment: "Сделал проводку" })] });
  assert.deepEqual(events.map(e => e.type), ["completed", "comment_changed"]);
  assert.match(events[0].workKey, /subtask\/t$/);
  assert.equal(events[0].text, "Сделал проводку");
  assert.equal(auditId("a", "bc"), auditId("a", "bc"));
  assert.notEqual(auditId("a", "bc"), auditId("ab", "c"));
});
