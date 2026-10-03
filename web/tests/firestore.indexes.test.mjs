import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const INDEXES_PATH = new URL("../../firestore.indexes.json", import.meta.url);

test("prepared history read model has bounded raw and rollup indexes", async () => {
  const config = JSON.parse(await readFile(INDEXES_PATH, "utf8"));
  const expected = [
    ["points", [
      { fieldPath: "sensorId", order: "ASCENDING" },
      { fieldPath: "measuredAt", order: "ASCENDING" },
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
