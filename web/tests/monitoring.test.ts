import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  monitoringStatus,
  sortAndDedupePoints,
  splitAtGaps,
} from "../src/shared/monitoring/logic";
import type { MonitoringDeviceState, TemperaturePoint } from "../src/shared/types/monitoring";

const NOW = Date.parse("2026-09-13T02:00:00.000Z");

function state(overrides: Partial<MonitoringDeviceState>): MonitoringDeviceState {
  return {
    deviceId: "device-001",
    measuredAt: null,
    receivedAt: null,
    lastReceivedAt: null,
    ...overrides,
  };
}

describe("monitoring statuses", () => {
  test("distinguishes missing measurements from an unknown connection", () => {
    assert.deepEqual(monitoringStatus(undefined, NOW, 5), {
      reading: "missing",
      connection: "unknown",
    });
  });

  test("a newly delivered old measurement is stale while connection is online", () => {
    assert.deepEqual(monitoringStatus(state({
      measuredAt: new Date(NOW - 20 * 60_000),
      receivedAt: new Date(NOW),
      lastReceivedAt: new Date(NOW),
      temperatureC: -18,
    }), NOW, 5), {
      reading: "stale",
      connection: "online",
    });
  });

  test("reports lost connection independently from reading freshness", () => {
    assert.deepEqual(monitoringStatus(state({
      measuredAt: new Date(NOW - 10 * 60_000),
      lastReceivedAt: new Date(NOW - 8 * 60_000),
      temperatureC: -18,
    }), NOW, 5), {
      reading: "stale",
      connection: "offline",
    });
  });
});

describe("monitoring history", () => {
  test("sorts delayed samples by measurement time and deduplicates timestamps", () => {
    const points: TemperaturePoint[] = [
      { measuredAt: new Date(NOW - 10_000), temperatureC: -18 },
      { measuredAt: new Date(NOW - 30_000), temperatureC: -19 },
      { measuredAt: new Date(NOW - 10_000), temperatureC: -17.5 },
    ];
    const sorted = sortAndDedupePoints(points);
    assert.deepEqual(sorted.map((point) => point.temperatureC), [-19, -17.5]);
  });

  test("splits the chart when measurements are absent for more than 30 seconds", () => {
    const points: TemperaturePoint[] = [
      { measuredAt: new Date(NOW - 80_000), temperatureC: -18 },
      { measuredAt: new Date(NOW - 70_000), temperatureC: -18.1 },
      { measuredAt: new Date(NOW - 20_000), temperatureC: -18.2 },
      { measuredAt: new Date(NOW - 10_000), temperatureC: -18.3 },
    ];
    assert.deepEqual(splitAtGaps(points).map((segment) => segment.length), [2, 2]);
  });
});
