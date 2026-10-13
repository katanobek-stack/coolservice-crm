import { test } from "node:test";
import assert from "node:assert/strict";
import { vladivostokDate, resolveTask, sourceKey } from "../src/features/daily-plan/logic";
test("personal day uses Vladivostok around UTC midnight", () => {
  assert.equal(vladivostokDate(new Date("2026-10-12T14:00:00Z")), "2026-10-13");
  assert.equal(vladivostokDate(new Date("2026-10-12T13:59:59Z")), "2026-10-12");
});
test("deleted or moved sources are unavailable instead of appearing complete", () => {
  assert.equal(resolveTask({ kind: "intake", documentId: "moved", taskId: "a" }, [], [], []), undefined);
  assert.notEqual(sourceKey({ kind: "repair", documentId: "c", repairId: "one", taskId: "a" }), sourceKey({ kind: "repair", documentId: "c", repairId: "two", taskId: "a" }));
});
