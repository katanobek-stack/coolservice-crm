export type ServiceLogLevel = "ERROR" | "WARN" | "INFO";
export type ServiceControllerCommand = "SERVICE PING" | "SERVICE STATUS" | "SERVICE INFO";
export type ServiceConnectionState = "online" | "offline" | null;

export interface ServiceController {
  id: string;
  name: string;
  objectName: string;
  deviceId: string;
  enabled: boolean;
  lastHeartbeatAt: Date | null;
  lastReportedAt: Date | null;
  connectionState: ServiceConnectionState;
  lastStatusAt: Date | null;
  ip: string | null;
  simSignal: number | null;
  modemState: string;
  gprsConnected: boolean;
  firmwareVersion: string | null;
  uptimeSeconds: number | null;
  freeHeapBytes: number | null;
  flashBytes: number | null;
  psramBytes: number | null;
  resetReason: string | null;
  uartConnected: boolean | null;
}

export interface ServiceControllerLog {
  id: string;
  level: ServiceLogLevel;
  message: string;
  reportedAt: Date | null;
  receivedAt: Date | null;
}
