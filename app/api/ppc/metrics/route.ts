import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { getPpcAnalyticsData } from "@/lib/ppc/service";

export const runtime = "nodejs";

const METRICS_CACHE_TTL_MS = 30_000;
const METRICS_CACHE_MAX_ENTRIES = 5;
type MetricsData = Awaited<ReturnType<typeof getPpcAnalyticsData>>;
const metricsCache = new Map<string, { expiresAt: number; data: MetricsData }>();
const metricsInFlight = new Map<string, Promise<MetricsData>>();

function cacheMetrics(key: string, data: MetricsData): void {
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
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      throw new ApiError("Số ngày phải là số nguyên từ 1 đến 3650.", 400);
    }
    if (storeName.length > 80 || sku.length > 200) {
      throw new ApiError("Bộ lọc PPC không hợp lệ.", 400);
    }

    const cacheKey = `${scope.teamId}\u0000${storeName}\u0000${sku}\u0000${days}`;
    const cached = refresh ? undefined : metricsCache.get(cacheKey);
    let data: MetricsData;
    if (cached && cached.expiresAt > Date.now()) {
      data = cached.data;
    } else {
      if (cached) metricsCache.delete(cacheKey);
      let pending = metricsInFlight.get(cacheKey);
      if (!pending) {
        pending = getPpcAnalyticsData(scope, { storeName, sku, days });
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
