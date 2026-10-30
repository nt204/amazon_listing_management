// lib/ppc/search-volume.ts
// Search volume (Helium 10) cho Target / Search Term:
// - Cerebro theo nhóm ASIN đang chạy ads → mỗi lượt trả hàng trăm keyword kèm volume (nguồn chính)
// - Magnet theo từng keyword để lấp các keyword tốn spend nhất còn thiếu
// Volume được cache trong keyword_search_volumes, mỗi keyword chỉ làm mới sau SEARCH_VOLUME_TTL_DAYS.
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

const SEARCH_VOLUME_TTL_DAYS = envInt("PPC_SEARCH_VOLUME_TTL_DAYS", 30);
const LOOKBACK_DAYS = envInt("PPC_SEARCH_VOLUME_LOOKBACK_DAYS", 60);
const CEREBRO_ASINS_PER_CALL = Math.max(1, envInt("PPC_SEARCH_VOLUME_ASINS_PER_CALL", 10));
const CEREBRO_ROWS_PER_CALL = 1000;
// Diamond: 300 Cerebro / 150 Magnet mỗi tháng
const CEREBRO_MONTHLY_BUDGET = envInt("PPC_SEARCH_VOLUME_CEREBRO_MONTHLY_BUDGET", 300);
const MAGNET_MONTHLY_BUDGET = envInt("PPC_SEARCH_VOLUME_MAGNET_MONTHLY_BUDGET", 150);
// 0 = không giới hạn: chạy tới khi quét hết ASIN hoặc hết hạn mức tháng (checkpoint giữ phần còn lại)
const CEREBRO_PER_RUN = envInt("PPC_SEARCH_VOLUME_CEREBRO_PER_RUN", 0);
const MAGNET_PER_RUN = envInt("PPC_SEARCH_VOLUME_MAGNET_PER_RUN", 25);
const CALL_DELAY_MS = envInt("PPC_SEARCH_VOLUME_CALL_DELAY_MS", 1500);
// Không có heartbeat trong khoảng này → coi như process đã chết (1 lượt Cerebro chậm nhất ~4 phút)
const STALE_RUN_MINUTES = envInt("PPC_SEARCH_VOLUME_STALE_MINUTES", 15);
// ASIN lỗi được thử lại tối đa bấy nhiêu lần trong 1 chu kỳ TTL (lô nhỏ dần 10 → 5 → 2 → 1)
const MAX_ASIN_ATTEMPTS = 4;
const MAX_CONSECUTIVE_FAILURES = 5;

const NON_KEYWORD_TARGETS = /^(close-match|loose-match|substitutes|complements)$|asin|category|^b0[a-z0-9]{8}$|=/;

/** Chuẩn hóa keyword để khớp giữa Amazon Ads (có "+" ở broad modifier) và Helium 10. */
export function normalizeKeyword(raw: string | null | undefined): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/\+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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
  const rows = await sql<Array<{
    keyword_norm: string;
    search_volume: number | null;
    search_volume_trend: string | null;
    fetched_at: string;
  }>>`
    SELECT keyword_norm, search_volume, search_volume_trend, fetched_at::text
    FROM keyword_search_volumes
    WHERE marketplace = ${marketplace} AND keyword_norm IN ${sql(norms)}
  `;
  return new Map(rows.map((row) => [row.keyword_norm, {
    searchVolume: row.search_volume,
    searchVolumeTrend: row.search_volume_trend === null ? null : Number(row.search_volume_trend),
    fetchedAt: row.fetched_at,
  }]));
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

  // Retrieve rankings from ppc_asin_keyword_rankings
  const norms = Array.from(new Set(items.map((i) => normalizeKeyword(options.keywordOf(i))).filter(Boolean)));
  const rankMap = new Map<string, { organicRank: number | null; sponsoredRank: number | null }>();

  if (norms.length > 0) {
    try {
      const rankRows = await sql<Array<{
        asin: string;
        keyword_norm: string;
        organic_rank: number | null;
        sponsored_rank: number | null;
      }>>`
        SELECT asin, keyword_norm, organic_rank, sponsored_rank
        FROM ppc_asin_keyword_rankings
        WHERE marketplace = ${mp} AND keyword_norm IN ${sql(norms)}
      `;
      for (const row of rankRows) {
        rankMap.set(`${row.asin}:${row.keyword_norm}`, {
          organicRank: row.organic_rank,
          sponsoredRank: row.sponsored_rank,
        });
        // Also fallback key by keyword_norm alone (choosing best rank)
        const kwOnly = rankMap.get(row.keyword_norm);
        if (!kwOnly) {
          rankMap.set(row.keyword_norm, {
            organicRank: row.organic_rank,
            sponsoredRank: row.sponsored_rank,
          });
        }
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

    const rankInfo = (item.asin ? rankMap.get(`${item.asin}:${kwNorm}`) : null) || rankMap.get(kwNorm);

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
// Checkpoint theo từng ASIN (keyword_search_volume_asin_queries): mỗi lượt chỉ quét ASIN chưa xong trong TTL,
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

async function findFreshKeywords(sql: Sql, keywords: string[], marketplace: string) {
  const fresh = new Set<string>();
  for (let i = 0; i < keywords.length; i += 5000) {
    const chunk = keywords.slice(i, i + 5000);
    const rows = await sql<Array<{ keyword_norm: string }>>`
      SELECT keyword_norm FROM keyword_search_volumes
      WHERE marketplace = ${marketplace}
        AND keyword_norm IN ${sql(chunk)}
        AND fetched_at >= NOW() - make_interval(days => ${SEARCH_VOLUME_TTL_DAYS})
    `;
    for (const row of rows) fresh.add(row.keyword_norm);
  }
  return fresh;
}

type AsinQueueRow = { asin: string; attempts: number; done: boolean; failed: boolean };

/**
 * Toàn bộ ASIN đang chạy ads (không paused/archived) của các store kèm trạng thái checkpoint, xếp theo spend.
 * done = đã quét thành công trong TTL, hoặc đã thử đủ MAX_ASIN_ATTEMPTS lần mà vẫn lỗi (bỏ qua tới hết TTL).
 */
async function loadAsinQueue(sql: Sql, storeIds: string[], marketplace: string) {
  return sql<AsinQueueRow[]>`
    WITH active AS (
      SELECT upper(p.asin) AS asin, SUM(p.spend) AS spend, MAX(p.report_end_date) AS last_date
      FROM ppc_performance_facts p
      WHERE p.store_id IN ${sql(storeIds)}
        AND p.grain = 'PRODUCT'
        AND p.asin ~* '^[A-Z0-9]{10}$'
        AND lower(COALESCE(p.state, 'enabled')) NOT IN ('paused', 'archived')
        AND lower(COALESCE(p.campaign_state, 'enabled')) NOT IN ('paused', 'archived')
        AND lower(COALESCE(p.ad_group_state, 'enabled')) NOT IN ('paused', 'archived')
      GROUP BY upper(p.asin)
    ), checkpoint AS (
      SELECT a.asin, a.spend, a.last_date, q.status,
        COALESCE(q.queried_at >= NOW() - make_interval(days => ${SEARCH_VOLUME_TTL_DAYS}), false) AS fresh,
        COALESCE(q.attempts, 0) AS attempts
      FROM active a
      LEFT JOIN keyword_search_volume_asin_queries q ON q.marketplace = ${marketplace} AND q.asin = a.asin
    )
    SELECT asin,
      (CASE WHEN fresh THEN attempts ELSE 0 END)::integer AS attempts,
      (fresh AND (status = 'ok' OR attempts >= ${MAX_ASIN_ATTEMPTS})) AS done,
      (fresh AND status = 'failed' AND attempts >= ${MAX_ASIN_ATTEMPTS}) AS failed
    FROM checkpoint
    ORDER BY spend DESC NULLS LAST, last_date DESC NULLS LAST
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
        WHEN keyword_search_volume_asin_queries.queried_at < NOW() - make_interval(days => ${SEARCH_VOLUME_TTL_DAYS}) THEN 1
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
        search_volume = EXCLUDED.search_volume,
        search_volume_trend = EXCLUDED.search_volume_trend,
        cpc = EXCLUDED.cpc,
        competing_products = EXCLUDED.competing_products,
        source = EXCLUDED.source,
        fetched_at = NOW()
    `;
  }
  return Array.from(byKeyword.keys());
}

async function upsertRankings(
  sql: Sql,
  marketplace: string,
  asins: string[],
  items: Helium10KeywordItem[],
) {
  if (asins.length === 0 || items.length === 0) return;
  const primaryAsin = asins[0]; // Primary ASIN the rank is anchored to
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
    const key = `${marketplace}:${primaryAsin}:${keyword_norm}`;
    rowMap.set(key, {
      marketplace,
      asin: primaryAsin,
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
        search_volume = EXCLUDED.search_volume,
        cpc = EXCLUDED.cpc,
        cpr = EXCLUDED.cpr,
        source = EXCLUDED.source,
        fetched_at = NOW()
    `;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
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
export async function startSearchVolumeSync(input: { teamId: string; storeName: string; actorId?: string }) {
  const sql = await getDatabaseClient();
  const stores = await resolveStores(sql, input.teamId, input.storeName);
  const scopeStoreId = runScopeStoreId(input.storeName, stores);

  await markStaleRuns(sql);
  const [running] = await sql`SELECT id FROM ppc_search_volume_sync_runs WHERE status = 'running' LIMIT 1`;
  if (running) throw new ApiError("Đang có một lượt đồng bộ Search Volume chạy. Vui lòng đợi lượt đó xong.", 409);

  const usage = await monthlyUsage(sql);
  if (usage.cerebro >= CEREBRO_MONTHLY_BUDGET && usage.magnet >= MAGNET_MONTHLY_BUDGET) {
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
      await runSearchVolumeSync(sql, run.id, stores, usage);
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
) {
  const marketplace = (stores[0].marketplace || "US").toUpperCase() as Marketplace;
  const storeIds = stores.map((store) => store.id);

  const spendByKeyword = await collectKeywordSpend(sql, storeIds);
  const fresh = await findFreshKeywords(sql, Array.from(spendByKeyword.keys()), marketplace);
  const missing = new Set(Array.from(spendByKeyword.keys()).filter((keyword) => !fresh.has(keyword)));
  const missingBefore = missing.size;
  const keywordsTotal = spendByKeyword.size;

  const queue = await loadAsinQueue(sql, storeIds, marketplace);
  const batches = buildAsinBatches(queue);
  const asinsTotal = queue.length;
  let asinsDone = queue.filter((row) => row.done).length;

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
  let consecutiveFailures = 0;
  for (const [index, batch] of batches.entries()) {
    if (usage.cerebro + cerebroCalls >= CEREBRO_MONTHLY_BUDGET) {
      stopReason = `Hết hạn mức Cerebro tháng (${CEREBRO_MONTHLY_BUDGET} lượt), sẽ chạy tiếp từ checkpoint.`;
      break;
    }
    if (CEREBRO_PER_RUN > 0 && cerebroCalls >= CEREBRO_PER_RUN) {
      stopReason = `Đạt giới hạn ${CEREBRO_PER_RUN} lượt Cerebro/lần chạy, bấm Chạy tiếp để quét phần còn lại.`;
      break;
    }
    if (!(await tick(`Cerebro lượt ${index + 1}/${batches.length} (${batch.asins.length} ASIN) · đã xong ${asinsDone}/${asinsTotal} ASIN`))) return;

    try {
      const result = await callHelium10(() => mineHelium10Keywords({
        asins: batch.asins,
        marketplace,
        limit: CEREBRO_ROWS_PER_CALL,
        directApiOnly: true,
      }));
      cerebroCalls++;
      const saved = await upsertVolumes(sql, marketplace, "helium10_cerebro", result.keywords);
      await upsertRankings(sql, marketplace, batch.asins, result.keywords);
      keywordsUpserted += saved.length;
      for (const keyword of saved) missing.delete(keyword);
      await saveAsinCheckpoint(sql, marketplace, batch.asins, { ok: true, keywordCount: saved.length });
      asinsQueried += batch.asins.length;
      asinsDone += batch.asins.length;
      consecutiveFailures = 0;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      // Phiên hỏng / mất kết nối: không phải lỗi ASIN → không trừ lượt, không đánh dấu ASIN, giữ checkpoint
      stopReason = helium10StopReason(error);
      if (stopReason) break;
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

  // 2. Magnet lấp keyword còn thiếu có spend cao nhất — chỉ khi Cerebro đã quét hết ASIN (Cerebro có thể tự lấp)
  if (!stopReason) {
    const magnetAllowance = Math.min(MAGNET_PER_RUN, Math.max(0, MAGNET_MONTHLY_BUDGET - usage.magnet));
    const gapKeywords = Array.from(missing)
      .sort((a, b) => (spendByKeyword.get(b) || 0) - (spendByKeyword.get(a) || 0))
      .slice(0, magnetAllowance);
    for (const [index, keyword] of gapKeywords.entries()) {
      if (!(await tick(`Magnet lượt ${index + 1}/${gapKeywords.length}: "${keyword}"...`))) return;
      try {
        const result = await callHelium10(() => mineHelium10Keywords({ keyword, marketplace, limit: 200, directApiOnly: true }));
        magnetCalls++;
        const saved = await upsertVolumes(sql, marketplace, "helium10_magnet", result.keywords);
        keywordsUpserted += saved.length;
        for (const item of saved) missing.delete(item);
        if (missing.has(keyword)) {
          // Helium 10 không có volume cho keyword này → lưu null để không tra lại trong TTL
          await upsertVolumes(sql, marketplace, "helium10_magnet_miss", [{
            keyword, search_volume: null, iq_score: null, cpc: null, organic_rank: null, sponsored_rank: null,
            competing_products: null, cpr: null, title_density: null,
          }]);
          missing.delete(keyword);
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        stopReason = helium10StopReason(error);
        if (stopReason) break;
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

/** Số liệu thật tính từ DB (keyword còn hạn TTL + checkpoint ASIN + ASIN có rank). */
async function computeCoverage(sql: Sql, storeIds: string[], marketplace: string) {
  const spendByKeyword = await collectKeywordSpend(sql, storeIds);
  const keywords = Array.from(spendByKeyword.keys());
  const fresh = await findFreshKeywords(sql, keywords, marketplace);
  const queue = await loadAsinQueue(sql, storeIds, marketplace);

  let withRank = 0;
  const asinList = queue.map((row) => row.asin);
  for (let i = 0; i < asinList.length; i += 5000) {
    const [row] = await sql<Array<{ n: number }>>`
      SELECT COUNT(DISTINCT asin)::integer AS n FROM ppc_asin_keyword_rankings
      WHERE marketplace = ${marketplace} AND asin IN ${sql(asinList.slice(i, i + 5000))}
    `;
    withRank += row?.n || 0;
  }

  const done = queue.filter((row) => row.done).length;
  return {
    coverage: { keywords: keywords.length, withVolume: fresh.size, missing: keywords.length - fresh.size } as SearchVolumeCoverage,
    asins: {
      total: queue.length,
      done,
      pending: queue.length - done,
      failed: queue.filter((row) => row.failed).length,
      withRank,
    } as SearchVolumeAsinCoverage,
  };
}

export async function getSearchVolumeStatus(teamId: string, storeName: string): Promise<SearchVolumeStatus> {
  const sql = await getDatabaseClient();
  const stores = await resolveStores(sql, teamId, storeName);
  const marketplace = (stores[0].marketplace || "US").toUpperCase();
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

  if (latestRun?.status === "running" && latestRun.store_id === scopeStoreId) {
    // Đang chạy đúng phạm vi đang xem: lấy số run vừa ghi (cập nhật mỗi lượt), null khi còn đang gom
    if (latestRun.keywords_total !== null) {
      coverage = {
        keywords: latestRun.keywords_total,
        withVolume: latestRun.keywords_total - latestRun.missing_after,
        missing: latestRun.missing_after,
      };
    }
    if (latestRun.asins_total !== null && latestRun.asins_done !== null) {
      asins = {
        total: latestRun.asins_total,
        done: latestRun.asins_done,
        pending: latestRun.asins_total - latestRun.asins_done,
        failed: null,
        withRank: null,
      };
    }
  } else {
    try {
      const { getCachedOrFetch } = await import("@/lib/redis");
      // Khóa theo lượt chạy gần nhất → có lượt mới kết thúc là tính lại ngay
      const cacheKey = `ppc:sv-coverage:v2:${teamId}:${storeName}:${latestRun?.id ?? "none"}:${latestRun?.finished_at ?? ""}`;
      ({ coverage, asins } = await getCachedOrFetch(cacheKey, 600, () =>
        computeCoverage(sql, stores.map((store) => store.id), marketplace),
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
