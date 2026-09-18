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
const RULE_FUNCTION_URL =
  `http://127.0.0.1:5001/${PROJECT_ID}/europe-west1/saveMonitoringTemperatureRule`;
const STATUS_FUNCTION_URL =
  `http://127.0.0.1:5001/${PROJECT_ID}/europe-west1/ingestControllerStatus`;

let app;
let firestore;
let managerToken;
let managerUid;
let mechanicToken;
let mechanicUid;

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

function controllerStatus(overrides = {}) {
  return {
    controllerId: DEVICE_ID,
    statusId: "boot-a:status-000001",
    reportedAt: new Date(Date.now() - 10_000).toISOString(),
    networkRegistered: true,
    registrationState: "home",
    rssi: 21,
    gprsConnected: true,
    mqttConnected: true,
    queueDepth: 0,
    lastFailureCode: "none",
    uptimeSeconds: 3600,
    ...overrides,
  };
}

async function postControllerStatus(body, key = DEVICE_KEY) {
  return fetch(STATUS_FUNCTION_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
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

async function callRule(data) {
  const response = await fetch(RULE_FUNCTION_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${managerToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ data }),
  });
  const result = await response.json();
  assert.equal(response.ok, true, JSON.stringify(result));
  return result.result;
}

async function postRule(data, token) {
  return fetch(RULE_FUNCTION_URL, {
    method: "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify({ data }),
  });
}

async function seedTemperatureRule({
  id = "high-warning",
  name = "Выше -15",
  enabled = true,
  direction = "above",
  thresholdC = -15,
  effectiveFrom = Date.now() - 60 * 60_000,
} = {}) {
  await firestore.doc(`monitoringDevices/${DEVICE_ID}/temperatureRules/${id}`).set({
    id,
    name,
    enabled,
    direction,
    thresholdC,
    revision: 1,
    deleted: false,
    versions: [{
      revision: 1,
      name,
      enabled,
      direction,
      thresholdC,
      effectiveFrom: Timestamp.fromMillis(effectiveFrom),
    }],
  });
}

function measurement(secondsAgo, temperatureC) {
  return {
    measuredAt: new Date(Date.now() - secondsAgo * 1_000).toISOString(),
    temperatureC,
  };
}

before(async () => {
  assert.ok(
    process.env.FIRESTORE_EMULATOR_HOST,
    "Run through firebase emulators:exec; production Firestore is intentionally unsupported",
  );
  app = initializeApp({ projectId: PROJECT_ID }, "telemetry-emulator-test");
  firestore = getFirestore(app);
  async function createTestUser(role) {
    const response = await fetch(
      "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo",
      {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: `monitoring-${role}-${Date.now()}@example.test`,
        password: "LocalOnlyRuleTest123!",
        returnSecureToken: true,
      }),
      },
    );
    const result = await response.json();
    assert.equal(response.ok, true);
    return result;
  }
  const manager = await createTestUser("manager");
  managerToken = manager.idToken;
  managerUid = manager.localId;
  const mechanic = await createTestUser("mechanic");
  mechanicToken = mechanic.idToken;
  mechanicUid = mechanic.localId;
});

beforeEach(async () => {
  await clearFirestore();
  await seedEnabledDevice();
  await Promise.all([
    firestore.doc(`staff/${managerUid}`).set({ role: "manager", name: "Rule test manager" }),
    firestore.doc(`staff/${mechanicUid}`).set({ role: "mechanic", name: "Rule test mechanic" }),
  ]);
});

after(async () => {
  if (app) await deleteApp(app);
});

describe("ingestTelemetry emulator integration", () => {
  test("stores controller diagnostics outside temperature data and deduplicates statusId", async () => {
    const body = controllerStatus();
    const first = await postControllerStatus(body);
    assert.equal(first.status, 202);
    assert.deepEqual(await first.json(), {
      accepted: true, duplicate: false, currentUpdated: true, statusId: body.statusId,
      receivedAt: (await firestore.doc(`monitoringControllerStatus/${DEVICE_ID}`).get()).data().receivedAt.toDate().toISOString(),
    });
    const [current, event, telemetry] = await Promise.all([
      firestore.doc(`monitoringControllerStatus/${DEVICE_ID}`).get(),
      firestore.doc(`monitoringControllerStatus/${DEVICE_ID}/statusEvents/${body.statusId}`).get(),
      firestore.collection("monitoringTelemetry").get(),
    ]);
    assert.equal(current.data().mqttConnected, true);
    assert.equal(event.data().lastFailureCode, "none");
    assert.ok(event.data().expireAt instanceof Timestamp);
    assert.equal(telemetry.empty, true, "diagnostics must not create temperature packets");

    const repeated = await postControllerStatus({ ...body, mqttConnected: false });
    assert.equal(repeated.status, 200);
    assert.deepEqual(await repeated.json(), {
      accepted: false, duplicate: true, currentUpdated: false, statusId: body.statusId,
      receivedAt: (await firestore.doc(`monitoringControllerStatus/${DEVICE_ID}`).get()).data().receivedAt.toDate().toISOString(),
    });
    assert.equal((await firestore.doc(`monitoringControllerStatus/${DEVICE_ID}`).get()).data().mqttConnected, true);
  });

  test("rejects invalid controller diagnostics and does not let delayed status replace current", async () => {
    assert.equal((await postControllerStatus(controllerStatus({ rssi: 32 }))).status, 400);
    assert.equal((await postControllerStatus(controllerStatus(), "wrong-device-key-0123456789-abcdefghijklmnopqrstuvwxyz")).status, 401);
    assert.equal((await firestore.doc(`monitoringControllerStatus/${DEVICE_ID}`).get()).exists, false);

    const recent = controllerStatus({ statusId: "boot-a:recent", reportedAt: new Date(Date.now() - 10_000).toISOString() });
    const delayed = controllerStatus({ statusId: "boot-a:delayed", reportedAt: new Date(Date.now() - 60_000).toISOString(), mqttConnected: false });
    assert.equal((await postControllerStatus(recent)).status, 202);
    const delayedResponse = await postControllerStatus(delayed);
    assert.equal(delayedResponse.status, 202);
    assert.equal((await delayedResponse.json()).currentUpdated, false);
    assert.equal((await firestore.doc(`monitoringControllerStatus/${DEVICE_ID}`).get()).data().statusId, recent.statusId);
    assert.equal((await firestore.doc(`monitoringControllerStatus/${DEVICE_ID}/statusEvents/${delayed.statusId}`).get()).exists, true);
  });

  test("allows manager rule changes and rejects mechanic or unauthenticated callers", async () => {
    const input = {
      action: "upsert", deviceId: DEVICE_ID, ruleId: "role-rule",
      name: "Проверка ролей", enabled: true, direction: "above", thresholdC: -15,
    };
    assert.equal((await postRule(input)).status, 401);
    assert.equal((await postRule(input, mechanicToken)).status, 403);
    assert.equal((await postRule(input, managerToken)).status, 200);
    assert.equal((await firestore.doc(
      `monitoringDevices/${DEVICE_ID}/temperatureRules/role-rule`,
    ).get()).exists, true);
  });

  test("accepts a valid packet and stores history separately from current state", async () => {
    const body = packet();
    const response = await postTelemetry(body);
    const result = await response.json();

    assert.equal(response.status, 202);
    assert.deepEqual(result, {
      packetId: body.packetId,
      outcome: "stored",
      measurementsReceived: 2,
      measurementsCreated: 2,
    });

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
    assert.deepEqual(await firstResponse.json(), {
      packetId: original.packetId,
      outcome: "stored",
      measurementsReceived: 2,
      measurementsCreated: 2,
    });

    const repeated = {
      ...original,
      measurements: original.measurements.map((item) => ({ ...item, temperatureC: 42 })),
    };
    const secondResponse = await postTelemetry(repeated);
    const secondResult = await secondResponse.json();
    assert.equal(secondResponse.status, 200);
    assert.deepEqual(secondResult, {
      packetId: original.packetId,
      outcome: "duplicate",
      measurementsReceived: 2,
      measurementsCreated: 0,
    });

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

  test("starts once, continues without spam, and recovers at equality", async () => {
    await seedTemperatureRule();
    assert.equal((await postTelemetry(packet({
      packetId: "alert:start",
      measurements: [measurement(40, -14)],
    }))).status, 202);
    assert.equal((await postTelemetry(packet({
      packetId: "alert:continue",
      measurements: [measurement(30, -13)],
    }))).status, 202);

    let events = await firestore.collection("monitoringAlertEvents").get();
    assert.equal(events.size, 1);
    assert.equal(events.docs[0].data().state, "active");
    assert.equal(events.docs[0].data().peakTemperatureC, -13);

    assert.equal((await postTelemetry(packet({
      packetId: "alert:recover",
      measurements: [measurement(20, -15)],
    }))).status, 202);
    events = await firestore.collection("monitoringAlertEvents").get();
    assert.equal(events.size, 1);
    assert.equal(events.docs[0].data().state, "recovered");
    assert.deepEqual(events.docs[0].data().viewedBy, {});
    const state = await firestore.doc(`monitoringDeviceState/${DEVICE_ID}`).get();
    assert.equal(state.data().alertActive, false);
  });

  test("records exceedance and recovery transitions inside one packet", async () => {
    await seedTemperatureRule();
    const body = packet({
      packetId: "alert:within-packet",
      measurements: [
        measurement(50, -14),
        measurement(40, -15),
        measurement(30, -14.5),
        measurement(20, -15),
      ],
    });
    assert.equal((await postTelemetry(body)).status, 202);
    const events = await firestore.collection("monitoringAlertEvents").get();
    assert.equal(events.size, 2);
    assert.ok(events.docs.every((item) => item.data().state === "recovered"));
    const state = await firestore.doc(`monitoringDeviceState/${DEVICE_ID}`).get();
    assert.equal(state.data().alertActive, false);
  });

  test("does not duplicate alert events for a repeated packet", async () => {
    await seedTemperatureRule();
    const body = packet({
      packetId: "alert:duplicate",
      measurements: [measurement(20, -14)],
    });
    assert.equal((await postTelemetry(body)).status, 202);
    assert.equal((await postTelemetry(body)).status, 200);
    assert.equal((await firestore.collection("monitoringAlertEvents").get()).size, 1);
  });

  test("merges a delayed above-limit sample into the same active episode", async () => {
    await seedTemperatureRule();
    assert.equal((await postTelemetry(packet({
      packetId: "alert:episode-start",
      measurements: [measurement(50, -14)],
    }))).status, 202);
    assert.equal((await postTelemetry(packet({
      packetId: "alert:episode-current",
      measurements: [measurement(20, -13.5)],
    }))).status, 202);
    assert.equal((await postTelemetry(packet({
      packetId: "alert:episode-delayed",
      measurements: [measurement(35, -12.5)],
    }))).status, 202);

    const events = await firestore.collection("monitoringAlertEvents").get();
    assert.equal(events.size, 1);
    assert.equal(events.docs[0].data().state, "active");
    assert.equal(events.docs[0].data().peakTemperatureC, -12.5);
  });

  test("keeps a delayed exceedance historical and does not roll back current alert state", async () => {
    await seedTemperatureRule();
    const current = packet({
      packetId: "alert:current-normal",
      measurements: [measurement(20, -15)],
    });
    assert.equal((await postTelemetry(current)).status, 202);
    const delayed = packet({
      packetId: "alert:delayed-high",
      measurements: [measurement(30 * 60, -14)],
    });
    assert.equal((await postTelemetry(delayed)).status, 202);
    const events = await firestore.collection("monitoringAlertEvents").get();
    assert.equal(events.size, 1);
    assert.equal(events.docs[0].data().state, "historical");
    assert.ok(events.docs[0].data().recoveredMeasuredAt instanceof Timestamp);
    const state = await firestore.doc(`monitoringDeviceState/${DEVICE_ID}`).get();
    assert.equal(state.data().alertActive, false);
    assert.equal(state.data().temperatureC, -15);
  });

  test("runs above and below rules simultaneously and recovers them independently", async () => {
    await seedTemperatureRule({ id: "above-minus-15", name: "Выше -15", direction: "above", thresholdC: -15 });
    await seedTemperatureRule({ id: "below-minus-10", name: "Ниже -10", direction: "below", thresholdC: -10 });
    assert.equal((await postTelemetry(packet({
      packetId: "alert:both-active",
      measurements: [measurement(40, -12)],
    }))).status, 202);
    let state = await firestore.doc(`monitoringDeviceState/${DEVICE_ID}`).get();
    assert.deepEqual(Object.keys(state.data().activeAlertIds).sort(), ["above-minus-15", "below-minus-10"]);

    assert.equal((await postTelemetry(packet({
      packetId: "alert:above-recovers",
      measurements: [measurement(30, -16)],
    }))).status, 202);
    state = await firestore.doc(`monitoringDeviceState/${DEVICE_ID}`).get();
    assert.deepEqual(Object.keys(state.data().activeAlertIds), ["below-minus-10"]);

    assert.equal((await postTelemetry(packet({
      packetId: "alert:below-equality-recovers",
      measurements: [measurement(20, -10)],
    }))).status, 202);
    state = await firestore.doc(`monitoringDeviceState/${DEVICE_ID}`).get();
    assert.equal(state.data().alertActive, true);
    assert.deepEqual(Object.keys(state.data().activeAlertIds), ["above-minus-15"]);
    const events = await firestore.collection("monitoringAlertEvents").get();
    assert.equal(events.size, 3);
    const belowEvents = events.docs.filter((item) => item.data().ruleId === "below-minus-10");
    const aboveEvents = events.docs.filter((item) => item.data().ruleId === "above-minus-15");
    assert.equal(belowEvents.length, 1);
    assert.equal(belowEvents[0].data().state, "recovered");
    assert.equal(aboveEvents.filter((item) => item.data().state === "recovered").length, 1);
    assert.equal(aboveEvents.filter((item) => item.data().state === "active").length, 1);
  });

  test("evaluates delayed measurements against the rule version effective at measurement time", async () => {
    await seedTemperatureRule({ id: "versioned-rule", thresholdC: -15 });
    await callRule({
      action: "upsert", deviceId: DEVICE_ID, ruleId: "versioned-rule",
      name: "Новый порог", enabled: true, direction: "above", thresholdC: -10,
    });
    assert.equal((await postTelemetry(packet({
      packetId: "alert:new-version-current",
      measurements: [measurement(0, -12)],
    }))).status, 202);
    assert.equal((await postTelemetry(packet({
      packetId: "alert:old-version-delayed",
      measurements: [measurement(30 * 60, -12)],
    }))).status, 202);

    const events = await firestore.collection("monitoringAlertEvents").get();
    assert.equal(events.size, 1);
    assert.equal(events.docs[0].data().state, "historical");
    assert.equal(events.docs[0].data().ruleRevision, 1);
    assert.equal(events.docs[0].data().thresholdC, -15);
    const state = await firestore.doc(`monitoringDeviceState/${DEVICE_ID}`).get();
    assert.equal(state.data().temperatureC, -12);
    assert.equal(state.data().alertActive, false);
  });

  test("changing, disabling and deleting a rule close only that rule's active episode", async () => {
    await seedTemperatureRule({ id: "disable-rule", name: "Отключить", direction: "above", thresholdC: -15 });
    await seedTemperatureRule({ id: "change-rule", name: "Изменить", direction: "above", thresholdC: -20 });
    await seedTemperatureRule({ id: "delete-rule", name: "Удалить", direction: "below", thresholdC: -10 });
    assert.equal((await postTelemetry(packet({
      packetId: "alert:three-rules",
      measurements: [measurement(20, -12)],
    }))).status, 202);

    await callRule({
      action: "upsert", deviceId: DEVICE_ID, ruleId: "disable-rule",
      name: "Отключить", enabled: false, direction: "above", thresholdC: -15,
    });
    let state = await firestore.doc(`monitoringDeviceState/${DEVICE_ID}`).get();
    assert.deepEqual(Object.keys(state.data().activeAlertIds).sort(), ["change-rule", "delete-rule"]);

    await callRule({
      action: "upsert", deviceId: DEVICE_ID, ruleId: "change-rule",
      name: "Изменённое", enabled: true, direction: "above", thresholdC: -18,
    });
    state = await firestore.doc(`monitoringDeviceState/${DEVICE_ID}`).get();
    assert.deepEqual(Object.keys(state.data().activeAlertIds), ["delete-rule"]);

    await callRule({ action: "delete", deviceId: DEVICE_ID, ruleId: "delete-rule" });
    state = await firestore.doc(`monitoringDeviceState/${DEVICE_ID}`).get();
    assert.equal(state.data().alertActive, false);
    assert.deepEqual(state.data().activeAlertIds, {});

    const events = await firestore.collection("monitoringAlertEvents").get();
    const reasons = Object.fromEntries(events.docs.map((item) => [item.data().ruleId, item.data().closedReason]));
    assert.deepEqual(reasons, {
      "disable-rule": "rule_disabled",
      "change-rule": "rule_changed",
      "delete-rule": "rule_deleted",
    });
    const changedEvent = events.docs.find((item) => item.data().ruleId === "change-rule").data();
    assert.equal(changedEvent.thresholdC, -20, "event must keep the original rule snapshot");
  });
});
