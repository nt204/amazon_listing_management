import "server-only";

import { getDatabaseClient } from "@/lib/db";

// BASECOST THÁNG FBM: dữ liệu thô tab "ĐẦU VÀO FBM PW" (đồng bộ từ link Kế Toán Tổng Hợp FBM, xem inventory-sheet-sync.ts),
// nối thêm Ngày / SKU / Số lượng từ Orders theo Order ID để lọc theo tháng. Dòng không khớp đơn nào thì để trống.

export interface FbmPwCostRow {
  row_no: number;
  order_id: string | null;
  pw_order_id: string | null;
  order_name: string | null;
  net_price: number | null;
  order_date: string | null;
  skus: string | null;
  quantity: number | null;
}

export interface FbmPwMonth {
  /** 'YYYY-MM', hoặc null = dòng chưa khớp đơn nào trong Orders */
  month: string | null;
  rows: number;
  net_price: number;
}

export interface FbmPwFilter {
  search?: string;
  /** 'YYYY-MM' hoặc 'none' (chưa khớp đơn) */
  month?: string;
}

type Sql = Awaited<ReturnType<typeof getDatabaseClient>>;

/** Câu SELECT con (fragment, chưa chạy) để nhúng vào truy vấn phân trang / thống kê / xuất file. */
function filteredRows(sql: Sql, storeId: string, filter: FbmPwFilter) {
  const search = filter.search?.trim() ? `%${filter.search.trim()}%` : null;
  const month = filter.month && /^(\d{4}-\d{2}|none)$/.test(filter.month) ? filter.month : null;
  return sql`
    WITH o AS (
      SELECT amazon_order_id, MIN(date) AS order_date,
        string_agg(DISTINCT sku, ', ' ORDER BY sku) AS skus, SUM(quantity)::int AS quantity
      FROM accounting_orders
      WHERE store_id = ${storeId}
        AND amazon_order_id IN (SELECT order_id FROM accounting_fbm_pw_costs WHERE store_id = ${storeId})
      GROUP BY amazon_order_id
    )
    SELECT c.row_no, c.order_id, c.pw_order_id, c.order_name, c.net_price::float AS net_price,
      o.order_date::text AS order_date, o.skus, o.quantity
    FROM accounting_fbm_pw_costs c
    LEFT JOIN o ON o.amazon_order_id = c.order_id
    WHERE c.store_id = ${storeId}
      ${month === "none" ? sql`AND o.order_date IS NULL` : month ? sql`AND to_char(o.order_date, 'YYYY-MM') = ${month}` : sql``}
      ${search ? sql`AND (c.order_id ILIKE ${search} OR c.pw_order_id ILIKE ${search} OR c.order_name ILIKE ${search} OR o.skus ILIKE ${search})` : sql``}
  `;
}

export async function listFbmPwCosts(
  storeId: string,
  filter: FbmPwFilter & { page: number; limit: number },
): Promise<{ rows: FbmPwCostRow[]; total: number; totalNetPrice: number; months: FbmPwMonth[] }> {
  const sql = await getDatabaseClient();
  const offset = (Math.max(1, filter.page) - 1) * filter.limit;
  const [page, [summary], months] = await Promise.all([
    sql<FbmPwCostRow[]>`
      SELECT f.* FROM (${filteredRows(sql, storeId, filter)}) f
      ORDER BY f.row_no
      LIMIT ${filter.limit} OFFSET ${offset}
    `,
    sql<{ total: number; total_net: number }[]>`
      SELECT COUNT(*)::int AS total, COALESCE(SUM(f.net_price), 0)::float AS total_net
      FROM (${filteredRows(sql, storeId, filter)}) f
    `,
    sql<FbmPwMonth[]>`
      SELECT to_char(f.order_date::date, 'YYYY-MM') AS month, COUNT(*)::int AS rows, COALESCE(SUM(f.net_price), 0)::float AS net_price
      FROM (${filteredRows(sql, storeId, { search: filter.search })}) f
      GROUP BY 1
      ORDER BY 1 DESC NULLS LAST
    `,
  ]);
  return {
    rows: page,
    total: summary?.total ?? 0,
    totalNetPrice: summary?.total_net ?? 0,
    months,
  };
}

export async function exportFbmPwCosts(storeId: string, filter: FbmPwFilter): Promise<FbmPwCostRow[]> {
  const sql = await getDatabaseClient();
  return sql<FbmPwCostRow[]>`SELECT f.* FROM (${filteredRows(sql, storeId, filter)}) f ORDER BY f.row_no`;
}
