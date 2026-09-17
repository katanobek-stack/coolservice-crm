import type {
  MonitoringDeviceState,
  MonitoringControllerStatus,
  MonitoringPeriod,
  MonitoringTemperatureRule,
  TemperaturePoint,
} from "../types/monitoring";

export type ReadingStatus = "missing" | "stale" | "fresh";
export type ConnectionStatus = "unknown" | "offline" | "online";

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
  points.forEach((point) => byTime.set(point.measuredAt.getTime(), point));
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
