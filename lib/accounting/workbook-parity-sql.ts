import "server-only";

import type { getDatabaseClient } from "@/lib/db";

type Sql = Awaited<ReturnType<typeof getDatabaseClient>>;

/**
 * Basecost tháng cho dòng order alias `o`, expose cột `mbc.basecost_thang`.
 * Workbook tra 'BASECOST THÁNG' chỉ theo SỐ THÁNG (SUMIFS cột Month = MONTH(date)),
 * nên đơn 12/2025 dùng dòng tháng 12 hiện có. Ưu tiên đúng năm, sau đó cùng tháng năm khác.
 */
export function monthlyBasecostJoin(sql: Sql) {
  return sql`
    LEFT JOIN LATERAL (
      SELECT m.basecost_thang
      FROM accounting_monthly_base_cost m
      WHERE m.store_id = o.store_id
        AND m.sku = o.sku
        AND m.deleted_at IS NULL
        AND substr(m.period, 6, 2) = to_char(o.date, 'MM')
      ORDER BY (m.period = to_char(o.date, 'YYYY-MM')) DESC, m.period
      LIMIT 1
    ) mbc ON true
  `;
}

/**
 * Sheet RETURN của workbook tính lại mỗi dòng refund từ dữ liệu order:
 *   SKU      = XLOOKUP(Order ID, 'Orders -FBA'!B, M)       -> SKU của dòng order đầu tiên
 *   Loại     = XLOOKUP(SKU, 'BẢNG MÃ'!D, J)
 *   Basecost = XLOOKUP(Order ID, 'Basecost-Fee FBA'!B, M)  -> -(qty * basecost tháng) của dòng đó
 *   Return   = Total (USD) - Basecost
 * CTE trả về (date, sku, loai, return_value); return_value âm = chi phí.
 */
export function returnsEffectiveCte(sql: Sql, storeId: string, dateCondition: ReturnType<Sql>) {
  return sql`
    returns_effective AS (
      SELECT
        r.date,
        fl.sku,
        rsm.loai,
        COALESCE(r.total, 0) + CASE
          WHEN fl.sku IS NULL THEN 0
          WHEN UPPER(TRIM(COALESCE(rsm.loai, ''))) = 'FBA' THEN
            CASE WHEN COALESCE(fl.currency, '') = '' THEN 0
                 ELSE COALESCE(fl.quantity, 1) * COALESCE(fl.basecost_thang, 0)
            END
          ELSE -COALESCE(r.basecost, 0)
        END AS return_value
      FROM accounting_returns r
      LEFT JOIN LATERAL (
        SELECT o.sku, o.quantity, o.currency, mbc.basecost_thang
        FROM accounting_orders o
        ${monthlyBasecostJoin(sql)}
        WHERE o.store_id = r.store_id
          AND o.amazon_order_id = r.order_id
          AND o.fulfillment_channel = 'Amazon'
        ORDER BY o.line_no NULLS LAST, o.ctid
        LIMIT 1
      ) fl ON true
      LEFT JOIN LATERAL (
        SELECT sm_r.loai
        FROM accounting_sku_master sm_r
        WHERE sm_r.store_id = r.store_id AND sm_r.sku = fl.sku
        ORDER BY sm_r.deleted_at NULLS FIRST, sm_r.row_order NULLS LAST
        LIMIT 1
      ) rsm ON true
      WHERE r.store_id = ${storeId}
        ${dateCondition}
    )
  `;
}
