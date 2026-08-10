import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanGeneratedTitle,
  repeatedTitleWords,
  trimAtWordBoundary,
  trimDescriptionToTarget,
} from "../lib/listing-sanitizer";

test("long copy is trimmed cleanly at a word or sentence boundary", () => {
  assert.ok(trimAtWordBoundary("one two three four five", 15).length <= 15);
  const description = `${"A complete product sentence. ".repeat(40)}End.`;
  const trimmed = trimDescriptionToTarget(description, 650, 800);
  assert.ok(trimmed.length >= 650 && trimmed.length <= 800);
  assert.match(trimmed, /[.!?]$/);
});

test("title repetition ignores grammar words but still flags repeated keywords", () => {
  assert.deepEqual(repeatedTitleWords("Mug for Nurses for Work for Home", 2, ["for"]), []);
  assert.deepEqual(repeatedTitleWords("Nurse Mug, Coffee Mug for Mug Lovers", 2, ["for"]), ["mug"]);
});

test("AI-written title is preserved without deleting words or rewriting connectors", () => {
  const title = "Limima Garden Flag,  Patriotic Thank You Veterans Decor for Veterans, Outdoor Display with Double-Sided Print, 12 x 18 Inches";

  assert.equal(
    cleanGeneratedTitle(title),
    "Limima Garden Flag, Patriotic Thank You Veterans Decor for Veterans, Outdoor Display with Double-Sided Print, 12 x 18 Inches",
  );
});
