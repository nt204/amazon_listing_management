import "server-only";

import { getDatabaseClient } from "@/lib/db";
import { HISTORY_DAYS, loadDemandContext, loadStockRows, stockThresholds } from "./lark-insight-tools";
import { planRestock, shiftDate, vnToday } from "./lark-insights-calc";

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
//   Inventory (FBA) / AWD = tồn CHỐT CUỐI THÁNG (Inventory Ledger FBA total_warehouse_balance / AWD ton_kho_units)
//         đúng ngày cuối của tháng Lượng bán đang chốt tới, cộng theo ASIN; Total (Amazon) = FBA + AWD
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
  /** Tồn FBA chốt ngày stockDate (Inventory Ledger, mọi disposition); null = chưa có ảnh chụp ngày đó */
  fba_total: number | null;
  /** Tồn AWD chốt ngày stockDate (AWD Inventory Ledger); null = chưa có ảnh chụp ngày đó / store không có AWD */
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
  hasFbaStock: boolean;
  hasAwdStock: boolean;
  /** Tháng cuối đã chốt hàng ra kho từ file thô (pipeline tháng, 4h30 ngày 2) — "YYYY-MM"; Lượng bán tính đến hết tháng này */
  salesClosedThrough: string | null;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export async function queryInventoryTon(storeId: string, year: number): Promise<InventoryTonResult> {
  const sql = await getDatabaseClient();
  const opening = `${year}-01`;
  const [closedRow] = await sql<{ p: string | null }[]>`
    SELECT MAX(period) AS p FROM accounting_monthly_base_cost
    WHERE store_id = ${storeId} AND period BETWEEN ${`${year}-01`} AND ${`${year}-12`}
      AND deleted_at IS NULL AND sl_ra_kho_source = 'ingest'
  `;
  const closed = closedRow?.p ?? null;
  // Ngày cuối của tháng đã chốt Lượng bán; chưa chốt tháng nào thì lấy ngày cuối tháng trước
  const stockDate = closed
    ? new Date(Date.UTC(Number(closed.slice(0, 4)), Number(closed.slice(5, 7)), 0)).toISOString().slice(0, 10)
    : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 0)).toISOString().slice(0, 10);
  const thresholds = stockThresholds({ velocityDays: 30 });
  const [rows, meta, stock, awdLatest] = await Promise.all([
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
        SELECT UPPER(TRIM(asin)) AS a, SUM(total_warehouse_balance)::float AS fba
        FROM accounting_inventory_ledger
        WHERE store_id = ${storeId} AND snapshot_date = ${stockDate} AND COALESCE(asin, '') <> ''
        GROUP BY 1
      ),
      al AS (
        SELECT UPPER(TRIM(asin)) AS a, SUM(ton_kho_units)::float AS awd
        FROM accounting_awd_inventory_ledger
        WHERE store_id = ${storeId} AND snapshot_date = ${stockDate} AND COALESCE(asin, '') <> ''
        GROUP BY 1
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
        EXISTS (SELECT 1 FROM accounting_inventory_ledger WHERE store_id = ${storeId} AND snapshot_date = ${stockDate}) AS fba,
        EXISTS (SELECT 1 FROM accounting_awd_inventory_ledger WHERE store_id = ${storeId} AND snapshot_date = ${stockDate}) AS awd
    `,
    year === Number(vnToday().slice(0, 4)) ? loadStockRows(storeId, thresholds) : null,
    // AWD mới nhất (không phải chốt cuối tháng) để dự đoán ngày hết hàng
    sql<{ a: string; awd: number }[]>`
      SELECT UPPER(TRIM(asin)) AS a, SUM(ton_kho_units)::float AS awd
      FROM accounting_awd_inventory_ledger
      WHERE store_id = ${storeId} AND COALESCE(asin, '') <> ''
        AND snapshot_date = (SELECT MAX(snapshot_date) FROM accounting_awd_inventory_ledger WHERE store_id = ${storeId})
      GROUP BY 1
    `,
  ]);
  const hasFbaStock = !!meta[0]?.fba;
  const hasAwdStock = !!meta[0]?.awd;
  // Ngày dự kiến hết hàng — dùng chung thuật toán gợi ý nhập hàng của bot (planRestock):
  //   tồn hiện tại = FBA bán được (Inventory Ledger mới nhất) − số đã bán sau ngày chụp + AWD mới nhất;
  //   tốc độ bán = 40% TB 14 ngày + 40% TB 28 ngày + 20% TB 56 ngày, nhân hệ số mùa vụ từng tháng tới;
  //   đếm từ ngày có dữ liệu mới nhất (không từ ngày chụp tồn cũ). Chưa cộng hàng đang về.
  const stockoutDates = new Map<string, string>();
  if (stock?.salesEnd) {
    const salesEnd = stock.salesEnd;
    const demand = await loadDemandContext(storeId, salesEnd);
    const awdBy = new Map(awdLatest.map((a) => [a.a, Number(a.awd) || 0]));
    const asinOf = new Map(rows.map((r) => [String(r.sku).trim().toUpperCase(), String(r.asin ?? "").trim().toUpperCase()]));
    const zeros = new Array(HISTORY_DAYS).fill(0);
    for (const item of stock.items) {
      if (!item.hasBalance || !item.balanceDate) continue;
      const daily = demand.daily.get(item.sku) ?? zeros;
      if (!daily.some((u) => u > 0)) continue;
      // daily[i] = ngày salesEnd − (HISTORY_DAYS − 1 − i)
      let soldAfter = 0;
      daily.forEach((u, i) => {
        if (shiftDate(salesEnd, -(HISTORY_DAYS - 1 - i)) > item.balanceDate!) soldAfter += u;
      });
      const fbaNow = Math.max(0, item.sellable - soldAfter);
      const asin = asinOf.get(item.sku);
      const onHand = fbaNow + (asin ? awdBy.get(asin) ?? 0 : 0);
      if (onHand <= 0) {
        stockoutDates.set(item.sku, "Đã hết");
        continue;
      }
      const from = item.balanceDate > salesEnd ? item.balanceDate : salesEnd;
      const plan = planRestock(
        {
          sku: item.sku,
          status: item.status,
          productType: demand.typeOf.get(item.sku) ?? null,
          daily,
          sellable: onHand,
          inTransit: 0,
          inboundPending: 0,
          nextArrival: null,
          season: demand.seasonOf(item.sku),
        },
        from,
        { leadTimeDays: 0, coverDays: 365, z: 0 },
      );
      // Đơn hàng có thể trễ vài ngày so với hôm nay: dự kiến hết trước / đúng hôm nay thì coi như đã hết
      if (plan.stockoutDate) stockoutDates.set(item.sku, plan.stockoutDate <= vnToday() ? "Đã hết" : plan.stockoutDate);
    }
  }

  return {
    year,
    stockDate,
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
