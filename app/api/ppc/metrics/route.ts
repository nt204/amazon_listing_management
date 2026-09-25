import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { getPpcAnalyticsData } from "@/lib/ppc/service";
import { getActiveSnapshotId } from "@/lib/ppc/repository";
import type { PpcPerformanceGrain, PpcSearchTermRow } from "@/lib/ppc/types";
import { getCachedOrFetch, invalidateCachePattern } from "@/lib/redis";

export const runtime = "nodejs";

const METRICS_CACHE_TTL_MS = 60_000;
const REDIS_METRICS_TTL_SEC = 900; // 15 phút lưu trong Redis
const METRICS_CACHE_MAX_ENTRIES = 20;
type MetricsData = Awaited<ReturnType<typeof getPpcAnalyticsData>>;
type MetricsSection = "overview" | "campaigns" | "ad_groups" | "targets" | "skus" | "search_terms";
type MetricsResponse = ReturnType<typeof projectMetrics>;
const metricsCache = new Map<string, { expiresAt: number; data: MetricsResponse }>();
const metricsInFlight = new Map<string, Promise<MetricsResponse>>();

const SECTION_GRAINS: Record<MetricsSection, PpcPerformanceGrain[]> = {
  overview: [],
  campaigns: ["CAMPAIGN"],
  ad_groups: ["AD_GROUP"],
  targets: ["TARGET"],
  skus: ["PRODUCT"],
  search_terms: [],
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

function projectMetrics(data: MetricsData, section: MetricsSection) {
  const detailCounts = (data as any).detailCounts || (section === "overview"
    ? {
      campaigns: data.campaignPerformance.length,
      targets: data.targets.length,
      searchTerms: data.searchTerms.length,
      skus: data.skuPerformance.length,
    }
    : {
      ...(section === "campaigns" ? { campaigns: data.campaignPerformance.length } : {}),
      ...(section === "ad_groups" ? { adGroups: data.adGroups.length } : {}),
      ...(section === "targets" ? { targets: data.targets.length } : {}),
      ...(section === "skus" ? { skus: data.skuPerformance.length } : {}),
      ...(section === "search_terms" ? { searchTerms: data.searchTerms.length } : {}),
    });
  if (section === "overview") {
    return {
      ...data,
      campaignPerformance: data.campaignPerformance,
      adGroups: [],
      targets: [],
      skuPerformance: data.skuPerformance.slice(0, 10),
      searchTerms: overviewSearchTerms(data.searchTerms, data.targetAcos),
      detailCounts,
    };
  }
  return {
    stores: data.stores,
    storeSummaries: data.storeSummaries || [],
    campaignPerformance: section === "campaigns" ? data.campaignPerformance : [],
    adGroups: section === "ad_groups" ? data.adGroups : [],
    targets: section === "targets" ? data.targets : [],
    skuPerformance: section === "skus" ? data.skuPerformance : [],
    searchTerms: section === "search_terms" ? data.searchTerms : [],
    detailCounts,
  };
}

function cacheMetrics(key: string, data: MetricsResponse): void {
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
    const validSections: MetricsSection[] = ["overview", "campaigns", "ad_groups", "targets", "skus", "search_terms"];
    if (!validSections.includes(requestedSection as MetricsSection)) {
      throw new ApiError("Phần dữ liệu PPC không hợp lệ.", 400);
    }
    const section = requestedSection as MetricsSection;
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      throw new ApiError("Số ngày phải là số nguyên từ 1 đến 3650.", 400);
    }
    if (storeName.length > 80 || sku.length > 200) {
      throw new ApiError("Bộ lọc PPC không hợp lệ.", 400);
    }

    const startDateParam = searchParams.get("startDate")?.trim() || "";
    const endDateParam = searchParams.get("endDate")?.trim() || "";
    const startDate = /^\d{4}-\d{2}-\d{2}$/.test(startDateParam) ? startDateParam : undefined;
    const endDate = /^\d{4}-\d{2}-\d{2}$/.test(endDateParam) ? endDateParam : undefined;

    if (refresh) {
      metricsCache.clear();
      await invalidateCachePattern(`ppc:metrics:${scope.teamId}:*`).catch(() => {});
    }

    const snapshotId = await getActiveSnapshotId(scope, storeName, days);
    const redisKey = `ppc:metrics:${scope.teamId}:${storeName}:${snapshotId}:${sku}:${days}:${startDate || "none"}:${endDate || "none"}:${section}`;
    const cacheKey = `${scope.teamId}\u0000${storeName}\u0000${snapshotId}\u0000${sku}\u0000${days}\u0000${startDate || ""}\u0000${endDate || ""}\u0000${section}`;

    // 1. Kiểm tra L1 In-Memory Cache
    const memCached = refresh ? undefined : metricsCache.get(cacheKey);
    let cacheStatus = "MISS";
    let data: MetricsResponse;

    if (memCached && memCached.expiresAt > Date.now()) {
      data = memCached.data;
      cacheStatus = "HIT_MEMORY";
    } else {
      if (memCached) metricsCache.delete(cacheKey);

      // 2. L2 Cache qua Redis (tồn tại 15 phút, truy xuất siêu nhanh ~5ms)
      if (refresh) {
        let pending = metricsInFlight.get(cacheKey);
        if (!pending) {
          pending = getPpcAnalyticsData(
            scope,
            { storeName, sku, days, startDate, endDate },
            { grains: SECTION_GRAINS[section], includeRecommendations: false, section },
          ).then((result) => projectMetrics(result, section));
          metricsInFlight.set(cacheKey, pending);
        }
        try {
          data = await pending;
        } finally {
          if (metricsInFlight.get(cacheKey) === pending) metricsInFlight.delete(cacheKey);
        }
      } else {
        data = await getCachedOrFetch<MetricsResponse>(
          redisKey,
          REDIS_METRICS_TTL_SEC,
          async () => {
            let pending = metricsInFlight.get(cacheKey);
            if (!pending) {
              pending = getPpcAnalyticsData(
                scope,
                { storeName, sku, days, startDate, endDate },
                { grains: SECTION_GRAINS[section], includeRecommendations: false, section },
              ).then((result) => projectMetrics(result, section));
              metricsInFlight.set(cacheKey, pending);
            }
            try {
              return await pending;
            } finally {
              if (metricsInFlight.get(cacheKey) === pending) metricsInFlight.delete(cacheKey);
            }
          },
        );
        cacheStatus = "HIT_REDIS";
      }
      cacheMetrics(cacheKey, data);
    }

    return Response.json(data, {
      headers: {
        "Cache-Control": "private, no-store",
        "X-PPC-Cache": cacheStatus,
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi máy chủ khi tải số liệu PPC.", 500);
  }
}
