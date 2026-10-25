import { BASELINE_HARNESS, type ReviewerHarness } from "./ai-reviewer-harness";

// Candidate harnesses for offline evaluation only. Production keeps BASELINE_HARNESS until a
// candidate passes the replay gates and a person approves the promotion.

// v1.1-cand-1: manual reading of v1.0 answers showed the reviewer never critiqued the rule while
// evidence was insufficient (e.g. +8% on a single click), which would make Negative Outcome
// Detection recall near zero. The critique channel is made explicitly independent of evidence.
export const HARNESS_V1_1_CANDIDATE_1: ReviewerHarness = {
  ...BASELINE_HARNESS,
  version: "v1.1-cand-1",
  sections: {
    ...BASELINE_HARNESS.sections,
    ruleCritique: `${BASELINE_HARNESS.sections.ruleCritique}

CRITIQUE IS INDEPENDENT OF HISTORICAL EVIDENCE:
- "decision" depends on mature historical evidence; "rule_critique" does NOT. Even when you return INSUFFICIENT_EVIDENCE, judge the rule direction from the current metrics in the payload.
- Agreement is not the default. Set "rule_disagreement": true whenever the current metrics do not support the strength or the direction of the rule's move, for example:
  * a strong increase or decrease justified by very few clicks or a single order (statistically meaningless sample);
  * "scenario_evaluation.target_scenario" contradicts the metrics (e.g. ZERO_ORDER_BLEED with fewer than 7 clicks) and the rule acts on the wrong scenario;
  * the move ignores break-even economics (cutting a PROFITABLE_SCALE target, raising a HIGH_ACOS_TRIM target).
- Base "disagreement_reason" only on fields present in the payload, quoting the numbers you used.`,
  },
};

export const REVIEWER_HARNESSES: Record<string, ReviewerHarness> = {
  [BASELINE_HARNESS.version]: BASELINE_HARNESS,
  [HARNESS_V1_1_CANDIDATE_1.version]: HARNESS_V1_1_CANDIDATE_1,
};

export function resolveReviewerHarness(version: string | null | undefined): ReviewerHarness {
  if (!version) return BASELINE_HARNESS;
  const harness = REVIEWER_HARNESSES[version];
  if (!harness) {
    throw new Error(`Không có harness ${version}. Có: ${Object.keys(REVIEWER_HARNESSES).join(", ")}.`);
  }
  return harness;
}
