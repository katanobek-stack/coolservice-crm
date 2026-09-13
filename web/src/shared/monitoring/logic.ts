import type { MonitoringDeviceState, TemperaturePoint } from "../types/monitoring";

export type ReadingStatus = "missing" | "stale" | "fresh";
export type ConnectionStatus = "unknown" | "offline" | "online";

export interface MonitoringStatus {
  reading: ReadingStatus;
  connection: ConnectionStatus;
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
  points.forEach((point) => byTime.set(point.measuredAt.getTime(), point));
  return [...byTime.values()].sort(
    (left, right) => left.measuredAt.getTime() - right.measuredAt.getTime(),
  );
}

export function splitAtGaps(
  points: TemperaturePoint[],
  gapThresholdMs = 30_000,
): TemperaturePoint[][] {
  const sorted = sortAndDedupePoints(points);
  const segments: TemperaturePoint[][] = [];
  sorted.forEach((point) => {
    const segment = segments[segments.length - 1];
    const previous = segment?.[segment.length - 1];
    if (!previous || point.measuredAt.getTime() - previous.measuredAt.getTime() > gapThresholdMs) {
      segments.push([point]);
    } else {
      segment.push(point);
    }
  });
  return segments;
}

export function downsampleSegments(
  segments: TemperaturePoint[][],
  maximumPoints = 1_200,
): TemperaturePoint[][] {
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (total <= maximumPoints) return segments;
  const stride = Math.ceil(total / maximumPoints);
  return segments.map((segment) => {
    if (segment.length <= 2) return segment;
    const sampled = segment.filter((_, index) => index === 0 || index % stride === 0);
    const last = segment[segment.length - 1];
    if (sampled[sampled.length - 1] !== last) sampled.push(last);
    return sampled;
  });
}
