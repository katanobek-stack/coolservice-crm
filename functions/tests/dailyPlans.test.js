const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parsePlanItems, planDate, taskComplete, splitMessage, planMessage, telegramGroupIds } = require("../lib/dailyPlanLogic");
const item = { id: "one", source: { kind: "service", documentId: "task-1" }, title: "Убрать бокс", deadline: "17:00", priority: "high", note: "После ремонта" };
test("uses existing group configuration, deduplicates groups and rejects personal or missing recipients", () => {
  assert.deepEqual(telegramGroupIds(" -100123, -100456, -100123 "), ["-100123", "-100456"]);
  assert.throws(() => telegramGroupIds(""));
  assert.throws(() => telegramGroupIds("123456"));
  assert.throws(() => telegramGroupIds("-100123,wrong"));
});
test("rejects impossible dates, duplicate source tasks and unsafe references", () => {
  assert.throws(() => planDate("2026-02-30"));
  assert.throws(() => parsePlanItems([item, { ...item, id: "two" }]));
  assert.throws(() => parsePlanItems([{ ...item, source: { kind: "service", documentId: "../staff" } }]));
  assert.throws(() => parsePlanItems([{ ...item, deadline: "25:00" }]));
  assert.throws(() => parsePlanItems([{ ...item, source: { kind: "repair", documentId: "client" } }]));
});
test("joint work stays open until every assignee has finished", () => {
  assert.equal(taskComplete({ assignees: ["a", "b"], doneBy: ["a"] }), false);
  assert.equal(taskComplete({ assignees: ["a", "b"], doneBy: ["a", "b"] }), true);
  assert.equal(taskComplete({ assignees: [], doneBy: [] }), false);
});
test("long Telegram messages preserve full text and never cut emoji pairs", () => {
  const text = "🔥".repeat(5000);
  const parts = splitMessage(text);
  assert.equal(parts.join(""), text);
  assert.ok(parts.every(part => part.length <= 3500 && !/[\uD800-\uDBFF]$/.test(part)));
  const message = planMessage("2026-10-13", "Владимир", 1, parsePlanItems([item]));
  assert.match(message, /Владимир/); assert.match(message, /до 17:00/);
  assert.match(planMessage("2026-10-13", "Владимир", 2, []), /Назначенных задач нет/);
});
