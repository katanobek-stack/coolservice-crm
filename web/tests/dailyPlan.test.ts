import { test } from "node:test";
import assert from "node:assert/strict";
import { vladivostokDate, resolveTask, sourceKey } from "../src/features/daily-plan/logic";
import { newestPpzTasks } from "../src/features/daily-plan/presentation";

test("PPZ puts newly created tasks first, independently of snapshot IDs and updates", () => {
  const old = { id: "z-old", createdAt: { seconds: 100, nanoseconds: 0 }, updatedAt: 9999 };
  const newer = { id: "a-new", createdAt: { seconds: 200, nanoseconds: 1 }, updatedAt: 200 };
  const newest = { id: "m-newest", createdAt: { seconds: 200, nanoseconds: 2 }, updatedAt: 200 };
  const snapshot = [old, newest, newer];
  assert.deepEqual(newestPpzTasks(snapshot).map(t => t.id), ["m-newest", "a-new", "z-old"]);
  assert.deepEqual(snapshot, [old, newest, newer]);
  assert.equal(newestPpzTasks([...snapshot, { id: "just-created", createdAt: { seconds: 300, nanoseconds: 0 }, updatedAt: 300 }])[0].id, "just-created");
});
test("PPZ retains undated legacy tasks at the bottom and has deterministic ties", () => {
  const snapshot = [{ id: "z", createdAt: null }, { id: "b", createdAt: { seconds: 1, nanoseconds: 0 } }, { id: "legacy" }, { id: "a", createdAt: { seconds: 1, nanoseconds: 0 } }];
  assert.deepEqual(newestPpzTasks(snapshot).map(t => t.id), ["a", "b", "legacy", "z"]);
  assert.deepEqual(newestPpzTasks([...snapshot].reverse()).map(t => t.id), ["a", "b", "legacy", "z"]);
  assert.deepEqual(newestPpzTasks([]), []);
});
test("personal day uses Vladivostok around UTC midnight", () => {
  assert.equal(vladivostokDate(new Date("2026-10-12T14:00:00Z")), "2026-10-13");
  assert.equal(vladivostokDate(new Date("2026-10-12T13:59:59Z")), "2026-10-12");
});
test("deleted or moved sources are unavailable instead of appearing complete", () => {
  assert.equal(resolveTask({ kind: "intake", documentId: "moved", taskId: "a" }, [], [], []), undefined);
  assert.notEqual(sourceKey({ kind: "repair", documentId: "c", repairId: "one", taskId: "a" }), sourceKey({ kind: "repair", documentId: "c", repairId: "two", taskId: "a" }));
});
