// lib/ppc/search-volume.ts
// Search volume (Helium 10) cho Target / Search Term:
// - Cerebro theo nhóm ASIN đang chạy ads → mỗi lượt trả hàng trăm keyword kèm volume (nguồn chính)
// - Magnet theo từng keyword để lấp các keyword tốn spend nhất còn thiếu
// Volume được cache trong keyword_search_volumes, làm mới theo tháng lịch: dữ liệu lấy trước ngày 1 của tháng này
// coi như cũ → lượt chạy đầu tháng quét lại toàn bộ (khớp chu kỳ hạn mức Cerebro/Magnet, cũng tính theo tháng lịch).
import { ApiError } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import {
  getHelium10PlaywrightConfig,
  mineHelium10Keywords,
  validateHelium10Session,
  type Helium10KeywordItem,
} from "@/lib/helium10-playwright";

type Sql = Awaited<ReturnType<typeof getDatabaseClient>>;
type Marketplace = "US" | "UK" | "DE" | "JP" | "CA";

const envInt = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
};

const LOOKBACK_DAYS = envInt("PPC_SEARCH_VOLUME_LOOKBACK_DAYS", 60);
const CEREBRO_ASINS_PER_CALL = Math.max(1, envInt("PPC_SEARCH_VOLUME_ASINS_PER_CALL", 10));
// Số keyword tối đa đọc về mỗi lượt (nhiều trang, không tốn thêm lượt H10). Trước đây chỉ 1.000 dòng cho 10 ASIN →
// 1.457 lượt tháng 11 dừng đúng ở 998–1.000 dòng, keyword target như "gift fo wife" ở trang sau bị bỏ.
const CEREBRO_ROWS_PER_CALL = Math.max(1000, envInt("PPC_SEARCH_VOLUME_CEREBRO_ROWS", 30000));
const MAGNET_ROWS_PER_CALL = Math.max(200, envInt("PPC_SEARCH_VOLUME_MAGNET_ROWS", 2000));
// Diamond: 300 Cerebro / 150 Magnet mỗi tháng
const CEREBRO_MONTHLY_BUDGET = envInt("PPC_SEARCH_VOLUME_CEREBRO_MONTHLY_BUDGET", 300);
const MAGNET_MONTHLY_BUDGET = envInt("PPC_SEARCH_VOLUME_MAGNET_MONTHLY_BUDGET", 150);
// 0 = không giới hạn: chạy tới khi quét hết ASIN hoặc hết hạn mức tháng (checkpoint giữ phần còn lại)
const CEREBRO_PER_RUN = envInt("PPC_SEARCH_VOLUME_CEREBRO_PER_RUN", 0);
// 0 = không giới hạn mỗi lần chạy: dùng hết phần hạn mức Magnet còn lại của tháng (cron chỉ chạy 1 lần/tháng)
const MAGNET_PER_RUN = envInt("PPC_SEARCH_VOLUME_MAGNET_PER_RUN", 0);
const CALL_DELAY_MS = envInt("PPC_SEARCH_VOLUME_CALL_DELAY_MS", 1500);
// Không có heartbeat trong khoảng này → coi như process đã chết (1 lượt Cerebro chậm nhất ~4 phút)
const STALE_RUN_MINUTES = envInt("PPC_SEARCH_VOLUME_STALE_MINUTES", 15);
// ASIN lỗi được thử lại tối đa bấy nhiêu lần trong 1 tháng (lô nhỏ dần 10 → 5 → 2 → 1)
const MAX_ASIN_ATTEMPTS = 4;
const MAX_CONSECUTIVE_FAILURES = 5;

// Target không phải keyword: auto target, biểu thức asin=/category=/asin-expanded=, ASIN trần (luôn bắt đầu "B0").
// Không dùng ^b[a-z0-9]{9}$: khớp nhầm từ thường 10 ký tự như "bridesmaid", "basketball".
const NON_KEYWORD_TARGETS = /^(close-match|loose-match|substitutes|complements)$|^(asin|category)(-[a-z]+)?=|^b0[a-z0-9]{8}$|[=<>]/i;

/** Chuẩn hóa keyword để khớp giữa Amazon Ads (có "+" ở broad modifier) và Helium 10. */
export function normalizeKeyword(raw: string | null | undefined): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/\+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Khóa khớp lỏng: bỏ dấu nháy. Amazon ghi "mother's gifts", Helium 10 thường trả "mothers gifts" (có lúc giữ dấu nháy)
 * → khớp nguyên văn trước, không có số thì khớp theo khóa này. Phải trùng bộ ký tự với kw_loose() (migration 162).
 */
export function looseKeyword(norm: string): string {
  return norm.replace(/['’‘`´]/g, "");
}

const hasVolume = (value: number | null | undefined) => typeof value === "number" && value > 0;

export function isKeywordTarget(raw: string | null | undefined): boolean {
  const keyword = normalizeKeyword(raw);
  return keyword.length > 0 && !NON_KEYWORD_TARGETS.test(keyword);
}

export type KeywordVolume = {
  searchVolume: number | null;
  searchVolumeTrend: number | null;
  fetchedAt: string;
};

export async function getKeywordVolumes(
  sql: Sql,
  keywords: Array<string | null | undefined>,
  marketplace = "US",
): Promise<Map<string, KeywordVolume>> {
  const norms = Array.from(new Set(keywords.filter(isKeywordTarget).map(normalizeKeyword)));
  if (norms.length === 0) return new Map();
  const looses = Array.from(new Set(norms.map(looseKeyword)));
  const rows = await sql<Array<{
    keyword_norm: string;
    loose: string;
    search_volume: number | null;
    search_volume_trend: string | null;
    fetched_at: string;
  }>>`
    SELECT keyword_norm, kw_loose(keyword_norm) AS loose, search_volume, search_volume_trend, fetched_at::text
    FROM keyword_search_volumes
    WHERE marketplace = ${marketplace} AND kw_loose(keyword_norm) IN ${sql(looses)}
  `;
  const exact = new Map(rows.map((row) => [row.keyword_norm, row]));
  const bestLoose = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    if (!hasVolume(row.search_volume)) continue;
    const current = bestLoose.get(row.loose);
    if (!current || (row.search_volume as number) > (current.search_volume as number)) bestLoose.set(row.loose, row);
  }
  const result = new Map<string, KeywordVolume>();
  for (const norm of norms) {
    const exactRow = exact.get(norm);
    const row = exactRow && hasVolume(exactRow.search_volume) ? exactRow : bestLoose.get(looseKeyword(norm)) ?? exactRow;
    if (!row) continue;
    result.set(norm, {
      searchVolume: row.search_volume,
      searchVolumeTrend: row.search_volume_trend === null ? null : Number(row.search_volume_trend),
      fetchedAt: row.fetched_at,
    });
  }
  return result;
}

/**
 * Gắn searchVolume / searchVolumeTrend / estImpressionShare vào từng dòng.
 * estImpressionShare = impressions / (volume tháng × số ngày phủ / 30), chỉ có nghĩa khi keyword = đúng truy vấn
 * (search term, hoặc target Exact) nên các trường hợp khác để null.
 */
export async function attachSearchVolumes<T extends { impressions: number; asin?: string | null }>(
  sql: Sql,
  items: T[],
  options: {
    keywordOf: (item: T) => string | null | undefined;
    coverageDaysOf: (item: T) => number;
    shareApplies: (item: T) => boolean;
    marketplace?: string;
  },
): Promise<Array<T & {
  searchVolume: number | null;
  searchVolumeTrend: number | null;
  estImpressionShare: number | null;
  organicRank: number | null;
  sponsoredRank: number | null;
}>> {
  const mp = options.marketplace || "US";
  const volumes = await getKeywordVolumes(sql, items.map(options.keywordOf), mp);

  // Rank (organic / sponsored) là vị trí của MỘT ASIN cho một keyword → chỉ lấy đúng cặp ASIN + keyword của dòng.
  // Dòng không biết ASIN thì để trống (trước đây lấy rank của ASIN bất kỳ có cùng keyword → số của sản phẩm khác).
  const asinOf = (item: T) => (item.asin || "").trim().toUpperCase();
  const asins = Array.from(new Set(items.map(asinOf).filter(Boolean)));
  const norms = Array.from(new Set(items.filter((i) => asinOf(i)).map((i) => normalizeKeyword(options.keywordOf(i))).filter(Boolean)));
  const looses = Array.from(new Set(norms.map(looseKeyword)));
  // Khóa nguyên văn "asin:keyword" ưu tiên; "asin:~loose" là dự phòng khi chỉ khác dấu nháy
  const rankMap = new Map<string, { organicRank: number | null; sponsoredRank: number | null }>();

  if (asins.length > 0 && norms.length > 0) {
    try {
      const rankRows = await sql<Array<{
        asin: string;
        keyword_norm: string;
        organic_rank: number | null;
        sponsored_rank: number | null;
      }>>`
        SELECT asin, keyword_norm, organic_rank, sponsored_rank
        FROM ppc_asin_keyword_rankings
        WHERE marketplace = ${mp} AND asin IN ${sql(asins)} AND kw_loose(keyword_norm) IN ${sql(looses)}
      `;
      for (const row of rankRows) {
        const rank = { organicRank: row.organic_rank, sponsoredRank: row.sponsored_rank };
        rankMap.set(`${row.asin}:${row.keyword_norm}`, rank);
        const looseKey = `${row.asin}:~${looseKeyword(row.keyword_norm)}`;
        const current = rankMap.get(looseKey);
        if (!current || (current.organicRank == null && row.organic_rank != null)) rankMap.set(looseKey, rank);
      }
    } catch {}
  }

  return items.map((item) => {
    const kwNorm = normalizeKeyword(options.keywordOf(item));
    const volume = volumes.get(kwNorm);
    const searchVolume = volume?.searchVolume ?? null;
    const coverageDays = Math.max(1, options.coverageDaysOf(item));
    const expectedSearches = searchVolume ? (searchVolume * coverageDays) / 30 : 0;
    const estImpressionShare = expectedSearches > 0 && options.shareApplies(item)
      ? Math.round((item.impressions / expectedSearches) * 1000) / 10
      : null;

    const asin = asinOf(item);
    const exactRank = asin ? rankMap.get(`${asin}:${kwNorm}`) : undefined;
    const rankInfo = exactRank?.organicRank != null ? exactRank : (asin ? rankMap.get(`${asin}:~${looseKeyword(kwNorm)}`) : undefined) ?? exactRank;

    return {
      ...item,
      searchVolume,
      searchVolumeTrend: volume?.searchVolumeTrend ?? null,
      estImpressionShare,
      organicRank: rankInfo?.organicRank ?? null,
      sponsoredRank: rankInfo?.sponsoredRank ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Sync job
// ---------------------------------------------------------------------------
// Checkpoint theo từng ASIN (keyword_search_volume_asin_queries): mỗi lượt chỉ quét ASIN chưa xong trong tháng này,
// nên dừng / hết quota / server restart đều chạy tiếp được từ chỗ cũ mà không tốn lại lượt Cerebro.

export type SearchVolumeSyncRun = {
  id: string;
  team_id: string;
  store_id: string | null;
  store_name: string | null;
  status: "running" | "completed" | "failed" | "interrupted";
  cerebro_calls: number;
  magnet_calls: number;
  asins_queried: number;
  asins_total: number | null;
  asins_done: number | null;
  keywords_upserted: number;
  keywords_total: number | null;
  missing_before: number;
  missing_after: number;
  message: string | null;
  started_at: string;
  heartbeat_at: string | null;
  finished_at: string | null;
};

export type SearchVolumeCoverage = {
  // null = chưa tính được (đang gom keyword hoặc lỗi DB) — không hiển thị số đoán
  keywords: number | null;
  withVolume: number | null;
  missing: number | null;
};

export type SearchVolumeAsinCoverage = {
  total: number;
  done: number;
  pending: number;
  failed: number | null;
  withRank: number | null;
};

export type SearchVolumeStatus = {
  latestRun: SearchVolumeSyncRun | null;
  recentRuns: SearchVolumeSyncRun[];
  coverage: SearchVolumeCoverage;
  asins: SearchVolumeAsinCoverage | null;
  budget: { cerebroUsed: number; cerebroLimit: number; magnetUsed: number; magnetLimit: number };
};

async function monthlyUsage(sql: Sql) {
  // Tài khoản Helium 10 dùng chung toàn hệ thống → tính hạn mức trên mọi team
  const [row] = await sql<Array<{ cerebro: number; magnet: number }>>`
    SELECT COALESCE(SUM(cerebro_calls), 0)::integer AS cerebro, COALESCE(SUM(magnet_calls), 0)::integer AS magnet
    FROM ppc_search_volume_sync_runs
    WHERE started_at >= date_trunc('month', NOW())
  `;
  return { cerebro: row?.cerebro || 0, magnet: row?.magnet || 0 };
}

const STORE_ALIASES: Record<string, string> = {
  warmstorey: "hsostore",
};

async function resolveStores(sql: Sql, teamId: string, storeName: string) {
  const normalizedName = STORE_ALIASES[storeName.toLowerCase()] || storeName;
  const stores = await sql<Array<{ id: string; name: string; marketplace: string }>>`
    SELECT id, name, marketplace FROM ppc_stores
    WHERE team_id = ${teamId}
      ${normalizedName !== "ALL" ? sql`AND lower(name) = lower(${normalizedName})` : sql``}
  `;
  if (stores.length === 0) throw new ApiError(`Không tìm thấy store PPC "${storeName}".`, 404);
  return stores;
}

/** store_id của run: 1 store cụ thể, hoặc null khi quét ALL. */
const runScopeStoreId = (storeName: string, stores: Array<{ id: string }>) =>
  storeName.toUpperCase() === "ALL" ? null : stores[0].id;

/** Gom store theo marketplace: ASIN / keyword phải tra đúng chợ của store (ALL có thể lẫn US, UK, DE...). */
function groupStoresByMarketplace(stores: Array<{ id: string; marketplace: string }>) {
  const groups = new Map<Marketplace, string[]>();
  for (const store of stores) {
    const marketplace = (store.marketplace || "US").toUpperCase() as Marketplace;
    groups.set(marketplace, [...(groups.get(marketplace) || []), store.id]);
  }
  return groups;
}

const marketKey = (marketplace: string, keyword: string) => `${marketplace}|${keyword}`;
function splitMarketKey(key: string) {
  const sep = key.indexOf("|");
  return { marketplace: key.slice(0, sep) as Marketplace, keyword: key.slice(sep + 1) };
}

/** Keyword (target dạng keyword + search term) của các store, xếp theo spend để ưu tiên lấp volume. */
async function collectKeywordSpend(sql: Sql, storeIds: string[]) {
  const rows = await sql<Array<{ keyword: string; spend: string }>>`
    SELECT keyword, SUM(spend)::numeric AS spend FROM (
      SELECT lower(trim(p.target_expression)) AS keyword, p.spend
      FROM ppc_performance_facts p
      WHERE p.store_id IN ${sql(storeIds)}
        AND p.grain = 'TARGET'
        AND p.match_type IN ('Exact', 'Phrase', 'Broad')
        AND p.report_end_date >= CURRENT_DATE - ${LOOKBACK_DAYS}::integer
      UNION ALL
      SELECT lower(trim(t.customer_search_term)) AS keyword, t.spend
      FROM ppc_search_terms t
      WHERE t.store_id IN ${sql(storeIds)}
        AND t.report_date >= CURRENT_DATE - ${LOOKBACK_DAYS}::integer
    ) k
    GROUP BY keyword
  `;
  const spendByKeyword = new Map<string, number>();
  for (const row of rows) {
    if (!isKeywordTarget(row.keyword)) continue;
    const keyword = normalizeKeyword(row.keyword);
    spendByKeyword.set(keyword, (spendByKeyword.get(keyword) || 0) + Number(row.spend || 0));
  }
  return spendByKeyword;
}

/** Keyword (nguyên văn trong danh sách) đã có volume tháng này — khớp cả bản chỉ khác dấu nháy. */
async function findFreshKeywords(sql: Sql, keywords: string[], marketplace: string) {
  const freshLoose = new Set<string>();
  const looses = Array.from(new Set(keywords.map(looseKeyword)));
  for (let i = 0; i < looses.length; i += 5000) {
    const chunk = looses.slice(i, i + 5000);
    const rows = await sql<Array<{ loose: string }>>`
      SELECT kw_loose(keyword_norm) AS loose FROM keyword_search_volumes
      WHERE marketplace = ${marketplace}
        AND kw_loose(keyword_norm) IN ${sql(chunk)}
        AND fetched_at >= date_trunc('month', NOW())
        -- Đã có volume, hoặc Magnet đã tra trong tháng mà H10 không có số (miss) → không tra lại tới tháng sau.
        -- Volume rỗng/0 từ Cerebro vẫn được Magnet tra bù.
        AND (search_volume > 0 OR source = 'helium10_magnet_miss')
    `;
    for (const row of rows) freshLoose.add(row.loose);
  }
  return new Set(keywords.filter((keyword) => freshLoose.has(looseKeyword(keyword))));
}

type AsinQueueRow = { asin: string; attempts: number; done: boolean; failed: boolean };

/**
 * MỌI ASIN đang bật ads (không paused/archived, có trong báo cáo LOOKBACK_DAYS ngày), tiêu tiền hay không,
 * gộp mọi store cùng marketplace. Thứ tự:
 *  1. ASIN có spend trong LOOKBACK_DAYS ngày, spend cao trước (không phụ thuộc store).
 *  2. ASIN không tiêu tiền: ASIN lâu chưa quét nhất (hoặc chưa quét bao giờ) trước → khi hạn mức tháng không đủ
 *     cho tất cả, phần bị thiếu luân phiên giữa các tháng thay vì luôn là cùng những ASIN đó.
 * done = đã quét thành công trong tháng này, hoặc đã thử đủ MAX_ASIN_ATTEMPTS lần mà vẫn lỗi (bỏ qua tới tháng sau).
 */
async function loadAsinQueue(sql: Sql, storeIds: string[], marketplace: string) {
  return sql<AsinQueueRow[]>`
    WITH active AS (
      SELECT upper(p.asin) AS asin, SUM(p.spend) AS spend, MAX(p.report_end_date) AS last_date
      FROM ppc_performance_facts p
      WHERE p.store_id IN ${sql(storeIds)}
        AND p.grain = 'PRODUCT'
        AND p.asin ~* '^[A-Z0-9]{10}$'
        AND p.report_end_date >= CURRENT_DATE - ${LOOKBACK_DAYS}::integer
        AND lower(COALESCE(p.state, 'enabled')) NOT IN ('paused', 'archived')
        AND lower(COALESCE(p.campaign_state, 'enabled')) NOT IN ('paused', 'archived')
        AND lower(COALESCE(p.ad_group_state, 'enabled')) NOT IN ('paused', 'archived')
      GROUP BY upper(p.asin)
    ), checkpoint AS (
      SELECT a.asin, a.spend, a.last_date, q.status, q.queried_at,
        COALESCE(q.queried_at >= date_trunc('month', NOW()), false) AS fresh,
        COALESCE(q.attempts, 0) AS attempts
      FROM active a
      LEFT JOIN keyword_search_volume_asin_queries q ON q.marketplace = ${marketplace} AND q.asin = a.asin
    )
    SELECT asin,
      (CASE WHEN fresh THEN attempts ELSE 0 END)::integer AS attempts,
      (fresh AND (status = 'ok' OR attempts >= ${MAX_ASIN_ATTEMPTS})) AS done,
      (fresh AND status = 'failed' AND attempts >= ${MAX_ASIN_ATTEMPTS}) AS failed
    FROM checkpoint
    ORDER BY (COALESCE(spend, 0) > 0) DESC,
      CASE WHEN COALESCE(spend, 0) > 0 THEN spend END DESC NULLS LAST,
      queried_at ASC NULLS FIRST,
      last_date DESC NULLS LAST
  `;
}

/** ASIN mới gộp 10/lượt; ASIN từng lỗi chia nhỏ dần (10 → 5 → 2 → 1) để cô lập ASIN hỏng mà không đốt quota. */
function buildAsinBatches(queue: AsinQueueRow[]) {
  const batches: Array<{ asins: string[]; attempts: number }> = [];
  for (let attempts = 0; attempts < MAX_ASIN_ATTEMPTS; attempts++) {
    const group = queue.filter((row) => !row.done && row.attempts === attempts).map((row) => row.asin);
    const size = Math.max(1, CEREBRO_ASINS_PER_CALL >> attempts);
    for (let i = 0; i < group.length; i += size) batches.push({ asins: group.slice(i, i + size), attempts });
  }
  return batches;
}

async function saveAsinCheckpoint(
  sql: Sql,
  marketplace: string,
  asins: string[],
  result: { ok: true; keywordCount: number } | { ok: false; error: string },
) {
  const rows = asins.map((asin) => ({
    marketplace,
    asin,
    keyword_count: result.ok ? result.keywordCount : 0,
    status: result.ok ? "ok" : "failed",
    attempts: result.ok ? 0 : 1,
    last_error: result.ok ? null : result.error.slice(0, 500),
  }));
  await sql`
    INSERT INTO keyword_search_volume_asin_queries ${sql(rows)}
    ON CONFLICT (marketplace, asin) DO UPDATE SET
      queried_at = NOW(),
      keyword_count = EXCLUDED.keyword_count,
      status = EXCLUDED.status,
      last_error = EXCLUDED.last_error,
      attempts = CASE
        WHEN EXCLUDED.status = 'ok' THEN 0
        WHEN keyword_search_volume_asin_queries.queried_at < date_trunc('month', NOW()) THEN 1
        ELSE keyword_search_volume_asin_queries.attempts + 1
      END
  `;
}

async function upsertVolumes(sql: Sql, marketplace: string, source: string, items: Helium10KeywordItem[]) {
  const byKeyword = new Map<string, Helium10KeywordItem>();
  for (const item of items) {
    const keyword = normalizeKeyword(item.keyword);
    if (keyword) byKeyword.set(keyword, item);
  }
  const rows = Array.from(byKeyword, ([keyword_norm, item]) => ({
    marketplace,
    keyword_norm,
    keyword: item.keyword,
    search_volume: typeof item.search_volume === "number" ? Math.round(item.search_volume) : null,
    search_volume_trend: item.search_volume_trend ?? null,
    cpc: item.cpc ?? null,
    competing_products: item.competing_products ?? null,
    source,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    await sql`
      INSERT INTO keyword_search_volumes ${sql(rows.slice(i, i + 500))}
      ON CONFLICT (marketplace, keyword_norm) DO UPDATE SET
        keyword = EXCLUDED.keyword,
        search_volume = CASE
          WHEN EXCLUDED.search_volume IS NOT NULL AND EXCLUDED.search_volume > 0 THEN EXCLUDED.search_volume
          ELSE COALESCE(keyword_search_volumes.search_volume, EXCLUDED.search_volume)
        END,
        search_volume_trend = COALESCE(EXCLUDED.search_volume_trend, keyword_search_volumes.search_volume_trend),
        cpc = COALESCE(EXCLUDED.cpc, keyword_search_volumes.cpc),
        competing_products = COALESCE(EXCLUDED.competing_products, keyword_search_volumes.competing_products),
        source = CASE
          WHEN EXCLUDED.search_volume IS NOT NULL AND EXCLUDED.search_volume > 0 THEN EXCLUDED.source
          WHEN keyword_search_volumes.search_volume IS NOT NULL AND keyword_search_volumes.search_volume > 0 THEN keyword_search_volumes.source
          ELSE EXCLUDED.source
        END,
        fetched_at = CASE
          WHEN EXCLUDED.search_volume IS NOT NULL AND EXCLUDED.search_volume > 0 THEN NOW()
          WHEN keyword_search_volumes.search_volume IS NOT NULL AND keyword_search_volumes.search_volume > 0 THEN keyword_search_volumes.fetched_at
          ELSE NOW()
        END
    `;
  }
  const withVolume = Array.from(byKeyword)
    .filter(([, item]) => typeof item.search_volume === "number" && item.search_volume > 0)
    .map(([keyword]) => keyword);
  return { saved: Array.from(byKeyword.keys()), withVolume };
}

let loggedUnknownAsinRow = false;

async function upsertRankings(
  sql: Sql,
  marketplace: string,
  asins: string[],
  items: Helium10KeywordItem[],
  // Rank chỉ hiển thị cho keyword đang chạy ads → chỉ lưu keyword có spend (khóa looseKeyword), tránh phình bảng
  keepLoose?: Set<string>,
) {
  if (asins.length === 0 || items.length === 0) return;
  // Rank là của MỘT ASIN. Lượt nhiều ASIN chỉ ghi rank khi H10 cho biết dòng thuộc ASIN nào (và ASIN đó nằm trong lượt);
  // không biết thì bỏ qua, tránh gán rank của ASIN khác cho asins[0] như trước.
  const batchAsins = new Set(asins.map((a) => a.trim().toUpperCase()));
  const singleAsin = asins.length === 1 ? asins[0].trim().toUpperCase() : null;
  const rows: Array<{
    marketplace: string;
    asin: string;
    keyword_norm: string;
    keyword: string;
    organic_rank: number | null;
    sponsored_rank: number | null;
    search_volume: number | null;
    cpc: number | null;
    cpr: number | null;
    source: string;
  }> = [];

  const rowMap = new Map<string, typeof rows[0]>();
  for (const item of items) {
    const keyword_norm = normalizeKeyword(item.keyword);
    if (!keyword_norm) continue;
    if (keepLoose && !keepLoose.has(looseKeyword(keyword_norm))) continue;
    const itemAsin = item.asin ? item.asin.trim().toUpperCase() : null;
    const targetAsin = itemAsin && batchAsins.has(itemAsin) ? itemAsin : singleAsin;
    if (!targetAsin) {
      if (!loggedUnknownAsinRow) {
        loggedUnknownAsinRow = true;
        console.warn(`[Search Volume] Cerebro ${asins.length} ASIN: dòng không rõ ASIN (asin=${item.asin ?? "null"}), bỏ qua rank.`);
      }
      continue;
    }
    const key = `${marketplace}:${targetAsin}:${keyword_norm}`;
    rowMap.set(key, {
      marketplace,
      asin: targetAsin,
      keyword_norm,
      keyword: item.keyword,
      organic_rank: item.organic_rank ?? null,
      sponsored_rank: item.sponsored_rank ?? null,
      search_volume: typeof item.search_volume === "number" ? Math.round(item.search_volume) : null,
      cpc: item.cpc ?? null,
      cpr: item.cpr ?? null,
      source: "helium10_cerebro",
    });
  }
  const deduplicatedRows = Array.from(rowMap.values());

  for (let i = 0; i < deduplicatedRows.length; i += 500) {
    await sql`
      INSERT INTO ppc_asin_keyword_rankings ${sql(deduplicatedRows.slice(i, i + 500))}
      ON CONFLICT (marketplace, asin, keyword_norm) DO UPDATE SET
        keyword = EXCLUDED.keyword,
        organic_rank = EXCLUDED.organic_rank,
        sponsored_rank = EXCLUDED.sponsored_rank,
        search_volume = CASE
          WHEN EXCLUDED.search_volume IS NOT NULL AND EXCLUDED.search_volume > 0 THEN EXCLUDED.search_volume
          ELSE COALESCE(ppc_asin_keyword_rankings.search_volume, EXCLUDED.search_volume)
        END,
        cpc = EXCLUDED.cpc,
        cpr = EXCLUDED.cpr,
        source = EXCLUDED.source,
        fetched_at = NOW()
    `;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isQuotaExhaustedError = (error: unknown) => /rta-7017|not enough uses/i.test(String(error));
const isAuthError = (error: unknown) => {
  const msg = String(error).toLowerCase();
  // Lỗi phiên đăng nhập: các lượt sau chắc chắn cũng lỗi → dừng và giữ nguyên checkpoint, không đánh dấu ASIN lỗi
  return (
    /\b40[13]\b/.test(msg) ||
    msg.includes("unauthorized") ||
    msg.includes("token expired") ||
    msg.includes("invalid token") ||
    msg.includes("không thể trích xuất token") ||
    msg.includes("cookie")
  );
};

// Lỗi đường truyền / Helium 10 quá tải: không phải lỗi của ASIN → thử lại, vẫn lỗi thì tạm dừng giữ checkpoint
const isConnectionError = (error: unknown) => {
  const cause = error instanceof Error && error.cause ? ` ${String(error.cause)}` : "";
  const msg = `${error instanceof Error ? `${error.name} ${error.message}` : String(error)}${cause}`.toLowerCase();
  return (
    /\b50[0234]\b/.test(msg) ||
    /fetch failed|timeout|timed out|aborted|network|socket hang up|econnreset|econnrefused|enotfound|eai_again|etimedout/.test(msg)
  );
};

const CONNECTION_RETRY_DELAYS_MS = [10_000, 30_000];

/** Gọi Helium 10, tự thử lại khi lỗi kết nối; hết lượt thử thì ném lỗi gốc ra cho vòng quét quyết định. */
async function callHelium10<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (isAuthError(error) || !isConnectionError(error) || attempt >= CONNECTION_RETRY_DELAYS_MS.length) throw error;
      console.warn(`[Search Volume] Helium 10 connection error, retry ${attempt + 1}:`, error);
      await sleep(CONNECTION_RETRY_DELAYS_MS[attempt]);
    }
  }
}

/** Lý do dừng khi lỗi không thuộc về ASIN (phiên đăng nhập / đường truyền); null = lỗi riêng của lượt này. */
function helium10StopReason(error: unknown) {
  const errMsg = (error instanceof Error ? error.message : String(error)).slice(0, 160);
  // Helium 10 trả 403 "rta-7017 Not enough uses" khi tài khoản hết lượt — không phải lỗi cookie
  if (isQuotaExhaustedError(error)) {
    return "Tài khoản Helium 10 đã hết lượt Cerebro/Magnet (Not enough uses — lượt dùng chung với người dùng H10 khác và đặt lại theo chu kỳ thanh toán). Checkpoint giữ nguyên, chạy tiếp khi H10 có lượt mới.";
  }
  if (isAuthError(error)) return `Cookie/phiên Helium 10 không hợp lệ (${errMsg}). Cập nhật Cookie H10 rồi bấm Chạy tiếp.`;
  if (isConnectionError(error)) {
    return `Mất kết nối Helium 10 (${errMsg}), đã thử lại ${CONNECTION_RETRY_DELAYS_MS.length} lần. Checkpoint giữ nguyên, bấm Chạy tiếp khi kết nối ổn định.`;
  }
  return null;
}

/** Run chạy lâu không ghi heartbeat (process chết / server restart) → interrupted để chạy tiếp được. */
async function markStaleRuns(sql: Sql) {
  await sql`
    UPDATE ppc_search_volume_sync_runs
    SET status = 'interrupted', finished_at = NOW(),
      message = 'Tiến trình bị ngắt giữa chừng (server khởi động lại?). Checkpoint đã lưu, bấm Chạy tiếp để quét phần còn lại.'
    WHERE status = 'running'
      AND COALESCE(heartbeat_at, started_at) < NOW() - make_interval(mins => ${STALE_RUN_MINUTES})
  `;
}

/** Tạo run (chặn chạy song song vì dùng chung 1 phiên Helium 10). Trả về hàm thực thi để chạy nền. */
/**
 * mode "magnet": bỏ qua Cerebro, chỉ dùng Magnet lấp keyword thiếu volume có spend cao nhất (scripts/sync-magnet.ts).
 * magnetLimit: tối đa bấy nhiêu lượt Magnet cho lần chạy này (vẫn không vượt hạn mức tháng).
 */
export type SearchVolumeSyncOptions = { mode?: "full" | "magnet"; magnetLimit?: number };

export async function startSearchVolumeSync(input: {
  teamId: string;
  storeName: string;
  actorId?: string;
} & SearchVolumeSyncOptions) {
  const mode = input.mode || "full";
  const sql = await getDatabaseClient();
  const stores = await resolveStores(sql, input.teamId, input.storeName);
  const scopeStoreId = runScopeStoreId(input.storeName, stores);

  await markStaleRuns(sql);
  const [running] = await sql`SELECT id FROM ppc_search_volume_sync_runs WHERE status = 'running' LIMIT 1`;
  if (running) throw new ApiError("Đang có một lượt đồng bộ Search Volume chạy. Vui lòng đợi lượt đó xong.", 409);

  const usage = await monthlyUsage(sql);
  const magnetExhausted = usage.magnet >= MAGNET_MONTHLY_BUDGET;
  if (magnetExhausted && (mode === "magnet" || usage.cerebro >= CEREBRO_MONTHLY_BUDGET)) {
    throw new ApiError(
      `Đã dùng hết hạn mức Helium 10 dành cho đồng bộ tháng này (Cerebro ${usage.cerebro}/${CEREBRO_MONTHLY_BUDGET}, Magnet ${usage.magnet}/${MAGNET_MONTHLY_BUDGET}).`,
      429,
    );
  }

  // Kiểm tra phiên Helium 10 trước (chỉ lấy token, không tốn lượt Cerebro) → báo lỗi ngay thay vì chạy nền rồi mới hỏng
  const h10Config = await getHelium10PlaywrightConfig();
  const session = h10Config.cookies
    ? await validateHelium10Session(h10Config.cookies)
    : { valid: false, error: "Chưa cấu hình Cookie Helium 10" };
  if (!session.valid) {
    throw new ApiError(`Không kết nối được Helium 10: ${session.error || "phiên đăng nhập không hợp lệ"}. Kiểm tra Cookie H10 rồi thử lại.`, 424);
  }

  // Lượt trước cùng phạm vi chưa xong → ghi lại để lịch sử thấy đây là lượt chạy tiếp
  const [previous] = await sql<Array<{ id: string; status: string }>>`
    SELECT id, status FROM ppc_search_volume_sync_runs
    WHERE team_id = ${input.teamId} AND store_id IS NOT DISTINCT FROM ${scopeStoreId}
    ORDER BY started_at DESC LIMIT 1
  `;

  const [run] = await sql<Array<{ id: string }>>`
    INSERT INTO ppc_search_volume_sync_runs (team_id, store_id, created_by, message, heartbeat_at, resumed_from)
    VALUES (
      ${input.teamId}, ${scopeStoreId}, ${input.actorId || null}, 'Đang gom keyword và ASIN cần quét...', NOW(),
      ${previous && previous.status !== "completed" ? previous.id : null}
    )
    RETURNING id
  `;

  const execute = async () => {
    try {
      await runSearchVolumeSync(sql, run.id, stores, usage, { mode, magnetLimit: input.magnetLimit });
    } catch (error) {
      console.error("[Search Volume] Sync failed:", error);
      await sql`
        UPDATE ppc_search_volume_sync_runs
        SET status = 'failed', finished_at = NOW(),
          message = ${`${error instanceof Error ? error.message : String(error)} (checkpoint đã lưu, có thể chạy tiếp)`}
        WHERE id = ${run.id} AND status = 'running'
      `.catch(() => {});
    }
  };

  return { runId: run.id, execute };
}

/** Dừng tiến trình đang chạy. Checkpoint giữ nguyên → lần chạy sau quét tiếp phần còn lại. */
export async function stopSearchVolumeSync(input: { teamId: string; runId?: string }) {
  const sql = await getDatabaseClient();
  const message = "Đã dừng theo yêu cầu. Checkpoint đã lưu, bấm Chạy tiếp để quét phần còn lại.";
  const res = input.runId
    ? await sql`
        UPDATE ppc_search_volume_sync_runs
        SET status = 'interrupted', finished_at = NOW(), message = ${message}
        WHERE id = ${input.runId} AND team_id = ${input.teamId} AND status = 'running'
        RETURNING id
      `
    : await sql`
        UPDATE ppc_search_volume_sync_runs
        SET status = 'interrupted', finished_at = NOW(), message = ${message}
        WHERE team_id = ${input.teamId} AND status = 'running'
        RETURNING id
      `;
  return { stoppedCount: res.length };
}

async function runSearchVolumeSync(
  sql: Sql,
  runId: string,
  stores: Array<{ id: string; name: string; marketplace: string }>,
  usage: { cerebro: number; magnet: number },
  options: SearchVolumeSyncOptions = {},
) {
  const magnetOnly = options.mode === "magnet";
  // Mỗi marketplace quét riêng (ASIN / keyword tra đúng chợ); store cùng marketplace gộp chung 1 hàng đợi theo spend.
  // Keyword được khóa "marketplace|keyword" vì cùng một keyword ở 2 chợ là 2 volume khác nhau.
  const spendByKeyword = new Map<string, number>();
  const missing = new Set<string>();
  // Một keyword H10 có volume → xoá mọi keyword đang thiếu chỉ khác dấu nháy ("mothers gifts" lấp "mother's gifts")
  const missingByLoose = new Map<string, Set<string>>();
  const markCovered = (marketplace: string, keyword: string) => {
    const looseKey = marketKey(marketplace, looseKeyword(keyword));
    for (const key of missingByLoose.get(looseKey) ?? []) missing.delete(key);
    missingByLoose.delete(looseKey);
  };
  const batches: Array<{ asins: string[]; attempts: number; marketplace: Marketplace }> = [];
  let asinsTotal = 0;
  let asinsDone = 0;
  for (const [marketplace, storeIds] of groupStoresByMarketplace(stores)) {
    const spend = await collectKeywordSpend(sql, storeIds);
    const fresh = await findFreshKeywords(sql, Array.from(spend.keys()), marketplace);
    for (const [keyword, value] of spend) {
      const key = marketKey(marketplace, keyword);
      spendByKeyword.set(key, value);
      if (!fresh.has(keyword)) {
        missing.add(key);
        const looseKey = marketKey(marketplace, looseKeyword(keyword));
        missingByLoose.set(looseKey, (missingByLoose.get(looseKey) ?? new Set()).add(key));
      }
    }
    if (magnetOnly) continue;
    const queue = await loadAsinQueue(sql, storeIds, marketplace);
    for (const batch of buildAsinBatches(queue)) batches.push({ ...batch, marketplace });
    asinsTotal += queue.length;
    asinsDone += queue.filter((row) => row.done).length;
  }
  const spendLooseByMarket = new Map<string, Set<string>>();
  for (const key of spendByKeyword.keys()) {
    const { marketplace, keyword } = splitMarketKey(key);
    if (!spendLooseByMarket.has(marketplace)) spendLooseByMarket.set(marketplace, new Set());
    spendLooseByMarket.get(marketplace)!.add(looseKeyword(keyword));
  }
  const missingBefore = missing.size;
  const keywordsTotal = spendByKeyword.size;

  let cerebroCalls = 0;
  let magnetCalls = 0;
  let asinsQueried = 0;
  let keywordsUpserted = 0;
  const errors: string[] = [];
  let stopReason: string | null = null;

  /** Ghi tiến độ thật + heartbeat mỗi lượt. false = run đã bị dừng (người dùng bấm dừng / bị đánh dấu ngắt). */
  const tick = async (message: string, final?: { status: "completed" | "interrupted" }) => {
    const rows = await sql`
      UPDATE ppc_search_volume_sync_runs SET ${sql({
        cerebro_calls: cerebroCalls,
        magnet_calls: magnetCalls,
        asins_queried: asinsQueried,
        asins_total: asinsTotal,
        asins_done: asinsDone,
        keywords_upserted: keywordsUpserted,
        keywords_total: keywordsTotal,
        missing_before: missingBefore,
        missing_after: missing.size,
        message,
        heartbeat_at: new Date(),
        ...(final ? { status: final.status, finished_at: new Date() } : {}),
      })}
      WHERE id = ${runId} AND status = 'running'
      RETURNING id
    `;
    if (rows.length === 0) console.log(`[Search Volume] Run ${runId} stopped.`);
    return rows.length > 0;
  };

  if (!(await tick(`Cần quét ${asinsTotal - asinsDone}/${asinsTotal} ASIN, ${missingBefore.toLocaleString()}/${keywordsTotal.toLocaleString()} keyword chưa có volume...`))) return;

  // 1. Cerebro: quét hết ASIN đang chạy ads (kể cả khi keyword đã đủ volume, để có Organic/Sponsored Rank)
  // cerebroExhausted = Cerebro hết lượt trong tháng → tháng này không quét thêm được, Magnet vẫn nên lấp phần thiếu.
  let cerebroExhausted = false;
  let consecutiveFailures = 0;
  for (const [index, batch] of batches.entries()) {
    if (usage.cerebro + cerebroCalls >= CEREBRO_MONTHLY_BUDGET) {
      stopReason = `Hết hạn mức Cerebro tháng (${CEREBRO_MONTHLY_BUDGET} lượt), sẽ chạy tiếp từ checkpoint.`;
      cerebroExhausted = true;
      break;
    }
    if (CEREBRO_PER_RUN > 0 && cerebroCalls >= CEREBRO_PER_RUN) {
      stopReason = `Đạt giới hạn ${CEREBRO_PER_RUN} lượt Cerebro/lần chạy, bấm Chạy tiếp để quét phần còn lại.`;
      break;
    }
    if (!(await tick(`Cerebro lượt ${index + 1}/${batches.length} (${batch.asins.length} ASIN) · đã xong ${asinsDone}/${asinsTotal} ASIN`))) return;

    const { marketplace } = batch;
    try {
      const result = await callHelium10(() => mineHelium10Keywords({
        asins: batch.asins,
        marketplace,
        limit: CEREBRO_ROWS_PER_CALL,
        directApiOnly: true,
      }));
      cerebroCalls++;
      const { saved, withVolume } = await upsertVolumes(sql, marketplace, "helium10_cerebro", result.keywords);
      await upsertRankings(sql, marketplace, batch.asins, result.keywords, spendLooseByMarket.get(marketplace));
      keywordsUpserted += saved.length;
      for (const keyword of withVolume) markCovered(marketplace, keyword);
      await saveAsinCheckpoint(sql, marketplace, batch.asins, { ok: true, keywordCount: saved.length });
      asinsQueried += batch.asins.length;
      asinsDone += batch.asins.length;
      consecutiveFailures = 0;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      // Phiên hỏng / mất kết nối: không phải lỗi ASIN → không trừ lượt, không đánh dấu ASIN, giữ checkpoint
      stopReason = helium10StopReason(error);
      if (stopReason) {
        cerebroExhausted = isQuotaExhaustedError(error);
        break;
      }
      cerebroCalls++;
      errors.push(`Cerebro ${batch.asins[0]}: ${errMsg}`);
      await saveAsinCheckpoint(sql, marketplace, batch.asins, { ok: false, error: errMsg });
      if (batch.attempts + 1 >= MAX_ASIN_ATTEMPTS) asinsDone += batch.asins.length;
      if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        stopReason = `${MAX_CONSECUTIVE_FAILURES} lượt Cerebro lỗi liên tiếp (${errMsg.slice(0, 120)}). Đã dừng để giữ quota.`;
        break;
      }
    }
    await sleep(CALL_DELAY_MS);
  }

  // 2. Magnet lấp keyword còn thiếu có spend cao nhất — khi Cerebro đã quét hết ASIN (Cerebro có thể tự lấp),
  //    hoặc Cerebro đã hết lượt tháng (không còn cách nào khác để lấp). Lỗi phiên / kết nối → không chạy.
  if (!stopReason || cerebroExhausted) {
    const magnetRemaining = Math.max(0, MAGNET_MONTHLY_BUDGET - usage.magnet);
    const perRunCaps = [MAGNET_PER_RUN, options.magnetLimit ?? 0].filter((cap) => cap > 0);
    const magnetAllowance = Math.min(magnetRemaining, ...perRunCaps);
    const gapKeywords = Array.from(missing)
      .sort((a, b) => (spendByKeyword.get(b) || 0) - (spendByKeyword.get(a) || 0))
      .slice(0, magnetAllowance);
    for (const [index, key] of gapKeywords.entries()) {
      // Lượt Magnet trước có thể đã lấp keyword này (từ liên quan / chỉ khác dấu nháy) → không tốn lượt
      if (!missing.has(key)) continue;
      const { marketplace, keyword } = splitMarketKey(key);
      if (!(await tick(`Magnet lượt ${index + 1}/${gapKeywords.length}: "${keyword}"...`))) return;
      try {
        const result = await callHelium10(() => mineHelium10Keywords({ keyword, marketplace, limit: MAGNET_ROWS_PER_CALL, directApiOnly: true }));
        magnetCalls++;
        const { saved, withVolume } = await upsertVolumes(sql, marketplace, "helium10_magnet", result.keywords);
        keywordsUpserted += saved.length;
        for (const item of withVolume) markCovered(marketplace, item);
        if (missing.has(key)) {
          // Helium 10 không có volume cho keyword này → lưu null để không tra lại trong tháng
          await upsertVolumes(sql, marketplace, "helium10_magnet_miss", [{
            keyword, search_volume: null, iq_score: null, cpc: null, organic_rank: null, sponsored_rank: null,
            competing_products: null, cpr: null, title_density: null,
          }]);
          missing.delete(key);
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        const magnetStop = helium10StopReason(error);
        if (magnetStop) {
          stopReason = stopReason ? `${stopReason} Magnet: ${magnetStop}` : magnetStop;
          break;
        }
        magnetCalls++;
        errors.push(`Magnet "${keyword}": ${errMsg}`);
      }
      await sleep(CALL_DELAY_MS);
    }
  }

  const asinsPending = asinsTotal - asinsDone;
  const summary = [
    stopReason,
    `ASIN: đã quét ${asinsDone.toLocaleString()}/${asinsTotal.toLocaleString()}${asinsPending > 0 ? ` (còn ${asinsPending.toLocaleString()})` : ""}.`,
    `Keyword: đã tra ${(keywordsTotal - missing.size).toLocaleString()}/${keywordsTotal.toLocaleString()} (+${keywordsUpserted.toLocaleString()} lượt này).`,
    errors.length > 0 ? `Lỗi: ${errors.slice(-3).join(" | ")}` : null,
  ].filter(Boolean).join(" ");
  await tick(summary, { status: stopReason ? "interrupted" : "completed" });
}

/** Số liệu thật tính từ DB (keyword đã lấy trong tháng + checkpoint ASIN + ASIN có rank), cộng dồn qua các marketplace. */
async function computeCoverage(sql: Sql, stores: Array<{ id: string; marketplace: string }>) {
  const coverage = { keywords: 0, withVolume: 0, missing: 0 };
  const asins = { total: 0, done: 0, pending: 0, failed: 0, withRank: 0 };
  for (const [marketplace, storeIds] of groupStoresByMarketplace(stores)) {
    const keywords = Array.from((await collectKeywordSpend(sql, storeIds)).keys());
    const fresh = await findFreshKeywords(sql, keywords, marketplace);
    const queue = await loadAsinQueue(sql, storeIds, marketplace);

    const asinList = queue.map((row) => row.asin);
    for (let i = 0; i < asinList.length; i += 5000) {
      const [row] = await sql<Array<{ n: number }>>`
        SELECT COUNT(DISTINCT asin)::integer AS n FROM ppc_asin_keyword_rankings
        WHERE marketplace = ${marketplace} AND asin IN ${sql(asinList.slice(i, i + 5000))}
      `;
      asins.withRank += row?.n || 0;
    }

    const done = queue.filter((row) => row.done).length;
    coverage.keywords += keywords.length;
    coverage.withVolume += fresh.size;
    coverage.missing += keywords.length - fresh.size;
    asins.total += queue.length;
    asins.done += done;
    asins.pending += queue.length - done;
    asins.failed += queue.filter((row) => row.failed).length;
  }
  return { coverage: coverage as SearchVolumeCoverage, asins: asins as SearchVolumeAsinCoverage };
}

export async function getSearchVolumeStatus(teamId: string, storeName: string): Promise<SearchVolumeStatus> {
  const sql = await getDatabaseClient();
  const stores = await resolveStores(sql, teamId, storeName);
  const scopeStoreId = runScopeStoreId(storeName, stores);

  await markStaleRuns(sql);
  const runs = await sql<SearchVolumeSyncRun[]>`
    SELECT r.id, r.team_id, r.store_id, s.name AS store_name, r.status, r.cerebro_calls, r.magnet_calls,
      r.asins_queried, r.asins_total, r.asins_done, r.keywords_upserted, r.keywords_total,
      r.missing_before, r.missing_after, r.message,
      r.started_at::text, r.heartbeat_at::text, r.finished_at::text
    FROM ppc_search_volume_sync_runs r
    LEFT JOIN ppc_stores s ON s.id = r.store_id
    WHERE r.team_id = ${teamId}
    ORDER BY (r.status = 'running') DESC, r.started_at DESC
    LIMIT 6
  `;
  const latestRun = runs[0] ?? null;

  let coverage: SearchVolumeCoverage = { keywords: null, withVolume: null, missing: null };
  let asins: SearchVolumeAsinCoverage | null = null;

  // Tối ưu hóa siêu tốc: Tận dụng ngay số liệu ASIN & Keyword từ run gần nhất đã lưu trong DB
  // Tránh việc mỗi lần mở trang hoặc đổi tab lại quét gom 126,000 từ khóa từ bảng raw facts mất 15-20s.
  const runWithStats = runs.find(
    (r) => r.store_id === scopeStoreId && r.keywords_total !== null && r.asins_total !== null,
  );

  if (runWithStats) {
    const isLatest = latestRun?.id === runWithStats.id;
    const asinsDone = isLatest ? (latestRun.asins_done ?? runWithStats.asins_done) : runWithStats.asins_done;
    const asinsTotal = runWithStats.asins_total ?? 0;
    const keywordsTotal = runWithStats.keywords_total ?? 0;
    const missingAfter = isLatest ? (latestRun.missing_after ?? runWithStats.missing_after) : runWithStats.missing_after;

    coverage = {
      keywords: keywordsTotal,
      withVolume: Math.max(0, keywordsTotal - (missingAfter ?? 0)),
      missing: missingAfter ?? 0,
    };
    asins = {
      total: asinsTotal,
      done: asinsDone ?? 0,
      pending: Math.max(0, asinsTotal - (asinsDone ?? 0)),
      failed: null,
      withRank: null,
    };
  } else {
    try {
      const { getCachedOrFetch } = await import("@/lib/redis");
      // Khóa theo lượt chạy gần nhất → có lượt mới kết thúc là tính lại ngay
      const cacheKey = `ppc:sv-coverage:v4:${teamId}:${storeName}:${latestRun?.id ?? "none"}:${latestRun?.finished_at ?? ""}`;
      ({ coverage, asins } = await getCachedOrFetch(cacheKey, 600, () =>
        computeCoverage(sql, stores),
      ));
    } catch (error) {
      console.error("[Search Volume] Coverage failed:", error);
    }
  }

  const usage = await monthlyUsage(sql);
  return {
    latestRun,
    recentRuns: runs,
    coverage,
    asins,
    budget: {
      cerebroUsed: usage.cerebro,
      cerebroLimit: CEREBRO_MONTHLY_BUDGET,
      magnetUsed: usage.magnet,
      magnetLimit: MAGNET_MONTHLY_BUDGET,
    },
  };
}

/**
 * Nạp trực tiếp Search Volume & Rank từ file Excel (.xlsx) xuất từ Helium 10 / DataDive / bảng tổng hợp.
 * Giúp nạp hàng chục nghìn đến hàng trăm nghìn từ khóa cùng lúc mà không tốn quota API.
 */
export async function importSearchVolumeFromExcel(
  buffer: Buffer,
  options: { marketplace?: string; defaultAsin?: string } = {},
): Promise<{
  importedVolumes: number;
  importedRankings: number;
}> {
  const sql = await getDatabaseClient();
  const marketplace = (options.marketplace || "US").toUpperCase();
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  // @ts-expect-error - ExcelJS accepts Buffer directly
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("File Excel không có dữ liệu bảng tính hợp lệ.");
  }

  // Tìm hàng tiêu đề
  let headerRow = -1;
  const colMap: Record<string, number> = {};

  worksheet.eachRow((row, rowNumber) => {
    if (headerRow !== -1) return;
    const values = (row.values as any[]) || [];
    const textJoined = values.map((v) => String(v || "").toLowerCase()).join(" ");
    const norm = textJoined.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    if (norm.includes("keyword") || norm.includes("phrase") || norm.includes("search term") || norm.includes("tu khoa")) {
      headerRow = rowNumber;
      values.forEach((v, idx) => {
        if (!v) return;
        const c = String(v).trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (c.includes("keyword") || c.includes("phrase") || c.includes("search term") || c.includes("tu khoa")) {
          if (!colMap.keyword) colMap.keyword = idx;
        } else if (c.includes("volume") || c.includes("sv") || c.includes("searches")) {
          if (!colMap.searchVolume) colMap.searchVolume = idx;
        } else if (c.includes("organic") || c.includes("org rank") || c.includes("org pos") || c.includes("tu nhien")) {
          if (!colMap.organicRank) colMap.organicRank = idx;
        } else if (c.includes("sponsored") || c.includes("sp rank") || c.includes("sp pos") || c.includes("quang cao")) {
          if (!colMap.sponsoredRank) colMap.sponsoredRank = idx;
        } else if (c === "asin" || c.includes("product asin")) {
          if (!colMap.asin) colMap.asin = idx;
        } else if (c.includes("cpc")) {
          if (!colMap.cpc) colMap.cpc = idx;
        }
      });
    }
  });

  if (headerRow === -1 || colMap.keyword === undefined) {
    throw new Error("Không tìm thấy cột 'Keyword' hoặc 'Search Phrase' trong file Excel.");
  }

  const volumeMap = new Map<string, { keyword: string; searchVolume: number | null; cpc: number | null }>();
  const rankingRows: Array<{
    marketplace: string;
    asin: string;
    keyword_norm: string;
    keyword: string;
    organic_rank: number | null;
    sponsored_rank: number | null;
    search_volume: number | null;
    cpc: number | null;
    source: string;
  }> = [];

  const parseNum = (val: unknown): number | null => {
    if (val === null || val === undefined || val === "") return null;
    const clean = String(val).replace(/[^0-9.-]/g, "").trim();
    const n = parseFloat(clean);
    return isNaN(n) ? null : n;
  };

  for (let r = headerRow + 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const rawKw = colMap.keyword ? String(row.getCell(colMap.keyword).value || "").trim() : "";
    if (!rawKw) continue;
    const norm = normalizeKeyword(rawKw);
    if (!norm) continue;

    const sv = colMap.searchVolume ? parseNum(row.getCell(colMap.searchVolume).value) : null;
    const cpc = colMap.cpc ? parseNum(row.getCell(colMap.cpc).value) : null;
    const orgRank = colMap.organicRank ? parseNum(row.getCell(colMap.organicRank).value) : null;
    const spRank = colMap.sponsoredRank ? parseNum(row.getCell(colMap.sponsoredRank).value) : null;
    const asin = (colMap.asin ? String(row.getCell(colMap.asin).value || "").trim() : "") || options.defaultAsin || "";

    if (sv !== null || !volumeMap.has(norm)) {
      volumeMap.set(norm, {
        keyword: rawKw,
        searchVolume: sv !== null ? Math.round(sv) : null,
        cpc,
      });
    }

    if (asin && (orgRank !== null || spRank !== null)) {
      rankingRows.push({
        marketplace,
        asin: asin.toUpperCase(),
        keyword_norm: norm,
        keyword: rawKw,
        organic_rank: orgRank !== null ? Math.round(orgRank) : null,
        sponsored_rank: spRank !== null ? Math.round(spRank) : null,
        search_volume: sv !== null ? Math.round(sv) : null,
        cpc,
        source: "excel_import",
      });
    }
  }

  // Batch insert vào keyword_search_volumes
  const volArray = Array.from(volumeMap.entries()).map(([kNorm, item]) => ({
    marketplace,
    keyword_norm: kNorm,
    keyword: item.keyword,
    search_volume: item.searchVolume,
    cpc: item.cpc,
    source: "excel_import",
  }));

  for (let i = 0; i < volArray.length; i += 500) {
    const chunk = volArray.slice(i, i + 500);
    await sql`
      INSERT INTO keyword_search_volumes ${sql(chunk)}
      ON CONFLICT (marketplace, keyword_norm) DO UPDATE SET
        search_volume = COALESCE(EXCLUDED.search_volume, keyword_search_volumes.search_volume),
        cpc = COALESCE(EXCLUDED.cpc, keyword_search_volumes.cpc),
        source = EXCLUDED.source,
        fetched_at = NOW()
    `;
  }

  // Batch insert vào ppc_asin_keyword_rankings
  for (let i = 0; i < rankingRows.length; i += 500) {
    const chunk = rankingRows.slice(i, i + 500);
    await sql`
      INSERT INTO ppc_asin_keyword_rankings ${sql(chunk)}
      ON CONFLICT (marketplace, asin, keyword_norm) DO UPDATE SET
        organic_rank = COALESCE(EXCLUDED.organic_rank, ppc_asin_keyword_rankings.organic_rank),
        sponsored_rank = COALESCE(EXCLUDED.sponsored_rank, ppc_asin_keyword_rankings.sponsored_rank),
        search_volume = COALESCE(EXCLUDED.search_volume, ppc_asin_keyword_rankings.search_volume),
        source = EXCLUDED.source,
        fetched_at = NOW()
    `;
  }

  return {
    importedVolumes: volArray.length,
    importedRankings: rankingRows.length,
  };
}
