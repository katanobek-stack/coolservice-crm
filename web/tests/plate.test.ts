import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { normalizePlate, platesMatch } from "../src/shared/utils/plate";

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
