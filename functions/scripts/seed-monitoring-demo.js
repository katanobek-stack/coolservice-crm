const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { createDeviceCredentialHash } = require("../lib/telemetryKey");

const PROJECT_ID = "demo-coolservice-crm";
const FUNCTION_URL =
  `http://127.0.0.1:5001/${PROJECT_ID}/europe-west1/ingestTelemetry`;
const DEVICE_KEY = "demo-only-device-key-0123456789-abcdefghijklmnopqrstuvwxyz";
const DEVICE_IDS = ["test-monitor-online", "test-monitor-stale", "test-monitor-offline", "test-monitor-empty"];

// Force Admin SDK traffic to local emulators before it is initialized. This
// script cannot silently fall back to a real Firebase project.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

const app = initializeApp({ projectId: PROJECT_ID }, "monitoring-demo-seed");
const firestore = getFirestore(app);
const auth = getAuth(app);

async function ensureDemoUser(uid, email, role) {
  try {
    await auth.updateUser(uid, { email, password: "DemoMonitor123!", displayName: `Demo ${role}` });
  } catch (error) {
    if (error?.code !== "auth/user-not-found") throw error;
    await auth.createUser({ uid, email, password: "DemoMonitor123!", displayName: `Demo ${role}` });
  }
  await firestore.doc(`staff/${uid}`).set({
    name: role === "manager" ? "Тестовый менеджер" : "Тестовый механик",
    email,
    role,
  });
}

async function removePreviousDemoData() {
  for (const deviceId of DEVICE_IDS) {
    await firestore.recursiveDelete(firestore.doc(`monitoringTelemetry/${deviceId}`));
    await Promise.all([
      firestore.doc(`monitoringDevices/${deviceId}`).delete(),
      firestore.doc(`monitoringDeviceState/${deviceId}`).delete(),
      firestore.doc(`monitoringDeviceCredentials/${deviceId}`).delete(),
    ]);
  }
}

async function ingest(packetId, measurements) {
  const response = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${DEVICE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      deviceId: "test-monitor-online",
      packetId,
      measurements,
    }),
  });
  if (!response.ok) {
    throw new Error(`ingestTelemetry ${response.status}: ${await response.text()}`);
  }
}

function minuteMeasurements(baseMs, temperatureBase) {
  return Array.from({ length: 6 }, (_, index) => ({
    measuredAt: new Date(baseMs + index * 10_000).toISOString(),
    temperatureC: Number((temperatureBase + Math.sin(index / 2) * 0.12).toFixed(2)),
  }));
}

async function main() {
  const health = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/`);
  if (!health.ok) throw new Error("Firestore Emulator is not available on 127.0.0.1:8080");

  await removePreviousDemoData();
  await Promise.all([
    ensureDemoUser("demo-monitoring-manager", "monitoring.manager@example.test", "manager"),
    ensureDemoUser("demo-monitoring-mechanic", "monitoring.mechanic@example.test", "mechanic"),
  ]);

  const now = Date.now();
  await firestore.doc("clients/demo-monitoring-client").set({
    name: "ТЕСТ — Логистик ДВ",
    clientType: "legal",
    vehicles: [{ id: "demo-vehicle", plate: "Т001ЕСТ", brand: "Тестовый фургон" }],
    chambers: [{ id: "demo-chamber", notes: "Камера №1" }],
    repairs: [],
    createdAt: Timestamp.fromMillis(now),
  });
  await firestore.doc("settings/monitoring").set({
    offlineThresholdMinutes: 5,
    updatedAt: Timestamp.fromMillis(now),
  });

  const devices = [
    {
      id: "test-monitor-online",
      name: "ТЕСТ — Камера с графиком",
      clientId: "demo-monitoring-client",
      targetType: "chamber",
      targetId: "demo-chamber",
    },
    {
      id: "test-monitor-stale",
      name: "ТЕСТ — Устаревшее показание",
      clientId: "demo-monitoring-client",
      targetType: "chamber",
      targetId: "demo-chamber",
    },
    {
      id: "test-monitor-offline",
      name: "ТЕСТ — Нет связи",
      clientId: "demo-monitoring-client",
      targetType: "vehicle",
      targetId: "demo-vehicle",
    },
    {
      id: "test-monitor-empty",
      name: "ТЕСТ — Без измерений",
    },
  ];
  await Promise.all(devices.map(({ id, ...data }) => firestore.doc(`monitoringDevices/${id}`).set({
    ...data,
    enabled: true,
    isTest: true,
  })));
  await firestore.doc("monitoringDeviceCredentials/test-monitor-online").set({
    active: true,
    ...createDeviceCredentialHash("test-monitor-online", DEVICE_KEY, Buffer.alloc(16, 9)),
  });

  await Promise.all([
    firestore.doc("monitoringDeviceState/test-monitor-stale").set({
      deviceId: "test-monitor-stale",
      packetId: "demo-stale",
      lastPacketId: "demo-stale",
      temperatureC: -14.2,
      measuredAt: Timestamp.fromMillis(now - 20 * 60_000),
      receivedAt: Timestamp.fromMillis(now),
      lastReceivedAt: Timestamp.fromMillis(now),
      sampleCount: 1,
    }),
    firestore.doc("monitoringDeviceState/test-monitor-offline").set({
      deviceId: "test-monitor-offline",
      packetId: "demo-offline",
      lastPacketId: "demo-offline",
      temperatureC: 3.8,
      measuredAt: Timestamp.fromMillis(now - 11 * 60_000),
      receivedAt: Timestamp.fromMillis(now - 10 * 60_000),
      lastReceivedAt: Timestamp.fromMillis(now - 10 * 60_000),
      sampleCount: 1,
    }),
  ]);

  // Sparse older packets make the 24-hour view useful. Recent packets follow
  // the planned six samples/minute and intentionally contain an eight-minute gap.
  for (let hoursAgo = 22; hoursAgo >= 2; hoursAgo -= 2) {
    const baseMs = now - hoursAgo * 60 * 60_000;
    await ingest(`demo-day-${String(hoursAgo).padStart(2, "0")}`, minuteMeasurements(
      baseMs,
      -18 + Math.sin(hoursAgo / 3) * 0.8,
    ));
  }
  for (let minutesAgo = 58; minutesAgo >= 1; minutesAgo -= 1) {
    if (minutesAgo <= 25 && minutesAgo >= 18) continue;
    const baseMs = now - minutesAgo * 60_000;
    await ingest(`demo-hour-${String(minutesAgo).padStart(2, "0")}`, minuteMeasurements(
      baseMs,
      -18 + Math.sin(minutesAgo / 8) * 0.45,
    ));
  }
  await ingest("demo-current", minuteMeasurements(now - 60_000, -18.1));

  const beforeDelay = await firestore.doc("monitoringDeviceState/test-monitor-online").get();
  await ingest("demo-delayed", [{
    measuredAt: new Date(now - 90 * 60_000).toISOString(),
    temperatureC: 6.5,
  }]);
  const afterDelay = await firestore.doc("monitoringDeviceState/test-monitor-online").get();
  if (afterDelay.data()?.packetId !== beforeDelay.data()?.packetId) {
    throw new Error("Delayed packet incorrectly replaced current temperature");
  }

  console.log("Monitoring demo is ready.");
  console.log("Manager: monitoring.manager@example.test / DemoMonitor123!");
  console.log("Mechanic: monitoring.mechanic@example.test / DemoMonitor123!");
  console.log("Delayed packet retained in history without replacing current state.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
