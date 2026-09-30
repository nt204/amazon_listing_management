import assert from "node:assert/strict";
import test from "node:test";

import { buildActionDecisionContext } from "../lib/ppc/action-memory";
import type { PpcRecommendation } from "../lib/ppc/types";

test("PPC action memory captures the rule decision and observed metrics without changing it", () => {
  const recommendation: PpcRecommendation = {
    id: "rec-1",
    storeId: "store-1",
    storeName: "Store A",
    adType: "SP",
    recType: "BID_INCREASE",
    targetType: "EXACT",
    matchType: "Exact",
    keyword: "glass ornament",
    campaignId: "campaign-1",
    campaignName: "Campaign A",
    adGroupId: "group-1",
    adGroupName: "Group A",
    keywordId: "target-1",
    sku: "SKU-1",
    currentBid: 0.8,
    recommendedBid: 0.84,
    reason: "Rule matched",
    estimatedSavings: 0,
    status: "PENDING",
    ruleProfile: "v1.0",
    clicks: 35,
    orders: 4,
    spend: 22,
    sales: 100,
    cpc: 0.6286,
    createdAt: "2026-09-30T00:00:00.000Z",
  };

  const context = buildActionDecisionContext({
    actionId: "action-1",
    recommendation,
    finalValue: 0.84,
    approvedBy: "operator@example.com",
  });

  const decision = context.decision as Record<string, unknown>;
  const metrics = context.metrics as Record<string, unknown>;
  const target = context.target as Record<string, unknown>;

  assert.equal(decision.current_bid, 0.8);
  assert.equal(decision.rule_proposed_bid, 0.84);
  assert.equal(decision.approved_final_bid, 0.84);
  assert.equal(metrics.acos, 22);
  assert.equal(metrics.cvr, (4 / 35) * 100);
  assert.equal(target.target_id, "target-1");
});

test("PPC action memory uses null for unavailable or unsafe calculated metrics", () => {
  const recommendation = {
    id: "rec-2",
    storeId: "store-1",
    storeName: "Store A",
    recType: "BID_DECREASE",
    targetType: "EXACT",
    keyword: "glass ornament",
    reason: "Rule matched",
    estimatedSavings: 0,
    status: "PENDING",
    clicks: 0,
    spend: 5,
    sales: 0,
    orders: 0,
    createdAt: "invalid",
  } satisfies PpcRecommendation;

  const context = buildActionDecisionContext({
    actionId: "action-2",
    recommendation,
    finalValue: 0.5,
    approvedBy: "User",
  });

  const metrics = context.metrics as Record<string, unknown>;

  assert.equal(metrics.avg_cpc, null);
  assert.equal(metrics.acos, null);
  assert.equal(metrics.roas, 0);
  assert.equal(metrics.cvr, null);
});
