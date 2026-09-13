import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";

export type TemperatureRuleDirection = "above" | "below";
export type RuleCloseReason =
  | "rule_changed"
  | "rule_disabled"
  | "rule_deleted"
  | "device_disabled";

export interface TemperatureRuleVersion {
  revision: number;
  name: string;
  enabled: boolean;
  direction: TemperatureRuleDirection;
  thresholdC: number;
  effectiveFrom: Timestamp;
}

export interface TemperatureRule {
  id: string;
  name: string;
  enabled: boolean;
  direction: TemperatureRuleDirection;
  thresholdC: number;
  revision: number;
  deleted: boolean;
  versions: TemperatureRuleVersion[];
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function direction(value: unknown): TemperatureRuleDirection | null {
  return value === "above" || value === "below" ? value : null;
}

export function parseTemperatureRule(
  id: string,
  data: Record<string, unknown> | undefined,
): TemperatureRule | null {
  const currentDirection = direction(data?.direction);
  const thresholdC = finiteNumber(data?.thresholdC);
  const revision = Number.isInteger(data?.revision) && Number(data?.revision) >= 1
    ? Number(data?.revision)
    : null;
  if (
    !data
    || typeof data.name !== "string"
    || !currentDirection
    || thresholdC === null
    || revision === null
    || !Array.isArray(data.versions)
  ) return null;

  const versions = data.versions.flatMap((item): TemperatureRuleVersion[] => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const candidate = item as Record<string, unknown>;
    const candidateDirection = direction(candidate.direction);
    const candidateThreshold = finiteNumber(candidate.thresholdC);
    if (
      !Number.isInteger(candidate.revision)
      || Number(candidate.revision) < 1
      || typeof candidate.name !== "string"
      || typeof candidate.enabled !== "boolean"
      || !candidateDirection
      || candidateThreshold === null
      || !(candidate.effectiveFrom instanceof Timestamp)
    ) return [];
    return [{
      revision: Number(candidate.revision),
      name: candidate.name,
      enabled: candidate.enabled,
      direction: candidateDirection,
      thresholdC: candidateThreshold,
      effectiveFrom: candidate.effectiveFrom,
    }];
  }).sort((left, right) => left.effectiveFrom.toMillis() - right.effectiveFrom.toMillis());

  if (versions.length === 0) return null;
  return {
    id,
    name: data.name,
    enabled: data.enabled === true,
    direction: currentDirection,
    thresholdC,
    revision,
    deleted: data.deleted === true,
    versions,
  };
}

export function ruleVersionAt(
  rule: TemperatureRule,
  measuredAtMs: number,
): TemperatureRuleVersion | null {
  let result: TemperatureRuleVersion | null = null;
  for (const version of rule.versions) {
    if (version.effectiveFrom.toMillis() > measuredAtMs) break;
    result = version;
  }
  return result;
}

export function temperatureViolatesRule(
  temperatureC: number,
  rule: Pick<TemperatureRuleVersion, "enabled" | "direction" | "thresholdC">,
): boolean {
  if (!rule.enabled) return false;
  return rule.direction === "above"
    ? temperatureC > rule.thresholdC
    : temperatureC < rule.thresholdC;
}

export function eventUsesRuleVersion(
  event: Record<string, unknown>,
  rule: TemperatureRuleVersion,
): boolean {
  return event.ruleRevision === rule.revision
    && event.direction === rule.direction
    && event.thresholdC === rule.thresholdC;
}

export function alertEventId(
  deviceId: string,
  ruleId: string,
  packetId: string,
  measurementIndex: number,
): string {
  return createHash("sha256")
    .update(deviceId).update("\0")
    .update(ruleId).update("\0")
    .update(packetId).update("\0")
    .update(String(measurementIndex))
    .digest("hex");
}
