const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseWorkPhotos, appendWorkPhotos } = require("../lib/workPhotos");
const folder = "work-reports/worker/ppz/task";
const photo = (id = "photo1", scope = folder) => ({ id, path: `${scope}/${id}.jpg`, url: `https://firebasestorage.googleapis.com/v0/b/demo-project.firebasestorage.app/o/${encodeURIComponent(`${scope}/${id}.jpg`)}?alt=media&token=demo` });
test("legacy reports need no attachments; both default bucket formats are accepted", () => {
  assert.deepEqual(parseWorkPhotos(undefined, folder, "demo-project"), []);
  assert.deepEqual(parseWorkPhotos([photo()], folder, "demo-project"), [photo()]);
  assert.equal(parseWorkPhotos([{ ...photo(), url: photo().url.replace("firebasestorage.app", "appspot.com") }], folder, "demo-project").length, 1);
});
test("photo metadata cannot impersonate another employee, task or project", () => {
  for (const value of [photo("p", "work-reports/other/ppz/task"), photo("p", "work-reports/worker/ppz/other"),
    { ...photo(), path: `${folder}/../photo1.jpg` }, { ...photo(), url: photo().url.replace("demo-project", "other-project") },
    { ...photo(), url: "https://example.org/photo.jpg" }, { ...photo(), url: "javascript:alert(1)" },
    { ...photo(), url: photo().url.replace("alt=media", "alt=json") }, { ...photo(), id: "bad/id" },
  ]) assert.throws(() => parseWorkPhotos([value], folder, "demo-project"), { code: "invalid-argument" });
  assert.deepEqual(parseWorkPhotos([{ ...photo(), uploadedBy: "admin", secret: "ignored" }], folder, "demo-project"), [photo()]);
});
test("bounded arrays and duplicates are rejected", () => {
  for (const value of [null, {}, Array.from({ length: 7 }, (_, i) => photo(`p${i}`)), [photo(), photo()]]) {
    assert.throws(() => parseWorkPhotos(value, folder, "demo-project"), { code: "invalid-argument" });
  }
});
test("merge preserves old evidence without duplicates or mutation", () => {
  const old = [photo()];
  assert.deepEqual(appendWorkPhotos(old, [photo(), photo("p2")]), [photo(), photo("p2")]);
  assert.equal(old.length, 1);
  assert.throws(() => appendWorkPhotos(old, [{ ...photo(), path: "other" }]), { code: "already-exists" });
  assert.throws(() => appendWorkPhotos(Array.from({ length: 60 }, (_, i) => photo(`p${i}`)), [photo("extra")]), { code: "resource-exhausted" });
});
