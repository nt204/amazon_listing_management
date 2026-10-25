import type { AiReviewerPayload, AiReviewerRawResponse, AiReviewerValidationResult } from "./ai-reviewer";
import type { ReplayCase } from "./ai-reviewer-replay-dataset";
import { deriveTargetScenario } from "./scenario-classifier";

// Reviewer harness scorer (P3).
// Primary metrics: Negative Outcome Detection and calibration. Invalid rate is a hard gate and
// evidence grounding a quality gate. Reward is reported for reference only: applied actions were
// chosen by the rule engine or a person, so reward carries selection bias and never enters a score.

export const SCORER_VERSION = "reviewer-scorer-v1";

export interface ScoredCase {
  replayCase: ReplayCase;
  raw: AiReviewerRawResponse | null;
  validation: AiReviewerValidationResult;
}

export interface RateWithInterval {
  n: number;
  hits: number;
  rate: number | null;
  ci95: [number, number] | null;
}

export interface NegativeOutcomeDetection {
  // Only cases where the rule's own candidate was applied: otherwise the outcome says nothing about the rule.
  eligible: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  trueNegative: number;
  precision: RateWithInterval;
  recall: RateWithInterval;
  f1: number | null;
}

export interface ScoreSection {
  cases: number;
  negativeOutcomeDetection: NegativeOutcomeDetection;
  calibration: {
    // Evidence below the payload's own minimum: the prompt requires INSUFFICIENT_EVIDENCE.
    abstainWhenInsufficient: RateWithInterval;
    // Evidence meets the minimum, yet the reviewer still declined to judge.
    abstainWhenSufficient: RateWithInterval;
  };
  invalidRate: RateWithInterval;
  invocationErrorRate: RateWithInterval;
  evidenceGrounding: RateWithInterval;
  rewardReference: {
    note: string;
    agreeWithApplied: { n: number; medianRewardUsd: number | null };
    differFromApplied: { n: number; medianRewardUsd: number | null };
  };
}

export interface ScoreReport extends ScoreSection {
  scorerVersion: string;
  harnessVersion: string;
  split: string;
  bySegment: Record<string, ScoreSection>;
}

/** Wilson score interval, 95%. */
export function wilson(hits: number, n: number): [number, number] | null {
  if (n === 0) return null;
  const z = 1.96;
  const p = hits / n;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

function rate(hits: number, n: number): RateWithInterval {
  return { n, hits, rate: n > 0 ? hits / n : null, ci95: wilson(hits, n) };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/** Mirrors the evidence rules the prompt and validator already enforce; introduces no threshold of its own. */
export function isEvidenceInsufficient(payload: AiReviewerPayload): boolean {
  const scenario = payload.scenario_evaluation;
  return scenario.sample_count < scenario.minimum_samples
    || scenario.retrieval_level === "LEVEL_C"
    || scenario.retrieval_level === "INSUFFICIENT"
    || payload.available_candidates.every((candidate) => candidate.sample_count === 0);
}

function payloadVocabulary(payload: AiReviewerPayload): { tokens: string[]; numbers: number[] } {
  const tokens = new Set<string>();
  const numbers: number[] = [];
  const visit = (value: unknown, key?: string) => {
    if (key && key.length >= 4) tokens.add(key.toLowerCase());
    if (typeof value === "number" && Number.isFinite(value)) numbers.push(value);
    else if (typeof value === "string" && value.length >= 3 && /^[A-Z0-9_]+$/.test(value)) tokens.add(value.toLowerCase());
    else if (Array.isArray(value)) value.forEach((item) => visit(item));
    else if (value && typeof value === "object") {
      for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
    }
  };
  visit(payload);
  for (const label of ["acos", "cpc", "cvr", "break-even", "break even"]) tokens.add(label);
  return { tokens: Array.from(tokens), numbers };
}

/**
 * Heuristic: an evidence item is grounded when it names a payload field, an enum value present in the
 * payload (candidate id, scenario, campaign type...) or quotes a number that appears in the payload.
 */
export function isEvidenceItemGrounded(item: string, payload: AiReviewerPayload): boolean {
  const { tokens, numbers } = payloadVocabulary(payload);
  const text = item.toLowerCase();
  if (tokens.some((token) => text.includes(token))) return true;
  const quoted = (item.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  return quoted.some((value) => numbers.some((known) => (
    Math.abs(known - value) <= 0.01 || (known !== 0 && Math.abs((known - value) / known) <= 0.01)
  )));
}

export function segmentKey(payload: AiReviewerPayload): string {
  const scenario = deriveTargetScenario({
    clicks: payload.performance.clicks,
    orders: payload.performance.orders,
    spend: payload.performance.spend,
    sales: payload.performance.sales,
    breakEvenAcos: payload.performance.break_even_acos,
  }).scenario;
  return `${payload.target.campaign_type}/${scenario}`;
}

function scoreSection(items: ScoredCase[]): ScoreSection {
  // Reached the model (a malformed reply counts as invalid, not as an invocation error).
  const reached = items.filter((item) => !String(item.validation.fallback_reason || "").startsWith("INVOCATION_ERROR"));
  const answered = reached.filter((item) => item.raw !== null);

  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let trueNegative = 0;
  for (const item of answered) {
    const { appliedCandidateId, ruleCandidateId, outcome } = item.replayCase;
    if (appliedCandidateId === null || appliedCandidateId !== ruleCandidateId) continue;
    const flagged = item.raw?.rule_critique?.rule_disagreement === true;
    const negative = outcome.label === "NEGATIVE";
    if (flagged && negative) truePositive += 1;
    else if (flagged) falsePositive += 1;
    else if (negative) falseNegative += 1;
    else trueNegative += 1;
  }
  const precision = rate(truePositive, truePositive + falsePositive);
  const recall = rate(truePositive, truePositive + falseNegative);
  const f1 = precision.rate !== null && recall.rate !== null && precision.rate + recall.rate > 0
    ? (2 * precision.rate * recall.rate) / (precision.rate + recall.rate)
    : null;

  const insufficient = answered.filter((item) => isEvidenceInsufficient(item.replayCase.payload));
  const sufficient = answered.filter((item) => !isEvidenceInsufficient(item.replayCase.payload));
  const abstained = (item: ScoredCase) => item.raw?.decision === "INSUFFICIENT_EVIDENCE";

  const withEvidence = answered.filter((item) => (item.raw?.evidence_used.length || 0) > 0);
  const grounded = withEvidence.filter((item) => (
    item.raw?.evidence_used.every((evidence) => isEvidenceItemGrounded(evidence, item.replayCase.payload))
  ));

  const observable = answered.filter((item) => item.replayCase.appliedCandidateId !== null);
  const rewards = (group: ScoredCase[]) => group
    .map((item) => item.replayCase.outcome.rewardUsd)
    .filter((value): value is number => value !== null);
  const agree = observable.filter((item) => item.validation.effective_candidate_id === item.replayCase.appliedCandidateId);
  const differ = observable.filter((item) => item.validation.effective_candidate_id !== item.replayCase.appliedCandidateId);

  return {
    cases: items.length,
    negativeOutcomeDetection: {
      eligible: truePositive + falsePositive + falseNegative + trueNegative,
      truePositive,
      falsePositive,
      falseNegative,
      trueNegative,
      precision,
      recall,
      f1,
    },
    calibration: {
      abstainWhenInsufficient: rate(insufficient.filter(abstained).length, insufficient.length),
      abstainWhenSufficient: rate(sufficient.filter(abstained).length, sufficient.length),
    },
    invalidRate: rate(reached.filter((item) => item.validation.status === "AI_REVIEW_INVALID").length, reached.length),
    invocationErrorRate: rate(items.length - reached.length, items.length),
    evidenceGrounding: rate(grounded.length, withEvidence.length),
    rewardReference: {
      note: "Reference only: reward of the applied action, selection-biased; never part of a score.",
      agreeWithApplied: { n: agree.length, medianRewardUsd: median(rewards(agree)) },
      differFromApplied: { n: differ.length, medianRewardUsd: median(rewards(differ)) },
    },
  };
}

export function scoreReviewerRun(items: ScoredCase[], meta: { harnessVersion: string; split: string }): ScoreReport {
  const segments = new Map<string, ScoredCase[]>();
  for (const item of items) {
    const key = segmentKey(item.replayCase.payload);
    segments.set(key, [...(segments.get(key) || []), item]);
  }
  return {
    scorerVersion: SCORER_VERSION,
    harnessVersion: meta.harnessVersion,
    split: meta.split,
    ...scoreSection(items),
    bySegment: Object.fromEntries(
      Array.from(segments, ([key, group]) => [key, scoreSection(group)] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}
