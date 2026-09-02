import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  repairFinancialMonth,
  repairFinancialDay,
  isRepairClosedInMonth,
} from "../src/shared/utils/repair";

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
