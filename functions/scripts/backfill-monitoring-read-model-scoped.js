#!/usr/bin/env node
// Manual Admin tool. Dry-run by default; scoped execute needs explicit confirmation.
const { getApps, initializeApp } = require("firebase-admin/app");
const { FieldPath, getFirestore, Timestamp } = require("firebase-admin/firestore");
const { canonicalBackfillSensorId, pointDocumentData, nextRollupData, rollupDocumentId, stableMeasurementId } = require("../lib/telemetryReadModel");
const { MAX_POINT_WRITES, planHourBatches, applyOnlyMissing } = require("./scoped-backfill-batches");
const option = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const projectId = option("--project"), deviceId = option("--device-id"), day = option("--utc-day");
const execute = process.argv.includes("--execute"), rate = Number(option("--rate-per-minute", "120"));
if (!projectId || deviceId !== "device-001" || !/^\d{4}-\d{2}-\d{2}$/.test(day || "") || !Number.isFinite(rate) || rate <= 0 || rate > 120) throw new Error("requires --project, device-001, --utc-day YYYY-MM-DD and rate 1..120");
if (execute && option("--confirm-scope") !== `${deviceId}:${day}`) throw new Error("--execute requires --confirm-scope device-001:YYYY-MM-DD");
if (!getApps().length) initializeApp({ projectId });
const db = getFirestore(), start = Date.parse(`${day}T00:00:00.000Z`), end = start + 86400000;
const root = `monitoringTelemetry/${deviceId}`, checkpoint = db.doc(`monitoringMaintenance/telemetryReadModelBackfill/checkpoints/${deviceId}__${day}`);
function entriesFromPackets(packets) {
  const result = [];
  for (const packet of packets.docs) for (const [index, raw] of (packet.data().measurements || []).entries()) {
    if (!(raw.measuredAt instanceof Timestamp) || !Number.isFinite(raw.temperatureC)) continue;
    const measuredAtMs = raw.measuredAt.toMillis(); if (measuredAtMs < start || measuredAtMs >= end) continue;
    const packetId = typeof packet.data().packetId === "string" ? packet.data().packetId : packet.id;
    result.push({ packetId, index, stableId: stableMeasurementId(packetId, index), measuredAtMs, pointCount: 1, raw, receivedAt: packet.data().receivedAt instanceof Timestamp ? packet.data().receivedAt : Timestamp.now() });
  }
  // Packet-id order preserves the existing partial checkpoint contract. MQTT
  // packet IDs used by this controller are chronological, so each batch stays
  // within one UTC hour without skipping an earlier checkpointed packet.
  return result.sort((a,b) => a.packetId.localeCompare(b.packetId) || a.index - b.index);
}
async function runBatch(batch) {
  const pointRefs = batch.entries.map((e) => db.doc(`${root}/points/${e.stableId}`));
  const rollupId = rollupDocumentId("temperature-1", batch.entries[0].measuredAtMs), rollupRef = db.doc(`${root}/hourRollups/${rollupId}`);
  return db.runTransaction(async (tx) => {
    const snapshots = await tx.getAll(...pointRefs, rollupRef); const rollupSnapshot = snapshots.pop();
    const existing = new Set(snapshots.filter((s) => s.exists).map((s) => s.id));
    const missing = applyOnlyMissing(existing, batch.entries); let rollup = rollupSnapshot.exists ? rollupSnapshot.data() : undefined;
    for (const e of missing) {
      const m = { packetId: e.packetId, measurementIndex: e.index, sensorId: canonicalBackfillSensorId(deviceId, typeof e.raw.sensorId === "string" ? e.raw.sensorId : undefined), temperatureC: e.raw.temperatureC, measuredAt: e.raw.measuredAt.toDate(), timeQuality: e.raw.timeQuality === "estimated" ? "estimated" : "exact", deliveryQuality: e.raw.deliveryQuality === "delayed" ? "delayed" : "realtime" };
      tx.create(db.doc(`${root}/points/${e.stableId}`), pointDocumentData(deviceId, m, e.receivedAt)); rollup = nextRollupData(rollup, deviceId, m, e.receivedAt);
    }
    if (missing.length) tx.set(rollupRef, rollup);
    const last = batch.entries[batch.entries.length - 1];
    tx.set(checkpoint, { deviceId, utcDay: day, status: "running", lastCompletedPacketId: last.packetId, processedPacketGroups: batch.entries.length, batchWrites: missing.length + 2, ratePerMinute: rate, updatedAt: Timestamp.now() }, { merge: true });
    return { created: missing.length, skipped: batch.entries.length - missing.length };
  });
}
async function main() { const [packets, cp] = await Promise.all([db.collection(`${root}/packets`).orderBy(FieldPath.documentId()).get(), checkpoint.get()]); const all = entriesFromPackets(packets); const after = cp.data()?.lastCompletedPacketId; const pending = after ? all.filter((e) => e.packetId > after) : all; const batches = planHourBatches(pending); const report = { mode: execute ? "execute" : "dry-run", deviceId, utcDay: day, checkpoint: cp.exists ? cp.data()?.lastCompletedPacketId ?? null : null, timedPoints: all.length, pendingTimedPoints: pending.length, batches: batches.length, maxPointWrites: MAX_POINT_WRITES, maxFirestoreWritesPerTransaction: MAX_POINT_WRITES + 2, ratePerMinute: rate }; if (!execute) return console.log(JSON.stringify(report)); let created=0, skipped=0; for (const batch of batches) { const begun=Date.now(), result=await runBatch(batch); created+=result.created; skipped+=result.skipped; const wait=Math.max(0, Math.ceil(batch.entries.length*60000/rate)-(Date.now()-begun)); if(wait) await new Promise(r=>setTimeout(r,wait)); } await checkpoint.set({ status:"completed", completedAt:Timestamp.now() },{merge:true}); console.log(JSON.stringify({...report,created,skipped})); }
main().catch((e)=>{console.error(e.stack||e.message);process.exitCode=1});
