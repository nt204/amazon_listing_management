import type { ScoredCandidate } from "./competitor.types";
import { competitorConfig } from "../config/competitor.config";

/**
 * Normalizes revenue using logarithmic scaling: log(1 + revenue) / log(1 + maxRevenue) * 100
 */
export function normalizeRevenue(revenue: number | undefined, maxRevenue: number): number {
  if (!revenue || revenue <= 0 || !maxRevenue || maxRevenue <= 0) return 0;
  const score = (Math.log1p(revenue) / Math.log1p(maxRevenue)) * 100;
  return Math.max(0, Math.min(100, Math.round(score * 10) / 10));
}

/**
 * Normalizes monthly sales volume using logarithmic scaling
 */
export function normalizeSales(sales: number | undefined, maxSales: number): number {
  if (!sales || sales <= 0 || !maxSales || maxSales <= 0) return 0;
  const score = (Math.log1p(sales) / Math.log1p(maxSales)) * 100;
  return Math.max(0, Math.min(100, Math.round(score * 10) / 10));
}

/**
 * Computes percentile-based BSR score where lower BSR ranks highest (Section 20).
 * Candidates without BSR receive 0.
 */
export function computeBsrPercentiles(
  candidates: { asin: string; bsr?: number }[]
): Map<string, number> {
  const bsrScores = new Map<string, number>();
  const withBsr = candidates
    .filter((c): c is { asin: string; bsr: number } => typeof c.bsr === "number" && c.bsr > 0)
    .sort((a, b) => a.bsr - b.bsr);

  const n = withBsr.length;
  if (n === 0) return bsrScores;

  withBsr.forEach((item, index) => {
    // Top 1 rank gets highest percentile (~100), bottom gets lower
    const score = n === 1 ? 100 : ((n - index) / n) * 100;
    bsrScores.set(item.asin, Math.round(score * 10) / 10);
  });

  return bsrScores;
}

/**
 * Calculates metric scores and weighted final score for all candidates (Section 21).
 */
export function calculateFinalScores(
  candidates: ScoredCandidate[],
  weights = competitorConfig.weights
): ScoredCandidate[] {
  if (candidates.length === 0) return [];

  const maxRevenue = Math.max(
    0,
    ...candidates.map((c) => c.monthlyRevenue || 0).filter((v) => Number.isFinite(v))
  );
  const maxSales = Math.max(
    0,
    ...candidates.map((c) => c.monthlySales || 0).filter((v) => Number.isFinite(v))
  );
  const bsrPercentiles = computeBsrPercentiles(candidates);

  return candidates.map((candidate) => {
    const relevanceScore = Math.max(0, Math.min(100, candidate.ai.relevanceScore));
    const revenueScore = normalizeRevenue(candidate.monthlyRevenue, maxRevenue);
    const salesScore = normalizeSales(candidate.monthlySales, maxSales);
    const bsrScore = bsrPercentiles.get(candidate.asin) || 0;

    const finalRaw =
      relevanceScore * weights.relevance +
      revenueScore * weights.revenue +
      salesScore * weights.sales +
      bsrScore * weights.bsr;

    const finalScore = Math.round(finalRaw * 100) / 100;

    return {
      ...candidate,
      scores: {
        relevance: relevanceScore,
        revenue: revenueScore,
        sales: salesScore,
        bsr: bsrScore,
        final: finalScore,
      },
    };
  });
}
