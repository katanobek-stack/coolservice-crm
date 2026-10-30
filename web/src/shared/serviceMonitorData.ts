import type { ServiceController, ServiceControllerCommand, ServiceControllerLog, ServiceCommandRecord, ServiceCommandStatus } from './types/serviceMonitor';

export const SERVICE_LOG_LIMIT = 150;
export const SERVICE_COMMAND_LIMIT = 20;
export const SERVICE_COMMANDS: ServiceControllerCommand[] = ['SERVICE PING', 'SERVICE STATUS', 'SERVICE INFO'];
function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    try { const date: unknown = value.toDate(); return date instanceof Date && Number.isFinite(date.getTime()) ? date : null; } catch { return null; }
  }
  return null;
}
const text = (value: unknown, fallback: string | null = null) => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const nonnegative = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
export function mapServiceController(id: string, data: Record<string, unknown>): ServiceController {
  const signal = nonnegative(data.simSignal);
  return {
    id, name: text(data.name, id)!, objectName: text(data.objectName, 'Объект не указан')!, deviceId: text(data.deviceId, id)!, enabled: data.enabled === true,
    lastHeartbeatAt: asDate(data.lastHeartbeatAt), lastReportedAt: asDate(data.lastReportedAt), lastStatusAt: asDate(data.lastStatusAt),
    connectionState: data.connectionState === 'online' || data.connectionState === 'offline' ? data.connectionState : null,
    ip: text(data.ip), simSignal: signal !== null && signal <= 31 ? signal : null, modemState: text(data.modemState, 'Нет данных')!,
    gprsConnected: typeof data.gprsConnected === 'boolean' ? data.gprsConnected : null, firmwareVersion: text(data.firmwareVersion),
    uptimeSeconds: nonnegative(data.uptimeSeconds), freeHeapBytes: nonnegative(data.freeHeapBytes), flashBytes: nonnegative(data.flashBytes), psramBytes: nonnegative(data.psramBytes),
    resetReason: text(data.resetReason), uartConnected: typeof data.uartConnected === 'boolean' ? data.uartConnected : null,
  };
}
export function mapServiceLog(id: string, data: Record<string, unknown>): ServiceControllerLog | null {
  if (!['ERROR', 'WARN', 'INFO'].includes(String(data.level)) || !text(data.message)) return null;
  return { id, level: data.level as ServiceControllerLog['level'], message: data.message as string, reportedAt: asDate(data.reportedAt), receivedAt: asDate(data.receivedAt) };
}
export function mapServiceCommand(id: string, data: Record<string, unknown>): ServiceCommandRecord | null {
  if (!SERVICE_COMMANDS.includes(data.command as ServiceControllerCommand)) return null;
  const statuses: string[] = ['queued', 'claimed', 'dispatched', 'completed', 'failed'];
  return { id, command: data.command as ServiceControllerCommand, status: statuses.includes(String(data.status)) ? data.status as ServiceCommandStatus : 'unknown', requestedAt: asDate(data.requestedAt), completedAt: asDate(data.completedAt), resultMessage: text(data.resultMessage) };
}
