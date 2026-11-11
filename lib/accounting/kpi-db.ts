import "server-only";

import { ApiError } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { listSkuWin } from "@/lib/accounting/sku-win-db";
import { readSpreadsheetColumns, readSpreadsheetMeta, readSpreadsheetRange } from "@/lib/google/sheets";
import {
  emptyMetrics,
  normalizeTargetFormula,
  residualOther,
  shiftPeriod,
  splitTax,
  type KpiMetrics,
  type KpiTargetFormula,
  type KpiTargetInput,
} from "@/lib/accounting/kpi-calc";

// Mục "KPI kinh doanh" — file "<STORE> - KẾ HOẠCH KINH DOANH 2026" (team FBA):
// - BÁO CÁO THÁNG: tổng team = SKU phát triển + SKU test.
// - CHI TIẾT SKU (SKU phát triển = Bảng mã trạng thái "Phát triển", loại FBA) / CHI TIẾT SKU TEST (trạng thái "Test").
//   Mỗi SKU: cùng kỳ năm trước, tháng trước, mục tiêu, thực tế, đánh giá; cùng kỳ tháng sau năm trước, mục tiêu tháng sau.
// Kết quả 1 tháng của SKU lấy theo thứ tự: SKU Monthly đã chốt → số năm trước đã nạp (accounting_kpi_sku_history)
// → tạm tính trực tiếp bằng công thức Lọc SKU Win (như KQKD SKU).

export const KPI_GROUPS = [
  { key: "dev", status: "Phát triển" },
  { key: "test", status: "Test" },
] as const;
export type KpiGroup = (typeof KPI_GROUPS)[number]["key"];

export type KpiMonthSource = "closed" | "history" | "live" | "none";

export interface KpiTargetRow extends KpiTargetInput {
  cause: string | null;
  solution: string | null;
  action: string | null;
  /** Nhóm "Đánh giá mục tiêu" của tháng sau */
  review: string | null;
  target_action: string | null;
  updated_by: string | null;
  updated_at: string | null;
}

export interface KpiSku {
  sku: string;
  group: KpiGroup;
  status: string | null;
  brand: string | null;
  asin: string | null;
  product_type: string | null;
  mockup_url: string | null;
  pic_mkt: string | null;
  ton_kho: number | null;
  /** Thông tin tính mục tiêu */
  price: number | null;
  basecost_unit: number | null;
  amazon_fee_unit: number | null;
  referral_pct: number | null;
  /** Kết quả các tháng: prev (tháng trước), cur (tháng xem), ly (cùng kỳ năm trước), lyNext (cùng kỳ tháng sau năm trước) */
  actual: { prev: KpiMetrics | null; cur: KpiMetrics | null; ly: KpiMetrics | null; lyNext: KpiMetrics | null };
  target: { cur: KpiTargetRow | null; next: KpiTargetRow | null };
}

export interface KpiResult {
  period: string;
  periods: { prev: string; cur: string; next: string; ly: string; lyNext: string };
  sources: Record<"prev" | "cur" | "ly" | "lyNext", KpiMonthSource>;
  /** Phí AWD/Subscription/Disposal cấp store (chi phí dương), chỉ có ở tháng đã chốt */
  storeFees: Record<"prev" | "cur" | "ly" | "lyNext", number | null>;
  skus: KpiSku[];
  note: { note: string; updated_by: string | null; updated_at: string | null } | null;
  /** Mục tiêu tổng team nạp từ sheet khi tháng đó không có mục tiêu từng SKU */
  teamTargets: Record<"cur" | "next", Partial<Record<KpiGroup, KpiMetrics>>>;
  /** Công thức tính mục tiêu của store (nạp từ sheet KẾ HOẠCH, sửa tay được) */
  targetFormula: KpiTargetFormula & { source?: string | null; updated_by?: string | null };
  /** Các năm đã nạp số từ file TỔNG KẾT (để giao diện báo thiếu) */
  historyYears: number[];
  generatedAt: string;
}

const LIVE_TTL_PAST_MS = 10 * 60_000;
const LIVE_TTL_CURRENT_MS = 2 * 60_000;
const liveCache = new Map<string, { at: number; ttl: number; data: Map<string, KpiMetrics> }>();

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const nullableNum = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

function monthBounds(period: string, today: string) {
  const [y, m] = period.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${period}-${String(lastDay).padStart(2, "0")}`;
  return { start: `${period}-01`, end: end > today ? today : end };
}

async function liveMonth(storeId: string, period: string, today: string): Promise<Map<string, KpiMetrics>> {
  const key = `${storeId}:${period}`;
  const hit = liveCache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.data;
  const { start, end } = monthBounds(period, today);
  const { items } = await listSkuWin(storeId, { startDate: start, endDate: end, status: "all", limit: 1_000_000, includeAllTime: false });
  const data = new Map<string, KpiMetrics>();
  for (const it of items) {
    if (!it.revenue && !it.quantity && !it.ads_fee && !it.profit) continue;
    // Lọc SKU Win chưa tách Adjustment / Lưu kho / Placement: phần chênh vào CP khác
    const known = it.revenue - it.ads_fee - it.basecost - it.amazon_fee - it.thue - it.return_cost;
    data.set(it.sku, {
      revenue: it.revenue,
      quantity: it.quantity,
      ads_fee: it.ads_fee,
      basecost: it.basecost,
      amazon_fee: it.amazon_fee,
      ...splitTax(it.thue, it.ads_fee, it.revenue),
      return_amount: it.return_cost,
      storage_fee: 0,
      other_fee: known - it.profit,
      adjustment: 0,
      placement_fee: 0,
      storage_other: known - it.profit,
      profit: it.profit,
    });
  }
  liveCache.set(key, { at: Date.now(), ttl: period === today.slice(0, 7) ? LIVE_TTL_CURRENT_MS : LIVE_TTL_PAST_MS, data });
  return data;
}

/** Kết quả mọi SKU của 1 tháng + nguồn số */
// Phí chủ store (âm) đúng quy tắc scripts/ingest_monthly_from_raw.py (app_settings 'accounting:store_owner_fee'):
// từ tháng start_period, doanh thu > ngưỡng thì rate × doanh thu, không thì fixed_vnd / tỷ giá.
async function ownerFeeOf(period: string, revenue: number): Promise<number> {
  const sql = await getDatabaseClient();
  const [row] = await sql<{ value: unknown }[]>`SELECT value FROM app_settings WHERE key = 'accounting:store_owner_fee' LIMIT 1`;
  let cfg: Record<string, unknown> = {};
  try {
    cfg = ((typeof row?.value === "string" ? JSON.parse(row.value) : row?.value) as Record<string, unknown>) ?? {};
  } catch {
    cfg = {};
  }
  const num = (v: unknown, d: number) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
  const start = typeof cfg.start_period === "string" ? cfg.start_period : "2026-09";
  if (period < start) return 0;
  const threshold = num(cfg.revenue_threshold, 20000);
  return -(revenue > threshold ? revenue * num(cfg.rate, 0.005) : num(cfg.fixed_vnd, 1_000_000) / num(cfg.usd_vnd_rate, 25000));
}

async function monthActuals(
  storeId: string,
  period: string,
  today: string,
  /** Số năm trước: 'monthly' = tab SKU-monthly (cột cùng kỳ), 'tonghop' = tab tổng hợp (cột cùng kỳ tháng sau) */
  variant: "monthly" | "tonghop" = "monthly",
): Promise<{ source: KpiMonthSource; data: Map<string, KpiMetrics>; storeFee?: number | null }> {
  const sql = await getDatabaseClient();
  const currentPeriod = today.slice(0, 7);
  if (period > currentPeriod) return { source: "none", data: new Map() };
  const [y, m] = period.split("-").map(Number);

  const [closed] = await sql<{ awd: string | null; revenue: string | null }[]>`
    SELECT awd_subscription_fees AS awd, total_revenue AS revenue FROM accounting_monthly_store_summary
    WHERE store_id = ${storeId} AND year = ${y} AND month = ${m} LIMIT 1
  `;
  if (closed && period !== currentPeriod) {
    const rows = await sql<Record<string, string | number | null>[]>`
      SELECT sku, revenue, quantity, ads_fee, basecost, amazon_fee_unrecognized, amazon_fee_trans, thue, return_amount,
             adjustment, basecost_adjustment, storage_fee, placement_fee, long_term_fee, fba_customer_return_fee,
             liquidations, basecost_return_adjustment, removal, profit
      FROM accounting_sku_monthly WHERE store_id = ${storeId} AND year = ${y} AND month = ${m}
    `;
    const data = new Map<string, KpiMetrics>();
    for (const r of rows) {
      // SKU Monthly: chi phí lưu số âm như sheet
      const revenue = n(r.revenue);
      const ads = -n(r.ads_fee);
      const basecost = -n(r.basecost);
      const amazon = -(n(r.amazon_fee_unrecognized) + n(r.amazon_fee_trans));
      const thue = -n(r.thue);
      const ret = -n(r.return_amount);
      // Sheet (INPUT KQ hiện tại, cột Adjustment) = Adjustment + Basecost Adjustment
      const adjustment = -(n(r.adjustment) + n(r.basecost_adjustment));
      const storage = -n(r.storage_fee);
      const placement = -n(r.placement_fee);
      const profit = n(r.profit);
      data.set(String(r.sku), {
        revenue,
        quantity: n(r.quantity),
        ads_fee: ads,
        basecost,
        amazon_fee: amazon,
        ...splitTax(thue, ads, revenue),
        return_amount: ret,
        storage_fee: storage,
        // CP khác như sheet ('INPUT KQ hiện tại'!AO = P+Q+R+S+T):
        // Long-Term + FBA Customer Return Fee + Liquidations + Basecost Return/Adjustment + Removal
        other_fee: -(n(r.long_term_fee) + n(r.fba_customer_return_fee) + n(r.liquidations) + n(r.basecost_return_adjustment) + n(r.removal)),
        adjustment,
        placement_fee: placement,
        // INPUT tháng trước: "Lưu kho + CP khác" = mọi khoản còn lại của SKU (M..T)
        storage_other: revenue - ads - basecost - amazon - thue - ret - profit,
        profit,
      });
    }
    // Phí AWD/Subscription/Disposal cấp store (không gắn SKU) — sheet cộng vào Gross Profit của BÁO CÁO THÁNG.
    // Ô awd_subscription_fees khi chốt sổ đã cộng cả phí chủ store; KPI là của SKU nên không trừ phí chủ store.
    const storeFee = closed.awd == null ? null : -(n(closed.awd) - (await ownerFeeOf(period, n(closed.revenue))));
    return { source: "closed", data, storeFee };
  }

  const hist = await sql<Record<string, string | number | null>[]>`
    SELECT DISTINCT ON (sku) sku, revenue, quantity, ads_fee, basecost, amazon_fee, thue, return_amount,
           storage_fee, other_fee, adjustment, placement_fee, storage_other, profit
    FROM accounting_kpi_sku_history WHERE store_id = ${storeId} AND period = ${period}
    ORDER BY sku, (variant = ${variant}) DESC
  `;
  if (hist.length) {
    const data = new Map<string, KpiMetrics>();
    for (const r of hist) {
      // Thuế tách như sheet: Ads tax = 10% Ads, TNCN = 1% Rev, Ref tax = Thuế − hai khoản trên
      const revenue = n(r.revenue);
      const ads = n(r.ads_fee);
      const m = {
        revenue,
        quantity: n(r.quantity),
        ads_fee: ads,
        basecost: n(r.basecost),
        amazon_fee: n(r.amazon_fee),
        ...splitTax(n(r.thue), ads, revenue),
        return_amount: n(r.return_amount),
        storage_fee: n(r.storage_fee),
        other_fee: n(r.other_fee),
        adjustment: n(r.adjustment),
        placement_fee: n(r.placement_fee),
        profit: n(r.profit),
      };
      data.set(String(r.sku), { ...m, storage_other: r.storage_other == null ? residualOther(m) : n(r.storage_other) });
    }
    return { source: "history", data };
  }

  // Chưa có dữ liệu thô của tháng này (trước ngày bắt đầu nạp đơn) → để trống thay vì số 0 sai
  const [raw] = await sql<{ first: string | null }[]>`
    SELECT to_char(MIN(date), 'YYYY-MM') AS first FROM accounting_orders WHERE store_id = ${storeId}
  `;
  if (!raw?.first || period < raw.first) return { source: "none", data: new Map() };
  return { source: "live", data: await liveMonth(storeId, period, today) };
}

function teamTargetMap(rows: { period: string; grp: KpiGroup; metrics: Partial<KpiMetrics> }[], periods: { cur: string; next: string }) {
  const out: KpiResult["teamTargets"] = { cur: {}, next: {} };
  for (const r of rows) {
    const slot = r.period === periods.cur ? "cur" : "next";
    out[slot][r.grp] = { ...emptyMetrics(), ...r.metrics };
  }
  return out;
}

/** Số mục tiêu gõ tay trên sheet (jsonb) → KpiMetrics từng phần; không có / hỏng → null */
function readSheetMetrics(v: unknown): Partial<KpiMetrics> | null {
  let o: unknown = v;
  if (typeof v === "string") {
    try {
      o = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!o || typeof o !== "object") return null;
  const out: Partial<KpiMetrics> = {};
  for (const [k, x] of Object.entries(o as Record<string, unknown>)) {
    const n = Number(x);
    if (Number.isFinite(n)) out[k as keyof KpiMetrics] = n;
  }
  return out.revenue == null ? null : out;
}

function mapTarget(r: Record<string, unknown> | undefined): KpiTargetRow | null {
  if (!r) return null;
  return {
    units: nullableNum(r.units),
    tacos: nullableNum(r.tacos),
    price: nullableNum(r.price),
    storage_fee: nullableNum(r.storage_fee),
    basecost_unit: nullableNum(r.basecost_unit),
    amazon_fee_unit: nullableNum(r.amazon_fee_unit),
    sheet_metrics: readSheetMetrics(r.sheet_metrics),
    cause: (r.cause as string) || null,
    solution: (r.solution as string) || null,
    action: (r.action as string) || null,
    review: (r.review as string) || null,
    target_action: (r.target_action as string) || null,
    updated_by: (r.updated_by as string) || null,
    updated_at: r.updated_at ? new Date(r.updated_at as string).toISOString() : null,
  };
}

export async function getKpi(storeId: string, period: string, options: { refresh?: boolean } = {}): Promise<KpiResult> {
  const sql = await getDatabaseClient();
  const today = new Date().toISOString().slice(0, 10);
  const periods = {
    prev: shiftPeriod(period, -1),
    cur: period,
    next: shiftPeriod(period, 1),
    ly: shiftPeriod(period, -12),
    lyNext: shiftPeriod(period, -11),
  };

  if (options.refresh) {
    for (const key of Array.from(liveCache.keys())) if (key.startsWith(`${storeId}:`)) liveCache.delete(key);
  }

  const statuses = KPI_GROUPS.map((g) => g.status.toLowerCase());
  const [master, targetRows, teamTargetRows, noteRows, historyYearRows, formulaRows] = await Promise.all([
    sql<Record<string, string | number | null>[]>`
      SELECT DISTINCT ON (sku)
        sku, status, brand, asin, product_type, mockup_url, pic_mkt, ton_kho, thang_danh_gia,
        amazon_fee, referral_fee_pct, basecost_tb,
        NULLIF(custom_fields->>'price', '') AS custom_price
      FROM accounting_sku_master
      WHERE store_id = ${storeId} AND deleted_at IS NULL
        AND UPPER(COALESCE(loai, 'FBA')) = 'FBA'
        AND LOWER(TRIM(status)) = ANY(${statuses}::text[])
      ORDER BY sku, row_order NULLS LAST, updated_at DESC
    `,
    sql<Record<string, unknown>[]>`
      SELECT period, sku, units, tacos, price, storage_fee, basecost_unit, amazon_fee_unit, sheet_metrics, cause, solution, action, review, target_action, updated_by, updated_at
      FROM accounting_kpi_targets
      WHERE store_id = ${storeId} AND period IN (${periods.cur}, ${periods.next})
    `,
    sql<{ period: string; grp: KpiGroup; metrics: Partial<KpiMetrics> }[]>`
      SELECT period, grp, metrics FROM accounting_kpi_team_targets
      WHERE store_id = ${storeId} AND period IN (${periods.cur}, ${periods.next})
    `,
    sql<{ note: string; updated_by: string | null; updated_at: Date }[]>`
      SELECT note, updated_by, updated_at FROM accounting_kpi_month_notes WHERE store_id = ${storeId} AND period = ${period}
    `,
    sql<{ y: string }[]>`
      SELECT DISTINCT left(period, 4) AS y FROM accounting_kpi_sku_history WHERE store_id = ${storeId} ORDER BY 1
    `,
    sql<{ value: unknown }[]>`SELECT value FROM app_settings WHERE key = ${targetFormulaKey(storeId)} LIMIT 1`,
  ]);

  // Tuần tự để không chạy nhiều truy vấn Lọc SKU Win nặng cùng lúc
  const prev = await monthActuals(storeId, periods.prev, today);
  const cur = await monthActuals(storeId, periods.cur, today);
  const ly = await monthActuals(storeId, periods.ly, today);
  const lyNext = await monthActuals(storeId, periods.lyNext, today, "tonghop");

  // Price = giá bán đơn gần nhất tới cuối tháng đang xem; Basecost = giá vốn tháng (bảng Giá vốn theo tháng,
  // cùng nguồn kế toán tính Basecost). Cột basecost_tb / giá bình quân tháng hay lệch nên chỉ để dự phòng.
  const skuList = master.map((r) => String(r.sku));
  const periodEnd = monthBounds(period, "9999-12-31").end;
  const [priceRows, baseRows] = await Promise.all([
    sql<{ sku: string; price: string }[]>`
      SELECT DISTINCT ON (sku) sku, item_price / quantity AS price
      FROM accounting_orders
      WHERE store_id = ${storeId} AND sku = ANY(${skuList}::text[])
        AND quantity > 0 AND item_price > 0 AND date <= ${periodEnd}
        AND LOWER(COALESCE(order_status, '')) NOT IN ('cancelled', 'canceled')
      ORDER BY sku, date DESC, purchase_date DESC NULLS LAST
    `,
    sql<{ sku: string; basecost: string }[]>`
      SELECT DISTINCT ON (sku) sku, basecost_thang AS basecost
      FROM accounting_monthly_base_cost
      WHERE store_id = ${storeId} AND deleted_at IS NULL AND sku = ANY(${skuList}::text[])
        AND period <= ${period} AND basecost_thang > 0
      ORDER BY sku, period DESC
    `,
  ]);
  const lastPrice = new Map(priceRows.map((r) => [r.sku, Math.round(Number(r.price) * 100) / 100]));
  const monthBase = new Map(baseRows.map((r) => [r.sku, Number(r.basecost)]));

  const targetCur = new Map<string, Record<string, unknown>>();
  const targetNext = new Map<string, Record<string, unknown>>();
  for (const t of targetRows) (t.period === periods.cur ? targetCur : targetNext).set(String(t.sku), t);

  const skus: KpiSku[] = master.map((r) => {
    const sku = String(r.sku);
    const status = r.status ? String(r.status) : null;
    const group: KpiGroup = (status || "").trim().toLowerCase() === "test" ? "test" : "dev";
    // Như sheet (CHI TIẾT SKU, cột thực tế tháng đang báo cáo: FILTER TEXT('INPUT KQ hiện tại'!AI,"m/yyyy")<>"M/YYYY"):
    // SKU phát triển chỉ tính kết quả tháng đang xem khi Tháng đánh giá đã qua (< tháng đó). Đúng tháng đánh giá: sheet
    // loại khỏi tab phát triển và tab TEST cũng không có (trạng thái đã là Phát triển); trước tháng đánh giá SKU còn là
    // Test nên không nằm trong danh sách phát triển của tháng đó. Cột tháng trước / cùng kỳ không lọc.
    const evalMonth = String(r.thang_danh_gia ?? "").slice(0, 7);
    const graduating = group === "dev" && /^\d{4}-\d{2}$/.test(evalMonth) && evalMonth >= period;
    const a = {
      prev: prev.data.get(sku) ?? null,
      cur: graduating ? null : (cur.data.get(sku) ?? null),
      ly: ly.data.get(sku) ?? null,
      lyNext: lyNext.data.get(sku) ?? null,
    };
    // Dự phòng khi chưa có đơn / chưa có giá vốn tháng: bình quân từ kết quả các tháng
    const avgPrice = [a.prev, a.cur, a.ly, a.lyNext].find((m) => m && m.quantity > 0);
    const avgBase = [a.prev, a.cur, a.ly].find((m) => m && m.quantity > 0 && m.basecost > 0);
    return {
      sku,
      group,
      status,
      brand: (r.brand as string) || null,
      asin: (r.asin as string) || null,
      product_type: (r.product_type as string) || null,
      mockup_url: (r.mockup_url as string) || null,
      pic_mkt: (r.pic_mkt as string) || null,
      ton_kho: nullableNum(r.ton_kho),
      price:
        nullableNum(r.custom_price) ??
        lastPrice.get(sku) ??
        (avgPrice ? Math.round((avgPrice.revenue / avgPrice.quantity) * 100) / 100 : null),
      basecost_unit:
        monthBase.get(sku) ?? (avgBase ? avgBase.basecost / avgBase.quantity : null) ?? nullableNum(r.basecost_tb),
      amazon_fee_unit: nullableNum(r.amazon_fee),
      referral_pct: nullableNum(r.referral_fee_pct),
      actual: a,
      target: { cur: mapTarget(targetCur.get(sku)), next: mapTarget(targetNext.get(sku)) },
    };
  });

  skus.sort((x, y) => (y.actual.cur?.revenue ?? 0) - (x.actual.cur?.revenue ?? 0) || x.sku.localeCompare(y.sku));

  const note = noteRows[0]
    ? { note: noteRows[0].note, updated_by: noteRows[0].updated_by, updated_at: new Date(noteRows[0].updated_at).toISOString() }
    : null;

  return {
    period,
    periods,
    sources: { prev: prev.source, cur: cur.source, ly: ly.source, lyNext: lyNext.source },
    storeFees: { prev: prev.storeFee ?? null, cur: cur.storeFee ?? null, ly: ly.storeFee ?? null, lyNext: lyNext.storeFee ?? null },
    skus,
    note,
    teamTargets: teamTargetMap(teamTargetRows, periods),
    targetFormula: readFormulaValue(formulaRows[0]?.value),
    historyYears: historyYearRows.map((r) => Number(r.y)),
    generatedAt: new Date().toISOString(),
  };
}

const targetFormulaKey = (storeId: string) => `accounting:kpi_target_formula:${storeId}`;

function readFormulaValue(value: unknown): KpiResult["targetFormula"] {
  let o: Record<string, unknown> = {};
  try {
    o = ((typeof value === "string" ? JSON.parse(value) : value) as Record<string, unknown>) ?? {};
  } catch {
    o = {};
  }
  return {
    ...normalizeTargetFormula(o),
    source: typeof o.source === "string" ? o.source : null,
    updated_by: typeof o.updated_by === "string" ? o.updated_by : null,
  };
}

/** Sửa tay công thức mục tiêu của store (giữ nguồn = "Sửa tay") */
export async function setKpiTargetFormula(storeId: string, patch: Partial<KpiTargetFormula>, actor: string) {
  const sql = await getDatabaseClient();
  const [row] = await sql<{ value: unknown }[]>`SELECT value FROM app_settings WHERE key = ${targetFormulaKey(storeId)} LIMIT 1`;
  const next = normalizeTargetFormula({ ...readFormulaValue(row?.value), ...patch });
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${targetFormulaKey(storeId)}, ${sql.json({ ...next, source: "Sửa tay", updated_by: actor } as never)}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
  return readFormulaValue({ ...next, source: "Sửa tay", updated_by: actor });
}

export interface KpiTargetPatch {
  units?: number | null;
  tacos?: number | null;
  price?: number | null;
  storage_fee?: number | null;
  cause?: string | null;
  solution?: string | null;
  action?: string | null;
  review?: string | null;
  target_action?: string | null;
}

const TARGET_FIELDS = ["units", "tacos", "price", "storage_fee", "cause", "solution", "action", "review", "target_action"] as const;

export async function setKpiTarget(storeId: string, period: string, sku: string, patch: KpiTargetPatch, actor: string) {
  const sql = await getDatabaseClient();
  // Chỉ ghi các ô có trong patch, trong 1 câu lệnh: hai lần lưu liền nhau (Unit rồi TACoS) không ghi đè nhau
  const has = (f: (typeof TARGET_FIELDS)[number]) => f in patch;
  const val = (f: (typeof TARGET_FIELDS)[number]) => {
    const x = patch[f];
    return x == null || x === "" ? null : x;
  };
  const [row] = await sql<Record<string, unknown>[]>`
    INSERT INTO accounting_kpi_targets
      (store_id, period, sku, units, tacos, price, storage_fee, cause, solution, action, review, target_action, updated_by, updated_at)
    VALUES (${storeId}, ${period}, ${sku}, ${val("units")}, ${val("tacos")}, ${val("price")}, ${val("storage_fee")},
            ${val("cause")}, ${val("solution")}, ${val("action")}, ${val("review")}, ${val("target_action")}, ${actor}, NOW())
    ON CONFLICT (store_id, period, sku) DO UPDATE SET
      units = CASE WHEN ${has("units")} THEN EXCLUDED.units ELSE accounting_kpi_targets.units END,
      tacos = CASE WHEN ${has("tacos")} THEN EXCLUDED.tacos ELSE accounting_kpi_targets.tacos END,
      price = CASE WHEN ${has("price")} THEN EXCLUDED.price ELSE accounting_kpi_targets.price END,
      storage_fee = CASE WHEN ${has("storage_fee")} THEN EXCLUDED.storage_fee ELSE accounting_kpi_targets.storage_fee END,
      cause = CASE WHEN ${has("cause")} THEN EXCLUDED.cause ELSE accounting_kpi_targets.cause END,
      solution = CASE WHEN ${has("solution")} THEN EXCLUDED.solution ELSE accounting_kpi_targets.solution END,
      action = CASE WHEN ${has("action")} THEN EXCLUDED.action ELSE accounting_kpi_targets.action END,
      review = CASE WHEN ${has("review")} THEN EXCLUDED.review ELSE accounting_kpi_targets.review END,
      target_action = CASE WHEN ${has("target_action")} THEN EXCLUDED.target_action ELSE accounting_kpi_targets.target_action END,
      -- Sửa số trên app thì bỏ số gõ tay nạp từ sheet, tính lại theo công thức
      sheet_metrics = CASE WHEN ${has("units") || has("tacos") || has("price") || has("storage_fee")} THEN NULL ELSE accounting_kpi_targets.sheet_metrics END,
      updated_by = EXCLUDED.updated_by, updated_at = NOW()
    RETURNING units, tacos, price, storage_fee, cause, solution, action, review, target_action
  `;
  // Xoá hẳn dòng khi mọi ô đã trống
  await sql`
    DELETE FROM accounting_kpi_targets
    WHERE store_id = ${storeId} AND period = ${period} AND sku = ${sku}
      AND units IS NULL AND tacos IS NULL AND price IS NULL AND storage_fee IS NULL
      AND cause IS NULL AND solution IS NULL AND action IS NULL AND review IS NULL AND target_action IS NULL
  `;
  return row && TARGET_FIELDS.some((f) => row[f] != null) ? row : null;
}

export async function setKpiNote(storeId: string, period: string, note: string, actor: string) {
  const sql = await getDatabaseClient();
  if (!note.trim()) {
    await sql`DELETE FROM accounting_kpi_month_notes WHERE store_id = ${storeId} AND period = ${period}`;
    return;
  }
  await sql`
    INSERT INTO accounting_kpi_month_notes (store_id, period, note, updated_by, updated_at)
    VALUES (${storeId}, ${period}, ${note}, ${actor}, NOW())
    ON CONFLICT (store_id, period) DO UPDATE SET note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = NOW()
  `;
}

// ───────────────────────── Nạp số năm trước từ file "TỔNG KẾT CUỐI THÁNG_<STORE> <năm>" ─────────────────────────
// Tab SKU-monthly của file chỉ hiện 1 khoảng tháng theo ô chọn (C1/E1), nên tính lại từng tháng bằng đúng các SUMIFS
// của tab đó trên các tab thô. Đã đối chiếu FASTPEACE 2025 tháng 10: khớp từng SKU (lệch duy nhất Removal FCMD15081 $2.27).
// Mỗi store một kiểu file: cột Trans Rp tìm theo header, các khoản của Profit đọc từ công thức Profit của chính file.

type Cols = Record<string, (string | number | null)[]>;

const RAW_TABS: Record<string, { tab: string; cols: string[]; optional?: boolean }> = {
  bc: { tab: "Basecost", cols: ["A", "D", "L", "M", "P", "Q", "U", "X"] },
  ads: { tab: "Ads", cols: ["A", "L", "X", "AD"] },
  tr: { tab: "Trans Rp", cols: ["C", "E", "AD", "AE", "AG", "AI", "AM", "AN", "AO"] },
  lk: { tab: "Lưu kho", cols: ["G", "H", "J"], optional: true },
  pl: { tab: "Placement", cols: ["F", "V", "W"], optional: true },
  lt: { tab: "Long-Term", cols: ["D", "L", "O"], optional: true },
  rm: { tab: "Removal RP", cols: ["G", "O", "S", "U"], optional: true },
  tp: { tab: "Transparency", cols: ["C", "G"], optional: true },
  tl: { tab: "Thanh lý 2024", cols: ["A", "AC", "AD", "D"], optional: true },
  bm: { tab: "BẢNG MÃ", cols: ["A", "B", "D", "E", "F", "J", "M"] },
};

function* iterRows(cols: Cols, from = 1) {
  const keys = Object.keys(cols);
  const len = Math.max(0, ...keys.map((k) => cols[k].length));
  for (let i = from; i < len; i++) {
    const row: Record<string, string | number | null> = {};
    for (const k of keys) row[k] = cols[k][i] ?? null;
    yield row;
  }
}
const str = (v: unknown) => (v == null ? "" : String(v).trim());
const monthOf = (v: unknown) => {
  const x = Number(v);
  return Number.isInteger(x) && x >= 1 && x <= 12 ? x : null;
};

const colLetter = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const colIndex = (letters: string) => [...letters.toUpperCase()].reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const normHeader = (v: unknown) => str(v).toLowerCase().normalize("NFC").replace(/\s+/g, " ");

// Cột tab Trans Rp mỗi file một khác (MALFIRST thiếu "account type" nên lệch 1 cột; LIMIMA/WARMSTOREY/BOZSPACER
// không có 2 cột phụ AN/AO) → tìm theo tên header, trả về theo chữ cột chuẩn của file FASTPEACE.
async function resolveTransCols(spreadsheetId: string): Promise<Record<string, string>> {
  const [header = []] = await readSpreadsheetRange(spreadsheetId, "'Trans Rp'!A1:BZ1");
  const h = header.map(normHeader);
  const find = (name: string, from = 0) => {
    const i = h.findIndex((x, k) => k >= from && x === name);
    return i < 0 ? null : i;
  };
  const type = find("type");
  const sku = find("sku");
  const total = find("total");
  const month = total == null ? null : find("month", total + 1);
  const basecost = find("basecost");
  const desc = find("description", (month ?? 0) + 1);
  const fee = find("chi phí ngoài doanh thu");
  if (type == null || sku == null || total == null || month == null || basecost == null || desc == null || fee == null) {
    throw new ApiError("Tab Trans Rp thiếu cột type / sku / total / Month / Basecost / Description / Chi phí ngoài doanh thu.", 400);
  }
  const out: Record<string, string> = {
    C: colLetter(type),
    E: colLetter(sku),
    AD: colLetter(total),
    AE: colLetter(month),
    AG: colLetter(basecost),
    AI: colLetter(desc + 1), // tháng của đơn Order (cột ngay sau Description)
    AM: colLetter(fee),
  };
  const asin = find("asin (fba customer return fee)");
  const removalSku = find("sku (removal fee)");
  if (asin != null) out.AN = colLetter(asin);
  if (removalSku != null) out.AO = colLetter(removalSku);
  return out;
}

// Khoản chi phí "khác" của Profit SKU, theo tên cột của tab SKU-monthly / SKU-monthly tổng hợp
const OTHER_COMPONENTS: Record<string, "longterm" | "custret" | "liq" | "bra" | "removal" | "bcRemoval" | "otherFees"> = {
  "long-term fee": "longterm",
  "fba customer return fee": "custret",
  liquidations: "liq",
  "basecost return/adjustment": "bra",
  removal: "removal",
  "basecost removal": "bcRemoval",
  "other fees": "otherFees",
};
const OTHER_COMPONENTS_BY_KEY = Object.fromEntries(Object.values(OTHER_COMPONENTS).map((k) => [k, true]));
const BASE_HEADERS = new Set([
  "ads fee", "basecost", "amazon fee (chưa ghi nhận)", "amazon fee (transperance report)", "thuế", "return", "adjustment",
  "lưu kho", "placement fee",
]);
type OtherKey = (typeof OTHER_COMPONENTS)[string];
interface ProfitLayout {
  /** Khoản khác nằm trong SUM của Profit (công thức lỗi #REF! coi như 0) */
  other: Set<OtherKey>;
  /** Profit trừ thêm cột "SL đi trong tháng" lấy từ tab Thanh lý */
  thanhly: boolean;
  /** Removal cộng thêm phí removal trong Trans Rp (cột total theo cột SKU (REMOVAL FEE)) */
  removalTrans: boolean;
  /** Khoản nằm ở các cột M..S (ô "Lưu kho + CP khác" của file KẾ HOẠCH KINH DOANH lấy M:S) */
  mToS: Set<string>;
}

/**
 * Đọc công thức Profit (=E4+SUM(G4:X4)[-Y4]) của 1 tab SKU-monthly để biết Profit gồm những khoản nào.
 * Không đọc được → null (dùng mặc định như file FASTPEACE).
 */
async function readProfitLayout(spreadsheetId: string, tab: string, totalLetter: string): Promise<ProfitLayout | null> {
  const rows = await readSpreadsheetRange(spreadsheetId, `'${tab.replace(/'/g, "''")}'!A3:AJ4`, "FORMULA");
  const header = (rows[0] ?? []).map(normHeader);
  const formulas = (rows[1] ?? []).map((v) => str(v));
  const profitCol = header.indexOf("profit");
  if (profitCol < 0) return null;
  const m = formulas[profitCol].replace(/\s+/g, "").match(/^=E4\+SUM\(([A-Z]+)4:([A-Z]+)4\)(?:-([A-Z]+)4)?$/i);
  if (!m) return null;
  const from = colIndex(m[1]);
  const to = colIndex(m[2]);
  const other = new Set<OtherKey>();
  const mToS = new Set<string>();
  let removalTrans = false;
  for (let i = from; i <= to; i++) {
    const name = header[i] ?? "";
    const f = formulas[i] ?? "";
    const key = OTHER_COMPONENTS[name];
    if (i >= colIndex("M") && i <= colIndex("S")) mToS.add(key ?? name);
    if (!key) {
      if (name && !BASE_HEADERS.has(name)) return null; // cột lạ → không đoán
      continue;
    }
    if (!f || f.includes("#REF!")) continue;
    other.add(key);
    if (key === "removal") removalTrans = f.replace(/\s+/g, "").includes(`'TransRp'!${totalLetter}:${totalLetter}`);
  }
  const subtract = m[3] ? colIndex(m[3]) : -1;
  const thanhly = subtract >= 0 && /thanh lý/i.test(formulas[subtract] ?? "");
  return { other, thanhly, removalTrans, mToS };
}

// Mặc định = file FASTPEACE (SKU-monthly / SKU FBA-monthly tổng hợp)
const DEFAULT_LAYOUT = {
  monthly: {
    other: new Set<OtherKey>(["longterm", "custret", "liq", "bra", "removal"]),
    thanhly: true,
    removalTrans: true,
    mToS: new Set<string>(["adjustment", "lưu kho", "placement fee", "longterm", "custret", "liq", "bra"]),
  },
  tonghop: {
    other: new Set<OtherKey>(["bra", "bcRemoval", "liq", "otherFees"]),
    thanhly: true,
    removalTrans: false,
    mToS: new Set<string>(["adjustment", "lưu kho", "placement fee", "bra", "bcRemoval", "liq", "otherFees"]),
  },
} satisfies Record<string, ProfitLayout>;

export interface PrevYearImportResult {
  title: string;
  year: number;
  months: { period: string; skus: number; revenue: number; profit: number }[];
  rows: number;
  /** Chỉ khi dryRun + withRows: số từng SKU từng tháng (để đối chiếu) */
  detail?: { period: string; sku: string; variant: string; revenue: number; profit: number }[];
}

export async function importKpiHistoryFromSheet(
  storeId: string,
  url: string,
  actor: string,
  options: { year?: number; dryRun?: boolean; withRows?: boolean } = {},
): Promise<PrevYearImportResult> {
  const sql = await getDatabaseClient();
  const [store] = await sql<{ name: string }[]>`SELECT name FROM stores WHERE id = ${storeId}`;
  if (!store) throw new ApiError("Không tìm thấy store.", 404);
  const storeName = store.name.trim().toUpperCase();

  const meta = await readSpreadsheetMeta(url);
  const year = options.year ?? Number(meta.title.match(/20\d{2}/)?.[0]);
  if (!Number.isInteger(year) || year < 2015 || year > 2100) {
    throw new ApiError(`Không đọc được năm từ tên file "${meta.title}". Hãy nhập năm.`, 400);
  }
  if (!meta.title.toUpperCase().includes(storeName)) {
    throw new ApiError(`File "${meta.title}" không phải của store ${store.name}.`, 400);
  }
  const missing = Object.values(RAW_TABS).filter((t) => !t.optional && !meta.tabs.includes(t.tab)).map((t) => t.tab);
  if (missing.length) throw new ApiError(`File thiếu tab: ${missing.join(", ")}.`, 400);

  const trCols = await resolveTransCols(meta.spreadsheetId);
  const raw: Record<string, Cols> = {};
  for (const [key, def] of Object.entries(RAW_TABS)) {
    if (!meta.tabs.includes(def.tab)) {
      raw[key] = {};
    } else if (key === "tr") {
      const canon = def.cols.filter((c) => trCols[c]);
      const read = await readSpreadsheetColumns(meta.spreadsheetId, def.tab, canon.map((c) => trCols[c]));
      raw[key] = Object.fromEntries(canon.map((c) => [c, read[trCols[c]]]));
    } else {
      raw[key] = await readSpreadsheetColumns(meta.spreadsheetId, def.tab, def.cols);
    }
  }

  // Profit SKU gồm những khoản nào: đọc từ công thức của chính file (mỗi store một kiểu)
  const nfcTabs = meta.tabs.map((t) => ({ t, n: t.normalize("NFC").toLowerCase() }));
  const monthlyTab = nfcTabs.find((x) => x.n === "sku-monthly")?.t;
  const tonghopTab = nfcTabs.find((x) => x.n.includes("tổng hợp") && x.n.startsWith("sku") && !x.n.includes("fbm"))?.t;
  const layout = {
    monthly: (monthlyTab && (await readProfitLayout(meta.spreadsheetId, monthlyTab, trCols.AD))) || DEFAULT_LAYOUT.monthly,
    tonghop: (tonghopTab && (await readProfitLayout(meta.spreadsheetId, tonghopTab, trCols.AD))) || DEFAULT_LAYOUT.tonghop,
  };

  // SKU FBA của store trong BẢNG MÃ (cột A Brand, J Loại); FNSKU/ASIN/phôi/trạng thái lấy dòng đầu như XLOOKUP
  const info = new Map<string, { asin: string; fnsku: string; type: string; status: string }>();
  const skus = new Set<string>();
  const asinSkus = new Map<string, string[]>();
  for (const r of iterRows(raw.bm)) {
    const sku = str(r.D);
    if (!sku) continue;
    if (!info.has(sku)) info.set(sku, { asin: str(r.E), fnsku: str(r.F), type: str(r.B), status: str(r.M) });
    if (str(r.A).toUpperCase() === storeName && str(r.J).toUpperCase() === "FBA" && !skus.has(sku)) {
      skus.add(sku);
      const asin = str(r.E);
      if (asin) asinSkus.set(asin, [...(asinSkus.get(asin) || []), sku]);
    }
  }
  const fnskuSku = new Map<string, string>();
  for (const sku of skus) {
    const f = info.get(sku)?.fnsku;
    if (f && !fnskuSku.has(f)) fnskuSku.set(f, sku);
  }

  // Mỗi khoản giữ dấu như sheet (chi phí âm). Hai tab dùng chung phần lớn khoản, khác ở nhóm chi phí khác:
  //  SKU-monthly: Long-Term, FBA Customer Return Fee, Liquidations, Basecost Return/Adjustment, Removal (+ Removal fee Trans Rp)
  //  tổng hợp:    Basecost Return/Adjustment, Basecost Removal (−Removal RP S−O), Liquidations, Other fees (Transparency)
  //  cả hai trừ cột Thanh lý (SL đi trong tháng / SL đã removal 2024).
  const ACC_FIELDS = [
    "revenue", "quantity", "ads", "basecost", "amazon", "adsTax", "tncn", "ret", "adjustment", "storage", "placement",
    "longterm", "custret", "liq", "bra", "removal", "removalTrans", "thanhly", "bcRemoval",
  ] as const;
  type Acc = Record<(typeof ACC_FIELDS)[number], number>;
  const acc = new Map<string, Acc>();
  const add = (sku: string, month: number | null, field: keyof Acc, value: unknown) => {
    if (month == null || !skus.has(sku)) return;
    const v = Number(value);
    if (!Number.isFinite(v) || v === 0) return;
    const key = `${month}|${sku}`;
    let cur = acc.get(key);
    if (!cur) {
      cur = Object.fromEntries(ACC_FIELDS.map((f) => [f, 0])) as Acc;
      acc.set(key, cur);
    }
    cur[field] += v;
  };

  for (const r of iterRows(raw.bc)) {
    const m = monthOf(r.A);
    const sku = str(r.D);
    add(sku, m, "revenue", r.L);
    add(sku, m, "quantity", r.M);
    add(sku, m, "basecost", r.U);
    add(sku, m, "tncn", r.Q);
    if (str(r.X) === "Chưa ghi nhận") add(sku, m, "amazon", r.P);
  }
  for (const r of iterRows(raw.ads)) {
    const m = monthOf(r.A);
    const sku = str(r.X);
    add(sku, m, "ads", -Number(r.L || 0));
    add(sku, m, "adsTax", -Number(r.AD || 0));
  }
  for (const r of iterRows(raw.tr)) {
    const type = str(r.C);
    const sku = str(r.E);
    if (type === "Order") add(sku, monthOf(r.AI), "amazon", r.AM);
    const m = monthOf(r.AE);
    if (m == null) continue;
    if (type === "Refund") {
      add(sku, m, "ret", r.AD);
      add(sku, m, "bra", r.AG);
    } else if (type === "Adjustment") {
      add(sku, m, "adjustment", r.AD);
      add(sku, m, "bra", r.AG);
    } else if (type === "FBA Customer Return Fee") {
      const s2 = fnskuSku.get(sku);
      if (s2) add(s2, m, "custret", r.AD);
    } else if (type === "Liquidations") {
      const s2 = fnskuSku.get(sku);
      if (s2) add(s2, m, "liq", r.AD);
    }
    const asin = str(r.AN);
    if (asin) for (const s2 of asinSkus.get(asin) || []) add(s2, m, "custret", r.AD);
    const removalSku = str(r.AO);
    if (removalSku) add(removalSku, m, "removalTrans", r.AD);
  }
  for (const r of iterRows(raw.lk)) add(str(r.J), monthOf(r.H), "storage", -Number(r.G || 0));
  for (const r of iterRows(raw.pl)) for (const s2 of asinSkus.get(str(r.F)) || []) add(s2, monthOf(r.W), "placement", -Number(r.V || 0));
  for (const r of iterRows(raw.lt)) for (const s2 of asinSkus.get(str(r.D)) || []) add(s2, monthOf(r.O), "longterm", -Number(r.L || 0));
  for (const r of iterRows(raw.rm)) {
    const m = monthOf(r.U);
    add(str(r.G), m, "removal", -Number(r.S || 0));
    add(str(r.G), m, "bcRemoval", -Number(r.S || 0) - Number(r.O || 0));
  }
  for (const r of iterRows(raw.tl)) {
    if (str(r.A).toUpperCase() === storeName) add(str(r.D), monthOf(r.AD), "thanhly", -Number(r.AC || 0));
  }
  // Other fees (tab tổng hợp): =-SUMIFS(Transparency!G, Transparency!C, ASIN) — không lọc tháng, áp cho mọi tháng
  const otherFeesByAsin = new Map<string, number>();
  for (const r of iterRows(raw.tp)) {
    const asin = str(r.C);
    const v = Number(r.G || 0);
    if (asin && Number.isFinite(v) && v) otherFeesByAsin.set(asin, (otherFeesByAsin.get(asin) || 0) - v);
  }

  const rows = Array.from(acc.entries()).flatMap(([key, a]) => {
    const month = Number(key.split("|")[0]);
    const sku = key.slice(key.indexOf("|") + 1);
    const meta2 = info.get(sku);
    const otherFees = (meta2?.asin && otherFeesByAsin.get(meta2.asin)) || 0;
    const base = a.revenue + a.ads + a.basecost + a.amazon + a.adsTax + a.tncn + a.ret + a.adjustment + a.storage + a.placement;
    const common = {
      period: `${year}-${String(month).padStart(2, "0")}`,
      sku,
      asin: meta2?.asin || null,
      product_type: meta2?.type || null,
      status: meta2?.status || null,
      revenue: a.revenue,
      quantity: a.quantity,
      ads_fee: -a.ads,
      basecost: -a.basecost,
      amazon_fee: -a.amazon,
      thue: -(a.adsTax + a.tncn),
      ads_tax: -a.adsTax,
      tncn_tax: -a.tncn,
      ref_tax: 0,
      return_amount: -a.ret,
      storage_fee: -a.storage,
      adjustment: -a.adjustment,
      placement_fee: -a.placement,
    };
    const value: Record<string, number> = {
      adjustment: a.adjustment,
      "lưu kho": a.storage,
      "placement fee": a.placement,
      longterm: a.longterm,
      custret: a.custret,
      liq: a.liq,
      bra: a.bra,
      bcRemoval: a.bcRemoval,
      otherFees,
    };
    // Profit = E + SUM(G:…) [− cột Thanh lý]; "Lưu kho + CP khác" (INPUT cùng kì / cùng kì tháng sau) = các cột M..S
    const build = (variant: "monthly" | "tonghop", l: ProfitLayout) => {
      let other = l.thanhly ? a.thanhly : 0;
      for (const k of l.other) other += k === "removal" ? a.removal + (l.removalTrans ? a.removalTrans : 0) : value[k];
      let mToS = 0;
      for (const k of l.mToS) {
        if (k === "removal") mToS += a.removal + (l.removalTrans ? a.removalTrans : 0);
        else if (k in value && (!(k in OTHER_COMPONENTS_BY_KEY) || l.other.has(k as OtherKey))) mToS += value[k];
      }
      return { ...common, variant, other_fee: -other, storage_other: -mToS, profit: base + other };
    };
    return [build("monthly", layout.monthly), build("tonghop", layout.tonghop)];
  });

  const byMonth = new Map<string, { skus: number; revenue: number; profit: number }>();
  for (const r of rows) {
    if (r.variant !== "monthly") continue;
    const cur = byMonth.get(r.period) || { skus: 0, revenue: 0, profit: 0 };
    cur.skus += 1;
    cur.revenue += r.revenue;
    cur.profit += r.profit;
    byMonth.set(r.period, cur);
  }
  const result: PrevYearImportResult = {
    title: meta.title,
    year,
    months: Array.from(byMonth.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([period, v]) => ({ period, skus: v.skus, revenue: Math.round(v.revenue * 100) / 100, profit: Math.round(v.profit * 100) / 100 })),
    rows: rows.length,
  };
  if (options.dryRun) return options.withRows ? { ...result, detail: rows } : result;
  if (!rows.length) throw new ApiError("File không có số liệu SKU FBA nào của store.", 400);

  const source = `sheet:${meta.spreadsheetId}`;
  await sql.begin(async (tx) => {
    await tx`DELETE FROM accounting_kpi_sku_history WHERE store_id = ${storeId} AND left(period, 4) = ${String(year)}`;
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK).map((r) => ({ store_id: storeId, ...r, source, imported_by: actor }));
      await tx`INSERT INTO accounting_kpi_sku_history ${tx(chunk,
        "store_id", "period", "sku", "asin", "product_type", "status", "revenue", "quantity", "ads_fee", "basecost",
        "amazon_fee", "thue", "ads_tax", "tncn_tax", "ref_tax", "return_amount", "storage_fee", "other_fee",
        "adjustment", "placement_fee", "storage_other", "variant", "profit", "source", "imported_by")}`;
    }
  });
  for (const key of Array.from(liveCache.keys())) if (key.startsWith(`${storeId}:`)) liveCache.delete(key);
  return result;
}

// ───────────── Nạp mục tiêu từ file "<STORE> - KẾ HOẠCH KINH DOANH <năm>" ─────────────
// - Từng SKU: khối "Kết quả kinh doanh mục tiêu" tháng sau ở tab CHI TIẾT SKU / CHI TIẾT SKU TEST
//   (CD = tiêu đề "Tháng M/YYYY"; CE Quantity, CI Tacos, CN Lưu kho; G Price, H Basecost, I Amazon fee leader điền).
// - Tổng team: các cột "[Target] (SKU WIN|SKU TEST) TM/YYYY" ở các tab BÁO CÁO THÁNG N (số tổng, dùng khi tháng đó
//   không còn mục tiêu từng SKU — sheet ghi đè khối mục tiêu mỗi tháng).

const TARGET_SKU_TABS = [
  { tab: "CHI TIẾT SKU", group: "dev" as KpiGroup },
  { tab: "CHI TIẾT SKU TEST", group: "test" as KpiGroup },
];
/** Các cột của khối mục tiêu (vị trí tìm theo header — resolveTargetBlock) */
type TargetSkuKey = "sku" | "price" | "basecost" | "amazon" | "head" | "units" | "tacos" | "storage";
const TEAM_ROW_LABELS: [RegExp, keyof KpiMetrics][] = [
  [/^revenue$/, "revenue"],
  [/^quantity$/, "quantity"],
  [/^ads fee$/, "ads_fee"],
  [/^basecost$/, "basecost"],
  [/^amazon fee$/, "amazon_fee"],
  [/^ads tax/, "ads_tax"],
  [/^(tncn|thuế tncn)/, "tncn_tax"],
  [/^ref tax/, "ref_tax"],
  [/^return/, "return_amount"],
  [/^chi phí lưu kho/, "storage_fee"],
  [/^gross profit$/, "profit"],
];
const LETTERS = Array.from({ length: 16 }, (_, i) => String.fromCharCode(65 + i)); // A..P

function cellNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const x = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, "").replace(/%$/, ""));
  if (!Number.isFinite(x)) return null;
  return typeof v === "string" && v.trim().endsWith("%") ? x / 100 : x;
}
function monthPeriod(text: unknown): string | null {
  const m = String(text ?? "").match(/T(?:háng\s*)?(\d{1,2})\s*\/\s*(\d{4})/i);
  if (!m) return null;
  const mm = Number(m[1]);
  return mm >= 1 && mm <= 12 ? `${m[2]}-${String(mm).padStart(2, "0")}` : null;
}

/**
 * Khối "mục tiêu tháng sau" của tab CHI TIẾT SKU: mỗi file đặt một chỗ (FASTPEACE/LIMIMA/MALFIRST cột CD, WARMSTOREY DI,
 * BOZSPACER DC / tab TEST BK). Lấy khối CUỐI CÙNG có tiêu đề "Tháng M/YYYY" (dòng 1 hoặc 2) của tháng lớn nhất mà dòng 3
 * bắt đầu bằng Revenue/REV, Quantity/Unit và có Tacos, Lưu kho. Price/Basecost/Amazon fee tìm theo tên ở 14 cột đầu.
 */
async function resolveTargetBlock(
  spreadsheetId: string,
  tab: string,
): Promise<
  | (Record<TargetSkuKey, string> & {
      period: string;
      formula: KpiTargetFormula | null;
      storageSign: 1 | -1;
      /** Cột từng khoản của khối mục tiêu (để nạp nguyên số khi dòng gõ tay) */
      metricCols: Partial<Record<keyof KpiMetrics, string>>;
    })
  | null
> {
  const rows = await readSpreadsheetRange(spreadsheetId, `'${tab.replace(/'/g, "''")}'!A1:HZ3`, "FORMATTED_VALUE");
  const [r1 = [], r2 = [], r3 = []] = rows;
  const h3 = r3.map(normHeader);
  const info = (name: RegExp) => {
    const i = h3.findIndex((x, k) => k < 14 && name.test(x));
    return i < 0 ? null : colLetter(i);
  };
  const sku = info(/^sku$/);
  const price = info(/^price$/);
  const basecost = info(/^basecost$/);
  const amazon = info(/^amazon fee$/);
  if (!sku || !price || !basecost || !amazon) return null;
  let best: { col: number; period: string; units: number; tacos: number; storage: number } | null = null;
  const width = Math.max(r1.length, r2.length, r3.length);
  for (let c = 14; c < width; c++) {
    const period = monthPeriod(r1[c]) ?? monthPeriod(r2[c]);
    if (!period || !/^(revenue|rev)$/.test(h3[c] ?? "") || !/^(quantity|unit)$/.test(h3[c + 1] ?? "")) continue;
    const span = h3.slice(c, c + 13);
    const tacos = span.findIndex((x) => x.startsWith("tacos"));
    const storage = span.findIndex((x) => x.startsWith("lưu kho"));
    if (tacos < 0 || storage < 0) continue;
    if (!best || period >= best.period) best = { col: c, period, units: c + 1, tacos: c + tacos, storage: c + storage };
  }
  if (!best) return null;
  const parsed = await readTargetFormula(spreadsheetId, tab, best.col, h3);
  const metricCols: Partial<Record<keyof KpiMetrics, string>> = { revenue: colLetter(best.col), quantity: colLetter(best.units) };
  const METRIC_HEADERS: [keyof KpiMetrics, RegExp][] = [
    ["ads_fee", /^ads( fee)?$/],
    ["basecost", /^basecost/],
    ["amazon_fee", /^(amazon fee|amz fee)/],
    ["ads_tax", /^ads tax/],
    ["tncn_tax", /tncn/],
    ["ref_tax", /ref tax$/],
    ["return_amount", /^return/],
    ["storage_fee", /^lưu kho/],
    ["profit", /profit$/],
  ];
  for (const [key, re] of METRIC_HEADERS) {
    for (let k = best.col; k <= best.col + 13; k++) {
      if (re.test(h3[k] ?? "")) {
        metricCols[key] = colLetter(k);
        break;
      }
    }
  }
  return {
    sku,
    price,
    basecost,
    amazon,
    head: colLetter(best.col),
    units: colLetter(best.units),
    tacos: colLetter(best.tacos),
    storage: colLetter(best.storage),
    period: best.period,
    formula: parsed.formula,
    storageSign: parsed.storageSign,
    metricCols,
  };
}

/**
 * Đọc công thức khối mục tiêu (dòng 4) để biết store tính AMZ Fee / Ref tax / Return thế nào:
 *  AMZ Fee "=CE4*I4+CD4*0.15" → unit_plus_pct 15%; "=CD4*0.33" → revenue_pct 33%
 *  Return "=2%*CD4" / "=DC4*3%" → rate; "=BH4" (ô kết quả thực tế) → actual
 *  Lưu kho cộng vào Profit ("+CN4", ô lấy từ cột chi phí âm) → đổi dấu khi nạp
 * Không đọc được → null (giữ công thức đang lưu).
 */
async function readTargetFormula(
  spreadsheetId: string,
  tab: string,
  start: number,
  h3: string[],
): Promise<{ formula: KpiTargetFormula | null; storageSign: 1 | -1 }> {
  const end = colLetter(start + 13);
  const rows = await readSpreadsheetRange(spreadsheetId, `'${tab.replace(/'/g, "''")}'!${colLetter(start)}4:${end}12`, "FORMULA");
  const at = (re: RegExp) => {
    for (let k = start; k <= start + 13; k++) if (re.test(h3[k] ?? "")) return k - start;
    return -1;
  };
  const pick = (j: number) => {
    if (j < 0) return "";
    for (const r of rows) {
      const f = String(r[j] ?? "").replace(/\s+/g, "");
      if (f.startsWith("=")) return f.toUpperCase();
    }
    return "";
  };
  // Các hệ số trong công thức (đã bỏ địa chỉ ô): "0.15", "3%", "10%" → 0.15, 0.03, 0.1
  const pctIn = (f: string) =>
    (f.replace(/[A-Z]+\d+/g, "").match(/\d+(?:\.\d+)?%?/g) ?? [])
      .map((x) => (x.endsWith("%") ? Number(x.slice(0, -1)) / 100 : Number(x)))
      .filter((x) => x > 0 && x < 1);
  const amz = pick(at(/^(amazon fee|amz fee)/));
  const ref = pick(at(/ref tax$/));
  const ret = pick(at(/^return/));
  const profit = pick(at(/profit$/));
  const storageCol = at(/^lưu kho/);
  if (!amz || !ret) return { formula: null, storageSign: 1 };

  const amzPct = pctIn(amz);
  const unitPart = /[A-Z]+\d+\*[A-Z]+\d+/.test(amz); // Unit × Amazon fee/unit
  const formula: KpiTargetFormula = {
    amazon_mode: unitPart ? "unit_plus_pct" : "revenue_pct",
    amazon_pct: amzPct[0] ?? (unitPart ? 0.15 : 0.33),
    ref_pct: 0.15,
    return_mode: "rate",
    return_rate: 0.02,
  };
  const refNums = pctIn(ref);
  // "0.15*0.1" / "15%*10%": % referral là số khác 0.1
  const refPct = refNums.find((x) => Math.abs(x - 0.1) > 1e-9);
  if (refPct != null) formula.ref_pct = refPct;
  const retNums = pctIn(ret);
  if (retNums.length) formula.return_rate = retNums[0];
  else if (/^=-?[A-Z]+\d+$/.test(ret)) formula.return_mode = "actual";
  const storageLetter = storageCol >= 0 ? colLetter(start + storageCol) : null;
  const storageSign: 1 | -1 = storageLetter && new RegExp(`\\+${storageLetter}\\d+`).test(profit) ? -1 : 1;
  return { formula: normalizeTargetFormula(formula), storageSign };
}

/** Tên file có chứa tên store — chấp nhận gõ nhầm nhẹ ở từ đầu (vd "MALFISRT - KẾ HOẠCH…" của MALFIRST) */
function titleMatchesStore(title: string, storeName: string): boolean {
  const name = storeName.trim().toUpperCase();
  const upper = title.toUpperCase();
  if (upper.includes(name)) return true;
  const first = upper.split(/[\s\-_]+/).find(Boolean) ?? "";
  if (Math.abs(first.length - name.length) > 1) return false;
  const d: number[][] = Array.from({ length: first.length + 1 }, (_, i) => [i, ...Array(name.length).fill(0)]);
  for (let j = 1; j <= name.length; j++) d[0][j] = j;
  for (let i = 1; i <= first.length; i++) {
    for (let j = 1; j <= name.length; j++) {
      const cost = first[i - 1] === name[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      // hoán vị 2 ký tự liền nhau (RS ↔ SR) tính 1 lỗi
      if (i > 1 && j > 1 && first[i - 1] === name[j - 2] && first[i - 2] === name[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[first.length][name.length] <= 1;
}

export interface KpiTargetImportResult {
  title: string;
  /** Công thức mục tiêu đọc được từ sheet (null: không đọc được, giữ công thức đang lưu) */
  targetFormula: KpiTargetFormula | null;
  /** typed: SKU có dòng mục tiêu gõ tay trên sheet (nạp nguyên số, không tính lại theo công thức) */
  skuTargets: { tab: string; group: KpiGroup; period: string; count: number; notInMaster: string[]; typed: string[] }[];
  teamTargets: { tab: string; group: KpiGroup; period: string; revenue: number; profit: number }[];
}

export async function importKpiTargetsFromSheet(
  storeId: string,
  url: string,
  actor: string,
  options: { dryRun?: boolean } = {},
): Promise<KpiTargetImportResult> {
  const sql = await getDatabaseClient();
  const [store] = await sql<{ name: string }[]>`SELECT name FROM stores WHERE id = ${storeId}`;
  if (!store) throw new ApiError("Không tìm thấy store.", 404);
  const meta = await readSpreadsheetMeta(url);
  if (!titleMatchesStore(meta.title, store.name)) {
    throw new ApiError(`File "${meta.title}" không phải của store ${store.name}.`, 400);
  }
  const skuTabs = TARGET_SKU_TABS.filter((t) => meta.tabs.includes(t.tab));
  if (!skuTabs.length) throw new ApiError("File thiếu tab CHI TIẾT SKU / CHI TIẾT SKU TEST.", 400);

  const masterRows = await sql<{ sku: string; status: string | null }[]>`
    SELECT sku, status FROM accounting_sku_master
    WHERE store_id = ${storeId} AND deleted_at IS NULL AND UPPER(COALESCE(loai, 'FBA')) = 'FBA'
  `;
  const masterGroup = new Map(
    masterRows.map((r) => [r.sku, (r.status || "").trim().toLowerCase() === "test" ? "test" : (r.status || "").trim().toLowerCase() === "phát triển" ? "dev" : null]),
  );

  // 1) Mục tiêu từng SKU
  type SkuTarget = {
    period: string;
    sku: string;
    units: number;
    tacos: number | null;
    price: number | null;
    storage: number | null;
    basecost: number;
    amazon: number;
    sheetMetrics: Partial<KpiMetrics> | null;
  };
  const skuRows: SkuTarget[] = [];
  // Công thức khối mục tiêu của store (đọc ở tab CHI TIẾT SKU — tab TEST cùng công thức)
  let targetFormula: KpiTargetFormula | null = null;
  const skuSummary: KpiTargetImportResult["skuTargets"] = [];
  for (const { tab, group } of skuTabs) {
    const block = await resolveTargetBlock(meta.spreadsheetId, tab);
    if (!block) {
      throw new ApiError(`Tab ${tab}: không nhận ra khối mục tiêu tháng sau (tiêu đề "Tháng M/YYYY", Quantity/Unit, Tacos, Lưu kho).`, 400);
    }
    const { period, formula, storageSign, metricCols, ...letters } = block;
    if (formula && !targetFormula) targetFormula = formula;
    const c = await readSpreadsheetColumns(meta.spreadsheetId, tab, Object.values(letters));
    const col = (k: TargetSkuKey) => c[letters[k]] ?? [];
    // Số + công thức của khối mục tiêu: ô REV / Profit không phải công thức → dòng gõ tay, nạp nguyên số
    const mLetters = [...new Set(Object.values(metricCols).filter((x): x is string => Boolean(x)))];
    const mv = await readSpreadsheetColumns(meta.spreadsheetId, tab, mLetters);
    const mf = await readSpreadsheetColumns(meta.spreadsheetId, tab, [metricCols.revenue, metricCols.profit].filter((x): x is string => Boolean(x)), "FORMULA");
    const isTyped = (i: number) =>
      [metricCols.revenue, metricCols.profit].some((L) => {
        if (!L) return false;
        const f = mf[L]?.[i];
        return f != null && f !== "" && !String(f).trim().startsWith("=");
      });
    const sheetMetricsAt = (i: number): Partial<KpiMetrics> | null => {
      if (!isTyped(i)) return null;
      const out: Partial<KpiMetrics> = {};
      for (const [key, L] of Object.entries(metricCols) as [keyof KpiMetrics, string][]) {
        const v = cellNum(mv[L]?.[i]);
        if (v == null) continue;
        out[key] = key === "profit" ? v : key === "storage_fee" ? v * storageSign : Math.abs(v);
      }
      return out.revenue == null ? null : out;
    };
    const seen = new Set<string>();
    const notInMaster: string[] = [];
    const typed: string[] = [];
    const len = col("sku").length;
    for (let i = 3; i < len; i++) {
      const sku = String(col("sku")[i] ?? "").trim();
      const units = cellNum(col("units")[i]);
      if (!sku || units == null || seen.has(sku)) continue;
      seen.add(sku);
      if (masterGroup.get(sku) !== group) notInMaster.push(sku);
      skuRows.push({
        period,
        sku,
        units,
        tacos: cellNum(col("tacos")[i]),
        price: cellNum(col("price")[i]),
        storage: ((v) => (v == null ? null : v * storageSign))(cellNum(col("storage")[i])),
        // Sheet tính ô trống = 0 (vd tab TEST chưa điền Amazon fee) — giữ như sheet để số mục tiêu khớp
        basecost: cellNum(col("basecost")[i]) ?? 0,
        amazon: cellNum(col("amazon")[i]) ?? 0,
        sheetMetrics: sheetMetricsAt(i),
      });
      if (skuRows[skuRows.length - 1].sheetMetrics) typed.push(sku);
    }
    skuSummary.push({ tab, group, period, count: seen.size, notInMaster, typed });
  }

  // 2) Mục tiêu tổng team từ các tab BÁO CÁO THÁNG N
  const teamMap = new Map<string, { tab: string; group: KpiGroup; period: string; metrics: Partial<KpiMetrics> }>();
  const reportTabs = meta.tabs
    .map((t) => ({ t, n: Number(t.match(/^BÁO CÁO THÁNG (\d{1,2})$/)?.[1]) }))
    .filter((x) => x.n)
    .sort((a, b) => a.n - b.n);
  for (const { t } of reportTabs) {
    // Đọc theo vùng (tab có thể ít hơn 16 cột — đọc theo cột sẽ lỗi "exceeds grid limits")
    const grid = await readSpreadsheetRange(meta.spreadsheetId, `'${t.replace(/'/g, "''")}'!A1:P120`);
    const c: Cols = Object.fromEntries(LETTERS.map((L, j) => [L, grid.map((row) => row[j] ?? null)]));
    const labels = (c.A ?? []).map((v) => String(v ?? "").trim().toLowerCase());
    for (const L of LETTERS.slice(1)) {
      const values = c[L] ?? [];
      const headRow = values.findIndex((v, i) => i < 6 && /^\[target\]\s*(sku (win|test)\s*)?t\d{1,2}\/\d{4}$/i.test(String(v ?? "").trim()));
      if (headRow < 0) continue;
      const head = String(values[headRow]).trim();
      const period = monthPeriod(head);
      if (!period) continue;
      const group: KpiGroup = /sku test/i.test(head) ? "test" : "dev";
      const metrics: Partial<KpiMetrics> = {};
      labels.forEach((lab, i) => {
        if (i <= headRow) return;
        const hit = TEAM_ROW_LABELS.find(([re]) => re.test(lab));
        const v = cellNum(values[i]);
        if (hit && v != null && metrics[hit[1]] == null) metrics[hit[1]] = v;
      });
      if (metrics.revenue == null) continue;
      metrics.storage_other = metrics.storage_fee ?? 0;
      teamMap.set(`${period}|${group}`, { tab: t, group, period, metrics });
    }
  }
  const teamRows = [...teamMap.values()];

  if (!options.dryRun) {
    await sql.begin(async (tx) => {
      for (const r of skuRows) {
        await tx`
          INSERT INTO accounting_kpi_targets
            (store_id, period, sku, units, tacos, price, storage_fee, basecost_unit, amazon_fee_unit, sheet_metrics, updated_by, updated_at)
          VALUES (${storeId}, ${r.period}, ${r.sku}, ${r.units}, ${r.tacos}, ${r.price}, ${r.storage}, ${r.basecost}, ${r.amazon},
            ${r.sheetMetrics ? tx.json(r.sheetMetrics as never) : null}, ${actor}, NOW())
          ON CONFLICT (store_id, period, sku) DO UPDATE SET
            units = EXCLUDED.units, tacos = EXCLUDED.tacos, price = EXCLUDED.price, storage_fee = EXCLUDED.storage_fee,
            basecost_unit = EXCLUDED.basecost_unit, amazon_fee_unit = EXCLUDED.amazon_fee_unit, sheet_metrics = EXCLUDED.sheet_metrics,
            updated_by = EXCLUDED.updated_by, updated_at = NOW()
        `;
      }
      if (targetFormula) {
        await tx`
          INSERT INTO app_settings (key, value, updated_at)
          VALUES (${targetFormulaKey(storeId)}, ${tx.json({ ...targetFormula, source: meta.title, updated_by: actor } as never)}, NOW())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        `;
      }
      for (const r of teamRows) {
        await tx`
          INSERT INTO accounting_kpi_team_targets (store_id, period, grp, metrics, source, updated_by, updated_at)
          VALUES (${storeId}, ${r.period}, ${r.group}, ${tx.json(r.metrics as Record<string, number>)}, ${`${meta.title} / ${r.tab}`}, ${actor}, NOW())
          ON CONFLICT (store_id, period, grp) DO UPDATE SET
            metrics = EXCLUDED.metrics, source = EXCLUDED.source, updated_by = EXCLUDED.updated_by, updated_at = NOW()
        `;
      }
    });
  }

  return {
    title: meta.title,
    targetFormula,
    skuTargets: skuSummary,
    teamTargets: teamRows
      .map((r) => ({ tab: r.tab, group: r.group, period: r.period, revenue: r.metrics.revenue ?? 0, profit: r.metrics.profit ?? 0 }))
      .sort((a, b) => a.period.localeCompare(b.period) || a.group.localeCompare(b.group)),
  };
}
