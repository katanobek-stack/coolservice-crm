import {
  Timestamp,
  FieldPath,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getFirebaseDb } from "./app";
import { getFirebaseFunctions } from "./app";
import { monitoringPeriodMs, pointsInHistoryWindow } from "../monitoring/logic";
import type {
  MonitoringAlertEvent,
  MonitoringAlertEventState,
  MonitoringDevice,
  MonitoringDeviceState,
  MonitoringHistoryResult,
  MonitoringPeriod,
  MonitoringTemperatureRule,
  MonitoringTemperatureRuleInput,
  TemperaturePoint,
} from "../types/monitoring";

export const DEFAULT_OFFLINE_THRESHOLD_MINUTES = 5;
export const HISTORY_PACKET_LIMITS: Record<MonitoringPeriod, number> = {
  hour: 120,
  halfDay: 1_440,
  day: 2_880,
};
export const ALERT_EVENT_LIMIT = 200;

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
    alertActive: data.alertActive === true,
    activeAlertIds: typeof data.activeAlertIds === "object"
      && data.activeAlertIds !== null
      && !Array.isArray(data.activeAlertIds)
      ? Object.fromEntries(Object.entries(data.activeAlertIds).filter(
        ([ruleId, eventId]) => ruleId.length > 0 && typeof eventId === "string",
      )) as Record<string, string>
      : {},
  };
}

function mapTemperatureRule(id: string, data: DocumentData): MonitoringTemperatureRule | null {
  if (
    data.deleted === true
    || typeof data.name !== "string"
    || typeof data.enabled !== "boolean"
    || (data.direction !== "above" && data.direction !== "below")
    || typeof data.thresholdC !== "number"
    || !Number.isFinite(data.thresholdC)
    || !Number.isInteger(data.revision)
  ) return null;
  return {
    id,
    name: data.name,
    enabled: data.enabled,
    direction: data.direction,
    thresholdC: data.thresholdC,
    revision: data.revision,
  };
}

function mapAlertEvent(id: string, data: DocumentData): MonitoringAlertEvent | null {
  const detectedMeasuredAt = asDate(data.detectedMeasuredAt);
  const detectedReceivedAt = asDate(data.detectedReceivedAt);
  const lastExceededMeasuredAt = asDate(data.lastExceededMeasuredAt);
  const lastReceivedAt = asDate(data.lastReceivedAt);
  const validStates: MonitoringAlertEventState[] = [
    "active", "recovered", "historical", "closed_by_settings",
  ];
  const state = typeof data.state === "string"
    && validStates.includes(data.state as MonitoringAlertEventState)
    ? data.state as MonitoringAlertEventState
    : null;
  const validCloseReasons = ["rule_changed", "rule_disabled", "rule_deleted", "device_disabled"] as const;
  const closedReason = typeof data.closedReason === "string"
    && validCloseReasons.includes(data.closedReason as typeof validCloseReasons[number])
    ? data.closedReason as typeof validCloseReasons[number]
    : undefined;
  if (
    typeof data.deviceId !== "string"
    || typeof data.ruleId !== "string"
    || typeof data.ruleName !== "string"
    || !Number.isInteger(data.ruleRevision)
    || (data.direction !== "above" && data.direction !== "below")
    || typeof data.temperatureC !== "number"
    || typeof data.thresholdC !== "number"
    || !detectedMeasuredAt
    || !detectedReceivedAt
    || !lastExceededMeasuredAt
    || !lastReceivedAt
    || !state
  ) return null;
  const viewedBy: Record<string, Date> = {};
  if (typeof data.viewedBy === "object" && data.viewedBy !== null) {
    Object.entries(data.viewedBy).forEach(([uid, value]) => {
      const viewedAt = asDate(value);
      if (viewedAt) viewedBy[uid] = viewedAt;
    });
  }
  return {
    id,
    deviceId: data.deviceId,
    deviceName: typeof data.deviceName === "string" ? data.deviceName : data.deviceId,
    ruleId: data.ruleId,
    ruleName: data.ruleName,
    ruleRevision: data.ruleRevision,
    direction: data.direction,
    thresholdC: data.thresholdC,
    clientId: typeof data.clientId === "string" ? data.clientId : undefined,
    targetType: data.targetType === "vehicle" || data.targetType === "chamber"
      ? data.targetType
      : undefined,
    targetId: typeof data.targetId === "string" ? data.targetId : undefined,
    temperatureC: data.temperatureC,
    detectedMeasuredAt,
    detectedReceivedAt,
    lastExceededMeasuredAt,
    lastReceivedAt,
    peakTemperatureC: typeof data.peakTemperatureC === "number"
      ? data.peakTemperatureC
      : data.temperatureC,
    state,
    recoveredMeasuredAt: asDate(data.recoveredMeasuredAt),
    recoveryReceivedAt: asDate(data.recoveryReceivedAt),
    closedAt: asDate(data.closedAt),
    closedReason,
    viewedBy,
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

export function listenMonitoringTemperatureRules(
  deviceId: string,
  onData: (rules: MonitoringTemperatureRule[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(getFirebaseDb(), "monitoringDevices", deviceId, "temperatureRules"),
    (snapshot) => onData(snapshot.docs
      .map((item) => mapTemperatureRule(item.id, item.data()))
      .filter((rule): rule is MonitoringTemperatureRule => rule !== null)
      .sort((left, right) => left.name.localeCompare(right.name, "ru"))),
    onError,
  );
}

export async function saveMonitoringTemperatureRule(
  deviceId: string,
  rule: MonitoringTemperatureRuleInput,
): Promise<void> {
  const saveRule = httpsCallable(getFirebaseFunctions(), "saveMonitoringTemperatureRule");
  await saveRule({
    action: "upsert",
    deviceId,
    ruleId: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    direction: rule.direction,
    thresholdC: rule.thresholdC,
  });
}

export async function deleteMonitoringTemperatureRule(
  deviceId: string,
  ruleId: string,
): Promise<void> {
  const saveRule = httpsCallable(getFirebaseFunctions(), "saveMonitoringTemperatureRule");
  await saveRule({ action: "delete", deviceId, ruleId });
}

export function listenMonitoringAlerts(
  onData: (events: MonitoringAlertEvent[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const alerts = query(
    collection(getFirebaseDb(), "monitoringAlertEvents"),
    orderBy("detectedMeasuredAt", "desc"),
    limit(ALERT_EVENT_LIMIT),
  );
  return onSnapshot(alerts, (snapshot) => {
    onData(snapshot.docs
      .map((item) => mapAlertEvent(item.id, item.data()))
      .filter((event): event is MonitoringAlertEvent => event !== null));
  }, onError);
}

export function markMonitoringAlertViewed(eventId: string, uid: string): Promise<void> {
  return updateDoc(
    doc(getFirebaseDb(), "monitoringAlertEvents", eventId),
    new FieldPath("viewedBy", uid),
    serverTimestamp(),
  );
}

export function listenDeviceHistory(
  deviceId: string,
  period: MonitoringPeriod,
  onData: (result: MonitoringHistoryResult) => void,
  onError: (error: Error) => void,
  nowMs = Date.now(),
): Unsubscribe {
  const packetLimit = HISTORY_PACKET_LIMITS[period];
  const startedAt = Timestamp.fromMillis(nowMs - monitoringPeriodMs(period));
  const packets = query(
    collection(getFirebaseDb(), "monitoringTelemetry", deviceId, "packets"),
    where("lastMeasuredAt", ">", startedAt),
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
          && typeof temperatureC === "number"
          && Number.isFinite(temperatureC)
        ) {
          points.push({ measuredAt, temperatureC });
        }
      });
    });
    onData({
      points: pointsInHistoryWindow(points, startedAt.toMillis(), nowMs),
      packetCount: selectedDocs.length,
      limitReached,
    });
  }, onError);
}
