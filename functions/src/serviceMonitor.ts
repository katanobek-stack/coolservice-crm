import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { verifyDeviceKey } from "./telemetryKey";

const REGION = "europe-west1";
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const MAX_DEVICE_KEY_LENGTH = 256;
const MIN_DEVICE_KEY_LENGTH = 32;
const MAX_LOGS_PER_HEARTBEAT = 40;
const MAX_LOG_MESSAGE_LENGTH = 600;

export const SERVICE_CONTROLLER_COMMANDS = [
  "SERVICE PING",
  "SERVICE STATUS",
  "SERVICE INFO",
] as const;

export type ServiceControllerCommand = typeof SERVICE_CONTROLLER_COMMANDS[number];
export type ServiceLogLevel = "ERROR" | "WARN" | "INFO";

export interface ServiceHeartbeat {
  controllerId: string;
  heartbeatId: string;
  reportedAt: Date;
  ip: string | null;
  simSignal: number | null;
  modemState: string;
  gprsConnected: boolean;
  firmwareVersion: string;
  uptimeSeconds: number;
  freeHeapBytes: number;
  flashBytes: number;
  psramBytes: number;
  resetReason: string;
  uartConnected: boolean;
  logs: Array<{ id: string; level: ServiceLogLevel; message: string; reportedAt: Date }>;
}

class ValidationError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, field: string, maxLength: number, required = true): string | null {
  if (value === undefined && !required) return null;
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new ValidationError(`${field} is invalid`);
  }
  return value.trim();
}

function nonNegativeInteger(value: unknown, field: string, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) {
    throw new ValidationError(`${field} is invalid`);
  }
  return value as number;
}

function parseUtc(value: unknown, field: string): Date {
  if (typeof value !== "string" || !ISO_UTC_PATTERN.test(value)) throw new ValidationError(`${field} is invalid`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new ValidationError(`${field} is invalid`);
  return parsed;
}

function allowedKeys(data: Record<string, unknown>, keys: readonly string[]): void {
  if (!Object.keys(data).every((key) => keys.includes(key))) throw new ValidationError("unexpected field");
}

function parseLog(value: unknown, heartbeatId: string, index: number): ServiceHeartbeat["logs"][number] {
  if (!isRecord(value)) throw new ValidationError("log is invalid");
  allowedKeys(value, ["id", "level", "message", "reportedAt"]);
  const id = value.id === undefined ? `${heartbeatId}:${index}` : stringField(value.id, "log.id", 96)!;
  if (!EVENT_ID_PATTERN.test(id)) throw new ValidationError("log.id is invalid");
  if (value.level !== "ERROR" && value.level !== "WARN" && value.level !== "INFO") {
    throw new ValidationError("log.level is invalid");
  }
  return {
    id,
    level: value.level,
    message: stringField(value.message, "log.message", MAX_LOG_MESSAGE_LENGTH)!,
    reportedAt: value.reportedAt === undefined ? new Date() : parseUtc(value.reportedAt, "log.reportedAt"),
  };
}

/** Parses only the documented heartbeat schema; it never accepts an AT command. */
export function parseServiceHeartbeat(value: unknown): ServiceHeartbeat {
  if (!isRecord(value)) throw new ValidationError("body must be an object");
  allowedKeys(value, [
    "controllerId", "heartbeatId", "reportedAt", "ip", "simSignal", "modemState",
    "gprsConnected", "firmwareVersion", "uptimeSeconds", "freeHeapBytes", "flashBytes",
    "psramBytes", "resetReason", "uartConnected", "logs",
  ]);
  const controllerId = stringField(value.controllerId, "controllerId", 64)!;
  const heartbeatId = stringField(value.heartbeatId, "heartbeatId", 96)!;
  if (!ID_PATTERN.test(controllerId) || !EVENT_ID_PATTERN.test(heartbeatId)) throw new ValidationError("controllerId or heartbeatId is invalid");
  if (value.ip !== null && value.ip !== undefined && (typeof value.ip !== "string" || value.ip.length > 64)) {
    throw new ValidationError("ip is invalid");
  }
  if (
    value.simSignal !== null &&
    value.simSignal !== undefined &&
    (typeof value.simSignal !== "number" ||
      !Number.isInteger(value.simSignal) ||
      value.simSignal < 0 ||
      value.simSignal > 31)
  ) {
    throw new ValidationError("simSignal is invalid");
  }
  if (typeof value.gprsConnected !== "boolean" || typeof value.uartConnected !== "boolean") {
    throw new ValidationError("connection field is invalid");
  }
  if (!Array.isArray(value.logs) || value.logs.length > MAX_LOGS_PER_HEARTBEAT) throw new ValidationError("logs are invalid");
  return {
    controllerId,
    heartbeatId,
    reportedAt: parseUtc(value.reportedAt, "reportedAt"),
    ip: typeof value.ip === "string" ? value.ip : null,
    simSignal: typeof value.simSignal === "number" ? value.simSignal : null,
    modemState: stringField(value.modemState, "modemState", 80)!,
    gprsConnected: value.gprsConnected,
    firmwareVersion: stringField(value.firmwareVersion, "firmwareVersion", 120)!,
    uptimeSeconds: nonNegativeInteger(value.uptimeSeconds, "uptimeSeconds"),
    freeHeapBytes: nonNegativeInteger(value.freeHeapBytes, "freeHeapBytes"),
    flashBytes: nonNegativeInteger(value.flashBytes, "flashBytes"),
    psramBytes: nonNegativeInteger(value.psramBytes, "psramBytes"),
    resetReason: stringField(value.resetReason, "resetReason", 120)!,
    uartConnected: value.uartConnected,
    logs: value.logs.map((item, index) => parseLog(item, heartbeatId, index)),
  };
}

export function isAllowedServiceControllerCommand(value: unknown): value is ServiceControllerCommand {
  return typeof value === "string" && (SERVICE_CONTROLLER_COMMANDS as readonly string[]).includes(value);
}

function readBearerToken(header: string | undefined): string | null {
  const match = /^Bearer ([^\s]+)$/.exec(header ?? "");
  if (!match || match[1].length < MIN_DEVICE_KEY_LENGTH || match[1].length > MAX_DEVICE_KEY_LENGTH) return null;
  return match[1];
}

async function assertManager(uid: string, tokenRole: unknown): Promise<void> {
  if (tokenRole === "owner") return;
  const profile = await getFirestore().doc(`staff/${uid}`).get();
  if (!profile.exists || !["owner", "admin", "manager"].includes(profile.data()?.role)) {
    throw new HttpsError("permission-denied", "Manager role is required");
  }
}

export const ingestServiceControllerHeartbeat = onRequest(
  { region: REGION, cors: false, invoker: "public", timeoutSeconds: 30, memory: "256MiB" },
  async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (request.method !== "POST") { response.status(405).json({ error: "method_not_allowed" }); return; }
    if (!request.is("application/json")) { response.status(415).json({ error: "application_json_required" }); return; }
    const deviceKey = readBearerToken(request.get("authorization"));
    if (!deviceKey) { response.status(401).json({ error: "invalid_device_credentials" }); return; }

    let heartbeat: ServiceHeartbeat;
    try { heartbeat = parseServiceHeartbeat(request.body); } catch {
      response.status(400).json({ error: "invalid_heartbeat" });
      return;
    }
    const firestore = getFirestore();
    const controllerRef = firestore.doc(`serviceControllers/${heartbeat.controllerId}`);
    const credentialRef = firestore.doc(`monitoringDeviceCredentials/${heartbeat.controllerId}`);
    const heartbeatRef = controllerRef.collection("heartbeats").doc(heartbeat.heartbeatId);
    const receivedAt = Timestamp.now();
    try {
      const result = await firestore.runTransaction(async (transaction) => {
        const [controller, credential, existing] = await Promise.all([
          transaction.get(controllerRef), transaction.get(credentialRef), transaction.get(heartbeatRef),
        ]);
        if (!controller.exists || controller.data()?.enabled !== true) throw new HttpsError("not-found", "Controller is not registered");
        if (!credential.exists || !verifyDeviceKey(heartbeat.controllerId, deviceKey, credential.data()!)) {
          throw new HttpsError("unauthenticated", "Invalid device credentials");
        }
        if (existing.exists) return { outcome: "duplicate" as const, logsCreated: 0 };
        transaction.set(heartbeatRef, {
          heartbeatId: heartbeat.heartbeatId, reportedAt: Timestamp.fromDate(heartbeat.reportedAt), receivedAt,
        });
        transaction.set(controllerRef, {
          lastHeartbeatAt: receivedAt,
          lastReportedAt: Timestamp.fromDate(heartbeat.reportedAt),
          ip: heartbeat.ip, simSignal: heartbeat.simSignal, modemState: heartbeat.modemState,
          gprsConnected: heartbeat.gprsConnected, firmwareVersion: heartbeat.firmwareVersion,
          uptimeSeconds: heartbeat.uptimeSeconds, freeHeapBytes: heartbeat.freeHeapBytes,
          flashBytes: heartbeat.flashBytes, psramBytes: heartbeat.psramBytes,
          resetReason: heartbeat.resetReason, uartConnected: heartbeat.uartConnected,
          updatedAt: receivedAt,
        }, { merge: true });
        heartbeat.logs.forEach((log) => transaction.set(
          firestore.doc(`serviceControllerLogs/${heartbeat.controllerId}/entries/${log.id}`),
          { ...log, reportedAt: Timestamp.fromDate(log.reportedAt), receivedAt, heartbeatId: heartbeat.heartbeatId },
          { merge: false },
        ));
        return { outcome: "stored" as const, logsCreated: heartbeat.logs.length };
      });
      response.status(result.outcome === "stored" ? 202 : 200).json({ heartbeatId: heartbeat.heartbeatId, ...result });
    } catch (error) {
      if (error instanceof HttpsError && error.code === "unauthenticated") { response.status(401).json({ error: "invalid_device_credentials" }); return; }
      if (error instanceof HttpsError && error.code === "not-found") { response.status(404).json({ error: "controller_not_registered" }); return; }
      response.status(500).json({ error: "heartbeat_storage_failed" });
    }
  },
);

export const queueServiceControllerCommand = onCall(
  { region: REGION, timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Authentication is required");
    await assertManager(request.auth.uid, request.auth.token.role);
    if (!isRecord(request.data) || typeof request.data.controllerId !== "string" || !ID_PATTERN.test(request.data.controllerId)) {
      throw new HttpsError("invalid-argument", "Controller is invalid");
    }
    if (!isAllowedServiceControllerCommand(request.data.command)) {
      throw new HttpsError("invalid-argument", "Command is not allowed");
    }
    const firestore = getFirestore();
    const controllerRef = firestore.doc(`serviceControllers/${request.data.controllerId}`);
    const controller = await controllerRef.get();
    if (!controller.exists || controller.data()?.enabled !== true) throw new HttpsError("not-found", "Controller is not registered");
    const commandRef = firestore.collection(`serviceControllerCommands/${request.data.controllerId}/commands`).doc();
    await commandRef.set({
      command: request.data.command,
      status: "queued",
      requestedBy: request.auth.uid,
      requestedAt: Timestamp.now(),
    });
    return { commandId: commandRef.id, command: request.data.command, status: "queued" };
  },
);
