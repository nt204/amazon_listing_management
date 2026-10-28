// lib/ppc/target-grouping.ts
// Tab Target: tìm theo mã SKU → gộp các target cùng keyword (nhiều campaign / ad group / match type) thành 1 dòng tổng.
import type { PendingQuery, Row } from "postgres";
import type { getDatabaseClient } from "@/lib/db";
import { roundedPerformanceMetrics } from "@/lib/ppc/analytics";
import { attachSearchVolumes } from "@/lib/ppc/search-volume";
import type { MatchType, PpcAdType, PpcTargetPerformance } from "@/lib/ppc/types";

type Sql = Awaited<ReturnType<typeof getDatabaseClient>>;
type Fragment = PendingQuery<Row[]>;

/** Target không lưu SKU → nhận theo tên campaign / ad group / portfolio chứa mã SKU. */
export function targetSkuMatch(sql: Sql, skuTokens: string[]): Fragment {
  return skuTokens
    .map((token) => sql`(
      lower(COALESCE(p.sku, '')) = ${token}
      OR position(${token} in lower(p.campaign_name)) > 0
      OR position(${token} in lower(p.ad_group_name)) > 0
      OR lower(p.portfolio_name) = ${token}
    )`)
    .reduce((acc, cur) => sql`${acc} OR ${cur}`);
}

export async function loadTargetsGroupedBySku(input: {
  sql: Sql;
  teamId: string;
  combinedSnaps: Fragment;
  rowFilters: Fragment;
  skuTokens: string[];
  keywordText: string;
  days: number;
  page: number;
  pageSize: number;
  sortBy: string;
  sortDir: "ASC" | "DESC";
}) {
  const { sql, skuTokens, keywordText, page, pageSize } = input;

  const skuMatch = targetSkuMatch(sql, skuTokens);

  const groupedCte = sql`
    WITH g AS (
      SELECT
        lower(trim(p.target_expression)) AS target_key,
        MIN(p.target_expression) AS target_expression,
        MIN(s.name) AS store_name,
        MIN(p.store_id::text) AS store_id,
        COUNT(DISTINCT p.campaign_id || '|' || p.campaign_name)::integer AS campaign_count,
        MIN(p.campaign_name) AS campaign_name,
        STRING_AGG(DISTINCT p.match_type, ', ') AS match_types,
        STRING_AGG(DISTINCT p.ad_type, ', ') AS ad_types,
        COALESCE(SUM(p.impressions), 0)::bigint AS impressions,
        COALESCE(SUM(p.clicks), 0)::integer AS clicks,
        COALESCE(SUM(p.spend), 0)::numeric AS spend,
        COALESCE(SUM(p.sales), 0)::numeric AS sales,
        COALESCE(SUM(p.orders), 0)::integer AS orders
      FROM ppc_performance_facts p
      JOIN ppc_stores s ON s.id = p.store_id
      WHERE s.team_id = ${input.teamId}
        AND p.grain = 'TARGET'
        AND NOT p.is_negative
        AND (p.spend > 0 OR p.clicks > 0 OR p.impressions > 0)
        AND (${input.combinedSnaps})
        AND (${skuMatch})
        ${keywordText ? sql`AND lower(p.target_expression) LIKE ${`%${keywordText}%`}` : sql``}
        ${input.rowFilters}
      GROUP BY lower(trim(p.target_expression))
    )
  `;

  const desc = input.sortDir === "DESC";
  const dir = desc ? sql`DESC` : sql`ASC`;
  const orderBy = (() => {
    switch (input.sortBy) {
      case "sales": return sql`g.sales ${dir}, g.target_key`;
      case "orders": return sql`g.orders ${dir}, g.target_key`;
      case "clicks": return sql`g.clicks ${dir}, g.target_key`;
      case "impressions": return sql`g.impressions ${dir}, g.target_key`;
      case "ctr": return sql`(CASE WHEN g.impressions > 0 THEN g.clicks::numeric / g.impressions ELSE 0 END) ${dir}, g.target_key`;
      case "cvr": return sql`(CASE WHEN g.clicks > 0 THEN g.orders::numeric / g.clicks ELSE 0 END) ${dir}, g.target_key`;
      case "cpc": return sql`(CASE WHEN g.clicks > 0 THEN g.spend / g.clicks ELSE 0 END) ${dir}, g.target_key`;
      case "acos": return desc
        ? sql`(CASE WHEN g.sales > 0 THEN g.spend / g.sales ELSE 0 END) DESC, g.target_key`
        : sql`(CASE WHEN g.sales > 0 THEN g.spend / g.sales ELSE 999 END) ASC, g.target_key`;
      default: return sql`g.spend ${dir}, g.target_key`;
    }
  })();

  const [totals] = await sql<Array<{ n: number; impressions: string; clicks: number; spend: string; sales: string; orders: number }>>`
    ${groupedCte}
    SELECT COUNT(*)::integer AS n, COALESCE(SUM(impressions), 0)::bigint AS impressions, COALESCE(SUM(clicks), 0)::integer AS clicks,
      COALESCE(SUM(spend), 0)::numeric AS spend, COALESCE(SUM(sales), 0)::numeric AS sales, COALESCE(SUM(orders), 0)::integer AS orders
    FROM g
  `;
  const rows = await sql<Array<{
    target_key: string; target_expression: string; store_name: string; store_id: string; campaign_count: number;
    campaign_name: string; match_types: string; ad_types: string; impressions: string; clicks: number; spend: string; sales: string; orders: number;
  }>>`
    ${groupedCte}
    SELECT * FROM g ORDER BY ${orderBy} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
  `;

  const baseItems: PpcTargetPerformance[] = rows.map((r) => {
    const metrics = roundedPerformanceMetrics({
      spend: Number(r.spend || 0),
      sales: Number(r.sales || 0),
      orders: Number(r.orders || 0),
      clicks: Number(r.clicks || 0),
      impressions: Number(r.impressions || 0),
    });
    return {
      storeId: r.store_id,
      campaignName: r.campaign_count > 1 ? `${r.campaign_count} campaign` : r.campaign_name,
      adGroupName: "",
      targetKeyword: r.target_expression,
      matchType: r.match_types as MatchType,
      storeName: r.store_name,
      adType: r.ad_types as PpcAdType,
      grouped: true,
      campaignCount: r.campaign_count,
      ...metrics,
    };
  });
  const items = await attachSearchVolumes(sql, baseItems, {
    keywordOf: (item) => item.targetKeyword,
    coverageDaysOf: () => input.days,
    shareApplies: (item) => item.matchType === "Exact",
  });

  const summaryMetrics = roundedPerformanceMetrics({
    spend: Number(totals?.spend || 0),
    sales: Number(totals?.sales || 0),
    orders: Number(totals?.orders || 0),
    clicks: Number(totals?.clicks || 0),
    impressions: Number(totals?.impressions || 0),
  });
  const total = Number(totals?.n || 0);
  const summary = {
    count: total,
    impressions: summaryMetrics.impressions,
    clicks: summaryMetrics.clicks,
    spend: summaryMetrics.spend,
    sales: summaryMetrics.sales,
    orders: summaryMetrics.orders,
    ctr: summaryMetrics.ctr,
    cpc: summaryMetrics.cpc,
    cvr: summaryMetrics.cvr,
    acos: summaryMetrics.acos,
  };

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
    exactSkuSummaries: [{
      sku: skuTokens.map((token) => token.toUpperCase()).join(", "),
      totalImpressions: summary.impressions,
      totalClicks: summary.clicks,
      totalSpend: summary.spend,
      totalSales: summary.sales,
      totalOrders: summary.orders,
      acos: summary.acos,
      mockupUrl: image?.mockup_url || null,
    }],
    groupedBy: "target" as const,
  };
}
