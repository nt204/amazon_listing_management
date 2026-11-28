import "server-only";

import { getDatabaseClient } from "@/lib/db";

// Điền ASIN / FNSKU còn trống trong BẢNG MÃ FBA từ báo cáo tồn kho Amazon đã import
// (tồn kho real time + inventory ledger). Chỉ điền ô trống, không ghi đè; SKU có nhiều FNSKU khác nhau thì bỏ qua.
// Đồng bộ sheet giữ lại ASIN / FNSKU khi ô trên sheet trống (KEEP_WHEN_BLANK trong inventory-sheet-sync.ts).

export async function fillSkuIdentifiersFromInventory(storeId: string): Promise<{ fnsku: number; asin: number }> {
  const sql = await getDatabaseClient();
  const rows = await sql<{ field: string }[]>`
    WITH inv AS (
      SELECT lower(btrim(sku)) AS k, upper(btrim(fnsku)) AS fnsku, upper(btrim(asin)) AS asin
      FROM accounting_live_inventory WHERE store_id = ${storeId}
      UNION ALL
      SELECT lower(btrim(sku)), upper(btrim(fnsku)), upper(btrim(asin))
      FROM accounting_inventory_ledger WHERE store_id = ${storeId}
    ),
    ids AS (
      SELECT k,
        CASE WHEN count(DISTINCT NULLIF(fnsku, '')) = 1 THEN max(NULLIF(fnsku, '')) END AS fnsku,
        CASE WHEN count(DISTINCT NULLIF(asin, '')) = 1 THEN max(NULLIF(asin, '')) END AS asin
      FROM inv WHERE k <> '' GROUP BY k
    ),
    fnsku_upd AS (
      UPDATE accounting_sku_master m SET fnsku = ids.fnsku, last_changed_by = 'inventory_report', updated_at = NOW()
      FROM ids
      WHERE m.store_id = ${storeId} AND m.deleted_at IS NULL AND lower(btrim(m.sku)) = ids.k
        AND ids.fnsku IS NOT NULL AND NULLIF(btrim(m.fnsku), '') IS NULL
      RETURNING 'fnsku' AS field
    ),
    asin_upd AS (
      UPDATE accounting_sku_master m SET asin = ids.asin, last_changed_by = 'inventory_report', updated_at = NOW()
      FROM ids
      WHERE m.store_id = ${storeId} AND m.deleted_at IS NULL AND lower(btrim(m.sku)) = ids.k
        AND ids.asin IS NOT NULL AND NULLIF(btrim(m.asin), '') IS NULL
      RETURNING 'asin' AS field
    )
    SELECT field FROM fnsku_upd UNION ALL SELECT field FROM asin_upd
  `;
  return {
    fnsku: rows.filter((r) => r.field === "fnsku").length,
    asin: rows.filter((r) => r.field === "asin").length,
  };
}
