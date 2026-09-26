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
const COMMAND_CLAIM_TIMEOUT_MS = 2 * 60_000;

export const SERVICE_CONTROLLER_COMMANDS = [
  "SERVICE PING",
  "SERVICE STATUS",
  "SERVICE INFO",
] as const;

export type ServiceControllerCommand = typeof SERVICE_CONTROLLER_COMMANDS[number];
export type ServiceLogLevel = "ERROR" | "WARN" | "INFO";
export type ServiceConnectionState = "online" | "offline";
export type ServiceCommandResult = "ok" | "error";

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

export interface ServiceLogMessage {
  controllerId: string;
  logId: string;
  reportedAt: Date;
  level: ServiceLogLevel;
  message: string;
}

export interface ServiceStatus {
  controllerId: string;
  statusId: string;
  reportedAt: Date;
  state: ServiceConnectionState;
}

export interface ServiceCommandResultMessage {
  controllerId: string;
  commandId: string;
  reportedAt: Date;
  result: ServiceCommandResult;
  message: string;
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
  const rawLogs = value.logs === undefined ? [] : value.logs;
  if (!Array.isArray(rawLogs) || rawLogs.length > MAX_LOGS_PER_HEARTBEAT) throw new ValidationError("logs are invalid");
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
    logs: rawLogs.map((item, index) => parseLog(item, heartbeatId, index)),
  };
}

export function isAllowedServiceControllerCommand(value: unknown): value is ServiceControllerCommand {
  return typeof value === "string" && (SERVICE_CONTROLLER_COMMANDS as readonly string[]).includes(value);
}

export function parseServiceLogMessage(value: unknown): ServiceLogMessage {
  if (!isRecord(value)) throw new ValidationError("body must be an object");
  allowedKeys(value, ["controllerId", "logId", "reportedAt", "level", "message"]);
  const controllerId = stringField(value.controllerId, "controllerId", 64)!;
  const logId = stringField(value.logId, "logId", 96)!;
  if (!ID_PATTERN.test(controllerId) || !EVENT_ID_PATTERN.test(logId)) throw new ValidationError("controllerId or logId is invalid");
  if (value.level !== "ERROR" && value.level !== "WARN" && value.level !== "INFO") throw new ValidationError("log.level is invalid");
  return {
    controllerId,
    logId,
    reportedAt: parseUtc(value.reportedAt, "reportedAt"),
    level: value.level,
    message: stringField(value.message, "message", MAX_LOG_MESSAGE_LENGTH)!,
  };
}

export function parseServiceStatus(value: unknown): ServiceStatus {
  if (!isRecord(value)) throw new ValidationError("body must be an object");
  allowedKeys(value, ["controllerId", "statusId", "reportedAt", "state"]);
  const controllerId = stringField(value.controllerId, "controllerId", 64)!;
  const statusId = stringField(value.statusId, "statusId", 96)!;
  if (!ID_PATTERN.test(controllerId) || !EVENT_ID_PATTERN.test(statusId)) throw new ValidationError("controllerId or statusId is invalid");
  if (value.state !== "online" && value.state !== "offline") throw new ValidationError("state is invalid");
  return { controllerId, statusId, reportedAt: parseUtc(value.reportedAt, "reportedAt"), state: value.state };
}

export function parseServiceCommandResult(value: unknown): ServiceCommandResultMessage {
  if (!isRecord(value)) throw new ValidationError("body must be an object");
  allowedKeys(value, ["controllerId", "commandId", "reportedAt", "result", "message"]);
  const controllerId = stringField(value.controllerId, "controllerId", 64)!;
  const commandId = stringField(value.commandId, "commandId", 96)!;
  if (!ID_PATTERN.test(controllerId) || !EVENT_ID_PATTERN.test(commandId)) throw new ValidationError("controllerId or commandId is invalid");
  if (value.result !== "ok" && value.result !== "error") throw new ValidationError("result is invalid");
  return {
    controllerId,
    commandId,
    reportedAt: parseUtc(value.reportedAt, "reportedAt"),
    result: value.result,
    message: stringField(value.message, "message", MAX_LOG_MESSAGE_LENGTH)!,
  };
}

function readBearerToken(header: string | undefined): string | null {
  const match = /^Bearer ([^\s]+)$/.exec(header ?? "");
  if (!match || match[1].length < MIN_DEVICE_KEY_LENGTH || match[1].length > MAX_DEVICE_KEY_LENGTH) return null;
  return match[1];
}

async function authenticateServiceController(controllerId: string, deviceKey: string): Promise<boolean> {
  const firestore = getFirestore();
  const [controller, credential] = await firestore.getAll(
    firestore.doc(`serviceControllers/${controllerId}`),
    firestore.doc(`monitoringDeviceCredentials/${controllerId}`),
  );
  return controller.exists
    && controller.data()?.enabled === true
    && credential.exists
    && verifyDeviceKey(controllerId, deviceKey, credential.data()!);
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

/**
 * MQTT bridge endpoint for service/{controllerId}/log. It is intentionally
 * separate from heartbeat so a burst of log entries cannot delay a heartbeat.
 */
export const ingestServiceControllerLog = onRequest(
  { region: REGION, cors: false, invoker: "public", timeoutSeconds: 30, memory: "256MiB" },
  async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (request.method !== "POST") { response.status(405).json({ error: "method_not_allowed" }); return; }
    if (!request.is("application/json")) { response.status(415).json({ error: "application_json_required" }); return; }
    const deviceKey = readBearerToken(request.get("authorization"));
    let log: ServiceLogMessage;
    try { log = parseServiceLogMessage(request.body); } catch { response.status(400).json({ error: "invalid_log" }); return; }
    if (!deviceKey || !await authenticateServiceController(log.controllerId, deviceKey)) {
      response.status(401).json({ error: "invalid_device_credentials" }); return;
    }
    const firestore = getFirestore();
    const entryRef = firestore.doc(`serviceControllerLogs/${log.controllerId}/entries/${log.logId}`);
    const receivedAt = Timestamp.now();
    const outcome = await firestore.runTransaction(async (transaction) => {
      if ((await transaction.get(entryRef)).exists) return "duplicate" as const;
      transaction.set(entryRef, {
        ...log, reportedAt: Timestamp.fromDate(log.reportedAt), receivedAt,
      });
      return "stored" as const;
    });
    response.status(outcome === "stored" ? 202 : 200).json({ logId: log.logId, outcome });
  },
);

/** MQTT bridge endpoint for retained service/{controllerId}/status, including LWT offline. */
export const ingestServiceControllerStatus = onRequest(
  { region: REGION, cors: false, invoker: "public", timeoutSeconds: 30, memory: "256MiB" },
  async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (request.method !== "POST") { response.status(405).json({ error: "method_not_allowed" }); return; }
    if (!request.is("application/json")) { response.status(415).json({ error: "application_json_required" }); return; }
    const deviceKey = readBearerToken(request.get("authorization"));
    let status: ServiceStatus;
    try { status = parseServiceStatus(request.body); } catch { response.status(400).json({ error: "invalid_status" }); return; }
    if (!deviceKey || !await authenticateServiceController(status.controllerId, deviceKey)) {
      response.status(401).json({ error: "invalid_device_credentials" }); return;
    }
    const firestore = getFirestore();
    const controllerRef = firestore.doc(`serviceControllers/${status.controllerId}`);
    const eventRef = controllerRef.collection("statuses").doc(status.statusId);
    const receivedAt = Timestamp.now();
    const outcome = await firestore.runTransaction(async (transaction) => {
      const [controller, existing] = await Promise.all([transaction.get(controllerRef), transaction.get(eventRef)]);
      if (existing.exists) return "duplicate" as const;
      transaction.set(eventRef, {
        ...status, reportedAt: Timestamp.fromDate(status.reportedAt), receivedAt,
      });
      const lastReported = controller.data()?.lastStatusReportedAt;
      const isNewest = !(lastReported instanceof Timestamp) || status.reportedAt.getTime() >= lastReported.toMillis();
      if (isNewest) {
        transaction.set(controllerRef, {
          connectionState: status.state,
          lastStatusAt: receivedAt,
          lastStatusReportedAt: Timestamp.fromDate(status.reportedAt),
          updatedAt: receivedAt,
        }, { merge: true });
      }
      return "stored" as const;
    });
    response.status(outcome === "stored" ? 202 : 200).json({ statusId: status.statusId, outcome });
  },
);

/** MQTT bridge endpoint for service/{controllerId}/command/result. */
export const ingestServiceControllerCommandResult = onRequest(
  { region: REGION, cors: false, invoker: "public", timeoutSeconds: 30, memory: "256MiB" },
  async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (request.method !== "POST") { response.status(405).json({ error: "method_not_allowed" }); return; }
    if (!request.is("application/json")) { response.status(415).json({ error: "application_json_required" }); return; }
    const deviceKey = readBearerToken(request.get("authorization"));
    let result: ServiceCommandResultMessage;
    try { result = parseServiceCommandResult(request.body); } catch { response.status(400).json({ error: "invalid_command_result" }); return; }
    if (!deviceKey || !await authenticateServiceController(result.controllerId, deviceKey)) {
      response.status(401).json({ error: "invalid_device_credentials" }); return;
    }
    const firestore = getFirestore();
    const commandRef = firestore.doc(`serviceControllerCommands/${result.controllerId}/commands/${result.commandId}`);
    const resultRef = firestore.doc(`serviceControllerCommandResults/${result.controllerId}/results/${result.commandId}`);
    const receivedAt = Timestamp.now();
    const outcome = await firestore.runTransaction(async (transaction) => {
      const [command, existing] = await Promise.all([transaction.get(commandRef), transaction.get(resultRef)]);
      if (!command.exists || !isAllowedServiceControllerCommand(command.data()?.command)) {
        throw new HttpsError("not-found", "Command is not registered");
      }
      if (existing.exists) return "duplicate" as const;
      transaction.set(resultRef, {
        ...result, reportedAt: Timestamp.fromDate(result.reportedAt), receivedAt,
      });
      transaction.set(commandRef, {
        status: result.result === "ok" ? "completed" : "failed",
        result: result.result,
        resultMessage: result.message,
        resultReportedAt: Timestamp.fromDate(result.reportedAt),
        completedAt: receivedAt,
      }, { merge: true });
      return "stored" as const;
    });
    response.status(outcome === "stored" ? 202 : 200).json({ commandId: result.commandId, outcome });
  },
);

/**
 * Bridge-only pull endpoint. A claim expires, so bridge restarts can result in
 * an at-least-once MQTT publish; controller firmware must deduplicate commandId.
 */
export const claimServiceControllerCommand = onRequest(
  { region: REGION, cors: false, invoker: "public", timeoutSeconds: 30, memory: "256MiB" },
  async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (request.method !== "POST") { response.status(405).json({ error: "method_not_allowed" }); return; }
    if (!request.is("application/json") || !isRecord(request.body) || !ID_PATTERN.test(String(request.body.controllerId ?? ""))) {
      response.status(400).json({ error: "invalid_controller" }); return;
    }
    const controllerId = request.body.controllerId as string;
    const deviceKey = readBearerToken(request.get("authorization"));
    if (!deviceKey || !await authenticateServiceController(controllerId, deviceKey)) {
      response.status(401).json({ error: "invalid_device_credentials" }); return;
    }
    const firestore = getFirestore();
    const commands = firestore.collection(`serviceControllerCommands/${controllerId}/commands`);
    const now = Timestamp.now();
    const claimBefore = now.toMillis() - COMMAND_CLAIM_TIMEOUT_MS;
    const claimed = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(commands.where("status", "in", ["queued", "claimed"]).limit(25));
      const next = snapshot.docs
        .filter((doc) => isAllowedServiceControllerCommand(doc.data().command))
        .filter((doc) => doc.data().status === "queued" || (doc.data().claimedAt instanceof Timestamp && doc.data().claimedAt.toMillis() <= claimBefore))
        .sort((left, right) => (left.data().requestedAt?.toMillis?.() ?? 0) - (right.data().requestedAt?.toMillis?.() ?? 0))[0];
      if (!next) return null;
      transaction.set(next.ref, { status: "claimed", claimedAt: now }, { merge: true });
      return { commandId: next.id, command: next.data().command as ServiceControllerCommand, requestedAt: next.data().requestedAt?.toDate?.()?.toISOString?.() ?? null };
    });
    if (!claimed) { response.status(204).end(); return; }
    response.status(200).json({ controllerId, ...claimed });
  },
);

/** Bridge-only acknowledgement after Paho accepted the QoS 1 publish locally. */
export const markServiceControllerCommandDispatched = onRequest(
  { region: REGION, cors: false, invoker: "public", timeoutSeconds: 30, memory: "256MiB" },
  async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (request.method !== "POST") { response.status(405).json({ error: "method_not_allowed" }); return; }
    if (!request.is("application/json") || !isRecord(request.body)) { response.status(400).json({ error: "invalid_command" }); return; }
    const controllerId = typeof request.body.controllerId === "string" ? request.body.controllerId : "";
    const commandId = typeof request.body.commandId === "string" ? request.body.commandId : "";
    const deviceKey = readBearerToken(request.get("authorization"));
    if (!ID_PATTERN.test(controllerId) || !EVENT_ID_PATTERN.test(commandId) || !deviceKey || !await authenticateServiceController(controllerId, deviceKey)) {
      response.status(401).json({ error: "invalid_device_credentials" }); return;
    }
    const commandRef = getFirestore().doc(`serviceControllerCommands/${controllerId}/commands/${commandId}`);
    const command = await commandRef.get();
    if (!command.exists || !isAllowedServiceControllerCommand(command.data()?.command)) {
      response.status(404).json({ error: "command_not_registered" }); return;
    }
    if (command.data()?.status !== "completed" && command.data()?.status !== "failed") {
      await commandRef.set({ status: "dispatched", dispatchedAt: Timestamp.now() }, { merge: true });
    }
    response.status(202).json({ commandId, outcome: "dispatched" });
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
