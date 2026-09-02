import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { repairPhotos, serviceTaskPhotos } from "../src/shared/utils/photos";

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
