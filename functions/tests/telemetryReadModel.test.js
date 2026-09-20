const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Timestamp } = require("firebase-admin/firestore");
const {
  nextRollupData,
  rollupDocumentId,
  stableMeasurementId,
} = require("../lib/telemetryReadModel");

test("stable measurement id is deterministic and unique per packet index", () => {
  assert.equal(stableMeasurementId("packet:1", 0), stableMeasurementId("packet:1", 0));
  assert.notEqual(stableMeasurementId("packet:1", 0), stableMeasurementId("packet:1", 1));
  assert.match(stableMeasurementId("packet:1", 0), /^[A-Za-z0-9_-]{43}$/);
});

test("rollup keeps quality series and five-minute min/max ranges separate", () => {
  const measuredAt = new Date("2026-09-20T12:01:00.000Z");
  const receivedAt = Timestamp.fromDate(new Date("2026-09-20T12:01:01.000Z"));
  const first = nextRollupData(undefined, "device-001", {
    packetId: "packet:1", measurementIndex: 0, sensorId: "temperature-1", measuredAt,
    temperatureC: -18, timeQuality: "exact", deliveryQuality: "realtime",
  }, receivedAt);
  const second = nextRollupData(first, "device-001", {
    packetId: "packet:2", measurementIndex: 0, sensorId: "temperature-1",
    measuredAt: new Date("2026-09-20T12:04:00.000Z"), temperatureC: -14,
    timeQuality: "exact", deliveryQuality: "realtime",
  }, receivedAt);
  const third = nextRollupData(second, "device-001", {
    packetId: "packet:3", measurementIndex: 0, sensorId: "temperature-1",
    measuredAt: new Date("2026-09-20T12:04:30.000Z"), temperatureC: -16,
    timeQuality: "estimated", deliveryQuality: "delayed",
  }, receivedAt);
  const bucket = third.buckets5m[String(Date.parse("2026-09-20T12:00:00.000Z"))];
  assert.deepEqual(bucket.aggregates.exact_realtime, {
    count: 2, sumTemperatureC: -32, minTemperatureC: -18, maxTemperatureC: -14,
  });
  assert.deepEqual(bucket.aggregates.estimated_delayed, {
    count: 1, sumTemperatureC: -16, minTemperatureC: -16, maxTemperatureC: -16,
  });
  assert.equal(rollupDocumentId("temperature-1", measuredAt.getTime()), "temperature-1__1789905600000");
});
