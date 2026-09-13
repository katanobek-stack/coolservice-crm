import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onRequest } from "firebase-functions/v2/https";
import { verifyDeviceKey } from "./telemetryKey";

const DEVICE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const PACKET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const UTC_ISO_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/;
const MIN_DEVICE_KEY_LENGTH = 32;
const MAX_DEVICE_KEY_LENGTH = 256;
const MAX_MEASUREMENTS_PER_PACKET = 12;
const MIN_TEMPERATURE_C = -55;
const MAX_TEMPERATURE_C = 125;
const MAX_FUTURE_CLOCK_SKEW_MS = 10 * 60 * 1000;
const MAX_MEASUREMENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface ValidMeasurement {
  measuredAt: Date;
  temperatureC: number;
}

interface ValidPacket {
  deviceId: string;
  packetId: string;
  measurements: ValidMeasurement[];
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
  if (!match) return null;
  const token = match[1];
  if (token.length < MIN_DEVICE_KEY_LENGTH || token.length > MAX_DEVICE_KEY_LENGTH) return null;
  return token;
}

function parseMeasuredAt(value: unknown, nowMs: number): Date {
  const match = typeof value === "string" ? UTC_ISO_PATTERN.exec(value) : null;
  if (!match) {
    throw new RequestValidationError("measuredAt must be an ISO-8601 UTC timestamp");
  }
  const measuredAt = new Date(match[0]);
  const time = measuredAt.getTime();
  const normalized = `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z`;
  if (!Number.isFinite(time) || measuredAt.toISOString() !== normalized) {
    throw new RequestValidationError("measuredAt is invalid");
  }
  if (time > nowMs + MAX_FUTURE_CLOCK_SKEW_MS) {
    throw new RequestValidationError("measuredAt is too far in the future");
  }
  if (time < nowMs - MAX_MEASUREMENT_AGE_MS) {
    throw new RequestValidationError("measuredAt is too old");
  }
  return measuredAt;
}

function parsePacket(body: unknown, nowMs: number): ValidPacket {
  if (!isRecord(body) || !hasOnlyKeys(body, ["deviceId", "packetId", "measurements"])) {
    throw new RequestValidationError("body must contain only deviceId, packetId and measurements");
  }

  const { deviceId, packetId, measurements } = body;
  if (typeof deviceId !== "string" || !DEVICE_ID_PATTERN.test(deviceId)) {
    throw new RequestValidationError("deviceId is invalid");
  }
  if (typeof packetId !== "string" || !PACKET_ID_PATTERN.test(packetId)) {
    throw new RequestValidationError("packetId is invalid");
  }
  if (
    !Array.isArray(measurements)
    || measurements.length === 0
    || measurements.length > MAX_MEASUREMENTS_PER_PACKET
  ) {
    throw new RequestValidationError(`measurements must contain 1-${MAX_MEASUREMENTS_PER_PACKET} items`);
  }

  let previousTime = Number.NEGATIVE_INFINITY;
  const parsed = measurements.map((measurement, index): ValidMeasurement => {
    if (!isRecord(measurement) || !hasOnlyKeys(measurement, ["measuredAt", "temperatureC"])) {
      throw new RequestValidationError(`measurements[${index}] has unknown fields`);
    }
    if (
      typeof measurement.temperatureC !== "number"
      || !Number.isFinite(measurement.temperatureC)
      || measurement.temperatureC < MIN_TEMPERATURE_C
      || measurement.temperatureC > MAX_TEMPERATURE_C
    ) {
      throw new RequestValidationError(`measurements[${index}].temperatureC is outside DS18B20 range`);
    }
    const measuredAt = parseMeasuredAt(measurement.measuredAt, nowMs);
    if (measuredAt.getTime() <= previousTime) {
      throw new RequestValidationError("measurements must be ordered by unique measuredAt values");
    }
    previousTime = measuredAt.getTime();
    return { measuredAt, temperatureC: measurement.temperatureC };
  });

  return { deviceId, packetId, measurements: parsed };
}

function publicValidationMessage(error: RequestValidationError): string {
  return error.message;
}

export const ingestTelemetry = onRequest(
  {
    region: "europe-west1",
    cors: false,
    invoker: "public",
    timeoutSeconds: 30,
    memory: "256MiB",
  },
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

    let packet: ValidPacket;
    try {
      packet = parsePacket(request.body, Date.now());
    } catch (error) {
      if (error instanceof RequestValidationError) {
        response.status(400).json({ error: "invalid_packet", message: publicValidationMessage(error) });
        return;
      }
      throw error;
    }

    const firestore = getFirestore();
    const deviceRef = firestore.doc(`monitoringDevices/${packet.deviceId}`);
    const credentialRef = firestore.doc(`monitoringDeviceCredentials/${packet.deviceId}`);
    const packetRef = firestore.doc(
      `monitoringTelemetry/${packet.deviceId}/packets/${packet.packetId}`,
    );
    const stateRef = firestore.doc(`monitoringDeviceState/${packet.deviceId}`);

    try {
      const receivedAt = Timestamp.now();
      const latest = packet.measurements[packet.measurements.length - 1];

      const duplicate = await firestore.runTransaction(async (transaction) => {
        const [currentDevice, currentCredential, existingPacket, currentState] = await Promise.all([
          transaction.get(deviceRef),
          transaction.get(credentialRef),
          transaction.get(packetRef),
          transaction.get(stateRef),
        ]);
        const currentCredentialData = currentCredential.data();
        if (
          !currentDevice.exists
          || currentDevice.data()?.enabled !== true
          || !currentCredential.exists
          || !currentCredentialData
          || currentCredentialData.active !== true
          || !verifyDeviceKey(packet.deviceId, deviceKey, currentCredentialData)
        ) {
          throw new DeviceAuthenticationError("device is missing, disabled or has invalid credentials");
        }
        if (existingPacket.exists) return true;

        const storedMeasurements = packet.measurements.map((measurement) => ({
          measuredAt: Timestamp.fromDate(measurement.measuredAt),
          temperatureC: measurement.temperatureC,
        }));
        transaction.create(packetRef, {
          deviceId: packet.deviceId,
          packetId: packet.packetId,
          measurements: storedMeasurements,
          sampleCount: storedMeasurements.length,
          firstMeasuredAt: storedMeasurements[0].measuredAt,
          lastMeasuredAt: storedMeasurements[storedMeasurements.length - 1].measuredAt,
          receivedAt,
        });
        const currentMeasuredAt = currentState.data()?.measuredAt;
        const shouldAdvanceCurrent = !(currentMeasuredAt instanceof Timestamp)
          || latest.measuredAt.getTime() > currentMeasuredAt.toMillis();
        const stateUpdate: Record<string, unknown> = {
          deviceId: packet.deviceId,
          lastPacketId: packet.packetId,
          lastReceivedAt: receivedAt,
        };
        if (shouldAdvanceCurrent) {
          Object.assign(stateUpdate, {
            packetId: packet.packetId,
            temperatureC: latest.temperatureC,
            measuredAt: Timestamp.fromDate(latest.measuredAt),
            receivedAt,
            sampleCount: packet.measurements.length,
          });
        }
        transaction.set(stateRef, stateUpdate, { merge: true });
        return false;
      });

      response.status(duplicate ? 200 : 202).json({
        accepted: !duplicate,
        duplicate,
        packetId: packet.packetId,
        receivedAt: receivedAt.toDate().toISOString(),
      });
    } catch (error) {
      if (error instanceof DeviceAuthenticationError) {
        logger.warn("Telemetry authentication rejected", { deviceId: packet.deviceId });
        response.status(401).json({ error: "invalid_device_credentials" });
        return;
      }
      logger.error("Telemetry ingestion failed", { deviceId: packet.deviceId, error });
      response.status(500).json({ error: "internal_error" });
    }
  },
);
