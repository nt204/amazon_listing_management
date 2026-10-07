export type ShadowDirection = "INCREASE" | "DECREASE" | "HOLD" | "PAUSE";
export type CandidateBasis = "CURRENT_BID" | "AVG_CPC" | "NONE";

export interface ShadowCandidate {
  id: string;
  direction: ShadowDirection;
  basis: CandidateBasis;
  adjustmentPct: number;
  bid: number | null;
  allowed: boolean;
  guardrailReasons: string[];
  isRuleCandidate: boolean;
}

export interface CandidateEvidence {
  candidateId: string;
  sampleCount: number;
  winCount: number;
  neutralCount: number;
  lossCount: number;
  medianRewardUsd: number | null;
}

export interface ShadowDecisionInput {
  currentBid: number;
  averageCpc: number;
  ruleBid: number;
  ruleDirection: ShadowDirection;
  maxBid?: number | null;
  evidence?: CandidateEvidence[];
  minimumEvidence?: number;
}

export interface ShadowDecisionResult {
  mode: "SHADOW";
  status: "RULE_FALLBACK" | "READY_FOR_AGENT_REVIEW";
  selectedCandidateId: string;
  reasonCode: "INSUFFICIENT_EVIDENCE" | "EVIDENCE_AVAILABLE";
  confidence: "LOW";
  candidates: ShadowCandidate[];
  evidence: CandidateEvidence[];
  createsAction: false;
}

function roundBid(value: number): number {
  return Math.round(value * 100) / 100;
}

function candidateId(direction: ShadowDirection, basis: CandidateBasis, adjustmentPct: number): string {
  if (direction === "HOLD") return "HOLD";
  if (direction === "PAUSE") return "PAUSE_RULE_ONLY";
  const sign = adjustmentPct > 0 ? "PLUS" : "MINUS";
  return `${direction}_${basis}_${sign}_${Math.abs(adjustmentPct)}`;
}

function closestRuleCandidate(candidates: ShadowCandidate[], ruleBid: number): ShadowCandidate {
  const executable = candidates.filter((candidate) => candidate.allowed && candidate.bid !== null);
  return executable.reduce((closest, candidate) => {
    if (!closest) return candidate;
    return Math.abs(Number(candidate.bid) - ruleBid) < Math.abs(Number(closest.bid) - ruleBid)
      ? candidate
      : closest;
  }, undefined as ShadowCandidate | undefined) || candidates.find((candidate) => candidate.id === "HOLD")!;
}

export function buildShadowCandidates(input: ShadowDecisionInput): ShadowCandidate[] {
  const maxBid = Number(input.maxBid);
  const hasMaxBid = Number.isFinite(maxBid) && maxBid > 0;
  const specs: Array<{ direction: ShadowDirection; basis: CandidateBasis; pct: number; bid: number | null }> = [];

  if (input.ruleDirection === "INCREASE") {
    for (const pct of [5, 8]) {
      specs.push({ direction: "INCREASE", basis: "CURRENT_BID", pct, bid: input.currentBid * (1 + pct / 100) });
    }
    specs.push({ direction: "HOLD", basis: "NONE", pct: 0, bid: input.currentBid });
  } else if (input.ruleDirection === "DECREASE") {
    for (const pct of [-8, -10, -15]) {
      specs.push({ direction: "DECREASE", basis: "AVG_CPC", pct, bid: input.averageCpc * (1 + pct / 100) });
    }
    specs.push({ direction: "HOLD", basis: "NONE", pct: 0, bid: input.currentBid });
  } else if (input.ruleDirection === "PAUSE") {
    specs.push({ direction: "PAUSE", basis: "NONE", pct: 0, bid: null });
    specs.push({ direction: "HOLD", basis: "NONE", pct: 0, bid: input.currentBid });
  } else {
    specs.push({ direction: "HOLD", basis: "NONE", pct: 0, bid: input.currentBid });
  }

  const candidates = specs.map<ShadowCandidate>((spec) => {
    const bid = spec.bid === null ? null : roundBid(Math.max(0, spec.bid));
    const guardrailReasons: string[] = [];
    if (bid !== null && hasMaxBid && bid > maxBid) guardrailReasons.push("ABOVE_MAX_BID");
    if (spec.direction === "INCREASE" && input.ruleDirection !== "INCREASE") guardrailReasons.push("RULE_DIRECTION_MISMATCH");
    if (spec.direction === "DECREASE" && input.ruleDirection !== "DECREASE") guardrailReasons.push("RULE_DIRECTION_MISMATCH");
    return {
      id: candidateId(spec.direction, spec.basis, spec.pct),
      direction: spec.direction,
      basis: spec.basis,
      adjustmentPct: spec.pct,
      bid,
      allowed: guardrailReasons.length === 0,
      guardrailReasons,
      isRuleCandidate: false,
    };
  });

  const ruleCandidate = input.ruleDirection === "PAUSE"
    ? candidates.find((candidate) => candidate.direction === "PAUSE")!
    : closestRuleCandidate(candidates, input.ruleBid);
  ruleCandidate.isRuleCandidate = true;
  return candidates;
}

export function evaluateShadowDecision(input: ShadowDecisionInput): ShadowDecisionResult {
  const candidates = buildShadowCandidates(input);
  const ruleCandidate = candidates.find((candidate) => candidate.isRuleCandidate)!;
  const evidence = input.evidence || [];
  const minimumEvidence = Math.max(1, input.minimumEvidence || 20);
  const allowedNonHold = candidates.filter((candidate) => candidate.allowed && !["HOLD", "PAUSE_RULE_ONLY"].includes(candidate.id));
  const evidenceReady = allowedNonHold.length > 0 && allowedNonHold.every((candidate) =>
    (evidence.find((item) => item.candidateId === candidate.id)?.sampleCount || 0) >= minimumEvidence
  );

  return {
    mode: "SHADOW",
    status: evidenceReady ? "READY_FOR_AGENT_REVIEW" : "RULE_FALLBACK",
    selectedCandidateId: ruleCandidate.id,
    reasonCode: evidenceReady ? "EVIDENCE_AVAILABLE" : "INSUFFICIENT_EVIDENCE",
    confidence: "LOW",
    candidates,
    evidence,
    createsAction: false,
  };
}
