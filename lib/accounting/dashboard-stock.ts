import "server-only";

import { getDatabaseClient } from "@/lib/db";
import { skuStockValueJoins, skuStockValueSelect } from "@/lib/accounting/inventory-db";

// Tồn + Giá trị tồn của store tại 1 ngày (Stores Performance, trang Overview).
// Như cột Tồn của BẢNG MÃ: Tồn = tồn FBA (Inventory Ledger, total_warehouse_balance mọi disposition)
// + tồn AWD (AWD Inventory Ledger, ton_kho_units), lấy ảnh chụp MỚI NHẤT có snapshot_date ≤ ngày đang xem.
// Ghép vào Bảng mã theo SKU; Giá trị tồn = Tồn × Giá TB năm (cùng công thức cột "Giá trị tồn" của Bảng mã).
// Ledger do crawler nạp theo tuần → chọn khoảng ngày thì lấy ảnh chụp gần nhất không quá ngày cuối khoảng.

export interface StoreStockAt {
  units: number;
  value: number;
  /** Ngày ảnh chụp tồn FBA dùng để tính (null = không có, chỉ có AWD) */
  snapshotDate: string | null;
}

export async function queryStockAt(storeIds: string[], asOf: string, status?: string): Promise<Map<string, StoreStockAt>> {
  if (!storeIds.length) return new Map();
  const sql = await getDatabaseClient();
  const rows = await sql<{ store_id: string; units: number | null; value: number | null; snapshot_date: string | null }[]>`
    WITH fba_day AS (
      SELECT store_id, MAX(snapshot_date) AS d FROM accounting_inventory_ledger
      WHERE store_id::text IN ${sql(storeIds)} AND snapshot_date <= ${asOf}
      GROUP BY store_id
    ),
    awd_day AS (
      SELECT store_id, MAX(snapshot_date) AS d FROM accounting_awd_inventory_ledger
      WHERE store_id::text IN ${sql(storeIds)} AND snapshot_date <= ${asOf}
      GROUP BY store_id
    ),
    qty AS (
      SELECT store_id, k, SUM(q) AS q FROM (
        SELECT l.store_id, UPPER(TRIM(l.sku)) AS k, l.total_warehouse_balance AS q
        FROM accounting_inventory_ledger l JOIN fba_day f ON f.store_id = l.store_id AND f.d = l.snapshot_date
        UNION ALL
        SELECT a.store_id, UPPER(TRIM(a.sku)) AS k, a.ton_kho_units AS q
        FROM accounting_awd_inventory_ledger a JOIN awd_day w ON w.store_id = a.store_id AND w.d = a.snapshot_date
      ) x
      GROUP BY store_id, k
    ),
    per_sku AS (
      SELECT asm.store_id::text AS store_id, q.q::float AS q, ${skuStockValueSelect(sql)}
      FROM accounting_sku_master asm
      JOIN qty q ON q.store_id = asm.store_id AND q.k = UPPER(TRIM(asm.sku))
      ${skuStockValueJoins(sql)}
      WHERE asm.store_id::text IN ${sql(storeIds)} AND asm.deleted_at IS NULL AND q.q > 0
        ${status ? sql`AND LOWER(TRIM(COALESCE(asm.status, ''))) = ${status}` : sql``}
    )
    SELECT s.store_id, s.units, s.value, f.d::text AS snapshot_date
    FROM (
      SELECT store_id, SUM(q)::float AS units, ROUND(SUM(q * COALESCE(gia_trung_binh_nam, 0))::numeric, 2)::float AS value
      FROM per_sku GROUP BY store_id
    ) s
    LEFT JOIN fba_day f ON f.store_id::text = s.store_id
  `;
  return new Map(
    rows.map((r) => [r.store_id, { units: Number(r.units) || 0, value: Number(r.value) || 0, snapshotDate: r.snapshot_date }]),
  );
}
