const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Timestamp } = require("firebase-admin/firestore");
const { parseTemperatureRule, ruleVersionAt, ruleMatchesSensor, temperatureViolatesRule } = require("../lib/telemetryAlerts");

test("sensor assignment is selected by measuredAt using the rule's immutable versions", () => {
  const version = (revision, sensorId, effectiveFrom) => ({ revision, sensorId, name: "Alarm", enabled: true, direction: "above", thresholdC: -15, effectiveFrom: Timestamp.fromMillis(effectiveFrom) });
  const rule = parseTemperatureRule("rule-one", { ...version(2, "temperature-1_2", 2000), versions: [version(1, "temperature-1", 1000), version(2, "temperature-1_2", 2000)] });
  assert.equal(rule.sensorId, "temperature-1_2");
  const past = ruleVersionAt(rule, 1500);
  const current = ruleVersionAt(rule, 2500);
  assert.equal(ruleMatchesSensor(past, "temperature-1"), true);
  assert.equal(ruleMatchesSensor(past, "temperature-1_2"), false);
  assert.equal(ruleMatchesSensor(current, "temperature-1"), false);
  assert.equal(ruleMatchesSensor(current, "temperature-1_2"), true);
  assert.equal(temperatureViolatesRule(-15, current), false);
  assert.equal(temperatureViolatesRule(-14, current), true);
});

test("legacy unscoped rules target only the primary sensor, never probes two or three", () => {
  for (const id of [undefined, "default", "temperature-1"]) assert.equal(ruleMatchesSensor({}, id), true);
  for (const id of ["temperature-1_2", "temperature-1_3"]) assert.equal(ruleMatchesSensor({}, id), false);
  assert.equal(ruleMatchesSensor({ sensorId: "default" }, "temperature-1"), false);
});
