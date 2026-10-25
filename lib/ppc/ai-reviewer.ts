import "server-only";

import OpenAI from "openai";

import { BASELINE_HARNESS, renderHarnessPrompt, type ReviewerHarness } from "./ai-reviewer-harness";

export const PPC_AI_REVIEWER_PROMPT_VERSION = BASELINE_HARNESS.version;
export const PPC_AI_REVIEWER_AGENT_VERSION = "ai-reviewer-shadow-v1";
export const PPC_AI_REVIEWER_POLICY_VERSION = "bounded-candidates-v1";

export type AiDecisionType = "SELECT_CANDIDATE" | "HOLD" | "INSUFFICIENT_EVIDENCE";

export interface RuleCritique {
  rule_disagreement: boolean;
  suggested_direction: "INCREASE" | "DECREASE" | "HOLD" | "PAUSE";
  disagreement_reason?: string | null;
}

export interface AiReviewerRawResponse {
  decision: AiDecisionType;
  candidate_id: string | null;
  reason_codes: string[];
  evidence_used: string[];
  counter_evidence: string[];
  need_more_data: boolean;
  analysis?: string;
  rule_critique?: RuleCritique;
}

export interface AvailableCandidateView {
  id: string;
  direction: string;
  basis: string;
  adjustment_pct: number;
  bid: number | null;
  is_rule_choice: boolean;
  allowed: boolean;
  guardrail_reasons: string[];
  sample_count: number;
  win_count: number;
  neutral_count: number;
  loss_count: number;
  median_reward_usd: number | null;
}

export interface TargetWindowMetrics {
  window_days: number;
  clicks: number;
  orders: number;
  spend: number;
  sales: number;
  acos: number | null;
  avg_cpc: number | null;
  cvr: number | null;
}

export interface AiReviewerPayload {
  target: {
    campaign_type: string;
    match_type: string;
    product_type: string;
    campaign_name?: string;
    keyword?: string;
  };
  current_state: {
    current_bid: number;
    avg_cpc: number;
    effective_max_bid: number | null;
    clamped_at_max: boolean;
  };
  performance: {
    clicks: number;
    orders: number;
    spend: number;
    sales: number;
    actual_acos: number | null;
    break_even_acos: number | null;
    selling_price?: number | null;
    profit_before_ads?: number | null;
    windows?: Record<string, TargetWindowMetrics>;
  };
  rule_evaluation: {
    branch: "HAS_ORDER" | "NO_ORDER";
    matched_rule_id: string;
    rule_intent: string;
    rule_selected_candidate: string;
    rule_recommended_bid: number;
    rule_direction: "INCREASE" | "DECREASE" | "HOLD" | "PAUSE";
  };
  scenario_evaluation: {
    target_scenario: string;
    acos_be_ratio: number | null;
    retrieval_level: string;
    retrieval_specificity: string;
    sample_count: number;
    minimum_samples: number;
  };
  available_candidates: AvailableCandidateView[];
  data_availability: {
    inventory: false;
    buy_box: false;
    price_events: false;
    coupon_events: false;
    budget_events: false;
    placement_events: false;
  };
}

export interface AiReviewerValidationResult {
  valid: boolean;
  status: "ACCEPTED_SHADOW" | "RULE_FALLBACK" | "AI_REVIEW_INVALID";
  fallback_reason: string | null;
  effective_candidate_id: string;
  effective_bid: number | null;
  decision_source: "AI_AGENT" | "RULE_FALLBACK";
  raw_ai_decision: AiReviewerRawResponse | null;
  rule_critique?: RuleCritique | null;
  error_message?: string | null;
}

export interface AiReviewerExecutionResult {
  prompt_version: string;
  model: string;
  agent_version: string;
  policy_version: string;
  payload: AiReviewerPayload;
  raw_response: AiReviewerRawResponse | null;
  validation: AiReviewerValidationResult;
  latency_ms: number;
  executed_at: string;
}

export function buildAiReviewerSystemPrompt(harness: ReviewerHarness = BASELINE_HARNESS): string {
  return renderHarnessPrompt(harness);
}

export function validateAiReviewerResponse(
  raw: unknown,
  payload: AiReviewerPayload,
): AiReviewerValidationResult {
  const ruleCandidateId = payload.rule_evaluation.rule_selected_candidate;
  const ruleCandidate = payload.available_candidates.find((c) => c.id === ruleCandidateId)
    || payload.available_candidates.find((c) => c.is_rule_choice)
    || payload.available_candidates[0];

  const fallbackCandidateId = ruleCandidate?.id || "HOLD";
  const fallbackBid = ruleCandidate?.bid ?? payload.current_state.current_bid;

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      valid: false,
      status: "AI_REVIEW_INVALID",
      fallback_reason: "RESPONSE_NOT_AN_OBJECT",
      effective_candidate_id: fallbackCandidateId,
      effective_bid: fallbackBid,
      decision_source: "RULE_FALLBACK",
      raw_ai_decision: null,
      error_message: "AI response was not a valid JSON object.",
    };
  }

  const res = raw as Record<string, unknown>;
  const decision = String(res.decision || "");
  const candidateId = res.candidate_id ? String(res.candidate_id) : null;
  const reasonCodes = Array.isArray(res.reason_codes) ? res.reason_codes.map(String) : [];
  const evidenceUsed = Array.isArray(res.evidence_used) ? res.evidence_used.map(String) : [];
  const counterEvidence = Array.isArray(res.counter_evidence) ? res.counter_evidence.map(String) : [];
  const needMoreData = Boolean(res.need_more_data);
  const analysis = res.analysis ? String(res.analysis) : undefined;

  let ruleCritique: RuleCritique = {
    rule_disagreement: false,
    suggested_direction: payload.rule_evaluation.rule_direction,
    disagreement_reason: null,
  };
  if (res.rule_critique && typeof res.rule_critique === "object" && !Array.isArray(res.rule_critique)) {
    const rc = res.rule_critique as Record<string, unknown>;
    const disagreement = Boolean(rc.rule_disagreement);
    const suggestedDir = (["INCREASE", "DECREASE", "HOLD", "PAUSE"].includes(String(rc.suggested_direction))
      ? String(rc.suggested_direction)
      : payload.rule_evaluation.rule_direction) as "INCREASE" | "DECREASE" | "HOLD" | "PAUSE";
    const reason = rc.disagreement_reason ? String(rc.disagreement_reason) : null;
    ruleCritique = {
      rule_disagreement: disagreement,
      suggested_direction: suggestedDir,
      disagreement_reason: reason,
    };
  }

  const structuredResponse: AiReviewerRawResponse = {
    decision: (["SELECT_CANDIDATE", "HOLD", "INSUFFICIENT_EVIDENCE"].includes(decision)
      ? decision
      : "INSUFFICIENT_EVIDENCE") as AiDecisionType,
    candidate_id: candidateId,
    reason_codes: reasonCodes,
    evidence_used: evidenceUsed,
    counter_evidence: counterEvidence,
    need_more_data: needMoreData,
    analysis,
    rule_critique: ruleCritique,
  };

  // 1. Invalid decision enum check
  if (!["SELECT_CANDIDATE", "HOLD", "INSUFFICIENT_EVIDENCE"].includes(decision)) {
    return {
      valid: false,
      status: "AI_REVIEW_INVALID",
      fallback_reason: `INVALID_DECISION_ENUM: ${decision}`,
      effective_candidate_id: fallbackCandidateId,
      effective_bid: fallbackBid,
      decision_source: "RULE_FALLBACK",
      raw_ai_decision: structuredResponse,
      rule_critique: ruleCritique,
      error_message: `AI returned invalid decision enum '${decision}'.`,
    };
  }

  // 2. INSUFFICIENT_EVIDENCE: Valid and falls back to rule as designed
  if (decision === "INSUFFICIENT_EVIDENCE") {
    return {
      valid: true,
      status: "RULE_FALLBACK",
      fallback_reason: "AI_DECISION_INSUFFICIENT_EVIDENCE",
      effective_candidate_id: fallbackCandidateId,
      effective_bid: fallbackBid,
      decision_source: "RULE_FALLBACK",
      raw_ai_decision: structuredResponse,
      rule_critique: ruleCritique,
    };
  }

  const minimumSamples = Math.max(1, Number(payload.scenario_evaluation.minimum_samples || 20));
  const retrievalLevel = payload.scenario_evaluation.retrieval_level;
  if (
    payload.scenario_evaluation.sample_count < minimumSamples ||
    retrievalLevel === "LEVEL_C" ||
    retrievalLevel === "INSUFFICIENT"
  ) {
    return {
      valid: true,
      status: "RULE_FALLBACK",
      fallback_reason: retrievalLevel === "LEVEL_C"
        ? "BROAD_LEVEL_C_EVIDENCE"
        : "INSUFFICIENT_MATURE_EVIDENCE",
      effective_candidate_id: fallbackCandidateId,
      effective_bid: fallbackBid,
      decision_source: "RULE_FALLBACK",
      raw_ai_decision: structuredResponse,
      rule_critique: ruleCritique,
    };
  }

  // 3. HOLD decision
  if (decision === "HOLD") {
    const holdCandidate = payload.available_candidates.find((c) => c.id === "HOLD");
    if (!holdCandidate || !holdCandidate.allowed) {
      return {
        valid: false,
        status: "AI_REVIEW_INVALID",
        fallback_reason: "HOLD_CANDIDATE_NOT_ALLOWED",
        effective_candidate_id: fallbackCandidateId,
        effective_bid: fallbackBid,
        decision_source: "RULE_FALLBACK",
        raw_ai_decision: structuredResponse,
        rule_critique: ruleCritique,
        error_message: "HOLD candidate is not allowed by current guardrails.",
      };
    }
    return {
      valid: true,
      status: "ACCEPTED_SHADOW",
      fallback_reason: null,
      effective_candidate_id: "HOLD",
      effective_bid: holdCandidate.bid,
      decision_source: "AI_AGENT",
      raw_ai_decision: structuredResponse,
      rule_critique: ruleCritique,
    };
  }

  // 4. SELECT_CANDIDATE check
  if (!candidateId) {
    return {
      valid: false,
      status: "AI_REVIEW_INVALID",
      fallback_reason: "MISSING_CANDIDATE_ID_ON_SELECT",
      effective_candidate_id: fallbackCandidateId,
      effective_bid: fallbackBid,
      decision_source: "RULE_FALLBACK",
      raw_ai_decision: structuredResponse,
      rule_critique: ruleCritique,
      error_message: "decision is SELECT_CANDIDATE but candidate_id is null/empty.",
    };
  }

  const targetCandidate = payload.available_candidates.find((c) => c.id === candidateId);
  if (!targetCandidate) {
    return {
      valid: false,
      status: "AI_REVIEW_INVALID",
      fallback_reason: `NON_EXISTENT_CANDIDATE_ID: ${candidateId}`,
      effective_candidate_id: fallbackCandidateId,
      effective_bid: fallbackBid,
      decision_source: "RULE_FALLBACK",
      raw_ai_decision: structuredResponse,
      rule_critique: ruleCritique,
      error_message: `Candidate '${candidateId}' does not exist in available_candidates.`,
    };
  }

  // Guardrail check
  if (!targetCandidate.allowed) {
    return {
      valid: false,
      status: "AI_REVIEW_INVALID",
      fallback_reason: `GUARDRAIL_BLOCKED_CANDIDATE: ${targetCandidate.guardrail_reasons.join(",")}`,
      effective_candidate_id: fallbackCandidateId,
      effective_bid: fallbackBid,
      decision_source: "RULE_FALLBACK",
      raw_ai_decision: structuredResponse,
      rule_critique: ruleCritique,
      error_message: `Candidate '${candidateId}' is blocked by guardrails: ${targetCandidate.guardrail_reasons.join(", ")}`,
    };
  }

  if (targetCandidate.sample_count < minimumSamples) {
    return {
      valid: true,
      status: "RULE_FALLBACK",
      fallback_reason: "CANDIDATE_INSUFFICIENT_MATURE_EVIDENCE",
      effective_candidate_id: fallbackCandidateId,
      effective_bid: fallbackBid,
      decision_source: "RULE_FALLBACK",
      raw_ai_decision: structuredResponse,
      rule_critique: ruleCritique,
    };
  }

  // Direction preservation check
  const ruleDir = payload.rule_evaluation.rule_direction;
  const candidateDir = targetCandidate.direction;
  if (
    (ruleDir === "INCREASE" && candidateDir === "DECREASE") ||
    (ruleDir === "DECREASE" && candidateDir === "INCREASE") ||
    (ruleDir === "PAUSE" && candidateDir !== "PAUSE" && candidateDir !== "HOLD")
  ) {
    return {
      valid: false,
      status: "AI_REVIEW_INVALID",
      fallback_reason: `REVERSED_RULE_DIRECTION: Rule=${ruleDir}, Candidate=${candidateDir}`,
      effective_candidate_id: fallbackCandidateId,
      effective_bid: fallbackBid,
      decision_source: "RULE_FALLBACK",
      raw_ai_decision: structuredResponse,
      rule_critique: ruleCritique,
      error_message: `AI cannot reverse direction from ${ruleDir} to ${candidateDir}.`,
    };
  }

  // Evidence check: Cannot select a non-rule candidate if there is 0 evidence in memory
  const allSamplesZero = payload.available_candidates.every((c) => c.sample_count === 0);
  if (allSamplesZero && candidateId !== fallbackCandidateId) {
    return {
      valid: false,
      status: "AI_REVIEW_INVALID",
      fallback_reason: "SELECT_WITHOUT_MATURE_EVIDENCE",
      effective_candidate_id: fallbackCandidateId,
      effective_bid: fallbackBid,
      decision_source: "RULE_FALLBACK",
      raw_ai_decision: structuredResponse,
      rule_critique: ruleCritique,
      error_message: `AI selected alternative candidate '${candidateId}' while memory has 0 mature samples.`,
    };
  }

  return {
    valid: true,
    status: "ACCEPTED_SHADOW",
    fallback_reason: null,
    effective_candidate_id: targetCandidate.id,
    effective_bid: targetCandidate.bid,
    decision_source: "AI_AGENT",
    raw_ai_decision: structuredResponse,
    rule_critique: ruleCritique,
  };
}

export async function invokeAiReviewer(
  payload: AiReviewerPayload,
  options?: {
    apiKey?: string;
    baseURL?: string;
    model?: string;
    timeoutMs?: number;
    mockResponse?: unknown;
    harness?: ReviewerHarness;
  },
): Promise<AiReviewerExecutionResult> {
  const startTime = Date.now();
  const harness = options?.harness || BASELINE_HARNESS;
  const model = options?.model || process.env.PPC_AI_REVIEWER_MODEL || "gpt-5.6-terra";
  const apiKey = options?.apiKey
    || process.env.PPC_AI_REVIEWER_API_KEY
    || process.env.CHEAPKEYAI_API_KEY;
  const baseURL = options?.baseURL
    || process.env.PPC_AI_REVIEWER_BASE_URL
    || process.env.CHEAPKEYAI_BASE_URL
    || "https://cheapkeyai.shop/v1";
  const timeoutMs = options?.timeoutMs || 60_000;

  // Test / Mock bypass
  if (options?.mockResponse !== undefined) {
    const validation = validateAiReviewerResponse(options.mockResponse, payload);
    return {
      prompt_version: harness.version,
      model,
      agent_version: PPC_AI_REVIEWER_AGENT_VERSION,
      policy_version: PPC_AI_REVIEWER_POLICY_VERSION,
      payload,
      raw_response: validation.raw_ai_decision,
      validation,
      latency_ms: Date.now() - startTime,
      executed_at: new Date().toISOString(),
    };
  }

  if (!apiKey) {
    throw new Error("Chưa cấu hình PPC_AI_REVIEWER_API_KEY hoặc CHEAPKEYAI_API_KEY.");
  }

  try {
    const client = new OpenAI({ apiKey, baseURL });
    const systemPrompt = buildAiReviewerSystemPrompt(harness);
    const userPrompt = JSON.stringify(payload, null, 2);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let content = "";
    try {
      const completion = await client.chat.completions.create(
        {
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.1,
        },
        { signal: controller.signal },
      );
      content = completion.choices[0]?.message?.content || "";
    } finally {
      clearTimeout(timer);
    }

    let parsedJson: unknown = null;
    try {
      const sanitized = content
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      parsedJson = JSON.parse(sanitized);
    } catch {
      parsedJson = null;
    }

    const validation = validateAiReviewerResponse(parsedJson, payload);
    return {
      prompt_version: harness.version,
      model,
      agent_version: PPC_AI_REVIEWER_AGENT_VERSION,
      policy_version: PPC_AI_REVIEWER_POLICY_VERSION,
      payload,
      raw_response: validation.raw_ai_decision,
      validation,
      latency_ms: Date.now() - startTime,
      executed_at: new Date().toISOString(),
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const ruleCandidateId = payload.rule_evaluation.rule_selected_candidate;
    const ruleCandidate = payload.available_candidates.find((c) => c.id === ruleCandidateId);
    const fallbackCandidateId = ruleCandidate?.id || "HOLD";
    const fallbackBid = ruleCandidate?.bid ?? payload.current_state.current_bid;

    return {
      prompt_version: harness.version,
      model,
      agent_version: PPC_AI_REVIEWER_AGENT_VERSION,
      policy_version: PPC_AI_REVIEWER_POLICY_VERSION,
      payload,
      raw_response: null,
      validation: {
        valid: false,
        status: "RULE_FALLBACK",
        fallback_reason: `INVOCATION_ERROR: ${errorMsg}`,
        effective_candidate_id: fallbackCandidateId,
        effective_bid: fallbackBid,
        decision_source: "RULE_FALLBACK",
        raw_ai_decision: null,
        error_message: errorMsg,
      },
      latency_ms: Date.now() - startTime,
      executed_at: new Date().toISOString(),
    };
  }
}
