import { describe, test } from "node:test";
import assert from "node:assert/strict";
import * as repairUtils from '../src/shared/utils/repair';
import type { Repair } from '../src/shared/types/client';
import {
  repairFinancialMonth,
  repairFinancialDay,
  isRepairClosedInMonth,
} from "../src/shared/utils/repair";

test('mechanic completion determines revenue month even when manager closes next month', () => {
  const repair = { date: '2026-10-10', workCompletedAt: '2026-10-31T13:59:59Z', closedAt: '2026-11-05T03:00:00Z' };
  assert.equal(repairFinancialDay(repair), '2026-10-31');
  assert.equal(repairFinancialMonth(repair), '2026-10');
  assert.equal(isRepairClosedInMonth(repair, '2026-11'), false);
  assert.equal(repairFinancialDay({ ...repair, workCompletedAt: '2026-10-31T14:00:00Z' }), '2026-11-01');
});

test('completion is stamped only when every mechanic finishes and resets on reopening', () => {
  const stamp = (repairUtils as unknown as { stampRepairCompletion: (before: Repair, after: Repair, now: string) => Repair & { workCompletedAt?: string } }).stampRepairCompletion;
  assert.equal(typeof stamp, 'function');
  const before: Repair = { id: 'r', serviceType: 'refrigerator', tasks: [{ id: 't', description: 'Ремонт', assignees: ['a', 'b'], doneBy: [], status: 'in_progress' }] };
  const partial = { ...before, tasks: [{ ...before.tasks[0], doneBy: ['a'] }] };
  assert.equal(stamp(before, partial, '2026-10-30T00:00:00Z').workCompletedAt, undefined);
  const finished = stamp(partial, { ...partial, tasks: [{ ...partial.tasks[0], doneBy: ['a', 'b'] }] }, '2026-10-31T13:00:00Z');
  assert.equal(finished.workCompletedAt, '2026-10-31T13:00:00Z');
  const manager = stamp(finished, { ...finished, cost: '1000', closedByManager: true, closedAt: '2026-11-05' }, '2026-11-05');
  assert.equal(manager.workCompletedAt, finished.workCompletedAt);
  const reopened = stamp(finished, partial, '2026-11-06T00:00:00Z');
  assert.equal(reopened.workCompletedAt, undefined);
  const finishedAgain = stamp(reopened, { ...finished, workCompletedAt: 'forged' }, '2026-11-07T00:00:00Z');
  assert.equal(finishedAgain.workCompletedAt, '2026-11-07T00:00:00Z');
  const legacyDone = { ...before, tasks: [{ ...before.tasks[0], status: 'done' as const }] };
  assert.equal(stamp(legacyDone, { ...legacyDone, closedByManager: true }, '2026-11-05').workCompletedAt, undefined);
  assert.equal(stamp({ ...before, tasks: [] }, { ...before, tasks: [] }, '2026-11-05').workCompletedAt, undefined);
});

describe("repairFinancialMonth", () => {
  test("uses the close month when closedAt is set", () => {
    assert.equal(
      repairFinancialMonth({ date: "2026-01-15", closedAt: "2026-03-04T09:12:00.000Z" }),
      "2026-03",
    );
  });

  test("falls back to the start date for repairs closed before closedAt existed", () => {
    assert.equal(repairFinancialMonth({ date: "2026-01-15" }), "2026-01");
  });

  test("prefers closedAt even when it precedes the start date", () => {
    assert.equal(
      repairFinancialMonth({ date: "2026-05-01", closedAt: "2026-04-30T23:00:00.000Z" }),
      "2026-04",
    );
  });

  test("returns an empty string when neither date is set", () => {
    assert.equal(repairFinancialMonth({}), "");
  });
});

describe("repairFinancialDay", () => {
  test("uses the closedAt calendar day", () => {
    assert.equal(
      repairFinancialDay({ date: "2026-01-15", closedAt: "2026-03-04T09:12:00.000Z" }),
      "2026-03-04",
    );
  });

  test("falls back to the start date", () => {
    assert.equal(repairFinancialDay({ date: "2026-01-15" }), "2026-01-15");
  });

  test("returns an empty string when neither date is set", () => {
    assert.equal(repairFinancialDay({}), "");
  });
});

describe("isRepairClosedInMonth", () => {
  test("matches on the close month", () => {
    assert.equal(
      isRepairClosedInMonth({ date: "2026-01-15", closedAt: "2026-03-04T09:12:00.000Z" }, "2026-03"),
      true,
    );
    assert.equal(
      isRepairClosedInMonth({ date: "2026-01-15", closedAt: "2026-03-04T09:12:00.000Z" }, "2026-01"),
      false,
    );
  });

  test("matches legacy repairs by start month", () => {
    assert.equal(isRepairClosedInMonth({ date: "2026-02-20" }, "2026-02"), true);
  });

  test("never matches when the repair has no dates", () => {
    assert.equal(isRepairClosedInMonth({}, "2026-02"), false);
  });
});
