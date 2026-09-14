import "server-only";

import { getDatabaseClient, type DataScope } from "@/lib/db";
import type { MatchType, PpcSearchTermRow, PpcStore } from "./types";

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
    portfolioName: row.portfolio_name,
    campaignName: row.campaign_name,
    adGroupName: row.ad_group_name,
    targetKeyword: row.target_keyword,
    customerSearchTerm: row.customer_search_term,
    matchType: row.match_type,
    impressions: row.impressions,
    clicks: row.clicks,
    spend: asNumber(row.spend),
    sales: asNumber(row.sales),
    orders: row.orders,
    units: row.units,
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
): Promise<PpcSearchTermRow[]> {
  const sql = await getDatabaseClient();
  const rows = await sql<SearchTermDbRow[]>`
    SELECT
      t.id, t.store_id, s.name AS store_name, t.report_date,
      t.portfolio_name, t.campaign_name, t.ad_group_name,
      t.target_keyword, t.customer_search_term, t.match_type,
      t.impressions, t.clicks, t.spend, t.sales, t.orders, t.units,
      t.cpc, t.ctr, t.cvr, t.acos, t.roas,
      t.campaign_id, t.ad_group_id, t.keyword_id
    FROM ppc_search_terms t
    JOIN ppc_stores s ON s.id = t.store_id
    WHERE s.team_id = ${scope.teamId}
      AND (${filters.storeName === "ALL"} OR lower(s.name) = lower(${filters.storeName}))
      AND (${filters.sku === "ALL"} OR lower(t.portfolio_name) = lower(${filters.sku}))
      AND t.report_date >= CURRENT_DATE - ${filters.days - 1}::integer
    ORDER BY t.report_date DESC, t.created_at DESC, t.id
  `;
  return rows.map(mapSearchTerm);
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

function rowIdentity(row: PpcSearchTermRow): string {
  return [
    row.reportDate,
    row.portfolioName,
    row.campaignName,
    row.adGroupName,
    row.targetKeyword,
    row.customerSearchTerm,
    row.matchType,
  ].join("\u0000");
}

export async function upsertPpcSearchTerms(
  scope: DataScope,
  storeName: string,
  rows: PpcSearchTermRow[],
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
    let inserted = 0;
    let updated = 0;

    for (let start = 0; start < uniqueRows.length; start += 500) {
      const chunk = uniqueRows.slice(start, start + 500).map((row) => ({
        store_id: storeId,
        report_date: row.reportDate,
        portfolio_name: row.portfolioName,
        campaign_name: row.campaignName,
        ad_group_name: row.adGroupName,
        target_keyword: row.targetKeyword,
        customer_search_term: row.customerSearchTerm,
        match_type: row.matchType,
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
        roas: row.roas,
      }));
      const saved = await transaction<{ inserted: boolean }[]>`
        INSERT INTO ppc_search_terms ${transaction(chunk)}
        ON CONFLICT (
          store_id, report_date, portfolio_name, campaign_name, ad_group_name,
          target_keyword, customer_search_term, match_type
        ) DO UPDATE SET
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
