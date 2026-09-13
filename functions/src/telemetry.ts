import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onRequest } from "firebase-functions/v2/https";
import { verifyDeviceKey } from "./telemetryKey";
import {
  alertEventId,
  eventUsesRuleVersion,
  parseTemperatureRule,
  ruleVersionAt,
  temperatureViolatesRule,
  type TemperatureRule,
  type TemperatureRuleVersion,
} from "./telemetryAlerts";

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

interface PendingAlertEvent {
  isNew: boolean;
  data: Record<string, unknown>;
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
    const rulesQuery = deviceRef.collection("temperatureRules");

    try {
      const receivedAt = Timestamp.now();
      const latest = packet.measurements[packet.measurements.length - 1];

      const duplicate = await firestore.runTransaction(async (transaction) => {
        const [currentDevice, currentCredential, existingPacket, currentState, currentRules] = await Promise.all([
          transaction.get(deviceRef),
          transaction.get(credentialRef),
          transaction.get(packetRef),
          transaction.get(stateRef),
          transaction.get(rulesQuery),
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

        const deviceData = currentDevice.data() ?? {};
        const stateData = currentState.data() ?? {};
        const rules = currentRules.docs
          .map((item) => parseTemperatureRule(item.id, item.data()))
          .filter((rule): rule is TemperatureRule => rule !== null);
        const storedActiveAlerts = typeof stateData.activeAlertIds === "object"
          && stateData.activeAlertIds !== null
          && !Array.isArray(stateData.activeAlertIds)
          ? stateData.activeAlertIds as Record<string, unknown>
          : {};
        const activeAlertIds = Object.fromEntries(Object.entries(storedActiveAlerts).filter(
          ([ruleId, eventId]) => typeof ruleId === "string" && typeof eventId === "string",
        )) as Record<string, string>;
        const activeEventRefs = Object.entries(activeAlertIds).map(([ruleId, eventId]) => ({
          ruleId,
          ref: firestore.doc(`monitoringAlertEvents/${eventId}`),
        }));
        const activeEventSnapshots = activeEventRefs.length
          ? await transaction.getAll(...activeEventRefs.map((item) => item.ref))
          : [];
        const activeEvents = new Map<string, { id: string; data: Record<string, unknown>; isNew: boolean }>();
        activeEventSnapshots.forEach((snapshot, index) => {
          if (snapshot.exists && snapshot.data()?.state === "active") {
            activeEvents.set(activeEventRefs[index].ruleId, {
              id: snapshot.id,
              data: snapshot.data() ?? {},
              isNew: false,
            });
          }
        });

        const eventWrites = new Map<string, PendingAlertEvent>();
        const assignment = {
          deviceId: packet.deviceId,
          deviceName: typeof deviceData.name === "string" ? deviceData.name : packet.deviceId,
          clientId: typeof deviceData.clientId === "string" ? deviceData.clientId : null,
          targetType: deviceData.targetType === "vehicle" || deviceData.targetType === "chamber"
            ? deviceData.targetType
            : null,
          targetId: typeof deviceData.targetId === "string" ? deviceData.targetId : null,
        };
        const storedCursor = stateData.alertProcessedThroughMeasuredAt;
        const fallbackCursor = stateData.measuredAt;
        const initialCursorMs = storedCursor instanceof Timestamp
          ? storedCursor.toMillis()
          : fallbackCursor instanceof Timestamp ? fallbackCursor.toMillis() : Number.NEGATIVE_INFINITY;
        const processedThroughMs = Math.max(
          initialCursorMs,
          ...packet.measurements.map((measurement) => measurement.measuredAt.getTime()),
        );
        const peak = (
          event: Record<string, unknown>,
          temperatureC: number,
          direction: "above" | "below",
        ): number => {
          const previous = typeof event.peakTemperatureC === "number"
            && Number.isFinite(event.peakTemperatureC)
            ? event.peakTemperatureC
            : temperatureC;
          return direction === "above"
            ? Math.max(previous, temperatureC)
            : Math.min(previous, temperatureC);
        };

        function newAlertEvent(
          rule: TemperatureRule,
          version: TemperatureRuleVersion,
          measurement: ValidMeasurement,
          measurementIndex: number,
          state: "active" | "historical",
        ): { id: string; data: Record<string, unknown>; isNew: true } {
          const id = alertEventId(packet.deviceId, rule.id, packet.packetId, measurementIndex);
          const measuredAt = Timestamp.fromDate(measurement.measuredAt);
          const created = {
            id,
            isNew: true as const,
            data: {
              ...assignment,
              ruleId: rule.id,
              ruleName: version.name,
              ruleRevision: version.revision,
              direction: version.direction,
              thresholdC: version.thresholdC,
              packetId: packet.packetId,
              measurementIndex,
              temperatureC: measurement.temperatureC,
              detectedMeasuredAt: measuredAt,
              detectedReceivedAt: receivedAt,
              lastExceededMeasuredAt: measuredAt,
              lastReceivedAt: receivedAt,
              peakTemperatureC: measurement.temperatureC,
              state,
              viewedBy: {},
            } as Record<string, unknown>,
          };
          eventWrites.set(id, created);
          return created;
        }

        for (const rule of rules) {
          let activeEvent = activeEvents.get(rule.id) ?? null;
          let historicalEvent: { id: string; data: Record<string, unknown>; isNew: true } | null = null;
          let historicalRevision: number | null = null;
          const remember = (event: { id: string; data: Record<string, unknown>; isNew: boolean }) => {
            eventWrites.set(event.id, { isNew: event.isNew, data: event.data });
          };

          for (const [measurementIndex, measurement] of packet.measurements.entries()) {
            const measurementMs = measurement.measuredAt.getTime();
            const version = ruleVersionAt(rule, measurementMs);
            const violated = version
              ? temperatureViolatesRule(measurement.temperatureC, version)
              : false;

            if (measurementMs <= initialCursorMs) {
              const activeDetectedAt = activeEvent?.data.detectedMeasuredAt;
              if (
                violated
                && version
                && activeEvent
                && eventUsesRuleVersion(activeEvent.data, version)
                && activeDetectedAt instanceof Timestamp
                && measurementMs >= activeDetectedAt.toMillis()
              ) {
                activeEvent.data.peakTemperatureC = peak(
                  activeEvent.data,
                  measurement.temperatureC,
                  version.direction,
                );
                remember(activeEvent);
                continue;
              }
              if (!version || !version.enabled || historicalRevision !== version.revision) {
                historicalEvent = null;
                historicalRevision = version?.revision ?? null;
              }
              if (violated && version) {
                if (!historicalEvent) {
                  historicalEvent = newAlertEvent(rule, version, measurement, measurementIndex, "historical");
                  historicalRevision = version.revision;
                } else {
                  historicalEvent.data.lastExceededMeasuredAt = Timestamp.fromDate(measurement.measuredAt);
                  historicalEvent.data.lastReceivedAt = receivedAt;
                  historicalEvent.data.peakTemperatureC = peak(
                    historicalEvent.data,
                    measurement.temperatureC,
                    version.direction,
                  );
                }
              } else if (historicalEvent) {
                historicalEvent.data.recoveredMeasuredAt = Timestamp.fromDate(measurement.measuredAt);
                historicalEvent.data.recoveryReceivedAt = receivedAt;
                historicalEvent = null;
              }
              continue;
            }

            if (activeEvent && (!version || !eventUsesRuleVersion(activeEvent.data, version))) {
              activeEvent.data = {
                ...activeEvent.data,
                state: "closed_by_settings",
                closedAt: receivedAt,
                closedReason: version?.enabled === false ? "rule_disabled" : "rule_changed",
              };
              remember(activeEvent);
              activeEvent = null;
            }
            if (historicalEvent) {
              if (
                violated
                && version
                && historicalEvent.data.ruleRevision === version.revision
                && !activeEvent
              ) {
                historicalEvent.data.state = "active";
                activeEvent = historicalEvent;
              } else if (!violated) {
                historicalEvent.data.recoveredMeasuredAt = Timestamp.fromDate(measurement.measuredAt);
                historicalEvent.data.recoveryReceivedAt = receivedAt;
              }
              historicalEvent = null;
            }
            if (violated && version) {
              if (!activeEvent) {
                activeEvent = newAlertEvent(rule, version, measurement, measurementIndex, "active");
              } else {
                activeEvent.data.lastExceededMeasuredAt = Timestamp.fromDate(measurement.measuredAt);
                activeEvent.data.lastReceivedAt = receivedAt;
                activeEvent.data.peakTemperatureC = peak(
                  activeEvent.data,
                  measurement.temperatureC,
                  version.direction,
                );
                remember(activeEvent);
              }
            } else if (activeEvent) {
              activeEvent.data = {
                ...activeEvent.data,
                state: "recovered",
                recoveredMeasuredAt: Timestamp.fromDate(measurement.measuredAt),
                recoveryReceivedAt: receivedAt,
              };
              remember(activeEvent);
              activeEvent = null;
            }
          }

          if (historicalEvent && !activeEvent) {
            const currentMeasuredAt = stateData.measuredAt;
            const currentTemperatureC = stateData.temperatureC;
            const lastExceededAt = historicalEvent.data.lastExceededMeasuredAt;
            const currentVersion = currentMeasuredAt instanceof Timestamp
              ? ruleVersionAt(rule, currentMeasuredAt.toMillis())
              : null;
            if (
              currentMeasuredAt instanceof Timestamp
              && lastExceededAt instanceof Timestamp
              && currentMeasuredAt.toMillis() > lastExceededAt.toMillis()
              && typeof currentTemperatureC === "number"
              && currentVersion
              && historicalEvent.data.ruleRevision === currentVersion.revision
              && !temperatureViolatesRule(currentTemperatureC, currentVersion)
            ) {
              historicalEvent.data.recoveredMeasuredAt = currentMeasuredAt;
              historicalEvent.data.recoveryReceivedAt = stateData.receivedAt instanceof Timestamp
                ? stateData.receivedAt
                : receivedAt;
            }
          }

          if (activeEvent) {
            activeAlertIds[rule.id] = activeEvent.id;
          } else {
            delete activeAlertIds[rule.id];
          }
        }

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
          alertProcessedThroughMeasuredAt: Number.isFinite(processedThroughMs)
            ? Timestamp.fromMillis(processedThroughMs)
            : FieldValue.delete(),
          alertActive: Object.keys(activeAlertIds).length > 0,
          activeAlertIds,
          activeAlertId: FieldValue.delete(),
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
        transaction.set(stateRef, stateUpdate, { mergeFields: Object.keys(stateUpdate) });
        eventWrites.forEach((pending, eventId) => {
          const eventRef = firestore.doc(`monitoringAlertEvents/${eventId}`);
          if (pending.isNew) transaction.create(eventRef, pending.data);
          else transaction.set(eventRef, pending.data, { merge: true });
        });
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
