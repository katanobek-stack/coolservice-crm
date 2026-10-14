import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { normalizePlate, platesMatch } from "../src/shared/utils/plate";
import { primaryPlateDigits, suggestIntakeVehicles, suggestedVehicleForClient, vehicleMatchesSearch } from "../src/shared/utils/clientVehicleSearch";
import type { Client } from "../src/shared/types/client";

describe("normalizePlate", () => {
  test("upper-cases, strips separators, folds Cyrillic look-alikes", () => {
    assert.equal(normalizePlate("а 123 вс 125"), "A123BC125");
    assert.equal(normalizePlate("А123ВС125"), "A123BC125");
    assert.equal(normalizePlate("a123bc125"), "A123BC125");
    assert.equal(normalizePlate("A123BC 125"), "A123BC125");
  });

  test("Cyrillic and Latin spellings collapse to the same value", () => {
    assert.equal(normalizePlate("Н777НН"), normalizePlate("H777HH"));
    assert.equal(normalizePlate("о000оо"), "O000OO");
    assert.equal(normalizePlate("Х555ХХ96"), "X555XX96");
  });

  test("drops dashes, dots and other punctuation", () => {
    assert.equal(normalizePlate("К-483-ЕР.61"), "K483EP61");
  });

  test("empty input", () => {
    assert.equal(normalizePlate(""), "");
    assert.equal(normalizePlate(undefined), "");
    assert.equal(normalizePlate(null), "");
    assert.equal(normalizePlate("   "), "");
  });
});

describe("intake vehicle suggestions", () => {
  const clients = [
    { id: "c1", name: "Первый", vehicles: [
      { id: "unrelated", plate: "М999ММ123" },
      { id: "digits", plate: "В123АА77" },
    ] },
    { id: "c2", name: "Второй", vehicles: [
      { id: "exact", plate: "А 123 ВС 125" },
      { id: "digits2", plate: "Х123ХХ25" },
    ] },
    { id: "empty", name: "Без машин" },
  ] as Client[];

  test("suggests every vehicle with the main digits, exact full plate first", () => {
    const found = suggestIntakeVehicles(clients, "A123BC125");
    assert.deepEqual(found.map((m) => [m.client.id, m.vehicle.id, m.exact]), [
      ["c2", "exact", true], ["c1", "digits", false], ["c2", "digits2", false],
    ]);
    assert.equal(primaryPlateDigits("А 123 ВС 125"), "123");
  });

  test("digits alone work; matching only the region does not qualify", () => {
    assert.deepEqual(suggestIntakeVehicles(clients, "123").map((m) => m.vehicle.id), ["digits", "exact", "digits2"]);
    assert.equal(suggestIntakeVehicles(clients, "К125КК123").length, 0);
  });

  test("empty or letter-only input does not offer all vehicles", () => {
    assert.equal(suggestIntakeVehicles(clients, " ").length, 0);
    assert.equal(suggestIntakeVehicles(clients, "АВС").length, 0);
    assert.notEqual(primaryPlateDigits("А001АА125"), primaryPlateDigits("А1АА125"));
  });

  test("manual search folds scripts/separators and accepts digit fragments", () => {
    const vehicle = clients[1].vehicles[0];
    for (const query of ["A123BC125", "а123вс125", "123", "123125", "a 123"]) {
      assert.equal(vehicleMatchesSearch(vehicle, query), true, query);
    }
    assert.equal(vehicleMatchesSearch(vehicle, ""), false);
    assert.equal(vehicleMatchesSearch(vehicle, "999"), false);
  });

  test("selects the matching second vehicle instead of the first", () => {
    assert.equal(suggestedVehicleForClient(clients[0], "В123АА77", "А123ВС125"), "digits");
    assert.equal(suggestedVehicleForClient(clients[0], "Первый", "А123ВС125"), "digits");
  });

  test("ambiguous matches require a vehicle choice; no match permits a new vehicle", () => {
    assert.equal(suggestedVehicleForClient(clients[1], "123", "А123ВС125"), "");
    assert.equal(suggestedVehicleForClient(clients[1], "Второй", "А123ВС125"), "");
    assert.equal(suggestedVehicleForClient(clients[2], "Без машин", "А123ВС125"), "new");
    assert.equal(clients[1].vehicles[0].plate, "А 123 ВС 125");
  });
});

describe("platesMatch", () => {
  test("matches across scripts and formatting", () => {
    assert.equal(platesMatch("а123вс 77", "A123BC77"), true);
    assert.equal(platesMatch("К483ЕР", "K 483 EP"), true);
  });

  test("different plates do not match", () => {
    assert.equal(platesMatch("А123ВС77", "А123ВС78"), false);
  });

  test("empty never matches, even against empty", () => {
    assert.equal(platesMatch("", ""), false);
    assert.equal(platesMatch(undefined, "A123BC"), false);
  });
});
