// lib/ppc/recommendation-cache.ts
import type { getGroupedRecommendations } from "@/lib/ppc/sku-architecture-service";
import { invalidateCachePattern } from "@/lib/redis";

interface CachedGroupedRecs {
  expiresAt: number;
  result: Awaited<ReturnType<typeof getGroupedRecommendations>>;
}

const groupedRecsCache = new Map<string, CachedGroupedRecs>();

/**
 * Đề xuất Auto Bid chỉ đổi khi có snapshot mới (crawler ~1 lần/ngày) hoặc sửa Cost Master / Max Bid / Bảng mã / rule —
 * các chỗ đó đều xoá cache (invalidateGroupedRecommendationsCache, syncPpcReportsFromR2). Redis giữ 24 giờ để không
 * phải tính lại ~7s mỗi 10 phút; bộ nhớ tiến trình vẫn 10 phút (bản đã giải mã ~vài chục MB, không tích luỹ lâu).
 */
export const RECOMMENDATION_REDIS_TTL_SECONDS = 24 * 60 * 60;

export function groupedRecommendationsCacheKey(
  teamId: string,
  storeId: string,
  storeName: string,
  days: number,
  includePaused = false,
): string {
  return `${teamId}\0${storeId}\0${storeName}\0${days}\0${includePaused ? 1 : 0}`;
}

export function groupedRecommendationsRedisKey(
  teamId: string,
  storeName: string,
  days: number,
  includePaused = false,
): string {
  // v2: nhóm SKU có activeTargetCount (tab Auto Bid ẩn SKU không còn target chạy).
  return `ppc:recommendations:${teamId}:${encodeURIComponent(storeName)}:${days}:${includePaused ? 1 : 0}:v2`;
}

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
  } else {
    for (const key of groupedRecsCache.keys()) {
      if (key.includes(storeIdOrName)) {
        groupedRecsCache.delete(key);
      }
    }
  }
  // Cost/rule/data mutations do not always have the team id and store name at
  // this layer. These mutations are infrequent, so clear the recommendation
  // namespace to guarantee no process serves stale executable bid advice.
  void invalidateCachePattern("ppc:recommendations:*");
}
