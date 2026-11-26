import "server-only";

import { getDatabaseClient } from "@/lib/db";
import { loadStockRows, stockThresholds } from "./lark-insight-tools";
import { shiftDate, vnToday } from "./lark-insights-calc";

// Tab TỒN của Inventory — tính giống tab "TỒN" file <STORE> INVENTORY 2026, mỗi cột lấy từ dữ liệu server:
//   F Hàng tồn 1/1        = sl_ton_dau_ky kỳ <năm>-01 của Base Cost tháng (nạp từ chính tab TỒN của sheet)
//   G Trung bình giá 1/1  = basecost_dau_ky kỳ <năm>-01
//   H Tổng giá trị đầu năm= F × G
//   I SL đi hàng/năm      = SUM(Quantity) CHI TIẾT ĐI HÀNG theo SKU
//   J Tiền hàng/năm       = SUM(Total Basecost) CHI TIẾT ĐI HÀNG theo SKU
//   K Basecost TB/năm     = I ≤ 0 ? G : J / I
//   L BASECOST            = số nhập tay trên sheet (accounting_sku_master.ton_basecost)
//   M Lượng bán/năm       = SUM(hàng ra kho các tháng trong năm) — sheet LƯỢNG BÁN; app lấy sl_ra_kho của Base Cost tháng
//   N Tồn                 = F + I − M
//   O/P/Q Available / Inbound / Reserved = FBA (báo cáo FBA Inventory) + AWD (AWD inventory report) mới nhất
//         (crawler 16h10), cộng theo ASIN như sheet
//   Inventory (FBA) / AWD = TỒN MỚI NHẤT (ảnh chụp từng ngày mới nhất, mỗi kho = Available + Inbound + Reserved),
//         cộng theo ASIN; Total (Amazon) = FBA + AWD
//   S Tổng giá trị tồn    = R × K
//   T Giá trị đang đi đường = P × K
//   U Phí lưu kho tháng sau = estimated-storage-cost-next-month, theo ASIN

export interface InventoryTonRow {
  id: string;
  brand: string | null;
  product_type: string | null;
  mockup_url: string | null;
  sku: string;
  asin: string | null;
  status: string | null;
  ton_dau_nam: number;
  gia_dau_nam: number;
  gtri_dau_nam: number;
  sl_di_hang: number;
  tien_hang: number;
  basecost_tb: number;
  basecost: number | null;
  luong_ban: number;
  ton: number;
  /** Tồn FBA mới nhất (Available + Inbound + Reserved, ảnh chụp ngày stockDate); null = chưa có số tồn */
  fba_total: number | null;
  /** Tồn AWD mới nhất (Available + Inbound + Reserved); null = store chưa có / không dùng AWD */
  awd_total: number | null;
  /** = fba_total + awd_total; null khi thiếu tồn FBA */
  total_amazon: number | null;
  gtri_ton: number | null;
  /** Ngày dự kiến hết hàng (YYYY-MM-DD), "Đã hết" khi tồn hiện tại ≤ 0 mà vẫn đang bán; null = không bán / > 365 ngày */
  stockout_date: string | null;
}

export interface InventoryTonResult {
  year: number;
  rows: InventoryTonRow[];
  /** Ngày chốt tồn Amazon dùng cho Inventory (FBA) / AWD — ngày cuối tháng Lượng bán chốt tới (YYYY-MM-DD) */
  stockDate: string;
  /** Ngày người dùng chọn (null = mới nhất); stockDate có thể sớm hơn nếu ngày chọn chưa có ảnh chụp */
  requestedDate: string | null;
  hasFbaStock: boolean;
  hasAwdStock: boolean;
  /** Tháng cuối đã chốt hàng ra kho từ file thô (pipeline tháng, 4h30 ngày 2) — "YYYY-MM"; Lượng bán tính đến hết tháng này */
  salesClosedThrough: string | null;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** onDate (YYYY-MM-DD): các cột tồn Amazon lấy ảnh chụp gần nhất ≤ ngày này; bỏ trống = mới nhất */
export async function queryInventoryTon(storeId: string, year: number, onDate?: string | null): Promise<InventoryTonResult> {
  const sql = await getDatabaseClient();
  const opening = `${year}-01`;
  const [closedRow] = await sql<{ p: string | null }[]>`
    SELECT MAX(period) AS p FROM accounting_monthly_base_cost
    WHERE store_id = ${storeId} AND period BETWEEN ${`${year}-01`} AND ${`${year}-12`}
      AND deleted_at IS NULL AND sl_ra_kho_source = 'ingest'
  `;
  const closed = closedRow?.p ?? null;
  // Inventory (FBA) / AWD = TỒN MỚI NHẤT: ảnh chụp từng ngày mới nhất (crawler 16h10, accounting_live_inventory_daily),
  // mỗi kho = Available + Inbound + Reserved như cột Total (AMAZON) của sheet. stockDate = ngày của ảnh FBA mới nhất.
  const dateCap = onDate && /^\d{4}-\d{2}-\d{2}$/.test(onDate) ? onDate : "9999-12-31";
  const [latestRow] = await sql<{ fba: string | null; awd: string | null; awd_ledger: string | null }[]>`
    SELECT
      (SELECT MAX(snapshot_date)::text FROM accounting_live_inventory_daily
        WHERE store_id = ${storeId} AND source = 'FBA' AND snapshot_date <= ${dateCap}::date) AS fba,
      (SELECT MAX(snapshot_date)::text FROM accounting_live_inventory_daily
        WHERE store_id = ${storeId} AND source = 'AWD' AND snapshot_date <= ${dateCap}::date) AS awd,
      (SELECT MAX(snapshot_date)::text FROM accounting_awd_inventory_ledger
        WHERE store_id = ${storeId} AND snapshot_date <= ${dateCap}::date) AS awd_ledger
  `;
  const stockDate = latestRow?.fba ?? vnToday();
  // AWD từng ngày mới có từ 19/11/2026 → ngày trước đó lấy AWD Inventory Ledger chốt tuần gần nhất (tồn trong kho AWD)
  const awdDaily = latestRow?.awd ?? null;
  const awdLedger = latestRow?.awd_ledger ?? null;
  const awdFromLedger = !!awdLedger && (!awdDaily || awdLedger > awdDaily);
  const awdDate = awdFromLedger ? awdLedger : awdDaily;
  const thresholds = stockThresholds({ velocityDays: 30 });
  const [rows, meta, stock, nowStock] = await Promise.all([
    sql<Record<string, unknown>[]>`
      WITH op AS (
        SELECT UPPER(TRIM(sku)) AS k, SUM(sl_ton_dau_ky)::float AS f, MAX(basecost_dau_ky)::float AS g
        FROM accounting_monthly_base_cost
        WHERE store_id = ${storeId} AND period = ${opening} AND deleted_at IS NULL
        GROUP BY 1
      ),
      ib AS (
        SELECT REPLACE(UPPER(TRIM(sku)), ' ', '') AS k,
          SUM(quantity)::float AS i,
          SUM(COALESCE(total_basecost, final_basecost * quantity, base_cost_per_unit * quantity, 0))::float AS j
        FROM accounting_inbound_shipments
        WHERE store_id = ${storeId} AND deleted_at IS NULL
        GROUP BY 1
      ),
      rk AS (
        SELECT UPPER(TRIM(sku)) AS k, SUM(COALESCE(sl_ra_kho, 0))::float AS m
        FROM accounting_monthly_base_cost
        WHERE store_id = ${storeId} AND period BETWEEN ${`${year}-01`} AND ${`${year}-12`} AND deleted_at IS NULL
        GROUP BY 1
      ),
      fl AS (
        SELECT UPPER(TRIM(asin)) AS a, SUM(available + inbound + reserved)::float AS fba
        FROM accounting_live_inventory_daily
        WHERE store_id = ${storeId} AND source = 'FBA' AND snapshot_date = ${stockDate} AND COALESCE(asin, '') <> ''
        GROUP BY 1
      ),
      al AS (
        ${awdFromLedger
          ? sql`
            SELECT UPPER(TRIM(asin)) AS a, SUM(ton_kho_units)::float AS awd
            FROM accounting_awd_inventory_ledger
            WHERE store_id = ${storeId} AND snapshot_date = ${awdDate} AND COALESCE(asin, '') <> ''
            GROUP BY 1`
          : sql`
            SELECT UPPER(TRIM(asin)) AS a, SUM(available + inbound + reserved)::float AS awd
            FROM accounting_live_inventory_daily
            WHERE store_id = ${storeId} AND source = 'AWD' AND snapshot_date = ${awdDate} AND COALESCE(asin, '') <> ''
            GROUP BY 1`}
      )
      SELECT asm.id::text AS id, asm.brand, asm.product_type, asm.mockup_url, asm.sku, asm.asin, asm.status,
        asm.ton_basecost::float AS basecost,
        op.f, op.g, ib.i, ib.j, rk.m, fl.fba, al.awd
      FROM accounting_sku_master asm
      LEFT JOIN op ON op.k = UPPER(TRIM(asm.sku))
      LEFT JOIN ib ON ib.k = REPLACE(UPPER(TRIM(asm.sku)), ' ', '')
      LEFT JOIN rk ON rk.k = UPPER(TRIM(asm.sku))
      LEFT JOIN fl ON fl.a = UPPER(TRIM(asm.asin))
      LEFT JOIN al ON al.a = UPPER(TRIM(asm.asin))
      WHERE asm.store_id = ${storeId} AND asm.deleted_at IS NULL
      ORDER BY asm.row_order NULLS LAST, asm.created_at
    `,
    sql<{ fba: boolean; awd: boolean }[]>`
      SELECT
        ${latestRow?.fba != null} AS fba,
        ${awdDate != null} AS awd
    `,
    year === Number(vnToday().slice(0, 4)) ? loadStockRows(storeId, thresholds) : null,
    // Tồn MỚI NHẤT để dự đoán ngày hết hàng (không theo ngày đang chọn): cùng nguồn với cột Inventory (FBA) / AWD —
    // ảnh chụp từng ngày mới nhất; AWD lấy bản mới hơn giữa ảnh từng ngày và AWD Inventory Ledger
    sql<{ src: string; a: string; qty: number; d: string }[]>`
      WITH fd AS (SELECT MAX(snapshot_date) AS d FROM accounting_live_inventory_daily WHERE store_id = ${storeId} AND source = 'FBA'),
        ad AS (SELECT MAX(snapshot_date) AS d FROM accounting_live_inventory_daily WHERE store_id = ${storeId} AND source = 'AWD'),
        ld AS (SELECT MAX(snapshot_date) AS d FROM accounting_awd_inventory_ledger WHERE store_id = ${storeId})
      SELECT 'FBA' AS src, UPPER(TRIM(asin)) AS a, SUM(available + inbound + reserved)::float AS qty, MAX(snapshot_date)::text AS d
      FROM accounting_live_inventory_daily
      WHERE store_id = ${storeId} AND source = 'FBA' AND snapshot_date = (SELECT d FROM fd) AND COALESCE(asin, '') <> ''
      GROUP BY 2
      UNION ALL
      SELECT 'AWD', UPPER(TRIM(asin)), SUM(available + inbound + reserved)::float, MAX(snapshot_date)::text
      FROM accounting_live_inventory_daily
      WHERE store_id = ${storeId} AND source = 'AWD' AND snapshot_date = (SELECT d FROM ad) AND COALESCE(asin, '') <> ''
        AND ((SELECT d FROM ld) IS NULL OR (SELECT d FROM ad) >= (SELECT d FROM ld))
      GROUP BY 2
      UNION ALL
      SELECT 'AWD', UPPER(TRIM(asin)), SUM(ton_kho_units)::float, MAX(snapshot_date)::text
      FROM accounting_awd_inventory_ledger
      WHERE store_id = ${storeId} AND snapshot_date = (SELECT d FROM ld) AND COALESCE(asin, '') <> ''
        AND ((SELECT d FROM ad) IS NULL OR (SELECT d FROM ld) > (SELECT d FROM ad))
      GROUP BY 2
    `,
  ]);
  const hasFbaStock = !!meta[0]?.fba;
  const hasAwdStock = !!meta[0]?.awd;
  // Ngày dự kiến hết hàng:
  //   tồn hiện tại = Inventory (FBA) mới nhất (ảnh chụp từng ngày, như cột trong bảng) − số đã bán sau ngày chụp + AWD mới nhất;
  //   tốc độ bán = trung bình 1 năm gần nhất: units FBA 365 ngày tới ngày có đơn mới nhất ÷ số ngày
  //   (SKU bán chưa đủ năm thì ÷ số ngày từ đơn đầu tiên); đếm từ ngày có dữ liệu mới nhất. Chưa cộng hàng đang về.
  const stockoutDates = new Map<string, string>();
  const fbaNow = new Map(nowStock.filter((r) => r.src === "FBA").map((r) => [r.a, Number(r.qty) || 0]));
  const awdNow = new Map(nowStock.filter((r) => r.src === "AWD").map((r) => [r.a, Number(r.qty) || 0]));
  const fbaNowDate = nowStock.find((r) => r.src === "FBA")?.d ?? null;
  if (stock?.salesEnd && fbaNowDate) {
    const salesEnd = stock.salesEnd;
    const yearStart = shiftDate(salesEnd, -364);
    const [yearSales, afterSnap] = await Promise.all([
      sql<{ sku: string; units: number; first: string }[]>`
        SELECT UPPER(TRIM(sku)) AS sku, SUM(COALESCE(quantity, 1))::float AS units, MIN(date)::text AS first
        FROM accounting_orders
        WHERE store_id = ${storeId} AND fulfillment_channel = 'Amazon'
          AND date BETWEEN ${yearStart}::date AND ${salesEnd}::date
          AND LOWER(COALESCE(order_status, '')) NOT IN ('cancelled', 'canceled')
          AND COALESCE(TRIM(sku), '') <> ''
        GROUP BY 1
      `,
      // Units đã bán sau ngày chụp tồn (theo ASIN, cùng khoá với tồn)
      sql<{ a: string; units: number }[]>`
        SELECT UPPER(TRIM(m.asin)) AS a, SUM(COALESCE(o.quantity, 1))::float AS units
        FROM accounting_orders o
        JOIN accounting_sku_master m ON m.store_id = o.store_id AND m.deleted_at IS NULL
          AND UPPER(TRIM(m.sku)) = UPPER(TRIM(o.sku))
        WHERE o.store_id = ${storeId} AND o.fulfillment_channel = 'Amazon'
          AND o.date > ${fbaNowDate}::date AND o.date <= ${salesEnd}::date
          AND LOWER(COALESCE(o.order_status, '')) NOT IN ('cancelled', 'canceled')
          AND COALESCE(TRIM(m.asin), '') <> ''
        GROUP BY 1
      `,
    ]);
    const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
    const yearBy = new Map(yearSales.map((y) => [y.sku, y]));
    const soldAfterBy = new Map(afterSnap.map((a) => [a.a, Number(a.units) || 0]));
    const today = vnToday();
    const from = fbaNowDate > salesEnd ? fbaNowDate : salesEnd;
    for (const r of rows) {
      const sku = String(r.sku).trim().toUpperCase();
      const asin = String(r.asin ?? "").trim().toUpperCase();
      if (!asin) continue;
      const y = yearBy.get(sku);
      if (!y || !(Number(y.units) > 0)) continue;
      const perDay = Number(y.units) / (daysBetween(y.first > yearStart ? y.first : yearStart, salesEnd) + 1);
      const onHand = Math.max(0, (fbaNow.get(asin) ?? 0) - (soldAfterBy.get(asin) ?? 0)) + (awdNow.get(asin) ?? 0);
      if (onHand <= 0) {
        stockoutDates.set(sku, "Đã hết");
        continue;
      }
      const days = Math.ceil(onHand / perDay);
      if (days > 365) continue;
      const date = shiftDate(from, days);
      // Đơn hàng trễ làm ngày dự kiến rơi vào trước / đúng hôm nay → đã hết
      stockoutDates.set(sku, date <= today ? "Đã hết" : date);
    }
  }

  return {
    year,
    stockDate,
    requestedDate: onDate && dateCap === onDate ? onDate : null,
    hasFbaStock,
    hasAwdStock,
    salesClosedThrough: closed,
    rows: rows.map((r) => {
      const f = num(r.f);
      const g = num(r.g);
      const i = num(r.i);
      const j = num(r.j);
      const k = i <= 0 ? g : j / i;
      const m = num(r.m);
      // Store có ảnh chụp ngày đó mà SKU không có dòng = 0; không có ảnh chụp = null (chưa biết)
      const fba = hasFbaStock ? num(r.fba) : null;
      const awd = hasAwdStock ? num(r.awd) : null;
      const total = fba == null ? null : fba + (awd ?? 0);
      return {
        id: String(r.id),
        brand: (r.brand as string) ?? null,
        product_type: (r.product_type as string) ?? null,
        mockup_url: (r.mockup_url as string) ?? null,
        sku: String(r.sku),
        asin: (r.asin as string) ?? null,
        status: (r.status as string) ?? null,
        ton_dau_nam: f,
        gia_dau_nam: g,
        gtri_dau_nam: f * g,
        sl_di_hang: i,
        tien_hang: j,
        basecost_tb: k,
        basecost: r.basecost == null ? null : num(r.basecost),
        luong_ban: m,
        ton: f + i - m,
        fba_total: fba,
        awd_total: awd,
        total_amazon: total,
        gtri_ton: total == null ? null : total * k,
        stockout_date: stockoutDates.get(String(r.sku).trim().toUpperCase()) ?? null,
      };
    }),
  };
}
