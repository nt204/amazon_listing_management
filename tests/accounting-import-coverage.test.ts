import assert from "node:assert/strict";
import test from "node:test";

import {
  assertRowsInsideCoverage,
  coverageFromAccountingFileName,
  normalizeImportCoverage,
} from "../lib/accounting/import-coverage";

test("daily Orders and Ads filenames cover exactly their report date", () => {
  assert.deepEqual(coverageFromAccountingFileName("02_AllOrders_2026-10-23.txt", "orders"), {
    start: "2026-10-23",
    end: "2026-10-23",
  });
  assert.deepEqual(coverageFromAccountingFileName("05_Campaigns_2026-10-23.csv", "ads"), {
    start: "2026-10-23",
    end: "2026-10-23",
  });
});

test("Returns filename covers the declared rolling seven-day report", () => {
  assert.deepEqual(coverageFromAccountingFileName("03_Returns_2026-10-23.csv", "returns"), {
    start: "2026-10-17",
    end: "2026-10-23",
  });
});

test("coverage validation rejects partial, reversed, and out-of-range data", () => {
  assert.equal(normalizeImportCoverage(null, null), undefined);
  assert.throws(() => normalizeImportCoverage("2026-10-23", null));
  assert.throws(() => normalizeImportCoverage("2026-02-30", "2026-03-01"));
  assert.throws(() => normalizeImportCoverage("2026-10-24", "2026-10-23"));
  assert.throws(() =>
    assertRowsInsideCoverage([{ date: "2026-10-16" }], {
      start: "2026-10-17",
      end: "2026-10-23",
    }),
  );
});

test("an empty report is valid when its coverage is explicit", () => {
  assert.doesNotThrow(() =>
    assertRowsInsideCoverage([], { start: "2026-10-17", end: "2026-10-23" }),
  );
});
