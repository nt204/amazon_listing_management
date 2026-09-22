// app/api/ppc/recommendations/grouped/route.ts
import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { listPpcPerformance } from "@/lib/ppc/repository";
import { getGroupedRecommendations, resolveStoreId } from "@/lib/ppc/sku-architecture-service";

import {
  getCachedGroupedRecommendations,
  setCachedGroupedRecommendations,
} from "@/lib/ppc/recommendation-cache";

export const runtime = "nodejs";

// Bid decisions must always use the stable 30-day attribution window. Dashboard
// charts may switch between 7/14/30 days, but that UI preference must not change
// executable PPC recommendations.
const BID_RECOMMENDATION_DAYS = 30;

export async function GET(request: Request) {
  try {
    const scope = dataScope(authorize(request, "read"));
    const { searchParams } = new URL(request.url);
    const storeName = searchParams.get("storeName") || "ALL";
    const sku = searchParams.get("sku") || "ALL";
    const refresh = searchParams.get("refresh") === "1" || searchParams.get("refresh") === "true";
    const days = BID_RECOMMENDATION_DAYS;

    const storeId = await resolveStoreId(searchParams.get("storeId") || (storeName !== "ALL" ? storeName : null));

    const cacheKey = `${scope.teamId}\0${storeId}\0${storeName}`;
    const cached = refresh ? null : getCachedGroupedRecommendations(cacheKey);

    let result: Awaited<ReturnType<typeof getGroupedRecommendations>>;

    if (cached) {
      result = cached;
    } else {
      // SB target reports commonly leave `sku` blank. Load the store's complete
      // target set so evaluateRowWithRuleEngine can recover the SKU from the
      // campaign name, then apply the requested SKU filter to the evaluated result.
      const targetRows = await listPpcPerformance(
        scope,
        { storeName, sku: "ALL", days },
        { grain: "TARGET", limit: 50000 },
      );

      result = await getGroupedRecommendations(storeId, targetRows, days);
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

    return Response.json({
      success: true,
      recommendationWindowDays: days,
      data: filteredResult,
    }, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy danh sách đề xuất gom theo SKU.", 500);
  }
}
