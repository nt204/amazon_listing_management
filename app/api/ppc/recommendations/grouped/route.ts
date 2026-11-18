// app/api/ppc/recommendations/grouped/route.ts
import { compressedJson } from "@/lib/compressed-json";
import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { listTargetRowsForRecommendations } from "@/lib/ppc/repository";
import { getGroupedRecommendations, resolveStoreId } from "@/lib/ppc/sku-architecture-service";
import { awaitAutoBidPrewarm, loadFullStoreRecommendations } from "@/lib/ppc/auto-bid-prewarm";
import { attachSearchVolumes } from "@/lib/ppc/search-volume";
import { getDatabaseClient } from "@/lib/db";

import {
  groupedRecommendationsCacheKey,
  groupedRecommendationsRedisKey,
  RECOMMENDATION_REDIS_TTL_SECONDS,
  getCachedGroupedRecommendations,
  setCachedGroupedRecommendations,
} from "@/lib/ppc/recommendation-cache";
import { getCachedOrFetch, getReadyRedisClient, invalidateCachePattern } from "@/lib/redis";
import { loadSkuChannels } from "@/lib/ppc/sku-channels";

export const runtime = "nodejs";
const RECOMMENDATION_CACHE_TTL_SECONDS = RECOMMENDATION_REDIS_TTL_SECONDS;

type GroupedResult = Awaited<ReturnType<typeof getGroupedRecommendations>>;
type ChannelPage = "FBA" | "FBM" | "OTHER";

function parseChannelPage(value: string | null): ChannelPage | null {
  const v = (value || "").trim().toUpperCase();
  return v === "FBA" || v === "FBM" || v === "OTHER" ? v : null;
}

/** Lọc kết quả cả store xuống một trang FBA / FBM / Khác (khi cache cả store đã có sẵn). */
function filterResultBySku(result: GroupedResult, keep: (sku: string) => boolean): GroupedResult {
  const groups = result.groups.filter((g) => keep(g.sku.toUpperCase()));
  const allRecommendations = result.allRecommendations.filter((r) => keep((r.sku || "UNKNOWN").toUpperCase()));
  return { groups, allRecommendations, totalRecommendations: allRecommendations.length, totalSkus: groups.length };
}

/**
 * Đọc cache cả store (bộ nhớ hoặc Redis) mà không tính lại. Prewarm nền đang tính đúng khoá này thì đợi nó.
 * Đọc từ Redis thì giữ luôn trong bộ nhớ: trang FBA / FBM lọc từ bản cả store, không phải giải mã JSON lớn mỗi lần.
 */
async function peekFullResult(cacheKey: string, redisKey: string): Promise<GroupedResult | null> {
  const memory = getCachedGroupedRecommendations(cacheKey);
  if (memory) return memory;
  const warming = awaitAutoBidPrewarm(redisKey);
  if (warming) {
    const warmed = await warming.catch(() => null);
    if (warmed) return warmed;
  }
  try {
    const redis = await getReadyRedisClient();
    const raw = redis ? await redis.get(redisKey) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GroupedResult;
    setCachedGroupedRecommendations(cacheKey, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const started = performance.now();
  try {
    const scope = dataScope(await authorize(request, "read", "ppc"));
    const { searchParams } = new URL(request.url);
    const storeName = searchParams.get("storeName") || "ALL";
    const sku = searchParams.get("sku") || "ALL";
    const refresh = searchParams.get("refresh") === "1" || searchParams.get("refresh") === "true";
    const summaryOnly = searchParams.get("summary") === "1";
    const days = Number(searchParams.get("days") || 30);
    const includePaused = searchParams.get("includePaused") === "1" || searchParams.get("includePaused") === "true";

    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      throw new ApiError("Số ngày đánh giá recommendation phải là số nguyên từ 1 đến 3650.", 400);
    }
    if (storeName.length > 80 || sku.length > 200) {
      throw new ApiError("Bộ lọc recommendation không hợp lệ.", 400);
    }

    const storeId = await resolveStoreId(searchParams.get("storeId") || (storeName !== "ALL" ? storeName : null));
    const normalizedSku = sku.trim().toUpperCase();

    // Store có Bảng mã FBM (FASTPEACE): tab Auto Bid chỉ tính trang đang xem (channel=FBA|FBM|OTHER) —
    // trang FBA ~10% target nên mở nhanh; bấm sang FBM mới tính FBM. Chi tiết 1 SKU tính theo trang của SKU đó.
    // Không có channel (Manual Bid, bot Lark) → tính cả store như cũ.
    const channelOf = storeName !== "ALL" ? await loadSkuChannels(storeId).catch(() => null) : null;
    const hasChannels = Boolean(channelOf?.hasFbm);
    const pageOf = (s: string): ChannelPage => {
      const c = channelOf?.get(s) || "";
      return c === "FBA" ? "FBA" : c === "FBM" ? "FBM" : "OTHER";
    };
    const requestedPage = parseChannelPage(searchParams.get("channel"));
    const channelPage: ChannelPage | null = hasChannels && requestedPage
      ? (normalizedSku !== "ALL" ? pageOf(normalizedSku) : requestedPage)
      : null;
    const inPage = (s: string) => channelPage !== null && pageOf(s) === channelPage;

    // Each attribution window must have an isolated cache entry. Reusing the
    // 30-day result for a 7-day request can produce unsafe bid decisions.
    const fullCacheKey = groupedRecommendationsCacheKey(scope.teamId, storeId, storeName, days, includePaused);
    const fullRedisKey = groupedRecommendationsRedisKey(scope.teamId, storeName, days, includePaused);
    const cacheKey = channelPage ? `${fullCacheKey}\0${channelPage}` : fullCacheKey;
    const redisKey = channelPage ? `${fullRedisKey}:ch=${channelPage}` : fullRedisKey;
    if (refresh) {
      await invalidateCachePattern(fullRedisKey);
      await invalidateCachePattern(`${fullRedisKey}:ch=*`);
    }

    let result: GroupedResult;
    let cacheStatus = "SHARED_OR_COMPUTE";
    const cached = refresh ? null : getCachedGroupedRecommendations(cacheKey);
    const fullCached = !cached && channelPage && !refresh ? await peekFullResult(fullCacheKey, fullRedisKey) : null;

    let computed = false;
    if (cached) {
      result = cached;
      cacheStatus = "HIT_MEMORY";
    } else if (fullCached) {
      // Cache cả store đã có (vd vừa mở Manual Bid) → lọc ngay, không tính lại, không lưu thêm bản sao.
      result = filterResultBySku(fullCached, inPage);
      cacheStatus = "HIT_FULL_FILTERED";
    } else if (!channelPage) {
      // Cả store: cùng hàm / cùng khoá Redis với prewarm nền; prewarm đang tính thì đợi nó thay vì tính lần nữa.
      computed = true;
      result = (refresh ? null : await awaitAutoBidPrewarm(redisKey)?.catch(() => null))
        ?? await loadFullStoreRecommendations(scope, { id: storeId, name: storeName }, days, includePaused);
    } else {
      computed = true;
      result = await getCachedOrFetch(redisKey, RECOMMENDATION_CACHE_TTL_SECONDS, async () => {
        // Fetch the complete eligible set in one database pass. OFFSET batches
        // repeatedly scanned and sorted large snapshots, causing big stores to
        // time out before Auto Bid could render any data.
        const targetRows = await listTargetRowsForRecommendations(
          scope,
          { storeName, days, includePaused },
          { unbounded: true },
        );
        return getGroupedRecommendations(storeId, targetRows, days, channelPage ? { skuFilter: inPage } : {});
      });
    }
    if (computed) setCachedGroupedRecommendations(cacheKey, result);

    // Tab Auto Bid (có channel): không tích "Camp Paused" thì ẩn SKU không còn target nào đang chạy.
    if (channelPage && !includePaused) {
      const activeSkus = new Set(result.groups.filter((g) => (g.activeTargetCount ?? 0) > 0).map((g) => g.sku.toUpperCase()));
      result = filterResultBySku(result, (s) => activeSkus.has(s));
    }

    const skuRecommendations = result.allRecommendations.filter(
      (recommendation) => (recommendation.sku || "").toUpperCase() === normalizedSku,
    );
    // Chi tiết 1 SKU: gắn SV / Organic rank / Sponsored rank cho từng target (ít dòng, không đi qua cache).
    let skuRecommendationsWithVolume: typeof skuRecommendations = skuRecommendations;
    if (normalizedSku !== "ALL" && !summaryOnly && skuRecommendations.length > 0) {
      try {
        const asin = result.groups.find((group) => group.sku.toUpperCase() === normalizedSku)?.asin || null;
        const sql = await getDatabaseClient();
        const enriched = await attachSearchVolumes(
          sql,
          skuRecommendations.map((rec) => ({ ...rec, impressions: 0, asin })),
          {
            keywordOf: (rec) => (rec.targetType === "PRODUCT" ? null : rec.keyword),
            coverageDaysOf: () => days,
            shareApplies: () => false,
          },
        );
        skuRecommendationsWithVolume = skuRecommendations.map((rec, index) => ({
          ...rec,
          searchVolume: enriched[index].searchVolume,
          searchVolumeTrend: enriched[index].searchVolumeTrend,
          organicRank: enriched[index].organicRank,
          sponsoredRank: enriched[index].sponsoredRank,
        }));
      } catch (error) {
        console.warn("[recommendations/grouped] attach search volume failed", error);
      }
    }
    const filteredResult = normalizedSku === "ALL"
      ? result
      : {
        ...result,
        groups: result.groups.filter((group) => group.sku.toUpperCase() === normalizedSku),
        allRecommendations: skuRecommendationsWithVolume,
        totalRecommendations: skuRecommendations.length,
        totalSkus: result.groups.some((group) => group.sku.toUpperCase() === normalizedSku) ? 1 : 0,
      };

    // Trang FBA / FBM / Khác giống tab Manual Bid: kênh của từng SKU theo Bảng mã (FBM > FBA > "") + số SKU
    // mỗi trang (theo danh sách SKU economics của store, dùng cache chung 1 giờ) cho nút chuyển trang.
    const withChannels = hasChannels && channelOf
      ? {
        ...filteredResult,
        hasChannels: true,
        channelPage,
        // Số SKU của trang vừa tải (trang khác chưa tải thì giao diện chưa có số).
        pageCount: channelPage ? filteredResult.groups.length : null,
        groups: filteredResult.groups.map((g) => ({ ...g, channel: channelOf.get(g.sku) })),
      }
      : { ...filteredResult, hasChannels: false, channelPage: null, pageCount: null };

    const responseData = {
      success: true,
      recommendationWindowDays: days,
      data: summaryOnly ? { ...withChannels, allRecommendations: [] } : withChannels,
    };
    const body = JSON.stringify(responseData);
    return compressedJson(request, body, {
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
