// lib/ppc/search-term-grouping.ts
// Tab Search Term: tìm theo mã SKU → gộp các dòng cùng search term (nhiều campaign / match type / ngày) thành 1 dòng tổng.
import type { PendingQuery, Row } from "postgres";
import type { getDatabaseClient } from "@/lib/db";
import { attachSearchVolumes } from "@/lib/ppc/search-volume";
import type { MatchType, PpcAdType } from "@/lib/ppc/types";

type Sql = Awaited<ReturnType<typeof getDatabaseClient>>;
type Fragment = PendingQuery<Row[]>;

/** Tách mã SKU (token có cả chữ lẫn số, dài ≥ 6, vd "aott0625f01c") khỏi phần từ khóa còn lại. */
export function splitSkuSearch(search: string): { skuTokens: string[]; keywordText: string } {
  const skuTokens: string[] = [];
  const words: string[] = [];
  for (const token of search.split(/\s+/).filter(Boolean)) {
    if (/^[a-z0-9-]{6,}$/i.test(token) && /[a-z]/i.test(token) && /\d/.test(token)) skuTokens.push(token.toLowerCase());
    else words.push(token);
  }
  return { skuTokens, keywordText: words.join(" ").toLowerCase() };
}

/** Bảng tổng phía trên chỉ hiện tối đa ngần này search term (theo spend). */
export const KEYWORD_GROUP_LIMIT = 300;

/** Dòng search term thuộc SKU: cột SKU, portfolio hoặc tên campaign chứa mã SKU. */
export function searchTermSkuMatch(sql: Sql, skuTokens: string[]): Fragment {
  return skuTokens
    .map((token) => sql`(
      lower(COALESCE(p.sku, '')) = ${token}
      OR lower(p.portfolio_name) = ${token}
      OR position(${token} in lower(p.campaign_name)) > 0
    )`)
    .reduce((acc, cur) => sql`${acc} OR ${cur}`);
}

export async function loadGroupedBySku(input: {
  sql: Sql;
  storeId: string | null;
  anchorCte: Fragment;
  days: number;
  page: number;
  pageSize: number;
  sortBy: string;
  sortDir: "ASC" | "DESC";
  startDate?: string;
  endDate?: string;
  skuTokens: string[];
  keywordText: string;
  rowFilters: Fragment;
  minClicks: number | null;
  maxClicks: number | null;
  minOrders: number | null;
  maxOrders: number | null;
  minAcos: number | null;
  maxAcos: number | null;
  performanceFilter: string;
  teamId: string;
}) {
  const { sql, storeId, skuTokens, keywordText, startDate, endDate, days, page, pageSize } = input;

  const skuMatch = searchTermSkuMatch(sql, skuTokens);

  const acosExpr = sql`(CASE WHEN g.sales > 0 THEN (g.spend / g.sales) * 100 WHEN g.spend > 0 THEN 999 ELSE 0 END)`;
  const groupFilters = sql`
    ${input.minClicks !== null ? sql`AND g.clicks >= ${input.minClicks}` : sql``}
    ${input.maxClicks !== null ? sql`AND g.clicks <= ${input.maxClicks}` : sql``}
    ${input.minOrders !== null ? sql`AND g.orders >= ${input.minOrders}` : sql``}
    ${input.maxOrders !== null ? sql`AND g.orders <= ${input.maxOrders}` : sql``}
    ${input.minAcos !== null ? sql`AND ${acosExpr} >= ${input.minAcos}` : sql``}
    ${input.maxAcos !== null ? sql`AND ${acosExpr} <= ${input.maxAcos}` : sql``}
    ${input.performanceFilter === "WITH_ORDERS" ? sql`AND g.orders > 0` : sql``}
    ${input.performanceFilter === "ZERO_ORDERS_BLEEDING" ? sql`AND g.orders = 0 AND g.clicks >= 9` : sql``}
    ${input.performanceFilter === "HIGH_ACOS" ? sql`AND g.orders > 0 AND g.sales > 0 AND (g.spend / g.sales) * 100 > 60` : sql``}
  `;

  // Cùng cửa sổ ngày với chế độ xem thường (DAILY theo kỳ đang chọn, RANGE khi store chưa có DAILY)
  const groupedCte = sql`
    WITH anchor AS (${input.anchorCte}),
    daily_counts AS (
      SELECT store_id, ad_type, COUNT(*) as cnt FROM ppc_search_terms WHERE report_granularity = 'DAILY' GROUP BY store_id, ad_type
    ),
    latest_range AS (
      SELECT store_id, ad_type, MAX(report_end_date) as max_end_date FROM ppc_search_terms WHERE report_granularity = 'RANGE' GROUP BY store_id, ad_type
    ),
    g AS (
      SELECT
        lower(trim(p.customer_search_term)) AS term_key,
        MIN(p.customer_search_term) AS term,
        MIN(s.name) AS store_name,
        MIN(p.store_id::text) AS store_id,
        COUNT(DISTINCT p.campaign_name)::integer AS campaign_count,
        MIN(p.campaign_name) AS campaign_name,
        STRING_AGG(DISTINCT p.match_type, ', ') AS match_types,
        STRING_AGG(DISTINCT p.ad_type, ', ') AS ad_types,
        MAX(p.report_date)::text AS last_date,
        COALESCE(SUM(p.impressions), 0)::bigint AS impressions,
        COALESCE(SUM(p.clicks), 0)::integer AS clicks,
        COALESCE(SUM(p.spend), 0)::numeric AS spend,
        COALESCE(SUM(p.sales), 0)::numeric AS sales,
        COALESCE(SUM(p.orders), 0)::integer AS orders
      FROM ppc_search_terms p
      JOIN ppc_stores s ON s.id = p.store_id
      CROSS JOIN anchor a
      LEFT JOIN daily_counts dc ON dc.store_id = p.store_id AND dc.ad_type = p.ad_type
      LEFT JOIN latest_range lr ON lr.store_id = p.store_id AND lr.ad_type = p.ad_type
      WHERE s.team_id = ${input.teamId}
        ${storeId ? sql`AND p.store_id = ${storeId}` : sql``}
        AND (${skuMatch})
        ${keywordText ? sql`AND lower(p.customer_search_term) LIKE ${`%${keywordText}%`}` : sql``}
        ${input.rowFilters}
        AND (
          (
            p.report_granularity = 'DAILY'
            AND (${!startDate} OR p.report_date >= ${startDate || "1970-01-01"}::date)
            AND (${!endDate} OR p.report_date <= ${endDate || "2099-12-31"}::date)
            AND (${Boolean(startDate || endDate)} OR (p.report_date >= a.max_date - (${days} - 1)::integer AND p.report_date <= a.max_date))
          )
          OR (
            p.report_granularity = 'RANGE'
            AND (dc.cnt IS NULL OR dc.cnt = 0)
            AND p.report_end_date = lr.max_end_date
          )
        )
      GROUP BY lower(trim(p.customer_search_term))
    )
  `;

  const desc = input.sortDir === "DESC";
  const orderBy = (() => {
    switch (input.sortBy) {
      case "sales": return desc ? sql`g.sales DESC, g.spend DESC` : sql`g.sales ASC, g.spend ASC`;
      case "orders": return desc ? sql`g.orders DESC, g.sales DESC` : sql`g.orders ASC, g.sales ASC`;
      case "clicks": return desc ? sql`g.clicks DESC, g.spend DESC` : sql`g.clicks ASC, g.spend ASC`;
      case "impressions": return desc ? sql`g.impressions DESC` : sql`g.impressions ASC`;
      case "ctr": return sql`(CASE WHEN g.impressions > 0 THEN g.clicks::numeric / g.impressions ELSE 0 END) ${desc ? sql`DESC` : sql`ASC`}`;
      case "cvr": return sql`(CASE WHEN g.clicks > 0 THEN g.orders::numeric / g.clicks ELSE 0 END) ${desc ? sql`DESC` : sql`ASC`}`;
      case "cpc": return sql`(CASE WHEN g.clicks > 0 THEN g.spend / g.clicks ELSE 0 END) ${desc ? sql`DESC` : sql`ASC`}`;
      case "acos": return desc ? sql`${acosExpr} DESC` : sql`${acosExpr} ASC`;
      case "date": return desc ? sql`g.last_date DESC` : sql`g.last_date ASC`;
      default: return desc ? sql`g.spend DESC, g.orders DESC` : sql`g.spend ASC, g.orders ASC`;
    }
  })();

  const [totals] = await sql<Array<{ n: number; impressions: string; clicks: number; spend: string; sales: string; orders: number }>>`
    ${groupedCte}
    SELECT COUNT(*)::integer AS n, COALESCE(SUM(g.impressions), 0)::bigint AS impressions, COALESCE(SUM(g.clicks), 0)::integer AS clicks,
      COALESCE(SUM(g.spend), 0)::numeric AS spend, COALESCE(SUM(g.sales), 0)::numeric AS sales, COALESCE(SUM(g.orders), 0)::integer AS orders
    FROM g WHERE TRUE ${groupFilters}
  `;
  const rows = await sql<Array<{
    term_key: string; term: string; store_name: string; store_id: string; campaign_count: number; campaign_name: string;
    match_types: string; ad_types: string; last_date: string; impressions: string; clicks: number; spend: string; sales: string; orders: number;
  }>>`
    ${groupedCte}
    SELECT * FROM g WHERE TRUE ${groupFilters}
    ORDER BY ${orderBy}
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
  `;

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const acosOf = (spend: number, sales: number) => (sales > 0 ? Math.round((spend / sales) * 1000) / 10 : spend > 0 ? 999 : 0);
  const baseItems = rows.map((r) => {
    const impressions = Number(r.impressions || 0);
    const clicks = Number(r.clicks || 0);
    const orders = Number(r.orders || 0);
    const spend = Number(r.spend || 0);
    const sales = Number(r.sales || 0);
    return {
      id: `kw:${r.term_key}`,
      grouped: true,
      campaignCount: r.campaign_count,
      storeId: r.store_id,
      storeName: r.store_name,
      campaignId: null,
      campaignName: r.campaign_count > 1 ? `${r.campaign_count} campaign` : r.campaign_name,
      adGroupId: null,
      adGroupName: "",
      keywordId: null,
      targetKeyword: null,
      customerSearchTerm: r.term,
      matchType: r.match_types as MatchType,
      adType: r.ad_types as PpcAdType,
      impressions,
      clicks,
      spend: round2(spend),
      sales: round2(sales),
      orders,
      cpc: clicks > 0 ? round2(spend / clicks) : 0,
      ctr: impressions > 0 ? Math.round((clicks / impressions) * 1_000_000) / 1_000_000 : 0,
      cvr: clicks > 0 ? Math.round((orders / clicks) * 1_000_000) / 1_000_000 : 0,
      acos: acosOf(spend, sales),
      roas: spend > 0 ? round2(sales / spend) : 0,
      reportDate: r.last_date,
    };
  });
  const items = await attachSearchVolumes(sql, baseItems, {
    keywordOf: (item) => item.customerSearchTerm,
    coverageDaysOf: () => days,
    shareApplies: () => true,
  });

  const total = Number(totals?.n || 0);
  const totalSpend = round2(Number(totals?.spend || 0));
  const totalSales = round2(Number(totals?.sales || 0));
  const totalClicks = Number(totals?.clicks || 0);
  const totalOrders = Number(totals?.orders || 0);
  const totalImpressions = Number(totals?.impressions || 0);
  const summary = {
    totalTerms: total,
    totalSpend,
    totalSales,
    totalOrders,
    totalClicks,
    totalImpressions,
    cpc: totalClicks > 0 ? round2(totalSpend / totalClicks) : 0,
    acos: acosOf(totalSpend, totalSales),
    roas: totalSpend > 0 ? round2(totalSales / totalSpend) : 0,
  };

  const skuLabel = skuTokens.map((token) => token.toUpperCase()).join(", ");
  const [image] = await sql<Array<{ mockup_url: string | null }>>`
    SELECT COALESCE(NULLIF(trim(mockup_url), ''), NULLIF(trim(mockup), '')) AS mockup_url
    FROM accounting_sku_master
    WHERE deleted_at IS NULL AND upper(trim(sku)) IN ${sql(skuTokens.map((token) => token.toUpperCase()))}
      AND (NULLIF(trim(mockup_url), '') IS NOT NULL OR NULLIF(trim(mockup), '') IS NOT NULL)
    LIMIT 1
  `;

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    summary,
    exactSummary: null,
    exactSkuSummaries: [{ sku: skuLabel, ...summary, mockupUrl: image?.mockup_url || null }],
    groupedBy: "search_term" as const,
  };
}
