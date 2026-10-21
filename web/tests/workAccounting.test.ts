import { test } from "node:test";
import assert from "node:assert/strict";
import { accountingRange, accountingMonth, canViewWorkAccounting, closedWorkRepairs, monthlyWorkSummary, csvCell, summarizeWork, type WorkEvent } from "../src/features/daily-plan/workAccounting";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkRankingTable } from "../src/features/daily-plan/WorkAccountingPanel";
import type { Client, Repair } from "../src/shared/types/client";
import type { IntakeRepair } from "../src/shared/types/intake";
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

const time = (iso: string) => ({ toMillis: () => Date.parse(iso), toDate: () => new Date(iso) });
test("company-wide ranking retains existing admin/owner visibility", () => {
  for (const role of [undefined, "mechanic", "manager", "unknown"]) assert.equal(canViewWorkAccounting(role), false);
  for (const role of ["owner", "admin"]) assert.equal(canViewWorkAccounting(role), true);
});
test("month includes all Vladivostok days, leap days and the year boundary", () => {
  const october = accountingMonth("2026-10")!;
  assert.equal(october.start.toISOString(), "2026-09-30T14:00:00.000Z");
  assert.equal(october.end.toISOString(), "2026-10-31T14:00:00.000Z");
  assert.equal(accountingMonth("2028-02")?.to, "2028-02-29");
  assert.equal(accountingMonth("2026-12")?.end.toISOString(), "2026-12-31T14:00:00.000Z");
  assert.equal(accountingMonth("2026-13"), null); assert.equal(accountingMonth("bad"), null);
});
test("self-created PPZ and shared assignments stay separate from actual personal completions", () => {
  const range = accountingMonth("2026-10")!;
  const stamp = time("2026-10-05T10:00:00Z");
  const tasks = [{ id: "shared", title: "Задача", createdBy: "a", assignees: ["a", "b"], createdAt: stamp },
    { id: "prior-month", title: "Старая", createdBy: "b", assignees: ["b"], createdAt: time("2026-09-30T13:59:59Z") }];
  const events = [event("1", "completed", { occurredAt: stamp }), event("2", "report_updated", { occurredAt: stamp }), event("3", "task_closed", { occurredAt: stamp, selfReported: false }),
    event("4", "completed", { workKey: "ppz/old", occurredAt: time("2026-09-30T13:59:59Z") })];
  const [a, b] = monthlyWorkSummary(events, tasks, [], ["a", "b"], range);
  assert.equal(a.created, 1); assert.equal(a.assigned, 1); assert.equal(a.ppzCompleted, 1);
  assert.equal(b.assigned, 1); assert.equal(b.created, 0); assert.equal(b.ppzCompleted, 0);
  const revoked = monthlyWorkSummary([...events, event("5", "completion_revoked", { occurredAt: time("2026-10-06T00:00:00Z") })], tasks, [], ["a"], range)[0];
  assert.equal(revoked.ppzCompleted, 0);
  const html = renderToStaticMarkup(createElement(WorkRankingTable, { rows: [a, b], name: id => id === "a" ? "Александр" : "Владимир", onSelect() {} }));
  assert.match(html, /Выполнил ППЗ/); assert.match(html, /Закрытых заявок с участием/); assert.match(html, /История сотрудника: Александр/);
  assert.match(html, /ppz-ranking-cards/); assert.match(html, /ppz-ranking-desktop/);
});
test("authenticated plan completion wins over the same commit observed by a trigger, not later revocation", () => {
  const stamp = time("2026-10-05T10:00:00Z");
  const action = event("a", "completed", { sourceKind: "service", workKey: "service/s", occurredAt: stamp });
  const observation = { ...action, id: "z", selfReported: false, actorId: null, evidence: "observed_change" };
  for (const list of [[action, observation], [observation, action]]) {
    assert.equal(summarizeWork(list, ["a"])[0].serviceTasks, 1);
    assert.equal(summarizeWork(list, ["a"])[0].recordedByOthers, 0);
    assert.equal(summarizeWork([...list, event("next", "completion_revoked", { workKey: "service/s", occurredAt: time("2026-10-06T00:00:00Z"), selfReported: false })], ["a"])[0].personal, 0);
  }
});
test("closed request archive deduplicates intake moves, counts real task marks, not assignees", () => {
  const repair: Repair = { id: "repair-1", serviceType: "refrigerator", description: "Компрессор", vehicleId: "v", closedByManager: true, closedAt: "2026-10-06T10:00:00Z", tasks: [{ id: "t", description: "Заменил", assignees: ["a", "b"], doneBy: ["a"], status: "done" }] };
  const clients: Client[] = [{ id: "c", name: "Клиент", vehicles: [{ id: "v", plate: "А123АА" }], repairs: [repair, { ...repair, id: "cancelled", status: "cancelled" }, { ...repair, id: "open", closedByManager: false }, { ...repair, id: "undated", closedAt: undefined }, { ...repair, id: "september", closedAt: "2026-09-30T13:59:59Z" }] }];
  const intake = [{ id: "intake", repair, kind: "vehicle" }] as IntakeRepair[];
  const range = accountingMonth("2026-10")!;
  const repairs = closedWorkRepairs(clients, intake, range);
  assert.equal(repairs.length, 1); assert.match(repairs[0].title, /А123АА/); assert.deepEqual(repairs[0].participants, ["a"]);
  const [a, b] = monthlyWorkSummary([], [], repairs, ["a", "b"], range);
  assert.equal(a.requests, 1); assert.equal(b.requests, 0); assert.equal(a.personal, 0);
});
test("historical departed employees remain in the monthly list; missing dates are not invented", () => {
  const range = accountingMonth("2026-10")!;
  const [row] = monthlyWorkSummary([event("1", "completed", { staffId: "departed", actorId: "departed", occurredAt: time("2026-10-02T00:00:00Z") })], [{ id: "old", title: "Без даты", assignees: ["departed"] }], [], [], range);
  assert.equal(row.uid, "departed"); assert.equal(row.ppzCompleted, 1); assert.equal(row.assigned, 0);
});
test("published daily plan snapshots survive revisions and do not count assignment as completion", () => {
  const stamp = time("2026-10-05T10:00:00Z"), range = accountingMonth("2026-10")!;
  const published = event("1", "plan_published", { sourceKind: "plan", workKey: "plan/a-day1", occurredAt: stamp, selfReported: false, planItems: [{ title: "Работа", workKey: "service/s", sourceKind: "service" }] });
  const revisions = [published, { ...published, id: "2", planVersion: 2 }, { ...published, id: "3", workKey: "plan/a-day2" }];
  const [row] = monthlyWorkSummary(revisions, [], [], ["a"], range);
  assert.equal(row.plansPublished, 2); assert.equal(row.plannedTasks, 1); assert.equal(row.personal, 0); assert.equal(row.ppzCompleted, 0);
});
