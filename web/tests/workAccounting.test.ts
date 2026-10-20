import { test } from "node:test";
import assert from "node:assert/strict";
import { accountingRange, csvCell, summarizeWork, type WorkEvent } from "../src/features/daily-plan/workAccounting";
import { employeeTone } from "../src/features/daily-plan/presentation";
function event(id: string, type: string, extra: Partial<WorkEvent> = {}): WorkEvent {
  return { id, type, workKey: "ppz/shared", sourceKind: "ppz", title: "Общая работа", staffId: "a", actorId: "a", text: "", selfReported: true, evidence: "authenticated_action", occurredAt: { toMillis: () => Number(id), toDate: () => new Date(Number(id)) }, ...extra };
}
test("joint closure credits only personal reporters and independently records the closer", () => {
  const result = summarizeWork([event("1", "completed"), event("2", "task_closed", { selfReported: false })], ["a", "b"]);
  assert.equal(result[0].personal, 1); assert.equal(result[0].closed, 1);
  assert.equal(result[1].personal, 0); assert.equal(result[1].closed, 0);
});
test("repeated reports, moving a source, and reverse delivery do not inflate completion", () => {
  const result = summarizeWork([event("4", "completed"), event("1", "completed"), event("3", "completion_revoked"), event("2", "report_updated")], ["a"])[0];
  assert.equal(result.personal, 1); assert.equal(result.revoked, 1);
  assert.equal(summarizeWork([event("1", "completed"), event("2", "completion_revoked")], ["a"])[0].personal, 0);
});
test("another person's mark and intake reception are distinct from personal completion", () => {
  const row = summarizeWork([event("1", "completed", { actorId: "manager", selfReported: false }), event("2", "vehicle_received", { sourceKind: "intake", workKey: "intake/car", selfReported: false })], ["a"])[0];
  assert.equal(row.personal, 0); assert.equal(row.recordedByOthers, 1); assert.equal(row.received, 1);
});
test("period includes full Vladivostok days and rejects invalid ranges", () => {
  const range = accountingRange("2026-10-15", "2026-10-15")!;
  assert.equal(range.start.toISOString(), "2026-10-14T14:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-10-15T14:00:00.000Z");
  assert.equal(accountingRange("2026-02-30", "2026-03-02"), null);
  assert.equal(accountingRange("2026-10-16", "2026-10-15"), null);
});
test("export escapes notes and does not execute spreadsheet formulas", () => {
  assert.equal(csvCell('=HYPERLINK("url")'), '"\'=HYPERLINK(""url"")"');
  assert.equal(csvCell('Прочитал "инструкцию"'), '"Прочитал ""инструкцию"""');
});

test("photos deduplicate across reports without adding completions or crediting others", () => {
  const photo = { id: "p", path: "work-reports/a/ppz/shared/p.jpg", url: "https://example.org/demo.jpg" };
  const events = [event("1", "completed", { photos: [photo] }), event("2", "report_updated", { photos: [photo] }),
    event("3", "photo_added", { photos: [{ ...photo, id: "p2", path: "work-reports/a/plan/p/i/p2.jpg" }], workKey: "service/s" }),
    event("4", "task_closed", { selfReported: false })];
  const [a, b] = summarizeWork(events, ["a", "b"]);
  assert.equal(a.photos, 2); assert.equal(a.withPhotos, 2); assert.equal(a.personal, 1);
  assert.equal(b.photos, 0); assert.equal(b.personal, 0);
});

test("employee colour is stable and selected from the bounded accessible palette", () => {
  for (const id of ["a", "b", "worker-long-id", ""]) {
    assert.equal(employeeTone(id), employeeTone(id));
    assert.ok(["blue", "violet", "teal", "amber", "rose", "indigo"].includes(employeeTone(id)));
  }
  assert.notEqual(employeeTone("a"), employeeTone("b"));
});
