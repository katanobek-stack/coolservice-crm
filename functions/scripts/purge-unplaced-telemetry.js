#!/usr/bin/env node
/*
 * Manual maintenance tool for historical telemetry which lacks a reliable UTC
 * timestamp. It never uses deployed credentials and is dry-run by default.
 *
 * The live firmware must stop publishing these packets first. This tool only
 * removes historic all-unplaced packets and their deterministic projections;
 * it deliberately refuses a mixed packet so no valid timed measurement can be
 * lost or re-indexed accidentally.
 */
const { getApps, initializeApp } = require("firebase-admin/app");
const { FieldPath, getFirestore, Timestamp } = require("firebase-admin/firestore");
const { stableMeasurementId } = require("../lib/telemetryReadModel");

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function requiredOption(name) {
  const value = option(name);
  if (!value || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}

const projectId = requiredOption("--project");
const deviceId = requiredOption("--device-id");
const execute = process.argv.includes("--execute");
const resume = process.argv.includes("--resume");
const confirmation = option("--confirm-device");
const pageSize = Number(option("--page-size", "200"));
if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 400) {
  throw new Error("--page-size must be an integer between 1 and 400");
}
if (execute && confirmation !== deviceId) {
  throw new Error("execute requires --confirm-device with the exact --device-id");
}

if (!getApps().length) initializeApp({ projectId });
const firestore = getFirestore();
const packets = firestore.collection(`monitoringTelemetry/${deviceId}/packets`);
const checkpointRef = firestore.doc(`monitoringMaintenance/unplacedTelemetryPurge/${deviceId}`);

function isUnplaced(measurement) {
  return measurement && typeof measurement === "object"
    && measurement.timeQuality === "unplaced"
    && measurement.measuredAt === undefined;
}

function packetPlan(snapshot) {
  const data = snapshot.data();
  if (!Array.isArray(data.measurements)) return { kind: "invalid", packetId: snapshot.id };
  const unplacedIndexes = data.measurements
    .map((measurement, index) => isUnplaced(measurement) ? index : -1)
    .filter((index) => index >= 0);
  if (unplacedIndexes.length === 0) return { kind: "skip", packetId: snapshot.id };
  if (unplacedIndexes.length !== data.measurements.length) {
    return { kind: "mixed", packetId: snapshot.id, unplacedIndexes };
  }
  return {
    kind: "delete",
    packetId: typeof data.packetId === "string" ? data.packetId : snapshot.id,
    documentId: snapshot.id,
    unplacedIndexes,
  };
}

async function scan() {
  const planned = [];
  const summary = { scannedPackets: 0, allUnplacedPackets: 0, unplacedPoints: 0, mixedPackets: 0, invalidPackets: 0 };
  let cursor = null;
  for (;;) {
    let request = packets.orderBy(FieldPath.documentId()).limit(pageSize);
    if (cursor) request = request.startAfter(cursor);
    const page = await request.get();
    for (const snapshot of page.docs) {
      summary.scannedPackets += 1;
      const plan = packetPlan(snapshot);
      if (plan.kind === "delete") {
        planned.push(plan);
        summary.allUnplacedPackets += 1;
        summary.unplacedPoints += plan.unplacedIndexes.length;
      } else if (plan.kind === "mixed") summary.mixedPackets += 1;
      else if (plan.kind === "invalid") summary.invalidPackets += 1;
    }
    if (page.size < pageSize) break;
    cursor = page.docs.at(-1);
  }
  return { planned, summary };
}

async function purgePlan(plan) {
  await firestore.runTransaction(async (transaction) => {
    const packetRef = packets.doc(plan.documentId);
    const current = await transaction.get(packetRef);
    if (!current.exists) return;
    const verified = packetPlan(current);
    if (verified.kind !== "delete" || verified.packetId !== plan.packetId) {
      throw new Error(`packet ${plan.documentId} changed after dry-run; no deletion made`);
    }
    verified.unplacedIndexes.forEach((index) => transaction.delete(
      firestore.doc(`monitoringTelemetry/${deviceId}/unplacedPoints/${stableMeasurementId(verified.packetId, index)}`),
    ));
    transaction.delete(packetRef);
    transaction.set(checkpointRef, {
      deviceId,
      schemaVersion: 1,
      lastPacketId: plan.documentId,
      removedPackets: Timestamp.now(),
      mode: "execute",
    }, { merge: true });
  });
}

async function main() {
  const { planned, summary } = await scan();
  const manifest = {
    mode: execute ? "execute" : "dry-run",
    projectId,
    deviceId,
    ...summary,
    expectedWrites: summary.allUnplacedPackets + summary.unplacedPoints + (summary.allUnplacedPackets ? summary.allUnplacedPackets : 0),
    checkpoint: checkpointRef.path,
    safeToExecute: summary.mixedPackets === 0 && summary.invalidPackets === 0,
  };
  if (!execute) {
    console.log(JSON.stringify(manifest));
    return;
  }
  if (!manifest.safeToExecute) {
    throw new Error(`refusing execute: mixed=${summary.mixedPackets}, invalid=${summary.invalidPackets}`);
  }
  const checkpoint = resume ? await checkpointRef.get() : null;
  const lastPacketId = checkpoint?.data()?.lastPacketId;
  let removedPackets = 0;
  let removedPoints = 0;
  for (const plan of planned) {
    if (typeof lastPacketId === "string" && plan.documentId <= lastPacketId) continue;
    await purgePlan(plan);
    removedPackets += 1;
    removedPoints += plan.unplacedIndexes.length;
  }
  console.log(JSON.stringify({ ...manifest, removedPackets, removedPoints }));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
