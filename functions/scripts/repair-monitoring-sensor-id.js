#!/usr/bin/env node
/*
 * Deliberately manual Admin repair. Dry-run is the default. It changes only
 * read-model documents; legacy packets are read to build an auditable manifest.
 */
const { getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, FieldPath, getFirestore, Timestamp } = require("firebase-admin/firestore");
const { canonicalBackfillSensorId, rollupDocumentId, stableMeasurementId } = require("../lib/telemetryReadModel");

function option(name, fallback) { const index = process.argv.indexOf(name); return index === -1 ? fallback : process.argv[index + 1]; }
function required(name) { const value = option(name); if (!value || value.startsWith("--")) throw new Error(`${name} is required`); return value; }
const projectId = required("--project");
const deviceId = required("--device-id");
const day = required("--utc-day");
const execute = process.argv.includes("--execute");
const rollback = process.argv.includes("--rollback");
const ratePerMinute = Number(option("--rate-per-minute", "30"));
if (deviceId !== "device-001" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("only device-001 and YYYY-MM-DD are supported");
if (!Number.isFinite(ratePerMinute) || ratePerMinute <= 0 || ratePerMinute > 120) throw new Error("--rate-per-minute must be >0 and <=120");
if (execute && option("--confirm-scope") !== `${deviceId}:${day}`) throw new Error("--execute requires --confirm-scope device-001:YYYY-MM-DD");
if (!getApps().length) initializeApp({ projectId });
const db = getFirestore();
const fromSensorId = "default";
const toSensorId = "temperature-1";
const migrationId = `sensor-id-repair:${deviceId}:${day}:${fromSensorId}-to-${toSensorId}`;
const start = Date.parse(`${day}T00:00:00.000Z`);
const end = start + 24 * 60 * 60 * 1000;
const checkpointRef = db.doc(`monitoringMaintenance/telemetrySensorIdMigration/checkpoints/${deviceId}__${day}__default-to-temperature-1`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isTimed(value) { return value && typeof value === "object" && value.measuredAt instanceof Timestamp && typeof value.temperatureC === "number" && Number.isFinite(value.temperatureC); }
function inDay(timestamp) { return timestamp.toMillis() >= start && timestamp.toMillis() < end; }
function setDifference(left, right) { return [...left].filter((value) => !right.has(value)); }

async function buildManifest() {
  const [packets, points, rollups] = await Promise.all([
    db.collection(`monitoringTelemetry/${deviceId}/packets`).orderBy(FieldPath.documentId()).get(),
    db.collection(`monitoringTelemetry/${deviceId}/points`).get(),
    db.collection(`monitoringTelemetry/${deviceId}/rollups`).get(),
  ]);
  const expected = new Map();
  for (const packet of packets.docs) {
    for (const [index, measurement] of (packet.data().measurements ?? []).entries()) {
      if (!isTimed(measurement) || !inDay(measurement.measuredAt)) continue;
      const sourceSensorId = typeof measurement.sensorId === "string" ? measurement.sensorId : undefined;
      if (canonicalBackfillSensorId(deviceId, sourceSensorId) !== toSensorId) continue;
      const id = stableMeasurementId(packet.id, index);
      expected.set(id, { id, packetId: packet.id, measurementIndex: index, hourStartMs: Math.floor(measurement.measuredAt.toMillis() / 3600000) * 3600000 });
    }
  }
  const inScope = (snapshot) => {
    const measuredAt = snapshot.data().measuredAt;
    return measuredAt instanceof Timestamp && inDay(measuredAt);
  };
  const sourcePoints = new Map(points.docs.filter((point) => inScope(point) && point.data().sensorId === fromSensorId).map((point) => [point.id, point]));
  const targetPoints = new Map(points.docs.filter((point) => inScope(point) && point.data().sensorId === toSensorId).map((point) => [point.id, point]));
  const sourceRollups = new Map(rollups.docs.filter((rollup) => rollup.data().sensorId === fromSensorId && rollup.data().hourStart instanceof Timestamp && inDay(rollup.data().hourStart)).map((rollup) => [rollup.id, rollup]));
  const targetRollups = new Map(rollups.docs.filter((rollup) => rollup.data().sensorId === toSensorId && rollup.data().hourStart instanceof Timestamp && inDay(rollup.data().hourStart)).map((rollup) => [rollup.id, rollup]));
  const byHour = new Map();
  for (const item of expected.values()) {
    const items = byHour.get(item.hourStartMs) ?? [];
    items.push(item);
    byHour.set(item.hourStartMs, items);
  }
  const errors = [];
  const expectedIds = new Set(expected.keys());
  for (const id of [...sourcePoints.keys(), ...targetPoints.keys()]) if (!expectedIds.has(id)) errors.push(`unexpected point ${id} in migration scope`);
  const hours = [];
  for (const [hourStartMs, items] of [...byHour.entries()].sort(([left], [right]) => left - right)) {
    const sourceId = rollupDocumentId(fromSensorId, hourStartMs);
    const targetId = rollupDocumentId(toSensorId, hourStartMs);
    const sourcePointCount = items.filter((item) => sourcePoints.has(item.id)).length;
    const targetPointSnapshots = items.map((item) => targetPoints.get(item.id));
    const targetPointCount = targetPointSnapshots.filter(Boolean).length;
    const sourceRollup = sourceRollups.get(sourceId);
    const targetRollup = targetRollups.get(targetId);
    const pending = sourcePointCount === items.length && targetPointCount === 0 && Boolean(sourceRollup) && !targetRollup;
    const completed = sourcePointCount === 0 && targetPointCount === items.length && !sourceRollup
      && Boolean(targetRollup) && targetPointSnapshots.every((point) => point.data().sensorIdMigrationId === migrationId)
      && targetRollup.data().sensorIdMigrationId === migrationId;
    if (!pending && !completed) errors.push(`inconsistent hour ${new Date(hourStartMs).toISOString()}`);
    hours.push({ hourStartMs, items, sourceId, targetId, state: pending ? "pending" : "completed" });
  }
  if (sourceRollups.size + targetRollups.size !== hours.length) errors.push("unexpected rollup document in migration scope");
  return { expected, sourcePoints, targetPoints, sourceRollups, targetRollups, hours, errors };
}

async function migrateHour(hour, reverse) {
  const sourceSensor = reverse ? toSensorId : fromSensorId;
  const targetSensor = reverse ? fromSensorId : toSensorId;
  const sourceId = rollupDocumentId(sourceSensor, hour.hourStartMs);
  const targetId = rollupDocumentId(targetSensor, hour.hourStartMs);
  const pointRefs = hour.items.map((item) => db.doc(`monitoringTelemetry/${deviceId}/points/${item.id}`));
  const sourceRef = db.doc(`monitoringTelemetry/${deviceId}/rollups/${sourceId}`);
  const targetRef = db.doc(`monitoringTelemetry/${deviceId}/rollups/${targetId}`);
  return db.runTransaction(async (transaction) => {
    const pointSnapshots = await transaction.getAll(...pointRefs);
    const [sourceSnapshot, targetSnapshot] = await Promise.all([transaction.get(sourceRef), transaction.get(targetRef)]);
    if (!sourceSnapshot.exists || targetSnapshot.exists) throw new Error(`unsafe rollup state for ${new Date(hour.hourStartMs).toISOString()}`);
    if (reverse && sourceSnapshot.data().sensorIdMigrationId !== migrationId) throw new Error(`foreign target rollup ${sourceId}`);
    for (const point of pointSnapshots) {
      if (!point.exists || point.data().sensorId !== sourceSensor) throw new Error(`unsafe point state ${point.ref.id}`);
      if (reverse && point.data().sensorIdMigrationId !== migrationId) throw new Error(`foreign target point ${point.ref.id}`);
    }
    const now = Timestamp.now();
    pointSnapshots.forEach((point) => transaction.update(point.ref, {
      sensorId: targetSensor,
      ...(reverse ? { sensorIdMigrationId: FieldValue.delete(), migratedFromSensorId: FieldValue.delete(), sensorIdMigratedAt: FieldValue.delete() } : { sensorIdMigrationId: migrationId, migratedFromSensorId: sourceSensor, sensorIdMigratedAt: now }),
    }));
    const sourceData = sourceSnapshot.data();
    if (reverse) {
      const { sensorIdMigrationId, migratedFromSensorId, sensorIdMigratedAt, ...restored } = sourceData;
      transaction.create(targetRef, { ...restored, sensorId: targetSensor });
    } else {
      transaction.create(targetRef, { ...sourceData, sensorId: targetSensor, sensorIdMigrationId: migrationId, migratedFromSensorId: sourceSensor, sensorIdMigratedAt: now });
    }
    transaction.delete(sourceRef);
  });
}

async function main() {
  const manifest = await buildManifest();
  const expectedCount = manifest.expected.size;
  if (expectedCount !== 360 || manifest.hours.length !== 6 || manifest.errors.length) {
    throw new Error(`preflight refused: expected=${expectedCount} hours=${manifest.hours.length} errors=${manifest.errors.join("; ")}`);
  }
  const pending = manifest.hours.filter((hour) => hour.state === "pending");
  const completed = manifest.hours.filter((hour) => hour.state === "completed");
  const actionable = rollback ? completed : pending;
  const result = { mode: execute ? (rollback ? "rollback" : "execute") : (rollback ? "rollback-dry-run" : "dry-run"), deviceId, utcDay: day, migrationId, expectedTimedPoints: expectedCount, expectedUnplacedPoints: 0, hourRollups: manifest.hours.length, pendingHours: pending.length, completedHours: completed.length, plannedPointUpdates: actionable.reduce((count, hour) => count + hour.items.length, 0), plannedRollupMoves: actionable.length, errors: manifest.errors };
  if (!execute) return console.log(JSON.stringify(result));
  await checkpointRef.set({ deviceId, utcDay: day, migrationId, status: "running", mode: rollback ? "rollback" : "execute", ratePerMinute, expectedTimedPoints: expectedCount, updatedAt: Timestamp.now() }, { merge: true });
  let processedHours = 0;
  for (const hour of actionable) {
    await migrateHour(hour, rollback);
    processedHours += 1;
    await checkpointRef.set({ status: "running", processedHours, lastHourStart: Timestamp.fromMillis(hour.hourStartMs), updatedAt: Timestamp.now() }, { merge: true });
    await sleep(Math.ceil(60000 / ratePerMinute));
  }
  await checkpointRef.set({ status: "completed", processedHours, completedAt: Timestamp.now(), updatedAt: Timestamp.now() }, { merge: true });
  console.log(JSON.stringify({ ...result, processedHours }));
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
