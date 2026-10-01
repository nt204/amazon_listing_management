import type { ScoredCandidate, RejectedCandidateRecord } from "./competitor.types";
import { competitorConfig } from "../config/competitor.config";

/**
 * Steps 8 & 9: Sorts by final score and selects Top N competitors with Parent ASIN deduplication.
 * Ensures max 1 child per parent ASIN, with fallback to asin when parentAsin is absent.
 */
export function selectWithParentDedup(
  rankedCandidates: ScoredCandidate[],
  limit: number = competitorConfig.finalLimit,
  maxPerBrand: number = competitorConfig.maxPerBrand
): {
  selected: ScoredCandidate[];
  rejectedDueToDedup: RejectedCandidateRecord[];
} {
  // Sort by final score descending
  const sorted = [...rankedCandidates].sort((a, b) => b.scores.final - a.scores.final);

  // User Rule: "lấy các asin > 70 giới hạn 10, nếu không có >70 thì lấy top 4 asin cao điểm nhất"
  const candidatesAbove70 = sorted.filter((c) => c.scores.final > 70);
  const pool = candidatesAbove70.length > 0 ? candidatesAbove70 : sorted;
  const effectiveLimit = candidatesAbove70.length > 0 ? limit : 4;

  const selected: ScoredCandidate[] = [];
  const rejectedDueToDedup: RejectedCandidateRecord[] = [];
  const usedParents = new Set<string>();
  const brandCountMap = new Map<string, number>();

  for (const candidate of pool) {
    const parentKey = candidate.parentAsin || candidate.asin;

    // Check parent dedup (max 1 child per parent)
    if (usedParents.has(parentKey)) {
      candidate.status = "PARENT_DUPLICATE";
      candidate.rejectReason = `PARENT_DUPLICATE (Parent ${parentKey})`;
      rejectedDueToDedup.push({
        asin: candidate.asin,
        title: candidate.title,
        reasonCode: "PARENT_DUPLICATE",
        relevanceScore: candidate.scores.relevance,
      });
      continue;
    }

    // Optional brand limit check
    if (candidate.brand && maxPerBrand > 0) {
      const bKey = candidate.brand.toLowerCase();
      const currentBrandCount = brandCountMap.get(bKey) || 0;
      if (currentBrandCount >= maxPerBrand) {
        candidate.status = "PARENT_DUPLICATE";
        candidate.rejectReason = `BRAND_LIMIT_EXCEEDED (${candidate.brand})`;
        rejectedDueToDedup.push({
          asin: candidate.asin,
          title: candidate.title,
          reasonCode: "BRAND_LIMIT_EXCEEDED",
          relevanceScore: candidate.scores.relevance,
        });
        continue;
      }
      brandCountMap.set(bKey, currentBrandCount + 1);
    }

    usedParents.add(parentKey);
    candidate.status = "SELECTED";
    candidate.rank = selected.length + 1;
    selected.push(candidate);

    if (selected.length >= effectiveLimit) {
      break;
    }
  }

  // If pool was candidatesAbove70, also record items below 70 as rejected if not already selected
  if (candidatesAbove70.length > 0) {
    for (const candidate of sorted) {
      if (candidate.scores.final <= 70 && !selected.some((s) => s.asin === candidate.asin)) {
        candidate.status = "LOW_RELEVANCE";
        candidate.rejectReason = `SCORE_BELOW_70 (${candidate.scores.final.toFixed(1)} <= 70)`;
        rejectedDueToDedup.push({
          asin: candidate.asin,
          title: candidate.title,
          reasonCode: "SCORE_BELOW_70",
          relevanceScore: candidate.scores.relevance,
        });
      }
    }
  }

  return { selected, rejectedDueToDedup };
}
