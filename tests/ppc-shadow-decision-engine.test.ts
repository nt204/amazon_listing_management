import assert from "node:assert/strict";
import test from "node:test";

import { buildShadowCandidates, evaluateShadowDecision } from "../lib/ppc/shadow-decision-engine";

test("decrease candidates use average CPC and preserve rule direction", () => {
  const candidates = buildShadowCandidates({
    currentBid: 1,
    averageCpc: 0.7,
    ruleBid: 0.64,
    ruleDirection: "DECREASE",
    maxBid: 1.2,
  });
  assert.deepEqual(candidates.map((candidate) => [candidate.id, candidate.bid]), [
    ["DECREASE_AVG_CPC_MINUS_8", 0.64],
    ["DECREASE_AVG_CPC_MINUS_10", 0.63],
    ["DECREASE_AVG_CPC_MINUS_15", 0.6],
    ["HOLD", 1],
  ]);
  assert.equal(candidates.find((candidate) => candidate.isRuleCandidate)?.id, "DECREASE_AVG_CPC_MINUS_8");
});

test("increase candidates use current bid and max bid guardrail", () => {
  const candidates = buildShadowCandidates({
    currentBid: 1,
    averageCpc: 0.7,
    ruleBid: 1.05,
    ruleDirection: "INCREASE",
    maxBid: 1.06,
  });
  assert.equal(candidates[0].allowed, true);
  assert.equal(candidates[1].allowed, false);
  assert.deepEqual(candidates[1].guardrailReasons, ["ABOVE_MAX_BID"]);
});

test("missing mature evidence always falls back to the rule in shadow mode", () => {
  const decision = evaluateShadowDecision({
    currentBid: 1,
    averageCpc: 0.7,
    ruleBid: 0.63,
    ruleDirection: "DECREASE",
    evidence: [],
  });
  assert.equal(decision.status, "RULE_FALLBACK");
  assert.equal(decision.selectedCandidateId, "DECREASE_AVG_CPC_MINUS_10");
  assert.equal(decision.reasonCode, "INSUFFICIENT_EVIDENCE");
  assert.equal(decision.createsAction, false);
});

test("pause remains rule-only and never becomes an automatic action", () => {
  const decision = evaluateShadowDecision({
    currentBid: 0.8,
    averageCpc: 0.6,
    ruleBid: 0,
    ruleDirection: "PAUSE",
  });
  assert.equal(decision.selectedCandidateId, "PAUSE_RULE_ONLY");
  assert.equal(decision.createsAction, false);
});
