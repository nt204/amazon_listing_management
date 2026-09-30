import assert from "node:assert/strict";
import test from "node:test";

import { classifyOutcome } from "../lib/ppc/action-outcome-evaluator";

const baseline = {
  impressions: 1_000,
  clicks: 100,
  spend: 30,
  sales: 100,
  orders: 10,
  units: 10,
  acos: 30,
  roas: 100 / 30,
  cvr: 10,
  avgCpc: 0.3,
};

test("outcome classification requires SKU economics", () => {
  assert.equal(classifyOutcome(baseline, 30, baseline, 30, null), null);
});

test("outcome classification compares daily contribution instead of raw window totals", () => {
  const improved = {
    ...baseline,
    spend: 5,
    sales: 40,
    orders: 4,
    acos: 12.5,
  };
  assert.equal(classifyOutcome(baseline, 30, improved, 7, 40), "POSITIVE");

  const worse = {
    ...baseline,
    spend: 20,
    sales: 20,
    orders: 1,
    acos: 100,
  };
  assert.equal(classifyOutcome(baseline, 30, worse, 7, 40), "NEGATIVE");
});
