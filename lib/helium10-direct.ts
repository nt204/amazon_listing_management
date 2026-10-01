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

export interface Helium10FetchResult {
  data: Helium10LiveAsinData | null;
  status: "ok" | "unauthorized" | "rate_limited" | "error";
  error?: string;
}

export interface Helium10EnrichResult {
  candidates: AmazonCompetitorCandidate[];
  warning?: string;
}

/**
 * Fetches real-time Helium 10 metrics for a single ASIN using the live session cookie.
 * No fake data or fallback estimation is applied.
 */
export async function fetchHelium10AsinMetrics(
  asin: string,
  cookieHeader: string
): Promise<Helium10FetchResult> {
  if (!asin || !cookieHeader) {
    return { data: null, status: "error", error: "Missing asin or cookie" };
  }

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

    if (salesRes.status === 401 || calcRes.status === 401 || salesRes.status === 403 || calcRes.status === 403) {
      return {
        data: null,
        status: "unauthorized",
        error: "Cookie Helium 10 đã hết hạn hoặc không có quyền truy cập (HTTP 401/403).",
      };
    }

    if (salesRes.status === 429 || calcRes.status === 429) {
      return {
        data: null,
        status: "rate_limited",
        error: "Helium 10 API bị giới hạn tần suất (HTTP 429 Too Many Requests).",
      };
    }

    const salesData = salesRes.ok ? await salesRes.json().catch(() => ({})) : {};
    const calcData = calcRes.ok ? await calcRes.json().catch(() => ({})) : {};

    // Extract main category BSR strictly from Helium 10 calculator response without any estimation
    let mainBsr: number | undefined;
    if (calcData.bsrList && typeof calcData.bsrList === "object") {
      const bsrValues = Object.values(calcData.bsrList) as number[];
      if (bsrValues.length > 0) {
        mainBsr = bsrValues[bsrValues.length - 1];
      }
    }

    const sales = typeof salesData.last30DaysSales === "number" ? salesData.last30DaysSales : undefined;

    return {
      data: {
        asin,
        brand: calcData.brand || undefined,
        sales,
        bsr: mainBsr,
        title: calcData.title || undefined,
        listPrice: calcData.listPrice || undefined,
        price: calcData.price || undefined,
        weight: calcData.packageDimensions?.weight || undefined,
      },
      status: "ok",
    };
  } catch (err) {
    return {
      data: null,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Enriches a list of scraped Amazon candidates with real live Helium 10 Xray data in batches.
 * No fake data fallback.
 */
export async function enrichCandidatesWithHelium10(
  candidates: AmazonCompetitorCandidate[]
): Promise<Helium10EnrichResult> {
  const h10Config = await getHelium10Config();
  if (!h10Config.cookies) {
    return {
      candidates,
      warning: "Chưa cấu hình Cookie Helium 10. Dữ liệu Sales, Doanh thu và BSR từ Helium 10 không khả dụng (chỉ có dữ liệu quét trực tiếp từ Amazon).",
    };
  }

  const parsedCookies = parseHelium10Cookies(h10Config.cookies);
  const cookieHeader = buildHelium10CookieHeader(parsedCookies);
  if (!cookieHeader) {
    return {
      candidates,
      warning: "Cookie Helium 10 không hợp lệ. Vui lòng cập nhật Cookie trong Cài đặt Helium 10.",
    };
  }

  const batchSize = 6;
  const enriched: AmazonCompetitorCandidate[] = [];
  let detectedWarning: string | undefined;

  for (let i = 0; i < candidates.length; i += batchSize) {
    const chunk = candidates.slice(i, i + batchSize);
    const chunkResults = await Promise.all(
      chunk.map(async (c) => {
        const fetchRes = await fetchHelium10AsinMetrics(c.asin, cookieHeader);
        if (fetchRes.status === "unauthorized" && !detectedWarning) {
          detectedWarning = "Cookie Helium 10 đã hết hạn (HTTP 401 Unauthorized). Dữ liệu Sales/Revenue/BSR không thể lấy từ H10. Vui lòng bấm 'Cấu hình Cookie H10' để cập nhật Cookie mới.";
        } else if (fetchRes.status === "rate_limited" && !detectedWarning) {
          detectedWarning = "Helium 10 API bị giới hạn tần suất (HTTP 429 Too Many Requests). Vui lòng thử lại sau vài phút.";
        }

        const h10Data = fetchRes.data;
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
    if (detectedWarning) {
      // If auth failed, avoid spamming further requests and push remaining unchanged
      const remaining = candidates.slice(i + batchSize);
      enriched.push(...remaining);
      break;
    }
  }

  // Sort by real Helium 10 Revenue descending if revenue exists
  enriched.sort((a, b) => (b.revenue || 0) - (a.revenue || 0));

  return {
    candidates: enriched,
    warning: detectedWarning,
  };
}
