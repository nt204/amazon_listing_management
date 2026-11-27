import "server-only";

import { getDatabaseClient } from "@/lib/db";

// Tab SKU Master của Đi hàng = Bảng Mã (accounting_sku_master), CHỈ ĐỌC, lọc theo store team được phân,
// kèm lần đặt gần nhất & tổng đã đặt trong CHI TIẾT ĐI HÀNG. Sửa Bảng Mã ở Kế toán / sheet / Trello như cũ.

export interface FulfillSku {
  id: string;
  store_id: string;
  store_name: string;
  sku: string;
  product_type: string | null;
  status: string | null;
  asin: string | null;
  fnsku: string | null;
  dimensions: string | null;
  design: string | null;
  mockup: string | null;
  basecost_tb: number | null;
  last_request: string | null;
  last_sup: string | null;
  last_line_ship: string | null;
  last_basecost: number | null;
  ordered_qty: number;
  ordered_lots: number;
}

export async function listFulfillSkus(filters: {
  storeIds: string[] | null;
  storeId?: string;
  status?: string;
  search?: string;
  limit?: number;
}): Promise<{ items: FulfillSku[]; total: number }> {
  const scope = filters.storeId
    ? filters.storeIds === null || filters.storeIds.includes(filters.storeId)
      ? [filters.storeId]
      : []
    : filters.storeIds;
  if (scope && scope.length === 0) return { items: [], total: 0 };

  const sql = await getDatabaseClient();
  const needle = filters.search?.trim() ? `%${filters.search.trim().toLowerCase()}%` : null;
  const limit = Math.min(Math.max(filters.limit ?? 300, 1), 1000);
  const rows = await sql<(FulfillSku & { total: number })[]>`
    SELECT
      sm.id, sm.store_id, st.name AS store_name, sm.sku, sm.product_type, sm.status, sm.asin, sm.fnsku,
      sm.kich_thuoc AS dimensions, sm.file_design AS design, COALESCE(sm.mockup_url, sm.mockup) AS mockup,
      sm.basecost_tb::float AS basecost_tb,
      last.ngay_request AS last_request, last.sup AS last_sup, last.line_ship AS last_line_ship,
      last.final_basecost AS last_basecost,
      COALESCE(agg.qty, 0)::int AS ordered_qty, COALESCE(agg.lots, 0)::int AS ordered_lots,
      count(*) OVER ()::int AS total
    FROM accounting_sku_master sm
    JOIN stores st ON st.id = sm.store_id
    LEFT JOIN LATERAL (
      SELECT i.ngay_request, i.sup, i.line_ship, i.final_basecost::float AS final_basecost
      FROM accounting_inbound_shipments i
      WHERE i.store_id = sm.store_id AND lower(btrim(i.sku)) = lower(btrim(sm.sku)) AND i.deleted_at IS NULL
      ORDER BY i.ngay_request DESC NULLS LAST, i.created_at DESC
      LIMIT 1
    ) last ON true
    LEFT JOIN LATERAL (
      SELECT sum(i.quantity) AS qty,
        count(DISTINCT COALESCE(NULLIF(btrim(i.ten_lo_hang), ''), i.ngay_request)) AS lots
      FROM accounting_inbound_shipments i
      WHERE i.store_id = sm.store_id AND lower(btrim(i.sku)) = lower(btrim(sm.sku)) AND i.deleted_at IS NULL
    ) agg ON true
    WHERE sm.deleted_at IS NULL
      AND (${scope === null} OR sm.store_id = ANY(${scope ?? []}::uuid[]))
      AND (${filters.status ?? null}::text IS NULL OR sm.status = ${filters.status ?? null})
      AND (${needle}::text IS NULL OR lower(sm.sku) LIKE ${needle} OR lower(COALESCE(sm.asin, '')) LIKE ${needle}
        OR lower(COALESCE(sm.fnsku, '')) LIKE ${needle} OR lower(COALESCE(sm.product_type, '')) LIKE ${needle})
    ORDER BY last.ngay_request DESC NULLS LAST, sm.sku
    LIMIT ${limit}
  `;
  const total = rows[0]?.total ?? 0;
  for (const row of rows) delete (row as Partial<typeof row>).total;
  return { items: rows, total };
}
