import "server-only";

import type { DataScope } from "@/lib/db";
import { getCachedOrFetch, invalidateCachePattern } from "@/lib/redis";
import { listPpcPerformance } from "./repository";
import { getGroupedRecommendations, resolveStoreId } from "./sku-architecture-service";
import {
  groupedRecommendationsCacheKey,
  groupedRecommendationsRedisKey,
  setCachedGroupedRecommendations,
} from "./recommendation-cache";

const RECOMMENDATION_CACHE_TTL_SECONDS = 10 * 60;

export async function warmGroupedRecommendationWindows(
  scope: DataScope,
  storeName: string,
  windows: readonly number[] = [7, 30],
): Promise<void> {
  const storeId = await resolveStoreId(storeName);
  await invalidateCachePattern(`ppc:recommendations:${scope.teamId}:${encodeURIComponent(storeName)}:*`);

  // Keep these sequential: both queries are CPU/DB intensive and parallelizing
  // them makes ingestion finish sooner at the cost of dashboard latency.
  for (const days of windows) {
    const redisKey = groupedRecommendationsRedisKey(scope.teamId, storeName, days);
    const result = await getCachedOrFetch(redisKey, RECOMMENDATION_CACHE_TTL_SECONDS, async () => {
      const targetRows = await listPpcPerformance(
        scope,
        { storeName, sku: "ALL", days },
        { grain: "TARGET", limit: 50000 },
      );
      return getGroupedRecommendations(storeId, targetRows, days);
    });
    setCachedGroupedRecommendations(
      groupedRecommendationsCacheKey(scope.teamId, storeId, storeName, days),
      result,
    );
  }
}
