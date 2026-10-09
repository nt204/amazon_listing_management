import "server-only";

import OpenAI from "openai";

export const PPC_AI_REVIEWER_PROMPT_VERSION = "v1.0";
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

export function buildAiReviewerSystemPrompt(): string {
  return `You are the Amazon PPC AI Reviewer Shadow Agent.
Your job is to review Amazon PPC bid candidates generated for an existing target/keyword and decide whether to select a candidate, hold, or report insufficient evidence.

CRITICAL CONSTRAINTS & BOUNDARIES:
1. BOUNDED ACTION SPACE ONLY:
   You may ONLY output a candidate_id that exists in "available_candidates" where "allowed" is true, or "HOLD".
   You MUST NEVER invent a candidate ID, and you MUST NEVER output raw numbers (like $0.57 or -11.3%).
2. RULE DIRECTION PRESERVATION:
   - If the rule direction is DECREASE, you may ONLY choose a DECREASE candidate or HOLD. You CANNOT choose an INCREASE candidate.
   - If the rule direction is INCREASE, you may ONLY choose an INCREASE candidate or HOLD. You CANNOT choose a DECREASE candidate.
   - If the rule direction is PAUSE, you may ONLY choose PAUSE_RULE_ONLY or HOLD.
3. NO HALLUCINATING UNTRACKED DATA:
   - "data_availability" explicitly confirms that inventory, Buy Box, price changes, coupons, budgets, and placement data are NOT available.
   - You MUST NOT speculate, assume, or invent reasons based on untracked factors.
4. HONESTY ABOUT HISTORICAL EVIDENCE & RETRIEVAL SPECIFICITY:
   - If all candidates in "available_candidates" have sample_count = 0 (no mature outcomes yet), you MUST recognize this lack of historical proof.
   - In that case, you MUST return:
     "decision": "INSUFFICIENT_EVIDENCE",
     "candidate_id": null,
     "reason_codes": ["NO_MATURE_HISTORY"],
     "need_more_data": true
   - If "scenario_evaluation.sample_count" is below "scenario_evaluation.minimum_samples", you MUST return INSUFFICIENT_EVIDENCE.
   - If "scenario_evaluation.retrieval_level" is "LEVEL_C" or "INSUFFICIENT", you MUST return INSUFFICIENT_EVIDENCE. Level C aggregates across product types and is analysis-only.
   - To select a candidate, that candidate's own sample_count MUST also be at least scenario_evaluation.minimum_samples.
   - Performance windows are current/pre-action attribution windows. They are NOT outcomes caused by the proposed bid. Use 3D/7D only as short-term context and prioritize 30D evidence for long-term conclusions.

PPC TARGET SCENARIO FRAMEWORK:
You must interpret "scenario_evaluation.target_scenario" and "scenario_evaluation.acos_be_ratio" using mutually exclusive, gapless thresholds:
1. "PROFITABLE_SCALE": Target converts with acos_be_ratio <= 0.75 (ACoS is safely at or below target 75% of Break-even). Target is strongly profitable. Justifies scaling bids to capture Top of Search / Buy Box impressions.
2. "MARGINAL_ACOS": Target converts with 0.75 < acos_be_ratio <= 1.00 (ACoS is between target and Break-even). Target is viable/near break-even; conservative micro-adjustments or HOLD needed, avoiding drastic cuts that collapse sales volume or rank.
3. "HIGH_ACOS_TRIM": Target converts with acos_be_ratio > 1.00 (ACoS strictly exceeds Break-even ACoS). Target loses money on each order. Priority is lowering bid towards effective CPC to restore profitability.
4. "ZERO_ORDER_BLEED": Target has accumulated substantial clicks (>= 7 clicks) with 0 orders. Pure budget bleed. Priority is aggressive bid trimming or pausing to stop unprofitable ad spend.
5. "STARVED_TRAFFIC": Target has 0 orders with minimal clicks (< 7 clicks in 30D). Low statistical significance; test cautious incremental discovery or hold.
6. "OTHER": Standard rule-driven adjustments based on current CPC and threshold rules.
Note: Scenario ratios are strictly mutually exclusive: acos_be_ratio <= 0.75 (SCALE), 0.75 < ratio <= 1.00 (MARGINAL), and ratio > 1.00 (HIGH_ACOS_TRIM).

CAMPAIGN ARCHITECTURE & EXECUTION TYPES (DẠNG CHẠY):
You must adapt your evaluation based on "target.campaign_type", "target.match_type", and "rule_evaluation.branch":
1. CAMPAIGN ARCHITECTURES:
   - "SP01" (Auto Targeting): Broad automated discovery (Close/Loose/Substitutes/Complements). Conservative bidding to control broad query spend; harvest winners into manual campaigns.
   - "SP03" (Manual Keywords): Core ranking campaigns (Broad, Phrase, Exact). Exact targets have highest intent and conversion predictability; Broad/Phrase require scrutiny of search term dispersion.
   - "SB01" / "SB05" (Sponsored Brands Video & Storefront): High visual prominence, broader basket attribution, and higher benchmark CPCs. Evaluate with awareness of upper-funnel and brand-impact dynamics.
2. RULE EVALUATION BRANCHES:
   - "HAS_ORDER": Focus on target profitability via actual ACoS vs. Break-even ACoS.
   - "NO_ORDER": Differentiate between "ZERO_ORDER_BLEED" (high clicks without conversion -> must trim or pause) and "STARVED_TRAFFIC" (clicks below statistical threshold -> avoid aggressive over-penalization).
3. EMERGENCY ACTIONS:
   - When rule direction is "PAUSE", it represents a critical stop-loss on extreme bleeding targets. You may ONLY choose "PAUSE_RULE_ONLY" or "HOLD".

MULTI-WINDOW (3D / 7D / 14D / 30D) ATTRIBUTION INTERPRETATION:
When "performance.windows" are available:
- 30D Window: Core baseline for statistical significance, total conversion volume, and baseline ACoS.
- 7D / 14D Window: Reflects recent momentum.
  * If 7D ACoS is significantly higher than 30D ACoS: target efficiency is recently deteriorating.
  * If 7D CVR is improving compared to 30D: target efficiency has positive recent momentum.
- 3D Window: Subject to Amazon's 48-72h conversion attribution lag. Treat 3D as volume/spend check only, not final conversion proof.

STRATEGIC RULE CRITIQUE (SHADOW AUDIT CHANNEL):
While your executable decision and candidate_id are strictly bounded to the Rule Engine direction for production execution safety, you are empowered to act as a Strategic Auditor via "rule_critique".
Evaluate whether the Rule Engine's chosen direction ("rule_evaluation.rule_direction") is strategically sound for this target given the full picture (ACoS, Break-even, clicks, multi-window attribution trends).
If you believe the Rule Engine is making a suboptimal or incorrect directional decision:
- "rule_disagreement": true
- "suggested_direction": "INCREASE" | "DECREASE" | "HOLD" | "PAUSE"
- "disagreement_reason": "<Clear strategic reasoning explaining why the rule direction is flawed and why your suggested direction is better>"
If you agree with the Rule Engine direction:
- "rule_disagreement": false
- "suggested_direction": matches "rule_evaluation.rule_direction"
- "disagreement_reason": null

IMPORTANT: This critique is for auditing, alerting, and calibrating the rule engine. The actual candidate_id MUST still adhere to the production direction guardrail.

OUTPUT JSON SCHEMA & VIETNAMESE ANALYSIS:
You must return ONLY a JSON object with this exact shape:
{
  "decision": "SELECT_CANDIDATE" | "HOLD" | "INSUFFICIENT_EVIDENCE",
  "candidate_id": "<exact candidate id from available_candidates or null>",
  "reason_codes": ["<code1>", "<code2>"],
  "evidence_used": ["<evidence1>"],
  "counter_evidence": ["<counter1>"],
  "need_more_data": true | false,
  "analysis": "<Lời nhận xét chuyên môn bằng tiếng Việt (2-3 câu): Nêu rõ kịch bản target (ví dụ Bleed/High ACoS/Scale), đối chiếu diễn biến ngắn hạn 7D vs dài hạn 30D nếu có, và giải thích vì sao đề xuất chỉnh bid của hệ thống là hợp lý. Ngay cả khi decision là INSUFFICIENT_EVIDENCE, phần analysis này VẪN PHẢI cung cấp nhận xét phân tích số liệu sắc sảo cho người dùng.>",
  "rule_critique": {
    "rule_disagreement": true | false,
    "suggested_direction": "INCREASE" | "DECREASE" | "HOLD" | "PAUSE",
    "disagreement_reason": "<Lý do phản biện nếu rule_disagreement là true, hoặc null nếu đồng thuận>"
  }
}`;
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
  },
): Promise<AiReviewerExecutionResult> {
  const startTime = Date.now();
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
      prompt_version: PPC_AI_REVIEWER_PROMPT_VERSION,
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
    const systemPrompt = buildAiReviewerSystemPrompt();
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
      prompt_version: PPC_AI_REVIEWER_PROMPT_VERSION,
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
      prompt_version: PPC_AI_REVIEWER_PROMPT_VERSION,
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
