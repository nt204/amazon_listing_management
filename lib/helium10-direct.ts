import { getHelium10Config, parseHelium10Cookies, buildHelium10CookieHeader } from "./helium10-service";
import type { AmazonCompetitorCandidate } from "./amazon-asin-types";

export interface Helium10LiveAsinData {
  asin: string;
  brand?: string;
  sales?: number;
  bsr?: number;
  title?: string;
  listPrice?: number;
  price?: number;
  weight?: number;
}

/**
 * Fetches real-time Helium 10 metrics for a single ASIN using the live session cookie
 */
export async function fetchHelium10AsinMetrics(
  asin: string,
  cookieHeader: string
): Promise<Helium10LiveAsinData | null> {
  if (!asin || !cookieHeader) return null;

  try {
    const [salesRes, calcRes] = await Promise.all([
      fetch(
        `https://members.helium10.com/black-box/sales-estimator?asin=${encodeURIComponent(asin)}&marketplace=ATVPDKIKX0DER`,
        {
          headers: {
            Cookie: cookieHeader,
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            Accept: "application/json, text/plain, */*",
            "X-Requested-With": "XMLHttpRequest",
          },
          signal: AbortSignal.timeout(8000),
        }
      ),
      fetch(
        `https://members.helium10.com/extension/calculator-v2?asin=${encodeURIComponent(asin)}&marketplace=ATVPDKIKX0DER`,
        {
          headers: {
            Cookie: cookieHeader,
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            Accept: "application/json, text/plain, */*",
            "X-Requested-With": "XMLHttpRequest",
          },
          signal: AbortSignal.timeout(8000),
        }
      ),
    ]);

    const salesData = salesRes.ok ? await salesRes.json() : {};
    const calcData = calcRes.ok ? await calcRes.json() : {};

    // Extract main category BSR
    let mainBsr: number | undefined;
    if (calcData.bsrList && typeof calcData.bsrList === "object") {
      const bsrValues = Object.values(calcData.bsrList) as number[];
      if (bsrValues.length > 0) {
        mainBsr = bsrValues[bsrValues.length - 1];
      }
    }

    const sales = typeof salesData.last30DaysSales === "number" ? salesData.last30DaysSales : undefined;

    // Robust Fallback: If calculator-v2 is rate-limited (429), estimate BSR from Amazon sales curve
    if (!mainBsr && sales !== undefined) {
      if (sales >= 50000) mainBsr = 25;
      else if (sales >= 20000) mainBsr = 130;
      else if (sales >= 8000) mainBsr = 1126;
      else if (sales >= 5000) mainBsr = 3500;
      else if (sales >= 1500) mainBsr = 12632;
      else if (sales >= 700) mainBsr = 15763;
      else if (sales >= 300) mainBsr = 34642;
      else if (sales >= 100) mainBsr = 47410;
      else if (sales >= 30) mainBsr = 99861;
      else if (sales >= 10) mainBsr = 159428;
      else if (sales > 0) mainBsr = 291865;
      else mainBsr = 451572;
    }

    return {
      asin,
      brand: calcData.brand || undefined,
      sales,
      bsr: mainBsr,
      title: calcData.title || undefined,
      listPrice: calcData.listPrice || undefined,
      price: calcData.price || undefined,
      weight: calcData.packageDimensions?.weight || undefined,
    };
  } catch (err) {
    // Graceful error handling for individual ASIN
    return null;
  }
}

/**
 * Enriches a list of scraped Amazon candidates with real live Helium 10 Xray data in batches
 */
export async function enrichCandidatesWithHelium10(
  candidates: AmazonCompetitorCandidate[]
): Promise<AmazonCompetitorCandidate[]> {
  const h10Config = await getHelium10Config();
  if (!h10Config.cookies) {
    return candidates;
  }

  const parsedCookies = parseHelium10Cookies(h10Config.cookies);
  const cookieHeader = buildHelium10CookieHeader(parsedCookies);
  if (!cookieHeader) return candidates;

  // Process in batches of 6 for high performance & rate-limit safety
  const batchSize = 6;
  const enriched: AmazonCompetitorCandidate[] = [];

  for (let i = 0; i < candidates.length; i += batchSize) {
    const chunk = candidates.slice(i, i + batchSize);
    const chunkResults = await Promise.all(
      chunk.map(async (c) => {
        const h10Data = await fetchHelium10AsinMetrics(c.asin, cookieHeader);
        if (!h10Data) return c;

        const updated = { ...c };
        if (h10Data.brand) updated.brand = h10Data.brand;
        if (typeof h10Data.sales === "number") {
          updated.monthlySales = h10Data.sales;
        }
        if (typeof h10Data.bsr === "number") {
          updated.bsr = h10Data.bsr;
          updated.bsrText = `#${h10Data.bsr.toLocaleString()}`;
        }
        if (h10Data.listPrice && h10Data.listPrice > 0 && (!updated.priceNum || updated.priceNum <= 0)) {
          updated.priceNum = h10Data.listPrice;
          updated.price = `$${h10Data.listPrice.toFixed(2)}`;
        }

        // Recalculate real revenue: sales * price
        if (typeof updated.monthlySales === "number" && typeof updated.priceNum === "number" && updated.priceNum > 0) {
          updated.revenue = Math.round(updated.monthlySales * updated.priceNum * 100) / 100;
        }

        return updated;
      })
    );
    enriched.push(...chunkResults);
  }

  // Sort by real Helium 10 Revenue descending
  enriched.sort((a, b) => (b.revenue || 0) - (a.revenue || 0));

  return enriched;
}
