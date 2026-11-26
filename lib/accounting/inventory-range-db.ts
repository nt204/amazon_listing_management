import "server-only";

import { getDatabaseClient } from "@/lib/db";

// Tab TỒN → "Theo ngày": tồn kho theo ngày / khoảng ngày bằng số thật của Amazon, không ước tính.
//   Tồn tại cuối 1 ngày D (FBA + AWD) = ảnh chụp gần nhất có ngày ≤ D, ưu tiên:
//     1. Lịch sử tồn từng ngày (accounting_live_inventory_daily, crawler kế toán 16h10 — có từ migration 172):
//        tồn = Available + Reserved; hàng đang về (Inbound) để riêng.
//     2. Inventory Ledger hằng tuần / cuối tháng (FBA: ending_warehouse_balance hàng SELLABLE; AWD: ton_kho_units)
//        khi trước D chưa có ảnh từng ngày, hoặc ảnh Ledger mới hơn.
//   Tồn đầu kỳ = tồn cuối ngày trước ngày bắt đầu; tồn cuối kỳ = tồn cuối ngày kết thúc.
//   Hàng về = Amazon Received (chưa có thì Quantity) các dòng Chi tiết đi hàng có Ngày đến trong kỳ.
//   Bán = units đơn FBA (không tính đơn huỷ) có ngày trong kỳ.
//   Chênh lệch = Đầu kỳ + Hàng về − Bán − Cuối kỳ (hàng mất / hỏng / trả về / điều chỉnh của Amazon) — CHỈ tính khi có ảnh
//   chụp đúng ngày đầu kỳ (ngày trước ngày bắt đầu) và đúng ngày kết thúc; lệch ngày thì để trống (không suy đoán).

export interface InventoryRangeRow {
  id: string;
  brand: string | null;
  product_type: string | null;
  mockup_url: string | null;
  sku: string;
  asin: string | null;
  status: string | null;
  open_fba: number | null;
  open_awd: number | null;
  open_total: number | null;
  received: number;
  sold: number;
  close_fba: number | null;
  close_awd: number | null;
  close_total: number | null;
  /** Hàng đang về (FBA + AWD Inbound) tại ảnh chụp cuối kỳ; null khi ảnh cuối kỳ là Inventory Ledger */
  close_inbound: number | null;
  diff: number | null;
}

export interface SnapshotPick {
  /** Ngày ảnh chụp được dùng (≤ ngày cần) */
  date: string;
  source: "daily" | "ledger";
}

export interface InventoryRangeResult {
  startDate: string;
  endDate: string;
  /** Ảnh chụp dùng cho tồn đầu kỳ / cuối kỳ của từng kho; null = chưa có ảnh nào trước ngày đó */
  open: { fba: SnapshotPick | null; awd: SnapshotPick | null };
  close: { fba: SnapshotPick | null; awd: SnapshotPick | null };
  /** true = có ảnh chụp đúng ngày đầu kỳ + cuối kỳ → cột Chênh lệch có số */
  exact: boolean;
  /** Các ngày có ảnh chụp từng ngày (để người dùng biết chọn ngày nào có số thật) */
  dailyDates: string[];
  ledgerDates: string[];
  rows: InventoryRangeRow[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function prevDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

type Sql = Awaited<ReturnType<typeof getDatabaseClient>>;
interface StockMap {
  pick: SnapshotPick | null;
  /** SKU (UPPER) → tồn */
  stock: Map<string, number>;
  /** SKU (UPPER) → inbound (chỉ ảnh từng ngày) */
  inbound: Map<string, number> | null;
}

/** Ảnh chụp mới nhất ≤ date của 1 kho, giữa lịch sử từng ngày và Inventory Ledger. */
async function stockAt(sql: Sql, storeId: string, source: "FBA" | "AWD", date: string, dailyDates: string[], ledgerDates: string[]): Promise<StockMap> {
  const daily = dailyDates.filter((d) => d <= date).at(-1) ?? null;
  const ledger = ledgerDates.filter((d) => d <= date).at(-1) ?? null;
  if (!daily && !ledger) return { pick: null, stock: new Map(), inbound: null };
  if (daily && (!ledger || daily >= ledger)) {
    const rows = await sql<{ sku: string; stock: number; inbound: number }[]>`
      SELECT UPPER(TRIM(sku)) AS sku, SUM(available + reserved)::float AS stock, SUM(inbound)::float AS inbound
      FROM accounting_live_inventory_daily
      WHERE store_id = ${storeId} AND source = ${source} AND snapshot_date = ${daily}
      GROUP BY 1
    `;
    return {
      pick: { date: daily, source: "daily" },
      stock: new Map(rows.map((r) => [r.sku, Number(r.stock) || 0])),
      inbound: new Map(rows.map((r) => [r.sku, Number(r.inbound) || 0])),
    };
  }
  const rows =
    source === "FBA"
      ? await sql<{ sku: string; stock: number }[]>`
          SELECT UPPER(TRIM(sku)) AS sku, SUM(ending_warehouse_balance)::float AS stock
          FROM accounting_inventory_ledger
          WHERE store_id = ${storeId} AND snapshot_date = ${ledger} AND UPPER(COALESCE(disposition, '')) = 'SELLABLE'
            AND COALESCE(TRIM(sku), '') <> ''
          GROUP BY 1
        `
      : await sql<{ sku: string; stock: number }[]>`
          SELECT UPPER(TRIM(sku)) AS sku, SUM(ton_kho_units)::float AS stock
          FROM accounting_awd_inventory_ledger
          WHERE store_id = ${storeId} AND snapshot_date = ${ledger} AND COALESCE(TRIM(sku), '') <> ''
          GROUP BY 1
        `;
  return { pick: { date: ledger!, source: "ledger" }, stock: new Map(rows.map((r) => [r.sku, Number(r.stock) || 0])), inbound: null };
}

export async function queryInventoryRange(storeId: string, startDate: string, endDate: string): Promise<InventoryRangeResult> {
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate) || startDate > endDate) {
    throw new Error("Khoảng ngày không hợp lệ (YYYY-MM-DD, ngày bắt đầu ≤ ngày kết thúc).");
  }
  const sql = await getDatabaseClient();
  const openDate = prevDay(startDate);

  const [dates, master, received, sold] = await Promise.all([
    sql<{ kind: string; source: string; d: string }[]>`
      SELECT 'daily' AS kind, source, snapshot_date::text AS d FROM accounting_live_inventory_daily
      WHERE store_id = ${storeId} GROUP BY 1, 2, 3
      UNION ALL
      SELECT 'ledger', 'FBA', snapshot_date::text FROM accounting_inventory_ledger WHERE store_id = ${storeId} GROUP BY 3
      UNION ALL
      SELECT 'ledger', 'AWD', snapshot_date::text FROM accounting_awd_inventory_ledger WHERE store_id = ${storeId} GROUP BY 3
      ORDER BY 3
    `,
    sql<{ id: string; brand: string | null; product_type: string | null; mockup_url: string | null; sku: string; asin: string | null; status: string | null }[]>`
      SELECT id::text, brand, product_type, mockup_url, sku, asin, status
      FROM accounting_sku_master
      WHERE store_id = ${storeId} AND deleted_at IS NULL
      ORDER BY row_order NULLS LAST, created_at
    `,
    sql<{ sku: string; units: number }[]>`
      SELECT UPPER(TRIM(sku)) AS sku, SUM(COALESCE(amazon_received, quantity, 0))::float AS units
      FROM accounting_inbound_shipments
      WHERE store_id = ${storeId} AND deleted_at IS NULL
        AND ngay_den ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        AND LEFT(ngay_den, 10) BETWEEN ${startDate} AND ${endDate}
        AND LOWER(COALESCE(trang_thai, '')) NOT IN ('hủy', 'huỷ', 'huy')
        AND COALESCE(TRIM(sku), '') <> ''
      GROUP BY 1
    `,
    sql<{ sku: string; units: number }[]>`
      SELECT UPPER(TRIM(sku)) AS sku, SUM(COALESCE(quantity, 1))::float AS units
      FROM accounting_orders
      WHERE store_id = ${storeId} AND fulfillment_channel = 'Amazon'
        AND date BETWEEN ${startDate}::date AND ${endDate}::date
        AND LOWER(COALESCE(order_status, '')) NOT IN ('cancelled', 'canceled')
        AND COALESCE(TRIM(sku), '') <> ''
      GROUP BY 1
    `,
  ]);

  const list = (kind: string, source: string) => dates.filter((d) => d.kind === kind && d.source === source).map((d) => d.d);
  const dailyFba = list("daily", "FBA");
  const dailyAwd = list("daily", "AWD");
  const ledgerFba = list("ledger", "FBA");
  const ledgerAwd = list("ledger", "AWD");

  const [openFba, openAwd, closeFba, closeAwd] = await Promise.all([
    stockAt(sql, storeId, "FBA", openDate, dailyFba, ledgerFba),
    stockAt(sql, storeId, "AWD", openDate, dailyAwd, ledgerAwd),
    stockAt(sql, storeId, "FBA", endDate, dailyFba, ledgerFba),
    stockAt(sql, storeId, "AWD", endDate, dailyAwd, ledgerAwd),
  ]);

  const onDay = (m: StockMap, day: string, optional: boolean) => (m.pick ? m.pick.date === day : optional);
  const exact = onDay(openFba, openDate, false) && onDay(openAwd, openDate, true) && onDay(closeFba, endDate, false) && onDay(closeAwd, endDate, true);
  const receivedBy = new Map(received.map((r) => [r.sku, Number(r.units) || 0]));
  const soldBy = new Map(sold.map((r) => [r.sku, Number(r.units) || 0]));
  // Có ảnh FBA thì SKU vắng mặt = 0; AWD chưa từng có ảnh (store không dùng AWD) cũng coi là 0
  const val = (m: StockMap, sku: string, optional: boolean) =>
    m.pick ? m.stock.get(sku) ?? 0 : optional ? 0 : null;
  const sum = (a: number | null, b: number | null) => (a == null || b == null ? null : a + b);

  const build = (base: Omit<InventoryRangeRow, "open_fba" | "open_awd" | "open_total" | "received" | "sold" | "close_fba" | "close_awd" | "close_total" | "close_inbound" | "diff">): InventoryRangeRow => {
    const key = base.sku.trim().toUpperCase();
    const open_fba = val(openFba, key, false);
    const open_awd = val(openAwd, key, true);
    const close_fba = val(closeFba, key, false);
    const close_awd = val(closeAwd, key, true);
    const open_total = sum(open_fba, open_awd);
    const close_total = sum(close_fba, close_awd);
    const rec = receivedBy.get(key) ?? 0;
    const sd = soldBy.get(key) ?? 0;
    const close_inbound =
      closeFba.inbound == null ? null : (closeFba.inbound.get(key) ?? 0) + (closeAwd.inbound?.get(key) ?? 0);
    return {
      ...base,
      open_fba,
      open_awd,
      open_total,
      received: rec,
      sold: sd,
      close_fba,
      close_awd,
      close_total,
      close_inbound,
      diff: !exact || open_total == null || close_total == null ? null : open_total + rec - sd - close_total,
    };
  };

  const rows: InventoryRangeRow[] = [];
  const seen = new Set<string>();
  for (const m of master) {
    const key = m.sku.trim().toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(build(m));
  }
  // SKU có tồn / bán / hàng về mà chưa có trong Bảng mã → vẫn hiện để không lệch tổng
  const extra = new Set<string>([
    ...openFba.stock.keys(), ...closeFba.stock.keys(), ...openAwd.stock.keys(), ...closeAwd.stock.keys(),
    ...receivedBy.keys(), ...soldBy.keys(),
  ]);
  for (const key of extra) {
    if (seen.has(key)) continue;
    seen.add(key);
    const row = build({ id: `extra:${key}`, brand: null, product_type: null, mockup_url: null, sku: key, asin: null, status: "Ngoài Bảng mã" });
    const nums = [row.open_total, row.close_total, row.received, row.sold, row.close_inbound];
    if (nums.some((n) => n != null && n !== 0)) rows.push(row);
  }

  return {
    startDate,
    endDate,
    open: { fba: openFba.pick, awd: openAwd.pick },
    close: { fba: closeFba.pick, awd: closeAwd.pick },
    exact,
    dailyDates: [...new Set([...dailyFba, ...dailyAwd])].sort(),
    ledgerDates: [...new Set([...ledgerFba, ...ledgerAwd])].sort(),
    rows,
  };
}
