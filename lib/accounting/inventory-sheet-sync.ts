import "server-only";

import type postgres from "postgres";
import { ApiError } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { getServiceAccountEmail, parseSpreadsheetId, readSpreadsheetTab } from "@/lib/google/sheets";
import { getStoreById } from "@/lib/accounting/accounting-db";
import { storeHasFbaTeam, storeHasTeam } from "@/lib/accounting/store-teams";
import {
  INBOUND_HEADER_MAP,
  SKU_HEADER_MAP,
  cleanDateOnly,
  cleanMonthOnly,
  isOffSkuStatus,
  parseFbmSkuRows,
  sheetSerialToIsoDate,
  skuExtraFields,
  skuMasterTable,
  syncCheckShipmentsToInbound,
  type SheetRows,
  type SkuChannel,
} from "@/lib/accounting/inventory-db";

// Đồng bộ BẢNG MÃ / BẢNG MÃ FBM / CHI TIẾT ĐI HÀNG / ĐẦU VÀO FBM PW từ link Google Sheet đã lưu theo store.
// Google Sheet là bản gốc: ô có giá trị trên sheet ghi đè DB; ô trống giữ nguyên giá trị đang có.
// Chống trùng: SKU khớp không phân biệt hoa/thường + UNIQUE(store_id, sku); đi hàng khớp theo
// SKU+Shipment ID → SKU+Tên lô → SKU+Ngày request+Số lượng (theo thứ tự xuất hiện), dòng web
// không còn trên sheet bị xóa mềm (khôi phục được qua Lịch sử). Mỗi store+sheet chạy trong
// 1 transaction có khóa, lỗi giữa chừng thì không ghi gì.

export type SheetType = "sku" | "sku_fbm" | "inbound" | "fbm_pw";
export type SyncTrigger = "link_saved" | "manual" | "reload" | "schedule";

export const SHEET_TYPES: SheetType[] = ["sku", "sku_fbm", "inbound", "fbm_pw"];
export const SHEET_TYPE_LABELS: Record<SheetType, string> = {
  sku: "Bảng Mã",
  sku_fbm: "Bảng Mã FBM",
  inbound: "Chi Tiết Đi Hàng",
  fbm_pw: "Basecost FBM (Đầu vào FBM PW)",
};

export interface SheetSyncResult {
  spreadsheetTitle: string;
  tabTitle: string;
  sheetRows: number;
  inserted: number;
  updated: number;
  unchanged: number;
  restored: number;
  deleted: number;
  /** SKU có trên web nhưng không còn trên sheet (Bảng Mã không tự xóa). */
  missingOnSheet: number;
  /** Số dòng thay đổi theo từng cột (để biết lần đồng bộ sửa những gì). */
  changedFields: Record<string, number>;
  duplicatesInSheet: string[];
  warnings: string[];
  dryRun: boolean;
}

/**
 * Link lưu theo FILE: 'inventory' = BẢNG MÃ FBA + CHI TIẾT ĐI HÀNG, 'fbm' = BẢNG MÃ FBM,
 * 'fbm_accounting' = KẾ TOÁN TỔNG HỢP FBM (tab ĐẦU VÀO FBM PW → Basecost Tháng FBM).
 */
export type LinkType = "inventory" | "fbm" | "fbm_accounting";
export const LINK_TYPES: LinkType[] = ["inventory", "fbm", "fbm_accounting"];
export const LINK_PARTS: Record<LinkType, SheetType[]> = {
  inventory: ["sku", "inbound"],
  fbm: ["sku_fbm"],
  fbm_accounting: ["fbm_pw"],
};
export const LINK_TYPE_LABELS: Record<LinkType, string> = {
  inventory: "File INVENTORY (Bảng Mã FBA + Chi Tiết Đi Hàng)",
  fbm: "File Bảng Mã FBM",
  fbm_accounting: "File Kế Toán Tổng Hợp FBM",
};

export function linkTypeOfPart(part: SheetType): LinkType {
  return part === "sku_fbm" ? "fbm" : part === "fbm_pw" ? "fbm_accounting" : "inventory";
}

export interface SheetPartOutcome {
  ok: boolean;
  at: string;
  trigger: SyncTrigger;
  tabTitle?: string;
  result?: SheetSyncResult;
  error?: string;
  /** Bị chặn bởi giới hạn an toàn xóa hàng loạt — có thể chạy lại với force để bỏ qua. */
  blocked?: boolean;
}

export interface SheetLink {
  id: string;
  store_id: string;
  link_type: LinkType;
  sheet_url: string;
  spreadsheet_title: string | null;
  last_synced_at: string | null;
  last_status: "success" | "error" | null;
  last_error: string | null;
  last_result: { parts?: Partial<Record<SheetType, SheetPartOutcome>> } | null;
  updated_by: string | null;
  updated_at: string;
}

type Row = Record<string, string | number | null>;
type Tx = postgres.TransactionSql;

// ----------------- Chuẩn hóa giá trị -----------------

function norm(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function text(value: unknown): string | null {
  if (value == null || typeof value === "object") return null;
  const s = String(value).replace(/\r/g, "").trim();
  if (!s || s === "[object Object]" || s === "#N/A" || s === "#REF!" || s === "#VALUE!" || s === "—" || s === "-") return null;
  return s;
}

/** SKU không chứa khoảng trắng / xuống dòng (sheet có ô "\nWCPL220955A01"). */
function skuText(value: unknown): string | null {
  const s = text(value)?.replace(/\s+/g, "");
  return s && s.toLowerCase() !== "sku" ? s : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const s = text(value);
  if (!s) return null;
  const n = parseFloat(s.replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function int(value: unknown): number | null {
  const n = num(value);
  return n == null ? null : Math.round(n);
}

/** Ngày: serial của Google → ISO; chữ "d/m/y" (đổi sang m/d/y khi số giữa > 12). */
function sheetDate(value: unknown): string | null {
  const serial = sheetSerialToIsoDate(value);
  if (serial) return serial;
  const s = text(value);
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    let [day, month] = [Number(m[1]), Number(m[2])];
    if (month > 12 && day <= 12) [day, month] = [month, day];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return cleanDateOnly(s);
}

function sheetMonth(value: unknown): string | null {
  return cleanMonthOnly(sheetSerialToIsoDate(value) ?? text(value));
}

function urlText(value: unknown): string | null {
  const s = text(value);
  return s && /^(https?:\/\/|\/)/.test(s) ? s : null;
}

// ----------------- Đọc sheet -----------------

function buildHeaderMap(base: Record<string, string>, extra: Record<string, string | null>) {
  const map = new Map<string, string | null>();
  for (const [key, field] of Object.entries(base)) map.set(norm(key), field);
  for (const [key, field] of Object.entries(extra)) map.set(norm(key), field);
  return map;
}

const FBA_SKU_HEADERS = buildHeaderMap(SKU_HEADER_MAP, {
  "ngách": "niche",
  "kích thước": "kich_thuoc",
  "phân loại kích thước": "phan_loai_kich_thuoc",
  "file design": "file_design",
  // Cột đánh giá event theo mùa của từng store ("Event Christmas", "Event Halloween"...) dùng chung ô Event 250th
  "event christmas": "event_250th",
  "event halloween": "event_250th",
  "mockup": null, // =IMAGE(Mockup url)
});

const INBOUND_HEADERS = buildHeaderMap(INBOUND_HEADER_MAP, {
  "final basecose": "final_basecost",
  "quantity/add": "quantity",
  "mockup": null,
});

function mapColumns(header: (string | number | null)[], map: Map<string, string | null>) {
  return header.map((h) => {
    const key = norm(h);
    if (map.has(key)) return map.get(key) ?? null;
    if (key.startsWith("event ") && map === FBA_SKU_HEADERS) return "event_250th";
    return null;
  });
}

function findHeaderRow(rows: SheetRows, sheetLabel: string): number {
  const index = rows.slice(0, 5).findIndex((r) => r.some((v) => norm(v) === "sku"));
  if (index === -1) throw new ApiError(`Không tìm thấy dòng tiêu đề có cột "SKU" trong tab ${sheetLabel}.`, 400);
  return index;
}

const FBA_TEXT_FIELDS = new Set([
  "brand", "product_type", "asin", "fnsku", "pic_mkt", "loai", "niche", "pic_idea", "status", "event",
  "tinh_trang", "design_pic", "event_250th", "brand_entity_id", "creative_asins_video",
  "creative_asins_collection", "video_media_ids", "creative_headline", "brand_logo_asset_id",
  "landing_page_url", "kich_thuoc", "phan_loai_kich_thuoc", "file_design",
]);
const FBA_NUMBER_FIELDS = new Set(["amazon_fee", "amazon_fba_fee_thay_doi", "basecost_tb"]);

function parseFbaSkuRows(rows: SheetRows): Row[] {
  const headerIndex = findHeaderRow(rows, "BẢNG MÃ");
  const columns = mapColumns(rows[headerIndex], FBA_SKU_HEADERS);
  const out: Row[] = [];
  for (const [offset, row] of rows.slice(headerIndex + 1).entries()) {
    const raw: Record<string, unknown> = {};
    columns.forEach((field, i) => {
      // Cột trùng tên: giữ ô đầu tiên có giá trị
      if (field && (raw[field] == null || raw[field] === "")) raw[field] = row[i];
    });
    const sku = skuText(raw.sku);
    if (!sku) continue;
    const item: Row = { sku, _row: headerIndex + offset + 2 };
    for (const [field, value] of Object.entries(raw)) {
      if (field === "sku" || field === "mockup") continue;
      if (FBA_TEXT_FIELDS.has(field)) item[field] = text(value);
      else if (FBA_NUMBER_FIELDS.has(field)) item[field] = num(value);
      else if (field === "referral_fee_pct") {
        const pct = num(value);
        item[field] = pct != null && pct > 1 ? pct / 100 : pct;
      } else if (field === "thang_listing" || field === "thang_danh_gia") item[field] = sheetMonth(value);
      else if (field === "ngay_danh_gia_sku_event") item[field] = sheetDate(value);
      else if (field === "mockup_url") item[field] = urlText(value);
    }
    item.mockup = item.mockup_url ?? null;
    out.push(item);
  }
  return out;
}

const INBOUND_TEXT_FIELDS = new Set([
  "brand", "sup", "product_type", "line_ship", "ten_lo_hang", "shipment_id",
  "tinh_trang_hang_den_kho", "status", "note", "trang_thai",
]);
const INBOUND_MONEY_FIELDS = ["base_cost_per_unit", "card", "tag", "shipping_fee", "hop_tui", "final_basecost", "total_basecost"];
const INBOUND_INT_FIELDS = ["quantity", "amazon_received", "so_luong_amazon_nhan", "discrepancy"];
const INBOUND_DATE_FIELDS = ["ngay_request", "ngay_thanh_toan", "ngay_di", "ngay_den"];

function parseInboundRows(rows: SheetRows): Row[] {
  const headerIndex = findHeaderRow(rows, "CHI TIẾT ĐI HÀNG");
  const columns = mapColumns(rows[headerIndex], INBOUND_HEADERS);
  for (const required of ["quantity", "shipment_id"]) {
    if (!columns.includes(required)) {
      throw new ApiError(`Tab CHI TIẾT ĐI HÀNG thiếu cột "${required === "quantity" ? "Quantity" : "Shipment ID"}".`, 400);
    }
  }
  const out: Row[] = [];
  for (const [offset, row] of rows.slice(headerIndex + 1).entries()) {
    const raw: Record<string, unknown> = {};
    columns.forEach((field, i) => {
      if (field && (raw[field] == null || raw[field] === "")) raw[field] = row[i];
    });
    const sku = skuText(raw.sku);
    if (!sku) continue;
    const item: Row = { sku, _row: headerIndex + offset + 2 };
    for (const [field, value] of Object.entries(raw)) {
      if (INBOUND_TEXT_FIELDS.has(field)) item[field] = text(value);
      else if (INBOUND_MONEY_FIELDS.includes(field)) item[field] = num(value);
      else if (INBOUND_INT_FIELDS.includes(field)) item[field] = int(value);
      else if (INBOUND_DATE_FIELDS.includes(field)) item[field] = sheetDate(value);
      else if (field === "mockup") item[field] = urlText(value);
    }
    const quantity = Number(item.quantity ?? 0);
    item.quantity = quantity;
    // Dòng nháp chưa có số lượng và chưa có Shipment ID thì bỏ qua (giống import file)
    if (quantity <= 0 && !item.shipment_id) continue;

    const parts = ["base_cost_per_unit", "card", "tag", "shipping_fee", "hop_tui"].map((f) => item[f] as number | null);
    if (item.final_basecost == null && parts.some((p) => p != null)) {
      item.final_basecost = parts.reduce<number>((sum, p) => sum + (p ?? 0), 0);
    }
    if (item.total_basecost == null && item.final_basecost != null) {
      item.total_basecost = Number(item.final_basecost) * quantity;
    }
    const status = item.status ?? item.tinh_trang_hang_den_kho ?? null;
    item.tinh_trang_hang_den_kho = item.tinh_trang_hang_den_kho ?? status;
    item.status = status;
    if (String(item.shipment_id ?? "").toLowerCase().startsWith("star")) {
      item.so_luong_amazon_nhan = quantity;
      item.discrepancy = 0;
    }
    out.push(item);
  }
  return out;
}

// ĐẦU VÀO FBM PW: chép nguyên văn (không có khóa, giữ cả dòng trùng). NetPrice "8,94" (dấu phẩy thập phân) đọc thành 8.94.
const PW_HEADERS = new Map<string, string>([
  ["order id", "order_id"],
  ["pworderid", "pw_order_id"],
  ["ordername", "order_name"],
  ["netprice", "net_price"],
]);

function rawText(value: unknown): string | null {
  if (value == null || typeof value === "object") return null;
  const s = String(value).replace(/\r/g, "").trim();
  return s || null;
}

function pwPrice(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const s = rawText(value)?.replace(/[$\s]/g, "");
  if (!s) return null;
  const n = Number(/^-?\d+,\d+$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function parsePwRows(rows: SheetRows): Row[] {
  const headerIndex = rows.slice(0, 5).findIndex((r) => r.some((v) => norm(v) === "netprice"));
  if (headerIndex === -1) throw new ApiError(`Không tìm thấy dòng tiêu đề có cột "NetPrice" trong tab ĐẦU VÀO FBM PW.`, 400);
  const columns = rows[headerIndex].map((h) => PW_HEADERS.get(norm(h)) ?? null);
  for (const field of PW_HEADERS.values()) {
    if (!columns.includes(field)) {
      throw new ApiError(`Tab ĐẦU VÀO FBM PW thiếu cột "${[...PW_HEADERS].find(([, f]) => f === field)![0]}".`, 400);
    }
  }
  const out: Row[] = [];
  for (const [offset, row] of rows.slice(headerIndex + 1).entries()) {
    const item: Row = { _row: headerIndex + offset + 2 };
    columns.forEach((field, i) => {
      if (!field || item[field] != null) return;
      item[field] = field === "net_price" ? pwPrice(row[i]) : rawText(row[i]);
    });
    const rawPrice = row[columns.indexOf("net_price")];
    if (item.net_price == null && rawText(rawPrice)) item._bad_price = rawText(rawPrice);
    if (item.order_id == null && item.pw_order_id == null && item.order_name == null && item.net_price == null && !item._bad_price) continue;
    out.push(item);
  }
  return out;
}

function pickTab(type: SheetType) {
  return (titles: string[]) => {
    if (type === "fbm_pw") return titles.find((t) => norm(t) === "dau vao fbm pw") ?? null;
    // Bảng Mã FBM chỉ nhận tab FBM ("FBM_<Store>" / "BẢNG MÃ FBM"), không lùi về tab BẢNG MÃ của FBA
    // để dán nhầm link file FBA vào ô FBM không ghi bảng mã FBA vào bảng FBM.
    if (type === "sku_fbm") {
      return titles.find((t) => {
        const n = norm(t);
        return n.startsWith("fbm_") || n.startsWith("fbm ") || n === "fbm" || n === "bang ma fbm";
      }) ?? null;
    }
    const wanted = type === "sku" ? ["bang ma", "sku master"] : ["chi tiet di hang", "inbound shipments"];
    for (const w of wanted) {
      const hit = titles.find((t) => norm(t) === w);
      if (hit) return hit;
    }
    return null;
  };
}

async function readSheet(url: string, type: SheetType) {
  const sheet = await readSpreadsheetTab(url, pickTab(type));
  const records =
    type === "inbound"
      ? parseInboundRows(sheet.rows)
      : type === "sku"
      ? parseFbaSkuRows(sheet.rows)
      : type === "fbm_pw"
      ? parsePwRows(sheet.rows)
      : (parseFbmSkuRows(sheet.rows) as unknown as Row[]).map((r) => ({ ...r, sku: skuText(r.sku) ?? String(r.sku) }));
  if (records.length === 0) {
    throw new ApiError(
      `Tab "${sheet.tabTitle}" không có dòng dữ liệu hợp lệ nào${type === "fbm_pw" ? "" : " (cần có SKU)"}.`,
      400,
    );
  }
  return { ...sheet, records };
}

// ----------------- Ghi DB -----------------

class DryRunRollback extends Error {}

/** Sheet thiếu quá nhiều dòng so với web: dừng để không xóa hàng loạt (bỏ qua bằng force). */
class DeleteGuardError extends ApiError {}

/** Số chữ số thập phân của từng cột NUMERIC để so sánh đúng với giá trị đã lưu. */
async function numericScales(tx: Tx, table: string): Promise<Map<string, number>> {
  const rows = await tx<{ column_name: string; numeric_scale: number | null; data_type: string }[]>`
    SELECT column_name, numeric_scale, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
  `;
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.data_type === "numeric") map.set(r.column_name, r.numeric_scale ?? 6);
    else if (r.data_type === "integer" || r.data_type === "bigint") map.set(r.column_name, 0);
  }
  return map;
}

function sameValue(next: string | number | null, current: unknown, scale: number | undefined): boolean {
  if (scale !== undefined) {
    if (current == null) return next == null;
    if (next == null) return false;
    const factor = 10 ** scale;
    return Math.round(Number(next) * factor) === Math.round(Number(current) * factor);
  }
  return (next ?? null) === (current == null ? null : String(current));
}

function roundTo(value: string | number | null, scale: number | undefined) {
  if (value == null || scale === undefined) return value;
  const factor = 10 ** scale;
  return Math.round(Number(value) * factor) / factor;
}

async function lockOrFail(tx: Tx, storeId: string, type: SheetType) {
  const [{ locked }] = await tx<{ locked: boolean }[]>`
    SELECT pg_try_advisory_xact_lock(hashtext(${`inventory-sheet-sync:${storeId}:${type}`})) AS locked
  `;
  if (!locked) throw new ApiError(`${SHEET_TYPE_LABELS[type]} của store này đang được đồng bộ, vui lòng thử lại sau ít phút.`, 409);
}

async function writeSkuRecords(
  tx: Tx,
  storeId: string,
  channel: SkuChannel,
  records: Row[],
  actor: string,
  result: SheetSyncResult,
) {
  const table = skuMasterTable(channel);
  await lockOrFail(tx, storeId, channel === "fbm" ? "sku_fbm" : "sku");
  const scales = await numericScales(tx, table);
  const allowed = new Set([
    "brand", "product_type", "mockup", "asin", "fnsku", "amazon_fee", "referral_fee_pct", "pic_mkt", "loai",
    "niche", "pic_idea", "status", "event", "tinh_trang", "design_pic", "mockup_url", "thang_listing",
    "thang_danh_gia", "event_250th", "ngay_danh_gia_sku_event", "amazon_fba_fee_thay_doi", "basecost_tb",
    "brand_entity_id", "creative_asins_video", "creative_asins_collection", "video_media_ids",
    "creative_headline", "brand_logo_asset_id", "landing_page_url", ...skuExtraFields(channel),
  ]);

  // BẢNG MÃ FBM: cùng SKU khác ASIN là 2 sản phẩm → khóa SKU + ASIN; FBA vẫn khóa theo SKU.
  const keyOf = (sku: unknown, asin: unknown) => {
    const skuKey = String(sku).trim().toLowerCase();
    return channel === "fbm" ? `${skuKey}|${String(asin ?? "").trim().toLowerCase()}` : skuKey;
  };

  // Lớp 1: trùng khóa ngay trong sheet → giữ dòng sau cùng, báo lại số dòng.
  // BẢNG MÃ FBM: dòng OFF không thay dòng đang chạy (xem dedupeFbmSkuRows).
  const bySku = new Map<string, Row>();
  const dupRows = new Map<string, number[]>();
  for (const record of records) {
    const key = keyOf(record.sku, record.asin);
    const previous = bySku.get(key);
    if (previous) dupRows.set(key, [...(dupRows.get(key) ?? [Number(previous._row)]), Number(record._row)]);
    if (previous && channel === "fbm" && isOffSkuStatus(record.status) && !isOffSkuStatus(previous.status)) continue;
    bySku.set(key, record);
  }
  for (const [key, rowsOfKey] of dupRows) {
    result.duplicatesInSheet.push(`${bySku.get(key)!.sku} (dòng ${rowsOfKey.join(", ")})`);
  }

  // Lớp 2: khớp khóa đang có (kể cả đã xóa mềm) không phân biệt hoa/thường.
  const existing = await tx<Record<string, unknown>[]>`
    SELECT * FROM ${tx(table)} WHERE store_id = ${storeId}
  `;
  const existingByKey = new Map<string, Record<string, unknown>>();
  for (const row of existing) {
    const key = keyOf(row.sku, row.asin);
    const prev = existingByKey.get(key);
    if (!prev || (prev.deleted_at && !row.deleted_at)) existingByKey.set(key, row);
  }

  for (const [key, record] of bySku) {
    const fields = Object.fromEntries(
      Object.entries(record).filter(([field, value]) => allowed.has(field) && value != null),
    ) as Row;
    const current = existingByKey.get(key);
    if (!current) {
      const values: Row = { store_id: storeId, sku: record.sku, ...fields };
      for (const field of Object.keys(values)) values[field] = roundTo(values[field], scales.get(field));
      // Lớp 3: UNIQUE(store_id, sku) / FBM UNIQUE(store_id, sku, asin) — trùng thì không ghi đè dòng khác.
      await tx`
        INSERT INTO ${tx(table)} ${tx({ ...values, last_changed_by: actor } as Record<string, unknown>)}
        ON CONFLICT DO NOTHING
      `;
      result.inserted++;
      continue;
    }
    const changes: Row = {};
    for (const [field, value] of Object.entries(fields)) {
      if (!sameValue(value, current[field], scales.get(field))) changes[field] = roundTo(value, scales.get(field));
    }
    const wasDeleted = current.deleted_at != null;
    for (const field of Object.keys(changes)) result.changedFields[field] = (result.changedFields[field] ?? 0) + 1;
    if (Object.keys(changes).length === 0 && !wasDeleted) {
      result.unchanged++;
      continue;
    }
    // Helper object phải đứng ngay sau SET ở câu lệnh chính (postgres.js nhận dạng theo từ khóa đứng trước).
    if (Object.keys(changes).length) {
      await tx`
        UPDATE ${tx(table)} SET ${tx(changes as Record<string, unknown>)}
        WHERE id = ${current.id as string}
      `;
    }
    await tx`
      UPDATE ${tx(table)}
      SET deleted_at = NULL, last_changed_by = ${actor}, updated_at = NOW()
      WHERE id = ${current.id as string}
    `;
    if (wasDeleted) result.restored++;
    else result.updated++;
  }

  result.missingOnSheet = existing.filter(
    (row) => row.deleted_at == null && !bySku.has(keyOf(row.sku, row.asin)),
  ).length;
}

async function writeInboundRecords(
  tx: Tx,
  storeId: string,
  storeName: string,
  records: Row[],
  actor: string,
  result: SheetSyncResult,
  force = false,
) {
  await lockOrFail(tx, storeId, "inbound");
  const scales = await numericScales(tx, "accounting_inbound_shipments");

  const skuRows = await tx<{ id: string; sku: string; mockup: string | null; product_type: string | null }[]>`
    SELECT id, sku, COALESCE(mockup_url, mockup) AS mockup, product_type
    FROM accounting_sku_master WHERE store_id = ${storeId} AND deleted_at IS NULL
  `;
  const skuMeta = new Map(skuRows.map((r) => [r.sku.trim().toLowerCase(), r]));

  const existing = await tx<Record<string, unknown>[]>`
    SELECT * FROM accounting_inbound_shipments
    WHERE store_id = ${storeId} AND deleted_at IS NULL
    ORDER BY created_at ASC, id ASC
  `;
  const key = (...parts: unknown[]) => parts.map((p) => norm(p)).join("|");
  const index = { ship: new Map<string, string[]>(), lo: new Map<string, string[]>(), loose: new Map<string, string[]>() };
  const push = (map: Map<string, string[]>, k: string, id: string) => map.set(k, [...(map.get(k) ?? []), id]);
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of existing) {
    const id = row.id as string;
    byId.set(id, row);
    const sku = String(row.sku ?? "").replace(/\s+/g, "");
    if (text(row.shipment_id)) push(index.ship, key(sku, row.shipment_id), id);
    else if (text(row.ten_lo_hang)) push(index.lo, key(sku, row.ten_lo_hang), id);
    else push(index.loose, key(sku, row.ngay_request, row.quantity), id);
  }
  const used = new Set<string>();
  const take = (map: Map<string, string[]>, k: string) => {
    const id = (map.get(k) ?? []).find((candidate) => !used.has(candidate));
    if (id) used.add(id);
    return id;
  };

  // Lớp 1: cùng SKU + Shipment ID (hoặc SKU + Tên lô) chỉ được 1 dòng — đúng ràng buộc
  // uq_accounting_inbound_active_identity của DB. Trùng trong sheet → giữ dòng sau cùng, báo số dòng.
  const byIdentity = new Map<string, Row>();
  const dupRows = new Map<string, number[]>();
  const keyless: Row[] = [];
  for (const r of records) {
    const identity = r.shipment_id ? key(r.sku, r.shipment_id) : r.ten_lo_hang ? key(r.sku, "lot:", r.ten_lo_hang) : null;
    if (!identity) {
      keyless.push(r);
      continue;
    }
    const previous = byIdentity.get(identity);
    if (previous) dupRows.set(identity, [...(dupRows.get(identity) ?? [Number(previous._row)]), Number(r._row)]);
    byIdentity.set(identity, r);
  }
  for (const [identity, rowsOfKey] of dupRows) {
    const r = byIdentity.get(identity)!;
    result.duplicatesInSheet.push(`${r.sku} · ${r.shipment_id ?? r.ten_lo_hang} (dòng ${rowsOfKey.join(", ")})`);
  }
  records = [...byIdentity.values(), ...keyless];

  // Lớp 2: khớp dòng web theo thứ tự ưu tiên (mỗi dòng web chỉ khớp 1 lần).
  const matches = new Map<Row, string | undefined>();
  for (const r of records) {
    if (r.shipment_id) matches.set(r, take(index.ship, key(r.sku, r.shipment_id)));
  }
  for (const r of records) {
    if (matches.get(r)) continue;
    // Lô vừa được điền Shipment ID: kế thừa dòng nháp cùng Tên lô
    const id = r.ten_lo_hang ? take(index.lo, key(r.sku, r.ten_lo_hang)) : undefined;
    matches.set(r, id ?? take(index.loose, key(r.sku, r.ngay_request, r.quantity)));
  }

  const toDelete = existing.filter((row) => !used.has(row.id as string));
  const limit = Math.max(20, Math.ceil(existing.length * 0.2));
  if (toDelete.length > limit) {
    if (!force) throw new DeleteGuardError(
      `Dừng đồng bộ: sheet thiếu ${toDelete.length}/${existing.length} dòng đang có trên web (giới hạn an toàn ${limit}). ` +
        "Kiểm tra lại tab CHI TIẾT ĐI HÀNG (lọc, xóa nhầm, sai link?).",
      400,
    );
    result.warnings.push(`Đã bỏ qua giới hạn an toàn: xóa ${toDelete.length}/${existing.length} dòng không còn trên sheet.`);
  }

  const writable = [
    "brand", "sup", "ngay_request", "product_type", "mockup", "sku", "quantity", "line_ship",
    "base_cost_per_unit", "card", "tag", "shipping_fee", "hop_tui", "final_basecost", "total_basecost",
    "ngay_thanh_toan", "ten_lo_hang", "shipment_id", "ngay_di", "ngay_den", "amazon_received",
    "tinh_trang_hang_den_kho", "status", "so_luong_amazon_nhan", "discrepancy", "note", "trang_thai",
  ];

  for (const record of records) {
    const meta = skuMeta.get(String(record.sku).toLowerCase());
    const fields: Row = {};
    for (const field of writable) {
      if (record[field] != null) fields[field] = roundTo(record[field], scales.get(field));
    }
    const targetId = matches.get(record);
    if (!targetId) {
      const quantity = Number(record.quantity ?? 0);
      const received = (record.so_luong_amazon_nhan ?? record.amazon_received ?? 0) as number;
      const values: Record<string, unknown> = {
        store_id: storeId,
        sku_id: meta?.id ?? null,
        brand: storeName,
        product_type: meta?.product_type ?? null,
        mockup: meta?.mockup ?? null,
        status: "Working",
        tinh_trang_hang_den_kho: "Working",
        trang_thai: "Phát triển",
        discrepancy: quantity - Number(received),
        ...fields,
        last_changed_by: actor,
      };
      await tx`INSERT INTO accounting_inbound_shipments ${tx(values)}`;
      result.inserted++;
      continue;
    }
    const current = byId.get(targetId)!;
    const changes: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(fields)) {
      if (!sameValue(value, current[field], scales.get(field))) changes[field] = value;
    }
    if (meta?.id && current.sku_id !== meta.id) changes.sku_id = meta.id;
    if (!current.mockup && meta?.mockup && fields.mockup == null) changes.mockup = meta.mockup;
    for (const field of Object.keys(changes)) result.changedFields[field] = (result.changedFields[field] ?? 0) + 1;
    if (Object.keys(changes).length === 0) {
      result.unchanged++;
      continue;
    }
    await tx`
      UPDATE accounting_inbound_shipments
      SET ${tx(changes)}, last_changed_by = ${actor}, updated_at = NOW()
      WHERE id = ${targetId}
    `;
    result.updated++;
  }

  for (const row of toDelete) {
    await tx`
      UPDATE accounting_inbound_shipments
      SET deleted_at = NOW(), last_changed_by = ${actor}, updated_at = NOW()
      WHERE id = ${row.id as string} AND deleted_at IS NULL
    `;
    result.deleted++;
  }
}

/**
 * ĐẦU VÀO FBM PW: thay toàn bộ dòng của store bằng đúng các dòng trên sheet (giữ thứ tự, giữ dòng trùng).
 * Thêm/xóa đếm theo so khớp từng dòng (đa tập) giữa web và sheet; sheet thiếu nhiều dòng thì dừng như Đi Hàng.
 */
async function writePwRecords(tx: Tx, storeId: string, records: Row[], result: SheetSyncResult, force = false) {
  await lockOrFail(tx, storeId, "fbm_pw");
  const lineKey = (r: Partial<Record<"order_id" | "pw_order_id" | "order_name" | "net_price", string | number | null>>) =>
    JSON.stringify([r.order_id ?? null, r.pw_order_id ?? null, r.order_name ?? null, r.net_price == null ? null : Number(r.net_price).toFixed(4)]);

  const existing = await tx<{ order_id: string | null; pw_order_id: string | null; order_name: string | null; net_price: string | null }[]>`
    SELECT order_id, pw_order_id, order_name, net_price::text FROM accounting_fbm_pw_costs
    WHERE store_id = ${storeId} ORDER BY row_no
  `;
  const pool = new Map<string, number>();
  for (const row of existing) {
    const k = lineKey(row);
    pool.set(k, (pool.get(k) ?? 0) + 1);
  }
  for (const r of records) {
    const k = lineKey(r);
    const left = pool.get(k) ?? 0;
    if (left > 0) {
      pool.set(k, left - 1);
      result.unchanged++;
    } else {
      result.inserted++;
    }
  }
  result.deleted = [...pool.values()].reduce((sum, n) => sum + n, 0);

  const limit = Math.max(20, Math.ceil(existing.length * 0.2));
  if (result.deleted > limit) {
    if (!force) throw new DeleteGuardError(
      `Dừng đồng bộ: sheet thiếu ${result.deleted}/${existing.length} dòng đang có trên web (giới hạn an toàn ${limit}). ` +
        "Kiểm tra lại tab ĐẦU VÀO FBM PW (lọc, xóa nhầm, sai link?).",
      400,
    );
    result.warnings.push(`Đã bỏ qua giới hạn an toàn: xóa ${result.deleted}/${existing.length} dòng không còn trên sheet.`);
  }

  const badPrices = records.filter((r) => r._bad_price != null);
  if (badPrices.length) {
    result.warnings.push(
      `${badPrices.length} dòng NetPrice không phải số (để trống), ví dụ dòng ${badPrices.slice(0, 3).map((r) => `${r._row} "${r._bad_price}"`).join(", ")}.`,
    );
  }

  // Không đổi gì (kể cả thứ tự) thì không ghi lại
  const sameOrder = existing.length === records.length && existing.every((row, i) => lineKey(row) === lineKey(records[i]));
  if (sameOrder) return;

  await tx`DELETE FROM accounting_fbm_pw_costs WHERE store_id = ${storeId}`;
  const values = records.map((r, i) => ({
    store_id: storeId,
    row_no: i + 1,
    order_id: r.order_id ?? null,
    pw_order_id: r.pw_order_id ?? null,
    order_name: r.order_name ?? null,
    net_price: r.net_price ?? null,
  }));
  for (let i = 0; i < values.length; i += 5000) {
    await tx`INSERT INTO accounting_fbm_pw_costs ${tx(values.slice(i, i + 5000))}`;
  }
}

/** Đọc sheet và ghi vào DB cho 1 store + 1 loại sheet. dryRun: chạy thật trong transaction rồi rollback. */
export async function syncSheetToDatabase(
  storeId: string,
  type: SheetType,
  url: string,
  actor: string,
  options: {
    dryRun?: boolean;
    /** Chỉ dùng khi chạy thử: ghi lần 2 ngay trong transaction, lần 2 phải không đổi gì. */
    verifyIdempotent?: boolean;
    preloaded?: Awaited<ReturnType<typeof readSheet>>;
    /** Bỏ qua giới hạn an toàn xóa hàng loạt (người dùng đã xác nhận sheet đúng). */
    force?: boolean;
  } = {},
): Promise<SheetSyncResult & { secondPass?: Pick<SheetSyncResult, "inserted" | "updated" | "restored" | "deleted"> }> {
  const store = await getStoreById(storeId);
  if (!store) throw new ApiError("Không tìm thấy Store.", 404);
  const sheet = options.preloaded ?? (await readSheet(url, type));

  const result: SheetSyncResult & { secondPass?: Pick<SheetSyncResult, "inserted" | "updated" | "restored" | "deleted"> } = {
    spreadsheetTitle: sheet.spreadsheetTitle,
    tabTitle: sheet.tabTitle,
    sheetRows: sheet.records.length,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    restored: 0,
    deleted: 0,
    missingOnSheet: 0,
    changedFields: {},
    duplicatesInSheet: [],
    warnings: [],
    dryRun: Boolean(options.dryRun),
  };

  const sql = await getDatabaseClient();
  try {
    await sql.begin(async (tx) => {
      const write = (target: SheetSyncResult) =>
        type === "inbound"
          ? writeInboundRecords(tx, storeId, store.name, sheet.records, actor, target, options.force)
          : type === "fbm_pw"
          ? writePwRecords(tx, storeId, sheet.records, target, options.force)
          : writeSkuRecords(tx, storeId, type === "sku_fbm" ? "fbm" : "fba", sheet.records, actor, target);
      await write(result);
      if (options.dryRun && options.verifyIdempotent) {
        const second = { ...result, inserted: 0, updated: 0, unchanged: 0, restored: 0, deleted: 0, changedFields: {}, duplicatesInSheet: [], warnings: [] };
        await write(second);
        result.secondPass = { inserted: second.inserted, updated: second.updated, restored: second.restored, deleted: second.deleted };
      }
      if (options.dryRun) throw new DryRunRollback();
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }

  if (result.duplicatesInSheet.length) {
    result.warnings.push(`${result.duplicatesInSheet.length} dòng trùng trong sheet (giữ dòng sau cùng).`);
  }
  if (result.missingOnSheet) {
    result.warnings.push(`${result.missingOnSheet} SKU trên web không có trong sheet (không tự xóa).`);
  }
  if (type === "inbound" && !options.dryRun) {
    // Cập nhật số lượng nhận / trạng thái từ Check Shipment như khi import file
    await syncCheckShipmentsToInbound(storeId, undefined, actor).catch(() => {});
  }
  return result;
}

// ----------------- Link theo store -----------------

export function isLinkType(value: unknown): value is LinkType {
  return typeof value === "string" && (LINK_TYPES as string[]).includes(value);
}

export function isSheetType(value: unknown): value is SheetType {
  return typeof value === "string" && (SHEET_TYPES as string[]).includes(value);
}

const LINK_COLUMNS = (sql: Awaited<ReturnType<typeof getDatabaseClient>>) => sql`
  id, store_id, link_type, sheet_url, spreadsheet_title, last_synced_at::text,
  last_status, last_error, last_result, updated_by, updated_at::text
`;

export async function listSheetLinks(): Promise<SheetLink[]> {
  const sql = await getDatabaseClient();
  return sql<SheetLink[]>`SELECT ${LINK_COLUMNS(sql)} FROM inventory_sheet_links ORDER BY store_id, link_type`;
}

async function getSheetLink(storeId: string, linkType: LinkType): Promise<SheetLink | null> {
  const sql = await getDatabaseClient();
  const rows = await sql<SheetLink[]>`
    SELECT ${LINK_COLUMNS(sql)} FROM inventory_sheet_links WHERE store_id = ${storeId} AND link_type = ${linkType}
  `;
  return rows[0] ?? null;
}

/** Ghi nhật ký 1 phần + gộp kết quả phần đó vào link (khóa dòng link để 2 phần ghi song song không đè nhau). */
async function recordPart(
  link: { id: string; store_id: string },
  part: SheetType,
  trigger: SyncTrigger,
  actor: string,
  startedAt: Date,
  outcome: SheetPartOutcome,
) {
  const sql = await getDatabaseClient();
  await sql`
    INSERT INTO inventory_sheet_sync_runs (link_id, store_id, sheet_type, trigger, status, result, error, triggered_by, started_at, finished_at)
    VALUES (${link.id}, ${link.store_id}, ${part}, ${trigger}, ${outcome.ok ? "success" : "error"},
      ${outcome.result ? sql.json(outcome.result as never) : null}, ${outcome.error ?? null}, ${actor}, ${startedAt}, NOW())
  `;
  await sql.begin(async (tx) => {
    const [row] = await tx<{ last_result: SheetLink["last_result"] }[]>`
      SELECT last_result FROM inventory_sheet_links WHERE id = ${link.id} FOR UPDATE
    `;
    if (!row) return;
    const parts = { ...(row.last_result?.parts ?? {}), [part]: outcome };
    const failed = Object.entries(parts).filter(([, p]) => p && !p.ok);
    await tx`
      UPDATE inventory_sheet_links SET
        last_synced_at = NOW(),
        last_status = ${failed.length ? "error" : "success"},
        last_error = ${failed.length ? failed.map(([name, p]) => `${SHEET_TYPE_LABELS[name as SheetType]}: ${p!.error}`).join(" | ") : null},
        last_result = ${tx.json({ parts } as never)}
      WHERE id = ${link.id}
    `;
  });
}

type Preloaded = Awaited<ReturnType<typeof readSheet>>;

// Lớp khóa trong tiến trình: cùng store + phần chỉ chạy 1 lần tại 1 thời điểm (DB còn khóa advisory).
const inFlight = new Set<string>();

async function runPart(
  link: { id: string; store_id: string; sheet_url: string },
  part: SheetType,
  trigger: SyncTrigger,
  actor: string,
  preloaded?: Preloaded,
  force = false,
): Promise<SheetPartOutcome> {
  const flightKey = `${link.store_id}:${part}`;
  const startedAt = new Date();
  if (inFlight.has(flightKey)) {
    return { ok: false, at: startedAt.toISOString(), trigger, error: `${SHEET_TYPE_LABELS[part]} đang được đồng bộ, thử lại sau ít phút.` };
  }
  inFlight.add(flightKey);
  let outcome: SheetPartOutcome;
  try {
    const result = await syncSheetToDatabase(link.store_id, part, link.sheet_url, `google-sheet:${trigger}${force ? ":force" : ""}:${actor}`, { preloaded, force });
    outcome = { ok: true, at: new Date().toISOString(), trigger, tabTitle: result.tabTitle, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Bị khóa vì tiến trình khác đang đồng bộ cùng phần: không đè trạng thái, lần chạy kia tự ghi kết quả
    if (error instanceof ApiError && error.status === 409) {
      return { ok: false, at: new Date().toISOString(), trigger, error: message };
    }
    console.error(`[InventorySheetSync] ${link.store_id}/${part} (${trigger}) lỗi:`, message);
    outcome = { ok: false, at: new Date().toISOString(), trigger, error: message, ...(error instanceof DeleteGuardError && { blocked: true }) };
  } finally {
    inFlight.delete(flightKey);
  }
  await recordPart(link, part, trigger, actor, startedAt, outcome).catch((error) =>
    console.error("[InventorySheetSync] Không ghi được nhật ký:", error),
  );
  return outcome;
}

export type LinkSyncOutcome = { ok: boolean; parts: Partial<Record<SheetType, SheetPartOutcome>>; error?: string };

async function runLink(
  link: { id: string; store_id: string; link_type: LinkType; sheet_url: string },
  parts: SheetType[],
  trigger: SyncTrigger,
  actor: string,
  preloaded: Partial<Record<SheetType, Preloaded>> = {},
  force = false,
): Promise<LinkSyncOutcome> {
  const results: Partial<Record<SheetType, SheetPartOutcome>> = {};
  // Bảng mã chạy trước để Chi tiết đi hàng gắn đúng SKU
  for (const part of parts) results[part] = await runPart(link, part, trigger, actor, preloaded[part], force);
  const errors = parts.filter((p) => !results[p]!.ok).map((p) => `${SHEET_TYPE_LABELS[p]}: ${results[p]!.error}`);
  return { ok: errors.length === 0, parts: results, error: errors.length ? errors.join(" | ") : undefined };
}

/** Lưu link (kiểm tra quyền + đủ tab + cột của MỌI phần trước khi lưu) rồi đồng bộ ngay. */
export async function saveSheetLink(storeId: string, linkType: LinkType, url: string, actor: string) {
  const store = await getStoreById(storeId);
  if (!store) throw new ApiError("Không tìm thấy Store.", 404);
  if ((linkType === "fbm" || linkType === "fbm_accounting") && !storeHasTeam(store.team, "FBM")) {
    throw new ApiError(`Store ${store.name} không có team FBM nên không có ${LINK_TYPE_LABELS[linkType]}.`, 400);
  }
  if (linkType === "inventory" && !storeHasFbaTeam(store.team)) {
    throw new ApiError(`Store ${store.name} không có team FBA nên không có file INVENTORY.`, 400);
  }
  const spreadsheetId = parseSpreadsheetId(url);
  if (!spreadsheetId) throw new ApiError("Link không phải Google Sheet hợp lệ (cần dạng docs.google.com/spreadsheets/d/...).", 400);

  // Lỗi link / quyền / thiếu tab / thiếu cột báo ngay, không lưu link hỏng
  const preloaded: Partial<Record<SheetType, Preloaded>> = {};
  for (const part of LINK_PARTS[linkType]) {
    try {
      preloaded[part] = await readSheet(url, part);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ApiError(`${SHEET_TYPE_LABELS[part]}: ${message}`, error instanceof ApiError ? error.status : 400);
    }
  }
  const spreadsheetTitle = Object.values(preloaded)[0]?.spreadsheetTitle ?? null;

  const sql = await getDatabaseClient();
  const [link] = await sql<{ id: string }[]>`
    INSERT INTO inventory_sheet_links (store_id, link_type, sheet_url, spreadsheet_id, spreadsheet_title, updated_by)
    VALUES (${storeId}, ${linkType}, ${url.trim()}, ${spreadsheetId}, ${spreadsheetTitle}, ${actor})
    ON CONFLICT (store_id, link_type) DO UPDATE SET
      sheet_url = EXCLUDED.sheet_url, spreadsheet_id = EXCLUDED.spreadsheet_id,
      spreadsheet_title = EXCLUDED.spreadsheet_title, updated_by = EXCLUDED.updated_by,
      last_result = CASE WHEN inventory_sheet_links.spreadsheet_id = EXCLUDED.spreadsheet_id
        THEN inventory_sheet_links.last_result ELSE NULL END,
      updated_at = NOW()
    RETURNING id
  `;
  return runLink(
    { id: link.id, store_id: storeId, link_type: linkType, sheet_url: url.trim() },
    LINK_PARTS[linkType],
    "link_saved",
    actor,
    preloaded,
  );
}

export async function deleteSheetLink(storeId: string, linkType: LinkType) {
  const sql = await getDatabaseClient();
  const res = await sql`DELETE FROM inventory_sheet_links WHERE store_id = ${storeId} AND link_type = ${linkType}`;
  return res.count > 0;
}

/**
 * Đồng bộ ngay theo link đã lưu. part: chỉ 1 tab (nút tải lại của tab đó); không truyền part: cả file.
 * force: bỏ qua giới hạn an toàn xóa hàng loạt (nút "Vẫn đồng bộ" sau khi bị chặn).
 */
export async function syncStoreLink(
  storeId: string,
  target: { linkType: LinkType; part?: SheetType },
  trigger: SyncTrigger,
  actor: string,
  force = false,
): Promise<LinkSyncOutcome & { skipped?: boolean }> {
  const link = await getSheetLink(storeId, target.linkType);
  if (!link) return { ok: false, skipped: true, parts: {}, error: "Chưa lưu link Google Sheet cho store này." };
  return runLink(link, target.part ? [target.part] : LINK_PARTS[link.link_type], trigger, actor, {}, force);
}

/** Đồng bộ tất cả link (lịch hằng ngày). Link vừa đồng bộ thành công gần đây thì bỏ qua. */
export async function syncAllSheetLinks(trigger: SyncTrigger, actor = "system", options: { skipRecentMinutes?: number } = {}) {
  const recentAfter = Date.now() - (options.skipRecentMinutes ?? 0) * 60_000;
  const links = (await listSheetLinks())
    .filter((link) => !(link.last_status === "success" && link.last_synced_at && Date.parse(link.last_synced_at) > recentAfter))
    // File INVENTORY (bảng mã FBA) trước, Bảng Mã FBM sau, Kế Toán Tổng Hợp FBM cuối
    .sort((a, b) => LINK_TYPES.indexOf(a.link_type) - LINK_TYPES.indexOf(b.link_type));
  const summary: { store_id: string; link_type: LinkType; ok: boolean; error?: string }[] = [];
  for (const link of links) {
    const outcome = await runLink(link, LINK_PARTS[link.link_type], trigger, actor);
    summary.push({ store_id: link.store_id, link_type: link.link_type, ok: outcome.ok, error: outcome.error });
  }
  return summary;
}

export { getServiceAccountEmail };
