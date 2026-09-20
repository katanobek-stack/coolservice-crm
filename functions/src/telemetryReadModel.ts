import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";

export const DEFAULT_SENSOR_ID = "default";
export const RAW_POINT_RETENTION_MS = 35 * 24 * 60 * 60 * 1000;
export const ROLLUP_RETENTION_MS = 13 * 31 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

export type TimeQuality = "exact" | "estimated";
export type DeliveryQuality = "realtime" | "delayed";
export type QualityKey = `${TimeQuality}_${DeliveryQuality}`;

export interface ReadModelMeasurement {
  packetId: string;
  measurementIndex: number;
  sensorId?: string;
  temperatureC: number;
  measuredAt?: Date;
  timeQuality: TimeQuality | "unplaced";
  deliveryQuality: DeliveryQuality;
}

type Aggregate = {
  count: number;
  sumTemperatureC: number;
  minTemperatureC: number;
  maxTemperatureC: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validAggregate(value: unknown): Aggregate | null {
  if (!isRecord(value)) return null;
  const { count, sumTemperatureC, minTemperatureC, maxTemperatureC } = value;
  if (
    typeof count !== "number" || !Number.isFinite(count)
    || typeof sumTemperatureC !== "number" || !Number.isFinite(sumTemperatureC)
    || typeof minTemperatureC !== "number" || !Number.isFinite(minTemperatureC)
    || typeof maxTemperatureC !== "number" || !Number.isFinite(maxTemperatureC)
  ) {
    return null;
  }
  return { count, sumTemperatureC, minTemperatureC, maxTemperatureC };
}

function addAggregate(existing: unknown, temperatureC: number): Aggregate {
  const previous = validAggregate(existing);
  if (!previous) {
    return { count: 1, sumTemperatureC: temperatureC, minTemperatureC: temperatureC, maxTemperatureC: temperatureC };
  }
  return {
    count: previous.count + 1,
    sumTemperatureC: previous.sumTemperatureC + temperatureC,
    minTemperatureC: Math.min(previous.minTemperatureC, temperatureC),
    maxTemperatureC: Math.max(previous.maxTemperatureC, temperatureC),
  };
}

export function normalizedSensorId(sensorId: string | undefined): string {
  return sensorId ?? DEFAULT_SENSOR_ID;
}

export function stableMeasurementId(packetId: string, measurementIndex: number): string {
  // A hash makes every valid packet id safe as a Firestore document id while
  // retaining packetId/index as auditable fields in the document itself.
  return createHash("sha256").update(`${packetId}\u0000${measurementIndex}`).digest("base64url");
}

export function rollupDocumentId(sensorId: string, measuredAtMs: number): string {
  const hourStartMs = Math.floor(measuredAtMs / HOUR_MS) * HOUR_MS;
  return `${sensorId}__${hourStartMs}`;
}

export function pointDocumentData(deviceId: string, measurement: ReadModelMeasurement, receivedAt: Timestamp): Record<string, unknown> {
  const sensorId = normalizedSensorId(measurement.sensorId);
  const common = {
    schemaVersion: 1,
    deviceId,
    packetId: measurement.packetId,
    measurementIndex: measurement.measurementIndex,
    sensorId,
    temperatureC: measurement.temperatureC,
    timeQuality: measurement.timeQuality,
    deliveryQuality: measurement.deliveryQuality,
    receivedAt,
    expireAt: Timestamp.fromMillis(receivedAt.toMillis() + RAW_POINT_RETENTION_MS),
  };
  return measurement.measuredAt
    ? { ...common, measuredAt: Timestamp.fromDate(measurement.measuredAt) }
    : common;
}

export function nextRollupData(
  existing: Record<string, unknown> | undefined,
  deviceId: string,
  measurement: ReadModelMeasurement,
  receivedAt: Timestamp,
): Record<string, unknown> {
  if (!measurement.measuredAt || measurement.timeQuality === "unplaced") {
    throw new Error("unplaced measurements do not belong in timed rollups");
  }
  const measuredAtMs = measurement.measuredAt.getTime();
  const hourStartMs = Math.floor(measuredAtMs / HOUR_MS) * HOUR_MS;
  const bucketStartMs = Math.floor(measuredAtMs / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
  const sensorId = normalizedSensorId(measurement.sensorId);
  const qualityKey: QualityKey = `${measurement.timeQuality}_${measurement.deliveryQuality}`;
  const existingAggregates = isRecord(existing?.aggregates) ? existing.aggregates : {};
  const existingBuckets = isRecord(existing?.buckets5m) ? existing.buckets5m : {};
  const bucketKey = String(bucketStartMs);
  const existingBucket = isRecord(existingBuckets[bucketKey]) ? existingBuckets[bucketKey] : {};
  const bucketAggregates = isRecord(existingBucket.aggregates) ? existingBucket.aggregates : {};

  return {
    schemaVersion: 1,
    deviceId,
    sensorId,
    hourStart: Timestamp.fromMillis(hourStartMs),
    hourEnd: Timestamp.fromMillis(hourStartMs + HOUR_MS),
    aggregates: {
      ...existingAggregates,
      [qualityKey]: addAggregate(existingAggregates[qualityKey], measurement.temperatureC),
    },
    buckets5m: {
      ...existingBuckets,
      [bucketKey]: {
        bucketStart: Timestamp.fromMillis(bucketStartMs),
        bucketEnd: Timestamp.fromMillis(bucketStartMs + FIVE_MINUTES_MS),
        aggregates: {
          ...bucketAggregates,
          [qualityKey]: addAggregate(bucketAggregates[qualityKey], measurement.temperatureC),
        },
      },
    },
    updatedAt: receivedAt,
    expireAt: Timestamp.fromMillis(receivedAt.toMillis() + ROLLUP_RETENTION_MS),
  };
}

export function isTimedReadModelMeasurement(measurement: ReadModelMeasurement): measurement is ReadModelMeasurement & { measuredAt: Date; timeQuality: TimeQuality } {
  return measurement.measuredAt !== undefined && measurement.timeQuality !== "unplaced";
}
