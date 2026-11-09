import "server-only";

import { getDatabaseClient } from "@/lib/db";
import { listSkuWin } from "@/lib/accounting/sku-win-db";

// Tab KQKD — file "BÁO CÁO KQKD SKU TESTING": cohort SKU listing trong năm (BẢNG MÃ),
// vốn hàng từ lô đi hàng, kết quả từng tháng. Bám đúng nguồn của sheet:
// - Tab "Tháng N" = IMPORTRANGE tab SKU-monthly của file TỔNG KẾT CUỐI THÁNG → accounting_sku_monthly (kỳ đã chốt).
// - Tab "INPUT KQ Tháng hiện tại" = IMPORTRANGE tab SKU TEST (A:R) của file Lọc SKU → Lọc SKU Test cả tháng:
//   chỉ SKU trạng thái "Test"; SKU Phát triển / Hủy không có số tháng hiện tại (giống sheet).
// - Kỳ đã qua mà chưa chốt SKU Monthly (sheet luôn có tab Tháng N, hệ thống thì chưa): tạm tính bằng công thức
//   Lọc SKU Win cho mọi SKU, đánh dấu "live" để giao diện ghi rõ là tạm tính.
// Lifetime = cộng mọi tháng từ tháng 1 tới tháng hiện tại (sheet: J/K/M/O cộng đủ các nhóm cột tháng).

export type KqkdMonthSource = "closed" | "live";

export interface KqkdMonthCell {
  revenue: number;
  quantity: number;
  /** Chi phí ads, số âm như sheet */
  ads_fee: number;
  profit: number;
}

export interface KqkdMonthMeta {
  /** YYYY-MM */
  month: string;
  source: KqkdMonthSource;
}

export interface KqkdSku {
  id: string;
  sku: string;
  asin: string | null;
  product_type: string | null;
  mockup_url: string | null;
  status: string | null;
  pic_idea: string | null;
  /** YYYY-MM */
  listing_month: string;
  /** YYYY-MM, null khi Bảng mã chưa ghi tháng đánh giá */
  eval_month: string | null;
  von_hang: number;
  qty_di: number;
  unit_cost: number | null;
  revenue: number;
  quantity: number;
  ads_fee: number;
  profit: number;
  months: Record<string, KqkdMonthCell>;
}

/** Ô "Số SKU WIN KQ Thực tế" — Team điền tay theo (tháng đánh giá, phôi) */
export interface KqkdWinResult {
  eval_month: string;
  product_type: string;
  win_count: number;
  updated_by: string | null;
  updated_at: string;
}

export interface KqkdResult {
  year: number;
  months: KqkdMonthMeta[];
  skus: KqkdSku[];
  winResults: KqkdWinResult[];
  generatedAt: string;
}

export async function listKqkdWinResults(storeId: string, year: number): Promise<KqkdWinResult[]> {
  const sql = await getDatabaseClient();
  const rows = await sql<{ eval_month: string; product_type: string; win_count: number; updated_by: string | null; updated_at: Date }[]>`
    SELECT eval_month, product_type, win_count, updated_by, updated_at
    FROM accounting_kqkd_win_results
    WHERE store_id = ${storeId} AND left(eval_month, 4) = ${String(year)}
    ORDER BY eval_month, product_type
  `;
  return rows.map((r) => ({ ...r, win_count: Number(r.win_count), updated_at: new Date(r.updated_at).toISOString() }));
}

/** winCount = null: xoá ô (về trạng thái chưa điền) */
export async function setKqkdWinResult(
  storeId: string,
  evalMonth: string,
  productType: string,
  winCount: number | null,
  actor: string,
) {
  const sql = await getDatabaseClient();
  if (winCount == null) {
    await sql`
      DELETE FROM accounting_kqkd_win_results
      WHERE store_id = ${storeId} AND eval_month = ${evalMonth} AND product_type = ${productType}
    `;
    return;
  }
  await sql`
    INSERT INTO accounting_kqkd_win_results (store_id, eval_month, product_type, win_count, updated_by, updated_at)
    VALUES (${storeId}, ${evalMonth}, ${productType}, ${winCount}, ${actor}, NOW())
    ON CONFLICT (store_id, eval_month, product_type)
    DO UPDATE SET win_count = EXCLUDED.win_count, updated_by = EXCLUDED.updated_by, updated_at = NOW()
  `;
}

const LIVE_CONCURRENCY = 3;
const PAST_MONTH_TTL_MS = 10 * 60_000;
const CURRENT_MONTH_TTL_MS = 2 * 60_000;
const liveCache = new Map<string, { at: number; ttl: number; data: Map<string, KqkdMonthCell> }>();

function ym(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function monthBounds(period: string, today: string) {
  const [y, m] = period.split("-").map(Number);
  const start = `${period}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${period}-${String(lastDay).padStart(2, "0")}`;
  return { start, end: end > today ? today : end };
}

async function liveMonth(storeId: string, period: string, today: string, isCurrent: boolean) {
  const key = `${storeId}:${period}:${isCurrent ? "test" : "all"}`;
  const hit = liveCache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.data;

  const { start, end } = monthBounds(period, today);
  const { items } = await listSkuWin(storeId, {
    startDate: start,
    endDate: end,
    // Tháng hiện tại = Lọc SKU Test (chỉ trạng thái Test); kỳ cũ chưa chốt = mọi SKU
    status: isCurrent ? "Test" : "all",
    limit: 1_000_000,
    includeAllTime: false,
  });
  const data = new Map<string, KqkdMonthCell>();
  for (const item of items) {
    if (!item.revenue && !item.quantity && !item.ads_fee && !item.profit) continue;
    data.set(item.sku, {
      revenue: item.revenue,
      quantity: item.quantity,
      ads_fee: -item.ads_fee,
      profit: item.profit,
    });
  }
  liveCache.set(key, { at: Date.now(), ttl: isCurrent ? CURRENT_MONTH_TTL_MS : PAST_MONTH_TTL_MS, data });
  return data;
}

async function mapLimit<T, R>(list: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(list.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function getKqkd(storeId: string, year: number, options: { refresh?: boolean } = {}): Promise<KqkdResult> {
  const sql = await getDatabaseClient();
  const today = new Date().toISOString().slice(0, 10);
  const currentPeriod = today.slice(0, 7);

  // Cohort: SKU Bảng mã có tháng listing thuộc năm (sheet: FILTER(BẢNG MÃ!D, YEAR(R)=năm)), mọi trạng thái.
  // thang_listing / thang_danh_gia lưu dạng 'YYYY-MM' hoặc 'YYYY-MM-DD'.
  const cohort = await sql<{
    id: string;
    sku: string;
    asin: string | null;
    product_type: string | null;
    mockup_url: string | null;
    status: string | null;
    pic_idea: string | null;
    listing_month: string;
    eval_month: string | null;
  }[]>`
    SELECT DISTINCT ON (sku)
      id, sku, asin, product_type, mockup_url, status, pic_idea,
      left(thang_listing, 7) AS listing_month,
      CASE WHEN thang_danh_gia ~ '^[0-9]{4}-[0-9]{2}' THEN left(thang_danh_gia, 7) END AS eval_month
    FROM accounting_sku_master
    WHERE store_id = ${storeId}
      AND deleted_at IS NULL
      AND thang_listing ~ '^[0-9]{4}-[0-9]{2}'
      AND left(thang_listing, 4) = ${String(year)}
    ORDER BY sku, row_order NULLS LAST, updated_at DESC
  `;

  const lastMonth = year < Number(currentPeriod.slice(0, 4)) ? 12 : year > Number(currentPeriod.slice(0, 4)) ? 0 : Number(currentPeriod.slice(5, 7));
  const periods: string[] = [];
  for (let m = 1; m <= lastMonth; m++) periods.push(ym(year, m));

  if (!cohort.length) {
    return { year, months: [], skus: [], winResults: await listKqkdWinResults(storeId, year), generatedAt: new Date().toISOString() };
  }

  const skuList = cohort.map((c) => c.sku);

  const [lots, closedRows, closedMonthRows, winResults] = await Promise.all([
    sql<{ sku: string; von_hang: string; qty_di: string }[]>`
      SELECT sku, SUM(COALESCE(total_basecost, 0)) AS von_hang, SUM(COALESCE(quantity, 0)) AS qty_di
      FROM accounting_inbound_shipments
      WHERE store_id = ${storeId} AND deleted_at IS NULL AND sku = ANY(${skuList}::text[])
      GROUP BY sku
    `,
    sql<{ sku: string; month: number; revenue: string; quantity: number; ads_fee: string; profit: string }[]>`
      SELECT sku, month, revenue, quantity, ads_fee, profit
      FROM accounting_sku_monthly
      WHERE store_id = ${storeId} AND year = ${year} AND sku = ANY(${skuList}::text[])
    `,
    sql<{ month: number }[]>`
      SELECT DISTINCT month FROM accounting_monthly_store_summary
      WHERE store_id = ${storeId} AND year = ${year}
    `,
    listKqkdWinResults(storeId, year),
  ]);

  const closedMonths = new Set(closedMonthRows.map((r) => ym(year, Number(r.month))));
  const months: KqkdMonthMeta[] = periods.map((p) => ({
    month: p,
    source: closedMonths.has(p) && p !== currentPeriod ? "closed" : "live",
  }));

  const cells = new Map<string, Map<string, KqkdMonthCell>>();
  for (const r of closedRows) {
    const p = ym(year, Number(r.month));
    if (!closedMonths.has(p)) continue;
    if (!cells.has(p)) cells.set(p, new Map());
    cells.get(p)!.set(r.sku, {
      revenue: Number(r.revenue || 0),
      quantity: Number(r.quantity || 0),
      ads_fee: Number(r.ads_fee || 0),
      profit: Number(r.profit || 0),
    });
  }

  if (options.refresh) {
    for (const key of Array.from(liveCache.keys())) if (key.startsWith(`${storeId}:`)) liveCache.delete(key);
  }
  const livePeriods = months.filter((m) => m.source === "live").map((m) => m.month);
  const liveData = await mapLimit(livePeriods, LIVE_CONCURRENCY, (p) => liveMonth(storeId, p, today, p === currentPeriod));
  livePeriods.forEach((p, i) => cells.set(p, liveData[i]));

  const lotBySku = new Map(lots.map((l) => [l.sku, { von: Number(l.von_hang || 0), qty: Number(l.qty_di || 0) }]));

  const skus: KqkdSku[] = cohort.map((c) => {
    const lot = lotBySku.get(c.sku) || { von: 0, qty: 0 };
    const byMonth: Record<string, KqkdMonthCell> = {};
    let revenue = 0;
    let quantity = 0;
    let adsFee = 0;
    let profit = 0;
    for (const p of periods) {
      const cell = cells.get(p)?.get(c.sku);
      if (!cell) continue;
      byMonth[p] = cell;
      revenue += cell.revenue;
      quantity += cell.quantity;
      adsFee += cell.ads_fee;
      profit += cell.profit;
    }
    return {
      id: c.id,
      sku: c.sku,
      asin: c.asin,
      product_type: c.product_type,
      mockup_url: c.mockup_url,
      status: c.status,
      pic_idea: c.pic_idea,
      listing_month: c.listing_month,
      eval_month: c.eval_month,
      von_hang: lot.von,
      qty_di: lot.qty,
      unit_cost: lot.qty > 0 ? lot.von / lot.qty : null,
      revenue,
      quantity,
      ads_fee: adsFee,
      profit,
      months: byMonth,
    };
  });

  skus.sort((a, b) =>
    a.listing_month.localeCompare(b.listing_month) ||
    (a.product_type || "").localeCompare(b.product_type || "") ||
    a.sku.localeCompare(b.sku)
  );

  return { year, months, skus, winResults: withAutoWin(skus, winResults, currentPeriod), generatedAt: new Date().toISOString() };
}

// Số SKU WIN thực tế tự đếm từ BẢNG MÃ: SKU đã đến tháng đánh giá mà trạng thái "Phát triển" = WIN
// (khớp các ô Team điền tay của sheet T7/T8/T10/2026). Team chỉ cần cập nhật trạng thái trong Bảng mã;
// ô nhập tay (accounting_kqkd_win_results) nếu có thì ưu tiên — để sửa ngoại lệ.
const WIN_STATUS = "phát triển";
function withAutoWin(skus: KqkdSku[], manual: KqkdWinResult[], currentPeriod: string): KqkdWinResult[] {
  const out = new Map<string, KqkdWinResult>();
  for (const s of skus) {
    if (!s.eval_month || s.eval_month > currentPeriod) continue;
    const phoi = s.product_type || "(trống)";
    const key = `${s.eval_month}|${phoi}`;
    const cur = out.get(key) || { eval_month: s.eval_month, product_type: phoi, win_count: 0, updated_by: "auto:bang-ma", updated_at: new Date().toISOString() };
    if ((s.status || "").normalize("NFC").trim().toLowerCase() === WIN_STATUS) cur.win_count += 1;
    out.set(key, cur);
  }
  for (const m of manual) out.set(`${m.eval_month}|${m.product_type}`, m);
  return Array.from(out.values()).sort((a, b) => a.eval_month.localeCompare(b.eval_month) || a.product_type.localeCompare(b.product_type));
}
