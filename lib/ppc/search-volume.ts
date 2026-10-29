// lib/ppc/search-volume.ts
// Search volume (Helium 10) cho Target / Search Term:
// - Cerebro theo nhóm ASIN đang chạy ads → mỗi lượt trả hàng trăm keyword kèm volume (nguồn chính)
// - Magnet theo từng keyword để lấp các keyword tốn spend nhất còn thiếu
// Volume được cache trong keyword_search_volumes, mỗi keyword chỉ làm mới sau SEARCH_VOLUME_TTL_DAYS.
import { ApiError } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { mineHelium10Keywords, type Helium10KeywordItem } from "@/lib/helium10-playwright";

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
const CEREBRO_PER_RUN = envInt("PPC_SEARCH_VOLUME_CEREBRO_PER_RUN", 50);
const MAGNET_PER_RUN = envInt("PPC_SEARCH_VOLUME_MAGNET_PER_RUN", 25);
const CALL_DELAY_MS = envInt("PPC_SEARCH_VOLUME_CALL_DELAY_MS", 1500);
const STALE_RUN_MINUTES = 120;

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

export type SearchVolumeSyncRun = {
  id: string;
  team_id: string;
  store_id: string | null;
  store_name: string | null;
  status: "running" | "completed" | "failed";
  cerebro_calls: number;
  magnet_calls: number;
  asins_queried: number;
  keywords_upserted: number;
  missing_before: number;
  missing_after: number;
  message: string | null;
  started_at: string;
  finished_at: string | null;
};

export type SearchVolumeStatus = {
  latestRun: SearchVolumeSyncRun | null;
  coverage: { keywords: number; withVolume: number; missing: number };
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

  for (const item of items) {
    const keyword_norm = normalizeKeyword(item.keyword);
    if (!keyword_norm) continue;
    rows.push({
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

  for (let i = 0; i < rows.length; i += 500) {
    await sql`
      INSERT INTO ppc_asin_keyword_rankings ${sql(rows.slice(i, i + 500))}
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

async function updateRun(sql: Sql, runId: string, patch: Partial<Omit<SearchVolumeSyncRun, "id" | "team_id" | "store_id" | "store_name" | "started_at">>) {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return;
  await sql`UPDATE ppc_search_volume_sync_runs SET ${sql(Object.fromEntries(entries))} WHERE id = ${runId}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isAuthError = (error: unknown) => /cookie|đăng nhập|token|401/i.test(String(error));

/** Tạo run (chặn chạy song song vì dùng chung 1 phiên Helium 10). Trả về hàm thực thi để chạy nền. */
export async function startSearchVolumeSync(input: { teamId: string; storeName: string; actorId?: string }) {
  const sql = await getDatabaseClient();
  const stores = await resolveStores(sql, input.teamId, input.storeName);

  await sql`
    UPDATE ppc_search_volume_sync_runs
    SET status = 'failed', finished_at = NOW(), message = 'Quá thời gian chạy, đã tự đánh dấu lỗi.'
    WHERE status = 'running' AND started_at < NOW() - make_interval(mins => ${STALE_RUN_MINUTES})
  `;
  const [running] = await sql`SELECT id FROM ppc_search_volume_sync_runs WHERE status = 'running' LIMIT 1`;
  if (running) throw new ApiError("Đang có một lượt đồng bộ Search Volume chạy. Vui lòng đợi lượt đó xong.", 409);

  const usage = await monthlyUsage(sql);
  if (usage.cerebro >= CEREBRO_MONTHLY_BUDGET && usage.magnet >= MAGNET_MONTHLY_BUDGET) {
    throw new ApiError(
      `Đã dùng hết hạn mức Helium 10 dành cho đồng bộ tháng này (Cerebro ${usage.cerebro}/${CEREBRO_MONTHLY_BUDGET}, Magnet ${usage.magnet}/${MAGNET_MONTHLY_BUDGET}).`,
      429,
    );
  }

  const [run] = await sql<Array<{ id: string }>>`
    INSERT INTO ppc_search_volume_sync_runs (team_id, store_id, created_by, message)
    VALUES (${input.teamId}, ${stores.length === 1 ? stores[0].id : null}, ${input.actorId || null}, 'Đang gom keyword cần tra...')
    RETURNING id
  `;

  const execute = async () => {
    try {
      await runSearchVolumeSync(sql, run.id, stores, usage);
    } catch (error) {
      console.error("[Search Volume] Sync failed:", error);
      await updateRun(sql, run.id, {
        status: "failed",
        finished_at: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error),
      }).catch(() => {});
    }
  };

  return { runId: run.id, execute };
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

  let cerebroCalls = 0;
  let magnetCalls = 0;
  let asinsQueried = 0;
  let keywordsUpserted = 0;
  const errors: string[] = [];
  const progress = (message: string) =>
    updateRun(sql, runId, {
      cerebro_calls: cerebroCalls,
      magnet_calls: magnetCalls,
      asins_queried: asinsQueried,
      keywords_upserted: keywordsUpserted,
      missing_before: missingBefore,
      missing_after: missing.size,
      message,
    });

  // 1. Cerebro theo ASIN (ưu tiên ASIN spend cao, bỏ qua ASIN đã tra trong TTL)
  const cerebroAllowance = Math.min(CEREBRO_PER_RUN, Math.max(0, CEREBRO_MONTHLY_BUDGET - usage.cerebro));
  if (missing.size > 0 && cerebroAllowance > 0) {
    const asinRows = await sql<Array<{ asin: string }>>`
      SELECT upper(p.asin) AS asin
      FROM ppc_performance_facts p
      LEFT JOIN keyword_search_volume_asin_queries q
        ON q.marketplace = ${marketplace} AND q.asin = upper(p.asin)
      WHERE p.store_id IN ${sql(storeIds)}
        AND p.grain = 'PRODUCT'
        AND p.asin ~* '^[A-Z0-9]{10}$'
        AND p.report_end_date >= CURRENT_DATE - ${LOOKBACK_DAYS}::integer
        AND (q.queried_at IS NULL OR q.queried_at < NOW() - make_interval(days => ${SEARCH_VOLUME_TTL_DAYS}))
      GROUP BY upper(p.asin)
      ORDER BY SUM(p.spend) DESC
    `;
    const asins = asinRows.map((row) => row.asin);

    for (let i = 0; i < asins.length && cerebroCalls < cerebroAllowance && missing.size > 0; i += CEREBRO_ASINS_PER_CALL) {
      const batch = asins.slice(i, i + CEREBRO_ASINS_PER_CALL);
      await progress(`Cerebro lượt ${cerebroCalls + 1}/${cerebroAllowance} (${batch.length} ASIN)...`);
      cerebroCalls++;
      try {
        const result = await mineHelium10Keywords({ asins: batch, marketplace, limit: CEREBRO_ROWS_PER_CALL });
        const saved = await upsertVolumes(sql, marketplace, "helium10_cerebro", result.keywords);
        await upsertRankings(sql, marketplace, batch, result.keywords);
        keywordsUpserted += saved.length;
        for (const keyword of saved) missing.delete(keyword);
        await sql`
          INSERT INTO keyword_search_volume_asin_queries ${sql(batch.map((asin) => ({ marketplace, asin, keyword_count: saved.length })))}
          ON CONFLICT (marketplace, asin) DO UPDATE SET queried_at = NOW(), keyword_count = EXCLUDED.keyword_count
        `;
        asinsQueried += batch.length;
      } catch (error) {
        errors.push(`Cerebro ${batch[0]}: ${error instanceof Error ? error.message : String(error)}`);
        // Cookie hết hạn: Helium 10 chưa trừ lượt, các lượt sau cũng lỗi → dừng sớm
        if (isAuthError(error)) {
          cerebroCalls--;
          break;
        }
      }
      await sleep(CALL_DELAY_MS);
    }
  }

  // 2. Magnet lấp keyword còn thiếu có spend cao nhất
  const magnetAllowance = Math.min(MAGNET_PER_RUN, Math.max(0, MAGNET_MONTHLY_BUDGET - usage.magnet));
  const gapKeywords = Array.from(missing)
    .sort((a, b) => (spendByKeyword.get(b) || 0) - (spendByKeyword.get(a) || 0))
    .slice(0, magnetAllowance);
  for (const keyword of gapKeywords) {
    if (errors.length > 0 && isAuthError(errors[errors.length - 1])) break;
    await progress(`Magnet lượt ${magnetCalls + 1}/${gapKeywords.length}: "${keyword}"...`);
    magnetCalls++;
    try {
      const result = await mineHelium10Keywords({ keyword, marketplace, limit: 200 });
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
      errors.push(`Magnet "${keyword}": ${error instanceof Error ? error.message : String(error)}`);
      if (isAuthError(error)) magnetCalls--;
    }
    await sleep(CALL_DELAY_MS);
  }

  const allFailed = errors.length > 0 && keywordsUpserted === 0;
  const summary = missingBefore === 0
    ? "Tất cả keyword đã có volume còn hạn, không cần gọi Helium 10."
    : `Đã lưu ${keywordsUpserted.toLocaleString()} keyword. Còn thiếu ${missing.size.toLocaleString()}/${missingBefore.toLocaleString()} keyword.`;
  await updateRun(sql, runId, {
    status: allFailed ? "failed" : "completed",
    finished_at: new Date().toISOString(),
    cerebro_calls: cerebroCalls,
    magnet_calls: magnetCalls,
    asins_queried: asinsQueried,
    keywords_upserted: keywordsUpserted,
    missing_before: missingBefore,
    missing_after: missing.size,
    message: errors.length > 0 ? `${summary} Lỗi: ${errors.slice(0, 3).join(" | ")}` : summary,
  });
}

export async function getSearchVolumeStatus(teamId: string, storeName: string): Promise<SearchVolumeStatus> {
  const sql = await getDatabaseClient();
  const stores = await resolveStores(sql, teamId, storeName);
  const marketplace = (stores[0].marketplace || "US").toUpperCase();

  const [latestRun] = await sql<SearchVolumeSyncRun[]>`
    SELECT r.id, r.team_id, r.store_id, s.name AS store_name, r.status, r.cerebro_calls, r.magnet_calls,
      r.asins_queried, r.keywords_upserted, r.missing_before, r.missing_after, r.message,
      r.started_at::text, r.finished_at::text
    FROM ppc_search_volume_sync_runs r
    LEFT JOIN ppc_stores s ON s.id = r.store_id
    WHERE r.team_id = ${teamId}
    ORDER BY r.started_at DESC
    LIMIT 1
  `;

  const spendByKeyword = await collectKeywordSpend(sql, stores.map((store) => store.id));
  const keywords = Array.from(spendByKeyword.keys());
  let withVolume = 0;
  let cached = 0;
  for (let i = 0; i < keywords.length; i += 5000) {
    const [row] = await sql<Array<{ cached: number; with_volume: number }>>`
      SELECT COUNT(*)::integer AS cached, COUNT(search_volume)::integer AS with_volume
      FROM keyword_search_volumes
      WHERE marketplace = ${marketplace} AND keyword_norm IN ${sql(keywords.slice(i, i + 5000))}
    `;
    cached += row?.cached || 0;
    withVolume += row?.with_volume || 0;
  }

  const usage = await monthlyUsage(sql);
  return {
    latestRun: latestRun || null,
    coverage: { keywords: keywords.length, withVolume, missing: keywords.length - cached },
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
