import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanGeneratedTitle,
  normalizeRequiredTitle,
  trimAtWordBoundary,
  trimDescriptionToTarget,
} from "../lib/listing-sanitizer";

test("required title identity is placed once without duplicate keyword fragments", () => {
  assert.equal(
    normalizeRequiredTitle(
      "Limima, Decorative Slate Plaque, Decorative Plaque - Military Prayer Decor",
      "Limima",
      "Decorative Slate Plaque",
    ),
    "Limima Decorative Slate Plaque, Military Prayer Decor",
  );
});

test("required title identity is added while useful differentiators are preserved", () => {
  assert.equal(
    normalizeRequiredTitle(
      "Military Prayer Decor with American Flag Design",
      "Limima",
      "Decorative Slate Plaque",
    ),
    "Limima Decorative Slate Plaque, Military Prayer Decor with American Flag Design",
  );
});

test("long copy is trimmed cleanly at a word or sentence boundary", () => {
  assert.ok(trimAtWordBoundary("one two three four five", 15).length <= 15);
  const description = `${"A complete product sentence. ".repeat(40)}End.`;
  const trimmed = trimDescriptionToTarget(description, 650, 800);
  assert.ok(trimmed.length >= 650 && trimmed.length <= 800);
  assert.match(trimmed, /[.!?]$/);
});

test("AI-written title is preserved without deleting words or rewriting connectors", () => {
  const title = "Limima Thank You Veterans Garden Flag,  Patriotic Garden Flag, Memorial Day-Retirement Gifts for Hero-Soldier by Daughter-Son, Double-Sided Yard Banner";

  assert.equal(
    cleanGeneratedTitle(title),
    "Limima Thank You Veterans Garden Flag, Patriotic Garden Flag, Memorial Day-Retirement Gifts for Hero-Soldier by Daughter-Son, Double-Sided Yard Banner",
  );
});
