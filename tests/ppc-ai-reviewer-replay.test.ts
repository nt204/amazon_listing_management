import assert from "node:assert/strict";
import test from "node:test";

import type { AiReviewerRawResponse, AiReviewerValidationResult } from "../lib/ppc/ai-reviewer";
import { assignSplits, buildReplayDataset, type ReplaySourceRow } from "../lib/ppc/ai-reviewer-replay-dataset";
import {
  isEvidenceInsufficient,
  isEvidenceItemGrounded,
  scoreReviewerRun,
  wilson,
  type ScoredCase,
} from "../lib/ppc/ai-reviewer-scorer";

function row(id: string, overrides: Partial<ReplaySourceRow> & { productType?: string } = {}): ReplaySourceRow {
  const { productType = "ORNAMENT", ...rest } = overrides;
  const asOf = rest.data_as_of || "2026-11-01T02:00:00.000Z";
  return {
    action_id: id,
    store_id: "store-1",
    campaign_id: "camp-1",
    campaign_type: "SP03",
    match_type: "EXACT",
    target_id: `target-${id}`,
    target_keyword: "ornament hooks",
    action_type: "UPDATE_BID",
    old_value: 1,
    system_suggested_value: 0.85,
    final_value: 0.85,
    data_as_of: asOf,
    context_created_at: asOf,
    context: {
      target: { product_type: productType },
      metrics: { clicks: 30, orders: 1, spend: 30, sales: 40, avg_cpc: 1, acos: 75 },
      economics: { break_even_acos: 40, max_bid: 2 },
      decision: { reason: "[SP03] SP03_HIGH_ACOS: trim toward CPC" },
    },
    outcome_label: "NEGATIVE",
    reward_usd: -3,
    maturity_date: "2026-10-01",
    ...rest,
  };
}

const AS_OF = "2026-11-01T02:00:00.000Z";

test("Replay: evidence only includes outcomes matured before the case's data_as_of", () => {
  const rows = [
    row("case", { data_as_of: AS_OF, maturity_date: "2026-12-05" }),
    row("known-1", { data_as_of: "2026-09-01T00:00:00.000Z", maturity_date: "2026-10-10" }),
    row("known-2", { data_as_of: "2026-09-02T00:00:00.000Z", maturity_date: "2026-10-31" }),
    row("same-day", { data_as_of: "2026-09-25T00:00:00.000Z", maturity_date: "2026-11-01" }),
    row("future", { data_as_of: "2026-09-26T00:00:00.000Z", maturity_date: "2026-11-20" }),
  ];
  const dataset = buildReplayDataset(rows);
  const replayCase = dataset.cases.find((item) => item.actionId === "case");
  assert.ok(replayCase);
  assert.deepEqual(replayCase.evidenceActionIds.sort(), ["known-1", "known-2"]);
  assert.equal(replayCase.evidenceCutoffDate, "2026-11-01");
  const candidate = replayCase.payload.available_candidates.find((item) => item.id === "DECREASE_AVG_CPC_MINUS_15");
  assert.equal(candidate?.sample_count, 2);
});

test("Replay: a case never sees its own outcome and evidence respects store/match/product scope", () => {
  const rows = [
    row("case", { maturity_date: "2026-10-01" }),
    row("other-store", { store_id: "store-2" }),
    row("other-match", { match_type: "BROAD" }),
    row("other-product", { productType: "TUMBLER" }),
  ];
  const replayCase = buildReplayDataset(rows).cases.find((item) => item.actionId === "case");
  assert.deepEqual(replayCase?.evidenceActionIds, []);
});

test("Replay: untrustworthy as-of inputs are excluded, never back-filled", () => {
  const dataset = buildReplayDataset([
    row("ok"),
    row("late", { context_created_at: "2026-11-05T00:00:00.000Z" }),
    row("no-context", { context: null as unknown as ReplaySourceRow["context"] }),
    row("no-metrics", { context: { target: {}, economics: {} } }),
  ]);
  assert.deepEqual(dataset.cases.map((item) => item.actionId), ["ok"]);
  assert.deepEqual(
    Object.fromEntries(dataset.excluded.map((item) => [item.actionId, item.reason])),
    { late: "CONTEXT_WRITTEN_LATE", "no-context": "MISSING_CONTEXT", "no-metrics": "MISSING_CORE_METRICS" },
  );
});

test("Replay: splits are chronological so the newest cases are held out", () => {
  const items = Array.from({ length: 10 }, (_, index) => ({ dataAsOf: `2026-10-${String(20 - index).padStart(2, "0")}` }));
  const split = assignSplits(items);
  const latest = (name: string) => split.filter((item) => item.split === name).map((item) => item.dataAsOf).sort().at(-1) || "";
  const earliest = (name: string) => split.filter((item) => item.split === name).map((item) => item.dataAsOf).sort()[0];
  assert.deepEqual(split.map((item) => item.split).filter((name, index, all) => all.indexOf(name) === index), ["train", "dev", "test"]);
  assert.ok(latest("train") < earliest("dev"));
  assert.ok(latest("dev") < earliest("test"));
});

test("Replay: applied candidate is mapped from the bid that was actually applied", () => {
  const dataset = buildReplayDataset([
    row("rule-applied"),
    row("held", { final_value: 1 }),
    row("manual-odd", { final_value: 0.5 }),
  ]);
  const byId = Object.fromEntries(dataset.cases.map((item) => [item.actionId, item]));
  assert.equal(byId["rule-applied"].appliedCandidateId, "DECREASE_AVG_CPC_MINUS_15");
  assert.equal(byId["rule-applied"].ruleCandidateId, "DECREASE_AVG_CPC_MINUS_15");
  assert.equal(byId.held.appliedCandidateId, "HOLD");
  assert.equal(byId["manual-odd"].appliedCandidateId, null);
});

function scored(
  id: string,
  options: {
    label?: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
    flagged?: boolean;
    applied?: string | null;
    decision?: AiReviewerRawResponse["decision"];
    raw?: AiReviewerRawResponse | null;
    status?: AiReviewerValidationResult["status"];
    fallbackReason?: string | null;
    evidence?: string[];
  } = {},
): ScoredCase {
  const replayCase = buildReplayDataset([row(id, { outcome_label: options.label || "NEGATIVE" })]).cases[0];
  if (options.applied !== undefined) replayCase.appliedCandidateId = options.applied;
  const raw: AiReviewerRawResponse | null = options.raw !== undefined ? options.raw : {
    decision: options.decision || "HOLD",
    candidate_id: null,
    reason_codes: [],
    evidence_used: options.evidence || [],
    counter_evidence: [],
    need_more_data: false,
    rule_critique: { rule_disagreement: Boolean(options.flagged), suggested_direction: "HOLD", disagreement_reason: null },
  };
  return {
    replayCase,
    raw,
    validation: {
      valid: options.status !== "AI_REVIEW_INVALID",
      status: options.status || "RULE_FALLBACK",
      fallback_reason: options.fallbackReason ?? null,
      effective_candidate_id: replayCase.ruleCandidateId,
      effective_bid: 0.85,
      decision_source: "RULE_FALLBACK",
      raw_ai_decision: raw,
    },
  };
}

test("Scorer: Negative Outcome Detection only counts cases where the rule's own candidate was applied", () => {
  const report = scoreReviewerRun([
    scored("tp", { label: "NEGATIVE", flagged: true }),
    scored("fp", { label: "POSITIVE", flagged: true }),
    scored("fn", { label: "NEGATIVE", flagged: false }),
    scored("tn", { label: "NEUTRAL", flagged: false }),
    scored("not-rule", { label: "NEGATIVE", flagged: true, applied: "HOLD" }),
    scored("unmapped", { label: "NEGATIVE", flagged: true, applied: null }),
  ], { harnessVersion: "v1.0", split: "dev" });
  const nod = report.negativeOutcomeDetection;
  assert.equal(nod.eligible, 4);
  assert.deepEqual([nod.truePositive, nod.falsePositive, nod.falseNegative, nod.trueNegative], [1, 1, 1, 1]);
  assert.equal(nod.precision.rate, 0.5);
  assert.equal(nod.recall.rate, 0.5);
  assert.equal(nod.f1, 0.5);
  assert.ok(nod.precision.ci95 && nod.precision.ci95[0] < 0.5 && nod.precision.ci95[1] > 0.5);
});

test("Scorer: calibration uses the payload's own minimum_samples, not a scorer threshold", () => {
  const item = scored("cal");
  const payload = item.replayCase.payload;
  payload.available_candidates[0].sample_count = 6;
  payload.scenario_evaluation = { ...payload.scenario_evaluation, retrieval_level: "LEVEL_A", sample_count: 6, minimum_samples: 20 };
  assert.equal(isEvidenceInsufficient(payload), true);
  payload.scenario_evaluation.minimum_samples = 5;
  assert.equal(isEvidenceInsufficient(payload), false);
});

test("Scorer: malformed replies count as invalid, invocation errors are tracked separately", () => {
  const report = scoreReviewerRun([
    scored("ok"),
    scored("malformed", { raw: null, status: "AI_REVIEW_INVALID", fallbackReason: "RESPONSE_NOT_AN_OBJECT" }),
    scored("timeout", { raw: null, fallbackReason: "INVOCATION_ERROR: timeout" }),
  ], { harnessVersion: "v1.0", split: "dev" });
  assert.deepEqual([report.invalidRate.hits, report.invalidRate.n], [1, 2]);
  assert.deepEqual([report.invocationErrorRate.hits, report.invocationErrorRate.n], [1, 3]);
});

test("Scorer: evidence grounding accepts payload fields and numbers, rejects untracked factors", () => {
  const { payload } = scored("g").replayCase;
  assert.equal(isEvidenceItemGrounded("actual_acos 75% vượt break-even", payload), true);
  assert.equal(isEvidenceItemGrounded("30 clicks", payload), true);
  assert.equal(isEvidenceItemGrounded("Tồn kho sắp hết, đối thủ giảm giá", payload), false);
});

test("Scorer: reward stays a reference value and segments split by campaign type and scenario", () => {
  const report = scoreReviewerRun([scored("a"), scored("b", { label: "POSITIVE" })], { harnessVersion: "v1.0", split: "dev" });
  assert.match(report.rewardReference.note, /Reference only/);
  assert.deepEqual(Object.keys(report.bySegment), ["SP03/HIGH_ACOS_TRIM"]);
  assert.equal(report.bySegment["SP03/HIGH_ACOS_TRIM"].cases, 2);
});

test("Scorer: Wilson interval", () => {
  assert.equal(wilson(0, 0), null);
  const [low, high] = wilson(5, 10) as [number, number];
  assert.ok(Math.abs(low - 0.2366) < 0.001 && Math.abs(high - 0.7634) < 0.001);
});
