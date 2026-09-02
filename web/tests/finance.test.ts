import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  sumBoxCost,
  sumSalaries,
  shiftMonth,
  resolveFixedCosts,
  backfillFixedCostHistory,
} from "../src/shared/utils/finance";

describe("sumBoxCost / sumSalaries", () => {
  test("sum numeric and string amounts, ignore junk", () => {
    assert.equal(sumBoxCost([{ cost: 1000 }, { cost: "500" }, { cost: undefined }]), 1500);
    assert.equal(sumSalaries([{ salary: "40000" }, { salary: 35000 }]), 75000);
    assert.equal(sumBoxCost(undefined), 0);
    assert.equal(sumSalaries([]), 0);
  });
});

describe("shiftMonth", () => {
  test("moves within and across year boundaries", () => {
    assert.equal(shiftMonth("2026-09", -1), "2026-08");
    assert.equal(shiftMonth("2026-01", -1), "2025-12");
    assert.equal(shiftMonth("2026-09", -13), "2025-08");
    assert.equal(shiftMonth("2026-11", 3), "2027-02");
  });
});

describe("resolveFixedCosts", () => {
  const finance = {
    boxes: [{ cost: 20000 }],
    salaries: [{ salary: 50000 }, { salary: 45000 }],
    fixedCostHistory: {
      "2026-06": { boxCost: 15000, salCost: 70000, rentalIncome: 8000 },
      "2026-07": { salCost: 80000 },
    },
  };

  test("uses the live configuration when no snapshot exists", () => {
    assert.deepEqual(resolveFixedCosts(finance, 12000, "2026-09"), {
      boxCost: 20000,
      salCost: 95000,
      rentalIncome: 12000,
    });
  });

  test("uses a full snapshot when present", () => {
    assert.deepEqual(resolveFixedCosts(finance, 12000, "2026-06"), {
      boxCost: 15000,
      salCost: 70000,
      rentalIncome: 8000,
    });
  });

  test("fills missing snapshot fields from live values", () => {
    assert.deepEqual(resolveFixedCosts(finance, 12000, "2026-07"), {
      boxCost: 20000,
      salCost: 80000,
      rentalIncome: 12000,
    });
  });
});

describe("backfillFixedCostHistory", () => {
  const snapshot = { boxCost: 20000, salCost: 95000, rentalIncome: 12000 };

  test("freezes prior months and leaves the current month alone", () => {
    const result = backfillFixedCostHistory(undefined, snapshot, "2026-09", 3);
    assert.deepEqual(Object.keys(result).sort(), ["2026-06", "2026-07", "2026-08"]);
    assert.deepEqual(result["2026-08"], snapshot);
    assert.equal(result["2026-09"], undefined);
  });

  test("never overwrites an existing snapshot", () => {
    const existing = { "2026-08": { boxCost: 1, salCost: 2, rentalIncome: 3 } };
    const result = backfillFixedCostHistory(existing, snapshot, "2026-09", 3);
    assert.deepEqual(result["2026-08"], { boxCost: 1, salCost: 2, rentalIncome: 3 });
    assert.deepEqual(result["2026-07"], snapshot);
  });

  test("does not mutate the input", () => {
    const existing = { "2026-08": { boxCost: 1 } };
    backfillFixedCostHistory(existing, snapshot, "2026-09", 3);
    assert.deepEqual(existing, { "2026-08": { boxCost: 1 } });
  });
});
