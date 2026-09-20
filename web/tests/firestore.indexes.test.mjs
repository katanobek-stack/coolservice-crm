import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const INDEXES_PATH = new URL("../../firestore.indexes.json", import.meta.url);

test("unplaced packet history has the required composite Firestore index", async () => {
  const config = JSON.parse(await readFile(INDEXES_PATH, "utf8"));
  const expectedFields = [
    { fieldPath: "hasUnplaced", order: "ASCENDING" },
    { fieldPath: "receivedAt", order: "DESCENDING" },
  ];
  assert.ok(config.indexes.some((index) => (
    index.collectionGroup === "packets"
    && index.queryScope === "COLLECTION"
    && JSON.stringify(index.fields) === JSON.stringify(expectedFields)
  )));
});

test("prepared history read model has bounded raw, unplaced and rollup indexes", async () => {
  const config = JSON.parse(await readFile(INDEXES_PATH, "utf8"));
  const expected = [
    ["points", [
      { fieldPath: "sensorId", order: "ASCENDING" },
      { fieldPath: "measuredAt", order: "ASCENDING" },
    ]],
    ["unplacedPoints", [
      { fieldPath: "sensorId", order: "ASCENDING" },
      { fieldPath: "receivedAt", order: "DESCENDING" },
    ]],
    ["rollups", [
      { fieldPath: "sensorId", order: "ASCENDING" },
      { fieldPath: "hourStart", order: "ASCENDING" },
    ]],
  ];
  for (const [collectionGroup, fields] of expected) {
    assert.ok(config.indexes.some((index) => (
      index.collectionGroup === collectionGroup
      && index.queryScope === "COLLECTION"
      && JSON.stringify(index.fields) === JSON.stringify(fields)
    )), `Missing ${collectionGroup} index`);
  }
});
