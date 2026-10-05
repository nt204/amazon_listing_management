import type { AggregatedMetrics, DailyMetric } from "./types";

/**
 * Normalizes contribution margin. If given as 35, converts to 0.35.
 */
export function normalizeMargin(margin: number): number {
  if (margin > 1) {
    return margin / 100;
  }
  return margin;
}

/**
 * Calculates Contribution = Ad Sales * margin - Ad Spend
 */
export function calculateContribution(
  adSales: number,
  adSpend: number,
  marginPct: number
): number {
  return adSales * marginPct - adSpend;
}

/**
 * Calculates ACoS in percent (0 - 100+). Returns null if sales is 0.
 */
export function calculateAcos(spend: number, sales: number): number | null {
  if (sales <= 0) return null;
  return (spend / sales) * 100;
}

/**
 * Calculates median of an array of numbers.
 */
export function calculateMedian(values: number[]): number {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Extract YYYY-MM-DD from an ISO string or date string.
 */
export function parseDateOnly(dateStr: string): string {
  if (!dateStr) return "";
  return dateStr.slice(0, 10);
}

/**
 * Adds integer days to a YYYY-MM-DD date string safely in UTC.
 */
export function addDays(dateStr: string, days: number): string {
  const [year, month, day] = parseDateOnly(dateStr).split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Returns difference in days: (dateB - dateA) in UTC.
 */
export function diffDays(dateA: string, dateB: string): number {
  const [y1, m1, d1] = parseDateOnly(dateA).split("-").map(Number);
  const [y2, m2, d2] = parseDateOnly(dateB).split("-").map(Number);
  const utcA = Date.UTC(y1, m1 - 1, d1);
  const utcB = Date.UTC(y2, m2 - 1, d2);
  return Math.round((utcB - utcA) / (1000 * 60 * 60 * 24));
}

/**
 * Aggregates daily metrics list into summary figures.
 */
export function aggregateDailyMetrics(
  metrics: DailyMetric[],
  marginPct: number,
  expectedTotalDays?: number
): AggregatedMetrics {
  let clicks = 0;
  let orders = 0;
  let adSales = 0;
  let adSpend = 0;

  for (const m of metrics) {
    clicks += m.clicks || 0;
    orders += m.orders || 0;
    adSales += m.ad_sales || 0;
    adSpend += m.ad_spend || 0;
  }

  const contribution = calculateContribution(adSales, adSpend, marginPct);
  const acos = calculateAcos(adSpend, adSales);

  return {
    clicks,
    orders,
    ad_sales: adSales,
    ad_spend: adSpend,
    acos,
    contribution,
    days_with_data: metrics.length,
    total_days: expectedTotalDays ?? metrics.length,
  };
}
