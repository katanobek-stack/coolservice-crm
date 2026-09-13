import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import type { RuleCloseReason, TemperatureRuleDirection } from "./telemetryAlerts";

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const MIN_TEMPERATURE_C = -55;
const MAX_TEMPERATURE_C = 125;

interface RuleInput {
  action: "upsert" | "delete";
  deviceId: string;
  ruleId: string;
  name?: string;
  enabled?: boolean;
  direction?: TemperatureRuleDirection;
  thresholdC?: number;
}

function parseInput(value: unknown): RuleInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpsError("invalid-argument", "Rule request must be an object");
  }
  const data = value as Record<string, unknown>;
  if (
    (data.action !== "upsert" && data.action !== "delete")
    || typeof data.deviceId !== "string"
    || !ID_PATTERN.test(data.deviceId)
    || typeof data.ruleId !== "string"
    || !ID_PATTERN.test(data.ruleId)
  ) throw new HttpsError("invalid-argument", "Device, rule or action is invalid");

  if (data.action === "delete") {
    return { action: "delete", deviceId: data.deviceId, ruleId: data.ruleId };
  }
  if (
    typeof data.name !== "string"
    || data.name.trim().length < 1
    || data.name.trim().length > 80
    || typeof data.enabled !== "boolean"
    || (data.direction !== "above" && data.direction !== "below")
    || typeof data.thresholdC !== "number"
    || !Number.isFinite(data.thresholdC)
    || data.thresholdC < MIN_TEMPERATURE_C
    || data.thresholdC > MAX_TEMPERATURE_C
  ) throw new HttpsError("invalid-argument", "Temperature rule fields are invalid");

  return {
    action: "upsert",
    deviceId: data.deviceId,
    ruleId: data.ruleId,
    name: data.name.trim(),
    enabled: data.enabled,
    direction: data.direction,
    thresholdC: data.thresholdC,
  };
}

async function assertManager(uid: string, tokenRole: unknown): Promise<void> {
  if (tokenRole === "owner") return;
  const profile = await getFirestore().doc(`staff/${uid}`).get();
  if (!profile.exists || !["owner", "admin", "manager"].includes(profile.data()?.role)) {
    throw new HttpsError("permission-denied", "Manager role is required");
  }
}

function activeAlertMap(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(
    ([ruleId, eventId]) => ID_PATTERN.test(ruleId) && typeof eventId === "string",
  ));
}

export const saveMonitoringTemperatureRule = onCall(
  { region: "europe-west1", timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Authentication is required");
    await assertManager(request.auth.uid, request.auth.token.role);
    const input = parseInput(request.data);
    const firestore = getFirestore();
    const deviceRef = firestore.doc(`monitoringDevices/${input.deviceId}`);
    const ruleRef = deviceRef.collection("temperatureRules").doc(input.ruleId);
    const stateRef = firestore.doc(`monitoringDeviceState/${input.deviceId}`);
    const changedAt = Timestamp.now();

    return firestore.runTransaction(async (transaction) => {
      const [device, rule, state] = await Promise.all([
        transaction.get(deviceRef),
        transaction.get(ruleRef),
        transaction.get(stateRef),
      ]);
      if (!device.exists) throw new HttpsError("not-found", "Monitoring device was not found");

      const previous = rule.data();
      if (input.action === "delete" && (!rule.exists || previous?.deleted === true)) {
        return { ruleId: input.ruleId, deleted: true, unchanged: true };
      }

      const activeAlerts = activeAlertMap(state.data()?.activeAlertIds);
      const activeEventId = activeAlerts[input.ruleId];
      const activeEventRef = activeEventId
        ? firestore.doc(`monitoringAlertEvents/${activeEventId}`)
        : null;
      const activeEvent = activeEventRef ? await transaction.get(activeEventRef) : null;

      const previousRevision = Number.isInteger(previous?.revision) ? Number(previous?.revision) : 0;
      const previousVersions = Array.isArray(previous?.versions) ? previous.versions : [];
      const isDelete = input.action === "delete";
      const nextName = isDelete ? String(previous?.name ?? input.ruleId) : input.name!;
      const nextEnabled = isDelete ? false : input.enabled!;
      const nextDirection = isDelete
        ? (previous?.direction === "below" ? "below" : "above")
        : input.direction!;
      const nextThresholdC = isDelete && typeof previous?.thresholdC === "number"
        ? previous.thresholdC
        : input.thresholdC!;
      const unchanged = rule.exists
        && previous?.deleted !== true
        && !isDelete
        && previous?.name === nextName
        && previous?.enabled === nextEnabled
        && previous?.direction === nextDirection
        && previous?.thresholdC === nextThresholdC;
      if (unchanged) return { ruleId: input.ruleId, deleted: false, unchanged: true };

      const revision = previousRevision + 1;
      const version = {
        revision,
        name: nextName,
        enabled: nextEnabled,
        direction: nextDirection,
        thresholdC: nextThresholdC,
        effectiveFrom: changedAt,
      };
      transaction.set(ruleRef, {
        id: input.ruleId,
        name: nextName,
        enabled: nextEnabled,
        direction: nextDirection,
        thresholdC: nextThresholdC,
        revision,
        deleted: isDelete,
        versions: [...previousVersions, version],
        createdAt: previous?.createdAt ?? changedAt,
        updatedAt: changedAt,
      });

      if (activeEventRef && activeEvent?.exists && activeEvent.data()?.state === "active") {
        const closeReason: RuleCloseReason = isDelete
          ? "rule_deleted"
          : previous?.enabled === true && !nextEnabled
            ? "rule_disabled"
            : "rule_changed";
        transaction.update(activeEventRef, {
          state: "closed_by_settings",
          closedAt: changedAt,
          closedReason: closeReason,
        });
        delete activeAlerts[input.ruleId];
        const stateUpdate = {
          activeAlertIds: activeAlerts,
          alertActive: Object.keys(activeAlerts).length > 0,
        };
        transaction.set(stateRef, stateUpdate, { mergeFields: Object.keys(stateUpdate) });
      }

      return { ruleId: input.ruleId, revision, deleted: isDelete, unchanged: false };
    });
  },
);
