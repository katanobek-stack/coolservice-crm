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
import { isChartTimeQuality, monitoringPeriodMs, pointsInHistoryWindow } from "../monitoring/logic";
import type {
  MonitoringAlertEvent,
  MonitoringAlertEventState,
  MonitoringDevice,
  MonitoringControllerStatus,
  MonitoringDeviceState,
  MonitoringHistoryResult,
  MonitoringPeriod,
  MonitoringTemperatureRule,
  MonitoringTemperatureRuleInput,
  TemperaturePoint,
  UnplacedTemperaturePoint,
} from "../types/monitoring";

export const DEFAULT_OFFLINE_THRESHOLD_MINUTES = 5;
export const ALERT_EVENT_LIMIT = 200;
/** Overview starts only once dual-write points/rollups is authoritative. */
export const MONITORING_OVERVIEW_CUTOVER_MS = Date.parse("2026-09-22T00:00:00.000Z");

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

function mapControllerStatus(id: string, data: DocumentData): MonitoringControllerStatus | null {
  const registrationStates = ["home", "roaming", "searching", "denied", "unknown"] as const;
  const failureCodes = [
    "none", "modem_not_ready", "network_not_registered", "ntp_sync_failed",
    "gprs_connect_failed", "tcp_connect_failed", "mqtt_connect_failed",
    "publish_send_failed", "puback_timeout", "modem_restarted", "esp_restarted",
  ] as const;
  if (
    typeof data.statusId !== "string"
    || typeof data.networkRegistered !== "boolean"
    || typeof data.gprsConnected !== "boolean"
    || typeof data.mqttConnected !== "boolean"
    || !registrationStates.includes(data.registrationState)
    || !failureCodes.includes(data.lastFailureCode)
    || (data.rssi !== null && (!Number.isInteger(data.rssi) || data.rssi < 0 || data.rssi > 31))
    || !Number.isSafeInteger(data.queueDepth) || data.queueDepth < 0
    || !Number.isSafeInteger(data.uptimeSeconds) || data.uptimeSeconds < 0
  ) return null;
  return {
    controllerId: id,
    statusId: data.statusId,
    reportedAt: asDate(data.reportedAt),
    receivedAt: asDate(data.receivedAt),
    networkRegistered: data.networkRegistered,
    registrationState: data.registrationState,
    rssi: data.rssi,
    gprsConnected: data.gprsConnected,
    mqttConnected: data.mqttConnected,
    queueDepth: data.queueDepth,
    lastFailureCode: data.lastFailureCode,
    uptimeSeconds: data.uptimeSeconds,
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

export function listenMonitoringControllerStatuses(
  onData: (statuses: Map<string, MonitoringControllerStatus>) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(collection(getFirebaseDb(), "monitoringControllerStatus"), (snapshot) => {
    onData(new Map(snapshot.docs.flatMap((item) => {
      const status = mapControllerStatus(item.id, item.data());
      return status ? [[item.id, status] as const] : [];
    })));
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
  if (monitoringPeriodMs(period) > 24 * 60 * 60_000) {
    const cutover = Timestamp.fromMillis(Math.max(MONITORING_OVERVIEW_CUTOVER_MS, nowMs - monitoringPeriodMs(period)));
    const rollups = query(collection(getFirebaseDb(), "monitoringTelemetry", deviceId, "rollups"), where("hourStart", ">=", cutover), orderBy("hourStart", "asc"));
    return onSnapshot(rollups, (snapshot) => {
      const points: TemperaturePoint[] = [];
      snapshot.docs.forEach((item) => Object.values(item.data().buckets5m ?? {}).forEach((bucket: any) => Object.entries(bucket.aggregates ?? {}).forEach(([quality, aggregate]: [string, any]) => {
        if (!Number.isFinite(aggregate.minTemperatureC) || !Number.isFinite(aggregate.maxTemperatureC)) return;
        const measuredAt = asDate(bucket.bucketStart); if (!measuredAt) return;
        const [timeQuality, deliveryQuality] = quality.split("_");
        points.push({ measuredAt, temperatureC: aggregate.minTemperatureC, timeQuality: timeQuality === "estimated" ? "estimated" : "exact", deliveryQuality: deliveryQuality === "delayed" ? "delayed" : "realtime" });
        if (aggregate.maxTemperatureC !== aggregate.minTemperatureC) points.push({ measuredAt: new Date(measuredAt.getTime() + 1), temperatureC: aggregate.maxTemperatureC, timeQuality: timeQuality === "estimated" ? "estimated" : "exact", deliveryQuality: deliveryQuality === "delayed" ? "delayed" : "realtime" });
      })));
      onData({ points, packetCount: snapshot.size, limitReached: false });
    }, onError);
  }
  const startedAt = Timestamp.fromMillis(nowMs - monitoringPeriodMs(period));
  // Timed points are written one document per measurement and retained for
  // 35 days. Reading this projection avoids truncating a dense 12h/24h window
  // at the old 1000-packet cap (which made the chart look incomplete).
  const pointsQuery = query(
    collection(getFirebaseDb(), "monitoringTelemetry", deviceId, "points"),
    where("measuredAt", ">", startedAt),
    orderBy("measuredAt", "asc"),
  );

  return onSnapshot(pointsQuery, (snapshot) => {
    const points: TemperaturePoint[] = snapshot.docs.flatMap((point) => {
      const data = point.data();
      const measuredAt = asDate(data.measuredAt);
      const temperatureC = data.temperatureC;
      if (!measuredAt || typeof temperatureC !== "number" || !Number.isFinite(temperatureC)) return [];
      if (!isChartTimeQuality(data.timeQuality)) return [];
      return [{
        measuredAt,
        temperatureC,
        timeQuality: data.timeQuality === "estimated" ? "estimated" : "exact",
        deliveryQuality: data.deliveryQuality === "delayed" ? "delayed" : "realtime",
        receivedAt: asDate(data.receivedAt) ?? undefined,
      }];
    });
    onData({
      points: pointsInHistoryWindow(points, startedAt.toMillis(), nowMs),
      packetCount: snapshot.size,
      limitReached: false,
    });
  }, onError);
}

/**
 * Unplaced samples deliberately have no measuredAt, so they are read separately
 * from the time-window query and can never enter the chart/statistics pipeline.
 */
export function listenDeviceUnplacedHistory(
  deviceId: string,
  onData: (points: UnplacedTemperaturePoint[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const packets = query(
    collection(getFirebaseDb(), "monitoringTelemetry", deviceId, "packets"),
    where("hasUnplaced", "==", true),
    orderBy("receivedAt", "desc"),
    limit(50),
  );
  return onSnapshot(packets, (snapshot) => {
    const points: UnplacedTemperaturePoint[] = [];
    snapshot.docs.forEach((packet) => {
      const receivedAt = asDate(packet.data().receivedAt);
      const measurements = packet.data().measurements;
      if (!Array.isArray(measurements)) return;
      measurements.forEach((measurement, measurementIndex) => {
        if (typeof measurement !== "object" || measurement === null) return;
        if (measurement.timeQuality !== "unplaced") return;
        if (typeof measurement.temperatureC !== "number" || !Number.isFinite(measurement.temperatureC)) return;
        points.push({
          packetId: packet.id,
          sensorId: typeof measurement.sensorId === "string" ? measurement.sensorId : null,
          temperatureC: measurement.temperatureC,
          receivedAt,
          measurementIndex,
          deliveryQuality: measurement.deliveryQuality === "delayed" ? "delayed" : "realtime",
        });
      });
    });
    onData(points);
  }, onError);
}
