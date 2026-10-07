import assert from "node:assert/strict";
import test from "node:test";

import {
  validateAiReviewerResponse,
  invokeAiReviewer,
  buildAiReviewerSystemPrompt,
  type AiReviewerPayload,
} from "../lib/ppc/ai-reviewer";

function createMockPayload(overrides?: Partial<AiReviewerPayload>): AiReviewerPayload {
  return {
    target: {
      campaign_type: "SP03",
      match_type: "BROAD",
      product_type: "ORNAMENT",
      campaign_name: "SP03 - Broad Ornament",
      keyword: "ornament hooks",
    },
    current_state: {
      current_bid: 0.8,
      avg_cpc: 0.62,
      effective_max_bid: 1.25,
      clamped_at_max: false,
    },
    performance: {
      clicks: 32,
      orders: 2,
      spend: 19.84,
      sales: 31.98,
      actual_acos: 62.0,
      break_even_acos: 31.0,
    },
    rule_evaluation: {
      branch: "HAS_ORDER",
      matched_rule_id: "SP03_HAS_ORDER_STRONG_DECREASE",
      rule_intent: "ACoS exceeds break-even",
      rule_selected_candidate: "DECREASE_AVG_CPC_MINUS_15",
      rule_recommended_bid: 0.53,
      rule_direction: "DECREASE",
    },
    scenario_evaluation: {
      target_scenario: "HIGH_ACOS_TRIM",
      acos_be_ratio: 2,
      retrieval_level: "LEVEL_A",
      retrieval_specificity: "HIGH",
      sample_count: 105,
      minimum_samples: 20,
    },
    available_candidates: [
      {
        id: "DECREASE_AVG_CPC_MINUS_15",
        direction: "DECREASE",
        basis: "AVG_CPC",
        adjustment_pct: -15,
        bid: 0.53,
        is_rule_choice: true,
        allowed: true,
        guardrail_reasons: [],
        sample_count: 35,
        win_count: 22,
        neutral_count: 8,
        loss_count: 5,
        median_reward_usd: 4.5,
      },
      {
        id: "DECREASE_AVG_CPC_MINUS_10",
        direction: "DECREASE",
        basis: "AVG_CPC",
        adjustment_pct: -10,
        bid: 0.56,
        is_rule_choice: false,
        allowed: true,
        guardrail_reasons: [],
        sample_count: 42,
        win_count: 31,
        neutral_count: 7,
        loss_count: 4,
        median_reward_usd: 6.2,
      },
      {
        id: "DECREASE_AVG_CPC_MINUS_8",
        direction: "DECREASE",
        basis: "AVG_CPC",
        adjustment_pct: -8,
        bid: 0.57,
        is_rule_choice: false,
        allowed: true,
        guardrail_reasons: [],
        sample_count: 28,
        win_count: 15,
        neutral_count: 6,
        loss_count: 7,
        median_reward_usd: 2.1,
      },
      {
        id: "HOLD",
        direction: "HOLD",
        basis: "CURRENT_BID",
        adjustment_pct: 0,
        bid: 0.8,
        is_rule_choice: false,
        allowed: true,
        guardrail_reasons: [],
        sample_count: 10,
        win_count: 2,
        neutral_count: 5,
        loss_count: 3,
        median_reward_usd: -1.0,
      },
    ],
    data_availability: {
      inventory: false,
      buy_box: false,
      price_events: false,
      coupon_events: false,
      budget_events: false,
      placement_events: false,
    },
    ...overrides,
  };
}

test("Case 1: Insufficient evidence falls back to Rule candidate", () => {
  const payload = createMockPayload();
  const rawResponse = {
    decision: "INSUFFICIENT_EVIDENCE",
    candidate_id: null,
    reason_codes: ["NO_MATURE_HISTORY"],
    evidence_used: [],
    counter_evidence: [],
    need_more_data: true,
  };

  const validation = validateAiReviewerResponse(rawResponse, payload);
  assert.equal(validation.valid, true);
  assert.equal(validation.status, "RULE_FALLBACK");
  assert.equal(validation.effective_candidate_id, "DECREASE_AVG_CPC_MINUS_15");
  assert.equal(validation.decision_source, "RULE_FALLBACK");
});

test("Case 2: AI selects valid candidate with evidence -> accepts shadow", () => {
  const payload = createMockPayload();
  const rawResponse = {
    decision: "SELECT_CANDIDATE",
    candidate_id: "DECREASE_AVG_CPC_MINUS_10",
    reason_codes: ["BETTER_REWARD_TRADEOFF"],
    evidence_used: ["HISTORICAL_OUTCOME"],
    counter_evidence: [],
    need_more_data: false,
  };

  const validation = validateAiReviewerResponse(rawResponse, payload);
  assert.equal(validation.valid, true);
  assert.equal(validation.status, "ACCEPTED_SHADOW");
  assert.equal(validation.effective_candidate_id, "DECREASE_AVG_CPC_MINUS_10");
  assert.equal(validation.effective_bid, 0.56);
  assert.equal(validation.decision_source, "AI_AGENT");
});

test("Case 3: AI selects candidate with reverse direction -> reject and fallback", () => {
  const payload = createMockPayload();
  // Attempt to select an INCREASE candidate when Rule is DECREASE
  const rawResponse = {
    decision: "SELECT_CANDIDATE",
    candidate_id: "INCREASE_CURRENT_BID_PLUS_5",
    reason_codes: ["WRONG_DIRECTION"],
    evidence_used: [],
    counter_evidence: [],
    need_more_data: false,
  };

  // Add the candidate to available array but with INCREASE direction to test direction check
  payload.available_candidates.push({
    id: "INCREASE_CURRENT_BID_PLUS_5",
    direction: "INCREASE",
    basis: "CURRENT_BID",
    adjustment_pct: 5,
    bid: 0.84,
    is_rule_choice: false,
    allowed: true,
    guardrail_reasons: [],
    sample_count: 50,
    win_count: 40,
    neutral_count: 5,
    loss_count: 5,
    median_reward_usd: 10,
  });

  const validation = validateAiReviewerResponse(rawResponse, payload);
  assert.equal(validation.valid, false);
  assert.equal(validation.status, "AI_REVIEW_INVALID");
  assert.match(validation.fallback_reason || "", /REVERSED_RULE_DIRECTION/);
  assert.equal(validation.effective_candidate_id, "DECREASE_AVG_CPC_MINUS_15");
});

test("Case 4: AI produces non-existent candidate ID -> reject and fallback", () => {
  const payload = createMockPayload();
  const rawResponse = {
    decision: "SELECT_CANDIDATE",
    candidate_id: "NON_EXISTENT_CANDIDATE_99",
    reason_codes: [],
    evidence_used: [],
    counter_evidence: [],
    need_more_data: false,
  };

  const validation = validateAiReviewerResponse(rawResponse, payload);
  assert.equal(validation.valid, false);
  assert.equal(validation.status, "AI_REVIEW_INVALID");
  assert.match(validation.fallback_reason || "", /NON_EXISTENT_CANDIDATE_ID/);
  assert.equal(validation.effective_candidate_id, "DECREASE_AVG_CPC_MINUS_15");
});

test("Case 5: AI output invalid JSON or non-object -> fallback", () => {
  const payload = createMockPayload();
  const validation = validateAiReviewerResponse("THIS_IS_CORRUPT_STRING", payload);
  assert.equal(validation.valid, false);
  assert.equal(validation.status, "AI_REVIEW_INVALID");
  assert.equal(validation.effective_candidate_id, "DECREASE_AVG_CPC_MINUS_15");
});

test("Case 6: AI invocation error/timeout -> graceful fallback to rule", async () => {
  const payload = createMockPayload();
  const result = await invokeAiReviewer(payload, {
    apiKey: "invalid_key",
    baseURL: "http://127.0.0.1:1/invalid",
    timeoutMs: 500,
  });

  assert.equal(result.validation.valid, false);
  assert.equal(result.validation.status, "RULE_FALLBACK");
  assert.equal(result.validation.effective_candidate_id, "DECREASE_AVG_CPC_MINUS_15");
  assert.equal(result.validation.decision_source, "RULE_FALLBACK");
});

test("Case 7: Candidate blocked by guardrail -> reject and fallback", () => {
  const payload = createMockPayload();
  const blockedCandidate = payload.available_candidates[1];
  blockedCandidate.allowed = false;
  blockedCandidate.guardrail_reasons = ["ABOVE_MAX_BID"];

  const rawResponse = {
    decision: "SELECT_CANDIDATE",
    candidate_id: blockedCandidate.id,
    reason_codes: [],
    evidence_used: [],
    counter_evidence: [],
    need_more_data: false,
  };

  const validation = validateAiReviewerResponse(rawResponse, payload);
  assert.equal(validation.valid, false);
  assert.equal(validation.status, "AI_REVIEW_INVALID");
  assert.match(validation.fallback_reason || "", /GUARDRAIL_BLOCKED_CANDIDATE/);
  assert.equal(validation.effective_candidate_id, "DECREASE_AVG_CPC_MINUS_15");
});

test("Case 8: When sample counts are 0, AI selecting non-rule candidate is rejected", () => {
  const payload = createMockPayload();
  // Clear evidence to simulate current production state (0 mature clean samples)
  payload.available_candidates.forEach((c) => {
    c.sample_count = 0;
  });
  payload.scenario_evaluation.sample_count = 0;

  const rawResponse = {
    decision: "SELECT_CANDIDATE",
    candidate_id: "DECREASE_AVG_CPC_MINUS_10", // alternative candidate
    reason_codes: ["HALLUCINATED_CONFIDENCE"],
    evidence_used: [],
    counter_evidence: [],
    need_more_data: false,
  };

  const validation = validateAiReviewerResponse(rawResponse, payload);
  assert.equal(validation.valid, true);
  assert.equal(validation.status, "RULE_FALLBACK");
  assert.equal(validation.fallback_reason, "INSUFFICIENT_MATURE_EVIDENCE");
  assert.equal(validation.effective_candidate_id, "DECREASE_AVG_CPC_MINUS_15");
});

test("Case 9: System prompt forbids speculating on untracked events", () => {
  const prompt = buildAiReviewerSystemPrompt();
  assert.match(prompt, /BOUNDED ACTION SPACE ONLY/);
  assert.match(prompt, /RULE DIRECTION PRESERVATION/);
  assert.match(prompt, /NO HALLUCINATING UNTRACKED DATA/);
  assert.match(prompt, /HONESTY ABOUT HISTORICAL EVIDENCE/);
});

test("Case 10: fewer than 20 retrieval samples always falls back to Rule", () => {
  const payload = createMockPayload({
    scenario_evaluation: {
      target_scenario: "HIGH_ACOS_TRIM",
      acos_be_ratio: 2,
      retrieval_level: "LEVEL_A",
      retrieval_specificity: "HIGH",
      sample_count: 19,
      minimum_samples: 20,
    },
  });
  const validation = validateAiReviewerResponse({
    decision: "SELECT_CANDIDATE",
    candidate_id: "DECREASE_AVG_CPC_MINUS_10",
    reason_codes: ["LOW_SAMPLE_ATTEMPT"],
    evidence_used: [],
    counter_evidence: [],
    need_more_data: false,
  }, payload);

  assert.equal(validation.status, "RULE_FALLBACK");
  assert.equal(validation.fallback_reason, "INSUFFICIENT_MATURE_EVIDENCE");
});

test("Case 11: Level C evidence is analysis-only and cannot replace Rule", () => {
  const payload = createMockPayload({
    scenario_evaluation: {
      target_scenario: "HIGH_ACOS_TRIM",
      acos_be_ratio: 2,
      retrieval_level: "LEVEL_C",
      retrieval_specificity: "BROAD",
      sample_count: 100,
      minimum_samples: 20,
    },
  });
  const validation = validateAiReviewerResponse({
    decision: "SELECT_CANDIDATE",
    candidate_id: "DECREASE_AVG_CPC_MINUS_10",
    reason_codes: ["BROAD_EVIDENCE_ATTEMPT"],
    evidence_used: [],
    counter_evidence: [],
    need_more_data: false,
  }, payload);

  assert.equal(validation.status, "RULE_FALLBACK");
  assert.equal(validation.fallback_reason, "BROAD_LEVEL_C_EVIDENCE");
});

test("Case 12: selected candidate needs its own 20 mature samples", () => {
  const payload = createMockPayload();
  const alternative = payload.available_candidates.find(
    (candidate) => candidate.id === "DECREASE_AVG_CPC_MINUS_10",
  );
  assert.ok(alternative);
  alternative.sample_count = 19;

  const validation = validateAiReviewerResponse({
    decision: "SELECT_CANDIDATE",
    candidate_id: alternative.id,
    reason_codes: ["CANDIDATE_LOW_SAMPLE_ATTEMPT"],
    evidence_used: [],
    counter_evidence: [],
    need_more_data: false,
  }, payload);

  assert.equal(validation.status, "RULE_FALLBACK");
  assert.equal(validation.fallback_reason, "CANDIDATE_INSUFFICIENT_MATURE_EVIDENCE");
});

test("Case 13: rule_critique captures AI strategic disagreement while maintaining production safety guardrails", () => {
  const payload = createMockPayload();
  const validation = validateAiReviewerResponse({
    decision: "SELECT_CANDIDATE",
    candidate_id: "DECREASE_AVG_CPC_MINUS_10",
    reason_codes: ["HISTORICAL_WIN_RATE"],
    evidence_used: ["WIN_RATE_74_PCT"],
    counter_evidence: [],
    need_more_data: false,
    analysis: "Mục tiêu đang có ACoS cao, nhưng xu hướng 7D đang hồi phục tốt.",
    rule_critique: {
      rule_disagreement: true,
      suggested_direction: "HOLD",
      disagreement_reason: "Xu hướng 7D CVR tăng vọt, cắt bid ngay sẽ làm tụt rank từ khóa chính.",
    },
  }, payload);

  assert.equal(validation.valid, true);
  assert.equal(validation.status, "ACCEPTED_SHADOW");
  assert.ok(validation.rule_critique);
  assert.equal(validation.rule_critique.rule_disagreement, true);
  assert.equal(validation.rule_critique.suggested_direction, "HOLD");
  assert.equal(
    validation.rule_critique.disagreement_reason,
    "Xu hướng 7D CVR tăng vọt, cắt bid ngay sẽ làm tụt rank từ khóa chính.",
  );
});

test("Case 14: System prompt specifies mutually exclusive scenario thresholds without gaps or overlaps", () => {
  const prompt = buildAiReviewerSystemPrompt();
  assert.match(prompt, /PROFITABLE_SCALE.*acos_be_ratio <= 0\.75/);
  assert.match(prompt, /MARGINAL_ACOS.*0\.75 < acos_be_ratio <= 1\.00/);
  assert.match(prompt, /HIGH_ACOS_TRIM.*acos_be_ratio > 1\.00/);
  assert.match(prompt, /STRATEGIC RULE CRITIQUE/);
  assert.match(prompt, /rule_critique/);
});
