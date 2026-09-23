import type {
  MonitoringDeviceState,
  MonitoringControllerStatus,
  MonitoringPeriod,
  MonitoringTemperatureRule,
  MonitoringDeliveryQuality,
  TemperaturePoint,
} from "../types/monitoring";

export type ReadingStatus = "missing" | "stale" | "fresh";
export type ConnectionStatus = "unknown" | "offline" | "online";
export const MAX_RENDERED_TEMPERATURE_POINTS = 600;
export const MIN_CHART_WINDOW_MS = 60_000;

export interface ChartWindow {
  start: number;
  end: number;
}

/** Keeps a navigator window inside its base period without changing its span. */
export function normalizeChartWindow(
  window: ChartWindow,
  baseStart: number,
  baseEnd: number,
  minimumSpanMs = MIN_CHART_WINDOW_MS,
): ChartWindow {
  const baseSpan = Math.max(0, baseEnd - baseStart);
  const minimum = Math.min(minimumSpanMs, baseSpan);
  const requestedSpan = Math.max(minimum, Math.min(baseSpan, window.end - window.start));
  const start = Math.max(baseStart, Math.min(baseEnd - requestedSpan, window.start));
  return { start, end: start + requestedSpan };
}

export function chartXAxisTicks(window: ChartWindow, count = 5): number[] {
  if (count <= 1) return [window.start];
  const span = window.end - window.start;
  return Array.from({ length: count }, (_, index) => window.start + span * index / (count - 1));
}

export function panChartWindow(
  window: ChartWindow,
  baseStart: number,
  baseEnd: number,
  deltaMs: number,
): ChartWindow {
  return normalizeChartWindow({ start: window.start + deltaMs, end: window.end + deltaMs }, baseStart, baseEnd);
}

export function resizeChartWindow(
  window: ChartWindow,
  edge: "start" | "end",
  nextValue: number,
  baseStart: number,
  baseEnd: number,
): ChartWindow {
  const minimum = Math.min(MIN_CHART_WINDOW_MS, baseEnd - baseStart);
  if (edge === "start") {
    return {
      start: Math.max(baseStart, Math.min(nextValue, window.end - minimum)),
      end: window.end,
    };
  }
  return {
    start: window.start,
    end: Math.min(baseEnd, Math.max(nextValue, window.start + minimum)),
  };
}

export function zoomChartWindow(
  window: ChartWindow,
  baseStart: number,
  baseEnd: number,
  focusFraction: number,
  factor: number,
): ChartWindow {
  const span = window.end - window.start;
  const nextSpan = Math.max(
    Math.min(MIN_CHART_WINDOW_MS, baseEnd - baseStart),
    Math.min(baseEnd - baseStart, span * factor),
  );
  const focus = window.start + span * Math.max(0, Math.min(1, focusFraction));
  return normalizeChartWindow({
    start: focus - nextSpan * Math.max(0, Math.min(1, focusFraction)),
    end: focus + nextSpan * (1 - Math.max(0, Math.min(1, focusFraction))),
  }, baseStart, baseEnd);
}

/** Only samples with a usable device timestamp may enter chart/statistic points. */
export function isChartTimeQuality(
  timeQuality: unknown,
): timeQuality is "exact" | "estimated" | undefined {
  return timeQuality !== "unplaced";
}

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
    const normalized: TemperaturePoint = {
      ...point,
      timeQuality: point.timeQuality === "estimated" ? "estimated" : point.timeQuality === "unplaced" ? "unplaced" : "exact",
      deliveryQuality: point.deliveryQuality === "delayed" ? "delayed" : "realtime",
    };
    const timestamp = normalized.measuredAt.getTime();
    const existing = byTime.get(timestamp);
    // A recovered UTC reading is stronger evidence than an estimated duplicate.
    // At equal time quality, retain delayed delivery so an outage is not hidden.
    if (
      !existing
      || existing.timeQuality === "estimated" && normalized.timeQuality === "exact"
      || existing.timeQuality === normalized.timeQuality
        && existing.deliveryQuality === "realtime" && normalized.deliveryQuality === "delayed"
      || existing.timeQuality === normalized.timeQuality
        && existing.deliveryQuality === normalized.deliveryQuality
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
  // Keep extrema for every time/delivery quality combination in a bucket. This
  // avoids hiding a delayed interval merely because it is not a global spike.
  const bucketCount = Math.max(1, Math.floor((maxPoints - 2) / 8));
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
    const groups = new Map<string, TemperaturePoint[]>();
    bucket.forEach((point) => {
      const key = `${point.timeQuality ?? "exact"}:${point.deliveryQuality ?? "realtime"}`;
      groups.set(key, [...(groups.get(key) ?? []), point]);
    });
    groups.forEach((group) => {
      let minimum = group[0];
      let maximum = group[0];
      group.forEach((point) => {
        if (point.temperatureC < minimum.temperatureC) minimum = point;
        if (point.temperatureC > maximum.temperatureC) maximum = point;
      });
      retained.push(minimum);
      if (maximum.measuredAt.getTime() !== minimum.measuredAt.getTime()) retained.push(maximum);
    });
  });
  return sortAndDedupePoints(retained);
}

export interface TemperatureChartSegment {
  timeQuality: "exact" | "estimated" | "unplaced";
  deliveryQuality: "realtime" | "delayed";
  from: TemperaturePoint;
  to: TemperaturePoint;
}

/**
 * Neighbouring samples always connect into one continuous line. A segment is
 * styled by its "weaker" endpoint (unplaced over estimated over exact; delayed
 * over realtime), so a transition between online and offline runs is drawn in
 * the offline colour without breaking the chart.
 */
export function temperatureChartSegments(points: TemperaturePoint[]): TemperatureChartSegment[] {
  const sorted = sortAndDedupePoints(points);
  const segments: TemperatureChartSegment[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const from = sorted[index - 1];
    const to = sorted[index];
    const fromQuality = from.timeQuality ?? "exact";
    const toQuality = to.timeQuality ?? "exact";
    segments.push({
      timeQuality: fromQuality === "unplaced" || toQuality === "unplaced"
        ? "unplaced"
        : fromQuality === "estimated" || toQuality === "estimated"
          ? "estimated"
          : "exact",
      deliveryQuality: from.deliveryQuality === "delayed" || to.deliveryQuality === "delayed"
        ? "delayed"
        : "realtime",
      from,
      to,
    });
  }
  return segments;
}

export function monitoringPeriodMs(period: MonitoringPeriod): number {
  if (period === "hour") return 60 * 60_000;
  if (period === "halfDay") return 12 * 60 * 60_000;
  if (period === "day") return 24 * 60 * 60_000;
  if (period === "threeDays") return 3 * 24 * 60 * 60_000;
  if (period === "week") return 7 * 24 * 60 * 60_000;
  return 30 * 24 * 60 * 60_000;
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

export interface UnplacedCandidate {
  packetId: string;
  receivedAt: Date | null;
  measurementIndex: number;
  temperatureC: number;
  deliveryQuality?: MonitoringDeliveryQuality;
}

/** Flush packets of one reconnect arrive within seconds of each other. */
const FLUSH_PACKET_WINDOW_MS = 10_000;
/** Timed points delivered around the flush bracket an unplaced-only packet. */
const FLUSH_BRACKET_WINDOW_MS = 120_000;
const DEFAULT_SAMPLING_INTERVAL_MS = 60_000;

/**
 * Approximately places controller samples that have no reliable time on the
 * chart timeline: evenly distributed inside the timed span of their own
 * delivery flush, or between the last timed point before the outage and the
 * first timed point after it. The result is render-only — points keep
 * timeQuality "unplaced" so statistics and tooltips can distinguish them.
 */
export function placeUnplacedPoints(
  timedPoints: TemperaturePoint[],
  unplaced: UnplacedCandidate[],
  nowMs = Date.now(),
): TemperaturePoint[] {
  if (unplaced.length === 0) return [];
  const timed = sortAndDedupePoints(timedPoints);
  const ordered = [...unplaced].sort((left, right) => {
    const leftMs = left.receivedAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const rightMs = right.receivedAt?.getTime() ?? Number.POSITIVE_INFINITY;
    if (leftMs !== rightMs) return leftMs - rightMs;
    if (left.packetId !== right.packetId) return left.packetId.localeCompare(right.packetId);
    return left.measurementIndex - right.measurementIndex;
  });
  const groups = new Map<number, UnplacedCandidate[]>();
  ordered.forEach((candidate) => {
    const key = candidate.receivedAt?.getTime() ?? -1;
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  });
  const gaps: number[] = [];
  for (let index = 1; index < timed.length; index += 1) {
    const gap = timed[index].measuredAt.getTime() - timed[index - 1].measuredAt.getTime();
    if (gap > 0) gaps.push(gap);
  }
  gaps.sort((left, right) => left - right);
  const medianGap = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : DEFAULT_SAMPLING_INTERVAL_MS;

  const placed: TemperaturePoint[] = [];
  [...groups.entries()].sort((left, right) => left[0] - right[0]).forEach(([receivedMs, group]) => {
    let windowStart: number;
    let windowEnd: number;
    const flushTimed = receivedMs >= 0
      ? timed.filter((point) => {
        const pointReceivedMs = point.receivedAt?.getTime();
        return pointReceivedMs !== undefined
          && Math.abs(pointReceivedMs - receivedMs) <= FLUSH_PACKET_WINDOW_MS;
      })
      : [];
    if (flushTimed.length > 0) {
      const times = flushTimed.map((point) => point.measuredAt.getTime());
      windowStart = Math.min(...times);
      windowEnd = Math.max(...times);
    } else {
      const following = receivedMs >= 0
        ? timed.filter((point) => (
          point.receivedAt?.getTime() ?? Number.NEGATIVE_INFINITY
        ) >= receivedMs - FLUSH_BRACKET_WINDOW_MS)
        : [];
      const next = following.length > 0
        ? following.reduce((best, point) => (
          point.measuredAt.getTime() < best.measuredAt.getTime() ? point : best
        ))
        : undefined;
      if (next) {
        windowEnd = next.measuredAt.getTime();
        const previous = [...timed].reverse().find((point) => point.measuredAt.getTime() < windowEnd);
        windowStart = previous
          ? previous.measuredAt.getTime()
          : windowEnd - medianGap * (group.length + 1);
      } else {
        const last = timed[timed.length - 1];
        windowStart = last
          ? last.measuredAt.getTime()
          : nowMs - medianGap * (group.length + 1);
        windowEnd = windowStart + medianGap * (group.length + 1);
      }
    }
    const step = (windowEnd - windowStart) / (group.length + 1);
    group.forEach((candidate, index) => {
      placed.push({
        measuredAt: new Date(windowStart + step * (index + 1)),
        temperatureC: candidate.temperatureC,
        timeQuality: "unplaced",
        deliveryQuality: candidate.deliveryQuality === "delayed" ? "delayed" : "realtime",
        receivedAt: candidate.receivedAt,
      });
    });
  });
  return placed;
}
