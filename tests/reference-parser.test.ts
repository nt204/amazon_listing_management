import assert from "node:assert/strict";
import test from "node:test";
import { resolveReferenceTargets } from "../lib/reference-parser";

test("reference parser accepts multiple Amazon URLs and keeps their marketplaces", () => {
  const targets = resolveReferenceTargets(
    [
      "https://www.amazon.com/Example/dp/B012345678?ref_=abc",
      "https://www.amazon.co.uk/dp/B09DTBP1FX/ref=detail?th=1",
    ].join("\n"),
    "US",
  );

  assert.deepEqual(targets, [
    { asin: "B012345678", url: "https://www.amazon.com/dp/B012345678" },
    { asin: "B09DTBP1FX", url: "https://www.amazon.co.uk/dp/B09DTBP1FX" },
  ]);
});

test("reference parser deduplicates URLs and accepts bare ASINs", () => {
  const targets = resolveReferenceTargets(
    "B09DTBP1FX\nB09DTBP1FX\nhttps://www.amazon.com/dp/B012345678",
    "US",
  );

  assert.deepEqual(targets, [
    { asin: "B012345678", url: "https://www.amazon.com/dp/B012345678" },
    { asin: "B09DTBP1FX", url: "https://www.amazon.com/dp/B09DTBP1FX" },
  ]);
});

test("reference parser limits a listing to three references", () => {
  const targets = resolveReferenceTargets(
    "B000000001 B000000002 B000000003 B000000004",
    "DE",
  );

  assert.equal(targets.length, 3);
});
