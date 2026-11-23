// lib/ppc/recommendation-cache.ts
import { getDatabaseClient } from "@/lib/db";
import type { getGroupedRecommendations } from "@/lib/ppc/sku-architecture-service";
import { getReadyRedisClient, invalidateCachePattern } from "@/lib/redis";

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

/**
 * Kênh Redis báo "cache Auto Bid của store X vừa bị xoá". Tiến trình web (lib/ppc/auto-bid-prewarm.ts) nghe kênh này để
 * xoá bản trong bộ nhớ của chính nó rồi tính sẵn lại ở nền — kể cả khi việc xoá xảy ra ở worker nạp báo cáo.
 */
export const AUTO_BID_INVALIDATION_CHANNEL = "ppc:autobid:invalidated";

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
  // v3: đề xuất có số impressions theo target.
  return `ppc:recommendations:${teamId}:${encodeURIComponent(storeName)}:${days}:${includePaused ? 1 : 0}:v3`;
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

/**
 * Xoá bản trong bộ nhớ của tiến trình này. Có store → chỉ khoá của store đó (theo id hoặc tên) và khoá "ALL"
 * (gộp mọi store nên cũng cũ đi); không có store / "ALL" → xoá hết.
 */
export function dropMemoryGroupedRecommendations(storeIdOrName?: string | null): void {
  if (!storeIdOrName || storeIdOrName === "ALL") {
    groupedRecsCache.clear();
    return;
  }
  const needle = storeIdOrName.toLowerCase();
  for (const key of groupedRecsCache.keys()) {
    // teamId \0 storeId \0 storeName \0 days \0 paused [\0 channel]
    const [, storeId = "", storeName = ""] = key.split("\0");
    if (storeId.toLowerCase() === needle || storeName.toLowerCase() === needle || storeName === "ALL") {
      groupedRecsCache.delete(key);
    }
  }
}

function escapeRedisGlob(value: string): string {
  return value.replace(/[*?[\]\\]/g, "\\$&");
}

async function resolvePpcStore(storeIdOrName: string): Promise<{ id: string; name: string } | null> {
  const sql = await getDatabaseClient();
  const rows = await sql<Array<{ id: string; name: string }>>`
    SELECT id::text AS id, name FROM ppc_stores
    WHERE id::text = ${storeIdOrName} OR lower(name) = lower(${storeIdOrName})
    ORDER BY created_at ASC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Xoá cache Auto Bid trong Redis rồi báo tiến trình web tính sẵn lại. Có store → chỉ khoá của store đó + khoá "ALL";
 * trước đây sửa giá vốn 1 store cũng xoá cache mọi store (audit 2026-11-18: sync Bảng mã sáng nào cũng xoá sạch).
 * Không xác định được store → xoá hết như cũ cho an toàn (không để đề xuất bid cũ).
 */
export async function invalidateGroupedRecommendationsRedis(storeIdOrName?: string | null): Promise<void> {
  const store = storeIdOrName && storeIdOrName !== "ALL"
    ? await resolvePpcStore(storeIdOrName).catch(() => null)
    : null;
  if (store) {
    await invalidateCachePattern(`ppc:recommendations:*:${escapeRedisGlob(encodeURIComponent(store.name))}:*`);
    await invalidateCachePattern("ppc:recommendations:*:ALL:*");
  } else {
    await invalidateCachePattern("ppc:recommendations:*");
  }
  try {
    const redis = await getReadyRedisClient();
    await redis?.publish(AUTO_BID_INVALIDATION_CHANNEL, JSON.stringify({ storeId: store?.id ?? null }));
  } catch {
    // Không báo được thì lần mở tab sau tự tính lại như trước.
  }
}

export function invalidateGroupedRecommendationsCache(storeIdOrName?: string): void {
  dropMemoryGroupedRecommendations(storeIdOrName);
  void invalidateGroupedRecommendationsRedis(storeIdOrName);
}
