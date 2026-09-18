import type {
  MonitoringDeviceState,
  MonitoringControllerStatus,
  MonitoringPeriod,
  MonitoringTemperatureRule,
  TemperaturePoint,
} from "../types/monitoring";

export type ReadingStatus = "missing" | "stale" | "fresh";
export type ConnectionStatus = "unknown" | "offline" | "online";
export const MAX_RENDERED_TEMPERATURE_POINTS = 600;

export interface MonitoringStatus {
  reading: ReadingStatus;
  connection: ConnectionStatus;
}

export function controllerConnectionStatus(
  status: MonitoringControllerStatus | undefined,
  nowMs: number,
  offlineThresholdMinutes: number,
): ConnectionStatus {
  const reportedMs = status?.reportedAt?.getTime();
  if (reportedMs === undefined) return "unknown";
  return nowMs - reportedMs > offlineThresholdMinutes * 60_000 ? "offline" : "online";
}

export function monitoringStatus(
  state: MonitoringDeviceState | undefined,
  nowMs: number,
  offlineThresholdMinutes: number,
): MonitoringStatus {
  const thresholdMs = offlineThresholdMinutes * 60_000;
  const measuredMs = state?.measuredAt?.getTime();
  const receivedMs = (state?.lastReceivedAt ?? state?.receivedAt)?.getTime();

  return {
    reading: measuredMs === undefined
      ? "missing"
      : nowMs - measuredMs > thresholdMs ? "stale" : "fresh",
    connection: receivedMs === undefined
      ? "unknown"
      : nowMs - receivedMs > thresholdMs ? "offline" : "online",
  };
}

export function sortAndDedupePoints(points: TemperaturePoint[]): TemperaturePoint[] {
  const byTime = new Map<number, TemperaturePoint>();
  points.forEach((point) => {
    const normalized = point.timeQuality === "estimated" ? point : { ...point, timeQuality: "exact" as const };
    const timestamp = normalized.measuredAt.getTime();
    const existing = byTime.get(timestamp);
    // A recovered UTC reading is stronger evidence than an estimated duplicate.
    if (
      !existing
      || existing.timeQuality === normalized.timeQuality
      || existing.timeQuality === "estimated" && normalized.timeQuality === "exact"
    ) {
      byTime.set(timestamp, normalized);
    }
  });
  return [...byTime.values()].sort(
    (left, right) => left.measuredAt.getTime() - right.measuredAt.getTime(),
  );
}

export function pointsInHistoryWindow(
  points: TemperaturePoint[],
  startedAtMs: number,
  nowMs: number,
): TemperaturePoint[] {
  return sortAndDedupePoints(points.filter((point) => {
    const measuredAtMs = point.measuredAt.getTime();
    return measuredAtMs > startedAtMs && measuredAtMs <= nowMs + 10 * 60_000;
  }));
}

/** Limits SVG work without changing the full history used for statistics. */
export function downsampleTemperaturePoints(
  points: TemperaturePoint[],
  maxPoints = MAX_RENDERED_TEMPERATURE_POINTS,
): TemperaturePoint[] {
  const sorted = sortAndDedupePoints(points);
  if (sorted.length <= maxPoints || maxPoints < 3) return sorted;

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const bucketCount = Math.max(1, Math.floor((maxPoints - 2) / 2));
  const spanMs = Math.max(1, last.measuredAt.getTime() - first.measuredAt.getTime());
  const buckets: TemperaturePoint[][] = Array.from({ length: bucketCount }, () => []);

  sorted.slice(1, -1).forEach((point) => {
    const fraction = (point.measuredAt.getTime() - first.measuredAt.getTime()) / spanMs;
    const index = Math.min(bucketCount - 1, Math.max(0, Math.floor(fraction * bucketCount)));
    buckets[index].push(point);
  });

  const retained = [first, last];
  buckets.forEach((bucket) => {
    if (bucket.length === 0) return;
    let minimum = bucket[0];
    let maximum = bucket[0];
    bucket.forEach((point) => {
      if (point.temperatureC < minimum.temperatureC) minimum = point;
      if (point.temperatureC > maximum.temperatureC) maximum = point;
    });
    retained.push(minimum);
    if (maximum.measuredAt.getTime() !== minimum.measuredAt.getTime()) retained.push(maximum);
  });
  return sortAndDedupePoints(retained);
}

export interface TemperatureChartSegment {
  timeQuality: "exact" | "estimated";
  from: TemperaturePoint;
  to: TemperaturePoint;
}

/** A line never crosses a change between exact and estimated device time. */
export function temperatureChartSegments(points: TemperaturePoint[]): TemperatureChartSegment[] {
  const sorted = sortAndDedupePoints(points);
  const segments: TemperatureChartSegment[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const from = sorted[index - 1];
    const to = sorted[index];
    if (from.timeQuality === to.timeQuality) {
      segments.push({ timeQuality: from.timeQuality ?? "exact", from, to });
    }
  }
  return segments;
}

export function monitoringPeriodMs(period: MonitoringPeriod): number {
  if (period === "hour") return 60 * 60_000;
  if (period === "halfDay") return 12 * 60 * 60_000;
  return 24 * 60 * 60_000;
}

export function violatesTemperatureRule(
  temperatureC: number,
  rule: Pick<MonitoringTemperatureRule, "enabled" | "direction" | "thresholdC">,
): boolean {
  if (!rule.enabled) return false;
  return rule.direction === "above"
    ? temperatureC > rule.thresholdC
    : temperatureC < rule.thresholdC;
}
