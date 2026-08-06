import assert from "node:assert/strict";
import test from "node:test";
import { consolidateOcrLines, parseOcrTextFallback, parseOcrTsv } from "../lib/ocr";
import { getRuleProfile } from "../lib/rules";
import type { ListingInput } from "../lib/types";

const input = {
  configuration: { rule_profile: "amazon-pod" },
} as ListingInput;
const rules = getRuleProfile(input).ocr;
const header = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";

test("OCR parser keeps readable product wording verbatim", () => {
  const tsv = [
    header,
    "5\t1\t1\t1\t1\t1\t0\t0\t20\t10\t91\tLET'S",
    "5\t1\t1\t1\t1\t2\t21\t0\t20\t10\t90\tGROW,",
    "5\t1\t1\t1\t1\t3\t42\t0\t20\t10\t89\tBLOOM,",
    "5\t1\t2\t1\t1\t1\t0\t20\t10\t10\tnoise",
  ].join("\n");

  const lines = parseOcrTsv(tsv, 1, rules);
  assert.deepEqual(lines.map((line) => line.text), ["LET'S GROW, BLOOM,"]);
  assert.equal(lines[0].sourceImage, 1);
});

test("OCR deduplicates repeated lines and keeps the clearest version", () => {
  const lines = consolidateOcrLines([
    { text: "LET'S GROW, BLOOM", confidence: 90, sourceImage: 1, occurrences: 1 },
    { text: "LET'S GROW, BLOOM,", confidence: 90, sourceImage: 2, occurrences: 1 },
  ], rules);

  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, "LET'S GROW, BLOOM,");
  assert.equal(lines[0].occurrences, 2);
});

test("plain-text OCR fallback filters weak output", () => {
  assert.deepEqual(parseOcrTextFallback("CLEAR PRODUCT TEXT", 90, 1, rules)[0].text, "CLEAR PRODUCT TEXT");
  assert.deepEqual(parseOcrTextFallback("noise", 1, 1, rules), []);
});
