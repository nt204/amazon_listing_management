import "server-only";

import { ApiError } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { listSkuWin } from "@/lib/accounting/sku-win-db";
import { readSpreadsheetColumns, readSpreadsheetMeta } from "@/lib/google/sheets";
import { shiftPeriod, splitTax, type KpiMetrics, type KpiTargetInput } from "@/lib/accounting/kpi-calc";

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
  skus: KpiSku[];
  note: { note: string; updated_by: string | null; updated_at: string | null } | null;
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
      profit: it.profit,
    });
  }
  liveCache.set(key, { at: Date.now(), ttl: period === today.slice(0, 7) ? LIVE_TTL_CURRENT_MS : LIVE_TTL_PAST_MS, data });
  return data;
}

/** Kết quả mọi SKU của 1 tháng + nguồn số */
async function monthActuals(storeId: string, period: string, today: string): Promise<{ source: KpiMonthSource; data: Map<string, KpiMetrics> }> {
  const sql = await getDatabaseClient();
  const currentPeriod = today.slice(0, 7);
  if (period > currentPeriod) return { source: "none", data: new Map() };
  const [y, m] = period.split("-").map(Number);

  const [closed] = await sql<{ ok: number }[]>`
    SELECT 1 AS ok FROM accounting_monthly_store_summary WHERE store_id = ${storeId} AND year = ${y} AND month = ${m} LIMIT 1
  `;
  if (closed && period !== currentPeriod) {
    const rows = await sql<Record<string, string | number | null>[]>`
      SELECT sku, revenue, quantity, ads_fee, basecost, amazon_fee_unrecognized, amazon_fee_trans, thue, return_amount,
             adjustment, storage_fee, placement_fee, profit
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
      const adjustment = -n(r.adjustment);
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
        // CP khác = Long-term, Customer return fee, Liquidations, Basecost return/adjustment, Removal…
        other_fee: revenue - ads - basecost - amazon - thue - ret - adjustment - storage - placement - profit,
        adjustment,
        placement_fee: placement,
        profit,
      });
    }
    return { source: "closed", data };
  }

  const hist = await sql<Record<string, string | number | null>[]>`
    SELECT sku, revenue, quantity, ads_fee, basecost, amazon_fee, thue, ads_tax, tncn_tax, ref_tax, return_amount,
           storage_fee, other_fee, adjustment, placement_fee, profit
    FROM accounting_kpi_sku_history WHERE store_id = ${storeId} AND period = ${period}
  `;
  if (hist.length) {
    const data = new Map<string, KpiMetrics>();
    for (const r of hist) {
      data.set(String(r.sku), {
        revenue: n(r.revenue),
        quantity: n(r.quantity),
        ads_fee: n(r.ads_fee),
        basecost: n(r.basecost),
        amazon_fee: n(r.amazon_fee),
        ads_tax: n(r.ads_tax),
        tncn_tax: n(r.tncn_tax),
        ref_tax: n(r.ref_tax),
        return_amount: n(r.return_amount),
        storage_fee: n(r.storage_fee),
        other_fee: n(r.other_fee),
        adjustment: n(r.adjustment),
        placement_fee: n(r.placement_fee),
        profit: n(r.profit),
      });
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

function mapTarget(r: Record<string, unknown> | undefined): KpiTargetRow | null {
  if (!r) return null;
  return {
    units: nullableNum(r.units),
    tacos: nullableNum(r.tacos),
    price: nullableNum(r.price),
    storage_fee: nullableNum(r.storage_fee),
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
  const [master, targetRows, noteRows, historyYearRows] = await Promise.all([
    sql<Record<string, string | number | null>[]>`
      SELECT DISTINCT ON (sku)
        sku, status, brand, asin, product_type, mockup_url, pic_mkt, ton_kho,
        amazon_fee, referral_fee_pct, basecost_tb,
        NULLIF(custom_fields->>'price', '') AS custom_price
      FROM accounting_sku_master
      WHERE store_id = ${storeId} AND deleted_at IS NULL
        AND UPPER(COALESCE(loai, 'FBA')) = 'FBA'
        AND LOWER(TRIM(status)) = ANY(${statuses}::text[])
      ORDER BY sku, row_order NULLS LAST, updated_at DESC
    `,
    sql<Record<string, unknown>[]>`
      SELECT period, sku, units, tacos, price, storage_fee, cause, solution, action, review, target_action, updated_by, updated_at
      FROM accounting_kpi_targets
      WHERE store_id = ${storeId} AND period IN (${periods.cur}, ${periods.next})
    `,
    sql<{ note: string; updated_by: string | null; updated_at: Date }[]>`
      SELECT note, updated_by, updated_at FROM accounting_kpi_month_notes WHERE store_id = ${storeId} AND period = ${period}
    `,
    sql<{ y: string }[]>`
      SELECT DISTINCT left(period, 4) AS y FROM accounting_kpi_sku_history WHERE store_id = ${storeId} ORDER BY 1
    `,
  ]);

  // Tuần tự để không chạy nhiều truy vấn Lọc SKU Win nặng cùng lúc
  const prev = await monthActuals(storeId, periods.prev, today);
  const cur = await monthActuals(storeId, periods.cur, today);
  const ly = await monthActuals(storeId, periods.ly, today);
  const lyNext = await monthActuals(storeId, periods.lyNext, today);

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
    const a = { prev: prev.data.get(sku) ?? null, cur: cur.data.get(sku) ?? null, ly: ly.data.get(sku) ?? null, lyNext: lyNext.data.get(sku) ?? null };
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
    skus,
    note,
    historyYears: historyYearRows.map((r) => Number(r.y)),
    generatedAt: new Date().toISOString(),
  };
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

type Cols = Record<string, (string | number | null)[]>;

const RAW_TABS: Record<string, { tab: string; cols: string[]; optional?: boolean }> = {
  bc: { tab: "Basecost", cols: ["A", "D", "L", "M", "P", "Q", "U", "X"] },
  ads: { tab: "Ads", cols: ["A", "L", "X", "AD"] },
  tr: { tab: "Trans Rp", cols: ["C", "E", "AD", "AE", "AG", "AI", "AM", "AN", "AO"] },
  lk: { tab: "Lưu kho", cols: ["G", "H", "J"], optional: true },
  pl: { tab: "Placement", cols: ["F", "V", "W"], optional: true },
  lt: { tab: "Long-Term", cols: ["D", "L", "O"], optional: true },
  rm: { tab: "Removal RP", cols: ["G", "S", "U"], optional: true },
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

export interface PrevYearImportResult {
  title: string;
  year: number;
  months: { period: string; skus: number; revenue: number; profit: number }[];
  rows: number;
}

export async function importKpiHistoryFromSheet(
  storeId: string,
  url: string,
  actor: string,
  options: { year?: number; dryRun?: boolean } = {},
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

  const raw: Record<string, Cols> = {};
  for (const [key, def] of Object.entries(RAW_TABS)) {
    raw[key] = meta.tabs.includes(def.tab) ? await readSpreadsheetColumns(meta.spreadsheetId, def.tab, def.cols) : {};
  }

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

  type Acc = {
    revenue: number; quantity: number; ads: number; basecost: number; amazon: number; adsTax: number; tncn: number;
    ret: number; adjustment: number; storage: number; placement: number; other: number;
  };
  const acc = new Map<string, Acc>();
  const add = (sku: string, month: number | null, field: keyof Acc, value: unknown) => {
    if (month == null || !skus.has(sku)) return;
    const v = Number(value);
    if (!Number.isFinite(v) || v === 0) return;
    const key = `${month}|${sku}`;
    const cur = acc.get(key) || { revenue: 0, quantity: 0, ads: 0, basecost: 0, amazon: 0, adsTax: 0, tncn: 0, ret: 0, adjustment: 0, storage: 0, placement: 0, other: 0 };
    cur[field] += v;
    acc.set(key, cur);
  };

  // Sheet: chi phí là số âm, Profit = Revenue + SUM(chi phí) − Thanh lý (SL đi trong tháng)
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
      add(sku, m, "other", r.AG);
    } else if (type === "Adjustment") {
      add(sku, m, "adjustment", r.AD);
      add(sku, m, "other", r.AG);
    } else if (type === "FBA Customer Return Fee" || type === "Liquidations") {
      const s = fnskuSku.get(sku);
      if (s) add(s, m, "other", r.AD);
    }
    const asin = str(r.AN);
    if (asin) for (const s of asinSkus.get(asin) || []) add(s, m, "other", r.AD);
    const removalSku = str(r.AO);
    if (removalSku) add(removalSku, m, "other", r.AD);
  }
  for (const r of iterRows(raw.lk)) add(str(r.J), monthOf(r.H), "storage", -Number(r.G || 0));
  for (const r of iterRows(raw.pl)) for (const s of asinSkus.get(str(r.F)) || []) add(s, monthOf(r.W), "placement", -Number(r.V || 0));
  for (const r of iterRows(raw.lt)) for (const s of asinSkus.get(str(r.D)) || []) add(s, monthOf(r.O), "other", -Number(r.L || 0));
  for (const r of iterRows(raw.rm)) add(str(r.G), monthOf(r.U), "other", -Number(r.S || 0));
  for (const r of iterRows(raw.tl)) {
    if (str(r.A).toUpperCase() === storeName) add(str(r.D), monthOf(r.AD), "other", -Number(r.AC || 0));
  }

  const rows = Array.from(acc.entries()).map(([key, a]) => {
    const [month, sku] = [Number(key.split("|")[0]), key.slice(key.indexOf("|") + 1)];
    const meta2 = info.get(sku);
    const m = {
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
      other_fee: -a.other,
      adjustment: -a.adjustment,
      placement_fee: -a.placement,
      profit: a.revenue + a.ads + a.basecost + a.amazon + a.adsTax + a.tncn + a.ret + a.adjustment + a.storage + a.placement + a.other,
    };
    return { period: `${year}-${String(month).padStart(2, "0")}`, sku, asin: meta2?.asin || null, product_type: meta2?.type || null, status: meta2?.status || null, ...m };
  });

  const byMonth = new Map<string, { skus: number; revenue: number; profit: number }>();
  for (const r of rows) {
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
  if (options.dryRun) return result;
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
        "adjustment", "placement_fee", "profit", "source", "imported_by")}`;
    }
  });
  for (const key of Array.from(liveCache.keys())) if (key.startsWith(`${storeId}:`)) liveCache.delete(key);
  return result;
}
