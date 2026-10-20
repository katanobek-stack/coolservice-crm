import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { repairPhotos, serviceTaskPhotos, uploadPhoto } from "../src/shared/utils/photos";

test("unreadable photo rejects before contacting Storage instead of hanging", { timeout: 1000 }, async () => {
  const original = globalThis.FileReader;
  class BrokenReader { onerror?: () => void; readAsDataURL() { queueMicrotask(() => this.onerror?.()); } }
  globalThis.FileReader = BrokenReader as unknown as typeof FileReader;
  try { await assert.rejects(uploadPhoto(new File(["invalid"], "bad.jpg", { type: "image/jpeg" })), /прочитать фотографию/); }
  finally { globalThis.FileReader = original; }
});

test("unsupported image rejects before contacting Storage instead of hanging", { timeout: 1000 }, async () => {
  const originalReader = globalThis.FileReader, originalImage = globalThis.Image;
  class Reader { onload?: (event: unknown) => void; readAsDataURL() { queueMicrotask(() => this.onload?.({ target: { result: "data:image/jpeg;base64,bad" } })); } }
  class BrokenImage { onerror?: () => void; set src(_value: string) { queueMicrotask(() => this.onerror?.()); } }
  globalThis.FileReader = Reader as unknown as typeof FileReader;
  globalThis.Image = BrokenImage as unknown as typeof Image;
  try { await assert.rejects(uploadPhoto(new File(["invalid"], "bad.jpg", { type: "image/jpeg" })), /открыть изображение/); }
  finally { globalThis.FileReader = originalReader; globalThis.Image = originalImage; }
});

describe("repairPhotos", () => {
  test("collects repair photos and every task's photos", () => {
    const repair = {
      photos: [{ id: "a", path: "photos/a.jpg" }],
      tasks: [
        { photos: [{ id: "b", path: "photos/b.jpg" }] },
        { photos: [{ id: "c", data: "data:image/jpeg;base64,..." }] },
        {},
      ],
    };
    assert.deepEqual(
      repairPhotos(repair).map((p) => p.id),
      ["a", "b", "c"],
    );
  });

  test("handles missing repair / arrays", () => {
    assert.deepEqual(repairPhotos(undefined), []);
    assert.deepEqual(repairPhotos({}), []);
    assert.deepEqual(repairPhotos({ tasks: [] }), []);
  });
});

describe("serviceTaskPhotos", () => {
  test("collects task photos and every subtask's photos", () => {
    const task = {
      photos: [{ id: "a", path: "photos/a.jpg" }],
      subtasks: [
        { photos: [{ id: "b", path: "photos/b.jpg" }] },
        { photos: [] },
      ],
    };
    assert.deepEqual(
      serviceTaskPhotos(task).map((p) => p.id),
      ["a", "b"],
    );
  });

  test("handles missing task", () => {
    assert.deepEqual(serviceTaskPhotos(undefined), []);
    assert.deepEqual(serviceTaskPhotos({}), []);
  });
});
