import assert from "node:assert/strict";
import test from "node:test";

import { buildActionDecisionContext, inferActionDecisionSource } from "../lib/ppc/action-memory";
import type { PpcRecommendation } from "../lib/ppc/types";
import { inferOutcomeUserAction } from "../lib/ppc/action-outcome-evaluator";

test("unchanged rule bid remains a rule decision", () => {
  assert.equal(inferActionDecisionSource({
    systemSuggestedValue: 0.64,
    finalValue: 0.64,
  }), "RULE_ENGINE");
  assert.equal(inferOutcomeUserAction({
    systemSuggestedValue: 0.64,
    finalValue: 0.64,
  }), "APPLY_RULE");
});

test("a material user bid change is classified as an edit", () => {
  assert.equal(inferActionDecisionSource({
    systemSuggestedValue: 0.64,
    finalValue: 0.66,
  }), "USER_EDIT");
  assert.equal(inferOutcomeUserAction({
    systemSuggestedValue: 0.64,
    finalValue: 0.66,
  }), "EDIT");
});

test("cent-rounding noise does not become an edit", () => {
  assert.equal(inferOutcomeUserAction({
    systemSuggestedValue: 0.64,
    finalValue: 0.644,
  }), "APPLY_RULE");
});

test("an explicit AI context is preserved", () => {
  assert.equal(inferOutcomeUserAction({
    systemSuggestedValue: 0.64,
    finalValue: 0.64,
    context: {
      decision: { source: "AI_AGENT" },
    },
  }), "APPLY_AI");
});

test("accepted AI application stores its audit snapshot in action context", () => {
  const recommendation: PpcRecommendation = {
    id: "rec-ai-1",
    storeId: "store-1",
    storeName: "Store A",
    recType: "BID_DECREASE",
    targetType: "EXACT",
    keyword: "ornament hook",
    reason: "High ACoS",
    estimatedSavings: 0,
    status: "PENDING",
    currentBid: 0.8,
    recommendedBid: 0.7,
    clicks: 30,
    orders: 2,
    spend: 20,
    sales: 40,
    createdAt: "2026-10-01T00:00:00.000Z",
  };
  const context = buildActionDecisionContext({
    actionId: "action-ai-1",
    recommendation,
    finalValue: 0.68,
    approvedBy: "operator",
    requestedSource: "AI_AGENT",
    aiReview: {
      validation_status: "ACCEPTED_SHADOW",
      effective_candidate_id: "DECREASE_AVG_CPC_MINUS_10",
      sample_count: 25,
    },
  });

  assert.equal((context.decision as Record<string, unknown>).source, "AI_AGENT");
  assert.deepEqual(context.ai_review, {
    validation_status: "ACCEPTED_SHADOW",
    effective_candidate_id: "DECREASE_AVG_CPC_MINUS_10",
    sample_count: 25,
  });
});
