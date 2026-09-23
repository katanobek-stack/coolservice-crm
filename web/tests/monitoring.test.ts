import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  monitoringPeriodMs,
  monitoringStatus,
  controllerConnectionStatus,
  downsampleTemperaturePoints,
  isChartTimeQuality,
  pointsInHistoryWindow,
  sortAndDedupePoints,
  temperatureChartSegments,
  chartXAxisTicks,
  panChartWindow,
  resizeChartWindow,
  zoomChartWindow,
  placeUnplacedPoints,
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
  test("rebuilds the main x axis from the current zoomed window", () => {
    const baseStart = Date.parse("2026-09-22T09:35:00Z");
    const baseEnd = Date.parse("2026-09-22T21:35:00Z");
    const initial = { start: baseStart, end: baseEnd };
    const zoomed = zoomChartWindow(initial, baseStart, baseEnd, 0.75, 0.25);
    assert.notDeepEqual(chartXAxisTicks(zoomed), chartXAxisTicks(initial));
    assert.equal(chartXAxisTicks(zoomed)[0], zoomed.start);
    assert.equal(chartXAxisTicks(zoomed).at(-1), zoomed.end);
  });

  test("panning the navigator moves one visible window without changing its width", () => {
    const initial = { start: 100_000, end: 160_000 };
    const panned = panChartWindow(initial, 0, 300_000, 45_000);
    assert.deepEqual(panned, { start: 145_000, end: 205_000 });
    assert.deepEqual(panChartWindow(initial, 0, 300_000, -200_000), { start: 0, end: 60_000 });
  });

  test("navigator handles resize only their respective boundary", () => {
    const initial = { start: 100_000, end: 220_000 };
    assert.deepEqual(resizeChartWindow(initial, "start", 150_000, 0, 300_000), { start: 150_000, end: 220_000 });
    assert.deepEqual(resizeChartWindow(initial, "end", 180_000, 0, 300_000), { start: 100_000, end: 180_000 });
    assert.deepEqual(resizeChartWindow(initial, "start", 210_000, 0, 300_000), { start: 160_000, end: 220_000 });
  });

  test("keeps unplaced samples out of the chart and temperature statistics pipeline", () => {
    assert.equal(isChartTimeQuality("exact"), true);
    assert.equal(isChartTimeQuality("estimated"), true);
    assert.equal(isChartTimeQuality(undefined), true, "legacy samples remain exact");
    assert.equal(isChartTimeQuality("unplaced"), false);
  });

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

  test("keeps time quality through dedupe and joins runs styling transitions by the weaker endpoint", () => {
    const sameTime = new Date(NOW - 50_000);
    const points: TemperaturePoint[] = [
      { measuredAt: new Date(NOW - 70_000), temperatureC: -18, timeQuality: "exact" },
      { measuredAt: new Date(NOW - 60_000), temperatureC: -17.9, timeQuality: "estimated" },
      { measuredAt: sameTime, temperatureC: -17.8, timeQuality: "estimated" },
      { measuredAt: sameTime, temperatureC: -17.7, timeQuality: "exact" },
      { measuredAt: new Date(NOW - 40_000), temperatureC: -17.6, timeQuality: "exact" },
    ];
    const deduped = sortAndDedupePoints(points);
    assert.deepEqual(deduped.map((point) => point.timeQuality), ["exact", "estimated", "exact", "exact"]);
    assert.equal(deduped[2].temperatureC, -17.7, "exact wins an equal measuredAt");
    assert.deepEqual(temperatureChartSegments(deduped).map((segment) => segment.timeQuality), ["estimated", "estimated", "exact"]);
  });

  test("keeps delayed delivery independent from time quality and connects runs with the weaker endpoint style", () => {
    const sameTime = new Date(NOW - 60_000);
    const points: TemperaturePoint[] = [
      { measuredAt: new Date(NOW - 80_000), temperatureC: -18, timeQuality: "exact", deliveryQuality: "realtime" },
      { measuredAt: sameTime, temperatureC: -17.9, timeQuality: "exact", deliveryQuality: "realtime" },
      { measuredAt: sameTime, temperatureC: -17.8, timeQuality: "exact", deliveryQuality: "delayed" },
      { measuredAt: new Date(NOW - 50_000), temperatureC: -17.7, timeQuality: "exact", deliveryQuality: "delayed" },
      { measuredAt: new Date(NOW - 40_000), temperatureC: -17.6, timeQuality: "estimated", deliveryQuality: "delayed" },
      { measuredAt: new Date(NOW - 30_000), temperatureC: -17.5, timeQuality: "estimated", deliveryQuality: "realtime" },
    ];
    const deduped = sortAndDedupePoints(points);
    assert.equal(deduped[1].deliveryQuality, "delayed", "delayed wins an equal measuredAt");
    assert.deepEqual(
      temperatureChartSegments(deduped).map((segment) => `${segment.timeQuality}:${segment.deliveryQuality}`),
      ["exact:delayed", "exact:delayed", "estimated:delayed", "estimated:delayed"],
    );
  });

  test("downsampling retains time and delivery quality combinations", () => {
    const source: TemperaturePoint[] = Array.from({ length: 1_200 }, (_, index) => ({
      measuredAt: new Date(NOW - 3_600_000 + index * 3_000),
      temperatureC: -20 + (index % 8),
      timeQuality: index === 600 ? "estimated" : "exact",
      deliveryQuality: index === 800 ? "delayed" : "realtime",
    }));
    source[600].temperatureC = -45;
    const rendered = downsampleTemperaturePoints(source);
    assert.ok(rendered.some((point) => point.timeQuality === "estimated" && point.temperatureC === -45));
    assert.ok(rendered.some((point) => point.deliveryQuality === "delayed"));
  });

  test("supports 1, 12 and 24 hour windows", () => {
    assert.equal(monitoringPeriodMs("hour"), 60 * 60_000);
    assert.equal(monitoringPeriodMs("halfDay"), 12 * 60 * 60_000);
    assert.equal(monitoringPeriodMs("day"), 24 * 60 * 60_000);
    assert.equal(monitoringPeriodMs("threeDays"), 3 * 24 * 60 * 60_000);
    assert.equal(monitoringPeriodMs("week"), 7 * 24 * 60 * 60_000);
    assert.equal(monitoringPeriodMs("month"), 30 * 24 * 60 * 60_000);
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


describe("unplaced point placement", () => {
  function timedPoint(offsetMs: number, temperatureC: number, receivedAt: Date): TemperaturePoint {
    return { measuredAt: new Date(NOW + offsetMs), temperatureC, receivedAt };
  }

  test("distributes same-packet unplaced samples evenly across the packet timed span", () => {
    const receivedAt = new Date(NOW - 5 * 60_000);
    const timed = [
      timedPoint(-10 * 60_000, -20, receivedAt),
      timedPoint(0, -18, receivedAt),
    ];
    const placed = placeUnplacedPoints(timed, [
      { packetId: "p1", receivedAt, measurementIndex: 0, temperatureC: -19 },
      { packetId: "p1", receivedAt, measurementIndex: 1, temperatureC: -17 },
    ], NOW);
    assert.deepEqual(
      placed.map((point) => [point.measuredAt.getTime() - NOW, point.timeQuality]),
      [[-400_000, "unplaced"], [-200_000, "unplaced"]],
    );
  });

  test("brackets an unplaced-only packet between the last timed point before and the first timed point after", () => {
    const timed = [
      timedPoint(-20 * 60_000, -20, new Date(NOW - 20 * 60_000)),
      timedPoint(0, -18, new Date(NOW - 60_000)),
    ];
    const placed = placeUnplacedPoints(timed, [
      { packetId: "p9", receivedAt: new Date(NOW - 90_000), measurementIndex: 0, temperatureC: -19 },
    ], NOW);
    assert.equal(placed.length, 1);
    assert.equal(placed[0].measuredAt.getTime(), NOW - 10 * 60_000);
    assert.equal(placed[0].timeQuality, "unplaced");
  });

  test("extends past the last timed point when no later timed point exists", () => {
    const timed = [timedPoint(-60 * 60_000, -20, new Date(NOW - 60 * 60_000))];
    const placed = placeUnplacedPoints(timed, [
      { packetId: "p1", receivedAt: new Date(NOW - 60_000), measurementIndex: 0, temperatureC: -19 },
      { packetId: "p1", receivedAt: new Date(NOW - 60_000), measurementIndex: 1, temperatureC: -18 },
    ], NOW);
    assert.deepEqual(
      placed.map((point) => point.measuredAt.getTime() - NOW),
      [-3_540_000, -3_480_000],
    );
  });

  test("keeps placed points ordered and bridges chart segments through them", () => {
    const points: TemperaturePoint[] = [
      { measuredAt: new Date(NOW - 12 * 60_000), temperatureC: -20, timeQuality: "exact" },
      { measuredAt: new Date(NOW - 8 * 60_000), temperatureC: -19, timeQuality: "unplaced" },
      { measuredAt: new Date(NOW - 4 * 60_000), temperatureC: -18, timeQuality: "unplaced" },
      { measuredAt: new Date(NOW), temperatureC: -17, timeQuality: "exact" },
    ];
    const segments = temperatureChartSegments(points);
    assert.equal(segments.length, 3);
    assert.ok(segments.every((segment) => segment.timeQuality === "unplaced"));
  });
});
