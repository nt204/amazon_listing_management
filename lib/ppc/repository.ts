import "server-only";

import { getDatabaseClient, type DataScope } from "@/lib/db";
import type {
  MatchType,
  PpcAdType,
  PpcPerformanceGrain,
  PpcPerformanceRow,
  PpcReportGranularity,
  PpcSearchTermRow,
  PpcStore,
} from "./types";

export type PpcSyncSource = "CLOUDFLARE_R2" | "MANUAL_UPLOAD" | "MOCK_DATA";
export type PpcSyncStatus = "SUCCESS" | "FAILED" | "SKIPPED";

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
  const rows = await sql<StoreRow[]>`
    SELECT id, name, marketplace, target_acos, daily_budget, status
    FROM ppc_stores
    WHERE team_id = ${scope.teamId}
    ORDER BY lower(name)
  `;
  return rows.map(mapStore);
}

export async function listPpcSearchTerms(
  scope: DataScope,
  filters: { storeName: string; sku: string; days: number },
  options: { limit?: number; offset?: number } = {},
): Promise<PpcSearchTermRow[]> {
  const sql = await getDatabaseClient();
  const rows = await sql<SearchTermDbRow[]>`
    WITH daily_counts AS (
      SELECT store_id, ad_type, COUNT(*) as cnt
      FROM ppc_search_terms
      WHERE report_granularity = 'DAILY'
        AND report_date >= CURRENT_DATE - ${filters.days}::integer
        AND report_date <= CURRENT_DATE
      GROUP BY store_id, ad_type
    ),
    latest_range AS (
      SELECT store_id, ad_type, MAX(report_end_date) as max_end_date
      FROM ppc_search_terms
      WHERE report_granularity = 'RANGE'
        AND (report_end_date - report_start_date + 1)
          BETWEEN ${filters.days - 3}::integer AND ${filters.days + 3}::integer
        AND report_end_date <= CURRENT_DATE
      GROUP BY store_id, ad_type
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
    LEFT JOIN daily_counts dc ON dc.store_id = t.store_id AND dc.ad_type = t.ad_type
    LEFT JOIN latest_range lr ON lr.store_id = t.store_id AND lr.ad_type = t.ad_type
    WHERE s.team_id = ${scope.teamId}
      AND (${filters.storeName === "ALL"} OR lower(s.name) = lower(${filters.storeName}))
      AND (
        ${filters.sku === "ALL"}
        OR lower(t.portfolio_name) = lower(${filters.sku})
        OR position(lower(${filters.sku}) in lower(t.campaign_name)) > 0
      )
      AND (
        (
          t.report_granularity = 'DAILY'
          AND t.report_date >= CURRENT_DATE - ${filters.days}::integer
          AND t.report_date <= CURRENT_DATE
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
  const rows = await sql<PerformanceDbRow[]>`
    WITH latest_snapshots AS (
      SELECT DISTINCT ON (p2.store_id, p2.ad_type)
        p2.store_id, p2.ad_type, p2.snapshot_date AS max_snapshot,
        p2.report_end_date AS max_report_end
      FROM ppc_performance_facts p2
      JOIN ppc_stores s2 ON s2.id = p2.store_id
      WHERE s2.team_id = ${scope.teamId}
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
      AND ls.max_report_end = p.report_end_date
    WHERE s.team_id = ${scope.teamId}
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
        OR (
          p.grain = 'TARGET'
          AND p.state = 'enabled'
          AND (
            p.campaign_name ILIKE '%GO%' OR p.sku ILIKE '%GO%'
            OR EXISTS (
              SELECT 1 FROM ppc_performance_facts c_act
              WHERE c_act.store_id = p.store_id
                AND c_act.ad_type = p.ad_type
                AND c_act.snapshot_date = p.snapshot_date
                AND c_act.report_end_date = p.report_end_date
                AND c_act.grain = 'CAMPAIGN'
                AND c_act.campaign_id = p.campaign_id
                AND (c_act.state = 'enabled' OR c_act.spend > 0 OR c_act.impressions > 0)
            )
          )
        )
      )
    ORDER BY p.ad_type, p.grain, p.spend DESC, p.id
    LIMIT ${Math.min(50_000, Math.max(1, options.limit || 50_000))}
    OFFSET ${Math.max(0, options.offset || 0)}
  `;
  return rows.map(mapPerformance);
}

export async function listPpcSyncLogs(scope: DataScope, limit = 10): Promise<PpcSyncLog[]> {
  const sql = await getDatabaseClient();
  const rows = await sql<SyncLogRow[]>`
    SELECT id, source, file_name, status, records_count, message, created_at
    FROM ppc_sync_logs
    WHERE team_id = ${scope.teamId}
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
  const rows = await sql<{ found: boolean }[]>`
    SELECT EXISTS(
      SELECT 1 FROM ppc_sync_logs
      WHERE team_id = ${scope.teamId}
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
  await sql`
    INSERT INTO ppc_sync_logs (
      team_id, source, file_name, source_version, status, records_count, message
    ) VALUES (
      ${scope.teamId}, ${input.source}, ${input.fileName || null},
      ${input.sourceVersion || null}, ${input.status}, ${input.count || 0},
      ${input.message || null}
    )
    ON CONFLICT DO NOTHING
  `;
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
  options: { replaceExisting?: boolean } = {},
): Promise<{ inserted: number; updated: number; deduplicated: number }> {
  const sql = await getDatabaseClient();
  const uniqueRows = Array.from(new Map(rows.map((row) => [rowIdentity(row), row])).values());

  return sql.begin(async (transaction) => {
    const storeRows = await transaction<StoreRow[]>`
      INSERT INTO ppc_stores (team_id, name)
      VALUES (${scope.teamId}, ${storeName})
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

    return { inserted, updated, deduplicated: rows.length - uniqueRows.length };
  });
}

function performanceIdentity(row: PpcPerformanceRow): string {
  return [
    safeSqlString(row.entityId),
    safeSqlString(row.sku),
    safeSqlString(row.placement),
  ].join(":::");
}

export async function upsertPpcPerformance(
  scope: DataScope,
  storeName: string,
  rows: PpcPerformanceRow[],
  options: { replaceExisting?: boolean } = {},
): Promise<{ inserted: number; updated: number; deduplicated: number }> {
  const sql = await getDatabaseClient();
  const uniqueRows = Array.from(new Map(rows.map((row) => [
    [row.snapshotDate, row.reportStartDate, row.reportEndDate, row.adType, row.grain, performanceIdentity(row)].join(":::"),
    row,
  ])).values());
  return sql.begin(async (transaction) => {
    const storeRows = await transaction<StoreRow[]>`
      INSERT INTO ppc_stores (team_id, name)
      VALUES (${scope.teamId}, ${storeName})
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
      inserted += saved.filter((row) => row.inserted).length;
      updated += saved.filter((row) => !row.inserted).length;
    }
    return { inserted, updated, deduplicated: rows.length - uniqueRows.length };
  });
}

export async function replacePpcDataWithMock(
  scope: DataScope,
  stores: PpcStore[],
  rows: PpcSearchTermRow[],
): Promise<void> {
  const sql = await getDatabaseClient();
  await sql.begin(async (transaction) => {
    await transaction`
      DELETE FROM ppc_stores WHERE team_id = ${scope.teamId}
    `;
    for (const store of stores) {
      await transaction`
        INSERT INTO ppc_stores (team_id, name, marketplace, target_acos, daily_budget, status)
        VALUES (
          ${scope.teamId}, ${store.name}, ${store.marketplace}, ${store.targetAcos},
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
