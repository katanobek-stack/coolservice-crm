const assert = require("node:assert/strict");
const { test } = require("node:test");
const { AVG_EPSILON, equalMetrics, repairMatches } = require("../scripts/verify-monitoring-sensor-id-repair");

const expected = { N: 360, min: 24.88, max: 25.06, avg: 24.966166666666687 };

test("sensor repair verifier accepts harmless floating-point average representation", () => {
  assert.equal(equalMetrics(expected, { ...expected, avg: 24.96616666666664 }), true);
});

test("sensor repair verifier rejects a material metric discrepancy", () => {
  assert.equal(equalMetrics(expected, { ...expected, avg: expected.avg + AVG_EPSILON * 2 }), false);
  assert.equal(equalMetrics(expected, { ...expected, N: 359 }), false);
  assert.equal(equalMetrics(expected, { ...expected, max: 25.07 }), false);
});

test("sensor repair result requires expected point and rollup counts", () => {
  const valid = { legacy: expected, temperature1: { ...expected, avg: 24.96616666666664 }, defaultPoints: 0, temperature1Points: 360, defaultRollups: 0, temperature1Rollups: 6 };
  assert.equal(repairMatches(valid), true);
  assert.equal(repairMatches({ ...valid, defaultPoints: 1 }), false);
});
