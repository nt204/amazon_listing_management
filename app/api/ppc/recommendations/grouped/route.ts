// app/api/ppc/recommendations/grouped/route.ts
import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { listPpcPerformance } from "@/lib/ppc/repository";
import { getGroupedRecommendations, resolveStoreId } from "@/lib/ppc/sku-architecture-service";

import {
  groupedRecommendationsCacheKey,
  groupedRecommendationsRedisKey,
  getCachedGroupedRecommendations,
  setCachedGroupedRecommendations,
} from "@/lib/ppc/recommendation-cache";
import { getCachedOrFetch, invalidateCachePattern } from "@/lib/redis";

export const runtime = "nodejs";
const RECOMMENDATION_CACHE_TTL_SECONDS = 10 * 60;

export async function GET(request: Request) {
  const started = performance.now();
  try {
    const scope = dataScope(authorize(request, "read"));
    const { searchParams } = new URL(request.url);
    const storeName = searchParams.get("storeName") || "ALL";
    const sku = searchParams.get("sku") || "ALL";
    const refresh = searchParams.get("refresh") === "1" || searchParams.get("refresh") === "true";
    const summaryOnly = searchParams.get("summary") === "1";
    const days = Number(searchParams.get("days") || 30);

    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      throw new ApiError("Số ngày đánh giá recommendation phải là số nguyên từ 1 đến 3650.", 400);
    }
    if (storeName.length > 80 || sku.length > 200) {
      throw new ApiError("Bộ lọc recommendation không hợp lệ.", 400);
    }

    const storeId = await resolveStoreId(searchParams.get("storeId") || (storeName !== "ALL" ? storeName : null));

    // Each attribution window must have an isolated cache entry. Reusing the
    // 30-day result for a 7-day request can produce unsafe bid decisions.
    const cacheKey = groupedRecommendationsCacheKey(scope.teamId, storeId, storeName, days);
    const redisKey = groupedRecommendationsRedisKey(scope.teamId, storeName, days);
    if (refresh) {
      await invalidateCachePattern(redisKey);
    }
    const cached = refresh ? null : getCachedGroupedRecommendations(cacheKey);
    const cacheStatus = cached ? "HIT_MEMORY" : "SHARED_OR_COMPUTE";

    let result: Awaited<ReturnType<typeof getGroupedRecommendations>>;

    if (cached) {
      result = cached;
    } else {
      result = await getCachedOrFetch(redisKey, RECOMMENDATION_CACHE_TTL_SECONDS, async () => {
        // SB target reports commonly leave `sku` blank. Load the store's complete
        // target set, recover SKU from campaign names, then filter after evaluation.
        const targetRows = await listPpcPerformance(
          scope,
          { storeName, sku: "ALL", days },
          { grain: "TARGET", limit: 50000 },
        );
        return getGroupedRecommendations(storeId, targetRows, days);
      });
      setCachedGroupedRecommendations(cacheKey, result);
    }

    const normalizedSku = sku.trim().toUpperCase();
    const skuRecommendations = result.allRecommendations.filter(
      (recommendation) => (recommendation.sku || "").toUpperCase() === normalizedSku,
    );
    const filteredResult = normalizedSku === "ALL"
      ? result
      : {
        ...result,
        groups: result.groups.filter((group) => group.sku.toUpperCase() === normalizedSku),
        allRecommendations: skuRecommendations,
        totalRecommendations: skuRecommendations.length,
        totalSkus: result.groups.some((group) => group.sku.toUpperCase() === normalizedSku) ? 1 : 0,
      };

    const responseData = {
      success: true,
      recommendationWindowDays: days,
      data: summaryOnly ? { ...filteredResult, allRecommendations: [] } : filteredResult,
    };
    const body = JSON.stringify(responseData);
    return new Response(body, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
        "Server-Timing": `recommendations;dur=${(performance.now() - started).toFixed(1)}`,
        "X-PPC-Cache": cacheStatus,
        "X-Response-Bytes": String(Buffer.byteLength(body)),
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy danh sách đề xuất gom theo SKU.", 500);
  }
}
