import { ApiError, authorize, routeErrorResponse } from "@/lib/api-guard";
import { canAccessStore, getAccountingAccess, hasFullAccountingAccess } from "@/lib/accounting/access";
import { listStores } from "@/lib/accounting/accounting-db";
import { ACCOUNTING_FRESHNESS_VIEWS, type AccountingFreshness, type AccountingFreshnessView, type AccountingStockPeriod } from "@/lib/accounting/freshness";
import { storeHasFbaTeam, storeHasTeam } from "@/lib/accounting/store-teams";
import { getDatabaseClient } from "@/lib/db";

type Sql = Awaited<ReturnType<typeof getDatabaseClient>>;

type Source = {
  table: string;
  stamp?: string;
  channel?: "fulfillment_channel" | "loai" | "channel";
};

const orders: Source = { table: "accounting_orders", channel: "fulfillment_channel" };
const ads: Source = { table: "accounting_ads", channel: "loai" };
const returns: Source = { table: "accounting_returns", channel: "loai" };
const fees: Source = { table: "accounting_service_fees" };
const sku: Source = { table: "accounting_sku_master" };
const skuFbm: Source = { table: "accounting_sku_master_fbm" };
const inbound: Source = { table: "accounting_inbound_shipments" };
const baseCost: Source = { table: "accounting_monthly_base_cost" };
const history: Source = { table: "accounting_daily_history", stamp: "imported_at", channel: "channel" };
const monthly: Source = { table: "accounting_monthly_store_summary" };
const monthlyFbm: Source = { table: "accounting_fbm_monthly_store_summary" };
const dailyFba = [orders, ads, returns, fees];
const dailyFbm = [orders, ads, returns];
const sources: Record<AccountingFreshnessView, { FBA?: Source[]; FBM?: Source[] }> = {
  dashboard: { FBA: [...dailyFba, history, monthly], FBM: [...dailyFbm, history, monthlyFbm] },
  daily: { FBA: dailyFba, FBM: dailyFbm },
  weekly: { FBA: [...dailyFba, { table: "accounting_weekly_prepaid_stock" }], FBM: dailyFbm },
  monthly: { FBA: [monthly], FBM: [monthlyFbm] },
  "sku-results": { FBA: [...dailyFba, sku, baseCost], FBM: [...dailyFbm, skuFbm] },
  testing: { FBA: [...dailyFba, sku, { table: "accounting_kqkd_win_results" }, { table: "accounting_kqkd_store_test_targets" }] },
  kpi: { FBA: [monthly, orders, sku, { table: "accounting_kpi_targets" }, { table: "accounting_kpi_sku_history", stamp: "imported_at" }] },
  sku: { FBA: [sku], FBM: [skuFbm] },
  inbound: { FBA: [inbound] },
  shipments: { FBA: [{ table: "accounting_amazon_check_shipments" }] },
  "base-cost": { FBA: [baseCost], FBM: [{ table: "accounting_fbm_pw_costs", stamp: "synced_at" }] },
  stock: { FBA: [sku, inbound, baseCost] },
  orders: { FBA: [orders], FBM: [orders] },
  ads: { FBA: [ads], FBM: [ads] },
  returns: { FBA: [returns], FBM: [returns] },
  fees: { FBA: [fees] },
  // These use different scope keys from the report tables.
  stores: {},
  payout: {},
  files: {},
  access: {},
};

const UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

function latest(sql: Sql, source: Source, storeIds: string[], channel: "FBA" | "FBM", { filter = sql``, order = sql`` } = {}) {
  const stamp = sql(source.stamp ?? "updated_at");
  return sql`(
    SELECT MAX(row_stamp.at)
    FROM unnest(${storeIds}::uuid[]) AS scoped(id)
    CROSS JOIN LATERAL (
      SELECT ${stamp} AS at FROM ${sql(source.table)}
      WHERE store_id = scoped.id AND ${stamp} IS NOT NULL
      ${source.channel === "fulfillment_channel" ? sql`AND fulfillment_channel = ${channel === "FBA" ? "Amazon" : "Merchant"}` : sql``}
      ${source.channel === "loai" ? sql`AND upper(trim(loai)) = ${channel}` : sql``}
      ${source.channel === "channel" ? sql`AND channel = ${channel}` : sql``}
      ${filter}
      ORDER BY ${order} ${stamp} DESC LIMIT 1
    ) AS row_stamp
  )`;
}

function mostRecent(sql: Sql, timestamps: ReturnType<typeof latest>[]) {
  return timestamps.length
    ? sql`GREATEST(${timestamps.reduce((a, b) => sql`${a}, ${b}`)})`
    : sql`NULL::timestamptz`;
}

function stockStamps(sql: Sql, view: AccountingFreshnessView, stores: string[], params: URLSearchParams) {
  const none = sql`NULL::timestamptz`;
  if (!stores.length || params.get("stock") === "off") return { day: none, week: none, month: none };

  const through = params.get("stock_through") || undefined;
  const before = through ? sql`AND snapshot_date <= ${through}::date` : sql``;
  const fromMonth = params.get("stock_from_month");
  const toMonth = params.get("stock_to_month");
  const ledger = (table: string) => latest(sql, { table }, stores, "FBA", {
    filter: before,
    order: sql`snapshot_date DESC,`,
  });
  const master = (stamp: string) => latest(sql, { ...sku, stamp }, stores, "FBA", { filter: sql`AND deleted_at IS NULL` });

  switch (view) {
    case "stock": {
      const snapshots = ["FBA", "AWD"].map((warehouse) => latest(
        sql, { table: "accounting_live_inventory_daily", stamp: "imported_at" }, stores, "FBA",
        { filter: sql`AND source = ${warehouse} ${before}`, order: sql`snapshot_date DESC,` },
      ));
      return { day: mostRecent(sql, snapshots), week: none, month: none };
    }
    case "dashboard":
    case "weekly":
      return { day: none, week: mostRecent(sql, [ledger("accounting_inventory_ledger"), ledger("accounting_awd_inventory_ledger")]), month: none };
    case "sku-results":
      return { day: none, week: master("ton_kho_fba_updated_at"), month: none };
    case "sku":
    case "testing":
      return { day: none, week: master("ton_kho_updated_at"), month: none };
    case "monthly": {
      const period = (value: string) => Number(value.replace("-", ""));
      const months = fromMonth && toMonth
        ? sql`AND year * 100 + month BETWEEN ${period(fromMonth)} AND ${period(toMonth)}` : sql``;
      const month = latest(sql, { table: "accounting_sku_monthly" }, stores, "FBA", { filter: sql`AND available_now <> 0 ${months}` });
      const week = latest(sql, { ...sku, stamp: "ton_kho_updated_at" }, stores, "FBA", {
        filter: sql`AND deleted_at IS NULL AND EXISTS (
          SELECT 1 FROM accounting_sku_monthly sm
          WHERE sm.store_id = accounting_sku_master.store_id AND sm.sku = accounting_sku_master.sku
            AND COALESCE(sm.available_now, 0) = 0 ${months}
        )`,
      });
      return { day: none, week, month };
    }
    case "base-cost": {
      const months = fromMonth && toMonth ? sql`AND period BETWEEN ${fromMonth} AND ${toMonth}` : sql``;
      const month = latest(sql, baseCost, stores, "FBA", { filter: sql`AND deleted_at IS NULL ${months}` });
      return { day: none, week: none, month };
    }
    default:
      return { day: none, week: none, month: none };
  }
}

export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "accounting");
    const params = new URL(request.url).searchParams;
    const view = params.get("view") as AccountingFreshnessView;
    const channel = params.get("channel");
    const through = params.get("stock_through");
    const stockMonths = [params.get("stock_from_month"), params.get("stock_to_month")];
    const storeIds = (params.get("store_ids") || "").toLowerCase().split(",").filter(Boolean);
    if (!ACCOUNTING_FRESHNESS_VIEWS.includes(view) || storeIds.some((id) => !UUID.test(id)) ||
      (channel !== null && channel !== "FBA" && channel !== "FBM") ||
      (through !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(through) || !Number.isFinite(Date.parse(through)))) ||
      stockMonths.some((month) => month !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))) {
      throw new ApiError("Bộ lọc cập nhật dữ liệu không hợp lệ.", 400);
    }
    if ((view === "payout" || view === "files" || view === "access") && !hasFullAccountingAccess(actor)) {
      throw new ApiError("Chỉ Admin hoặc Kế toán được xem dữ liệu này.", 403);
    }

    const allStores = await listStores();
    const access = await getAccountingAccess(actor, allStores);
    const storeTeam = params.get("team");
    const storeName = params.get("store_name")?.trim().toUpperCase();
    const stores = allStores.filter((s) => (!storeIds.length || storeIds.includes(s.id)) &&
      (!storeName || s.name.trim().toUpperCase() === storeName) &&
      (!storeTeam || storeHasTeam(s.team, storeTeam)) && canAccessStore(access, s.id));
    const scopedIds = (kind: "FBA" | "FBM") => stores.filter((s) => {
      if ((channel && channel !== kind) || !canAccessStore(access, s.id, kind)) return false;
      if (view !== "dashboard") return true;
      if (storeTeam) return kind === (storeTeam.toUpperCase() === "FBM" ? "FBM" : "FBA");
      const hasFbm = storeHasTeam(s.team, "FBM");
      return kind === "FBM" ? hasFbm : storeHasFbaTeam(s.team) || !hasFbm;
    }).map((s) => s.id);

    const sql = await getDatabaseClient();
    const fba = scopedIds("FBA");
    const fbm = scopedIds("FBM");
    const dataStamps = [
      ...(fba.length ? (sources[view].FBA ?? []).map((s) => latest(sql, s, fba, "FBA")) : []),
      ...(fbm.length ? (sources[view].FBM ?? []).map((s) => latest(sql, s, fbm, "FBM")) : []),
    ];
    if (view === "stores") {
      dataStamps.push(sql`(SELECT MAX(updated_at) FROM stores WHERE id = ANY(${stores.map((s) => s.id)}::uuid[]))`);
    }
    if (view === "payout") {
      dataStamps.push(sql`(SELECT MAX(updated_at) FROM accounting_payout_disbursements WHERE payout_status = 'Done' AND acknowledged_date IS NOT NULL)`);
    }
    if (view === "access") {
      dataStamps.push(sql`(SELECT MAX(updated_at) FROM accounting_user_access WHERE team_id = ${actor.teamId})`);
    }

    const stock = stockStamps(sql, view, fba, params);
    const [row] = await sql<({ dataAt: Date | null } & Record<AccountingStockPeriod, Date | null>)[]>`
      SELECT ${mostRecent(sql, dataStamps)} AS "dataAt", ${stock.day} AS day, ${stock.week} AS week, ${stock.month} AS month
    `;
    const period = row.day ? "day" : row.month ? "month" : "week";
    const at = row[period];
    const result: AccountingFreshness = { dataAt: row.dataAt?.toISOString() ?? null, stock: at ? { period, at: at.toISOString() } : null };
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "Không đọc được thời điểm cập nhật dữ liệu.");
  }
}
