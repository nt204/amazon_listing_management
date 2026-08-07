import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanGeneratedTitle,
  formatGeneratedTitleCase,
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

test("generated title uses Title Case while minor words stay lowercase", () => {
  const title = "limima thank you veterans garden flag for memorial day and independence day, gift for hero-soldier by daughter and son, double-sided yard banner";

  assert.equal(
    formatGeneratedTitleCase(title, { brand: "limima" }),
    "Limima Thank You Veterans Garden Flag for Memorial Day and Independence Day, Gift for Hero-Soldier by Daughter and Son, Double-Sided Yard Banner",
  );
});

test("visible artwork wording stays uppercase without adding quotation marks", () => {
  const title = "Limima thank you veterans garden flag for heroes";

  assert.equal(
    formatGeneratedTitleCase(title, {
      brand: "Limima",
      uppercasePhrases: ["Thank You Veterans"],
    }),
    "Limima THANK YOU VETERANS Garden Flag for Heroes",
  );
});
