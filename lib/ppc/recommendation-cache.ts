// lib/ppc/recommendation-cache.ts
import type { getGroupedRecommendations } from "@/lib/ppc/sku-architecture-service";

interface CachedGroupedRecs {
  expiresAt: number;
  result: Awaited<ReturnType<typeof getGroupedRecommendations>>;
}

const groupedRecsCache = new Map<string, CachedGroupedRecs>();

export function getCachedGroupedRecommendations(cacheKey: string): Awaited<ReturnType<typeof getGroupedRecommendations>> | null {
  const cached = groupedRecsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }
  return null;
}

export function setCachedGroupedRecommendations(
  cacheKey: string,
  result: Awaited<ReturnType<typeof getGroupedRecommendations>>,
  ttlMs = 10 * 60 * 1000,
): void {
  groupedRecsCache.set(cacheKey, {
    expiresAt: Date.now() + ttlMs,
    result,
  });
}

export function invalidateGroupedRecommendationsCache(storeIdOrName?: string): void {
  if (!storeIdOrName || storeIdOrName === "ALL") {
    groupedRecsCache.clear();
    return;
  }
  for (const key of groupedRecsCache.keys()) {
    if (key.includes(storeIdOrName)) {
      groupedRecsCache.delete(key);
    }
  }
}
