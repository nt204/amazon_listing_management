import type {
  SellerSpriteCandidate,
  ScoredCandidate,
  RejectedCandidateRecord,
} from "./competitor.types";

/**
 * Step 3: Filters out sponsored items, keeping organic and unknown placements.
 * Records rejection reason for all dropped items.
 */
export function filterSponsoredCandidates(candidates: SellerSpriteCandidate[]): {
  organicOnly: SellerSpriteCandidate[];
  rejected: RejectedCandidateRecord[];
} {
  const organicOnly: SellerSpriteCandidate[] = [];
  const rejected: RejectedCandidateRecord[] = [];

  for (const candidate of candidates) {
    if (candidate.placement === "sponsored") {
      candidate.status = "SPONSORED_REJECTED";
      candidate.rejectReason = "SPONSORED_RESULT";
      rejected.push({
        asin: candidate.asin,
        title: candidate.title,
        reasonCode: "SPONSORED_RESULT",
      });
    } else {
      organicOnly.push(candidate);
    }
  }

  return { organicOnly, rejected };
}

/**
 * Step 4: Basic deduplication by ASIN
 */
export function deduplicateByAsin(candidates: SellerSpriteCandidate[]): SellerSpriteCandidate[] {
  const map = new Map<string, SellerSpriteCandidate>();
  for (const item of candidates) {
    if (item.asin && !map.has(item.asin)) {
      map.set(item.asin, item);
    }
  }
  return Array.from(map.values());
}

/**
 * Step 6: Hard Filter candidates based on completeness, AI mismatch, and minimum relevance.
 * Does NOT reject if revenue or sales is null.
 */
export function hardFilterCandidates(
  candidates: ScoredCandidate[],
  minRelevance: number = 70
): {
  eligible: ScoredCandidate[];
  rejected: RejectedCandidateRecord[];
} {
  const eligible: ScoredCandidate[] = [];
  const rejected: RejectedCandidateRecord[] = [];

  for (const candidate of candidates) {
    if (!candidate.asin) {
      candidate.status = "PRODUCT_MISMATCH";
      candidate.rejectReason = "MISSING_ASIN";
      rejected.push({ asin: "", title: candidate.title, reasonCode: "MISSING_ASIN" });
      continue;
    }

    if (!candidate.title) {
      candidate.status = "PRODUCT_MISMATCH";
      candidate.rejectReason = "MISSING_TITLE";
      rejected.push({ asin: candidate.asin, reasonCode: "MISSING_TITLE" });
      continue;
    }

    if (candidate.ai.hardMismatch) {
      candidate.status = "PRODUCT_MISMATCH";
      candidate.rejectReason = "PRODUCT_TYPE_MISMATCH";
      rejected.push({
        asin: candidate.asin,
        title: candidate.title,
        reasonCode: "PRODUCT_TYPE_MISMATCH",
        relevanceScore: candidate.ai.relevanceScore,
      });
      continue;
    }

    if (candidate.ai.relevanceScore < minRelevance) {
      candidate.status = "LOW_RELEVANCE";
      candidate.rejectReason = "LOW_RELEVANCE";
      rejected.push({
        asin: candidate.asin,
        title: candidate.title,
        reasonCode: "LOW_RELEVANCE",
        relevanceScore: candidate.ai.relevanceScore,
      });
      continue;
    }

    candidate.status = "ELIGIBLE";
    eligible.push(candidate);
  }

  return { eligible, rejected };
}
