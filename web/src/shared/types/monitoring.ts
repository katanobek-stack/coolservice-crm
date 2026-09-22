export type MonitoringTargetType = "vehicle" | "chamber";
export type MonitoringPeriod = "hour" | "halfDay" | "day" | "threeDays" | "week" | "month";
export type MonitoringAlertEventState = "active" | "recovered" | "historical" | "closed_by_settings";
export type MonitoringRuleDirection = "above" | "below";
export type MonitoringDeliveryQuality = "realtime" | "delayed";
export type MonitoringRegistrationState = "home" | "roaming" | "searching" | "denied" | "unknown";
export type MonitoringFailureCode =
  | "none"
  | "modem_not_ready"
  | "network_not_registered"
  | "ntp_sync_failed"
  | "gprs_connect_failed"
  | "tcp_connect_failed"
  | "mqtt_connect_failed"
  | "publish_send_failed"
  | "puback_timeout"
  | "modem_restarted"
  | "esp_restarted";

export interface MonitoringDevice {
  id: string;
  name: string;
  enabled: boolean;
  clientId?: string;
  targetType?: MonitoringTargetType;
  targetId?: string;
  isTest?: boolean;
}

export interface MonitoringDeviceState {
  deviceId: string;
  packetId?: string;
  lastPacketId?: string;
  temperatureC?: number;
  measuredAt: Date | null;
  receivedAt: Date | null;
  lastReceivedAt: Date | null;
  sampleCount?: number;
  alertActive: boolean;
  activeAlertIds: Record<string, string>;
}

export interface MonitoringControllerStatus {
  controllerId: string;
  statusId: string;
  reportedAt: Date | null;
  receivedAt: Date | null;
  networkRegistered: boolean;
  registrationState: MonitoringRegistrationState;
  rssi: number | null;
  gprsConnected: boolean;
  mqttConnected: boolean;
  queueDepth: number;
  lastFailureCode: MonitoringFailureCode;
  uptimeSeconds: number;
}

export interface TemperaturePoint {
  measuredAt: Date;
  temperatureC: number;
  /** Missing is accepted only for legacy in-memory callers and means exact. */
  timeQuality?: "exact" | "estimated";
  /** Missing is accepted only for legacy data and means realtime delivery. */
  deliveryQuality?: MonitoringDeliveryQuality;
}

export interface UnplacedTemperaturePoint {
  packetId: string;
  sensorId: string | null;
  temperatureC: number;
  receivedAt: Date | null;
  deliveryQuality?: MonitoringDeliveryQuality;
}

export interface MonitoringHistoryResult {
  points: TemperaturePoint[];
  packetCount: number;
  limitReached: boolean;
}

export interface MonitoringAlertEvent {
  id: string;
  deviceId: string;
  deviceName: string;
  ruleId: string;
  ruleName: string;
  ruleRevision: number;
  direction: MonitoringRuleDirection;
  thresholdC: number;
  clientId?: string;
  targetType?: MonitoringTargetType;
  targetId?: string;
  temperatureC: number;
  detectedMeasuredAt: Date;
  detectedReceivedAt: Date;
  lastExceededMeasuredAt: Date;
  lastReceivedAt: Date;
  peakTemperatureC: number;
  state: MonitoringAlertEventState;
  recoveredMeasuredAt: Date | null;
  recoveryReceivedAt: Date | null;
  closedAt: Date | null;
  closedReason?: "rule_changed" | "rule_disabled" | "rule_deleted" | "device_disabled";
  viewedBy: Record<string, Date>;
}

export interface MonitoringTemperatureRule {
  id: string;
  name: string;
  enabled: boolean;
  direction: MonitoringRuleDirection;
  thresholdC: number;
  revision: number;
}

export interface MonitoringTemperatureRuleInput {
  id: string;
  name: string;
  enabled: boolean;
  direction: MonitoringRuleDirection;
  thresholdC: number;
}
