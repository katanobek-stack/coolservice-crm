const assert = require("node:assert/strict");
const { after, before, beforeEach, describe, test } = require("node:test");
const { deleteApp, initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { createDeviceCredentialHash } = require("../lib/telemetryKey");

const PROJECT_ID = "demo-coolservice-crm";
const DEVICE_ID = "device-001";
const DEVICE_KEY = "test-device-key-0123456789-abcdefghijklmnopqrstuvwxyz";
const FUNCTION_URL =
  `http://127.0.0.1:5001/${PROJECT_ID}/europe-west1/ingestTelemetry`;

let app;
let firestore;

function packet(overrides = {}) {
  const measuredAt = new Date(Date.now() - 20_000).toISOString();
  return {
    deviceId: DEVICE_ID,
    packetId: "boot-a:000001",
    measurements: [
      { measuredAt, temperatureC: -18.5 },
      { measuredAt: new Date(Date.now() - 10_000).toISOString(), temperatureC: -18.25 },
    ],
    ...overrides,
  };
}

async function postTelemetry(body, key = DEVICE_KEY) {
  return fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  const response = await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  assert.equal(response.ok, true, `Unable to clear Firestore emulator: ${response.status}`);
}

async function seedEnabledDevice() {
  await Promise.all([
    firestore.doc(`monitoringDevices/${DEVICE_ID}`).set({
      name: "Тестовая камера",
      enabled: true,
      clientId: "client-001",
      targetType: "chamber",
      targetId: "chamber-001",
    }),
    firestore.doc(`monitoringDeviceCredentials/${DEVICE_ID}`).set({
      active: true,
      ...createDeviceCredentialHash(DEVICE_ID, DEVICE_KEY, Buffer.alloc(16, 7)),
    }),
  ]);
}

before(async () => {
  assert.ok(
    process.env.FIRESTORE_EMULATOR_HOST,
    "Run through firebase emulators:exec; production Firestore is intentionally unsupported",
  );
  app = initializeApp({ projectId: PROJECT_ID }, "telemetry-emulator-test");
  firestore = getFirestore(app);
});

beforeEach(async () => {
  await clearFirestore();
  await seedEnabledDevice();
});

after(async () => {
  if (app) await deleteApp(app);
});

describe("ingestTelemetry emulator integration", () => {
  test("accepts a valid packet and stores history separately from current state", async () => {
    const body = packet();
    const response = await postTelemetry(body);
    const result = await response.json();

    assert.equal(response.status, 202);
    assert.deepEqual(
      { accepted: result.accepted, duplicate: result.duplicate, packetId: result.packetId },
      { accepted: true, duplicate: false, packetId: body.packetId },
    );

    const [history, state, client] = await Promise.all([
      firestore.doc(`monitoringTelemetry/${DEVICE_ID}/packets/${body.packetId}`).get(),
      firestore.doc(`monitoringDeviceState/${DEVICE_ID}`).get(),
      firestore.doc("clients/client-001").get(),
    ]);
    assert.equal(history.exists, true);
    assert.equal(history.data().sampleCount, 2);
    assert.ok(history.data().receivedAt instanceof Timestamp);
    assert.equal(state.data().temperatureC, -18.25);
    assert.equal(state.data().packetId, body.packetId);
    assert.equal(client.exists, false, "telemetry must not mutate client documents");
  });

  test("rejects an invalid device key without writing telemetry", async () => {
    const response = await postTelemetry(
      packet(),
      "wrong-device-key-0123456789-abcdefghijklmnopqrstuvwxyz",
    );
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "invalid_device_credentials" });
    assert.equal((await firestore.collectionGroup("packets").get()).size, 0);
    assert.equal((await firestore.doc(`monitoringDeviceState/${DEVICE_ID}`).get()).exists, false);
  });

  test("rejects invalid DS18B20 data before writing", async () => {
    const body = packet({
      measurements: [{ measuredAt: new Date().toISOString(), temperatureC: -127 }],
    });
    const response = await postTelemetry(body);
    const result = await response.json();
    assert.equal(response.status, 400);
    assert.equal(result.error, "invalid_packet");
    assert.match(result.message, /DS18B20 range/);
    assert.equal((await firestore.collectionGroup("packets").get()).size, 0);
  });

  test("rejects a revoked device key", async () => {
    await firestore.doc(`monitoringDeviceCredentials/${DEVICE_ID}`).update({ active: false });
    const response = await postTelemetry(packet());
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "invalid_device_credentials" });
    assert.equal((await firestore.collectionGroup("packets").get()).size, 0);
  });

  test("treats repeat delivery as a duplicate and keeps the first packet unchanged", async () => {
    const original = packet();
    const firstResponse = await postTelemetry(original);
    assert.equal(firstResponse.status, 202);

    const repeated = {
      ...original,
      measurements: original.measurements.map((item) => ({ ...item, temperatureC: 42 })),
    };
    const secondResponse = await postTelemetry(repeated);
    const secondResult = await secondResponse.json();
    assert.equal(secondResponse.status, 200);
    assert.deepEqual(
      { accepted: secondResult.accepted, duplicate: secondResult.duplicate },
      { accepted: false, duplicate: true },
    );

    const history = await firestore
      .doc(`monitoringTelemetry/${DEVICE_ID}/packets/${original.packetId}`)
      .get();
    const state = await firestore.doc(`monitoringDeviceState/${DEVICE_ID}`).get();
    assert.equal(history.data().measurements[1].temperatureC, -18.25);
    assert.equal(state.data().temperatureC, -18.25);
    assert.equal((await firestore.collectionGroup("packets").get()).size, 1);
  });

  test("stores a delayed packet without replacing a newer current temperature", async () => {
    const current = packet({ packetId: "boot-a:current" });
    const currentResponse = await postTelemetry(current);
    assert.equal(currentResponse.status, 202);

    const delayed = packet({
      packetId: "boot-a:delayed",
      measurements: [
        {
          measuredAt: new Date(Date.now() - 30 * 60_000).toISOString(),
          temperatureC: 7.5,
        },
      ],
    });
    const delayedResponse = await postTelemetry(delayed);
    assert.equal(delayedResponse.status, 202);

    const state = await firestore.doc(`monitoringDeviceState/${DEVICE_ID}`).get();
    const delayedHistory = await firestore
      .doc(`monitoringTelemetry/${DEVICE_ID}/packets/${delayed.packetId}`)
      .get();
    assert.equal(delayedHistory.exists, true);
    assert.equal(state.data().temperatureC, -18.25);
    assert.equal(state.data().packetId, current.packetId);
    assert.equal(state.data().lastPacketId, delayed.packetId);
  });
});
