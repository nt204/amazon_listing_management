import "server-only";

import { getDatabaseClient } from "@/lib/db";
import { parseCsv } from "@/lib/csv";
import { skuStockValueJoins, skuUnitCostSql } from "@/lib/accounting/inventory-db";

// Tồn kho real time từng SKU (bảng accounting_live_inventory, migration 160).
// Crawler kế toán 16h10 gửi 2 file mỗi store:
//   FBA: FBA Inventory (reportcentral/MANAGE_INVENTORY_HEALTH, File 06) → available + inbound-quantity + Total Reserved Quantity
//   AWD: "AWD inventory report" (fba-inventory/gim) → Available in AWD + Inbound to AWD + Reserved in AWD (units)
// Tồn SKU = FBA + AWD; Giá trị tồn = Tồn × Giá TB năm (cùng công thức cột "Giá trị tồn" của Bảng mã).

export type LiveInventorySource = "FBA" | "AWD";

export interface LiveInventoryRow {
  sku: string;
  fnsku: string | null;
  asin: string | null;
  available: number;
  inbound: number;
  reserved: number;
  /** FBA: "estimated-storage-cost-next-month" (USD); AWD không có → null */
  storageCost?: number | null;
}

export interface ParsedLiveInventory {
  rows: LiveInventoryRow[];
  /** Ngày/giờ Amazon ghi trong file */
  reportLabel: string | null;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

function toInt(value: string | undefined): number {
  const n = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function toMoney(value: string | undefined): number | null {
  const text = String(value ?? "").replace(/[$,]/g, "").trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function pickColumns(header: string[], wanted: Record<string, string[]>): Record<string, number> {
  const normalized = header.map(norm);
  const out: Record<string, number> = {};
  for (const [key, names] of Object.entries(wanted)) {
    out[key] = names.map(norm).map((n) => normalized.indexOf(n)).find((i) => i >= 0) ?? -1;
  }
  return out;
}

/** Gộp dòng trùng SKU (cộng dồn) để khoá chính (store, kho, sku) không vỡ. */
function mergeBySku(rows: LiveInventoryRow[]): LiveInventoryRow[] {
  const map = new Map<string, LiveInventoryRow>();
  for (const r of rows) {
    const prev = map.get(r.sku);
    if (!prev) map.set(r.sku, { ...r });
    else {
      prev.available += r.available;
      prev.inbound += r.inbound;
      prev.reserved += r.reserved;
      if (r.storageCost != null) prev.storageCost = (prev.storageCost ?? 0) + r.storageCost;
      prev.fnsku ||= r.fnsku;
      prev.asin ||= r.asin;
    }
  }
  return [...map.values()];
}

function parseTable(content: string): string[][] {
  const text = content.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  // Đề phòng Amazon trả TSV
  if (firstLine.includes("\t") && !firstLine.includes(",")) {
    return text.split(/\r?\n/).map((l) => l.split("\t").map((c) => c.replace(/^"|"$/g, "").trim())).filter((r) => r.some(Boolean));
  }
  return parseCsv(text);
}

export function parseFbaInventoryReport(content: string): ParsedLiveInventory {
  const table = parseTable(content);
  const headerIdx = table.findIndex((r) => r.map(norm).includes("sku") && r.map(norm).includes("available"));
  if (headerIdx < 0) throw new Error("File FBA Inventory không có cột sku / available.");
  const c = pickColumns(table[headerIdx], {
    sku: ["sku"],
    fnsku: ["fnsku"],
    asin: ["asin"],
    available: ["available"],
    inbound: ["inbound-quantity"],
    reserved: ["Total Reserved Quantity"],
    date: ["snapshot-date"],
    storageCost: ["estimated-storage-cost-next-month"],
  });
  if (c.inbound < 0 || c.reserved < 0) throw new Error("File FBA Inventory thiếu cột inbound-quantity / Total Reserved Quantity.");
  const rows: LiveInventoryRow[] = [];
  let reportLabel: string | null = null;
  for (const r of table.slice(headerIdx + 1)) {
    const sku = (r[c.sku] || "").trim().toUpperCase();
    if (!sku) continue;
    reportLabel ||= (c.date >= 0 && r[c.date]) || null;
    rows.push({
      sku,
      fnsku: r[c.fnsku] || null,
      asin: r[c.asin] || null,
      available: toInt(r[c.available]),
      inbound: toInt(r[c.inbound]),
      reserved: toInt(r[c.reserved]),
      storageCost: c.storageCost >= 0 ? toMoney(r[c.storageCost]) : null,
    });
  }
  return { rows: mergeBySku(rows), reportLabel };
}

export function parseAwdInventoryReport(content: string): ParsedLiveInventory {
  const table = parseTable(content);
  // Đầu file: "Timestamp,11/20/26 09:15:31" / "Merchant ID,..." rồi mới tới dòng tiêu đề.
  const stamp = table.find((r) => norm(r[0] || "") === "timestamp");
  const headerIdx = table.findIndex((r) => r.map(norm).includes("sku") && r.map(norm).includes(norm("Available in AWD (units)")));
  if (headerIdx < 0) throw new Error("File AWD inventory report không có cột SKU / Available in AWD (units).");
  const c = pickColumns(table[headerIdx], {
    sku: ["SKU"],
    fnsku: ["FNSKU"],
    asin: ["ASIN"],
    available: ["Available in AWD (units)"],
    inbound: ["Inbound to AWD (units)"],
    reserved: ["Reserved in AWD (units)"],
  });
  if (c.inbound < 0 || c.reserved < 0) throw new Error("File AWD inventory report thiếu cột Inbound to AWD / Reserved in AWD (units).");
  const rows: LiveInventoryRow[] = [];
  for (const r of table.slice(headerIdx + 1)) {
    const sku = (r[c.sku] || "").trim().toUpperCase();
    if (!sku) continue;
    rows.push({
      sku,
      fnsku: r[c.fnsku] || null,
      asin: r[c.asin] || null,
      available: toInt(r[c.available]),
      inbound: toInt(r[c.inbound]),
      reserved: toInt(r[c.reserved]),
    });
  }
  return { rows: mergeBySku(rows), reportLabel: stamp?.[1]?.trim() || null };
}

/** Thay toàn bộ ảnh chụp tồn của 1 kho (FBA hoặc AWD) của store bằng file mới. */
export async function replaceLiveInventory(
  storeId: string,
  source: LiveInventorySource,
  parsed: ParsedLiveInventory,
  fileName: string | null,
): Promise<{ rows: number; totalUnits: number }> {
  const sql = await getDatabaseClient();
  const records = parsed.rows.map((r) => ({
    store_id: storeId,
    source,
    sku: r.sku,
    fnsku: r.fnsku,
    asin: r.asin,
    available: r.available,
    inbound: r.inbound,
    reserved: r.reserved,
    estimated_storage_cost: r.storageCost ?? null,
    report_label: parsed.reportLabel,
    file_name: fileName,
  }));
  // Lịch sử từng ngày (migration 172): 1 ảnh chụp / store / kho / ngày giờ VN, nạp lại trong ngày thì ghi đè
  const snapshotDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
  const daily = parsed.rows.map((r) => ({
    store_id: storeId,
    source,
    snapshot_date: snapshotDate,
    sku: r.sku,
    fnsku: r.fnsku,
    asin: r.asin,
    available: r.available,
    inbound: r.inbound,
    reserved: r.reserved,
  }));
  await sql.begin(async (tx) => {
    await tx`DELETE FROM accounting_live_inventory WHERE store_id = ${storeId} AND source = ${source}`;
    for (let i = 0; i < records.length; i += 1000) {
      await tx`INSERT INTO accounting_live_inventory ${tx(records.slice(i, i + 1000))}`;
    }
    await tx`
      DELETE FROM accounting_live_inventory_daily
      WHERE store_id = ${storeId} AND source = ${source} AND snapshot_date = ${snapshotDate}
    `;
    for (let i = 0; i < daily.length; i += 1000) {
      await tx`INSERT INTO accounting_live_inventory_daily ${tx(daily.slice(i, i + 1000))}`;
    }
  });
  return {
    rows: records.length,
    totalUnits: parsed.rows.reduce((s, r) => s + r.available + r.inbound + r.reserved, 0),
  };
}

export interface LiveStock {
  fba: number;
  awd: number;
  /** Hàng đang đến (inbound FBA + AWD) — đã nằm trong fba / awd */
  inbound: number;
  total: number;
  /** null = SKU chưa có giá vốn trong Bảng mã */
  unitCost: number | null;
  value: number | null;
}

export interface LiveStockSnapshot {
  bySku: Map<string, LiveStock>;
  /** Lần nạp gần nhất mỗi kho (ISO) + ngày/giờ Amazon ghi trong file */
  fbaAt: string | null;
  awdAt: string | null;
  fbaLabel: string | null;
  awdLabel: string | null;
}

/** Tồn real time (FBA + AWD) và giá trị tồn từng SKU của 1 store kế toán. */
export async function queryLiveStock(accountingStoreId: string): Promise<LiveStockSnapshot> {
  const sql = await getDatabaseClient();
  const [qty, meta] = await Promise.all([
    sql<{ k: string; fba: number; awd: number; inbound: number; unit_cost: number | null }[]>`
      WITH q AS (
        SELECT UPPER(TRIM(sku)) AS k,
          COALESCE(SUM(total) FILTER (WHERE source = 'FBA'), 0)::int AS fba,
          COALESCE(SUM(total) FILTER (WHERE source = 'AWD'), 0)::int AS awd,
          COALESCE(SUM(inbound), 0)::int AS inbound
        FROM accounting_live_inventory
        WHERE store_id = ${accountingStoreId}
        GROUP BY 1
      ),
      cost AS (
        SELECT DISTINCT ON (UPPER(TRIM(asm.sku))) UPPER(TRIM(asm.sku)) AS k, (${skuUnitCostSql(sql)})::float AS unit_cost
        FROM accounting_sku_master asm
        ${skuStockValueJoins(sql)}
        WHERE asm.store_id = ${accountingStoreId} AND asm.deleted_at IS NULL
          AND UPPER(TRIM(asm.sku)) IN (SELECT k FROM q)
        ORDER BY UPPER(TRIM(asm.sku)), asm.updated_at DESC NULLS LAST
      )
      SELECT q.k, q.fba, q.awd, q.inbound, cost.unit_cost FROM q LEFT JOIN cost ON cost.k = q.k
    `,
    sql<{ source: LiveInventorySource; at: Date; label: string | null }[]>`
      SELECT DISTINCT ON (source) source, imported_at AS at, report_label AS label
      FROM accounting_live_inventory
      WHERE store_id = ${accountingStoreId}
      ORDER BY source, imported_at DESC
    `,
  ]);
  const bySku = new Map<string, LiveStock>();
  for (const r of qty) {
    const total = Math.max(0, Number(r.fba) + Number(r.awd));
    const unitCost = r.unit_cost == null ? null : Number(r.unit_cost);
    bySku.set(r.k, {
      fba: Number(r.fba),
      awd: Number(r.awd),
      inbound: Number(r.inbound),
      total,
      unitCost,
      value: unitCost == null ? null : Math.round(total * unitCost * 100) / 100,
    });
  }
  const m = (s: LiveInventorySource) => meta.find((x) => x.source === s);
  return {
    bySku,
    fbaAt: m("FBA")?.at ? new Date(m("FBA")!.at).toISOString() : null,
    awdAt: m("AWD")?.at ? new Date(m("AWD")!.at).toISOString() : null,
    fbaLabel: m("FBA")?.label ?? null,
    awdLabel: m("AWD")?.label ?? null,
  };
}
