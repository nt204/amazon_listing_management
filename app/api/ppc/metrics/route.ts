import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { getPpcAnalyticsData } from "@/lib/ppc/service";
import type { PpcPerformanceGrain, PpcSearchTermRow } from "@/lib/ppc/types";

export const runtime = "nodejs";

const METRICS_CACHE_TTL_MS = 30_000;
const METRICS_CACHE_MAX_ENTRIES = 5;
type MetricsData = Awaited<ReturnType<typeof getPpcAnalyticsData>>;
type MetricsSection = "overview" | "campaigns" | "ad_groups" | "targets" | "skus" | "search_terms" | "recommendations";
type MetricsResponse = ReturnType<typeof projectMetrics>;
const metricsCache = new Map<string, { expiresAt: number; data: MetricsResponse }>();
const metricsInFlight = new Map<string, Promise<MetricsResponse>>();

const SECTION_GRAINS: Record<MetricsSection, PpcPerformanceGrain[]> = {
  overview: ["CAMPAIGN", "TARGET"],
  campaigns: ["CAMPAIGN"],
  ad_groups: ["AD_GROUP"],
  targets: ["TARGET"],
  skus: ["PRODUCT"],
  search_terms: [],
  recommendations: ["TARGET"],
};

function overviewSearchTerms(rows: PpcSearchTermRow[], targetAcos: number): PpcSearchTermRow[] {
  const profitable = rows
    .filter((row) => row.orders >= 2 && row.acos <= targetAcos)
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 5);
  const bleeding = rows
    .filter((row) => row.clicks >= 9 && row.orders === 0)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 5);
  return Array.from(new Map([...profitable, ...bleeding].map((row) => [
    row.id || [row.reportDate, row.campaignName, row.adGroupName, row.customerSearchTerm].join("\0"),
    row,
  ])).values());
}

function pageRows<T>(rows: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

function projectMetrics(data: MetricsData, section: MetricsSection, page = 1, pageSize = 25) {
  const detailCounts = section === "overview"
    ? {
      campaigns: data.campaignPerformance.length,
      targets: data.targets.length,
      searchTerms: data.searchTerms.length,
      recommendations: data.recommendations.length,
    }
    : {
      ...(section === "campaigns" ? { campaigns: data.campaignPerformance.length } : {}),
      ...(section === "ad_groups" ? { adGroups: data.adGroups.length } : {}),
      ...(section === "targets" ? { targets: data.targets.length } : {}),
      ...(section === "skus" ? { skus: data.skuPerformance.length } : {}),
      ...(section === "search_terms" ? { searchTerms: data.searchTerms.length } : {}),
      ...(section === "recommendations" ? { recommendations: data.recommendations.length } : {}),
    };
  if (section === "overview") {
    return {
      ...data,
      campaignPerformance: data.campaignPerformance.slice(0, 7),
      adGroups: [],
      targets: [],
      skuPerformance: data.skuPerformance.slice(0, 10),
      searchTerms: overviewSearchTerms(data.searchTerms, data.targetAcos),
      recommendations: data.recommendations.slice(0, 10),
      detailCounts,
    };
  }
  return {
    stores: data.stores,
    campaignPerformance: section === "campaigns" ? pageRows(data.campaignPerformance, page, pageSize) : [],
    adGroups: section === "ad_groups" ? pageRows(data.adGroups, page, pageSize) : [],
    targets: section === "targets" ? pageRows(data.targets, page, pageSize) : [],
    skuPerformance: section === "skus" ? pageRows(data.skuPerformance, page, pageSize) : [],
    searchTerms: section === "search_terms" ? pageRows(data.searchTerms, page, pageSize) : [],
    recommendations: section === "recommendations" ? pageRows(data.recommendations, page, pageSize) : [],
    detailCounts,
    page,
    pageSize,
  };
}

function cacheMetrics(key: string, data: MetricsResponse): void {
  const detailRows = data.campaignPerformance.length + data.adGroups.length +
    data.targets.length + data.skuPerformance.length + data.searchTerms.length +
    data.recommendations.length;
  if (detailRows > 500) return;
  if (metricsCache.size >= METRICS_CACHE_MAX_ENTRIES) {
    const oldestKey = metricsCache.keys().next().value;
    if (oldestKey) metricsCache.delete(oldestKey);
  }
  metricsCache.set(key, { expiresAt: Date.now() + METRICS_CACHE_TTL_MS, data });
}

export async function GET(request: Request) {
  try {
    const scope = dataScope(authorize(request, "read"));
    const { searchParams } = new URL(request.url);
    const storeName = searchParams.get("storeName") || "ALL";
    const sku = searchParams.get("sku") || "ALL";
    const days = Number(searchParams.get("days") || 7);
    const refresh = searchParams.get("refresh") === "1";
    const requestedSection = searchParams.get("section") || "overview";
    const page = Number(searchParams.get("page") || 1);
    const pageSize = Number(searchParams.get("pageSize") || 25);
    const validSections: MetricsSection[] = ["overview", "campaigns", "ad_groups", "targets", "skus", "search_terms", "recommendations"];
    if (!validSections.includes(requestedSection as MetricsSection)) {
      throw new ApiError("Phần dữ liệu PPC không hợp lệ.", 400);
    }
    const section = requestedSection as MetricsSection;
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      throw new ApiError("Số ngày phải là số nguyên từ 1 đến 3650.", 400);
    }
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
      throw new ApiError("Thông tin phân trang PPC không hợp lệ.", 400);
    }
    if (storeName.length > 80 || sku.length > 200) {
      throw new ApiError("Bộ lọc PPC không hợp lệ.", 400);
    }

    const cacheKey = `${scope.teamId}\u0000${storeName}\u0000${sku}\u0000${days}\u0000${section}\u0000${page}\u0000${pageSize}`;
    const cached = refresh ? undefined : metricsCache.get(cacheKey);
    let data: MetricsResponse;
    if (cached && cached.expiresAt > Date.now()) {
      data = cached.data;
    } else {
      if (cached) metricsCache.delete(cacheKey);
      let pending = metricsInFlight.get(cacheKey);
      if (!pending) {
        pending = getPpcAnalyticsData(
          scope,
          { storeName, sku, days },
          { grains: SECTION_GRAINS[section] },
        ).then((result) => projectMetrics(result, section, page, pageSize));
        metricsInFlight.set(cacheKey, pending);
      }
      try {
        data = await pending;
      } finally {
        if (metricsInFlight.get(cacheKey) === pending) metricsInFlight.delete(cacheKey);
      }
      cacheMetrics(cacheKey, data);
    }

    return Response.json(data, {
      headers: {
        "Cache-Control": "private, no-store",
        "X-PPC-Cache": cached && cached.expiresAt > Date.now() ? "HIT" : "MISS",
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi máy chủ khi tải số liệu PPC.", 500);
  }
}
