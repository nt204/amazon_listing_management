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
  // Ghi nhận theo lô 500 dòng, trong 1 transaction để không ai đọc được snapshot dở dang.
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

  // Bảng tổng hợp + cột Tồn của BẢNG MÃ chỉ lấy snapshot mới nhất của store:
  // nạp lại file tuần cũ chỉ lưu vào ledger, không đè số tuần mới.
  const [{ latest }] = await sql<{ latest: string | null }[]>`
    SELECT MAX(snapshot_date)::text AS latest FROM accounting_inventory_ledger WHERE store_id = ${storeId}
  `;
  const isLatestSnapshot = !latest || snapshotDate >= latest;

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

  for (let i = 0; isLatestSnapshot && i < balanceValues.length; i += BATCH_SIZE) {
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

  // 4. Cập nhật trực tiếp ton_kho vào accounting_sku_master (map cả sku + asin) — cột Tồn của BẢNG MÃ.
  let updatedSkuMasterCount = 0;
  for (const item of isLatestSnapshot ? aggregatedList : []) {
    if (!item.sku) continue;

    // Ưu tiên khớp cả store_id + SKU + ASIN
    if (item.asin) {
      const res = await sql`
        UPDATE accounting_sku_master
        SET 
          ton_kho_fba = ${item.tonKho},
          ton_kho_fba_updated_at = NOW(),
          in_transit_between_warehouses = ${item.inTransit},
          ending_warehouse_balance = ${item.ending},
          ton_kho = ${item.tonKho} + COALESCE(ton_kho_awd, 0),
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
        ton_kho_fba = ${item.tonKho},
        ton_kho_fba_updated_at = NOW(),
        in_transit_between_warehouses = ${item.inTransit},
        ending_warehouse_balance = ${item.ending},
        asin = COALESCE(asin, ${item.asin || null}),
        ton_kho = ${item.tonKho} + COALESCE(ton_kho_awd, 0),
        ton_kho_updated_at = NOW()
      WHERE 
        store_id = ${storeId}
        AND UPPER(TRIM(sku)) = UPPER(TRIM(${item.sku}))
        AND deleted_at IS NULL
    `;
    updatedSkuMasterCount += fallbackRes.count;
  }

  // SKU không còn trong báo cáo FBA mới nhất = không còn hàng ở kho FBA → Tồn FBA về 0, giữ nguyên tồn AWD
  if (isLatestSnapshot) {
    const reportedSkus = Array.from(new Set(aggregatedList.map((item) => item.sku.trim().toUpperCase())));
    await sql`
      UPDATE accounting_sku_master
      SET 
        ton_kho_fba = 0,
        in_transit_between_warehouses = 0,
        ending_warehouse_balance = 0,
        ton_kho_fba_updated_at = NOW(),
        ton_kho = COALESCE(ton_kho_awd, 0),
        ton_kho_updated_at = NOW()
      WHERE store_id = ${storeId}
        AND deleted_at IS NULL
        AND (ton_kho_fba IS DISTINCT FROM 0 OR in_transit_between_warehouses IS DISTINCT FROM 0 OR ending_warehouse_balance IS DISTINCT FROM 0)
        AND NOT (UPPER(TRIM(sku)) = ANY(${reportedSkus}::text[]))
    `;
  }

  const totalTonKho = aggregatedList.reduce((acc, it) => acc + it.tonKho, 0);

  return {
    insertedCount: rows.length,
    updatedSkuMasterCount,
    totalTonKho,
  };
}

// ============================================================================
// AWD INVENTORY LEDGER (TỒN KHO AWD)
// ============================================================================

export interface AwdInventoryLedgerRow {
  date: string | null;
  sku: string; // MSKU
  fnsku: string | null;
  asin: string;
  packageQuantity: number;
  purchaseOrderId: string | null;
  title: string | null;
  startingWarehouseBalanceCartons: number;
  receivedCartons: number;
  departedCartons: number;
  lostCartons: number;
  foundCartons: number;
  otherCartons: number;
  unknownCartons: number;
  endingWarehouseBalanceCartons: number;
  tonKhoUnits: number; // endingWarehouseBalanceCartons * packageQuantity
  facilityId: string | null;
  country: string | null;
  expiryDate: string | null;
}

/**
 * Phân tích nội dung file CSV báo cáo AWD Inventory Ledger (Summary)
 * Tồn của kho AWD = Ending Warehouse Balance (cartons) * Package Quantity
 */
export function parseAwdInventoryLedgerContent(content: string): AwdInventoryLedgerRow[] {
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
  const idxSku = findIdx("msku", "merchantsku", "sku");
  const idxFnsku = findIdx("fnsku");
  const idxAsin = findIdx("asin");
  const idxPkgQty = findIdx("packagequantity", "package_quantity", "pkgqty");
  const idxPoId = findIdx("purchaseorderid", "purchase_order_id", "poid");
  const idxTitle = findIdx("title", "productname");
  const idxStarting = findIdx("startingwarehousebalancecartons", "startingwarehousebalance", "starting");
  const idxReceived = findIdx("receivedcartons", "received");
  const idxDeparted = findIdx("departedcartons", "departed");
  const idxLost = findIdx("lostcartons", "lost");
  const idxFound = findIdx("foundcartons", "found");
  const idxOther = findIdx("othercartons", "other");
  const idxUnknown = findIdx("unknowncartons", "unknown");
  const idxEnding = findIdx("endingwarehousebalancecartons", "endingwarehousebalance", "ending");
  const idxFacility = findIdx("facilityid", "facility");
  const idxCountry = findIdx("country");
  const idxExpiry = findIdx("expirydate", "expiry");

  if (idxSku === -1 && idxAsin === -1) {
    throw new Error("File CSV báo cáo AWD thiếu cột nhận diện SKU/MSKU hoặc ASIN.");
  }

  const results: AwdInventoryLedgerRow[] = [];

  for (let i = 1; i < rawRows.length; i++) {
    const r = rawRows[i];
    if (!r || r.length === 0) continue;

    const sku = idxSku !== -1 && r[idxSku] ? r[idxSku].trim() : "";
    const asin = idxAsin !== -1 && r[idxAsin] ? r[idxAsin].trim() : "";
    if (!sku && !asin) continue;

    const pkgQty = idxPkgQty !== -1 ? Math.max(1, parseNumber(r[idxPkgQty])) : 1;
    const endingCartons = idxEnding !== -1 ? parseNumber(r[idxEnding]) : 0;
    const tonKhoUnits = endingCartons * pkgQty;

    results.push({
      date: idxDate !== -1 && r[idxDate] ? r[idxDate].trim() : null,
      sku: sku || asin,
      fnsku: idxFnsku !== -1 && r[idxFnsku] ? r[idxFnsku].trim() : null,
      asin,
      packageQuantity: pkgQty,
      purchaseOrderId: idxPoId !== -1 && r[idxPoId] ? r[idxPoId].trim() : null,
      title: idxTitle !== -1 && r[idxTitle] ? r[idxTitle].trim() : null,
      startingWarehouseBalanceCartons: idxStarting !== -1 ? parseNumber(r[idxStarting]) : 0,
      receivedCartons: idxReceived !== -1 ? parseNumber(r[idxReceived]) : 0,
      departedCartons: idxDeparted !== -1 ? parseNumber(r[idxDeparted]) : 0,
      lostCartons: idxLost !== -1 ? parseNumber(r[idxLost]) : 0,
      foundCartons: idxFound !== -1 ? parseNumber(r[idxFound]) : 0,
      otherCartons: idxOther !== -1 ? parseNumber(r[idxOther]) : 0,
      unknownCartons: idxUnknown !== -1 ? parseNumber(r[idxUnknown]) : 0,
      endingWarehouseBalanceCartons: endingCartons,
      tonKhoUnits,
      facilityId: idxFacility !== -1 && r[idxFacility] ? r[idxFacility].trim() : null,
      country: idxCountry !== -1 && r[idxCountry] ? r[idxCountry].trim().toUpperCase() : null,
      expiryDate: idxExpiry !== -1 && r[idxExpiry] ? r[idxExpiry].trim() : null,
    });
  }

  return results;
}

/**
 * Nạp dữ liệu báo cáo AWD Inventory Ledger vào database và cập nhật Bảng Mã (accounting_sku_master)
 * - Tồn kho AWD = Ending Warehouse Balance (cartons) * Package Quantity
 * - Tổng tồn trong Bảng Mã = ton_kho_fba + ton_kho_awd (theo SKU + ASIN)
 */
export async function ingestAwdInventoryLedgerRows(
  storeId: string,
  rows: AwdInventoryLedgerRow[],
  snapshotDate: string,
  sourceFileName?: string
): Promise<{ insertedCount: number; updatedSkuMasterCount: number; totalTonKhoAwd: number }> {
  if (!rows || rows.length === 0) {
    return { insertedCount: 0, updatedSkuMasterCount: 0, totalTonKhoAwd: 0 };
  }

  const sql = await getDatabaseClient();

  // 1. Lưu chi tiết từng dòng báo cáo vào accounting_awd_inventory_ledger (thay thế snapshot của ngày đó)
  const detailValues = rows.map((r) => ({
    store_id: storeId,
    snapshot_date: snapshotDate,
    report_date: r.date || snapshotDate,
    sku: r.sku,
    fnsku: r.fnsku,
    asin: r.asin,
    package_quantity: r.packageQuantity,
    purchase_order_id: r.purchaseOrderId,
    title: r.title,
    starting_warehouse_balance_cartons: r.startingWarehouseBalanceCartons,
    received_cartons: r.receivedCartons,
    departed_cartons: r.departedCartons,
    lost_cartons: r.lostCartons,
    found_cartons: r.foundCartons,
    other_cartons: r.otherCartons,
    unknown_cartons: r.unknownCartons,
    ending_warehouse_balance_cartons: r.endingWarehouseBalanceCartons,
    ton_kho_units: r.tonKhoUnits,
    facility_id: r.facilityId,
    country: r.country,
    expiry_date: r.expiryDate,
    source_file: sourceFileName || null,
  }));

  const BATCH_SIZE = 500;
  await sql.begin(async (tx) => {
    await tx`DELETE FROM accounting_awd_inventory_ledger WHERE store_id = ${storeId} AND snapshot_date = ${snapshotDate}`;
    for (let i = 0; i < detailValues.length; i += BATCH_SIZE) {
      const chunk = detailValues.slice(i, i + BATCH_SIZE);
      await tx`INSERT INTO accounting_awd_inventory_ledger ${tx(chunk)}`;
    }
  });

  // 2. Gom nhóm theo SKU + ASIN để tính tổng tồn kho AWD
  const aggregatedMap = new Map<string, { sku: string; asin: string; tonKhoAwd: number; endingCartons: number }>();
  for (const r of rows) {
    const key = `${r.sku.trim().toUpperCase()}|||${r.asin.trim().toUpperCase()}`;
    const existing = aggregatedMap.get(key);
    if (!existing) {
      aggregatedMap.set(key, {
        sku: r.sku,
        asin: r.asin,
        tonKhoAwd: r.tonKhoUnits,
        endingCartons: r.endingWarehouseBalanceCartons,
      });
    } else {
      existing.tonKhoAwd += r.tonKhoUnits;
      existing.endingCartons += r.endingWarehouseBalanceCartons;
    }
  }

  const aggregatedList = Array.from(aggregatedMap.values());

  // 3. Kiểm tra xem snapshotDate có phải mới nhất không
  const maxDateRes = await sql<Array<{ max_date: string | null }>>`
    SELECT MAX(snapshot_date)::text AS max_date FROM accounting_awd_inventory_ledger WHERE store_id = ${storeId}
  `;
  const latestSnapshotDate = maxDateRes[0]?.max_date || snapshotDate;
  const isLatestSnapshot = snapshotDate >= latestSnapshotDate;

  // 4. Cập nhật trực tiếp ton_kho_awd và tổng tồn (ton_kho = ton_kho_fba + ton_kho_awd) vào accounting_sku_master
  let updatedSkuMasterCount = 0;
  if (isLatestSnapshot) {
    for (const item of aggregatedList) {
      if (!item.sku) continue;

      if (item.asin) {
        const res = await sql`
          UPDATE accounting_sku_master
          SET 
            ton_kho_awd = ${item.tonKhoAwd},
            ton_kho_awd_updated_at = NOW(),
            ton_kho = COALESCE(ton_kho_fba, 0) + ${item.tonKhoAwd},
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

      // Fallback khớp theo SKU
      const fallbackRes = await sql`
        UPDATE accounting_sku_master
        SET 
          ton_kho_awd = ${item.tonKhoAwd},
          ton_kho_awd_updated_at = NOW(),
          asin = COALESCE(asin, ${item.asin || null}),
          ton_kho = COALESCE(ton_kho_fba, 0) + ${item.tonKhoAwd},
          ton_kho_updated_at = NOW()
        WHERE 
          store_id = ${storeId}
          AND UPPER(TRIM(sku)) = UPPER(TRIM(${item.sku}))
          AND deleted_at IS NULL
      `;
      updatedSkuMasterCount += fallbackRes.count;
    }

    // Những SKU không còn trong báo cáo AWD mới nhất -> ton_kho_awd về 0, tổng tồn = ton_kho_fba
    const reportedSkus = Array.from(new Set(aggregatedList.map((item) => item.sku.trim().toUpperCase())));
    await sql`
      UPDATE accounting_sku_master
      SET 
        ton_kho_awd = 0,
        ton_kho_awd_updated_at = NOW(),
        ton_kho = COALESCE(ton_kho_fba, 0),
        ton_kho_updated_at = NOW()
      WHERE store_id = ${storeId}
        AND deleted_at IS NULL
        AND ton_kho_awd IS DISTINCT FROM 0
        AND NOT (UPPER(TRIM(sku)) = ANY(${reportedSkus}::text[]))
    `;
  }

  const totalTonKhoAwd = aggregatedList.reduce((acc, it) => acc + it.tonKhoAwd, 0);

  return {
    insertedCount: rows.length,
    updatedSkuMasterCount,
    totalTonKhoAwd,
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

