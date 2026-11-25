import "server-only";

import { getDatabaseClient } from "@/lib/db";

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
//   Inventory (FBA) / AWD = available + inbound + reserved của từng kho; R Total (Amazon) = FBA + AWD
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
  available: number;
  inbound: number;
  reserved: number;
  /** Tồn kho FBA = available + inbound + reserved (báo cáo FBA Inventory) */
  fba_total: number;
  /** Tồn kho AWD = available + inbound + reserved (AWD inventory report) */
  awd_total: number;
  /** = fba_total + awd_total */
  total_amazon: number;
  gtri_ton: number;
  gtri_di_duong: number;
  storage_cost: number | null;
}

export interface InventoryTonResult {
  year: number;
  rows: InventoryTonRow[];
  /** Ngày Amazon ghi trong báo cáo FBA Inventory (snapshot-date) + lúc nạp */
  amazonLabel: string | null;
  amazonImportedAt: string | null;
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
  const [rows, meta, closedRows] = await Promise.all([
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
      lv AS (
        SELECT UPPER(TRIM(asin)) AS a,
          SUM(available)::float AS o, SUM(inbound)::float AS p, SUM(reserved)::float AS q,
          SUM(estimated_storage_cost)::float AS u,
          SUM(total) FILTER (WHERE source = 'FBA')::float AS fba,
          SUM(total) FILTER (WHERE source = 'AWD')::float AS awd
        FROM accounting_live_inventory
        WHERE store_id = ${storeId} AND COALESCE(asin, '') <> ''
        GROUP BY 1
      )
      SELECT asm.id::text AS id, asm.brand, asm.product_type, asm.mockup_url, asm.sku, asm.asin, asm.status,
        asm.ton_basecost::float AS basecost,
        op.f, op.g, ib.i, ib.j, rk.m, lv.o, lv.p, lv.q, lv.u, lv.fba, lv.awd
      FROM accounting_sku_master asm
      LEFT JOIN op ON op.k = UPPER(TRIM(asm.sku))
      LEFT JOIN ib ON ib.k = REPLACE(UPPER(TRIM(asm.sku)), ' ', '')
      LEFT JOIN rk ON rk.k = UPPER(TRIM(asm.sku))
      LEFT JOIN lv ON lv.a = UPPER(TRIM(asm.asin))
      WHERE asm.store_id = ${storeId} AND asm.deleted_at IS NULL
      ORDER BY asm.row_order NULLS LAST, asm.created_at
    `,
    sql<{ label: string | null; at: Date | null }[]>`
      SELECT MAX(report_label) AS label, MAX(imported_at) AS at
      FROM accounting_live_inventory WHERE store_id = ${storeId} AND source = 'FBA'
    `,
    sql<{ p: string | null }[]>`
      SELECT MAX(period) AS p FROM accounting_monthly_base_cost
      WHERE store_id = ${storeId} AND period BETWEEN ${`${year}-01`} AND ${`${year}-12`}
        AND deleted_at IS NULL AND sl_ra_kho_source = 'ingest'
    `,
  ]);
  const closed = closedRows[0]?.p ?? null;

  return {
    year,
    amazonLabel: meta[0]?.label ?? null,
    amazonImportedAt: meta[0]?.at ? new Date(meta[0].at).toISOString() : null,
    salesClosedThrough: closed,
    rows: rows.map((r) => {
      const f = num(r.f);
      const g = num(r.g);
      const i = num(r.i);
      const j = num(r.j);
      const k = i <= 0 ? g : j / i;
      const m = num(r.m);
      const o = num(r.o);
      const p = num(r.p);
      const q = num(r.q);
      const fba = num(r.fba);
      const awd = num(r.awd);
      const total = fba + awd;
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
        available: o,
        inbound: p,
        reserved: q,
        fba_total: fba,
        awd_total: awd,
        total_amazon: total,
        gtri_ton: total * k,
        gtri_di_duong: p * k,
        storage_cost: r.u == null ? null : num(r.u),
      };
    }),
  };
}
