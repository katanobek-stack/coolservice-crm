import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onRequest } from "firebase-functions/v2/https";
import { verifyDeviceKey } from "./telemetryKey";

const DEVICE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const STATUS_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const UTC_ISO_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/;
const MIN_DEVICE_KEY_LENGTH = 32;
const MAX_DEVICE_KEY_LENGTH = 256;
const MAX_FUTURE_CLOCK_SKEW_MS = 10 * 60 * 1000;
const MAX_STATUS_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const STATUS_HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const REGISTRATION_STATES = ["home", "roaming", "searching", "denied", "unknown"] as const;
const FAILURE_CODES = [
  "none", "modem_not_ready", "network_not_registered", "ntp_sync_failed",
  "gprs_connect_failed", "tcp_connect_failed", "mqtt_connect_failed",
  "publish_send_failed", "puback_timeout", "modem_restarted", "esp_restarted",
] as const;

type RegistrationState = typeof REGISTRATION_STATES[number];
type FailureCode = typeof FAILURE_CODES[number];

interface ValidStatus {
  controllerId: string;
  statusId: string;
  reportedAt: Date;
  networkRegistered: boolean;
  registrationState: RegistrationState;
  rssi: number | null;
  gprsConnected: boolean;
  mqttConnected: boolean;
  queueDepth: number;
  lastFailureCode: FailureCode;
  uptimeSeconds: number;
}

class RequestValidationError extends Error {}
class DeviceAuthenticationError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function readBearerToken(header: string | undefined): string | null {
  const match = /^Bearer ([^\s]+)$/.exec(header ?? "");
  if (!match || match[1].length < MIN_DEVICE_KEY_LENGTH || match[1].length > MAX_DEVICE_KEY_LENGTH) {
    return null;
  }
  return match[1];
}

function parseReportedAt(value: unknown, nowMs: number): Date {
  const match = typeof value === "string" ? UTC_ISO_PATTERN.exec(value) : null;
  if (!match) throw new RequestValidationError("reportedAt must be an ISO-8601 UTC timestamp");
  const reportedAt = new Date(match[0]);
  const normalized = `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z`;
  if (!Number.isFinite(reportedAt.getTime()) || reportedAt.toISOString() !== normalized) {
    throw new RequestValidationError("reportedAt is invalid");
  }
  if (reportedAt.getTime() > nowMs + MAX_FUTURE_CLOCK_SKEW_MS) {
    throw new RequestValidationError("reportedAt is too far in the future");
  }
  if (reportedAt.getTime() < nowMs - MAX_STATUS_AGE_MS) {
    throw new RequestValidationError("reportedAt is too old");
  }
  return reportedAt;
}

function parseStatus(body: unknown, nowMs: number): ValidStatus {
  const allowed = [
    "controllerId", "statusId", "reportedAt", "networkRegistered", "registrationState", "rssi",
    "gprsConnected", "mqttConnected", "queueDepth", "lastFailureCode", "uptimeSeconds",
  ];
  if (!isRecord(body) || !hasOnlyKeys(body, allowed)) {
    throw new RequestValidationError("body contains unknown fields");
  }
  const value = body;
  if (typeof value.controllerId !== "string" || !DEVICE_ID_PATTERN.test(value.controllerId)) {
    throw new RequestValidationError("controllerId is invalid");
  }
  if (typeof value.statusId !== "string" || !STATUS_ID_PATTERN.test(value.statusId)) {
    throw new RequestValidationError("statusId is invalid");
  }
  const rssi = value.rssi;
  const queueDepth = value.queueDepth;
  const uptimeSeconds = value.uptimeSeconds;
  if (
    typeof value.networkRegistered !== "boolean"
    || typeof value.gprsConnected !== "boolean"
    || typeof value.mqttConnected !== "boolean"
    || !REGISTRATION_STATES.includes(value.registrationState as RegistrationState)
    || !FAILURE_CODES.includes(value.lastFailureCode as FailureCode)
    || (rssi !== null && (typeof rssi !== "number" || !Number.isInteger(rssi) || rssi < 0 || rssi > 31))
    || typeof queueDepth !== "number" || !Number.isSafeInteger(queueDepth) || queueDepth < 0
    || typeof uptimeSeconds !== "number" || !Number.isSafeInteger(uptimeSeconds) || uptimeSeconds < 0
  ) {
    throw new RequestValidationError("status fields are invalid");
  }
  return {
    controllerId: value.controllerId,
    statusId: value.statusId,
    reportedAt: parseReportedAt(value.reportedAt, nowMs),
    networkRegistered: value.networkRegistered,
    registrationState: value.registrationState as RegistrationState,
    rssi,
    gprsConnected: value.gprsConnected,
    mqttConnected: value.mqttConnected,
    queueDepth,
    lastFailureCode: value.lastFailureCode as FailureCode,
    uptimeSeconds,
  };
}

export const ingestControllerStatus = onRequest(
  { region: "europe-west1", cors: false, invoker: "public", timeoutSeconds: 30, memory: "256MiB" },
  async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (request.method !== "POST") {
      response.set("Allow", "POST").status(405).json({ error: "method_not_allowed" });
      return;
    }
    if (!request.is("application/json")) {
      response.status(415).json({ error: "application_json_required" });
      return;
    }
    const deviceKey = readBearerToken(request.get("authorization"));
    if (!deviceKey) {
      response.status(401).json({ error: "invalid_device_credentials" });
      return;
    }

    let status: ValidStatus;
    try {
      status = parseStatus(request.body, Date.now());
    } catch (error) {
      if (error instanceof RequestValidationError) {
        response.status(400).json({ error: "invalid_controller_status", message: error.message });
        return;
      }
      throw error;
    }

    const firestore = getFirestore();
    const deviceRef = firestore.doc(`monitoringDevices/${status.controllerId}`);
    const credentialRef = firestore.doc(`monitoringDeviceCredentials/${status.controllerId}`);
    const currentRef = firestore.doc(`monitoringControllerStatus/${status.controllerId}`);
    const eventRef = firestore.doc(
      `monitoringControllerStatus/${status.controllerId}/statusEvents/${status.statusId}`,
    );
    try {
      const receivedAt = Timestamp.now();
      const result = await firestore.runTransaction(async (transaction) => {
        const [device, credential, current, existingEvent] = await Promise.all([
          transaction.get(deviceRef), transaction.get(credentialRef), transaction.get(currentRef), transaction.get(eventRef),
        ]);
        const credentialData = credential.data();
        if (
          !device.exists || device.data()?.enabled !== true || !credential.exists || !credentialData
          || credentialData.active !== true
          || !verifyDeviceKey(status.controllerId, deviceKey, credentialData)
        ) {
          throw new DeviceAuthenticationError("device is missing, disabled or has invalid credentials");
        }
        if (existingEvent.exists) return { duplicate: true, currentUpdated: false };

        const reportedAt = Timestamp.fromDate(status.reportedAt);
        const eventData = {
          ...status,
          reportedAt,
          receivedAt,
          expireAt: Timestamp.fromMillis(receivedAt.toMillis() + STATUS_HISTORY_RETENTION_MS),
        };
        transaction.create(eventRef, eventData);
        const existingReportedAt = current.data()?.reportedAt;
        const currentUpdated = !(existingReportedAt instanceof Timestamp)
          || status.reportedAt.getTime() > existingReportedAt.toMillis();
        if (currentUpdated) {
          transaction.set(currentRef, eventData);
        }
        return { duplicate: false, currentUpdated };
      });
      response.status(result.duplicate ? 200 : 202).json({
        accepted: !result.duplicate,
        duplicate: result.duplicate,
        currentUpdated: result.currentUpdated,
        statusId: status.statusId,
        receivedAt: receivedAt.toDate().toISOString(),
      });
    } catch (error) {
      if (error instanceof DeviceAuthenticationError) {
        logger.warn("Controller status authentication rejected", { controllerId: status.controllerId });
        response.status(401).json({ error: "invalid_device_credentials" });
        return;
      }
      logger.error("Controller status ingestion failed", { controllerId: status.controllerId, error });
      response.status(500).json({ error: "internal_error" });
    }
  },
);
