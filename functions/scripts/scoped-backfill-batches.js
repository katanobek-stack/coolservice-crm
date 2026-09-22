const MAX_POINT_WRITES = 400;

function planHourBatches(entries, maxPointWrites = MAX_POINT_WRITES) {
  let activeHour = null;
  const batches = [];
  for (const entry of entries) {
    const hour = Math.floor(entry.measuredAtMs / 3600000) * 3600000;
    if (hour !== activeHour || !batches.length || batches[batches.length - 1].pointCount + entry.pointCount > maxPointWrites) {
      batches.push({ hourStartMs: hour, pointCount: 0, entries: [] }); activeHour = hour;
    }
    const target = batches[batches.length - 1];
    target.entries.push(entry); target.pointCount += entry.pointCount;
  }
  return batches;
}

function applyOnlyMissing(existingIds, candidates) {
  return candidates.filter((candidate) => !existingIds.has(candidate.stableId));
}

function checkpointCursor(batch) {
  const last = batch.entries[batch.entries.length - 1];
  return { utcHourMs: batch.hourStartMs, batchLastStableMeasurementId: last.stableId };
}

function pendingAfterCursor(batches, cursor) {
  if (!Number.isFinite(cursor?.utcHourMs) || typeof cursor?.batchLastStableMeasurementId !== "string") return batches;
  const pending = batches.flatMap((batch) => batch.entries).filter((entry) => entry.measuredAtMs > cursor.utcHourMs
    || (entry.measuredAtMs === cursor.utcHourMs && entry.stableId > cursor.batchLastStableMeasurementId));
  return planHourBatches(pending);
}

function isCurrentCursor(cursor) {
  return Number.isFinite(cursor?.utcHourMs) && typeof cursor?.batchLastStableMeasurementId === "string";
}

module.exports = { MAX_POINT_WRITES, planHourBatches, applyOnlyMissing, checkpointCursor, pendingAfterCursor, isCurrentCursor };
