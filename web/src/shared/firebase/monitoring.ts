import {
  Timestamp,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  type DocumentData,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseDb } from "./app";
import { sortAndDedupePoints } from "../monitoring/logic";
import type {
  MonitoringDevice,
  MonitoringDeviceState,
  MonitoringHistoryResult,
  MonitoringPeriod,
  TemperaturePoint,
} from "../types/monitoring";

export const DEFAULT_OFFLINE_THRESHOLD_MINUTES = 5;
export const HISTORY_PACKET_LIMITS: Record<MonitoringPeriod, number> = {
  hour: 180,
  day: 1_600,
};

function asDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (
    typeof value === "object"
    && value !== null
    && "toDate" in value
    && typeof value.toDate === "function"
  ) {
    const result = value.toDate();
    return result instanceof Date && Number.isFinite(result.getTime()) ? result : null;
  }
  return null;
}

function mapDevice(id: string, data: DocumentData): MonitoringDevice {
  return {
    id,
    name: typeof data.name === "string" && data.name.trim() ? data.name : id,
    enabled: data.enabled === true,
    clientId: typeof data.clientId === "string" ? data.clientId : undefined,
    targetType: data.targetType === "vehicle" || data.targetType === "chamber"
      ? data.targetType
      : undefined,
    targetId: typeof data.targetId === "string" ? data.targetId : undefined,
    isTest: data.isTest === true,
  };
}

function mapState(id: string, data: DocumentData): MonitoringDeviceState {
  return {
    deviceId: id,
    packetId: typeof data.packetId === "string" ? data.packetId : undefined,
    lastPacketId: typeof data.lastPacketId === "string" ? data.lastPacketId : undefined,
    temperatureC: typeof data.temperatureC === "number" && Number.isFinite(data.temperatureC)
      ? data.temperatureC
      : undefined,
    measuredAt: asDate(data.measuredAt),
    receivedAt: asDate(data.receivedAt),
    lastReceivedAt: asDate(data.lastReceivedAt),
    sampleCount: typeof data.sampleCount === "number" ? data.sampleCount : undefined,
  };
}

export function listenMonitoringDevices(
  onData: (devices: MonitoringDevice[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(collection(getFirebaseDb(), "monitoringDevices"), (snapshot) => {
    onData(snapshot.docs
      .map((item) => mapDevice(item.id, item.data()))
      .sort((left, right) => left.name.localeCompare(right.name, "ru")));
  }, onError);
}

export function listenMonitoringStates(
  onData: (states: Map<string, MonitoringDeviceState>) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(collection(getFirebaseDb(), "monitoringDeviceState"), (snapshot) => {
    onData(new Map(snapshot.docs.map((item) => [item.id, mapState(item.id, item.data())])));
  }, onError);
}

export function listenMonitoringSettings(
  onData: (offlineThresholdMinutes: number) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(doc(getFirebaseDb(), "settings", "monitoring"), (snapshot) => {
    const value = snapshot.data()?.offlineThresholdMinutes;
    onData(Number.isInteger(value) && value >= 1 && value <= 60
      ? value
      : DEFAULT_OFFLINE_THRESHOLD_MINUTES);
  }, onError);
}

export function saveOfflineThreshold(offlineThresholdMinutes: number): Promise<void> {
  return setDoc(doc(getFirebaseDb(), "settings", "monitoring"), {
    offlineThresholdMinutes,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

function historyWindowMs(period: MonitoringPeriod): number {
  return period === "hour" ? 60 * 60_000 : 24 * 60 * 60_000;
}

export function listenDeviceHistory(
  deviceId: string,
  period: MonitoringPeriod,
  onData: (result: MonitoringHistoryResult) => void,
  onError: (error: Error) => void,
  nowMs = Date.now(),
): Unsubscribe {
  const packetLimit = HISTORY_PACKET_LIMITS[period];
  const startedAt = Timestamp.fromMillis(nowMs - historyWindowMs(period));
  const packets = query(
    collection(getFirebaseDb(), "monitoringTelemetry", deviceId, "packets"),
    where("lastMeasuredAt", ">=", startedAt),
    orderBy("lastMeasuredAt", "desc"),
    limit(packetLimit + 1),
  );

  return onSnapshot(packets, (snapshot) => {
    const limitReached = snapshot.size > packetLimit;
    const selectedDocs = snapshot.docs.slice(0, packetLimit);
    const points: TemperaturePoint[] = [];
    selectedDocs.forEach((packet) => {
      const measurements = packet.data().measurements;
      if (!Array.isArray(measurements)) return;
      measurements.forEach((measurement) => {
        if (typeof measurement !== "object" || measurement === null) return;
        const measuredAt = asDate(measurement.measuredAt);
        const temperatureC = measurement.temperatureC;
        if (
          measuredAt
          && measuredAt.getTime() >= startedAt.toMillis()
          && measuredAt.getTime() <= nowMs + 10 * 60_000
          && typeof temperatureC === "number"
          && Number.isFinite(temperatureC)
        ) {
          points.push({ measuredAt, temperatureC });
        }
      });
    });
    onData({
      points: sortAndDedupePoints(points),
      packetCount: selectedDocs.length,
      limitReached,
    });
  }, onError);
}
