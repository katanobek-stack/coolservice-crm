export type MonitoringTargetType = "vehicle" | "chamber";
export type MonitoringPeriod = "hour" | "day";

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
}

export interface TemperaturePoint {
  measuredAt: Date;
  temperatureC: number;
}

export interface MonitoringHistoryResult {
  points: TemperaturePoint[];
  packetCount: number;
  limitReached: boolean;
}
