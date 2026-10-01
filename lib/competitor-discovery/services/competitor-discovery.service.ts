import { randomUUID } from "node:crypto";
import type {
  CompetitorDiscoveryInput,
  CompetitorDiscoveryOutput,
  RejectedCandidateRecord,
} from "../domain/competitor.types";
import { competitorConfig } from "../config/competitor.config";
import { searchSellerSprite } from "../providers/sellersprite/sellersprite.client";
import { deduplicateByAsin, hardFilterCandidates } from "../domain/filters";
import { evaluateCandidatesRelevance } from "../ai/relevance.service";
import { calculateFinalScores } from "../domain/scoring";
import { selectWithParentDedup } from "../domain/selector";
import { saveDiscoveryRun } from "../repositories/competitor.repository";
import { scrapeAmazonSearchPage } from "@/lib/amazon-asin-crawler";

/**
 * Executes the complete Competitor Discovery Pipeline (Section 29)
 * 1. Search SellerSprite (50-100 candidates)
 * 2. Keep organic and sponsored candidates
 * 3. ASIN Deduplication
 * 4. AI Relevance Evaluation (Batching with CheapKey gemini-3.7-flash)
 * 5. Hard Filter (relevance >= 70, no hardMismatch)
 * 6. Multi-Factor Scoring (Relevance 50%, Revenue 30%, Sales 10%, BSR 10%)
 * 7. Parent ASIN Deduplication & Top 10 Selection
 * 8. Persistence & Full Observability
 */
export async function discoverCompetitors(
  input: CompetitorDiscoveryInput
): Promise<CompetitorDiscoveryOutput> {
  const productName = input.productName.trim();
  const marketplace = (input.marketplace || "US").toUpperCase();
  const targetLimit = input.limit || competitorConfig.finalLimit;

  const allRejected: RejectedCandidateRecord[] = [];

  // 1. Search SellerSprite for candidates (Sections 2 & 3)
  const [sellerSpriteCandidates, amazonCandidates] = await Promise.all([
    searchSellerSprite(productName, marketplace, competitorConfig.targetCandidateCount),
    scrapeAmazonSearchPage(productName, marketplace),
  ]);

  // SellerSprite's keyword lookup does not always retain Amazon SERP ad placement.
  // Overlay live Amazon placement and append sponsored ASINs missing from its result.
  const amazonByAsin = new Map(amazonCandidates.map((candidate) => [candidate.asin.toUpperCase(), candidate]));
  const rawCandidates = sellerSpriteCandidates.map((candidate) => ({
    ...candidate,
    placement: amazonByAsin.get(candidate.asin)?.isSponsored ? "sponsored" as const : candidate.placement,
  }));
  const knownAsins = new Set(rawCandidates.map((candidate) => candidate.asin));
  for (const candidate of amazonCandidates) {
    if (!candidate.isSponsored || knownAsins.has(candidate.asin)) continue;
    rawCandidates.push({
      asin: candidate.asin,
      title: candidate.title,
      brand: candidate.brand || undefined,
      price: candidate.priceNum || undefined,
      bsr: candidate.bsr || undefined,
      rating: candidate.rating || undefined,
      reviewCount: candidate.reviewCount,
      image: candidate.img || undefined,
      position: rawCandidates.length + 1,
      placement: "sponsored",
      badges: ["SP"],
      status: "RAW",
    });
    knownAsins.add(candidate.asin);
  }

  // 2. Keep both organic and sponsored results. Sponsored products are still
  // useful competitors and should be evaluated by the same relevance/scoring flow.
  // 3. Basic ASIN deduplication (Section 7)
  const uniqueCandidates = deduplicateByAsin(rawCandidates);

  // 4. AI relevance evaluation batch (Section 8, 9, 10)
  const candidatesWithAi = await evaluateCandidatesRelevance(productName, uniqueCandidates);

  // 5. Hard Filter (Section 13 & 14)
  const { eligible, rejected: rejectedHardFilter } = hardFilterCandidates(
    candidatesWithAi,
    competitorConfig.minimumRelevance
  );
  allRejected.push(...rejectedHardFilter);

  // 6. Quantitative multi-factor scoring (Section 15-21)
  const scoredCandidates = calculateFinalScores(eligible, input.weights || competitorConfig.weights);

  // 7. Sort by final score & select with Parent ASIN deduplication (Section 23, 24, 25)
  const { selected, rejectedDueToDedup } = selectWithParentDedup(
    scoredCandidates,
    targetLimit,
    competitorConfig.maxPerBrand
  );
  allRejected.push(...rejectedDueToDedup);

  const stats = {
    raw: rawCandidates.length,
    // Kept for API compatibility; this now represents all candidates entering
    // the AI stage because sponsored results are intentionally included.
    organicOnly: rawCandidates.length,
    afterAiFilter: candidatesWithAi.filter((c) => !c.ai.hardMismatch).length,
    afterHardFilter: eligible.length,
    selected: selected.length,
  };

  const output: CompetitorDiscoveryOutput = {
    productName,
    marketplace,
    stats,
    competitors: selected,
    allEligible: scoredCandidates,
    rejected: allRejected,
  };

  // 8. Persist run & candidates (Section 28 & 31)
  const runId = randomUUID();
  void saveDiscoveryRun(runId, output, candidatesWithAi, allRejected);

  return output;
}
