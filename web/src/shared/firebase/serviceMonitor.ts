import {
  Timestamp,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  type DocumentData,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getFirebaseDb, getFirebaseFunctions } from "./app";
import type { ServiceController, ServiceControllerCommand, ServiceControllerLog } from "../types/serviceMonitor";
const LOG_LIMIT = 150;

function asDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === "object" && value !== null && "toDate" in value && typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && Number.isFinite(date.getTime()) ? date : null;
  }
  return null;
}

function asString(value: unknown, fallback: string | null = null): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function mapController(id: string, data: DocumentData): ServiceController {
  return {
    id,
    name: asString(data.name, id)!,
    objectName: asString(data.objectName, "Объект не указан")!,
    deviceId: asString(data.deviceId, id)!,
    enabled: data.enabled === true,
    lastHeartbeatAt: asDate(data.lastHeartbeatAt),
    lastReportedAt: asDate(data.lastReportedAt),
    ip: asString(data.ip),
    simSignal: Number.isInteger(data.simSignal) && data.simSignal >= 0 && data.simSignal <= 31 ? data.simSignal : null,
    modemState: asString(data.modemState, "Нет данных")!,
    gprsConnected: data.gprsConnected === true,
    firmwareVersion: asString(data.firmwareVersion),
    uptimeSeconds: Number.isSafeInteger(data.uptimeSeconds) && data.uptimeSeconds >= 0 ? data.uptimeSeconds : null,
    freeHeapBytes: Number.isSafeInteger(data.freeHeapBytes) && data.freeHeapBytes >= 0 ? data.freeHeapBytes : null,
    flashBytes: Number.isSafeInteger(data.flashBytes) && data.flashBytes >= 0 ? data.flashBytes : null,
    psramBytes: Number.isSafeInteger(data.psramBytes) && data.psramBytes >= 0 ? data.psramBytes : null,
    resetReason: asString(data.resetReason),
    uartConnected: typeof data.uartConnected === "boolean" ? data.uartConnected : null,
  };
}

function mapLog(id: string, data: DocumentData): ServiceControllerLog | null {
  if (data.level !== "ERROR" && data.level !== "WARN" && data.level !== "INFO") return null;
  if (typeof data.message !== "string" || !data.message.trim()) return null;
  return { id, level: data.level, message: data.message, reportedAt: asDate(data.reportedAt), receivedAt: asDate(data.receivedAt) };
}

export function listenServiceControllers(onData: (controllers: ServiceController[]) => void, onError: (error: Error) => void): Unsubscribe {
  return onSnapshot(collection(getFirebaseDb(), "serviceControllers"), (snapshot) => {
    onData(snapshot.docs.map((item) => mapController(item.id, item.data()))
      .sort((left, right) => left.name.localeCompare(right.name, "ru")));
  }, onError);
}

export function listenServiceControllerLogs(controllerId: string, onData: (logs: ServiceControllerLog[]) => void, onError: (error: Error) => void): Unsubscribe {
  const entries = query(
    collection(getFirebaseDb(), "serviceControllerLogs", controllerId, "entries"),
    orderBy("receivedAt", "desc"),
    limit(LOG_LIMIT),
  );
  return onSnapshot(entries, (snapshot) => onData(snapshot.docs
    .map((item) => mapLog(item.id, item.data()))
    .filter((item): item is ServiceControllerLog => item !== null)), onError);
}

export async function queueServiceControllerCommand(controllerId: string, command: ServiceControllerCommand): Promise<{ commandId: string }> {
  const queueCommand = httpsCallable<{ controllerId: string; command: ServiceControllerCommand }, { commandId: string }>(getFirebaseFunctions(), "queueServiceControllerCommand");
  const result = await queueCommand({ controllerId, command });
  return result.data;
}
