// Runs the actual HTTP/callable handlers against an in-memory transaction double.
// This exercises alert lifecycle locally; it does not replace emulator verification.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const Module = require("node:module");
const admin = require("firebase-admin/firestore");
const { createDeviceCredentialHash } = require("../lib/telemetryKey");
const documents = new Map();
const clone = (value) => {
  if (value instanceof admin.Timestamp) return value;
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
};
function ref(path) { return { path, id: path.split("/").at(-1), collection: (name) => collection(`${path}/${name}`), get: async () => snapshot(ref(path)) }; }
function collection(path) { return { path, query: true, doc: (id) => ref(`${path}/${id}`) }; }
function snapshot(reference) { return { ref: reference, id: reference.id, exists: documents.has(reference.path), data: () => clone(documents.get(reference.path)) }; }
const store = {
  doc: ref,
  async runTransaction(work) {
    const writes = [];
    const tx = {
      async get(reference) {
        assert.equal(writes.length, 0, "Firestore reads must precede writes");
        if (!reference.query) return snapshot(reference);
        return { docs: [...documents.keys()].filter((path) => path.startsWith(`${reference.path}/`) && path.split("/").length === reference.path.split("/").length + 1).map((path) => snapshot(ref(path))) };
      },
      async getAll(...refs) { return Promise.all(refs.map((reference) => tx.get(reference))); },
      create(reference, data) { writes.push(() => { assert.equal(documents.has(reference.path), false); documents.set(reference.path, clone(data)); }); },
      set(reference, data, options) { writes.push(() => documents.set(reference.path, options ? { ...documents.get(reference.path), ...clone(data) } : clone(data))); },
      update(reference, data) { writes.push(() => { assert.equal(documents.has(reference.path), true); documents.set(reference.path, { ...documents.get(reference.path), ...clone(data) }); }); },
    };
    const result = await work(tx);
    writes.forEach((write) => write());
    return result;
  },
};
const originalLoad = Module._load;
Module._load = function(name, ...args) {
  if (name === "firebase-admin/firestore") return { ...admin, getFirestore: () => store };
  if (name === "firebase-functions/v2/https") return { ...originalLoad.call(this, name, ...args), onRequest: (_options, handler) => handler, onCall: (_options, handler) => handler };
  return originalLoad.call(this, name, ...args);
};
const { ingestTelemetry } = require("../lib/telemetry");
const { saveMonitoringTemperatureRule } = require("../lib/monitoringTemperatureRules");
Module._load = originalLoad;
const DEVICE = "device-001";
const TEST_KEY = "local-test-only-key-for-sensor-alerts-0001";
let base;
function setup() {
  documents.clear(); base = Date.now() - 60_000;
  documents.set(`monitoringDevices/${DEVICE}`, { name: "Local", enabled: true });
  documents.set(`monitoringDeviceCredentials/${DEVICE}`, { active: true, ...createDeviceCredentialHash(DEVICE, TEST_KEY) });
}
function rule(id, sensorId, direction = "above", thresholdC = -15) {
  const version = { revision: 1, name: id, enabled: true, direction, thresholdC, effectiveFrom: admin.Timestamp.fromMillis(base - 1000), ...(sensorId ? { sensorId } : {}) };
  documents.set(`monitoringDevices/${DEVICE}/temperatureRules/${id}`, { ...version, versions: [version] });
}
function sample(offset, sensorId, temperatureC) { return { sensorId, temperatureC, measuredAt: new Date(base + offset).toISOString() }; }
async function send(packetId, measurements) {
  const result = { code: 200, set() { return this; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await ingestTelemetry({ method: "POST", is: () => true, get: () => `Bearer ${TEST_KEY}`, body: { deviceId: DEVICE, packetId, measurements } }, result);
  assert.ok([200, 202].includes(result.code), JSON.stringify(result.body));
  return result;
}
const events = () => [...documents].filter(([path]) => path.startsWith("monitoringAlertEvents/")).map(([, value]) => value);

test("actual ingest: both directions, unrelated probe, equality recovery and packet dedupe", async () => {
  setup(); rule("rule-one", "temperature-1"); rule("rule-two", "temperature-1_2", "below", -25);
  documents.set(`monitoringDevices/${DEVICE}/sensors/temperature-1`, { name: "Камера" });
  const points = [sample(1000, "temperature-1", -14), sample(1000, "temperature-1_2", -26), sample(1000, "temperature-1_3", -18)];
  await send("local:start", points);
  assert.equal(events().length, 2); assert.ok(events().every((event) => event.state === "active"));
  assert.equal(events().find((event) => event.sensorId === "temperature-1").sensorName, "Камера");
  const size = documents.size;
  assert.equal((await send("local:start", points)).body.outcome, "duplicate"); assert.equal(documents.size, size);
  await send("local:other", [sample(2000, "temperature-1_3", -18)]);
  assert.ok(events().every((event) => event.state === "active"));
  await send("local:recover-one", [sample(3000, "temperature-1", -15)]);
  assert.equal(events().find((event) => event.sensorId === "temperature-1").state, "recovered");
  assert.equal(events().find((event) => event.sensorId === "temperature-1_2").state, "active");
  await send("local:recover-two", [sample(4000, "temperature-1_2", -25)]);
  assert.ok(events().every((event) => event.state === "recovered"));
  assert.ok(events().every((event) => Object.keys(event.viewedBy).length === 0));
});

test("actual ingest: another probe's newer time does not advance the target's cursor", async () => {
  setup(); rule("rule-one", "temperature-1_2");
  await send("local:newer", [sample(5000, "temperature-1", -18)]);
  await send("local:older", [sample(1000, "temperature-1_2", -14)]);
  assert.equal(events()[0].state, "active");
  await send("local:recover", [sample(3000, "temperature-1_2", -15)]);
  await send("local:delayed", [sample(2000, "temperature-1_2", -13)]);
  assert.equal(documents.get(`monitoringDeviceState/${DEVICE}`).alertActive, false);
  assert.equal(events().find((event) => event.state === "historical").sensorId, "temperature-1_2");
});

test("actual ingest: mixed-sensor packet records exceeding and recovery of one probe", async () => {
  setup(); rule("rule-one", "temperature-1_2");
  await send("local:mixed", [sample(1000, "temperature-1_2", -14), sample(2000, "temperature-1", -18), sample(3000, "temperature-1_2", -15)]);
  assert.equal(events().length, 1); assert.equal(events()[0].state, "recovered");
  assert.equal(events()[0].recoveredMeasuredAt.toMillis(), base + 3000);
});

test("actual callable: reassignment closes only its rule and preserves prior sensor version", async () => {
  setup(); rule("rule-one", "temperature-1"); rule("rule-two", "temperature-1_2");
  await send("local:two", [sample(1000, "temperature-1", -14), sample(2000, "temperature-1_2", -14)]);
  const previousVersion = documents.get(`monitoringDevices/${DEVICE}/temperatureRules/rule-one`).versions[0];
  const request = { auth: { uid: "owner-local", token: { role: "owner" } }, data: { action: "upsert", deviceId: DEVICE, ruleId: "rule-one", sensorId: "temperature-1_3", name: "rule-one", enabled: true, direction: "above", thresholdC: -15 } };
  await saveMonitoringTemperatureRule(request);
  assert.equal(events().find((event) => event.ruleId === "rule-one").closedReason, "rule_changed");
  assert.equal(events().find((event) => event.ruleId === "rule-two").state, "active");
  const changed = documents.get(`monitoringDevices/${DEVICE}/temperatureRules/rule-one`);
  assert.deepEqual(changed.versions[0], previousVersion); assert.equal(changed.versions[1].sensorId, "temperature-1_3");
  await assert.rejects(saveMonitoringTemperatureRule({ ...request, auth: { uid: "mechanic-local", token: {} } }), (error) => error.code === "permission-denied");
});
