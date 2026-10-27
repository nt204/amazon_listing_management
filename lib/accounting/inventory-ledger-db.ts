import { getDatabaseClient } from "@/lib/db";
import { parseCsv } from "@/lib/csv";

/** Các cột số của báo cáo Inventory Ledger ngoài 2 cột tạo nên tồn kho (cột DB → tiêu đề trong file). */
export const LEDGER_EVENT_COLUMNS = {
  starting_warehouse_balance: "Starting Warehouse Balance",
  receipts: "Receipts",
  customer_shipments: "Customer Shipments",
  customer_returns: "Customer Returns",
  vendor_returns: "Vendor Returns",
  warehouse_transfer_in_out: "Warehouse Transfer In/Out",
  found: "Found",
  lost: "Lost",
  damaged: "Damaged",
  disposed: "Disposed",
  other_events: "Other Events",
  unknown_events: "Unknown Events",
} as const;
export type LedgerEventColumn = keyof typeof LEDGER_EVENT_COLUMNS;
const LEDGER_EVENT_KEYS = Object.keys(LEDGER_EVENT_COLUMNS) as LedgerEventColumn[];

export interface InventoryLedgerRow {
  date: string | null;
  fnsku: string | null;
  asin: string;
  sku: string; // From MSKU
  title: string | null;
  disposition: string | null;
  location: string;
  inTransitBetweenWarehouses: number;
  endingWarehouseBalance: number;
  totalWarehouseBalance: number;
  events: Record<LedgerEventColumn, number>;
}

/** 1 dòng của tab TỒN KHO: dòng báo cáo + Product Type / Mockup lấy từ Bảng Mã. */
export interface InventoryStockItem extends Record<LedgerEventColumn, number> {
  id: string;
  report_date: string | null;
  fnsku: string | null;
  asin: string;
  sku: string;
  title: string | null;
  disposition: string | null;
  location: string;
  in_transit_between_warehouses: number;
  ending_warehouse_balance: number;
  ton_kho: number;
  product_type: string | null;
  mockup: string | null;
}

export interface InventoryBalanceItem {
  storeId: string;
  sku: string;
  asin: string;
  fnsku: string | null;
  title: string | null;
  inTransitBetweenWarehouses: number;
  endingWarehouseBalance: number;
  tonKho: number;
  sellableBalance: number;
  unsellableBalance: number;
  snapshotDate: string;
  updatedAt: string;
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseNumber(val: unknown): number {
  if (val == null) return 0;
  const s = String(val).replace(/,/g, "").trim();
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

function parseDateOnly(val: unknown): string | null {
  if (!val) return null;
  const s = String(val).trim();
  // Formats: MM/DD/YYYY, YYYY-MM-DD, MM/DD/YY
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const month = m[1].padStart(2, "0");
    const day = m[2].padStart(2, "0");
    let year = m[3];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month}-${day}`;
  }
  return null;
}

/**
 * Phân tích buffer/text của file Inventory Ledger (CSV hoặc TSV).
 */
export function parseInventoryLedgerContent(content: string): InventoryLedgerRow[] {
  // Tự động nhận diện dấu phân cách CSV (phẩy) hoặc TSV (tab)
  const isTsv = !content.includes(",") && content.includes("\t");
  let rawRows: string[][];
  if (isTsv) {
    rawRows = content
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((line) => line.split("\t").map((c) => c.trim()))
      .filter((r) => r.some(Boolean));
  } else {
    rawRows = parseCsv(content);
  }

  if (rawRows.length < 2) return [];

  const headers = rawRows[0].map(normalizeHeader);
  const findIdx = (...keys: string[]) => {
    for (const k of keys) {
      const normalized = normalizeHeader(k);
      const idx = headers.indexOf(normalized);
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const idxDate = findIdx("date");
  const idxFnsku = findIdx("fnsku", "fulfillmentnetworksku");
  const idxAsin = findIdx("asin");
  const idxMsku = findIdx("msku", "merchantsku", "sku");
  const idxTitle = findIdx("title", "productname", "itemname");
  const idxDisposition = findIdx("disposition");
  const idxInTransit = findIdx(
    "intransitbetweenwarehouses",
    "intransitbetweenwarehouse",
    "intransit"
  );
  const idxEnding = findIdx(
    "endingwarehousebalance",
    "endingbalance",
    "endingwarehouse"
  );
  const idxLocation = findIdx("location", "country");
  const eventIdx = LEDGER_EVENT_KEYS.map((key) => [key, findIdx(LEDGER_EVENT_COLUMNS[key])] as const);

  const results: InventoryLedgerRow[] = [];

  for (let i = 1; i < rawRows.length; i++) {
    const r = rawRows[i];
    const asin = idxAsin !== -1 && r[idxAsin] ? r[idxAsin].trim() : "";
    const sku = idxMsku !== -1 && r[idxMsku] ? r[idxMsku].trim() : "";

    // Phải có tối thiểu SKU hoặc ASIN để ghi nhận
    if (!sku && !asin) continue;

    const inTransit = idxInTransit !== -1 ? parseNumber(r[idxInTransit]) : 0;
    const ending = idxEnding !== -1 ? parseNumber(r[idxEnding]) : 0;
    const total = inTransit + ending;

    results.push({
      date: idxDate !== -1 ? parseDateOnly(r[idxDate]) : null,
      fnsku: idxFnsku !== -1 && r[idxFnsku] ? r[idxFnsku].trim() : null,
      asin,
      sku,
      title: idxTitle !== -1 && r[idxTitle] ? r[idxTitle].trim() : null,
      disposition: idxDisposition !== -1 && r[idxDisposition] ? r[idxDisposition].trim().toUpperCase() : "SELLABLE",
      location: idxLocation !== -1 && r[idxLocation] ? r[idxLocation].trim().toUpperCase() : "",
      inTransitBetweenWarehouses: inTransit,
      endingWarehouseBalance: ending,
      totalWarehouseBalance: total,
      events: Object.fromEntries(
        eventIdx.map(([key, idx]) => [key, idx !== -1 ? parseNumber(r[idx]) : 0]),
      ) as Record<LedgerEventColumn, number>,
    });
  }

  return results;
}

/**
 * Nạp dữ liệu Inventory Ledger vào database:
 * 1. Lưu toàn bộ chi tiết vào bảng `accounting_inventory_ledger`
 * 2. Cập nhật bảng tổng hợp `accounting_inventory_balance` theo (store_id, sku, asin)
 * 3. Cập nhật trực tiếp cột `ton_kho` vào bảng `accounting_sku_master` (map cả sku + asin)
 */
export async function ingestInventoryLedgerRows(
  storeId: string,
  rows: InventoryLedgerRow[],
  snapshotDate: string,
  sourceFileName?: string
): Promise<{
  insertedCount: number;
  updatedSkuMasterCount: number;
  totalTonKho: number;
}> {
  if (rows.length === 0) {
    return { insertedCount: 0, updatedSkuMasterCount: 0, totalTonKho: 0 };
  }

  const sql = await getDatabaseClient();

  // 1. Gom nhóm theo khóa duy nhất (store_id, snapshot_date, sku, asin, fnsku, disposition, location)
  // để tránh lỗi Postgres 21000 (ON CONFLICT DO UPDATE command cannot affect row a second time)
  // nếu trong file có nhiều dòng cùng SKU/Disposition
  const rawLedgerMap = new Map<
    string,
    {
      store_id: string;
      snapshot_date: string;
      report_date: string;
      fnsku: string | null;
      asin: string;
      sku: string;
      title: string | null;
      disposition: string;
      location: string;
      in_transit_between_warehouses: number;
      ending_warehouse_balance: number;
      total_warehouse_balance: number;
      source_file: string | null;
    } & Record<LedgerEventColumn, number>
  >();

  for (const r of rows) {
    const fnskuKey = (r.fnsku || "").trim().toUpperCase();
    const dispKey = (r.disposition || "SELLABLE").trim().toUpperCase();
    const key = `${r.sku.trim().toUpperCase()}|||${r.asin.trim().toUpperCase()}|||${fnskuKey}|||${dispKey}|||${r.location}`;
    const existing = rawLedgerMap.get(key);

    if (!existing) {
      rawLedgerMap.set(key, {
        store_id: storeId,
        snapshot_date: snapshotDate,
        report_date: r.date || snapshotDate,
        fnsku: r.fnsku,
        asin: r.asin,
        sku: r.sku,
        title: r.title,
        disposition: dispKey,
        location: r.location,
        in_transit_between_warehouses: r.inTransitBetweenWarehouses,
        ending_warehouse_balance: r.endingWarehouseBalance,
        total_warehouse_balance: r.totalWarehouseBalance,
        source_file: sourceFileName || null,
        ...r.events,
      });
    } else {
      for (const k of LEDGER_EVENT_KEYS) existing[k] += r.events[k];
      existing.in_transit_between_warehouses += r.inTransitBetweenWarehouses;
      existing.ending_warehouse_balance += r.endingWarehouseBalance;
      existing.total_warehouse_balance += r.totalWarehouseBalance;
      if (!existing.title && r.title) existing.title = r.title;
      if (!existing.fnsku && r.fnsku) existing.fnsku = r.fnsku;
    }
  }

  const ledgerValues = Array.from(rawLedgerMap.values());

  // Nạp lại cùng 1 ngày chốt sổ thì thay toàn bộ dòng của ngày đó (dòng không còn trong file bị bỏ).
  // Ghi nhận theo lô 500 dòng, trong 1 transaction để tab TỒN KHO không thấy snapshot dở dang.
  const BATCH_SIZE = 500;
  await sql.begin(async (tx) => {
    await tx`DELETE FROM accounting_inventory_ledger WHERE store_id = ${storeId} AND snapshot_date = ${snapshotDate}`;
    for (let i = 0; i < ledgerValues.length; i += BATCH_SIZE) {
      await tx`INSERT INTO accounting_inventory_ledger ${tx(ledgerValues.slice(i, i + BATCH_SIZE))}`;
    }
  });

  // 2. Gom nhóm theo SKU + ASIN để tính tổng tồn kho
  // Cột tồn kho = In Transit Between Warehouses + Ending Warehouse Balance
  const aggregatedMap = new Map<
    string,
    {
      sku: string;
      asin: string;
      fnsku: string | null;
      title: string | null;
      inTransit: number;
      ending: number;
      tonKho: number;
      sellable: number;
      unsellable: number;
    }
  >();

  for (const r of rows) {
    const key = `${r.sku.toUpperCase()}|||${r.asin.toUpperCase()}`;
    const existing = aggregatedMap.get(key);
    const isSellable = (r.disposition || "").toUpperCase() === "SELLABLE";

    if (!existing) {
      aggregatedMap.set(key, {
        sku: r.sku,
        asin: r.asin,
        fnsku: r.fnsku,
        title: r.title,
        inTransit: r.inTransitBetweenWarehouses,
        ending: r.endingWarehouseBalance,
        tonKho: r.totalWarehouseBalance,
        sellable: isSellable ? r.endingWarehouseBalance : 0,
        unsellable: isSellable ? 0 : r.endingWarehouseBalance,
      });
    } else {
      existing.inTransit += r.inTransitBetweenWarehouses;
      existing.ending += r.endingWarehouseBalance;
      existing.tonKho += r.totalWarehouseBalance;
      if (isSellable) {
        existing.sellable += r.endingWarehouseBalance;
      } else {
        existing.unsellable += r.endingWarehouseBalance;
      }
      if (!existing.fnsku && r.fnsku) existing.fnsku = r.fnsku;
      if (!existing.title && r.title) existing.title = r.title;
    }
  }

  const aggregatedList = Array.from(aggregatedMap.values());

  // 3. Cập nhật bảng tổng hợp accounting_inventory_balance
  const balanceValues = aggregatedList.map((item) => ({
    store_id: storeId,
    sku: item.sku,
    asin: item.asin,
    fnsku: item.fnsku,
    title: item.title,
    in_transit_between_warehouses: item.inTransit,
    ending_warehouse_balance: item.ending,
    ton_kho: item.tonKho,
    sellable_balance: item.sellable,
    unsellable_balance: item.unsellable,
    snapshot_date: snapshotDate,
  }));

  for (let i = 0; i < balanceValues.length; i += BATCH_SIZE) {
    const chunk = balanceValues.slice(i, i + BATCH_SIZE);
    await sql`
      INSERT INTO accounting_inventory_balance ${sql(chunk)}
      ON CONFLICT (store_id, sku, asin)
      DO UPDATE SET
        fnsku = COALESCE(EXCLUDED.fnsku, accounting_inventory_balance.fnsku),
        title = COALESCE(EXCLUDED.title, accounting_inventory_balance.title),
        in_transit_between_warehouses = EXCLUDED.in_transit_between_warehouses,
        ending_warehouse_balance = EXCLUDED.ending_warehouse_balance,
        ton_kho = EXCLUDED.ton_kho,
        sellable_balance = EXCLUDED.sellable_balance,
        unsellable_balance = EXCLUDED.unsellable_balance,
        snapshot_date = EXCLUDED.snapshot_date,
        updated_at = NOW()
    `;
  }

  // 4. Cập nhật trực tiếp ton_kho vào accounting_sku_master (map cả sku + asin)
  let updatedSkuMasterCount = 0;
  for (const item of aggregatedList) {
    if (!item.sku) continue;

    // Ưu tiên khớp cả store_id + SKU + ASIN
    if (item.asin) {
      const res = await sql`
        UPDATE accounting_sku_master
        SET 
          ton_kho = ${item.tonKho},
          in_transit_between_warehouses = ${item.inTransit},
          ending_warehouse_balance = ${item.ending},
          ton_kho_updated_at = NOW()
        WHERE 
          store_id = ${storeId}
          AND UPPER(TRIM(sku)) = UPPER(TRIM(${item.sku}))
          AND UPPER(TRIM(asin)) = UPPER(TRIM(${item.asin}))
          AND deleted_at IS NULL
      `;
      if (res.count > 0) {
        updatedSkuMasterCount += res.count;
        continue;
      }
    }

    // Fallback: nếu ASIN trong master chưa khớp hoặc rỗng thì khớp theo store_id + SKU
    const fallbackRes = await sql`
      UPDATE accounting_sku_master
      SET 
        ton_kho = ${item.tonKho},
        in_transit_between_warehouses = ${item.inTransit},
        ending_warehouse_balance = ${item.ending},
        asin = COALESCE(asin, ${item.asin || null}),
        ton_kho_updated_at = NOW()
      WHERE 
        store_id = ${storeId}
        AND UPPER(TRIM(sku)) = UPPER(TRIM(${item.sku}))
        AND deleted_at IS NULL
    `;
    updatedSkuMasterCount += fallbackRes.count;
  }

  const totalTonKho = aggregatedList.reduce((acc, it) => acc + it.tonKho, 0);

  return {
    insertedCount: rows.length,
    updatedSkuMasterCount,
    totalTonKho,
  };
}

/**
 * Tra cứu tồn kho mới nhất của Store từ database
 */
export async function getLatestInventoryBalances(
  storeId: string
): Promise<InventoryBalanceItem[]> {
  const sql = await getDatabaseClient();
  const rows = await sql<Array<{
    store_id: string;
    sku: string;
    asin: string;
    fnsku: string | null;
    title: string | null;
    in_transit_between_warehouses: string | number;
    ending_warehouse_balance: string | number;
    ton_kho: string | number;
    sellable_balance: string | number;
    unsellable_balance: string | number;
    snapshot_date: string;
    updated_at: string;
  }>>`
    SELECT 
      store_id, sku, asin, fnsku, title,
      in_transit_between_warehouses, ending_warehouse_balance,
      ton_kho, sellable_balance, unsellable_balance,
      snapshot_date::text, updated_at::text
    FROM accounting_inventory_balance
    WHERE store_id = ${storeId}
    ORDER BY ton_kho DESC
  `;

  return rows.map((r) => ({
    storeId: r.store_id,
    sku: r.sku,
    asin: r.asin,
    fnsku: r.fnsku,
    title: r.title,
    inTransitBetweenWarehouses: Number(r.in_transit_between_warehouses) || 0,
    endingWarehouseBalance: Number(r.ending_warehouse_balance) || 0,
    tonKho: Number(r.ton_kho) || 0,
    sellableBalance: Number(r.sellable_balance) || 0,
    unsellableBalance: Number(r.unsellable_balance) || 0,
    snapshotDate: r.snapshot_date,
    updatedAt: r.updated_at,
  }));
}

/**
 * Tab TỒN KHO: các dòng báo cáo của 1 ngày chốt sổ (mặc định mới nhất) + danh sách các ngày đã có.
 * Product Type / Mockup lấy từ Bảng Mã FBA theo SKU.
 */
export async function getInventoryStockSnapshot(
  storeId: string,
  snapshotDate?: string | null,
): Promise<{ snapshotDates: string[]; snapshotDate: string | null; items: InventoryStockItem[] }> {
  const sql = await getDatabaseClient();
  const dates = await sql<{ d: string }[]>`
    SELECT DISTINCT snapshot_date::text AS d FROM accounting_inventory_ledger
    WHERE store_id = ${storeId} ORDER BY d DESC
  `;
  const snapshotDates = dates.map((r) => r.d);
  const target = snapshotDate && snapshotDates.includes(snapshotDate) ? snapshotDate : snapshotDates[0] ?? null;
  if (!target) return { snapshotDates, snapshotDate: null, items: [] };

  const rows = await sql<Record<string, unknown>[]>`
    SELECT
      l.id, l.report_date::text, l.fnsku, l.asin, l.sku, l.title, l.disposition, l.location,
      l.in_transit_between_warehouses::float, l.ending_warehouse_balance::float,
      l.total_warehouse_balance::float AS ton_kho,
      ${sql.unsafe(LEDGER_EVENT_KEYS.map((k) => `l.${k}::float`).join(", "))},
      m.product_type, COALESCE(m.mockup_url, m.mockup) AS mockup
    FROM accounting_inventory_ledger l
    LEFT JOIN LATERAL (
      SELECT product_type, mockup, mockup_url FROM accounting_sku_master
      WHERE store_id = l.store_id AND deleted_at IS NULL AND LOWER(TRIM(sku)) = LOWER(TRIM(l.sku))
      LIMIT 1
    ) m ON TRUE
    WHERE l.store_id = ${storeId} AND l.snapshot_date = ${target}
    ORDER BY l.total_warehouse_balance DESC, l.sku, l.location
  `;
  return { snapshotDates, snapshotDate: target, items: rows as unknown as InventoryStockItem[] };
}
