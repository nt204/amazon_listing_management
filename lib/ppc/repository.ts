import "server-only";

import { getDatabaseClient, type DataScope } from "@/lib/db";
import type postgres from "postgres";
import type {
  MatchType,
  PpcAdType,
  PpcDailyTrendPoint,
  PpcPerformanceGrain,
  PpcPerformanceRow,
  PpcReportGranularity,
  PpcSearchTermRow,
  PpcSearchTermSummary,
  PpcStore,
} from "./types";

export type PpcSyncSource = "CLOUDFLARE_R2" | "MANUAL_UPLOAD" | "MOCK_DATA" | "ADSPOWER_DOWNLOAD" | "DATA_INGEST" | "SYSTEM";
export type PpcSyncStatus = "SUCCESS" | "FAILED" | "SKIPPED" | "RUNNING";

export interface PpcSyncLog {
  id: string;
  source: PpcSyncSource;
  fileName: string | null;
  status: PpcSyncStatus;
  count: number;
  message: string | null;
  time: string;
}

interface StoreRow {
  id: string;
  name: string;
  marketplace: string;
  target_acos: string | number;
  daily_budget: string | number | null;
  status: "ACTIVE" | "PAUSED";
}

type PpcTransaction = postgres.TransactionSql;

interface SearchTermDbRow {
  id: string;
  store_id: string;
  store_name: string;
  report_date: string | Date;
  report_start_date: string | Date;
  report_end_date: string | Date;
  report_granularity: PpcReportGranularity;
  ad_type: PpcAdType;
  portfolio_name: string;
  campaign_name: string;
  ad_group_name: string;
  target_keyword: string;
  customer_search_term: string;
  match_type: MatchType;
  impressions: number;
  clicks: number;
  spend: string | number;
  sales: string | number;
  orders: number;
  units: number;
  cpc: string | number;
  ctr: string | number;
  cvr: string | number;
  acos: string | number;
  roas: string | number;
  campaign_id?: string;
  ad_group_id?: string;
  keyword_id?: string;
}

interface PerformanceDbRow {
  id: string;
  store_id: string;
  store_name: string;
  snapshot_date: string | Date;
  report_start_date: string | Date;
  report_end_date: string | Date;
  report_granularity: PpcReportGranularity;
  ad_type: PpcAdType;
  grain: PpcPerformanceGrain;
  entity_id: string;
  campaign_id: string;
  campaign_name: string;
  ad_group_id: string;
  ad_group_name: string;
  target_id: string;
  target_expression: string;
  match_type: MatchType;
  portfolio_name: string;
  sku: string;
  asin: string;
  state: string;
  campaign_state: string;
  ad_group_state: string;
  targeting_type: string;
  bidding_strategy: string;
  placement: string;
  daily_budget: string | number;
  bid: string | number;
  placement_adjustment: string | number;
  is_negative: boolean;
  impressions: number;
  clicks: number;
  spend: string | number;
  sales: string | number;
  orders: number;
  units: number;
}

interface SyncLogRow {
  id: string;
  source: PpcSyncSource;
  file_name: string | null;
  status: PpcSyncStatus;
  records_count: number | null;
  message: string | null;
  created_at: string | Date;
}

function asNumber(value: string | number | null): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asDateString(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function asIsoString(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function mapStore(row: StoreRow): PpcStore {
  return {
    id: row.id,
    name: row.name,
    marketplace: row.marketplace,
    targetAcos: asNumber(row.target_acos),
    dailyBudget: asNumber(row.daily_budget),
    status: row.status,
  };
}

function mapSearchTerm(row: SearchTermDbRow): PpcSearchTermRow {
  return {
    id: row.id,
    storeId: row.store_id,
    storeName: row.store_name,
    reportDate: asDateString(row.report_date),
    reportStartDate: asDateString(row.report_start_date),
    reportEndDate: asDateString(row.report_end_date),
    reportGranularity: row.report_granularity,
    adType: row.ad_type,
    portfolioName: row.portfolio_name,
    campaignName: row.campaign_name,
    adGroupName: row.ad_group_name,
    targetKeyword: row.target_keyword,
    customerSearchTerm: row.customer_search_term,
    matchType: row.match_type,
    impressions: asNumber(row.impressions),
    clicks: asNumber(row.clicks),
    spend: asNumber(row.spend),
    sales: asNumber(row.sales),
    orders: asNumber(row.orders),
    units: asNumber(row.units),
    cpc: asNumber(row.cpc),
    ctr: asNumber(row.ctr),
    cvr: asNumber(row.cvr),
    acos: asNumber(row.acos),
    roas: asNumber(row.roas),
    campaignId: row.campaign_id || undefined,
    adGroupId: row.ad_group_id || undefined,
    keywordId: row.keyword_id || undefined,
  };
}

function mapPerformance(row: PerformanceDbRow): PpcPerformanceRow {
  return {
    id: row.id,
    storeId: row.store_id,
    storeName: row.store_name,
    snapshotDate: asDateString(row.snapshot_date),
    reportStartDate: asDateString(row.report_start_date),
    reportEndDate: asDateString(row.report_end_date),
    reportGranularity: row.report_granularity,
    adType: row.ad_type,
    grain: row.grain,
    entityId: row.entity_id,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    adGroupId: row.ad_group_id,
    adGroupName: row.ad_group_name,
    targetId: row.target_id,
    targetExpression: row.target_expression,
    matchType: row.match_type,
    portfolioName: row.portfolio_name,
    sku: row.sku,
    asin: row.asin,
    state: row.state,
    campaignState: row.campaign_state,
    adGroupState: row.ad_group_state,
    targetingType: row.targeting_type,
    biddingStrategy: row.bidding_strategy,
    placement: row.placement,
    dailyBudget: asNumber(row.daily_budget),
    bid: asNumber(row.bid),
    placementAdjustment: asNumber(row.placement_adjustment),
    isNegative: row.is_negative,
    impressions: asNumber(row.impressions),
    clicks: asNumber(row.clicks),
    spend: asNumber(row.spend),
    sales: asNumber(row.sales),
    orders: asNumber(row.orders),
    units: asNumber(row.units),
  };
}

export async function listPpcStores(scope: DataScope): Promise<PpcStore[]> {
  const sql = await getDatabaseClient();
  const teamId = (scope as any)?.teamId || "default";
  const rows = await sql<StoreRow[]>`
    SELECT id, name, marketplace, target_acos, daily_budget, status
    FROM ppc_stores
    WHERE team_id = ${teamId}
    ORDER BY lower(name)
  `;
  return rows.map(mapStore);
}

export async function createPpcStore(
  scope: DataScope,
  storeData: {
    name: string;
    marketplace?: string;
    targetAcos?: number;
    dailyBudget?: number;
    status?: "ACTIVE" | "PAUSED";
  }
): Promise<PpcStore> {
  const sql = await getDatabaseClient();
  const teamId = (scope as any)?.teamId || "default";
  const name = storeData.name.trim();
  const marketplace = (storeData.marketplace || "US").trim().toUpperCase();
  const targetAcos = Number(storeData.targetAcos ?? 30.0);
  const dailyBudget = Number(storeData.dailyBudget ?? 500.0);
  const status = storeData.status || "ACTIVE";

  const rows = await sql<StoreRow[]>`
    INSERT INTO ppc_stores (team_id, name, marketplace, target_acos, daily_budget, status)
    VALUES (${teamId}, ${name}, ${marketplace}, ${targetAcos}, ${dailyBudget}, ${status})
    RETURNING id, name, marketplace, target_acos, daily_budget, status
  `;
  return mapStore(rows[0]);
}

export async function findPpcStoreByName(
  scope: DataScope,
  name: string
): Promise<PpcStore | null> {
  const sql = await getDatabaseClient();
  const teamId = (scope as any)?.teamId || "default";
  const rows = await sql<StoreRow[]>`
    SELECT id, name, marketplace, target_acos, daily_budget, status
    FROM ppc_stores
    WHERE team_id = ${teamId} AND LOWER(name) = LOWER(${name.trim()})
    LIMIT 1
  `;
  return rows.length > 0 ? mapStore(rows[0]) : null;
}

export async function updatePpcStore(
  scope: DataScope,
  id: string,
  storeData: {
    name?: string;
    marketplace?: string;
    targetAcos?: number;
    dailyBudget?: number;
    status?: "ACTIVE" | "PAUSED";
  }
): Promise<PpcStore> {
  const sql = await getDatabaseClient();
  const teamId = (scope as any)?.teamId || "default";

  const existing = await sql<StoreRow[]>`
    SELECT id, name, marketplace, target_acos, daily_budget, status
    FROM ppc_stores
    WHERE id = ${id} AND team_id = ${teamId}
  `;
  if (!existing.length) {
    throw new Error("Không tìm thấy gian hàng để cập nhật.");
  }

  const name = storeData.name !== undefined ? storeData.name.trim() : existing[0].name;
  const marketplace = storeData.marketplace !== undefined ? storeData.marketplace.trim().toUpperCase() : existing[0].marketplace;
  const targetAcos = storeData.targetAcos !== undefined ? Number(storeData.targetAcos) : Number(existing[0].target_acos);
  const dailyBudget = storeData.dailyBudget !== undefined ? Number(storeData.dailyBudget) : Number(existing[0].daily_budget);
  const status = storeData.status !== undefined ? storeData.status : existing[0].status;

  const rows = await sql<StoreRow[]>`
    UPDATE ppc_stores
    SET name = ${name}, marketplace = ${marketplace}, target_acos = ${targetAcos}, daily_budget = ${dailyBudget}, status = ${status}
    WHERE id = ${id} AND team_id = ${teamId}
    RETURNING id, name, marketplace, target_acos, daily_budget, status
  `;
  return mapStore(rows[0]);
}

export async function deletePpcStore(
  scope: DataScope,
  id: string
): Promise<{ success: boolean; deletedName: string }> {
  const sql = await getDatabaseClient();
  const teamId = (scope as any)?.teamId || "default";

  const existing = await sql<StoreRow[]>`
    SELECT id, name, marketplace, target_acos, daily_budget, status
    FROM ppc_stores
    WHERE id = ${id} AND team_id = ${teamId}
  `;
  if (!existing.length) {
    throw new Error("Không tìm thấy gian hàng để xóa.");
  }

  const storeName = existing[0].name;
  if (storeName.toUpperCase() === "HSOSTORE") {
    throw new Error("Không thể xóa store mặc định HSOSTORE.");
  }

  // Xóa các dòng phôi liên quan của store này
  // (product_cost_master không có cột team_id — chỉ filter theo store_id UUID)
  await sql`
    DELETE FROM product_cost_master
    WHERE store_id = ${id}::uuid
  `;

  // Xóa store (ppc_stores có cột team_id)
  await sql`
    DELETE FROM ppc_stores
    WHERE id = ${id} AND team_id = ${teamId}
  `;

  return { success: true, deletedName: storeName };
}

export async function listPpcSearchTerms(
  scope: DataScope,
  filters: { storeName: string; sku: string; days: number; startDate?: string; endDate?: string },
  options: { limit?: number; offset?: number } = {},
): Promise<PpcSearchTermRow[]> {
  const sql = await getDatabaseClient();
  const teamId = (scope as any)?.teamId || "default";
  const rows = await sql<SearchTermDbRow[]>`
    WITH anchor AS (
      SELECT COALESCE(MAX(p0.report_date), CURRENT_DATE - 1) AS max_date
      FROM ppc_search_terms p0
      JOIN ppc_stores s0 ON s0.id = p0.store_id
      WHERE s0.team_id = ${teamId}
        AND (${filters.storeName === "ALL"} OR lower(s0.name) = lower(${filters.storeName}))
    ),
    daily_counts AS (
      SELECT p0.store_id, p0.ad_type, COUNT(*) as cnt
      FROM ppc_search_terms p0
      CROSS JOIN anchor a
      WHERE p0.report_granularity = 'DAILY'
        AND (${!filters.startDate} OR p0.report_date >= ${filters.startDate || "1970-01-01"}::date)
        AND (${!filters.endDate} OR p0.report_date <= ${filters.endDate || "2099-12-31"}::date)
        AND (${Boolean(filters.startDate || filters.endDate)} OR (p0.report_date >= a.max_date - (${filters.days} - 1)::integer AND p0.report_date <= a.max_date))
      GROUP BY p0.store_id, p0.ad_type
    ),
    latest_range AS (
      SELECT p0.store_id, p0.ad_type, MAX(p0.report_end_date) as max_end_date
      FROM ppc_search_terms p0
      CROSS JOIN anchor a
      WHERE p0.report_granularity = 'RANGE'
        AND (p0.report_end_date - p0.report_start_date + 1)
          BETWEEN ${filters.days - 3}::integer AND ${filters.days + 3}::integer
        AND p0.report_end_date <= a.max_date
      GROUP BY p0.store_id, p0.ad_type
    )
    SELECT
      t.id, t.store_id, s.name AS store_name, t.report_date,
      t.report_start_date, t.report_end_date, t.report_granularity, t.ad_type,
      t.portfolio_name, t.campaign_name, t.ad_group_name,
      t.target_keyword, t.customer_search_term, t.match_type,
      t.impressions, t.clicks, t.spend, t.sales, t.orders, t.units,
      t.cpc, t.ctr, t.cvr, t.acos, t.roas,
      t.campaign_id, t.ad_group_id, t.keyword_id
    FROM ppc_search_terms t
    JOIN ppc_stores s ON s.id = t.store_id
    CROSS JOIN anchor a
    LEFT JOIN daily_counts dc ON dc.store_id = t.store_id AND dc.ad_type = t.ad_type
    LEFT JOIN latest_range lr ON lr.store_id = t.store_id AND lr.ad_type = t.ad_type
    WHERE s.team_id = ${teamId}
      AND (${filters.storeName === "ALL"} OR lower(s.name) = lower(${filters.storeName}))
      AND (
        ${filters.sku === "ALL"}
        OR lower(t.portfolio_name) = lower(${filters.sku})
        OR position(lower(${filters.sku}) in lower(t.campaign_name)) > 0
      )
      AND (
        (
          t.report_granularity = 'DAILY'
          AND (${!filters.startDate} OR t.report_date >= ${filters.startDate || "1970-01-01"}::date)
          AND (${!filters.endDate} OR t.report_date <= ${filters.endDate || "2099-12-31"}::date)
          AND (${Boolean(filters.startDate || filters.endDate)} OR (t.report_date >= a.max_date - (${filters.days} - 1)::integer AND t.report_date <= a.max_date))
        )
        OR
        (
          t.report_granularity = 'RANGE'
          AND (dc.cnt IS NULL OR dc.cnt = 0)
          AND t.report_end_date = lr.max_end_date
        )
      )
    ORDER BY t.report_date DESC, t.created_at DESC, t.id
    LIMIT ${Math.min(50_000, Math.max(1, options.limit || 20_000))}
    OFFSET ${Math.max(0, options.offset || 0)}
  `;
  return rows.map(mapSearchTerm);
}

export async function listPpcPerformance(
  scope: DataScope,
  filters: { storeName: string; sku: string; days: number },
  options: { grain?: PpcPerformanceGrain; limit?: number; offset?: number } = {},
): Promise<PpcPerformanceRow[]> {
  const sql = await getDatabaseClient();
  const teamId = (scope as any)?.teamId || "default";
  const rows = await sql<PerformanceDbRow[]>`
    WITH latest_snapshots AS (
      SELECT DISTINCT ON (p2.store_id, p2.ad_type)
        p2.store_id, p2.ad_type, p2.snapshot_date AS max_snapshot,
        p2.report_start_date AS max_report_start,
        p2.report_end_date AS max_report_end
      FROM ppc_performance_facts p2
      JOIN ppc_stores s2 ON s2.id = p2.store_id
      WHERE s2.team_id = ${teamId}
        AND (${filters.storeName === "ALL"} OR lower(s2.name) = lower(${filters.storeName}))
        AND (p2.report_end_date - p2.report_start_date + 1)
          BETWEEN ${filters.days - 3}::integer AND ${filters.days + 3}::integer
      ORDER BY p2.store_id, p2.ad_type, p2.snapshot_date DESC, p2.report_end_date DESC
    ), sku_campaigns AS (
      SELECT DISTINCT p3.store_id, p3.ad_type, p3.campaign_id
      FROM ppc_performance_facts p3
      JOIN latest_snapshots ls3
        ON ls3.store_id = p3.store_id
        AND ls3.ad_type = p3.ad_type
        AND ls3.max_snapshot = p3.snapshot_date
        AND ls3.max_report_start = p3.report_start_date
        AND ls3.max_report_end = p3.report_end_date
      WHERE ${filters.sku !== "ALL"}
        AND lower(p3.sku) = lower(${filters.sku})
    )
    SELECT
      p.id, p.store_id, s.name AS store_name, p.snapshot_date,
      p.report_start_date, p.report_end_date, p.report_granularity,
      p.ad_type, p.grain, p.entity_id, p.campaign_id, p.campaign_name,
      p.ad_group_id, p.ad_group_name, p.target_id, p.target_expression,
      p.match_type, p.portfolio_name, p.sku, p.asin, p.state,
      p.campaign_state, p.ad_group_state, p.targeting_type,
      p.bidding_strategy, p.placement, p.daily_budget, p.bid,
      p.placement_adjustment, p.is_negative, p.impressions, p.clicks, p.spend,
      p.sales, p.orders, p.units
    FROM ppc_performance_facts p
    JOIN ppc_stores s ON s.id = p.store_id
    JOIN latest_snapshots ls
      ON ls.store_id = p.store_id
      AND ls.ad_type = p.ad_type
      AND ls.max_snapshot = p.snapshot_date
      AND ls.max_report_start = p.report_start_date
      AND ls.max_report_end = p.report_end_date
    WHERE s.team_id = ${teamId}
      AND (${!options.grain} OR p.grain = ${options.grain || "CAMPAIGN"})
      AND (${filters.storeName === "ALL"} OR lower(s.name) = lower(${filters.storeName}))
      AND (
        ${filters.sku === "ALL"}
        OR lower(p.sku) = lower(${filters.sku})
        OR EXISTS (
          SELECT 1 FROM sku_campaigns sc
          WHERE sc.store_id = p.store_id
            AND sc.ad_type = p.ad_type
            AND sc.campaign_id = p.campaign_id
        )
      )
      AND (p.report_end_date - p.report_start_date + 1)
        BETWEEN ${filters.days - 3}::integer AND ${filters.days + 3}::integer
      AND (
        p.spend > 0 OR p.clicks > 0 OR p.impressions > 0
        OR p.grain IN ('CAMPAIGN', 'AD_GROUP', 'PRODUCT')
      )
    ORDER BY p.ad_type, p.grain, p.spend DESC, p.id
    LIMIT ${Math.min(50_000, Math.max(1, options.limit || 50_000))}
    OFFSET ${Math.max(0, options.offset || 0)}
  `;
  return rows.map(mapPerformance);
}

export interface PpcCampaignPageFilters {
  storeName: string;
  sku: string;
  days: number;
  query: string;
  status: "ALL" | "ACTIVE" | "PAUSED";
  adType: string;
  spendFilter: "ALL" | "HAS_SPEND" | "ZERO_SPEND" | "SPEND_GT_50" | "SPEND_GT_100";
  groupFilter: "ALL" | "BLEEDING" | "HIGH_ACOS" | "GOOD";
  targetAcos: number;
  sortField: "date" | "spend" | "sales" | "orders" | "clicks" | "impressions" | "ctr" | "acos" | "cvr" | "roas";
  sortDirection: "asc" | "desc";
  page: number;
  pageSize: number;
}

export async function listPpcCampaignPage(
  scope: DataScope,
  filters: PpcCampaignPageFilters,
): Promise<{
  rows: PpcPerformanceRow[];
  total: number;
  activeCount: number;
  pausedCount: number;
  totals: { spend: number; sales: number; orders: number; clicks: number; impressions: number };
}> {
  const sql = await getDatabaseClient();
  const teamId = (scope as any)?.teamId || "default";
  const offset = (filters.page - 1) * filters.pageSize;
  const searchWords = filters.query.trim().split(/\s+/).filter(Boolean);
  const searchPattern = searchWords.length > 0 ? `%${searchWords.join("%")}%` : "%";
  const coverageDays = Math.max(1, Math.trunc(filters.days));

  const activeSnapRows = await sql<{ count: string | number }[]>`
    SELECT count(*) as count
    FROM ppc_active_snapshots a
    JOIN ppc_stores s ON s.id = a.store_id
    WHERE s.team_id = ${teamId}
      AND (${filters.storeName === "ALL"} OR lower(s.name) = lower(${filters.storeName}))
      AND a.coverage_days = ${coverageDays}
  `;
  const useSummary = (!filters.sku || filters.sku === "ALL") && Number(activeSnapRows[0]?.count || 0) > 0;
  type CampaignPageDbRow = PerformanceDbRow & {
    filtered_total: string | number;
    active_count: string | number;
    paused_count: string | number;
    total_spend: string | number;
    total_sales: string | number;
    total_orders: string | number;
    total_clicks: string | number;
    total_impressions: string | number;
  };

  let rows: CampaignPageDbRow[];
  if (useSummary) {
    rows = await sql<CampaignPageDbRow[]>`
        WITH base_raw AS (
          SELECT 
            cs.id, cs.store_id, s.name AS store_name, a.report_start_date AS snapshot_date,
            a.report_start_date, a.report_end_date, 'DAILY' AS report_granularity,
            cs.ad_type, 'CAMPAIGN' AS grain, cs.campaign_id AS entity_id,
            cs.campaign_id, cs.campaign_name,
            NULL AS ad_group_id, NULL AS ad_group_name, NULL AS target_id, NULL AS target_expression,
            NULL AS match_type, cs.portfolio_name, NULL AS sku, NULL AS asin,
            cs.campaign_state AS state, cs.campaign_state, NULL AS ad_group_state,
            NULL AS targeting_type, NULL AS bidding_strategy, NULL AS placement,
            cs.daily_budget, NULL AS bid, NULL AS placement_adjustment, false AS is_negative,
            cs.impressions, cs.clicks, cs.spend, cs.sales, cs.orders, cs.units,
            (regexp_match(cs.campaign_name, '(202[3-9][0-1][0-9][0-3][0-9])'))[1] AS explicit_date_token,
            (regexp_match(cs.campaign_name, '(^|[^0-9])(2[3-9](0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01]))([^0-9]|$)'))[2] AS short_date_token,
            (regexp_match(cs.campaign_name, '^[A-Za-z]{2,5}(2[3-9](0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01]))'))[1] AS sku_date_token,
            CASE WHEN cs.impressions > 0 THEN cs.clicks::numeric / cs.impressions * 100 ELSE 0 END AS calc_ctr,
            CASE WHEN cs.clicks > 0 THEN cs.orders::numeric / cs.clicks * 100 ELSE 0 END AS calc_cvr,
            CASE WHEN cs.sales > 0 THEN cs.spend::numeric / cs.sales * 100 ELSE CASE WHEN cs.spend > 0 THEN 999 ELSE 0 END END AS calc_acos,
            CASE WHEN cs.spend > 0 THEN cs.sales::numeric / cs.spend ELSE 0 END AS calc_roas
          FROM ppc_campaign_summary cs
          JOIN ppc_stores s ON s.id = cs.store_id
          JOIN ppc_active_snapshots a ON a.store_id = cs.store_id AND a.snapshot_id = cs.snapshot_id AND a.coverage_days = cs.coverage_days
          WHERE s.team_id = ${teamId}
            AND (${filters.storeName === "ALL"} OR lower(s.name) = lower(${filters.storeName}))
            AND cs.coverage_days = ${coverageDays}
            AND (${filters.sku === "ALL"} OR position(lower(${filters.sku}) in lower(cs.campaign_name)) > 0)
        ), base AS (
          SELECT base_raw.*,
            COALESCE(
              explicit_date_token,
              CASE WHEN short_date_token IS NOT NULL THEN
                CASE
                  WHEN to_char(to_date(short_date_token, 'DDMMYY'), 'DDMMYY') = short_date_token
                    AND (
                      to_char(to_date('20' || short_date_token, 'YYYYMMDD'), 'YYMMDD') <> short_date_token
                      OR to_date('20' || short_date_token, 'YYYYMMDD') > CURRENT_DATE + 180
                      OR abs(to_date(short_date_token, 'DDMMYY') - CURRENT_DATE) < abs(to_date('20' || short_date_token, 'YYYYMMDD') - CURRENT_DATE)
                    )
                  THEN to_char(to_date(short_date_token, 'DDMMYY'), 'YYYYMMDD')
                  WHEN to_char(to_date('20' || short_date_token, 'YYYYMMDD'), 'YYMMDD') = short_date_token
                    AND to_date('20' || short_date_token, 'YYYYMMDD') <= CURRENT_DATE + 180
                  THEN '20' || short_date_token
                  ELSE NULL
                END
              END,
              CASE WHEN sku_date_token IS NOT NULL THEN '20' || sku_date_token END,
              ''
            ) AS campaign_date_key
          FROM base_raw
        ), status_counts AS (
          SELECT count(*) FILTER (WHERE lower(COALESCE(state, '')) = 'enabled') AS active_count,
                 count(*) FILTER (WHERE lower(COALESCE(state, '')) = 'paused') AS paused_count
          FROM base
        ), filtered AS (
          SELECT * FROM base
          WHERE (${!filters.query.trim()} OR campaign_name ILIKE ${searchPattern} OR store_name ILIKE ${searchPattern})
            AND (${filters.status === "ALL"}
              OR (${filters.status === "ACTIVE"} AND lower(COALESCE(state, '')) = 'enabled')
              OR (${filters.status === "PAUSED"} AND lower(COALESCE(state, '')) = 'paused'))
            AND (${filters.adType === "ALL"} OR upper(ad_type) = upper(${filters.adType}))
            AND (${filters.spendFilter === "ALL"}
              OR (${filters.spendFilter === "HAS_SPEND"} AND spend > 0)
              OR (${filters.spendFilter === "ZERO_SPEND"} AND spend = 0)
              OR (${filters.spendFilter === "SPEND_GT_50"} AND spend >= 50)
              OR (${filters.spendFilter === "SPEND_GT_100"} AND spend >= 100))
            AND (${filters.groupFilter === "ALL"}
              OR (${filters.groupFilter === "BLEEDING"} AND orders = 0 AND spend >= 10)
              OR (${filters.groupFilter === "HIGH_ACOS"} AND orders > 0 AND calc_acos > ${filters.targetAcos})
              OR (${filters.groupFilter === "GOOD"} AND orders > 0 AND calc_acos <= ${filters.targetAcos} AND spend >= 5))
        ), totals AS (
          SELECT count(*) AS filtered_total, COALESCE(sum(spend),0) AS total_spend,
            COALESCE(sum(sales),0) AS total_sales, COALESCE(sum(orders),0) AS total_orders,
            COALESCE(sum(clicks),0) AS total_clicks, COALESCE(sum(impressions),0) AS total_impressions
          FROM filtered
        )
        SELECT f.*, t.*, sc.active_count, sc.paused_count
        FROM totals t CROSS JOIN status_counts sc LEFT JOIN filtered f ON true
        ORDER BY
          CASE WHEN ${filters.sortField} = 'date' AND ${filters.sortDirection} = 'asc' THEN campaign_date_key END ASC,
          CASE WHEN ${filters.sortField} = 'date' AND ${filters.sortDirection} = 'desc' THEN campaign_date_key END DESC,
          CASE WHEN ${filters.sortField} = 'spend' AND ${filters.sortDirection} = 'asc' THEN spend END ASC,
          CASE WHEN ${filters.sortField} = 'spend' AND ${filters.sortDirection} = 'desc' THEN spend END DESC,
          CASE WHEN ${filters.sortField} = 'sales' AND ${filters.sortDirection} = 'asc' THEN sales END ASC,
          CASE WHEN ${filters.sortField} = 'sales' AND ${filters.sortDirection} = 'desc' THEN sales END DESC,
          CASE WHEN ${filters.sortField} = 'orders' AND ${filters.sortDirection} = 'asc' THEN orders END ASC,
          CASE WHEN ${filters.sortField} = 'orders' AND ${filters.sortDirection} = 'desc' THEN orders END DESC,
          CASE WHEN ${filters.sortField} = 'clicks' AND ${filters.sortDirection} = 'asc' THEN clicks END ASC,
          CASE WHEN ${filters.sortField} = 'clicks' AND ${filters.sortDirection} = 'desc' THEN clicks END DESC,
          CASE WHEN ${filters.sortField} = 'impressions' AND ${filters.sortDirection} = 'asc' THEN impressions END ASC,
          CASE WHEN ${filters.sortField} = 'impressions' AND ${filters.sortDirection} = 'desc' THEN impressions END DESC,
          CASE WHEN ${filters.sortField} = 'ctr' AND ${filters.sortDirection} = 'asc' THEN calc_ctr END ASC,
          CASE WHEN ${filters.sortField} = 'ctr' AND ${filters.sortDirection} = 'desc' THEN calc_ctr END DESC,
          CASE WHEN ${filters.sortField} = 'acos' AND ${filters.sortDirection} = 'asc' THEN calc_acos END ASC,
          CASE WHEN ${filters.sortField} = 'acos' AND ${filters.sortDirection} = 'desc' THEN calc_acos END DESC,
          CASE WHEN ${filters.sortField} = 'cvr' AND ${filters.sortDirection} = 'asc' THEN calc_cvr END ASC,
          CASE WHEN ${filters.sortField} = 'cvr' AND ${filters.sortDirection} = 'desc' THEN calc_cvr END DESC,
          CASE WHEN ${filters.sortField} = 'roas' AND ${filters.sortDirection} = 'asc' THEN calc_roas END ASC,
          CASE WHEN ${filters.sortField} = 'roas' AND ${filters.sortDirection} = 'desc' THEN calc_roas END DESC,
          spend DESC, campaign_id ASC, id ASC
        LIMIT ${filters.pageSize} OFFSET ${offset}
      `;
  } else {
    rows = await sql<CampaignPageDbRow[]>`
        WITH latest_snapshots AS (
          SELECT DISTINCT ON (p2.store_id, p2.ad_type)
            p2.store_id, p2.ad_type, p2.snapshot_date, p2.report_start_date, p2.report_end_date
          FROM ppc_performance_facts p2
          JOIN ppc_stores s2 ON s2.id = p2.store_id
          WHERE s2.team_id = ${teamId}
            AND (${filters.storeName === "ALL"} OR lower(s2.name) = lower(${filters.storeName}))
            AND (p2.report_end_date - p2.report_start_date + 1)
              BETWEEN ${filters.days - 3}::integer AND ${filters.days + 3}::integer
          ORDER BY p2.store_id, p2.ad_type, p2.snapshot_date DESC, p2.report_end_date DESC
        ), base_raw AS (
          SELECT 
            p.id, p.store_id, s.name AS store_name, p.snapshot_date,
            p.report_start_date, p.report_end_date, p.report_granularity,
            p.ad_type, p.grain, p.entity_id, p.campaign_id, p.campaign_name,
            p.ad_group_id, p.ad_group_name, p.target_id, p.target_expression,
            p.match_type, p.portfolio_name, p.sku, p.asin, p.state,
            p.campaign_state, p.ad_group_state, p.targeting_type,
            p.bidding_strategy, p.placement, p.daily_budget, p.bid,
            p.placement_adjustment, p.is_negative, p.impressions, p.clicks, p.spend,
            p.sales, p.orders, p.units,
            (regexp_match(p.campaign_name, '(202[3-9][0-1][0-9][0-3][0-9])'))[1] AS explicit_date_token,
            (regexp_match(p.campaign_name, '(^|[^0-9])(2[3-9](0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01]))([^0-9]|$)'))[2] AS short_date_token,
            (regexp_match(p.campaign_name, '^[A-Za-z]{2,5}(2[3-9](0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01]))'))[1] AS sku_date_token,
            CASE WHEN p.impressions > 0 THEN p.clicks::numeric / p.impressions * 100 ELSE 0 END AS calc_ctr,
            CASE WHEN p.clicks > 0 THEN p.orders::numeric / p.clicks * 100 ELSE 0 END AS calc_cvr,
            CASE WHEN p.sales > 0 THEN p.spend::numeric / p.sales * 100 ELSE CASE WHEN p.spend > 0 THEN 999 ELSE 0 END END AS calc_acos,
            CASE WHEN p.spend > 0 THEN p.sales::numeric / p.spend ELSE 0 END AS calc_roas
          FROM ppc_performance_facts p
          JOIN ppc_stores s ON s.id = p.store_id
          JOIN latest_snapshots ls
            ON ls.store_id = p.store_id AND ls.ad_type = p.ad_type
            AND ls.snapshot_date = p.snapshot_date AND ls.report_start_date = p.report_start_date AND ls.report_end_date = p.report_end_date
          WHERE s.team_id = ${teamId}
            AND p.grain = 'CAMPAIGN'
            AND (${filters.storeName === "ALL"} OR lower(s.name) = lower(${filters.storeName}))
            AND (${filters.sku === "ALL"} OR position(lower(${filters.sku}) in lower(p.campaign_name)) > 0)
        ), base AS (
          SELECT base_raw.*,
            COALESCE(
              explicit_date_token,
              CASE WHEN short_date_token IS NOT NULL THEN
                CASE
                  WHEN to_char(to_date(short_date_token, 'DDMMYY'), 'DDMMYY') = short_date_token
                    AND (
                      to_char(to_date('20' || short_date_token, 'YYYYMMDD'), 'YYMMDD') <> short_date_token
                      OR to_date('20' || short_date_token, 'YYYYMMDD') > CURRENT_DATE + 180
                      OR abs(to_date(short_date_token, 'DDMMYY') - CURRENT_DATE) < abs(to_date('20' || short_date_token, 'YYYYMMDD') - CURRENT_DATE)
                    )
                  THEN to_char(to_date(short_date_token, 'DDMMYY'), 'YYYYMMDD')
                  WHEN to_char(to_date('20' || short_date_token, 'YYYYMMDD'), 'YYMMDD') = short_date_token
                    AND to_date('20' || short_date_token, 'YYYYMMDD') <= CURRENT_DATE + 180
                  THEN '20' || short_date_token
                  ELSE NULL
                END
              END,
              CASE WHEN sku_date_token IS NOT NULL THEN '20' || sku_date_token END,
              ''
            ) AS campaign_date_key
          FROM base_raw
        ), status_counts AS (
      SELECT count(*) FILTER (WHERE lower(COALESCE(state, '')) = 'enabled') AS active_count,
             count(*) FILTER (WHERE lower(COALESCE(state, '')) = 'paused') AS paused_count
      FROM base
    ), filtered AS (
      SELECT * FROM base
      WHERE (${!filters.query.trim()} OR campaign_name ILIKE ${searchPattern} OR store_name ILIKE ${searchPattern} OR sku ILIKE ${searchPattern})
        AND (${filters.status === "ALL"}
          OR (${filters.status === "ACTIVE"} AND lower(COALESCE(state, '')) = 'enabled')
          OR (${filters.status === "PAUSED"} AND lower(COALESCE(state, '')) = 'paused'))
        AND (${filters.adType === "ALL"} OR upper(ad_type) = upper(${filters.adType}))
        AND (${filters.spendFilter === "ALL"}
          OR (${filters.spendFilter === "HAS_SPEND"} AND spend > 0)
          OR (${filters.spendFilter === "ZERO_SPEND"} AND spend = 0)
          OR (${filters.spendFilter === "SPEND_GT_50"} AND spend >= 50)
          OR (${filters.spendFilter === "SPEND_GT_100"} AND spend >= 100))
        AND (${filters.groupFilter === "ALL"}
          OR (${filters.groupFilter === "BLEEDING"} AND orders = 0 AND spend >= 10)
          OR (${filters.groupFilter === "HIGH_ACOS"} AND orders > 0 AND calc_acos > ${filters.targetAcos})
          OR (${filters.groupFilter === "GOOD"} AND orders > 0 AND calc_acos <= ${filters.targetAcos} AND spend >= 5))
    ), totals AS (
      SELECT count(*) AS filtered_total, COALESCE(sum(spend),0) AS total_spend,
        COALESCE(sum(sales),0) AS total_sales, COALESCE(sum(orders),0) AS total_orders,
        COALESCE(sum(clicks),0) AS total_clicks, COALESCE(sum(impressions),0) AS total_impressions
      FROM filtered
    )
    SELECT f.*, t.*, sc.active_count, sc.paused_count
    FROM totals t CROSS JOIN status_counts sc LEFT JOIN filtered f ON true
    ORDER BY
      CASE WHEN ${filters.sortField} = 'date' AND ${filters.sortDirection} = 'asc' THEN campaign_date_key END ASC,
      CASE WHEN ${filters.sortField} = 'date' AND ${filters.sortDirection} = 'desc' THEN campaign_date_key END DESC,
      CASE WHEN ${filters.sortField} = 'spend' AND ${filters.sortDirection} = 'asc' THEN spend END ASC,
      CASE WHEN ${filters.sortField} = 'spend' AND ${filters.sortDirection} = 'desc' THEN spend END DESC,
      CASE WHEN ${filters.sortField} = 'sales' AND ${filters.sortDirection} = 'asc' THEN sales END ASC,
      CASE WHEN ${filters.sortField} = 'sales' AND ${filters.sortDirection} = 'desc' THEN sales END DESC,
      CASE WHEN ${filters.sortField} = 'orders' AND ${filters.sortDirection} = 'asc' THEN orders END ASC,
      CASE WHEN ${filters.sortField} = 'orders' AND ${filters.sortDirection} = 'desc' THEN orders END DESC,
      CASE WHEN ${filters.sortField} = 'clicks' AND ${filters.sortDirection} = 'asc' THEN clicks END ASC,
      CASE WHEN ${filters.sortField} = 'clicks' AND ${filters.sortDirection} = 'desc' THEN clicks END DESC,
      CASE WHEN ${filters.sortField} = 'impressions' AND ${filters.sortDirection} = 'asc' THEN impressions END ASC,
      CASE WHEN ${filters.sortField} = 'impressions' AND ${filters.sortDirection} = 'desc' THEN impressions END DESC,
      CASE WHEN ${filters.sortField} = 'ctr' AND ${filters.sortDirection} = 'asc' THEN calc_ctr END ASC,
      CASE WHEN ${filters.sortField} = 'ctr' AND ${filters.sortDirection} = 'desc' THEN calc_ctr END DESC,
      CASE WHEN ${filters.sortField} = 'acos' AND ${filters.sortDirection} = 'asc' THEN calc_acos END ASC,
      CASE WHEN ${filters.sortField} = 'acos' AND ${filters.sortDirection} = 'desc' THEN calc_acos END DESC,
      CASE WHEN ${filters.sortField} = 'cvr' AND ${filters.sortDirection} = 'asc' THEN calc_cvr END ASC,
      CASE WHEN ${filters.sortField} = 'cvr' AND ${filters.sortDirection} = 'desc' THEN calc_cvr END DESC,
      CASE WHEN ${filters.sortField} = 'roas' AND ${filters.sortDirection} = 'asc' THEN calc_roas END ASC,
      CASE WHEN ${filters.sortField} = 'roas' AND ${filters.sortDirection} = 'desc' THEN calc_roas END DESC,
      spend DESC, campaign_id ASC, id ASC
    LIMIT ${filters.pageSize} OFFSET ${offset}
    `;
  }

  const first = rows[0];
  return {
    rows: rows.filter((row) => Boolean(row.id)).map(mapPerformance),
    total: Number(first?.filtered_total || 0),
    activeCount: Number(first?.active_count || 0),
    pausedCount: Number(first?.paused_count || 0),
    totals: {
      spend: Number(first?.total_spend || 0), sales: Number(first?.total_sales || 0),
      orders: Number(first?.total_orders || 0), clicks: Number(first?.total_clicks || 0),
      impressions: Number(first?.total_impressions || 0),
    },
  };
}

export async function listPpcSyncLogs(scope: DataScope, limit = 10): Promise<PpcSyncLog[]> {
  const sql = await getDatabaseClient();
  const teamId = (scope as any)?.teamId || "default";
  const rows = await sql<SyncLogRow[]>`
    SELECT id, source, file_name, status, records_count, message, created_at
    FROM ppc_sync_logs
    WHERE team_id = ${teamId}
    ORDER BY created_at DESC
    LIMIT ${Math.max(1, Math.min(50, limit))}
  `;
  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    fileName: row.file_name,
    status: row.status,
    count: row.records_count ?? 0,
    message: row.message,
    time: asIsoString(row.created_at),
  }));
}

export async function hasSuccessfulPpcSync(
  scope: DataScope,
  source: PpcSyncSource,
  fileName: string,
  sourceVersion: string,
): Promise<boolean> {
  const sql = await getDatabaseClient();
  const teamId = (scope as any)?.teamId || "default";
  const rows = await sql<{ found: boolean }[]>`
    SELECT EXISTS(
      SELECT 1 FROM ppc_sync_logs
      WHERE team_id = ${teamId}
        AND source = ${source}
        AND file_name = ${fileName}
        AND source_version = ${sourceVersion}
        AND status = 'SUCCESS'
    ) AS found
  `;
  return rows[0]?.found ?? false;
}

export async function recordPpcSyncLog(
  scope: DataScope,
  input: {
    source: PpcSyncSource;
    fileName?: string;
    sourceVersion?: string;
    status: PpcSyncStatus;
    count?: number;
    message?: string;
  },
): Promise<void> {
  const sql = await getDatabaseClient();
  const teamId = (scope as any)?.teamId || "default";
  await sql`
    INSERT INTO ppc_sync_logs (
      team_id, source, file_name, source_version, status, records_count, message
    ) VALUES (
      ${teamId}, ${input.source}, ${input.fileName || null},
      ${input.sourceVersion || null}, ${input.status}, ${input.count || 0},
      ${input.message || null}
    )
    ON CONFLICT DO NOTHING
  `;
}

export async function clearPpcSyncLogs(scope: DataScope): Promise<void> {
  const sql = await getDatabaseClient();
  const teamId = (scope as any)?.teamId || "default";
  await sql`DELETE FROM ppc_sync_logs WHERE team_id = ${teamId}`;
}

function safeSqlString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\0/g, "").trim();
}

function rowIdentity(row: PpcSearchTermRow): string {
  return [
    row.adType || "UNKNOWN", row.reportStartDate || row.reportDate, row.reportEndDate || row.reportDate,
    safeSqlString(row.portfolioName),
    safeSqlString(row.campaignName),
    safeSqlString(row.adGroupName),
    safeSqlString(row.targetKeyword),
    safeSqlString(row.customerSearchTerm),
    safeSqlString(row.matchType),
  ].join(":::");
}

export async function upsertPpcSearchTerms(
  scope: DataScope,
  storeName: string,
  rows: PpcSearchTermRow[],
  options: { replaceExisting?: boolean; transaction?: PpcTransaction } = {},
): Promise<{ inserted: number; updated: number; deduplicated: number }> {
  const sql = await getDatabaseClient();
  const teamId = (scope as any)?.teamId || "default";
  const uniqueRows = Array.from(new Map(rows.map((row) => [rowIdentity(row), row])).values());

  const operation = async (transaction: PpcTransaction) => {
    const storeRows = await transaction<StoreRow[]>`
      INSERT INTO ppc_stores (team_id, name)
      VALUES (${teamId}, ${storeName})
      ON CONFLICT (team_id, name) DO UPDATE SET updated_at = NOW()
      RETURNING id, name, marketplace, target_acos, daily_budget, status
    `;
    const storeId = storeRows[0].id;
    if (options.replaceExisting) {
      const scopes = Array.from(new Set(uniqueRows.map((row) => [
        row.adType || "UNKNOWN", row.reportStartDate || row.reportDate, row.reportEndDate || row.reportDate,
      ].join(":::"))));
      for (const item of scopes) {
        const [adType, startDate, endDate] = item.split(":::");
        await transaction`
          DELETE FROM ppc_search_terms
          WHERE store_id = ${storeId} AND ad_type = ${adType}
            AND report_start_date = ${startDate} AND report_end_date = ${endDate}
        `;
      }
    }
    let inserted = 0;
    let updated = 0;
    for (let start = 0; start < uniqueRows.length; start += 500) {
      const chunk = uniqueRows.slice(start, start + 500).map((row) => ({
        store_id: storeId,
        report_date: safeSqlString(row.reportDate),
        report_start_date: safeSqlString(row.reportStartDate || row.reportDate),
        report_end_date: safeSqlString(row.reportEndDate || row.reportDate),
        report_granularity: safeSqlString(row.reportGranularity || "DAILY"),
        ad_type: safeSqlString(row.adType || "UNKNOWN"),
        portfolio_name: safeSqlString(row.portfolioName),
        campaign_name: safeSqlString(row.campaignName),
        ad_group_name: safeSqlString(row.adGroupName),
        target_keyword: safeSqlString(row.targetKeyword),
        customer_search_term: safeSqlString(row.customerSearchTerm),
        match_type: safeSqlString(row.matchType),
        impressions: row.impressions,
        clicks: row.clicks,
        spend: row.spend,
        sales: row.sales,
        orders: row.orders,
        units: row.units,
        cpc: row.cpc,
        ctr: row.ctr,
        cvr: row.cvr,
        acos: row.acos,
      }));
      const saved = await transaction<{ inserted: boolean }[]>`
        INSERT INTO ppc_search_terms ${transaction(chunk)}
        ON CONFLICT (
          store_id,
          report_start_date,
          report_end_date,
          ad_type,
          portfolio_name,
          campaign_name,
          ad_group_name,
          target_keyword,
          customer_search_term,
          match_type
        )
        DO UPDATE SET
          report_date = EXCLUDED.report_date,
          report_granularity = EXCLUDED.report_granularity,
          impressions = EXCLUDED.impressions,
          clicks = EXCLUDED.clicks,
          spend = EXCLUDED.spend,
          sales = EXCLUDED.sales,
          orders = EXCLUDED.orders,
          units = EXCLUDED.units,
          cpc = EXCLUDED.cpc,
          ctr = EXCLUDED.ctr,
          cvr = EXCLUDED.cvr,
          acos = EXCLUDED.acos,
          updated_at = NOW()
        RETURNING (xmax = 0) AS inserted
      `;
      for (const row of saved) {
        if (row.inserted) inserted += 1;
        else updated += 1;
      }
    }

    await refreshPpcDailySummary(scope, storeId, transaction);

    return { inserted, updated, deduplicated: rows.length - uniqueRows.length };
  };
  return options.transaction ? operation(options.transaction) : sql.begin(operation);
}

export async function refreshPpcDailySummary(
  scope: DataScope,
  storeId?: string,
  client?: any,
): Promise<void> {
  const sql = client || await getDatabaseClient();
  const teamId = (scope as any)?.teamId || "default";
  // Check if true 1-day CAMPAIGN rows exist in Bulk
  const bulkDailyCount = await sql<{ count: string | number }[]>`
    SELECT count(*) as count
    FROM ppc_performance_facts p
    JOIN ppc_stores s ON s.id = p.store_id
    WHERE s.team_id = ${teamId}
      AND (${!storeId} OR p.store_id = ${storeId || null}::uuid)
      AND p.grain = 'CAMPAIGN'
      AND p.report_start_date = p.report_end_date
  `;

  await sql`
    DELETE FROM ppc_daily_summary d
    USING ppc_stores s
    WHERE d.store_id = s.id
      AND s.team_id = ${teamId}
      AND (${!storeId} OR d.store_id = ${storeId || null}::uuid)
  `;

  if (Number(bulkDailyCount[0]?.count || 0) > 0) {
    await sql`
      INSERT INTO ppc_daily_summary (
        store_id, report_date, ad_type,
        impressions, clicks, spend, sales, orders, units,
        cpc, ctr, cvr, acos, roas, updated_at
      )
      SELECT
        p.store_id,
        p.report_end_date,
        COALESCE(p.ad_type, 'UNKNOWN') AS ad_type,
        COALESCE(SUM(p.impressions), 0) AS impressions,
        COALESCE(SUM(p.clicks), 0) AS clicks,
        COALESCE(SUM(p.spend), 0) AS spend,
        COALESCE(SUM(p.sales), 0) AS sales,
        COALESCE(SUM(p.orders), 0) AS orders,
        COALESCE(SUM(p.units), 0) AS units,
        CASE WHEN SUM(p.clicks) > 0 THEN ROUND((SUM(p.spend) / SUM(p.clicks))::numeric, 2) ELSE 0 END AS cpc,
        CASE WHEN SUM(p.impressions) > 0 THEN ROUND((SUM(p.clicks)::numeric / SUM(p.impressions)::numeric) * 100, 4) ELSE 0 END AS ctr,
        CASE WHEN SUM(p.clicks) > 0 THEN ROUND((SUM(p.orders)::numeric / SUM(p.clicks)::numeric) * 100, 4) ELSE 0 END AS cvr,
        CASE WHEN SUM(p.sales) > 0 THEN ROUND((SUM(p.spend) / SUM(p.sales) * 100)::numeric, 2) ELSE (CASE WHEN SUM(p.spend) > 0 THEN 999 ELSE 0 END) END AS acos,
        CASE WHEN SUM(p.spend) > 0 THEN ROUND((SUM(p.sales) / SUM(p.spend))::numeric, 2) ELSE 0 END AS roas,
        NOW() AS updated_at
      FROM ppc_performance_facts p
      JOIN ppc_stores s ON s.id = p.store_id
      WHERE s.team_id = ${teamId}
        AND (${!storeId} OR p.store_id = ${storeId || null}::uuid)
        AND p.grain = 'CAMPAIGN'
        AND p.report_start_date = p.report_end_date
      GROUP BY p.store_id, p.report_end_date, COALESCE(p.ad_type, 'UNKNOWN')
      ON CONFLICT (store_id, report_date, ad_type)
      DO UPDATE SET
        impressions = EXCLUDED.impressions,
        clicks = EXCLUDED.clicks,
        spend = EXCLUDED.spend,
        sales = EXCLUDED.sales,
        orders = EXCLUDED.orders,
        units = EXCLUDED.units,
        cpc = EXCLUDED.cpc,
        ctr = EXCLUDED.ctr,
        cvr = EXCLUDED.cvr,
        acos = EXCLUDED.acos,
        roas = EXCLUDED.roas,
        updated_at = NOW();
    `;
  } else {
    // Fallback: Populate daily summary from Search Term report (which provides genuine daily records)
    await sql`
      INSERT INTO ppc_daily_summary (
        store_id, report_date, ad_type,
        impressions, clicks, spend, sales, orders, units,
        cpc, ctr, cvr, acos, roas, updated_at
      )
      SELECT
        p.store_id,
        p.report_date,
        COALESCE(p.ad_type, 'UNKNOWN') AS ad_type,
        COALESCE(SUM(p.impressions), 0) AS impressions,
        COALESCE(SUM(p.clicks), 0) AS clicks,
        COALESCE(SUM(p.spend), 0) AS spend,
        COALESCE(SUM(p.sales), 0) AS sales,
        COALESCE(SUM(p.orders), 0) AS orders,
        COALESCE(SUM(p.units), 0) AS units,
        CASE WHEN SUM(p.clicks) > 0 THEN ROUND((SUM(p.spend) / SUM(p.clicks))::numeric, 2) ELSE 0 END AS cpc,
        CASE WHEN SUM(p.impressions) > 0 THEN ROUND((SUM(p.clicks)::numeric / SUM(p.impressions)::numeric) * 100, 4) ELSE 0 END AS ctr,
        CASE WHEN SUM(p.clicks) > 0 THEN ROUND((SUM(p.orders)::numeric / SUM(p.clicks)::numeric) * 100, 4) ELSE 0 END AS cvr,
        CASE WHEN SUM(p.sales) > 0 THEN ROUND((SUM(p.spend) / SUM(p.sales) * 100)::numeric, 2) ELSE (CASE WHEN SUM(p.spend) > 0 THEN 999 ELSE 0 END) END AS acos,
        CASE WHEN SUM(p.spend) > 0 THEN ROUND((SUM(p.sales) / SUM(p.spend))::numeric, 2) ELSE 0 END AS roas,
        NOW() AS updated_at
      FROM ppc_search_terms p
      JOIN ppc_stores s ON s.id = p.store_id
      WHERE s.team_id = ${teamId}
        AND (${!storeId} OR p.store_id = ${storeId || null}::uuid)
        AND p.report_date IS NOT NULL
      GROUP BY p.store_id, p.report_date, COALESCE(p.ad_type, 'UNKNOWN')
      ON CONFLICT (store_id, report_date, ad_type)
      DO UPDATE SET
        impressions = EXCLUDED.impressions,
        clicks = EXCLUDED.clicks,
        spend = EXCLUDED.spend,
        sales = EXCLUDED.sales,
        orders = EXCLUDED.orders,
        units = EXCLUDED.units,
        cpc = EXCLUDED.cpc,
        ctr = EXCLUDED.ctr,
        cvr = EXCLUDED.cvr,
        acos = EXCLUDED.acos,
        roas = EXCLUDED.roas,
        updated_at = NOW();
    `;
  }
}

function performanceIdentity(row: PpcPerformanceRow): string {
  return [
    safeSqlString(row.entityId),
    safeSqlString(row.sku),
    safeSqlString(row.placement),
  ].join(":::");
}

export async function getActiveSnapshotId(
  scope: DataScope,
  storeName: string,
  days: number = 30,
): Promise<string> {
  const sql = await getDatabaseClient();
  const teamId = (scope as any)?.teamId || "default";
  const coverageDays = Math.max(1, Math.trunc(days));
  const rows = await sql<{ snapshot_id: string }[]>`
    SELECT a.snapshot_id
    FROM ppc_active_snapshots a
    JOIN ppc_stores s ON s.id = a.store_id
    WHERE s.team_id = ${teamId}
      AND (${storeName === "ALL"} OR lower(s.name) = lower(${storeName}))
      AND a.coverage_days = ${coverageDays}
    ORDER BY a.activated_at DESC
    LIMIT 1
  `;
  return rows[0]?.snapshot_id || "no-snap";
}

export async function refreshPpcSnapshotSummary(
  scope: DataScope,
  storeId: string,
  snapshotDate: string,
  reportStartDate: string,
  reportEndDate: string,
  options: { transaction?: PpcTransaction } = {},
): Promise<{ snapshotId: string; coverageDays: number }> {
  const sql = await getDatabaseClient();
  const teamId = (scope as any)?.teamId || "default";

  const operation = async (tx: PpcTransaction) => {
    const start = new Date(reportStartDate);
    const end = new Date(reportEndDate);
    const spanDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const coverageDays = canonicalCoverageDays(spanDays);
    const snapshotId = `snap_${storeId.replace(/-/g, "").slice(0, 8)}_${snapshotDate}_${coverageDays}_${Date.now()}`;

    // 1. Campaign summary
    await tx`
      WITH camp_targets AS (
        SELECT 
          campaign_id,
          count(*) FILTER (WHERE NOT is_negative) as target_count,
          count(*) FILTER (WHERE NOT is_negative AND lower(COALESCE(state, '')) = 'enabled') as active_target_count
        FROM ppc_performance_facts
        WHERE store_id = ${storeId}
          AND snapshot_date = ${snapshotDate}
          AND report_start_date = ${reportStartDate}
          AND report_end_date = ${reportEndDate}
          AND grain = 'TARGET'
        GROUP BY campaign_id
      )
      INSERT INTO ppc_campaign_summary (
        team_id, store_id, snapshot_id, coverage_days, ad_type,
        campaign_id, campaign_name, campaign_state, portfolio_name,
        daily_budget, impressions, clicks, spend, sales, orders, units,
        target_count, active_target_count, updated_at
      )
      SELECT 
        ${teamId}, c.store_id, ${snapshotId}, ${coverageDays}, c.ad_type,
        c.campaign_id, c.campaign_name, COALESCE(NULLIF(c.campaign_state, ''), NULLIF(c.state, ''), 'paused') AS campaign_state, c.portfolio_name,
        COALESCE(c.daily_budget, 0), c.impressions, c.clicks, c.spend, c.sales, c.orders, c.units,
        COALESCE(t.target_count, 0), COALESCE(t.active_target_count, 0), NOW()
      FROM ppc_performance_facts c
      LEFT JOIN camp_targets t ON t.campaign_id = c.campaign_id
      WHERE c.store_id = ${storeId}
        AND c.snapshot_date = ${snapshotDate}
        AND c.report_start_date = ${reportStartDate}
        AND c.report_end_date = ${reportEndDate}
        AND c.grain = 'CAMPAIGN'
      ON CONFLICT (store_id, snapshot_id, coverage_days, ad_type, campaign_id)
      DO UPDATE SET
        campaign_name = EXCLUDED.campaign_name,
        campaign_state = EXCLUDED.campaign_state,
        portfolio_name = EXCLUDED.portfolio_name,
        daily_budget = EXCLUDED.daily_budget,
        impressions = EXCLUDED.impressions,
        clicks = EXCLUDED.clicks,
        spend = EXCLUDED.spend,
        sales = EXCLUDED.sales,
        orders = EXCLUDED.orders,
        units = EXCLUDED.units,
        target_count = EXCLUDED.target_count,
        active_target_count = EXCLUDED.active_target_count,
        updated_at = NOW();
    `;

    // 2. SKU summary
    await tx`
      INSERT INTO ppc_sku_summary (
        team_id, store_id, snapshot_id, coverage_days, ad_type,
        sku, product_type, campaign_count, target_count,
        impressions, clicks, spend, sales, orders, units, updated_at
      )
      SELECT 
        ${teamId}, p.store_id, ${snapshotId}, ${coverageDays}, p.ad_type,
        p.sku, NULL, COUNT(DISTINCT p.campaign_id), 0,
        COALESCE(SUM(p.impressions), 0), COALESCE(SUM(p.clicks), 0),
        COALESCE(SUM(p.spend), 0), COALESCE(SUM(p.sales), 0),
        COALESCE(SUM(p.orders), 0), COALESCE(SUM(p.units), 0),
        NOW()
      FROM ppc_performance_facts p
      WHERE p.store_id = ${storeId}
        AND p.snapshot_date = ${snapshotDate}
        AND p.report_start_date = ${reportStartDate}
        AND p.report_end_date = ${reportEndDate}
        AND p.grain = 'PRODUCT' AND p.sku IS NOT NULL AND p.sku != ''
      GROUP BY p.store_id, p.ad_type, p.sku
      ON CONFLICT (store_id, snapshot_id, coverage_days, ad_type, sku)
      DO UPDATE SET
        campaign_count = EXCLUDED.campaign_count,
        impressions = EXCLUDED.impressions,
        clicks = EXCLUDED.clicks,
        spend = EXCLUDED.spend,
        sales = EXCLUDED.sales,
        orders = EXCLUDED.orders,
        units = EXCLUDED.units,
        updated_at = NOW();
    `;

    // 3. Target breakdown summary
    await tx`
      INSERT INTO ppc_target_breakdown_summary (
        team_id, store_id, snapshot_id, coverage_days, ad_type,
        target_type, keyword_match_type,
        impressions, clicks, spend, sales, orders, units, updated_at
      )
      SELECT 
        ${teamId}, p.store_id, ${snapshotId}, ${coverageDays}, p.ad_type,
        CASE
          WHEN lower(p.target_expression) IN ('close-match', 'loose-match', 'substitutes', 'complements')
               OR lower(p.target_expression) LIKE '%auto targeting%' THEN 'Auto'
          WHEN upper(p.match_type) = 'TARGETING'
               OR lower(p.target_expression) LIKE 'asin=%'
               OR lower(p.target_expression) LIKE 'asin-expanded=%'
               OR lower(p.target_expression) LIKE 'category=%' THEN 'Product Targeting'
          ELSE 'Keyword'
        END AS target_type,
        CASE
          WHEN upper(p.match_type) LIKE '%EXACT%' THEN 'Exact'
          WHEN upper(p.match_type) LIKE '%PHRASE%' THEN 'Phrase'
          WHEN upper(p.match_type) LIKE '%BROAD%' THEN 'Broad'
          ELSE 'Unknown'
        END AS keyword_match_type,
        COALESCE(SUM(p.impressions), 0), COALESCE(SUM(p.clicks), 0),
        COALESCE(SUM(p.spend), 0), COALESCE(SUM(p.sales), 0),
        COALESCE(SUM(p.orders), 0), COALESCE(SUM(p.units), 0),
        NOW()
      FROM ppc_performance_facts p
      WHERE p.store_id = ${storeId}
        AND p.snapshot_date = ${snapshotDate}
        AND p.report_start_date = ${reportStartDate}
        AND p.report_end_date = ${reportEndDate}
        AND p.grain = 'TARGET' AND NOT p.is_negative
        AND (p.spend > 0 OR p.clicks > 0 OR p.impressions > 0)
      GROUP BY p.store_id, p.ad_type, 6, 7
      ON CONFLICT (store_id, snapshot_id, coverage_days, ad_type, target_type, keyword_match_type)
      DO UPDATE SET
        impressions = EXCLUDED.impressions,
        clicks = EXCLUDED.clicks,
        spend = EXCLUDED.spend,
        sales = EXCLUDED.sales,
        orders = EXCLUDED.orders,
        units = EXCLUDED.units,
        updated_at = NOW();
    `;

    // 4. Snapshot summary
    await tx`
      WITH camp_stats AS (
        SELECT 
          ad_type,
          count(*) as campaign_count,
          count(*) FILTER (
            WHERE lower(COALESCE(NULLIF(campaign_state, ''), NULLIF(state, ''), '')) = 'enabled'
          ) as active_campaign_count,
          COALESCE(SUM(spend), 0) as spend,
          COALESCE(SUM(sales), 0) as sales,
          COALESCE(SUM(orders), 0) as orders,
          COALESCE(SUM(units), 0) as units,
          COALESCE(SUM(clicks), 0) as clicks,
          COALESCE(SUM(impressions), 0) as impressions
        FROM ppc_performance_facts
        WHERE store_id = ${storeId}
          AND snapshot_date = ${snapshotDate}
          AND report_start_date = ${reportStartDate}
          AND report_end_date = ${reportEndDate}
          AND grain = 'CAMPAIGN'
        GROUP BY ad_type
      ),
      target_stats AS (
        SELECT 
          ad_type,
          count(*) FILTER (
            WHERE NOT is_negative
              AND (spend > 0 OR clicks > 0 OR impressions > 0)
          ) as target_count,
          count(*) FILTER (
            WHERE NOT is_negative
              AND lower(COALESCE(state, '')) = 'enabled'
          ) as active_target_count
        FROM ppc_performance_facts
        WHERE store_id = ${storeId}
          AND snapshot_date = ${snapshotDate}
          AND report_start_date = ${reportStartDate}
          AND report_end_date = ${reportEndDate}
          AND grain = 'TARGET'
        GROUP BY ad_type
      ),
      sku_stats AS (
        SELECT 
          ad_type,
          count(DISTINCT sku) as sku_count
        FROM ppc_performance_facts
        WHERE store_id = ${storeId}
          AND snapshot_date = ${snapshotDate}
          AND report_start_date = ${reportStartDate}
          AND report_end_date = ${reportEndDate}
          AND grain = 'PRODUCT' AND sku IS NOT NULL AND sku != ''
        GROUP BY ad_type
      )
      INSERT INTO ppc_snapshot_summary (
        team_id, store_id, snapshot_id, coverage_days, ad_type,
        report_start_date, report_end_date,
        campaign_count, active_campaign_count,
        target_count, active_target_count, sku_count,
        impressions, clicks, spend, sales, orders, units, updated_at
      )
      SELECT 
        ${teamId}, ${storeId}, ${snapshotId}, ${coverageDays}, c.ad_type,
        ${reportStartDate}, ${reportEndDate},
        c.campaign_count, c.active_campaign_count,
        COALESCE(t.target_count, 0), COALESCE(t.active_target_count, 0),
        COALESCE(s.sku_count, 0),
        c.impressions, c.clicks, c.spend, c.sales, c.orders, c.units, NOW()
      FROM camp_stats c
      LEFT JOIN target_stats t ON t.ad_type = c.ad_type
      LEFT JOIN sku_stats s ON s.ad_type = c.ad_type
      ON CONFLICT (store_id, snapshot_id, coverage_days, ad_type)
      DO UPDATE SET
        report_start_date = EXCLUDED.report_start_date,
        report_end_date = EXCLUDED.report_end_date,
        campaign_count = EXCLUDED.campaign_count,
        active_campaign_count = EXCLUDED.active_campaign_count,
        target_count = EXCLUDED.target_count,
        active_target_count = EXCLUDED.active_target_count,
        sku_count = EXCLUDED.sku_count,
        impressions = EXCLUDED.impressions,
        clicks = EXCLUDED.clicks,
        spend = EXCLUDED.spend,
        sales = EXCLUDED.sales,
        orders = EXCLUDED.orders,
        units = EXCLUDED.units,
        updated_at = NOW();
    `;

    // 5. Integrity verification
    const [raw] = await tx`
      SELECT 
        COALESCE(SUM(spend), 0) AS raw_spend,
        COALESCE(SUM(sales), 0) AS raw_sales,
        COALESCE(SUM(orders), 0) AS raw_orders
      FROM ppc_performance_facts
      WHERE store_id = ${storeId}
        AND snapshot_date = ${snapshotDate}
        AND report_start_date = ${reportStartDate}
        AND report_end_date = ${reportEndDate}
        AND grain = 'CAMPAIGN';
    `;

    const [summary] = await tx`
      SELECT 
        COALESCE(SUM(spend), 0) AS summary_spend,
        COALESCE(SUM(sales), 0) AS summary_sales,
        COALESCE(SUM(orders), 0) AS summary_orders
      FROM ppc_snapshot_summary
      WHERE store_id = ${storeId}
        AND snapshot_id = ${snapshotId}
        AND coverage_days = ${coverageDays};
    `;

    const diffSpend = Math.abs(Number(raw?.raw_spend || 0) - Number(summary?.summary_spend || 0));
    const diffSales = Math.abs(Number(raw?.raw_sales || 0) - Number(summary?.summary_sales || 0));
    const diffOrders = Math.abs(Number(raw?.raw_orders || 0) - Number(summary?.summary_orders || 0));

    if (diffSpend > 0.05 || diffSales > 0.05 || diffOrders > 0) {
      throw new Error(`Summary integrity check failed: diffSpend=${diffSpend}, diffSales=${diffSales}, diffOrders=${diffOrders}`);
    }

    // 6. Atomically activate snapshot
    await tx`
      INSERT INTO ppc_active_snapshots (
        team_id, store_id, coverage_days, snapshot_id, report_start_date, report_end_date, activated_at
      ) VALUES (
        ${teamId}, ${storeId}, ${coverageDays}, ${snapshotId}, ${reportStartDate}, ${reportEndDate}, NOW()
      )
      ON CONFLICT (store_id, coverage_days) DO UPDATE SET
        snapshot_id = EXCLUDED.snapshot_id,
        report_start_date = EXCLUDED.report_start_date,
        report_end_date = EXCLUDED.report_end_date,
        activated_at = NOW();
    `;

    return { snapshotId, coverageDays };
  };

  return options.transaction ? operation(options.transaction) : sql.begin(operation);
}

export async function upsertPpcPerformance(
  scope: DataScope,
  storeName: string,
  rows: PpcPerformanceRow[],
  options: { replaceExisting?: boolean; transaction?: PpcTransaction } = {},
): Promise<{ inserted: number; updated: number; deduplicated: number }> {
  const sql = await getDatabaseClient();
  const teamId = (scope as any)?.teamId || "default";
  const uniqueRows = Array.from(new Map(rows.map((row) => [
    [row.snapshotDate, row.reportStartDate, row.reportEndDate, row.adType, row.grain, performanceIdentity(row)].join(":::"),
    row,
  ])).values());
  const operation = async (transaction: PpcTransaction) => {
    const storeRows = await transaction<StoreRow[]>`
      INSERT INTO ppc_stores (team_id, name)
      VALUES (${teamId}, ${storeName})
      ON CONFLICT (team_id, name) DO UPDATE SET updated_at = NOW()
      RETURNING id, name, marketplace, target_acos, daily_budget, status
    `;
    const storeId = storeRows[0].id;
    if (options.replaceExisting) {
      const scopes = Array.from(new Set(uniqueRows.map((row) => [
        row.snapshotDate, row.reportStartDate, row.reportEndDate, row.adType,
      ].join(":::"))));
      for (const item of scopes) {
        const [snapshotDate, startDate, endDate, adType] = item.split(":::");
        await transaction`
          DELETE FROM ppc_performance_facts
          WHERE store_id = ${storeId} AND snapshot_date = ${snapshotDate}
            AND report_start_date = ${startDate} AND report_end_date = ${endDate}
            AND ad_type = ${adType}
        `;
      }
    }
    let inserted = 0;
    let updated = 0;
    for (let start = 0; start < uniqueRows.length; start += 500) {
      const chunk = uniqueRows.slice(start, start + 500).map((row) => ({
        store_id: storeId,
        snapshot_date: safeSqlString(row.snapshotDate),
        report_start_date: safeSqlString(row.reportStartDate),
        report_end_date: safeSqlString(row.reportEndDate),
        report_granularity: safeSqlString(row.reportGranularity),
        ad_type: safeSqlString(row.adType),
        grain: safeSqlString(row.grain),
        identity_key: performanceIdentity(row),
        entity_id: safeSqlString(row.entityId),
        campaign_id: safeSqlString(row.campaignId),
        campaign_name: safeSqlString(row.campaignName),
        ad_group_id: safeSqlString(row.adGroupId),
        ad_group_name: safeSqlString(row.adGroupName),
        target_id: safeSqlString(row.targetId),
        target_expression: safeSqlString(row.targetExpression),
        match_type: safeSqlString(row.matchType),
        portfolio_name: safeSqlString(row.portfolioName),
        sku: safeSqlString(row.sku),
        asin: safeSqlString(row.asin),
        state: safeSqlString(row.state),
        campaign_state: safeSqlString(row.campaignState),
        ad_group_state: safeSqlString(row.adGroupState),
        targeting_type: safeSqlString(row.targetingType),
        bidding_strategy: safeSqlString(row.biddingStrategy),
        placement: safeSqlString(row.placement),
        daily_budget: row.dailyBudget,
        bid: row.bid,
        placement_adjustment: row.placementAdjustment,
        is_negative: row.isNegative,
        impressions: row.impressions,
        clicks: row.clicks,
        spend: row.spend,
        sales: row.sales,
        orders: row.orders,
        units: row.units,
      }));
      const saved = await transaction<{ inserted: boolean }[]>`
        INSERT INTO ppc_performance_facts ${transaction(chunk)}
        ON CONFLICT (store_id, snapshot_date, report_start_date, report_end_date, ad_type, grain, identity_key)
        DO UPDATE SET
          entity_id = EXCLUDED.entity_id,
          campaign_id = EXCLUDED.campaign_id,
          campaign_name = EXCLUDED.campaign_name,
          ad_group_id = EXCLUDED.ad_group_id,
          ad_group_name = EXCLUDED.ad_group_name,
          target_id = EXCLUDED.target_id,
          target_expression = EXCLUDED.target_expression,
          match_type = EXCLUDED.match_type,
          portfolio_name = EXCLUDED.portfolio_name,
          sku = EXCLUDED.sku,
          asin = EXCLUDED.asin,
          state = EXCLUDED.state,
          campaign_state = EXCLUDED.campaign_state,
          ad_group_state = EXCLUDED.ad_group_state,
          targeting_type = EXCLUDED.targeting_type,
          bidding_strategy = EXCLUDED.bidding_strategy,
          placement = EXCLUDED.placement,
          daily_budget = EXCLUDED.daily_budget,
          bid = EXCLUDED.bid,
          placement_adjustment = EXCLUDED.placement_adjustment,
          is_negative = EXCLUDED.is_negative,
          impressions = EXCLUDED.impressions,
          clicks = EXCLUDED.clicks,
          spend = EXCLUDED.spend,
          sales = EXCLUDED.sales,
          orders = EXCLUDED.orders,
          units = EXCLUDED.units,
          updated_at = NOW()
        RETURNING (xmax = 0) AS inserted
      `;
      inserted += saved.filter((row: { inserted: boolean }) => row.inserted).length;
      updated += saved.filter((row: { inserted: boolean }) => !row.inserted).length;
    }

    const scopes = Array.from(new Set(uniqueRows.map((row) => [
      row.snapshotDate, row.reportStartDate, row.reportEndDate
    ].join(":::"))));
    for (const item of scopes) {
      const [snapshotDate, startDate, endDate] = item.split(":::");
      if (snapshotDate && startDate && endDate) {
        await refreshPpcSnapshotSummary(scope, storeId, snapshotDate, startDate, endDate, { transaction });
      }
    }
    await refreshPpcDailySummary(scope, storeId, transaction);

    return { inserted, updated, deduplicated: rows.length - uniqueRows.length };
  };
  return options.transaction ? operation(options.transaction) : sql.begin(operation);
}

/** Thay cả Search Term và Bulk trong cùng một transaction database. */
export async function upsertPpcSnapshot(
  scope: DataScope,
  storeName: string,
  searchTerms: PpcSearchTermRow[],
  performance: PpcPerformanceRow[],
): Promise<{
  searchTerms: { inserted: number; updated: number; deduplicated: number };
  performance: { inserted: number; updated: number; deduplicated: number };
}> {
  const sql = await getDatabaseClient();
  return sql.begin(async (transaction) => {
    const searchResult = await upsertPpcSearchTerms(scope, storeName, searchTerms, {
      replaceExisting: true,
      transaction,
    });
    const performanceResult = await upsertPpcPerformance(scope, storeName, performance, {
      replaceExisting: true,
      transaction,
    });
    return { searchTerms: searchResult, performance: performanceResult };
  });
}

export async function ingestPpcPerformanceStream(
  scope: DataScope,
  storeName: string,
  streamer: (pushBatch: (rows: PpcPerformanceRow[]) => Promise<void>) => Promise<number>,
  options: { replaceExisting?: boolean } = {},
): Promise<{ totalParsed: number; inserted: number; updated: number; deduplicated: number }> {
  const sql = await getDatabaseClient();
  const teamId = (scope as any)?.teamId || "default";

  return sql.begin(async (transaction) => {
    // 1. Ensure store exists
    const storeRows = await transaction<StoreRow[]>`
      INSERT INTO ppc_stores (team_id, name)
      VALUES (${teamId}, ${storeName})
      ON CONFLICT (team_id, name) DO UPDATE SET updated_at = NOW()
      RETURNING id, name, marketplace, target_acos, daily_budget, status
    `;
    const storeId = storeRows[0].id;

    // 2. Create staging table inside this transaction
    await transaction`
      CREATE TEMP TABLE ppc_perf_staging (
        LIKE ppc_performance_facts INCLUDING DEFAULTS
      ) ON COMMIT DROP
    `;

    let totalEmitted = 0;

    // 3. Consume the stream and write batches into staging table
    const pushBatch = async (rows: PpcPerformanceRow[]) => {
      if (!rows || rows.length === 0) return;
      totalEmitted += rows.length;
      const mapped = rows.map((row) => ({
        store_id: storeId,
        snapshot_date: safeSqlString(row.snapshotDate),
        report_start_date: safeSqlString(row.reportStartDate),
        report_end_date: safeSqlString(row.reportEndDate),
        report_granularity: safeSqlString(row.reportGranularity),
        ad_type: safeSqlString(row.adType),
        grain: safeSqlString(row.grain),
        identity_key: performanceIdentity(row),
        entity_id: safeSqlString(row.entityId),
        campaign_id: safeSqlString(row.campaignId),
        campaign_name: safeSqlString(row.campaignName),
        ad_group_id: safeSqlString(row.adGroupId),
        ad_group_name: safeSqlString(row.adGroupName),
        target_id: safeSqlString(row.targetId),
        target_expression: safeSqlString(row.targetExpression),
        match_type: safeSqlString(row.matchType),
        portfolio_name: safeSqlString(row.portfolioName),
        sku: safeSqlString(row.sku),
        asin: safeSqlString(row.asin),
        state: safeSqlString(row.state),
        campaign_state: safeSqlString(row.campaignState),
        ad_group_state: safeSqlString(row.adGroupState),
        targeting_type: safeSqlString(row.targetingType),
        bidding_strategy: safeSqlString(row.biddingStrategy),
        placement: safeSqlString(row.placement),
        daily_budget: row.dailyBudget,
        bid: row.bid,
        placement_adjustment: row.placementAdjustment,
        is_negative: row.isNegative,
        impressions: row.impressions,
        clicks: row.clicks,
        spend: row.spend,
        sales: row.sales,
        orders: row.orders,
        units: row.units,
      }));

      for (let start = 0; start < mapped.length; start += 800) {
        const chunk = mapped.slice(start, start + 800);
        await transaction`
          INSERT INTO ppc_perf_staging ${transaction(chunk)}
        `;
      }
    };

    const totalParsed = await streamer(pushBatch);

    if (totalParsed === 0 || totalEmitted === 0) {
      return { totalParsed: 0, inserted: 0, updated: 0, deduplicated: 0 };
    }

    // 4. If replaceExisting (default true for bulk snapshot files), delete old scope matching staging
    if (options.replaceExisting !== false) {
      await transaction`
        DELETE FROM ppc_performance_facts f
        USING (
          SELECT DISTINCT store_id, snapshot_date, report_start_date, report_end_date, ad_type
          FROM ppc_perf_staging
        ) s
        WHERE f.store_id = s.store_id
          AND f.snapshot_date = s.snapshot_date
          AND f.report_start_date = s.report_start_date
          AND f.report_end_date = s.report_end_date
          AND f.ad_type = s.ad_type
      `;
    }

    // 5. Transfer from staging table to ppc_performance_facts with ON CONFLICT
    const insertResult = await transaction`
      INSERT INTO ppc_performance_facts (
        store_id, snapshot_date, report_start_date, report_end_date, report_granularity,
        ad_type, grain, identity_key, entity_id, campaign_id, campaign_name,
        ad_group_id, ad_group_name, target_id, target_expression, match_type,
        portfolio_name, sku, asin, state, campaign_state, ad_group_state,
        targeting_type, bidding_strategy, placement, daily_budget, bid,
        placement_adjustment, is_negative, impressions, clicks, spend, sales, orders, units
      )
      SELECT DISTINCT ON (store_id, snapshot_date, report_start_date, report_end_date, ad_type, grain, identity_key)
        store_id, snapshot_date, report_start_date, report_end_date, report_granularity,
        ad_type, grain, identity_key, entity_id, campaign_id, campaign_name,
        ad_group_id, ad_group_name, target_id, target_expression, match_type,
        portfolio_name, sku, asin, state, campaign_state, ad_group_state,
        targeting_type, bidding_strategy, placement, daily_budget, bid,
        placement_adjustment, is_negative, impressions, clicks, spend, sales, orders, units
      FROM ppc_perf_staging
      ON CONFLICT (store_id, snapshot_date, report_start_date, report_end_date, ad_type, grain, identity_key)
      DO UPDATE SET
        entity_id = EXCLUDED.entity_id,
        campaign_id = EXCLUDED.campaign_id,
        campaign_name = EXCLUDED.campaign_name,
        ad_group_id = EXCLUDED.ad_group_id,
        ad_group_name = EXCLUDED.ad_group_name,
        target_id = EXCLUDED.target_id,
        target_expression = EXCLUDED.target_expression,
        match_type = EXCLUDED.match_type,
        portfolio_name = EXCLUDED.portfolio_name,
        sku = EXCLUDED.sku,
        asin = EXCLUDED.asin,
        state = EXCLUDED.state,
        campaign_state = EXCLUDED.campaign_state,
        ad_group_state = EXCLUDED.ad_group_state,
        targeting_type = EXCLUDED.targeting_type,
        bidding_strategy = EXCLUDED.bidding_strategy,
        placement = EXCLUDED.placement,
        daily_budget = EXCLUDED.daily_budget,
        bid = EXCLUDED.bid,
        placement_adjustment = EXCLUDED.placement_adjustment,
        is_negative = EXCLUDED.is_negative,
        impressions = EXCLUDED.impressions,
        clicks = EXCLUDED.clicks,
        spend = EXCLUDED.spend,
        sales = EXCLUDED.sales,
        orders = EXCLUDED.orders,
        units = EXCLUDED.units,
        updated_at = NOW()
    `;

    const insertedCount = insertResult.count;
    const deduplicated = Math.max(0, totalEmitted - insertedCount);

    // 6. Refresh summary tables atomically inside the same transaction
    const distinctScopes = await transaction<{
      store_id: string;
      snapshot_date: Date | string;
      report_start_date: Date | string;
      report_end_date: Date | string;
    }[]>`
      SELECT DISTINCT store_id, snapshot_date, report_start_date, report_end_date
      FROM ppc_perf_staging
    `;
    for (const sc of distinctScopes) {
      const snapDateStr = sc.snapshot_date instanceof Date ? sc.snapshot_date.toISOString().slice(0, 10) : String(sc.snapshot_date).slice(0, 10);
      const startStr = sc.report_start_date instanceof Date ? sc.report_start_date.toISOString().slice(0, 10) : String(sc.report_start_date).slice(0, 10);
      const endStr = sc.report_end_date instanceof Date ? sc.report_end_date.toISOString().slice(0, 10) : String(sc.report_end_date).slice(0, 10);
      await refreshPpcSnapshotSummary(scope, sc.store_id, snapDateStr, startStr, endStr, { transaction });
    }
    await refreshPpcDailySummary(scope, storeId, transaction);

    return {
      totalParsed,
      inserted: insertedCount,
      updated: 0,
      deduplicated,
    };
  });
}

export async function replacePpcDataWithMock(
  scope: DataScope,
  stores: PpcStore[],
  rows: PpcSearchTermRow[],
): Promise<void> {
  const sql = await getDatabaseClient();
  const teamId = (scope as any)?.teamId || "default";
  await sql.begin(async (transaction) => {
    await transaction`
      DELETE FROM ppc_stores WHERE team_id = ${teamId}
    `;
    for (const store of stores) {
      await transaction`
        INSERT INTO ppc_stores (team_id, name, marketplace, target_acos, daily_budget, status)
        VALUES (
          ${teamId}, ${store.name}, ${store.marketplace}, ${store.targetAcos},
          ${store.dailyBudget}, ${store.status}
        )
      `;
    }
  });
  for (const store of stores) {
    await upsertPpcSearchTerms(
      scope,
      store.name,
      rows.filter((row) => row.storeName === store.name),
    );
  }
}

export interface PpcOverviewAggregates {
  kpiRows: Array<{
    ad_type: PpcAdType;
    campaign_count: string | number;
    spend: string | number;
    sales: string | number;
    orders: string | number;
    units: string | number;
    clicks: string | number;
    impressions: string | number;
    max_report_start?: string | Date;
    max_report_end?: string | Date;
  }>;
  topCampaigns: PpcPerformanceRow[];
  topSkus: Array<{
    sku: string;
    storeName: string;
    spend: number;
    sales: number;
    orders: number;
    clicks: number;
    impressions: number;
    campaignsCount: number;
  }>;
  targetBreakdown: Array<{
    target_type: "Keyword" | "Auto" | "Product Targeting";
    keyword_match_type: "Exact" | "Phrase" | "Broad" | "Unknown";
    spend: string | number;
    sales: string | number;
    orders: string | number;
    clicks: string | number;
    impressions: string | number;
  }>;
  targetCount: number;
  availableSkus: string[];
  snapshotDates: {
    startDate: string;
    endDate: string;
  } | null;
  storeSummaries?: Array<{
    id: string;
    name: string;
    marketplace: string;
    target_acos: string | number;
    daily_budget: string | number;
    status: string;
    total_campaigns: string | number;
    active_campaigns: string | number;
    spend: string | number;
    sales: string | number;
    orders: string | number;
    clicks: string | number;
    impressions: string | number;
  }>;
  kpiRows7D?: Array<{
    ad_type: PpcAdType;
    campaign_count: string | number;
    spend: string | number;
    sales: string | number;
    orders: string | number;
    units: string | number;
    clicks: string | number;
    impressions: string | number;
  }>;
}

const targetCountCache = new Map<string, { expiresAt: number; count: number }>();

function canonicalCoverageDays(spanDays: number): number {
  const safeSpan = Math.max(1, Math.trunc(spanDays));
  // Some legacy uploads stored Amazon's start/end boundaries one day wider
  // (for example 15/09..22/09 for the 7-day option). Normalize only known
  // report windows; preserve genuinely custom ranges.
  for (const standard of [7, 14, 30, 60, 90]) {
    if (safeSpan === standard || safeSpan === standard + 1) return standard;
  }
  return safeSpan;
}

export async function getPpcOverviewAggregates(
  scope: DataScope,
  filters: { storeName?: string; sku?: string; days?: number; startDate?: string; endDate?: string } = {},
): Promise<PpcOverviewAggregates> {
  const sql = await getDatabaseClient();
  const teamId = (scope as any)?.teamId || "default";
  const storeName = filters.storeName || "ALL";
  const sku = filters.sku || "ALL";
  const days = Math.max(1, filters.days || 30);
  const isAllStores = storeName === "ALL";
  const customStart = filters.startDate ? Date.parse(`${filters.startDate}T00:00:00Z`) : NaN;
  const customEnd = filters.endDate ? Date.parse(`${filters.endDate}T00:00:00Z`) : NaN;
  const customCoverageDays = Number.isFinite(customStart) && Number.isFinite(customEnd) && customEnd >= customStart
    ? canonicalCoverageDays(Math.round((customEnd - customStart) / 86_400_000) + 1)
    : null;
  const coverageDays = customCoverageDays || Math.max(1, Math.trunc(days));

  // 1. Fast path: check if precomputed summary snapshots exist
  const activeSnapshots = await sql<Array<{
    store_id: string;
    coverage_days: number;
    snapshot_id: string;
    report_start_date: Date | string;
    report_end_date: Date | string;
  }>>`
    SELECT a.store_id, a.coverage_days, a.snapshot_id, a.report_start_date, a.report_end_date
    FROM ppc_active_snapshots a
    JOIN ppc_stores s ON s.id = a.store_id
    WHERE s.team_id = ${teamId}
      AND (${isAllStores} OR lower(s.name) = lower(${storeName}))
      AND a.coverage_days = ${coverageDays}
      AND (${!filters.startDate} OR a.report_start_date = ${filters.startDate || "1970-01-01"}::date)
      AND (${!filters.endDate} OR a.report_end_date = ${filters.endDate || "2099-12-31"}::date)
  `;

  if (activeSnapshots.length > 0) {
    const [kpiRows, kpiRows7D, topCampaignRows, topSkuRows, targetBreakdownRows, availableSkuRows, targetCountRow, storeSummaryRows] = await Promise.all([
      // 1. KPI and Ad Type breakdown
      sql<Array<{
        ad_type: PpcAdType;
        campaign_count: string | number;
        spend: string | number;
        sales: string | number;
        orders: string | number;
        units: string | number;
        clicks: string | number;
        impressions: string | number;
        max_report_start: string | Date;
        max_report_end: string | Date;
      }>>`
        SELECT 
          sm.ad_type,
          SUM(sm.campaign_count) AS campaign_count,
          SUM(sm.spend) AS spend,
          SUM(sm.sales) AS sales,
          SUM(sm.orders) AS orders,
          SUM(sm.units) AS units,
          SUM(sm.clicks) AS clicks,
          SUM(sm.impressions) AS impressions,
          MIN(sm.report_start_date) AS max_report_start,
          MAX(sm.report_end_date) AS max_report_end
        FROM ppc_snapshot_summary sm
        JOIN ppc_active_snapshots a ON a.store_id = sm.store_id AND a.snapshot_id = sm.snapshot_id AND a.coverage_days = sm.coverage_days
        JOIN ppc_stores s ON s.id = sm.store_id
        WHERE s.team_id = ${teamId}
          AND (${isAllStores} OR lower(s.name) = lower(${storeName}))
          AND sm.coverage_days = ${coverageDays}
        GROUP BY sm.ad_type
        ORDER BY sm.ad_type;
      `,
      // 1b. 7-Day KPI breakdown from Bulk Sheet CAMPAIGN grain
      sql<Array<{
        ad_type: PpcAdType;
        campaign_count: string | number;
        spend: string | number;
        sales: string | number;
        orders: string | number;
        units: string | number;
        clicks: string | number;
        impressions: string | number;
      }>>`
        SELECT 
          sm.ad_type,
          SUM(sm.campaign_count) AS campaign_count,
          SUM(sm.spend) AS spend,
          SUM(sm.sales) AS sales,
          SUM(sm.orders) AS orders,
          SUM(sm.units) AS units,
          SUM(sm.clicks) AS clicks,
          SUM(sm.impressions) AS impressions
        FROM ppc_snapshot_summary sm
        JOIN ppc_active_snapshots a ON a.store_id = sm.store_id AND a.snapshot_id = sm.snapshot_id AND a.coverage_days = sm.coverage_days
        JOIN ppc_stores s ON s.id = sm.store_id
        WHERE s.team_id = ${teamId}
          AND (${isAllStores} OR lower(s.name) = lower(${storeName}))
          AND sm.coverage_days = 7
        GROUP BY sm.ad_type
        ORDER BY sm.ad_type;
      `,
      // 2. Top 7 Campaigns
      sql<PerformanceDbRow[]>`
        SELECT 
          cs.id, cs.store_id, s.name AS store_name, a.report_start_date AS snapshot_date,
          a.report_start_date, a.report_end_date, 'DAILY' AS report_granularity,
          cs.ad_type, 'CAMPAIGN' AS grain, cs.campaign_id AS entity_id,
          cs.campaign_id, cs.campaign_name,
          NULL AS ad_group_id, NULL AS ad_group_name, NULL AS target_id, NULL AS target_expression,
          NULL AS match_type, cs.portfolio_name, NULL AS sku, NULL AS asin,
          cs.campaign_state AS state, cs.campaign_state, NULL AS ad_group_state,
          NULL AS targeting_type, NULL AS bidding_strategy, NULL AS placement,
          cs.daily_budget, NULL AS bid, NULL AS placement_adjustment, false AS is_negative,
          cs.impressions, cs.clicks, cs.spend, cs.sales, cs.orders, cs.units
        FROM ppc_campaign_summary cs
        JOIN ppc_active_snapshots a ON a.store_id = cs.store_id AND a.snapshot_id = cs.snapshot_id AND a.coverage_days = cs.coverage_days
        JOIN ppc_stores s ON s.id = cs.store_id
        WHERE s.team_id = ${teamId}
          AND (${isAllStores} OR lower(s.name) = lower(${storeName}))
          AND cs.coverage_days = ${coverageDays}
          AND (cs.spend > 0 OR cs.clicks > 0 OR cs.impressions > 0)
        ORDER BY cs.spend DESC
        LIMIT 500;
      `,
      // 3. Top 10 SKUs
      sql<Array<{
        sku: string;
        store_name: string;
        spend: string | number;
        sales: string | number;
        orders: string | number;
        clicks: string | number;
        impressions: string | number;
        campaigns_count: string | number;
      }>>`
        SELECT 
          sk.sku,
          s.name AS store_name,
          COALESCE(SUM(sk.spend), 0) AS spend,
          COALESCE(SUM(sk.sales), 0) AS sales,
          COALESCE(SUM(sk.orders), 0) AS orders,
          COALESCE(SUM(sk.clicks), 0) AS clicks,
          COALESCE(SUM(sk.impressions), 0) AS impressions,
          MAX(sk.campaign_count) AS campaigns_count
        FROM ppc_sku_summary sk
        JOIN ppc_active_snapshots a ON a.store_id = sk.store_id AND a.snapshot_id = sk.snapshot_id AND a.coverage_days = sk.coverage_days
        JOIN ppc_stores s ON s.id = sk.store_id
        WHERE s.team_id = ${teamId}
          AND (${isAllStores} OR lower(s.name) = lower(${storeName}))
          AND sk.coverage_days = ${coverageDays}
          AND (${sku === "ALL"} OR lower(sk.sku) = lower(${sku}))
        GROUP BY sk.sku, s.name
        ORDER BY spend DESC
        LIMIT 10;
      `,
      // 4. Target Breakdown
      sql<Array<{
        target_type: "Keyword" | "Auto" | "Product Targeting";
        keyword_match_type: "Exact" | "Phrase" | "Broad" | "Unknown";
        spend: string | number;
        sales: string | number;
        orders: string | number;
        clicks: string | number;
        impressions: string | number;
      }>>`
        SELECT 
          tb.target_type,
          tb.keyword_match_type,
          COALESCE(SUM(tb.spend), 0) AS spend,
          COALESCE(SUM(tb.sales), 0) AS sales,
          COALESCE(SUM(tb.orders), 0) AS orders,
          COALESCE(SUM(tb.clicks), 0) AS clicks,
          COALESCE(SUM(tb.impressions), 0) AS impressions
        FROM ppc_target_breakdown_summary tb
        JOIN ppc_active_snapshots a ON a.store_id = tb.store_id AND a.snapshot_id = tb.snapshot_id AND a.coverage_days = tb.coverage_days
        JOIN ppc_stores s ON s.id = tb.store_id
        WHERE s.team_id = ${teamId}
          AND (${isAllStores} OR lower(s.name) = lower(${storeName}))
          AND tb.coverage_days = ${coverageDays}
        GROUP BY tb.target_type, tb.keyword_match_type
        ORDER BY spend DESC;
      `,
      // 5. Distinct Available SKUs
      sql<{ sku: string }[]>`
        SELECT DISTINCT sk.sku
        FROM ppc_sku_summary sk
        JOIN ppc_active_snapshots a ON a.store_id = sk.store_id AND a.snapshot_id = sk.snapshot_id AND a.coverage_days = sk.coverage_days
        JOIN ppc_stores s ON s.id = sk.store_id
        WHERE s.team_id = ${teamId}
          AND (${isAllStores} OR lower(s.name) = lower(${storeName}))
          AND sk.coverage_days = ${coverageDays}
        ORDER BY sk.sku;
      `,
      // 6. Target Count directly from snapshot summary
      sql<{ target_count: string | number }[]>`
        SELECT COALESCE(SUM(sm.target_count), 0) AS target_count
        FROM ppc_snapshot_summary sm
        JOIN ppc_active_snapshots a ON a.store_id = sm.store_id AND a.snapshot_id = sm.snapshot_id AND a.coverage_days = sm.coverage_days
        JOIN ppc_stores s ON s.id = sm.store_id
        WHERE s.team_id = ${teamId}
          AND (${isAllStores} OR lower(s.name) = lower(${storeName}))
          AND sm.coverage_days = ${coverageDays};
      `,
      // 7. Store Summaries directly from snapshot summary (no separate table needed!)
      sql<Array<{
        id: string;
        name: string;
        marketplace: string;
        target_acos: string | number;
        daily_budget: string | number;
        status: string;
        total_campaigns: string | number;
        active_campaigns: string | number;
        spend: string | number;
        sales: string | number;
        orders: string | number;
        clicks: string | number;
        impressions: string | number;
      }>>`
        SELECT 
          s.id,
          s.name,
          s.marketplace,
          s.target_acos,
          s.daily_budget,
          s.status,
          COALESCE(SUM(sm.campaign_count), 0) AS total_campaigns,
          COALESCE(SUM(sm.active_campaign_count), 0) AS active_campaigns,
          COALESCE(SUM(sm.spend), 0) AS spend,
          COALESCE(SUM(sm.sales), 0) AS sales,
          COALESCE(SUM(sm.orders), 0) AS orders,
          COALESCE(SUM(sm.clicks), 0) AS clicks,
          COALESCE(SUM(sm.impressions), 0) AS impressions
        FROM ppc_stores s
        LEFT JOIN ppc_active_snapshots a ON a.store_id = s.id AND a.coverage_days = ${coverageDays}
        LEFT JOIN ppc_snapshot_summary sm ON sm.store_id = s.id AND sm.snapshot_id = a.snapshot_id AND sm.coverage_days = a.coverage_days
        WHERE s.team_id = ${teamId}
        GROUP BY s.id, s.name, s.marketplace, s.target_acos, s.daily_budget, s.status
        ORDER BY lower(s.name);
      `,
    ]);

    let snapshotDates: { startDate: string; endDate: string } | null = null;
    const sampleKpi = kpiRows.find((r) => r.max_report_start && r.max_report_end);
    if (sampleKpi && sampleKpi.max_report_start && sampleKpi.max_report_end) {
      snapshotDates = {
        startDate: asDateString(sampleKpi.max_report_start),
        endDate: asDateString(sampleKpi.max_report_end),
      };
    }

    return {
      kpiRows,
      kpiRows7D,
      topCampaigns: topCampaignRows.map(mapPerformance),
      topSkus: topSkuRows.map((r) => ({
        sku: r.sku,
        storeName: r.store_name,
        spend: asNumber(r.spend),
        sales: asNumber(r.sales),
        orders: Number(r.orders || 0),
        clicks: Number(r.clicks || 0),
        impressions: Number(r.impressions || 0),
        campaignsCount: Number(r.campaigns_count || 0),
      })),
      targetBreakdown: targetBreakdownRows,
      targetCount: Number(targetCountRow[0]?.target_count || 0),
      availableSkus: availableSkuRows.map((r) => r.sku),
      snapshotDates,
      storeSummaries: storeSummaryRows,
    };
  }

  // 2. Fallback: scan raw facts if no active snapshot summary exists
  const targetCountKey = `${teamId}::${storeName}::${sku}::${days}`;
  const cachedTargetCount = targetCountCache.get(targetCountKey);
  const targetCountPromise: Promise<number> = cachedTargetCount && cachedTargetCount.expiresAt > Date.now()
    ? Promise.resolve(cachedTargetCount.count)
    : (async () => {
    const rows = await sql<{ count: string | number }[]>`
      WITH latest_snapshots AS (
        SELECT DISTINCT ON (p2.store_id, p2.ad_type)
          p2.store_id, p2.ad_type, p2.snapshot_date AS max_snapshot,
          p2.report_start_date AS max_report_start,
          p2.report_end_date AS max_report_end
        FROM ppc_performance_facts p2
        JOIN ppc_stores s2 ON s2.id = p2.store_id
        WHERE s2.team_id = ${teamId}
          AND (${isAllStores} OR lower(s2.name) = lower(${storeName}))
          AND (p2.report_end_date - p2.report_start_date + 1)
            BETWEEN ${days - 3}::integer AND ${days + 3}::integer
        ORDER BY p2.store_id, p2.ad_type, p2.snapshot_date DESC, p2.report_end_date DESC
      )
        SELECT count(*) as count
        FROM ppc_performance_facts p
        JOIN latest_snapshots ls
          ON ls.store_id = p.store_id AND ls.ad_type = p.ad_type
          AND ls.max_snapshot = p.snapshot_date AND ls.max_report_start = p.report_start_date AND ls.max_report_end = p.report_end_date
        WHERE p.grain = 'TARGET'
          AND NOT p.is_negative
          AND (p.spend > 0 OR p.clicks > 0 OR p.impressions > 0);
      `;
      const count = Number(rows[0]?.count || 0);
      targetCountCache.set(targetCountKey, { expiresAt: Date.now() + 60_000, count });
      return count;
    })();

  const [kpiRows, topCampaignRows, topSkuRows, targetBreakdownRows, availableSkuRows, targetCount, storeSummaryRows] = await Promise.all([
    // 1. KPI and Ad Type breakdown
    sql<Array<{
      ad_type: PpcAdType;
      campaign_count: string | number;
      spend: string | number;
      sales: string | number;
      orders: string | number;
      units: string | number;
      clicks: string | number;
      impressions: string | number;
      max_report_start: string | Date;
      max_report_end: string | Date;
    }>>`
      WITH latest_snapshots AS (
        SELECT DISTINCT ON (p2.store_id, p2.ad_type)
          p2.store_id, p2.ad_type, p2.snapshot_date AS max_snapshot,
          p2.report_start_date AS max_report_start,
          p2.report_end_date AS max_report_end
        FROM ppc_performance_facts p2
        JOIN ppc_stores s2 ON s2.id = p2.store_id
        WHERE s2.team_id = ${teamId}
          AND (${storeName === "ALL"} OR lower(s2.name) = lower(${storeName}))
          AND (p2.report_end_date - p2.report_start_date + 1)
            BETWEEN ${days - 3}::integer AND ${days + 3}::integer
        ORDER BY p2.store_id, p2.ad_type, p2.snapshot_date DESC, p2.report_end_date DESC
      )
      SELECT 
        p.ad_type,
        count(*) as campaign_count,
        COALESCE(SUM(p.spend), 0) as spend,
        COALESCE(SUM(p.sales), 0) as sales,
        COALESCE(SUM(p.orders), 0) as orders,
        COALESCE(SUM(p.units), 0) as units,
        COALESCE(SUM(p.clicks), 0) as clicks,
        COALESCE(SUM(p.impressions), 0) as impressions,
        MAX(ls.max_report_start) as max_report_start,
        MAX(ls.max_report_end) as max_report_end
      FROM ppc_performance_facts p
      JOIN latest_snapshots ls
        ON ls.store_id = p.store_id AND ls.ad_type = p.ad_type
        AND ls.max_snapshot = p.snapshot_date AND ls.max_report_start = p.report_start_date AND ls.max_report_end = p.report_end_date
      WHERE p.grain = 'CAMPAIGN'
      GROUP BY p.ad_type;
    `,

    // 2. Top 7 Campaigns
    sql<PerformanceDbRow[]>`
      WITH latest_snapshots AS (
        SELECT DISTINCT ON (p2.store_id, p2.ad_type)
          p2.store_id, p2.ad_type, p2.snapshot_date AS max_snapshot,
          p2.report_start_date AS max_report_start,
          p2.report_end_date AS max_report_end
        FROM ppc_performance_facts p2
        JOIN ppc_stores s2 ON s2.id = p2.store_id
        WHERE s2.team_id = ${teamId}
          AND (${storeName === "ALL"} OR lower(s2.name) = lower(${storeName}))
          AND (p2.report_end_date - p2.report_start_date + 1)
            BETWEEN ${days - 3}::integer AND ${days + 3}::integer
        ORDER BY p2.store_id, p2.ad_type, p2.snapshot_date DESC, p2.report_end_date DESC
      )
      SELECT 
        p.id, p.store_id, s.name AS store_name, p.snapshot_date,
        p.report_start_date, p.report_end_date, p.report_granularity,
        p.ad_type, p.grain, p.entity_id, p.campaign_id, p.campaign_name,
        p.ad_group_id, p.ad_group_name, p.target_id, p.target_expression,
        p.match_type, p.portfolio_name, p.sku, p.asin, p.state,
        p.campaign_state, p.ad_group_state, p.targeting_type,
        p.bidding_strategy, p.placement, p.daily_budget, p.bid,
        p.placement_adjustment, p.is_negative, p.impressions, p.clicks, p.spend,
        p.sales, p.orders, p.units
      FROM ppc_performance_facts p
      JOIN ppc_stores s ON s.id = p.store_id
      JOIN latest_snapshots ls
        ON ls.store_id = p.store_id AND ls.ad_type = p.ad_type
        AND ls.max_snapshot = p.snapshot_date AND ls.max_report_start = p.report_start_date AND ls.max_report_end = p.report_end_date
      WHERE s.team_id = ${teamId}
        AND p.grain = 'CAMPAIGN'
        AND (${storeName === "ALL"} OR lower(s.name) = lower(${storeName}))
      ORDER BY p.spend DESC, p.id
      LIMIT 7;
    `,

    // 3. Top 10 SKUs
    sql<Array<{
      sku: string;
      store_name: string;
      spend: string | number;
      sales: string | number;
      orders: string | number;
      clicks: string | number;
      impressions: string | number;
      campaigns_count: string | number;
    }>>`
      WITH latest_snapshots AS (
        SELECT DISTINCT ON (p2.store_id, p2.ad_type)
          p2.store_id, p2.ad_type, p2.snapshot_date AS max_snapshot,
          p2.report_start_date AS max_report_start,
          p2.report_end_date AS max_report_end
        FROM ppc_performance_facts p2
        JOIN ppc_stores s2 ON s2.id = p2.store_id
        WHERE s2.team_id = ${teamId}
          AND (${storeName === "ALL"} OR lower(s2.name) = lower(${storeName}))
          AND (p2.report_end_date - p2.report_start_date + 1)
            BETWEEN ${days - 3}::integer AND ${days + 3}::integer
        ORDER BY p2.store_id, p2.ad_type, p2.snapshot_date DESC, p2.report_end_date DESC
      )
      SELECT 
        p.sku,
        s.name as store_name,
        COALESCE(SUM(p.spend), 0) as spend,
        COALESCE(SUM(p.sales), 0) as sales,
        COALESCE(SUM(p.orders), 0) as orders,
        COALESCE(SUM(p.clicks), 0) as clicks,
        COALESCE(SUM(p.impressions), 0) as impressions,
        COUNT(DISTINCT p.campaign_id) as campaigns_count
      FROM ppc_performance_facts p
      JOIN ppc_stores s ON s.id = p.store_id
      JOIN latest_snapshots ls
        ON ls.store_id = p.store_id AND ls.ad_type = p.ad_type
        AND ls.max_snapshot = p.snapshot_date AND ls.max_report_start = p.report_start_date AND ls.max_report_end = p.report_end_date
      WHERE s.team_id = ${teamId}
        AND p.grain = 'PRODUCT' AND p.sku IS NOT NULL AND p.sku != ''
        AND (${storeName === "ALL"} OR lower(s.name) = lower(${storeName}))
      GROUP BY p.sku, s.name
      ORDER BY spend DESC
      LIMIT 10;
    `,

    // 4. Combined Target Type and Keyword Match Type Breakdown
    sql<Array<{
      target_type: "Keyword" | "Auto" | "Product Targeting";
      keyword_match_type: "Exact" | "Phrase" | "Broad" | "Unknown";
      spend: string | number;
      sales: string | number;
      orders: string | number;
      clicks: string | number;
      impressions: string | number;
    }>>`
      WITH latest_snapshots AS (
        SELECT DISTINCT ON (p2.store_id, p2.ad_type)
          p2.store_id, p2.ad_type, p2.snapshot_date AS max_snapshot,
          p2.report_start_date AS max_report_start,
          p2.report_end_date AS max_report_end
        FROM ppc_performance_facts p2
        JOIN ppc_stores s2 ON s2.id = p2.store_id
        WHERE s2.team_id = ${teamId}
          AND (${storeName === "ALL"} OR lower(s2.name) = lower(${storeName}))
          AND (p2.report_end_date - p2.report_start_date + 1)
            BETWEEN ${days - 3}::integer AND ${days + 3}::integer
        ORDER BY p2.store_id, p2.ad_type, p2.snapshot_date DESC, p2.report_end_date DESC
      )
      SELECT 
        CASE
          WHEN lower(p.target_expression) IN ('close-match', 'loose-match', 'substitutes', 'complements')
               OR lower(p.target_expression) LIKE '%auto targeting%' THEN 'Auto'
          WHEN upper(p.match_type) = 'TARGETING'
               OR lower(p.target_expression) LIKE 'asin=%'
               OR lower(p.target_expression) LIKE 'asin-expanded=%'
               OR lower(p.target_expression) LIKE 'category=%' THEN 'Product Targeting'
          ELSE 'Keyword'
        END AS target_type,
        CASE
          WHEN upper(p.match_type) LIKE '%EXACT%' THEN 'Exact'
          WHEN upper(p.match_type) LIKE '%PHRASE%' THEN 'Phrase'
          WHEN upper(p.match_type) LIKE '%BROAD%' THEN 'Broad'
          ELSE 'Unknown'
        END AS keyword_match_type,
        COALESCE(SUM(p.spend), 0) as spend,
        COALESCE(SUM(p.sales), 0) as sales,
        COALESCE(SUM(p.orders), 0) as orders,
        COALESCE(SUM(p.clicks), 0) as clicks,
        COALESCE(SUM(p.impressions), 0) as impressions
      FROM ppc_performance_facts p
      JOIN latest_snapshots ls
        ON ls.store_id = p.store_id AND ls.ad_type = p.ad_type
        AND ls.max_snapshot = p.snapshot_date AND ls.max_report_start = p.report_start_date AND ls.max_report_end = p.report_end_date
      WHERE p.grain = 'TARGET' AND NOT p.is_negative
        AND (p.spend > 0 OR p.clicks > 0 OR p.impressions > 0)
      GROUP BY 1, 2;
    `,

    // 5. Distinct Available SKUs
    sql<{ sku: string }[]>`
      WITH latest_snapshots AS (
        SELECT DISTINCT ON (p2.store_id, p2.ad_type)
          p2.store_id, p2.ad_type, p2.snapshot_date AS max_snapshot,
          p2.report_start_date AS max_report_start,
          p2.report_end_date AS max_report_end
        FROM ppc_performance_facts p2
        JOIN ppc_stores s2 ON s2.id = p2.store_id
        WHERE s2.team_id = ${teamId}
          AND (${storeName === "ALL"} OR lower(s2.name) = lower(${storeName}))
          AND (p2.report_end_date - p2.report_start_date + 1)
            BETWEEN ${days - 3}::integer AND ${days + 3}::integer
        ORDER BY p2.store_id, p2.ad_type, p2.snapshot_date DESC, p2.report_end_date DESC
      )
      SELECT DISTINCT p.sku
      FROM ppc_performance_facts p
      JOIN latest_snapshots ls
        ON ls.store_id = p.store_id AND ls.ad_type = p.ad_type
        AND ls.max_snapshot = p.snapshot_date AND ls.max_report_start = p.report_start_date AND ls.max_report_end = p.report_end_date
      WHERE p.grain = 'PRODUCT' AND p.sku IS NOT NULL AND p.sku != ''
      ORDER BY p.sku;
    `,

    // 6. Scoped Target Count
    targetCountPromise,

    // 7. Store Summaries
    sql<Array<{
      id: string;
      name: string;
      marketplace: string;
      target_acos: string | number;
      daily_budget: string | number;
      status: string;
      total_campaigns: string | number;
      active_campaigns: string | number;
      spend: string | number;
      sales: string | number;
      orders: string | number;
      clicks: string | number;
      impressions: string | number;
    }>>`
      WITH latest_snapshots AS (
        SELECT DISTINCT ON (p2.store_id, p2.ad_type)
          p2.store_id, p2.ad_type, p2.snapshot_date AS max_snapshot,
          p2.report_start_date AS max_report_start,
          p2.report_end_date AS max_report_end
        FROM ppc_performance_facts p2
        JOIN ppc_stores s2 ON s2.id = p2.store_id
        WHERE s2.team_id = ${teamId}
          AND (p2.report_end_date - p2.report_start_date + 1)
            BETWEEN ${days - 3}::integer AND ${days + 3}::integer
        ORDER BY p2.store_id, p2.ad_type, p2.snapshot_date DESC, p2.report_end_date DESC
      ),
      camp_agg AS (
        SELECT 
          p.store_id,
          COUNT(DISTINCT p.campaign_id) as total_campaigns,
          COUNT(DISTINCT p.campaign_id) FILTER (
            WHERE lower(COALESCE(NULLIF(p.campaign_state, ''), NULLIF(p.state, ''), '')) = 'enabled'
          ) as active_campaigns,
          COALESCE(SUM(p.spend), 0) as spend,
          COALESCE(SUM(p.sales), 0) as sales,
          COALESCE(SUM(p.orders), 0) as orders,
          COALESCE(SUM(p.clicks), 0) as clicks,
          COALESCE(SUM(p.impressions), 0) as impressions
        FROM ppc_performance_facts p
        JOIN latest_snapshots ls
          ON ls.store_id = p.store_id AND ls.ad_type = p.ad_type
          AND ls.max_snapshot = p.snapshot_date AND ls.max_report_start = p.report_start_date AND ls.max_report_end = p.report_end_date
        WHERE p.grain = 'CAMPAIGN'
        GROUP BY p.store_id
      )
      SELECT 
        s.id,
        s.name,
        s.marketplace,
        s.target_acos,
        s.daily_budget,
        s.status,
        COALESCE(c.total_campaigns, 0) as total_campaigns,
        COALESCE(c.active_campaigns, 0) as active_campaigns,
        COALESCE(c.spend, 0) as spend,
        COALESCE(c.sales, 0) as sales,
        COALESCE(c.orders, 0) as orders,
        COALESCE(c.clicks, 0) as clicks,
        COALESCE(c.impressions, 0) as impressions
      FROM ppc_stores s
      LEFT JOIN camp_agg c ON c.store_id = s.id
      WHERE s.team_id = ${teamId}
      ORDER BY lower(s.name);
    `,
  ]);

  let snapshotDates: { startDate: string; endDate: string } | null = null;
  const sampleKpi = kpiRows.find((r) => r.max_report_start && r.max_report_end);
  if (sampleKpi && sampleKpi.max_report_start && sampleKpi.max_report_end) {
    snapshotDates = {
      startDate: asDateString(sampleKpi.max_report_start),
      endDate: asDateString(sampleKpi.max_report_end),
    };
  }

  return {
    kpiRows,
    topCampaigns: topCampaignRows.map(mapPerformance),
    topSkus: topSkuRows.map((r) => ({
      sku: r.sku,
      storeName: r.store_name,
      spend: asNumber(r.spend),
      sales: asNumber(r.sales),
      orders: Number(r.orders || 0),
      clicks: Number(r.clicks || 0),
      impressions: Number(r.impressions || 0),
      campaignsCount: Number(r.campaigns_count || 0),
    })),
    targetBreakdown: targetBreakdownRows,
    targetCount,
    availableSkus: availableSkuRows.map((r) => r.sku),
    snapshotDates,
    storeSummaries: storeSummaryRows,
  };
}

type DailyTrendSqlRow = {
  date: string;
  spend: string | number;
  sales: string | number;
  orders: string | number;
  clicks: string | number;
  impressions: string | number;
  sp_spend: string | number;
  sp_sales: string | number;
  sp_orders: string | number;
  sp_clicks: string | number;
  sp_impressions: string | number;
  sb_spend: string | number;
  sb_sales: string | number;
  sb_orders: string | number;
  sb_clicks: string | number;
  sb_impressions: string | number;
};

export async function listPpcDailyTrendsFromDb(
  scope: DataScope,
  filters: { storeName?: string; days?: number; startDate?: string; endDate?: string } = {},
): Promise<PpcDailyTrendPoint[]> {
  const sql = await getDatabaseClient();
  const teamId = (scope as any)?.teamId || "default";
  const storeName = filters.storeName || "ALL";
  const days = Math.max(1, filters.days || 30);

  let rows = await sql<DailyTrendSqlRow[]>`
    WITH anchor AS (
      SELECT COALESCE(
        MAX(p0.report_date),
        CURRENT_DATE - 1
      ) AS max_date
      FROM ppc_daily_summary p0
      JOIN ppc_stores s0 ON s0.id = p0.store_id
      WHERE s0.team_id = ${teamId}
        AND (${storeName === "ALL"} OR lower(s0.name) = lower(${storeName}))
    )
    SELECT 
      to_char(p.report_date, 'YYYY-MM-DD') AS date,
      COALESCE(SUM(p.spend), 0) AS spend,
      COALESCE(SUM(p.sales), 0) AS sales,
      COALESCE(SUM(p.orders), 0) AS orders,
      COALESCE(SUM(p.clicks), 0) AS clicks,
      COALESCE(SUM(p.impressions), 0) AS impressions,
      COALESCE(SUM(p.spend) FILTER (WHERE p.ad_type = 'SP'), 0) AS sp_spend,
      COALESCE(SUM(p.sales) FILTER (WHERE p.ad_type = 'SP'), 0) AS sp_sales,
      COALESCE(SUM(p.orders) FILTER (WHERE p.ad_type = 'SP'), 0) AS sp_orders,
      COALESCE(SUM(p.clicks) FILTER (WHERE p.ad_type = 'SP'), 0) AS sp_clicks,
      COALESCE(SUM(p.impressions) FILTER (WHERE p.ad_type = 'SP'), 0) AS sp_impressions,
      COALESCE(SUM(p.spend) FILTER (WHERE p.ad_type = 'SB'), 0) AS sb_spend,
      COALESCE(SUM(p.sales) FILTER (WHERE p.ad_type = 'SB'), 0) AS sb_sales,
      COALESCE(SUM(p.orders) FILTER (WHERE p.ad_type = 'SB'), 0) AS sb_orders,
      COALESCE(SUM(p.clicks) FILTER (WHERE p.ad_type = 'SB'), 0) AS sb_clicks,
      COALESCE(SUM(p.impressions) FILTER (WHERE p.ad_type = 'SB'), 0) AS sb_impressions
    FROM ppc_daily_summary p
    JOIN ppc_stores s ON s.id = p.store_id
    CROSS JOIN anchor a
    WHERE s.team_id = ${teamId}
      AND (${storeName === "ALL"} OR lower(s.name) = lower(${storeName}))
      AND (${!filters.startDate} OR p.report_date >= ${filters.startDate || "1970-01-01"}::date)
      AND (${!filters.endDate} OR p.report_date <= ${filters.endDate || "2099-12-31"}::date)
      AND (${Boolean(filters.startDate || filters.endDate)} OR (p.report_date >= a.max_date - (${days} - 1)::integer AND p.report_date <= a.max_date))
    GROUP BY p.report_date
    ORDER BY p.report_date ASC;
  `;

  if (rows.length === 0 && !filters.startDate && !filters.endDate) {
    await refreshPpcDailySummary(scope);
    rows = await sql<DailyTrendSqlRow[]>`
      WITH anchor AS (
        SELECT COALESCE(
          MAX(p0.report_date),
          CURRENT_DATE - 1
        ) AS max_date
        FROM ppc_daily_summary p0
        JOIN ppc_stores s0 ON s0.id = p0.store_id
        WHERE s0.team_id = ${teamId}
          AND (${storeName === "ALL"} OR lower(s0.name) = lower(${storeName}))
      )
      SELECT 
        to_char(p.report_date, 'YYYY-MM-DD') AS date,
        COALESCE(SUM(p.spend), 0) AS spend,
        COALESCE(SUM(p.sales), 0) AS sales,
        COALESCE(SUM(p.orders), 0) AS orders,
        COALESCE(SUM(p.clicks), 0) AS clicks,
        COALESCE(SUM(p.impressions), 0) AS impressions,
        COALESCE(SUM(p.spend) FILTER (WHERE p.ad_type = 'SP'), 0) AS sp_spend,
        COALESCE(SUM(p.sales) FILTER (WHERE p.ad_type = 'SP'), 0) AS sp_sales,
        COALESCE(SUM(p.orders) FILTER (WHERE p.ad_type = 'SP'), 0) AS sp_orders,
        COALESCE(SUM(p.clicks) FILTER (WHERE p.ad_type = 'SP'), 0) AS sp_clicks,
        COALESCE(SUM(p.impressions) FILTER (WHERE p.ad_type = 'SP'), 0) AS sp_impressions,
        COALESCE(SUM(p.spend) FILTER (WHERE p.ad_type = 'SB'), 0) AS sb_spend,
        COALESCE(SUM(p.sales) FILTER (WHERE p.ad_type = 'SB'), 0) AS sb_sales,
        COALESCE(SUM(p.orders) FILTER (WHERE p.ad_type = 'SB'), 0) AS sb_orders,
        COALESCE(SUM(p.clicks) FILTER (WHERE p.ad_type = 'SB'), 0) AS sb_clicks,
        COALESCE(SUM(p.impressions) FILTER (WHERE p.ad_type = 'SB'), 0) AS sb_impressions
      FROM ppc_daily_summary p
      JOIN ppc_stores s ON s.id = p.store_id
      CROSS JOIN anchor a
      WHERE s.team_id = ${teamId}
        AND (${storeName === "ALL"} OR lower(s.name) = lower(${storeName}))
        AND (p.report_date >= a.max_date - (${days} - 1)::integer AND p.report_date <= a.max_date)
      GROUP BY p.report_date
      ORDER BY p.report_date ASC;
    `;
  }

  return rows.map((r) => {
    const spend = Math.round(Number(r.spend || 0) * 100) / 100;
    const sales = Math.round(Number(r.sales || 0) * 100) / 100;
    const orders = Number(r.orders || 0);
    const clicks = Number(r.clicks || 0);
    const impressions = Number(r.impressions || 0);

    const acos = sales > 0 ? (spend / sales) * 100 : (spend > 0 ? 999 : 0);
    const roas = spend > 0 ? sales / spend : 0;
    const cvr = clicks > 0 ? (orders / clicks) * 100 : 0;
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;

    return {
      date: r.date,
      spend,
      sales,
      orders,
      clicks,
      impressions,
      acos: Math.round(acos * 10) / 10,
      roas: Math.round(roas * 100) / 100,
      cvr: Math.round(cvr * 100) / 100,
      ctr: Math.round(ctr * 100) / 100,
      cpc: Math.round(cpc * 100) / 100,
      spSpend: Math.round(Number(r.sp_spend || 0) * 100) / 100,
      spSales: Math.round(Number(r.sp_sales || 0) * 100) / 100,
      spOrders: Number(r.sp_orders || 0),
      spClicks: Number(r.sp_clicks || 0),
      spImpressions: Number(r.sp_impressions || 0),
      sbSpend: Math.round(Number(r.sb_spend || 0) * 100) / 100,
      sbSales: Math.round(Number(r.sb_sales || 0) * 100) / 100,
      sbOrders: Number(r.sb_orders || 0),
      sbClicks: Number(r.sb_clicks || 0),
      sbImpressions: Number(r.sb_impressions || 0),
    };
  });
}

export interface PpcDailyCampaignItem {
  date: string;
  campaignName: string;
  adType: string;
  orders: number;
  sales: number;
  spend: number;
  clicks: number;
  impressions: number;
  acos: number;
  roas: number;
  cpc: number;
}

export async function listPpcDailyCampaignsFromDb(
  scope: DataScope,
  filters: { storeName?: string; days?: number } = {},
): Promise<PpcDailyCampaignItem[]> {
  const sql = await getDatabaseClient();
  const teamId = scope.teamId;
  const storeName = filters.storeName || "ALL";
  const days = Math.max(14, filters.days || 14);

  const rows = await sql<Array<{
    date: string;
    campaign_name: string;
    ad_type: string;
    orders: string | number;
    sales: string | number;
    spend: string | number;
    clicks: string | number;
    impressions: string | number;
  }>>`
    WITH anchor AS (
      SELECT COALESCE(
        (
          SELECT MAX(p1.report_date)
          FROM ppc_daily_summary p1
          JOIN ppc_stores s1 ON s1.id = p1.store_id
          WHERE s1.team_id = ${teamId}
            AND (${storeName === "ALL"} OR lower(s1.name) = lower(${storeName}))
        ),
        (
          SELECT MAX(p0.report_date)
          FROM ppc_search_terms p0
          JOIN ppc_stores s0 ON s0.id = p0.store_id
          WHERE s0.team_id = ${teamId}
            AND (${storeName === "ALL"} OR lower(s0.name) = lower(${storeName}))
            AND p0.report_granularity = 'DAILY'
        ),
        CURRENT_DATE - 1
      ) AS max_date
    )
    SELECT 
      to_char(p.report_date, 'YYYY-MM-DD') AS date,
      p.campaign_name,
      COALESCE(p.ad_type, 'SP') AS ad_type,
      COALESCE(SUM(p.orders), 0) AS orders,
      COALESCE(SUM(p.sales), 0) AS sales,
      COALESCE(SUM(p.spend), 0) AS spend,
      COALESCE(SUM(p.clicks), 0) AS clicks,
      COALESCE(SUM(p.impressions), 0) AS impressions
    FROM ppc_search_terms p
    JOIN ppc_stores s ON s.id = p.store_id
    CROSS JOIN anchor a
    WHERE s.team_id = ${teamId}
      AND (${storeName === "ALL"} OR lower(s.name) = lower(${storeName}))
      AND p.report_granularity = 'DAILY'
      AND p.report_date >= a.max_date - (${days} - 1)::integer
      AND p.report_date <= a.max_date
    GROUP BY p.report_date, p.campaign_name, p.ad_type
    ORDER BY p.report_date DESC, orders DESC, sales DESC, spend DESC;
  `;

  return rows.map((r) => {
    const spend = Math.round(Number(r.spend || 0) * 100) / 100;
    const sales = Math.round(Number(r.sales || 0) * 100) / 100;
    const orders = Number(r.orders || 0);
    const clicks = Number(r.clicks || 0);
    const impressions = Number(r.impressions || 0);
    const acos = sales > 0 ? Math.round((spend / sales) * 1000) / 10 : (spend > 0 ? 999 : 0);
    const roas = spend > 0 ? Math.round((sales / spend) * 100) / 100 : 0;
    const cpc = clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0;

    return {
      date: r.date,
      campaignName: r.campaign_name,
      adType: r.ad_type,
      orders,
      sales,
      spend,
      clicks,
      impressions,
      acos,
      roas,
      cpc,
    };
  });
}

export async function getPpcSearchTermSummaryFromDb(
  scope: DataScope,
  filters: { storeName?: string; sku?: string; days?: number; startDate?: string; endDate?: string; minClicksThreshold?: number; maxSpendThreshold?: number } = {},
): Promise<{
  summary: PpcSearchTermSummary;
  topProfitableAndBleeding: PpcSearchTermRow[];
  alertRows: PpcSearchTermRow[];
}> {
  const sql = await getDatabaseClient();
  const teamId = (scope as any)?.teamId || "default";
  const storeName = filters.storeName || "ALL";
  const sku = filters.sku || "ALL";
  const days = Math.max(1, filters.days || 30);
  const minClicks = filters.minClicksThreshold ?? 10;
  const maxSpend = filters.maxSpendThreshold ?? 15.0;

  const [summaryRows, topTermsRows, alertTermsRows] = await Promise.all([
    sql<Array<{
      total_terms: string | number;
      terms_with_orders: string | number;
      terms_without_orders: string | number;
      candidate_bleeder_terms: string | number;
      observed_spend: string | number;
      observed_sales: string | number;
      observed_orders: string | number;
      observed_clicks: string | number;
      wasted_spend: string | number;
    }>>`
      WITH anchor AS (
        SELECT COALESCE(MAX(p0.report_date), CURRENT_DATE - 1) AS max_date
        FROM ppc_search_terms p0
        JOIN ppc_stores s0 ON s0.id = p0.store_id
        WHERE s0.team_id = ${teamId}
          AND (${storeName === "ALL"} OR lower(s0.name) = lower(${storeName}))
      )
      SELECT 
        COUNT(*) AS total_terms,
        COUNT(*) FILTER (WHERE p.orders > 0) AS terms_with_orders,
        COUNT(*) FILTER (WHERE p.orders = 0) AS terms_without_orders,
        COUNT(*) FILTER (WHERE p.orders = 0 AND (p.clicks >= ${minClicks} OR p.spend >= ${maxSpend})) AS candidate_bleeder_terms,
        COALESCE(SUM(p.spend), 0) AS observed_spend,
        COALESCE(SUM(p.sales), 0) AS observed_sales,
        COALESCE(SUM(p.orders), 0) AS observed_orders,
        COALESCE(SUM(p.clicks), 0) AS observed_clicks,
        COALESCE(SUM(p.spend) FILTER (WHERE p.orders = 0 AND (p.clicks >= ${minClicks} OR p.spend >= ${maxSpend})), 0) AS wasted_spend
      FROM ppc_search_terms p
      JOIN ppc_stores s ON s.id = p.store_id
      CROSS JOIN anchor a
      WHERE s.team_id = ${teamId}
        AND (${storeName === "ALL"} OR lower(s.name) = lower(${storeName}))
        AND (
          ${sku === "ALL"}
          OR lower(p.portfolio_name) = lower(${sku})
          OR position(lower(${sku}) in lower(p.campaign_name)) > 0
        )
        AND (${!filters.startDate} OR p.report_date >= ${filters.startDate || "1970-01-01"}::date)
        AND (${!filters.endDate} OR p.report_date <= ${filters.endDate || "2099-12-31"}::date)
        AND (${Boolean(filters.startDate || filters.endDate)} OR (p.report_date >= a.max_date - (${days} - 1)::integer AND p.report_date <= a.max_date));
    `,

    sql<SearchTermDbRow[]>`
      WITH anchor AS (
        SELECT COALESCE(MAX(p0.report_date), CURRENT_DATE - 1) AS max_date
        FROM ppc_search_terms p0
        JOIN ppc_stores s0 ON s0.id = p0.store_id
        WHERE s0.team_id = ${teamId}
          AND (${storeName === "ALL"} OR lower(s0.name) = lower(${storeName}))
      )
      (
        SELECT p.*
        FROM ppc_search_terms p
        JOIN ppc_stores s ON s.id = p.store_id
        CROSS JOIN anchor a
        WHERE s.team_id = ${teamId}
          AND (${storeName === "ALL"} OR lower(s.name) = lower(${storeName}))
          AND (
            ${sku === "ALL"}
            OR lower(p.portfolio_name) = lower(${sku})
            OR position(lower(${sku}) in lower(p.campaign_name)) > 0
          )
          AND (${!filters.startDate} OR p.report_date >= ${filters.startDate || "1970-01-01"}::date)
          AND (${!filters.endDate} OR p.report_date <= ${filters.endDate || "2099-12-31"}::date)
          AND (${Boolean(filters.startDate || filters.endDate)} OR (p.report_date >= a.max_date - (${days} - 1)::integer AND p.report_date <= a.max_date))
          AND p.orders >= 2 AND p.acos <= 30
        ORDER BY p.sales DESC, p.id
        LIMIT 5
      )
      UNION ALL
      (
        SELECT p.*
        FROM ppc_search_terms p
        JOIN ppc_stores s ON s.id = p.store_id
        CROSS JOIN anchor a
        WHERE s.team_id = ${teamId}
          AND (${storeName === "ALL"} OR lower(s.name) = lower(${storeName}))
          AND (
            ${sku === "ALL"}
            OR lower(p.portfolio_name) = lower(${sku})
            OR position(lower(${sku}) in lower(p.campaign_name)) > 0
          )
          AND (${!filters.startDate} OR p.report_date >= ${filters.startDate || "1970-01-01"}::date)
          AND (${!filters.endDate} OR p.report_date <= ${filters.endDate || "2099-12-31"}::date)
          AND (${Boolean(filters.startDate || filters.endDate)} OR (p.report_date >= a.max_date - (${days} - 1)::integer AND p.report_date <= a.max_date))
          AND p.clicks >= 9 AND p.orders = 0
        ORDER BY p.spend DESC, p.id
        LIMIT 5
      );
    `,

    sql<SearchTermDbRow[]>`
      WITH anchor AS (
        SELECT COALESCE(MAX(p0.report_date), CURRENT_DATE - 1) AS max_date
        FROM ppc_search_terms p0
        JOIN ppc_stores s0 ON s0.id = p0.store_id
        WHERE s0.team_id = ${teamId}
          AND (${storeName === "ALL"} OR lower(s0.name) = lower(${storeName}))
      )
      SELECT p.*
      FROM ppc_search_terms p
      JOIN ppc_stores s ON s.id = p.store_id
      CROSS JOIN anchor a
      WHERE s.team_id = ${teamId}
        AND (${storeName === "ALL"} OR lower(s.name) = lower(${storeName}))
        AND (
          ${sku === "ALL"}
          OR lower(p.portfolio_name) = lower(${sku})
          OR position(lower(${sku}) in lower(p.campaign_name)) > 0
        )
        AND (${!filters.startDate} OR p.report_date >= ${filters.startDate || "1970-01-01"}::date)
        AND (${!filters.endDate} OR p.report_date <= ${filters.endDate || "2099-12-31"}::date)
        AND (${Boolean(filters.startDate || filters.endDate)} OR (p.report_date >= a.max_date - (${days} - 1)::integer AND p.report_date <= a.max_date))
        AND (
          (p.clicks >= 9 AND p.orders = 0 AND p.spend > 5)
          OR (p.orders > 0 AND p.acos > 60 AND p.spend >= 15)
          OR (p.impressions >= 1000 AND p.ctr < 0.1)
        );
    `,
  ]);

  const s = summaryRows[0];
  const totalTerms = Number(s?.total_terms || 0);
  const termsWithOrders = Number(s?.terms_with_orders || 0);
  const termsWithoutOrders = Number(s?.terms_without_orders || 0);
  const candidateBleederTerms = Number(s?.candidate_bleeder_terms || 0);
  const observedSpend = asNumber(s?.observed_spend);
  const observedSales = asNumber(s?.observed_sales);
  const observedOrders = Number(s?.observed_orders || 0);
  const observedClicks = Number(s?.observed_clicks || 0);
  const wastedSpend = asNumber(s?.wasted_spend);

  const observedAcos = observedSales > 0 ? (observedSpend / observedSales) * 100 : 0;
  const observedRoas = observedSpend > 0 ? observedSales / observedSpend : 0;

  const summary: PpcSearchTermSummary = {
    totalTerms,
    termsWithOrders,
    termsWithoutOrders,
    candidateBleederTerms,
    observedSpend: Math.round(observedSpend * 100) / 100,
    observedSales: Math.round(observedSales * 100) / 100,
    observedOrders,
    observedClicks,
    observedAcos: Math.round(observedAcos * 10) / 10,
    observedRoas: Math.round(observedRoas * 100) / 100,
    wastedSpend: Math.round(wastedSpend * 100) / 100,
  };

  return {
    summary,
    topProfitableAndBleeding: topTermsRows.map(mapSearchTerm),
    alertRows: alertTermsRows.map(mapSearchTerm),
  };
}

export interface PpcCleanupResult {
  deletedPerformance: number;
  deletedSearchTerms: number;
  deletedDailySummary: number;
  deletedJobs: number;
  deletedLogs: number;
}

export async function cleanupPpcHistoricalData(
  _scope?: DataScope,
  retentionDays = 60,
): Promise<PpcCleanupResult> {
  const sql = await getDatabaseClient();
  const safeDays = Math.max(30, retentionDays);

  console.log(`[PPC Cleanup] Bắt đầu kiểm tra và dọn dẹp dữ liệu cũ hơn ${safeDays} ngày...`);

  try {
    const [perfRes, searchRes, summaryRes, jobRes, logRes] = await Promise.all([
      sql`DELETE FROM ppc_performance_facts WHERE snapshot_date < CURRENT_DATE - ${safeDays} * INTERVAL '1 day' RETURNING id`,
      sql`DELETE FROM ppc_search_terms WHERE report_date < CURRENT_DATE - ${safeDays} * INTERVAL '1 day' RETURNING id`,
      sql`DELETE FROM ppc_daily_summary WHERE report_date < CURRENT_DATE - ${safeDays} * INTERVAL '1 day' RETURNING id`,
      sql`DELETE FROM ppc_ingestion_jobs WHERE status IN ('COMPLETED', 'FAILED', 'CANCELLED') AND updated_at < NOW() - INTERVAL '30 days' RETURNING id`,
      sql`DELETE FROM ppc_sync_logs WHERE created_at < NOW() - INTERVAL '30 days' RETURNING id`,
    ]);

    const result: PpcCleanupResult = {
      deletedPerformance: perfRes.length,
      deletedSearchTerms: searchRes.length,
      deletedDailySummary: summaryRes.length,
      deletedJobs: jobRes.length,
      deletedLogs: logRes.length,
    };

    if (result.deletedPerformance > 0 || result.deletedSearchTerms > 0 || result.deletedJobs > 0) {
      console.log(
        `[PPC Cleanup] ✓ Hoàn tất: Xóa ${result.deletedPerformance.toLocaleString()} dòng performance, ${result.deletedSearchTerms.toLocaleString()} dòng search terms, ${result.deletedJobs} jobs cũ.`,
      );
    } else {
      console.log("[PPC Cleanup] ✓ Database sạch sẽ, không có bản ghi nào quá hạn cần xóa.");
    }

    return result;
  } catch (err) {
    console.warn("[PPC Cleanup] Lỗi khi dọn dẹp:", err);
    return {
      deletedPerformance: 0,
      deletedSearchTerms: 0,
      deletedDailySummary: 0,
      deletedJobs: 0,
      deletedLogs: 0,
    };
  }
}
