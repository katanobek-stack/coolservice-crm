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

module.exports = { MAX_POINT_WRITES, planHourBatches, applyOnlyMissing };
