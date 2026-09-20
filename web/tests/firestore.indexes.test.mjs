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
