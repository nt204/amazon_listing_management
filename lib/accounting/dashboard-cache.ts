import "server-only";

import { keyedSingleFlight } from "@/lib/async-cache";
import { getDatabaseClient } from "@/lib/db";
import { getReadyRedisClient, invalidateCachePattern } from "@/lib/redis";

// Cache Dashboard kế toán.
//
// Mỗi giá trị cache mang "dấu phiên bản" (stamp) thay vì nằm trong tên key:
//   - tháng gần đây (≤ RECENT_DAYS ngày) / dữ liệu theo khoảng: stamp = phiên bản dữ liệu (migration 123/125, tăng sau
//     mọi lệnh ghi) + ngày hiện tại của DB (listFbaDaily lọc date < CURRENT_DATE nên qua ngày là số đổi);
//   - tháng cũ hơn: stamp = phiên bản dữ liệu cũ (migration 145, chỉ tăng khi dữ liệu > 35 ngày thật sự đổi),
//     crawler ghi đơn / ads mới không làm nguội các tháng này.
// Stamp lệch = cũ: nếu bản cũ mới tính trong STALE_MAX_MS thì trả ngay bản cũ và tính lại ngầm (stale-while-revalidate),
// không thì tính lại rồi mới trả. force (nút Refresh) luôn tính lại.

export const DASHBOARD_CACHE_PREFIX = "acc:dashboard:v2:";
/** Cửa sổ "tháng gần đây": phải lớn hơn ngưỡng 35 ngày của trigger migration 145. */
export const RECENT_DAYS = 40;
const STALE_MAX_MS = 15 * 60_000;
const ENTRY_TTL_SECONDS = 7 * 86_400;

export interface DashboardCacheScope {
  /** Prefix cũ có phiên bản dữ liệu (giữ cho key không theo tháng). */
  prefix: string;
  ttl: number;
  /** null = DB chưa có migration 123 → stamp theo khung 5 phút. */
  dataVersion: string | null;
  /** null = DB chưa có migration 145 → tháng cũ cũng theo phiên bản dữ liệu (như trước). */
  historyVersion: string | null;
  /** CURRENT_DATE của DB (YYYY-MM-DD). */
  today: string;
  /** Nút Refresh: bỏ qua cache, tính lại. */
  force: boolean;
}

const DASHBOARD_CACHE_TTL_SECONDS = 3600;
const DASHBOARD_CACHE_FALLBACK_TTL_SECONDS = 300;

export async function getDashboardCacheScope(force = false): Promise<DashboardCacheScope> {
  const sql = await getDatabaseClient();
  const localToday = new Date().toISOString().slice(0, 10);
  let dataVersion: string | null = null;
  let today = localToday;
  try {
    const rows = await sql<{ v: string; today: string }[]>`
      SELECT last_value::text || CASE WHEN is_called THEN '' ELSE '*' END AS v, CURRENT_DATE::text AS today
      FROM accounting_dashboard_data_version
    `;
    dataVersion = rows[0].v;
    today = rows[0].today;
  } catch {
    // chưa có migration 123
  }
  let historyVersion: string | null = null;
  try {
    const rows = await sql<{ v: string }[]>`
      SELECT last_value::text || CASE WHEN is_called THEN '' ELSE '*' END AS v FROM accounting_dashboard_history_version
    `;
    historyVersion = rows[0].v;
  } catch {
    // chưa có migration 145
  }
  return dataVersion
    ? { prefix: `${DASHBOARD_CACHE_PREFIX}d${dataVersion}:`, ttl: DASHBOARD_CACHE_TTL_SECONDS, dataVersion, historyVersion, today, force }
    : { prefix: DASHBOARD_CACHE_PREFIX, ttl: DASHBOARD_CACHE_FALLBACK_TTL_SECONDS, dataVersion, historyVersion, today, force };
}

/** Xóa toàn bộ cache Dashboard (sau khi import dữ liệu kế toán). */
export async function invalidateAccountingDashboardCache(): Promise<void> {
  await invalidateCachePattern(`${DASHBOARD_CACHE_PREFIX}*`);
}

/** Stamp cho dữ liệu "mới": phiên bản dữ liệu + ngày của DB (không có phiên bản → khung 5 phút). */
export function recentStamp(cache: DashboardCacheScope): string {
  return `d${cache.dataVersion ?? `t${Math.floor(Date.now() / 300_000)}`}:${cache.today}`;
}

interface Stamped<T> {
  s: string;
  at: number;
  v: T;
}

const syncLoads = new Map<string, Promise<unknown>>();
const backgroundLoads = new Map<string, Promise<unknown>>();

async function readMany<T>(keys: string[]): Promise<(Stamped<T> | null)[]> {
  const redis = await getReadyRedisClient();
  if (!redis || !keys.length) return keys.map(() => null);
  try {
    const raw = await redis.mget(...keys);
    return raw.map((r) => {
      if (!r) return null;
      try {
        return JSON.parse(r) as Stamped<T>;
      } catch {
        return null;
      }
    });
  } catch {
    return keys.map(() => null);
  }
}

async function writeMany<T>(entries: { key: string; stamp: string; value: T }[]): Promise<void> {
  const redis = await getReadyRedisClient();
  if (!redis || !entries.length) return;
  try {
    const at = Date.now();
    const pipe = redis.pipeline();
    for (const e of entries) pipe.set(e.key, JSON.stringify({ s: e.stamp, at, v: e.value }), "EX", ENTRY_TTL_SECONDS);
    await pipe.exec();
  } catch {
    // bỏ qua lỗi ghi Redis
  }
}

/**
 * Nhiều phần (vd các tháng) cache riêng, tính gộp: lấy từ Redis phần còn hợp lệ, phần thiếu / quá cũ tính qua
 * computeMissing (1 lần cho cả nhóm, vd 1 truy vấn cho các tháng liền nhau), phần cũ nhưng mới tính gần đây thì
 * trả bản cũ và tính lại ngầm.
 */
export async function stampedParts<T>(
  cache: DashboardCacheScope,
  parts: { id: string; key: string; stamp: string }[],
  /** Tính các phần còn thiếu; trả Map id → giá trị cho đúng các id được hỏi. */
  computeMissing: (ids: string[]) => Promise<Map<string, T>>,
  /** Khoá gộp single-flight của cùng nhóm (vd store + kênh). */
  groupKey: string,
): Promise<Map<string, T>> {
  const entries = await readMany<T>(parts.map((p) => p.key));
  const out = new Map<string, T>();
  const needSync: string[] = [];
  const needBackground: string[] = [];
  const now = Date.now();
  parts.forEach((p, i) => {
    const e = entries[i];
    if (!cache.force && e && e.s === p.stamp) out.set(p.id, e.v);
    else if (!cache.force && e && now - e.at < STALE_MAX_MS) {
      out.set(p.id, e.v);
      needBackground.push(p.id);
    } else needSync.push(p.id);
  });

  const byId = new Map(parts.map((p) => [p.id, p]));
  const compute = async (ids: string[]) => {
    const values = await computeMissing(ids);
    await writeMany(ids.filter((id) => values.has(id)).map((id) => ({ key: byId.get(id)!.key, stamp: byId.get(id)!.stamp, value: values.get(id)! })));
    return values;
  };

  if (needSync.length) {
    const values = await keyedSingleFlight(syncLoads, `${groupKey}|${needSync.join(",")}`, () => compute(needSync));
    for (const id of needSync) if (values.has(id)) out.set(id, values.get(id)!);
  }
  if (needBackground.length) {
    // Tính lại ngầm, không chờ; mỗi nhóm chỉ 1 lượt chạy cùng lúc
    void keyedSingleFlight(backgroundLoads, `${groupKey}|${needBackground.join(",")}`, () => compute(needBackground)).catch(
      (err) => console.warn("[dashboard-cache] background refresh failed:", err),
    );
  }
  return out;
}

/** 1 giá trị cache có stamp (cùng quy tắc stale-while-revalidate). */
export async function stampedValue<T>(cache: DashboardCacheScope, key: string, stamp: string, compute: () => Promise<T>): Promise<T> {
  const values = await stampedParts<T>(cache, [{ id: "v", key, stamp }], async () => new Map([["v", await compute()]]), key);
  return values.get("v") as T;
}
