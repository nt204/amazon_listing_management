// lib/ppc/auto-bid-prewarm.ts
//
// Tính sẵn đề xuất Auto Bid (cả store, kỳ 30 ngày, không gồm camp paused) ở nền để người mở tab đầu tiên không phải chờ
// 3–40 s. Chạy THEO SỰ KIỆN, không có vòng lặp định kỳ:
//   1. App khởi động (sau deploy): chỉ store nào chưa có cache trong Redis (bình thường Redis vẫn còn → không tốn gì).
//   2. Cache của store bị xoá (worker nạp báo cáo xong, sửa giá vốn / Max Bid / rule…): nghe kênh Redis
//      AUTO_BID_INVALIDATION_CHANNEL, đợi DEBOUNCE_MS không có thay đổi mới rồi tính lại 1 lần cho store đó.
// Mỗi lúc chỉ tính 1 store. Trang FBA / FBM của tab Auto Bid lọc từ kết quả cả store này (HIT_FULL_FILTERED).
// Tắt bằng PPC_AUTO_BID_PREWARM=off.
import "server-only";

import type Redis from "ioredis";
import { getDatabaseClient, type DataScope } from "@/lib/db";
import { getCachedOrFetch, getReadyRedisClient, getRedisClient } from "@/lib/redis";
import { listTargetRowsForRecommendations } from "./repository";
import { getGroupedRecommendations } from "./sku-architecture-service";
import {
  AUTO_BID_INVALIDATION_CHANNEL,
  dropMemoryGroupedRecommendations,
  groupedRecommendationsCacheKey,
  groupedRecommendationsRedisKey,
  RECOMMENDATION_REDIS_TTL_SECONDS,
  setCachedGroupedRecommendations,
} from "./recommendation-cache";

type GroupedResult = Awaited<ReturnType<typeof getGroupedRecommendations>>;
interface PrewarmStore { id: string; name: string; teamId: string }

const PREWARM_DAYS = 30;
const START_DELAY_MS = 60_000; // sau prewarm Manual Bid (20 s) để hai việc nặng không chạy cùng lúc ngay khi khởi động
const DEBOUNCE_MS = Math.max(10_000, Number(process.env.PPC_AUTO_BID_PREWARM_DEBOUNCE_MS || 120_000));
const ALL_STORES = "*";

const state = globalThis as typeof globalThis & {
  autoBidPrewarm?: {
    started: boolean;
    subscriber: Redis | null;
    timers: Map<string, NodeJS.Timeout>;
    queue: Map<string, PrewarmStore>;
    running: boolean;
    invalidatedAt: Map<string, number>;
    inflight: Map<string, Promise<GroupedResult | null>>;
  };
};
const s = state.autoBidPrewarm ??= {
  started: false,
  subscriber: null,
  timers: new Map(),
  queue: new Map(),
  running: false,
  invalidatedAt: new Map(),
  inflight: new Map(),
};

/**
 * Tính (hoặc đọc Redis) đề xuất cả store — dùng chung cho route /api/ppc/recommendations/grouped và prewarm để
 * hai bên ghi đúng một khoá Redis, cùng một cách tính.
 */
export function loadFullStoreRecommendations(
  scope: DataScope,
  store: { id: string; name: string },
  days: number,
  includePaused: boolean,
): Promise<GroupedResult> {
  const redisKey = groupedRecommendationsRedisKey(scope.teamId, store.name, days, includePaused);
  return getCachedOrFetch(redisKey, RECOMMENDATION_REDIS_TTL_SECONDS, async () => {
    // Fetch the complete eligible set in one database pass (OFFSET batches re-sorted large snapshots).
    const targetRows = await listTargetRowsForRecommendations(
      scope,
      { storeName: store.name, days, includePaused },
      { unbounded: true },
    );
    return getGroupedRecommendations(store.id, targetRows, days);
  });
}

/** Prewarm đang tính đúng khoá này thì đợi nó xong thay vì tính song song lần nữa (null = không có / bị huỷ). */
export function awaitAutoBidPrewarm(redisKey: string): Promise<GroupedResult | null> | null {
  return s.inflight.get(redisKey) ?? null;
}

async function listPrewarmStores(storeId?: string): Promise<PrewarmStore[]> {
  const sql = await getDatabaseClient();
  return sql<PrewarmStore[]>`
    SELECT DISTINCT s.id::text AS id, s.name, s.team_id AS "teamId"
    FROM ppc_stores s
    JOIN ppc_active_snapshots a ON a.store_id = s.id AND a.coverage_days = ${PREWARM_DAYS}
    ${storeId ? sql`WHERE s.id::text = ${storeId}` : sql``}
    ORDER BY s.name
  `;
}

function lastInvalidated(storeId: string): number {
  return Math.max(s.invalidatedAt.get(storeId) ?? 0, s.invalidatedAt.get(ALL_STORES) ?? 0);
}

async function warmOne(store: PrewarmStore): Promise<void> {
  const scope: DataScope = { teamId: store.teamId, actorId: "system:auto-bid-prewarm" };
  const redisKey = groupedRecommendationsRedisKey(store.teamId, store.name, PREWARM_DAYS, false);
  const started = Date.now();
  const run = (async (): Promise<GroupedResult | null> => {
    const result = await loadFullStoreRecommendations(scope, store, PREWARM_DAYS, false);
    if (lastInvalidated(store.id) > started) {
      // Bị xoá cache trong lúc đang tính → kết quả có thể cũ: bỏ, tính lại sau đợt debounce kế tiếp.
      const redis = await getReadyRedisClient();
      await redis?.del(redisKey).catch(() => 0);
      return null;
    }
    setCachedGroupedRecommendations(
      groupedRecommendationsCacheKey(store.teamId, store.id, store.name, PREWARM_DAYS, false),
      result,
    );
    return result;
  })();
  s.inflight.set(redisKey, run);
  try {
    const result = await run;
    const ms = Date.now() - started;
    if (result && ms > 200) console.log(`[auto-bid] prewarm ${store.name} ${PREWARM_DAYS}d: ${result.totalSkus} SKU, ${ms}ms`);
    if (!result) schedule(store.id);
  } catch (error) {
    console.warn("[auto-bid] prewarm failed", store.name, error);
  } finally {
    if (s.inflight.get(redisKey) === run) s.inflight.delete(redisKey);
  }
}

async function drainQueue(): Promise<void> {
  if (s.running) return;
  s.running = true;
  try {
    while (s.queue.size > 0) {
      const [id, store] = s.queue.entries().next().value!;
      s.queue.delete(id);
      await warmOne(store);
    }
  } finally {
    s.running = false;
  }
}

function enqueue(stores: PrewarmStore[]): void {
  for (const store of stores) s.queue.set(store.id, store);
  void drainQueue();
}

/** Đợi DEBOUNCE_MS không có thay đổi mới của store (hoặc mọi store) rồi mới tính lại. */
function schedule(storeId: string | null): void {
  const key = storeId ?? ALL_STORES;
  const existing = s.timers.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    s.timers.delete(key);
    listPrewarmStores(storeId ?? undefined)
      .then(enqueue)
      .catch((error) => console.warn("[auto-bid] prewarm list stores failed", error));
  }, DEBOUNCE_MS);
  timer.unref?.();
  s.timers.set(key, timer);
}

async function warmMissingStores(): Promise<void> {
  const redis = await getReadyRedisClient();
  if (!redis) return;
  const stores = await listPrewarmStores();
  const missing: PrewarmStore[] = [];
  for (const store of stores) {
    const exists = await redis.exists(groupedRecommendationsRedisKey(store.teamId, store.name, PREWARM_DAYS, false));
    if (!exists) missing.push(store);
  }
  if (missing.length > 0) enqueue(missing);
}

async function subscribeInvalidations(): Promise<void> {
  const base = getRedisClient();
  if (!base) return;
  const subscriber = base.duplicate();
  subscriber.on("error", () => { /* mất kết nối: ioredis tự nối lại và tự đăng ký lại kênh */ });
  subscriber.on("message", (_channel: string, message: string) => {
    let storeId: string | null = null;
    try {
      storeId = (JSON.parse(message) as { storeId?: string | null }).storeId || null;
    } catch {
      return;
    }
    s.invalidatedAt.set(storeId ?? ALL_STORES, Date.now());
    // Việc xoá có thể xảy ra ở tiến trình khác (worker nạp báo cáo) → xoá cả bản trong bộ nhớ của tiến trình này.
    dropMemoryGroupedRecommendations(storeId);
    schedule(storeId);
  });
  await subscriber.subscribe(AUTO_BID_INVALIDATION_CHANNEL);
  s.subscriber = subscriber;
}

export function startAutoBidPrewarm(): void {
  if (process.env.PPC_AUTO_BID_PREWARM === "off" || s.started) return;
  s.started = true;
  subscribeInvalidations().catch((error) => console.warn("[auto-bid] subscribe failed", error));
  const timer = setTimeout(() => {
    warmMissingStores().catch((error) => console.warn("[auto-bid] startup prewarm failed", error));
  }, START_DELAY_MS);
  timer.unref?.();
}
