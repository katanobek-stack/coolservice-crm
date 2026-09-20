#!/usr/bin/env node
/*
 * Deliberately manual Admin tool. It is dry-run by default and never runs as a
 * deployed Function. Use a trusted application-default/service-account setup;
 * credentials are intentionally not accepted on the command line.
 */
const { getApps, initializeApp } = require("firebase-admin/app");
const { FieldPath, FieldValue, getFirestore, Timestamp } = require("firebase-admin/firestore");
const {
  isTimedReadModelMeasurement,
  nextRollupData,
  normalizedSensorId,
  pointDocumentData,
  rollupDocumentId,
  stableMeasurementId,
} = require("../lib/telemetryReadModel");

function readOption(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function requiredOption(name) {
  const value = readOption(name);
  if (!value || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}

const deviceId = requiredOption("--device-id");
const projectId = requiredOption("--project");
const execute = process.argv.includes("--execute");
const resume = process.argv.includes("--resume");
const maxPackets = Number(readOption("--max-packets", "100"));
const ratePerMinute = Number(readOption("--rate-per-minute", "30"));
if (!Number.isInteger(maxPackets) || maxPackets < 1 || maxPackets > 1000) throw new Error("--max-packets must be 1..1000");
if (!Number.isFinite(ratePerMinute) || ratePerMinute <= 0 || ratePerMinute > 120) throw new Error("--rate-per-minute must be >0 and <=120");

if (!getApps().length) initializeApp({ projectId });
const firestore = getFirestore();
const checkpointRef = firestore.doc(`monitoringMaintenance/telemetryReadModelBackfill/${deviceId}`);
const packets = firestore.collection(`monitoringTelemetry/${deviceId}/packets`);
const delayMs = Math.ceil(60_000 / ratePerMinute);

function asTimedMeasurement(packetId, measurement, measurementIndex) {
  if (!measurement || typeof measurement !== "object" || !(measurement.measuredAt instanceof Timestamp)) return null;
  if (typeof measurement.temperatureC !== "number" || !Number.isFinite(measurement.temperatureC)) return null;
  const timeQuality = measurement.timeQuality === "estimated" ? "estimated" : "exact";
  const deliveryQuality = measurement.deliveryQuality === "delayed" ? "delayed" : "realtime";
  return {
    packetId,
    measurementIndex,
    sensorId: typeof measurement.sensorId === "string" ? measurement.sensorId : undefined,
    temperatureC: measurement.temperatureC,
    measuredAt: measurement.measuredAt.toDate(),
    timeQuality,
    deliveryQuality,
  };
}

function asUnplacedMeasurement(packetId, measurement, measurementIndex) {
  if (!measurement || typeof measurement !== "object" || measurement.measuredAt !== undefined) return null;
  if (measurement.timeQuality !== "unplaced" || typeof measurement.sensorId !== "string") return null;
  if (typeof measurement.temperatureC !== "number" || !Number.isFinite(measurement.temperatureC)) return null;
  return {
    packetId,
    measurementIndex,
    sensorId: measurement.sensorId,
    temperatureC: measurement.temperatureC,
    timeQuality: "unplaced",
    deliveryQuality: measurement.deliveryQuality === "delayed" ? "delayed" : "realtime",
  };
}

async function backfillPacket(snapshot) {
  const packet = snapshot.data();
  const receivedAt = packet.receivedAt instanceof Timestamp ? packet.receivedAt : null;
  if (!receivedAt || !Array.isArray(packet.measurements)) {
    throw new Error(`Packet ${snapshot.id} lacks receivedAt or measurements; refusing to guess`);
  }
  const measurements = packet.measurements.map((item, index) => (
    asTimedMeasurement(snapshot.id, item, index) ?? asUnplacedMeasurement(snapshot.id, item, index)
  ));
  if (measurements.some((item) => item === null)) {
    throw new Error(`Packet ${snapshot.id} contains an unsupported legacy measurement; no writes made`);
  }
  if (!execute) return { created: measurements.length, skipped: false };

  return firestore.runTransaction(async (transaction) => {
    const pointRefs = measurements.map((measurement) => firestore.doc(
      `monitoringTelemetry/${deviceId}/${isTimedReadModelMeasurement(measurement) ? "points" : "unplacedPoints"}/${stableMeasurementId(snapshot.id, measurement.measurementIndex)}`,
    ));
    const rollupRefs = new Map();
    for (const measurement of measurements) {
      if (!isTimedReadModelMeasurement(measurement)) continue;
      const sensorId = normalizedSensorId(measurement.sensorId);
      const ref = firestore.doc(`monitoringTelemetry/${deviceId}/rollups/${rollupDocumentId(sensorId, measurement.measuredAt.getTime())}`);
      rollupRefs.set(ref.path, ref);
    }
    const [pointSnapshots, ...rollupSnapshots] = await Promise.all([
      transaction.getAll(...pointRefs),
      ...[...rollupRefs.values()].map((ref) => transaction.get(ref)),
    ]);
    if (pointSnapshots.every((item) => item.exists)) return { created: 0, skipped: true };
    if (pointSnapshots.some((item) => item.exists)) {
      throw new Error(`Partial read model for packet ${snapshot.id}; refusing to double-count rollups`);
    }
    const rollupData = new Map();
    rollupSnapshots.forEach((item) => rollupData.set(item.ref.path, item.exists ? item.data() : undefined));
    measurements.forEach((measurement, index) => transaction.create(
      pointRefs[index], pointDocumentData(deviceId, measurement, receivedAt),
    ));
    for (const measurement of measurements) {
      if (!isTimedReadModelMeasurement(measurement)) continue;
      const sensorId = normalizedSensorId(measurement.sensorId);
      const ref = firestore.doc(`monitoringTelemetry/${deviceId}/rollups/${rollupDocumentId(sensorId, measurement.measuredAt.getTime())}`);
      const next = nextRollupData(rollupData.get(ref.path), deviceId, measurement, receivedAt);
      rollupData.set(ref.path, next);
      transaction.set(ref, next);
    }
    return { created: measurements.length, skipped: false };
  });
}

async function main() {
  const checkpoint = resume ? await checkpointRef.get() : null;
  const startAfterPacketId = checkpoint?.data()?.lastPacketId;
  let query = packets.orderBy(FieldPath.documentId()).limit(maxPackets);
  if (typeof startAfterPacketId === "string") query = query.startAfter(startAfterPacketId);
  const page = await query.get();
  let created = 0;
  let skipped = 0;
  for (const snapshot of page.docs) {
    const result = await backfillPacket(snapshot);
    created += result.created;
    skipped += result.skipped ? 1 : 0;
    if (execute) {
      await checkpointRef.set({
        deviceId,
        schemaVersion: 1,
        lastPacketId: snapshot.id,
        processedPackets: FieldValue.increment(1),
        updatedAt: Timestamp.now(),
        mode: "execute",
      }, { merge: true });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  console.log(JSON.stringify({ mode: execute ? "execute" : "dry-run", deviceId, packets: page.size, created, skipped, hasMore: page.size === maxPackets }));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
