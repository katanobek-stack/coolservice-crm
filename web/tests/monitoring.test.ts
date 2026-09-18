import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  monitoringPeriodMs,
  monitoringStatus,
  controllerConnectionStatus,
  downsampleTemperaturePoints,
  pointsInHistoryWindow,
  sortAndDedupePoints,
  violatesTemperatureRule,
} from "../src/shared/monitoring/logic";
import type { MonitoringControllerStatus, MonitoringDeviceState, TemperaturePoint } from "../src/shared/types/monitoring";

const NOW = Date.parse("2026-09-13T02:00:00.000Z");

function state(overrides: Partial<MonitoringDeviceState>): MonitoringDeviceState {
  return {
    deviceId: "device-001",
    measuredAt: null,
    receivedAt: null,
    lastReceivedAt: null,
    alertActive: false,
    activeAlertIds: {},
    ...overrides,
  };
}

function controllerStatus(overrides: Partial<MonitoringControllerStatus> = {}): MonitoringControllerStatus {
  return {
    controllerId: "device-001", statusId: "status-001", reportedAt: new Date(NOW - 60_000),
    receivedAt: new Date(NOW - 59_000), networkRegistered: true, registrationState: "home",
    rssi: 20, gprsConnected: true, mqttConnected: true, queueDepth: 0,
    lastFailureCode: "none", uptimeSeconds: 120, ...overrides,
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

  test("uses controller reportedAt for connection while temperature uses measuredAt", () => {
    assert.equal(controllerConnectionStatus(undefined, NOW, 5), "unknown");
    assert.equal(controllerConnectionStatus(controllerStatus(), NOW, 5), "online");
    assert.equal(controllerConnectionStatus(controllerStatus({
      reportedAt: new Date(NOW - 6 * 60_000), receivedAt: new Date(NOW),
    }), NOW, 5), "offline");
    assert.equal(monitoringStatus(state({
      measuredAt: new Date(NOW - 6 * 60_000), lastReceivedAt: new Date(NOW),
    }), NOW, 5).reading, "stale");
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

  test("keeps delayed points in measurement order even across a large gap", () => {
    const points: TemperaturePoint[] = [
      { measuredAt: new Date(NOW - 80_000), temperatureC: -18 },
      { measuredAt: new Date(NOW - 70_000), temperatureC: -18.1 },
      { measuredAt: new Date(NOW - 20_000), temperatureC: -18.2 },
      { measuredAt: new Date(NOW - 10_000), temperatureC: -18.3 },
    ];
    assert.deepEqual(
      sortAndDedupePoints(points).map((point) => point.temperatureC),
      [-18, -18.1, -18.2, -18.3],
    );
  });

  test("supports 1, 12 and 24 hour windows", () => {
    assert.equal(monitoringPeriodMs("hour"), 60 * 60_000);
    assert.equal(monitoringPeriodMs("halfDay"), 12 * 60 * 60_000);
    assert.equal(monitoringPeriodMs("day"), 24 * 60 * 60_000);
  });

  test("keeps every measurement from 2880 half-minute packets in the daily window", () => {
    const dayStart = NOW - monitoringPeriodMs("day");
    const packets = Array.from({ length: 2_880 }, (_, packetIndex) => {
      const firstMs = dayStart + packetIndex * 30_000 + 5_000;
      return [
        { measuredAt: new Date(firstMs), temperatureC: -18 },
        { measuredAt: new Date(firstMs + 10_000), temperatureC: -17.9 },
      ];
    }).reverse(); // delayed delivery order must not affect the chart order
    const points = pointsInHistoryWindow(packets.flat(), dayStart, NOW);
    assert.equal(points.length, 5_760);
    assert.equal(points[0].measuredAt.getTime(), dayStart + 5_000);
    assert.equal(points.at(-1)?.measuredAt.getTime(), NOW - 15_000);
  });

  test("keeps both sides of a large gap and preserves bounds and spikes when downsampling 1600 points", () => {
    const dayStart = NOW - monitoringPeriodMs("day");
    const source: TemperaturePoint[] = Array.from({ length: 1_600 }, (_, index) => ({
      measuredAt: new Date(dayStart + 1_000 + index * 30_000),
      temperatureC: -18 + (index % 5) * 0.1,
    }));
    // Simulate an old interrupted segment: points immediately before and after it remain valid history.
    source.splice(700, 200);
    source[200] = { ...source[200], temperatureC: -40 };
    source[1_000] = { ...source[1_000], temperatureC: 25 };

    const all = pointsInHistoryWindow(source.reverse(), dayStart, NOW);
    const rendered = downsampleTemperaturePoints(all);
    assert.equal(all.length, 1_400);
    assert.ok(all.some((point) => point.measuredAt.getTime() < dayStart + 700 * 30_000));
    assert.ok(all.some((point) => point.measuredAt.getTime() > dayStart + 900 * 30_000));
    assert.ok(rendered.length <= 600);
    assert.equal(rendered[0].measuredAt.getTime(), all[0].measuredAt.getTime());
    assert.equal(rendered.at(-1)?.measuredAt.getTime(), all.at(-1)?.measuredAt.getTime());
    assert.ok(rendered.some((point) => point.temperatureC === -40));
    assert.ok(rendered.some((point) => point.temperatureC === 25));
  });
});

describe("independent temperature rules", () => {
  test("uses strict comparison for both directions, including negative values", () => {
    const above = { enabled: true, direction: "above" as const, thresholdC: -15 };
    const below = { enabled: true, direction: "below" as const, thresholdC: -25 };
    assert.equal(violatesTemperatureRule(-15, above), false);
    assert.equal(violatesTemperatureRule(-14, above), true);
    assert.equal(violatesTemperatureRule(-25, below), false);
    assert.equal(violatesTemperatureRule(-26, below), true);
    assert.equal(violatesTemperatureRule(-14, { ...above, enabled: false }), false);
  });

  test("allows above and below rules to be active simultaneously", () => {
    assert.equal(violatesTemperatureRule(-12, {
      enabled: true, direction: "above", thresholdC: -15,
    }), true);
    assert.equal(violatesTemperatureRule(-12, {
      enabled: true, direction: "below", thresholdC: -10,
    }), true);
  });
});
