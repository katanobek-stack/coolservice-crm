#!/usr/bin/env node
// Read-only verification for one UTC day. It neither creates nor updates data.
const { getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const projectId = option("--project");
const deviceId = option("--device-id");
const sensorId = option("--sensor-id") ?? "default";
const day = option("--utc-day");
if (!projectId || !deviceId || !day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
  throw new Error("Usage: --project PROJECT --device-id DEVICE --sensor-id SENSOR --utc-day YYYY-MM-DD");
}
if (!getApps().length) initializeApp({ projectId });
const firestore = getFirestore();
const start = new Date(`${day}T00:00:00.000Z`);
const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

function metrics(values) {
  const count = values.length;
  const sum = values.reduce((total, value) => total + value, 0);
  return { count, min: count ? Math.min(...values) : null, max: count ? Math.max(...values) : null, avg: count ? sum / count : null };
}

function equalMetrics(left, right) {
  return left.count === right.count
    && left.min === right.min
    && left.max === right.max
    && (left.avg === null ? right.avg === null : Math.abs(left.avg - right.avg) < 1e-12);
}

async function main() {
  const [legacyPackets, points] = await Promise.all([
    firestore.collection(`monitoringTelemetry/${deviceId}/packets`).get(),
    firestore.collection(`monitoringTelemetry/${deviceId}/points`)
      .where("sensorId", "==", sensorId)
      .where("measuredAt", ">=", Timestamp.fromDate(start))
      .where("measuredAt", "<", Timestamp.fromDate(end))
      .orderBy("measuredAt", "asc")
      .get(),
  ]);
  const legacyValues = [];
  legacyPackets.forEach((packet) => {
    for (const measurement of packet.data().measurements ?? []) {
      if (!(measurement.measuredAt instanceof Timestamp) || typeof measurement.temperatureC !== "number") continue;
      const measurementSensor = typeof measurement.sensorId === "string" ? measurement.sensorId : "default";
      const measuredAtMs = measurement.measuredAt.toMillis();
      if (measurementSensor === sensorId && measuredAtMs >= start.getTime() && measuredAtMs < end.getTime()) {
        legacyValues.push(measurement.temperatureC);
      }
    }
  });
  const pointValues = points.docs.map((point) => point.data().temperatureC).filter(Number.isFinite);
  const legacy = metrics(legacyValues);
  const readModel = metrics(pointValues);
  const result = { deviceId, sensorId, utcDay: day, legacy, readModel, matches: equalMetrics(legacy, readModel) };
  console.log(JSON.stringify(result));
  if (!result.matches) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
