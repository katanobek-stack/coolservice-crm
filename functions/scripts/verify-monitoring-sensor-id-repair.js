#!/usr/bin/env node
// Read-only post-repair verifier. It exits 2 on any mismatch.
const { getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const projectId = process.argv[process.argv.indexOf("--project") + 1];
const deviceId = process.argv[process.argv.indexOf("--device-id") + 1];
const day = process.argv[process.argv.indexOf("--utc-day") + 1];
if (!projectId || !deviceId || !/^\d{4}-\d{2}-\d{2}$/.test(day ?? "")) throw new Error("--project --device-id --utc-day are required");
if (!getApps().length) initializeApp({ projectId });
const db = getFirestore(), start = Date.parse(`${day}T00:00:00.000Z`), end = start + 86400000;
const inDay = (timestamp) => timestamp instanceof Timestamp && timestamp.toMillis() >= start && timestamp.toMillis() < end;
const metrics = (values) => ({ N: values.length, min: Math.min(...values), max: Math.max(...values), avg: values.reduce((sum, value) => sum + value, 0) / values.length });
(async () => {
  const [packets, points, rollups] = await Promise.all([db.collection(`monitoringTelemetry/${deviceId}/packets`).get(), db.collection(`monitoringTelemetry/${deviceId}/points`).get(), db.collection(`monitoringTelemetry/${deviceId}/rollups`).get()]);
  const legacy = [];
  packets.docs.forEach((packet) => (packet.data().measurements ?? []).forEach((measurement) => { if (measurement?.measuredAt instanceof Timestamp && inDay(measurement.measuredAt) && typeof measurement.temperatureC === "number" && (typeof measurement.sensorId !== "string" || measurement.sensorId === "temperature-1")) legacy.push(measurement.temperatureC); }));
  const target = points.docs.filter((point) => point.data().sensorId === "temperature-1" && inDay(point.data().measuredAt));
  const source = points.docs.filter((point) => point.data().sensorId === "default" && inDay(point.data().measuredAt));
  const targetRollups = rollups.docs.filter((rollup) => rollup.data().sensorId === "temperature-1" && inDay(rollup.data().hourStart));
  const sourceRollups = rollups.docs.filter((rollup) => rollup.data().sensorId === "default" && inDay(rollup.data().hourStart));
  const result = { deviceId, utcDay: day, legacy: metrics(legacy), temperature1: metrics(target.map((point) => point.data().temperatureC)), defaultPoints: source.length, temperature1Points: target.length, defaultRollups: sourceRollups.length, temperature1Rollups: targetRollups.length };
  result.matches = result.legacy.N === 360 && JSON.stringify(result.legacy) === JSON.stringify(result.temperature1) && result.defaultPoints === 0 && result.temperature1Points === 360 && result.defaultRollups === 0 && result.temperature1Rollups === 6;
  console.log(JSON.stringify(result)); if (!result.matches) process.exitCode = 2;
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
