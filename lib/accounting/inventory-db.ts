import "server-only";

import { getDatabaseClient } from "@/lib/db";
import ExcelJS from "exceljs";
import { parseCsv } from "@/lib/csv";
import { ApiError } from "@/lib/api-guard";

export interface SkuMasterItem {
  id: string;
  store_id: string;
  brand: string | null;
  product_type: string | null;
  mockup: string | null;
  sku: string;
  asin: string | null;
  fnsku: string | null;
  amazon_fee: number | null;
  referral_fee_pct: number | null;
  pic_mkt: string | null;
  loai: string | null;
  niche: string | null;
  pic_idea: string | null;
  status: string | null;
  event: string | null;
  tinh_trang: string | null;
  design_pic: string | null;
  mockup_url: string | null;
  thang_listing: string | null;
  thang_danh_gia: string | null;
  event_250th: string | null;
  ngay_danh_gia_sku_event: string | null;
  amazon_fba_fee_thay_doi: number | null;
  basecost_tb: number | null;
  brand_entity_id: string | null;
  creative_asins_video: string | null;
  creative_asins_collection: string | null;
  video_media_ids: string | null;
  creative_headline: string | null;
  brand_logo_asset_id: string | null;
  landing_page_url: string | null;
  custom_fields?: Record<string, any> | null;
  row_order?: number | null;
  // Chỉ có ở BẢNG MÃ FBA
  kich_thuoc?: string | null;
  file_design?: string | null;
  /** Tồn kho Amazon = In Transit Between Warehouses + Ending Warehouse Balance (từ Inventory Ledger mới nhất). */
  ton_kho?: number | null;
  in_transit_between_warehouses?: number | null;
  ending_warehouse_balance?: number | null;
  ton_kho_updated_at?: string | null;
  // Chỉ có ở BẢNG MÃ FBM (accounting_sku_master_fbm)
  sup?: string | null;
  size?: string | null;
  basecost?: number | null;
  shipping_fee?: number | null;
  add_shipping_fee?: number | null;
  total_cost?: number | null;
  ngay_len_camp?: string | null;
  phan_loai_kich_thuoc?: string | null;
  created_at: string;
  updated_at: string;
}

export interface InboundShipmentItem {
  id: string;
  store_id: string;
  sku_id: string | null;
  brand: string | null;
  sup: string | null;
  ngay_request: string | null;
  product_type: string | null;
  mockup: string | null;
  sku: string;
  quantity: number;
  line_ship: string | null;
  base_cost_per_unit: number | null;
  card: number | null;
  tag: number | null;
  shipping_fee: number | null;
  hop_tui: number | null;
  final_basecost: number | null;
  total_basecost: number | null;
  ngay_thanh_toan: string | null;
  ten_lo_hang: string | null;
  shipment_id: string | null;
  ngay_di: string | null;
  ngay_den: string | null;
  amazon_received: number | null;
  tinh_trang_hang_den_kho: string | null;
  status: string | null;
  so_luong_amazon_nhan: number | null;
  discrepancy: number | null;
  note: string | null;
  trang_thai: string | null;
  custom_fields?: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

export interface CheckShipmentItem {
  id: string;
  store_id: string;
  ngay_update: string | null;
  brand: string | null;
  shipment_name: string | null;
  shipment_id: string;
  created_date: string | null;
  last_updated_date: string | null;
  ship_to: string | null;
  skus_count: number | null;
  units_expected: number | null;
  units_located: number | null;
  discrepancy: number | null;
  status: string | null;
  custom_fields?: Record<string, any> | null;
  deleted_at?: string | null;
  last_changed_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountingMonthlyBaseCostItem {
  id: string;
  store_id: string;
  period: string; // YYYY-MM
  sku: string;
  sku_id?: string | null;
  brand?: string | null;
  product_type?: string | null;
  sl_ton_dau_ky: number;
  basecost_dau_ky: number;
  gtri_ton_dau_ky: number;
  sl_nhap: number;
  gtri_nhap: number;
  don_gia_nhap_tb: number;
  tong_sl_kha_dung: number;
  tong_gtri_kha_dung: number;
  basecost_thang: number;
  calculation_rule: "weighted_average" | "new_inbound_only" | "carry_over" | "existing_inventory";
  is_overridden: boolean;
  note?: string | null;
  custom_fields?: Record<string, unknown>;
  row_order?: number;
  deleted_at?: string | null;
  last_changed_by?: string | null;
  created_at: string;
  updated_at: string;
}

/** BẢNG MÃ FBA dùng accounting_sku_master; store có team FBM có thêm BẢNG MÃ FBM tách bảng riêng. */
export type SkuChannel = "fba" | "fbm";

export function skuMasterTable(channel: SkuChannel = "fba") {
  return channel === "fbm" ? "accounting_sku_master_fbm" : "accounting_sku_master";
}

export function parseSkuChannel(value: unknown): SkuChannel {
  return value === "fbm" ? "fbm" : "fba";
}

/** Cột chỉ có ở BẢNG MÃ FBM (total_cost là cột tính, không ghi trực tiếp). */
export const FBM_SKU_EXTRA_FIELDS = [
  "sup", "size", "basecost", "shipping_fee", "add_shipping_fee", "ngay_len_camp", "phan_loai_kich_thuoc",
] as const;
const FBM_SKU_NUMERIC_FIELDS = ["basecost", "shipping_fee", "add_shipping_fee"];
/** Cột chỉ có ở BẢNG MÃ FBA (theo sheet BẢNG MÃ của các store). */
export const FBA_SKU_EXTRA_FIELDS = ["kich_thuoc", "phan_loai_kich_thuoc", "file_design"] as const;

export function skuExtraFields(channel: SkuChannel): readonly string[] {
  return channel === "fbm" ? FBM_SKU_EXTRA_FIELDS : FBA_SKU_EXTRA_FIELDS;
}

type Sql = Awaited<ReturnType<typeof getDatabaseClient>>;

function skuChannelSelect(sql: Sql, channel: SkuChannel) {
  return channel === "fbm"
    ? sql`, sup, size, basecost::float, shipping_fee::float, add_shipping_fee::float, total_cost::float, ngay_len_camp, phan_loai_kich_thuoc`
    : sql`, kich_thuoc, phan_loai_kich_thuoc, file_design, ton_kho::float, in_transit_between_warehouses::float,
        ending_warehouse_balance::float, ton_kho_updated_at::text`;
}

export type InventoryEntityType = "sku" | "sku_fbm" | "inbound" | "check_shipment" | "monthly_base_cost";

export interface InventoryHistoryItem {
  id: string;
  entity_type: InventoryEntityType;
  entity_id: string;
  store_id: string;
  action: "create" | "update" | "delete" | "restore";
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  changed_by: string;
  created_at: string;
}

export function isValidOptionValue(value: unknown): boolean {
  if (value == null) return false;
  const s = String(value).trim();
  return Boolean(
    s &&
    s !== "0" &&
    s !== "0.00" &&
    s !== "00" &&
    s !== "000" &&
    s !== "$0.00" &&
    s !== "—" &&
    s !== "-" &&
    s !== "null" &&
    s !== "undefined" &&
    s !== "#N/A"
  );
}

export function cleanDateOnly(val: unknown): string | null {
  if (val == null) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return val.toISOString().split("T")[0];
  }
  let s = String(val).trim();
  if (!s || s === "—" || s === "-" || s === "null" || s === "undefined") return null;

  // Handle Date strings like "Tue Aug 04 2026..." or "Fri Sep 25 2026 GM..."
  if (s.includes(" 202") || s.includes(" 201") || s.includes("GMT") || s.includes(" GM")) {
    const cleaned = s.replace(/\s+GM.*$/i, "").trim();
    const parsed = new Date(cleaned);
    if (!isNaN(parsed.getTime())) {
      try {
        const year = parsed.getFullYear();
        const month = String(parsed.getMonth() + 1).padStart(2, "0");
        const day = String(parsed.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
      } catch {}
    }
  }

  // If Excel serial number (e.g. 45865.95)
  if (!isNaN(Number(s)) && Number(s) > 30000 && Number(s) < 60000) {
    const date = new Date(Math.round((Number(s) - 25569) * 86400 * 1000));
    if (!isNaN(date.getTime())) {
      return date.toISOString().split("T")[0];
    }
  }

  if (s.includes("T")) s = s.split("T")[0].trim();
  if (s.includes(" 00:00:00")) s = s.split(" ")[0].trim();
  s = s.replace(/(\s+|T)?\d{2}:\d{2}:\d{2}(\.\d+)?Z?/i, "").trim();

  // YYYY-MM-DD
  const ymd = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
  }

  // DD/MM/YYYY
  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }

  return s || null;
}

export function cleanMonthOnly(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === "object") {
    if (val instanceof Date && !isNaN(val.getTime())) {
      try {
        return val.toISOString().split("T")[0].substring(0, 7);
      } catch {
        const year = val.getFullYear();
        const month = String(val.getMonth() + 1).padStart(2, "0");
        return `${year}-${month}`;
      }
    }
    return null;
  }
  let s = String(val).trim();
  if (
    !s ||
    s === "—" ||
    s === "-" ||
    s === "null" ||
    s === "undefined" ||
    s === "#N/A" ||
    s === "[object Object]"
  ) {
    return null;
  }
  if (/T\d{2}:\d{2}/i.test(s)) s = s.split(/[Tt]\d{2}:\d{2}/)[0].trim();
  if (s.includes(" 00:00:00")) s = s.split(" ")[0].trim();
  s = s.replace(/(\s+|T)?\d{2}:\d{2}:\d{2}(\.\d+)?Z?/i, "").trim();

  // YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/]\d{1,2}$/);
  if (ymdMatch) {
    return `${ymdMatch[1]}-${ymdMatch[2].padStart(2, "0")}`;
  }

  // YYYY-MM or YYYY/MM
  const ymMatch = s.match(/^(\d{4})[-/](\d{1,2})$/);
  if (ymMatch) {
    return `${ymMatch[1]}-${ymMatch[2].padStart(2, "0")}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = s.match(/^\d{1,2}[-/](\d{1,2})[-/](\d{4})$/);
  if (dmyMatch) {
    return `${dmyMatch[2]}-${dmyMatch[1].padStart(2, "0")}`;
  }

  // MM/YYYY or MM-YYYY or M/YYYY
  const myMatch = s.match(/^(\d{1,2})[-/](\d{4})$/);
  if (myMatch) {
    return `${myMatch[2]}-${myMatch[1].padStart(2, "0")}`;
  }

  // Text like "Tháng 05/2026", "T5/2026"
  const textMonthMatch = s.match(/(\d{1,2})\s*[/.-]\s*(\d{4})/);
  if (textMonthMatch) {
    return `${textMonthMatch[2]}-${textMonthMatch[1].padStart(2, "0")}`;
  }

  const parsed = Date.parse(s);
  if (!isNaN(parsed)) {
    try {
      const d = new Date(parsed);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    } catch {
      // ignore
    }
  }

  return s || null;
}

export interface InventoryFieldOptions {
  sku: Record<"product_type" | "pic_mkt" | "loai" | "niche" | "pic_idea" | "status" | "event" | "tinh_trang" | "design_pic", string[]>;
  inbound: Record<"product_type" | "sup" | "line_ship" | "status" | "trang_thai" | "tinh_trang_hang_den_kho", string[]>;
}

export interface InventoryFieldSetting {
  entity_type: "sku" | "inbound" | "check_shipment" | "orders";
  field_id: string;
  label: string;
  input_type: "text" | "select";
  options: string[];
  allow_custom_value: boolean;
}

export async function listInventoryFieldSettings(storeId: string): Promise<InventoryFieldSetting[]> {
  const sql = await getDatabaseClient();
  const rows = await sql<InventoryFieldSetting[]>`
    SELECT entity_type, field_id, label, input_type, options, allow_custom_value
    FROM accounting_inventory_field_settings WHERE store_id = ${storeId}
  `;
  return rows.map((row) => ({
    ...row,
    options: (Array.isArray(row.options)
      ? row.options
      : typeof row.options === "string"
        ? JSON.parse(row.options)
        : []
    ).filter(isValidOptionValue),
  }));
}

export async function saveInventoryFieldSetting(storeId: string, setting: InventoryFieldSetting) {
  const sql = await getDatabaseClient();
  const options = [...new Set(setting.options.map((value) => value.trim()).filter(isValidOptionValue))];
  await sql`
    INSERT INTO accounting_inventory_field_settings (store_id, entity_type, field_id, label, input_type, options, allow_custom_value)
    VALUES (${storeId}, ${setting.entity_type}, ${setting.field_id}, ${setting.label.trim()}, ${setting.input_type}, ${sql.json(options)}, ${setting.allow_custom_value})
    ON CONFLICT (store_id, entity_type, field_id) DO UPDATE SET
      label = EXCLUDED.label, input_type = EXCLUDED.input_type, options = EXCLUDED.options,
      allow_custom_value = EXCLUDED.allow_custom_value, updated_at = NOW()
  `;
}

/**
 * Returns every usable text value for the selected store.  This deliberately
 * does not depend on the paginated table query, so new forms can suggest
 * values that are only present on older records.
 */
export async function listInventoryFieldOptions(storeId: string): Promise<InventoryFieldOptions> {
  const sql = await getDatabaseClient();
  const skuFields = ["product_type", "pic_mkt", "loai", "niche", "pic_idea", "status", "event", "tinh_trang", "design_pic"] as const;
  const inboundFields = ["product_type", "sup", "line_ship", "status", "trang_thai", "tinh_trang_hang_den_kho"] as const;

  const getValues = async (table: "accounting_sku_master" | "accounting_inbound_shipments", field: string) => {
    const rows = await sql<{ value: string }[]>`
      SELECT DISTINCT BTRIM(${sql(field)}) AS value
      FROM ${sql(table)}
      WHERE store_id = ${storeId}
        AND deleted_at IS NULL
        AND ${sql(field)} IS NOT NULL
        AND BTRIM(${sql(field)}) <> ''
        AND BTRIM(${sql(field)}) <> '0'
        AND BTRIM(${sql(field)}) <> '0.00'
        AND BTRIM(${sql(field)}) <> '—'
        AND BTRIM(${sql(field)}) <> '-'
      ORDER BY value ASC
    `;
    return rows.map((row) => row.value).filter(isValidOptionValue);
  };

  // Lấy toàn bộ Product Type chuẩn từ product_cost_master để luôn có danh sách phôi hoàn chỉnh
  let masterProductTypes: string[] = [];
  try {
    const masterRows = await sql<{ value: string }[]>`
      SELECT DISTINCT BTRIM(product_type) AS value
      FROM product_cost_master
      WHERE product_type IS NOT NULL AND BTRIM(product_type) <> ''
      ORDER BY value ASC
    `;
    masterProductTypes = masterRows.map((r) => r.value);
  } catch {}

  const [skuEntries, inboundEntries] = await Promise.all([
    Promise.all(skuFields.map(async (field) => {
      const vals = await getValues("accounting_sku_master", field);
      if (field === "product_type") {
        const merged = [...new Set([...vals, ...masterProductTypes])].sort((a, b) => a.localeCompare(b));
        return [field, merged] as const;
      }
      return [field, vals] as const;
    })),
    Promise.all(inboundFields.map(async (field) => {
      const vals = await getValues("accounting_inbound_shipments", field);
      if (field === "product_type") {
        const merged = [...new Set([...vals, ...masterProductTypes])].sort((a, b) => a.localeCompare(b));
        return [field, merged] as const;
      }
      if (field === "status") {
        const defaults = ["Working", "In Transit", "Receiving", "Closed", "Cancelled", "Delivered"];
        const merged = [...new Set([...vals, ...defaults])];
        return [field, merged] as const;
      }
      if (field === "trang_thai") {
        const defaults = ["Phát triển", "Active", "Test", "Hủy", "Tạm dừng", "Đã updated", "Tối ưu"];
        const merged = [...new Set([...vals, ...defaults])];
        return [field, merged] as const;
      }
      return [field, vals] as const;
    })),
  ]);

  return {
    sku: Object.fromEntries(skuEntries) as InventoryFieldOptions["sku"],
    inbound: Object.fromEntries(inboundEntries) as InventoryFieldOptions["inbound"],
  };
}

export async function listSkuMaster(
  storeId: string,
  params: { search?: string; status?: string; productType?: string; cursor?: string; page?: number; limit?: number; channel?: SkuChannel } = {},
): Promise<{ items: SkuMasterItem[]; total: number; page: number; limit: number; nextCursor: string | null }> {
  const sql = await getDatabaseClient();
  const table = skuMasterTable(params.channel);
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(10000, Math.max(1, params.limit || 50));
  const offset = params.cursor ? 0 : (page - 1) * limit;

  let cursorCreatedAt: string | null = null;
  let cursorId: string | null = null;

  if (params.cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(params.cursor, "base64").toString("utf-8"));
      if (decoded.created_at && decoded.id) {
        cursorCreatedAt = decoded.created_at;
        cursorId = decoded.id;
      }
    } catch {
      // ignore invalid cursor
    }
  }

  const searchPattern = params.search ? `%${params.search.trim().toLowerCase()}%` : null;

  const countRows = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text as count
    FROM ${sql(table)}
    WHERE store_id = ${storeId}
      AND deleted_at IS NULL
      AND (${searchPattern}::text IS NULL OR (
        LOWER(sku) LIKE ${searchPattern}
        OR LOWER(COALESCE(asin, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(product_type, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(niche, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(pic_mkt, '')) LIKE ${searchPattern}
      ))
      AND (${params.status || null}::text IS NULL OR status = ${params.status || null})
      AND (${params.productType || null}::text IS NULL OR product_type = ${params.productType || null})
  `;

  const total = parseInt(countRows[0]?.count || "0", 10);

  const items = await sql<SkuMasterItem[]>`
    SELECT
      id,
      store_id,
      brand,
      product_type,
      mockup,
      sku,
      asin,
      fnsku,
      amazon_fee::float,
      referral_fee_pct::float,
      pic_mkt,
      loai,
      niche,
      pic_idea,
      status,
      event,
      tinh_trang,
      design_pic,
      mockup_url,
      thang_listing,
      thang_danh_gia,
      event_250th,
      ngay_danh_gia_sku_event,
      amazon_fba_fee_thay_doi::float,
      basecost_tb::float,
      brand_entity_id,
      creative_asins_video,
      creative_asins_collection,
      video_media_ids,
      creative_headline,
      brand_logo_asset_id,
      landing_page_url,
      custom_fields
      ${skuChannelSelect(sql, params.channel ?? "fba")},
      created_at::text,
      updated_at::text
    FROM ${sql(table)}
    WHERE store_id = ${storeId}
      AND deleted_at IS NULL
      AND (${searchPattern}::text IS NULL OR (
        LOWER(sku) LIKE ${searchPattern}
        OR LOWER(COALESCE(asin, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(product_type, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(niche, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(pic_mkt, '')) LIKE ${searchPattern}
      ))
      AND (${params.status || null}::text IS NULL OR status = ${params.status || null})
      AND (${params.productType || null}::text IS NULL OR product_type = ${params.productType || null})
      AND (${cursorCreatedAt}::timestamptz IS NULL OR (
        created_at < ${cursorCreatedAt}::timestamptz
        OR (created_at = ${cursorCreatedAt}::timestamptz AND id < ${cursorId}::uuid)
      ))
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  let nextCursor: string | null = null;
  if (items.length === limit) {
    const last = items[items.length - 1];
    nextCursor = Buffer.from(JSON.stringify({ created_at: last.created_at, id: last.id })).toString("base64");
  }

  return { items, total, page, limit, nextCursor };
}

export async function upsertSkuMasterItem(
  storeId: string,
  data: Partial<SkuMasterItem> & { sku: string },
  changedBy = "system",
  channel: SkuChannel = "fba",
): Promise<SkuMasterItem> {
  const sql = await getDatabaseClient();
  const fbm = channel === "fbm";
  const rows = await sql<SkuMasterItem[]>`
    INSERT INTO ${sql(skuMasterTable(channel))} AS t (
      store_id,
      brand,
      product_type,
      mockup,
      sku,
      asin,
      fnsku,
      amazon_fee,
      referral_fee_pct,
      pic_mkt,
      loai,
      niche,
      pic_idea,
      status,
      event,
      tinh_trang,
      design_pic,
      mockup_url,
      thang_listing,
      thang_danh_gia,
      event_250th,
      ngay_danh_gia_sku_event,
      amazon_fba_fee_thay_doi,
      basecost_tb,
      brand_entity_id,
      creative_asins_video,
      creative_asins_collection,
      video_media_ids,
      creative_headline,
      brand_logo_asset_id,
      landing_page_url,
      ${fbm
        ? sql`sup, size, basecost, shipping_fee, add_shipping_fee, ngay_len_camp, phan_loai_kich_thuoc,`
        : sql`kich_thuoc, phan_loai_kich_thuoc, file_design,`}
      last_changed_by,
      updated_at
    ) VALUES (
      ${storeId},
      ${data.brand ?? null},
      ${data.product_type ?? null},
      ${data.mockup ?? null},
      ${data.sku.trim()},
      ${data.asin ?? null},
      ${data.fnsku ?? null},
      ${data.amazon_fee ?? null},
      ${data.referral_fee_pct ?? null},
      ${data.pic_mkt ?? null},
      ${data.loai ?? null},
      ${data.niche ?? null},
      ${data.pic_idea ?? null},
      ${data.status ?? (fbm ? null : "Active")},
      ${data.event ?? null},
      ${data.tinh_trang ?? null},
      ${data.design_pic ?? null},
      ${data.mockup_url ?? null},
      ${cleanMonthOnly(data.thang_listing) ?? null},
      ${cleanMonthOnly(data.thang_danh_gia) ?? null},
      ${data.event_250th ?? null},
      ${data.ngay_danh_gia_sku_event ?? null},
      ${data.amazon_fba_fee_thay_doi ?? null},
      ${data.basecost_tb ?? null},
      ${data.brand_entity_id ?? null},
      ${data.creative_asins_video ?? null},
      ${data.creative_asins_collection ?? null},
      ${data.video_media_ids ?? null},
      ${data.creative_headline ?? null},
      ${data.brand_logo_asset_id ?? null},
      ${data.landing_page_url ?? null},
      ${fbm
        ? sql`${data.sup ?? null}, ${data.size ?? null}, ${data.basecost ?? null}, ${data.shipping_fee ?? null},
          ${data.add_shipping_fee ?? null}, ${cleanDateOnly(data.ngay_len_camp) ?? null}, ${data.phan_loai_kich_thuoc ?? null},`
        : sql`${data.kich_thuoc ?? null}, ${data.phan_loai_kich_thuoc ?? null}, ${data.file_design ?? null},`}
      ${changedBy},
      NOW()
    )
    ON CONFLICT (store_id, sku) DO UPDATE SET
      brand = EXCLUDED.brand,
      product_type = EXCLUDED.product_type,
      mockup = CASE 
        WHEN EXCLUDED.mockup IS NOT NULL AND EXCLUDED.mockup != '[object Object]' THEN EXCLUDED.mockup
        WHEN t.mockup = '[object Object]' THEN NULL
        ELSE t.mockup
      END,
      asin = COALESCE(EXCLUDED.asin, t.asin),
      fnsku = COALESCE(EXCLUDED.fnsku, t.fnsku),
      amazon_fee = COALESCE(EXCLUDED.amazon_fee, t.amazon_fee),
      referral_fee_pct = COALESCE(EXCLUDED.referral_fee_pct, t.referral_fee_pct),
      pic_mkt = COALESCE(EXCLUDED.pic_mkt, t.pic_mkt),
      loai = COALESCE(EXCLUDED.loai, t.loai),
      niche = COALESCE(EXCLUDED.niche, t.niche),
      pic_idea = COALESCE(EXCLUDED.pic_idea, t.pic_idea),
      status = COALESCE(EXCLUDED.status, t.status),
      event = COALESCE(EXCLUDED.event, t.event),
      tinh_trang = COALESCE(EXCLUDED.tinh_trang, t.tinh_trang),
      design_pic = COALESCE(EXCLUDED.design_pic, t.design_pic),
      mockup_url = CASE 
        WHEN EXCLUDED.mockup_url IS NOT NULL AND EXCLUDED.mockup_url != '[object Object]' THEN EXCLUDED.mockup_url
        WHEN t.mockup_url = '[object Object]' THEN NULL
        ELSE t.mockup_url
      END,
      thang_listing = COALESCE(EXCLUDED.thang_listing, t.thang_listing),
      thang_danh_gia = COALESCE(EXCLUDED.thang_danh_gia, t.thang_danh_gia),
      event_250th = COALESCE(EXCLUDED.event_250th, t.event_250th),
      ngay_danh_gia_sku_event = COALESCE(EXCLUDED.ngay_danh_gia_sku_event, t.ngay_danh_gia_sku_event),
      amazon_fba_fee_thay_doi = COALESCE(EXCLUDED.amazon_fba_fee_thay_doi, t.amazon_fba_fee_thay_doi),
      basecost_tb = COALESCE(EXCLUDED.basecost_tb, t.basecost_tb),
      brand_entity_id = COALESCE(EXCLUDED.brand_entity_id, t.brand_entity_id),
      creative_asins_video = COALESCE(EXCLUDED.creative_asins_video, t.creative_asins_video),
      creative_asins_collection = COALESCE(EXCLUDED.creative_asins_collection, t.creative_asins_collection),
      video_media_ids = COALESCE(EXCLUDED.video_media_ids, t.video_media_ids),
      creative_headline = COALESCE(EXCLUDED.creative_headline, t.creative_headline),
      brand_logo_asset_id = COALESCE(EXCLUDED.brand_logo_asset_id, t.brand_logo_asset_id),
      landing_page_url = COALESCE(EXCLUDED.landing_page_url, t.landing_page_url),
      ${fbm
        ? sql`sup = COALESCE(EXCLUDED.sup, t.sup),
          size = COALESCE(EXCLUDED.size, t.size),
          basecost = COALESCE(EXCLUDED.basecost, t.basecost),
          shipping_fee = COALESCE(EXCLUDED.shipping_fee, t.shipping_fee),
          add_shipping_fee = COALESCE(EXCLUDED.add_shipping_fee, t.add_shipping_fee),
          ngay_len_camp = COALESCE(EXCLUDED.ngay_len_camp, t.ngay_len_camp),
          phan_loai_kich_thuoc = COALESCE(EXCLUDED.phan_loai_kich_thuoc, t.phan_loai_kich_thuoc),`
        : sql`kich_thuoc = COALESCE(EXCLUDED.kich_thuoc, t.kich_thuoc),
          phan_loai_kich_thuoc = COALESCE(EXCLUDED.phan_loai_kich_thuoc, t.phan_loai_kich_thuoc),
          file_design = COALESCE(EXCLUDED.file_design, t.file_design),`}
      deleted_at = NULL,
      last_changed_by = EXCLUDED.last_changed_by,
      updated_at = NOW()
    RETURNING
      id, store_id, brand, product_type, mockup, sku, asin, fnsku,
      amazon_fee::float, referral_fee_pct::float, pic_mkt, loai, niche,
      pic_idea, status, event, tinh_trang, design_pic, mockup_url,
      thang_listing, thang_danh_gia, event_250th, ngay_danh_gia_sku_event,
      amazon_fba_fee_thay_doi::float, basecost_tb::float, brand_entity_id,
      creative_asins_video, creative_asins_collection, video_media_ids,
      creative_headline, brand_logo_asset_id, landing_page_url,
      custom_fields
      ${skuChannelSelect(sql, channel)},
      created_at::text, updated_at::text
  `;
  return rows[0];
}

export async function deleteSkuMasterItem(
  id: string,
  storeId: string,
  changedBy = "system",
  channel: SkuChannel = "fba",
): Promise<boolean> {
  const sql = await getDatabaseClient();
  const res = await sql`
    UPDATE ${sql(skuMasterTable(channel))}
    SET deleted_at = NOW(), last_changed_by = ${changedBy}, updated_at = NOW()
    WHERE id = ${id} AND store_id = ${storeId} AND deleted_at IS NULL
  `;
  return res.count > 0;
}

export async function patchSkuMasterField(
  storeId: string,
  id: string,
  field: string,
  value: any,
  changedBy = "system",
  channel: SkuChannel = "fba",
): Promise<SkuMasterItem> {
  const sql = await getDatabaseClient();
  const table = skuMasterTable(channel);
  const trimmed = typeof value === "string" ? value.trim() : value;

  if (field.startsWith("custom_")) {
    const rows = await sql<SkuMasterItem[]>`
      UPDATE ${sql(table)}
      SET
        custom_fields = jsonb_set(COALESCE(custom_fields, '{}'::jsonb), ARRAY[${field}], to_jsonb(${trimmed === "" ? null : trimmed}::text)),
        last_changed_by = ${changedBy},
        updated_at = NOW()
      WHERE id = ${id} AND store_id = ${storeId}
      RETURNING
        id, store_id, brand, product_type, mockup, sku, asin, fnsku,
        amazon_fee::float, referral_fee_pct::float, pic_mkt, loai, niche,
        pic_idea, status, event, tinh_trang, design_pic, mockup_url,
        thang_listing, thang_danh_gia, event_250th, ngay_danh_gia_sku_event,
        amazon_fba_fee_thay_doi::float, basecost_tb::float, brand_entity_id,
        creative_asins_video, creative_asins_collection, video_media_ids,
        creative_headline, brand_logo_asset_id, landing_page_url,
        custom_fields ${skuChannelSelect(sql, channel)}, created_at::text, updated_at::text
    `;
    if (!rows[0]) throw new Error("Không tìm thấy SKU cần cập nhật.");
    return rows[0];
  }

  const monthFields = ["thang_listing", "thang_danh_gia"];
  const dateFields = ["event_250th", "ngay_danh_gia_sku_event", "ngay_len_camp"];
  const numFields = ["amazon_fee", "referral_fee_pct", "amazon_fba_fee_thay_doi", "basecost_tb", ...FBM_SKU_NUMERIC_FIELDS];
  const val = numFields.includes(field)
    ? trimmed === "" || trimmed == null ? null : parseFloat(trimmed)
    : monthFields.includes(field)
    ? cleanMonthOnly(trimmed)
    : dateFields.includes(field)
    ? cleanDateOnly(trimmed)
    : trimmed === "" || trimmed == null ? null : trimmed;

  const validFields = [
    "brand", "product_type", "mockup", "sku", "asin", "fnsku",
    "amazon_fee", "referral_fee_pct", "pic_mkt", "loai", "niche",
    "pic_idea", "status", "event", "tinh_trang", "design_pic", "mockup_url",
    "thang_listing", "thang_danh_gia", "event_250th", "ngay_danh_gia_sku_event",
    "amazon_fba_fee_thay_doi", "basecost_tb", "brand_entity_id",
    "creative_asins_video", "creative_asins_collection", "video_media_ids",
    "creative_headline", "brand_logo_asset_id", "landing_page_url",
    ...skuExtraFields(channel),
  ];
  if (!validFields.includes(field)) {
    throw new Error(`Trường '${field}' không hợp lệ.`);
  }

  const rows = await sql<SkuMasterItem[]>`
    UPDATE ${sql(table)}
    SET
      ${sql(field)} = ${val},
      last_changed_by = ${changedBy},
      updated_at = NOW()
    WHERE id = ${id} AND store_id = ${storeId}
    RETURNING
      id, store_id, brand, product_type, mockup, sku, asin, fnsku,
      amazon_fee::float, referral_fee_pct::float, pic_mkt, loai, niche,
      pic_idea, status, event, tinh_trang, design_pic, mockup_url,
      thang_listing, thang_danh_gia, event_250th, ngay_danh_gia_sku_event,
      amazon_fba_fee_thay_doi::float, basecost_tb::float, brand_entity_id,
      creative_asins_video, creative_asins_collection, video_media_ids,
      creative_headline, brand_logo_asset_id, landing_page_url,
      custom_fields ${skuChannelSelect(sql, channel)}, created_at::text, updated_at::text
  `;
  if (!rows[0]) throw new Error("Không tìm thấy SKU cần cập nhật.");
  return rows[0];
}

export async function listInboundShipments(
  storeId: string,
  params: {
    search?: string;
    status?: string;
    shipmentId?: string;
    cursor?: string;
    page?: number;
    limit?: number;
    sortField?: "created_at" | "updated_at" | "ngay_request" | "ngay_thanh_toan" | "ngay_di" | "ngay_den";
    sortDirection?: "asc" | "desc";
  } = {},
): Promise<{ items: InboundShipmentItem[]; total: number; page: number; limit: number; nextCursor: string | null }> {
  const sql = await getDatabaseClient();
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(10000, Math.max(1, params.limit || 50));
  const offset = params.cursor ? 0 : (page - 1) * limit;

  let cursorCreatedAt: string | null = null;
  let cursorId: string | null = null;

  if (params.cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(params.cursor, "base64").toString("utf-8"));
      if (decoded.created_at && decoded.id) {
        cursorCreatedAt = decoded.created_at;
        cursorId = decoded.id;
      }
    } catch {
      // ignore invalid cursor
    }
  }

  const searchPattern = params.search ? `%${params.search.trim().toLowerCase()}%` : null;
  const sortField = params.sortField || "created_at";
  const sortDirection = params.sortDirection === "asc" ? sql`ASC` : sql`DESC`;
  const sortExpression = sortField === "created_at"
    ? sql`s.created_at`
    : sortField === "updated_at"
    ? sql`s.updated_at`
    : sortField === "ngay_request"
    ? sql`CASE WHEN s.ngay_request ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN s.ngay_request::date END`
    : sortField === "ngay_thanh_toan"
    ? sql`CASE WHEN s.ngay_thanh_toan ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN s.ngay_thanh_toan::date END`
    : sortField === "ngay_di"
    ? sql`CASE WHEN s.ngay_di ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN s.ngay_di::date END`
    : sql`CASE WHEN s.ngay_den ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN s.ngay_den::date END`;

  const countRows = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text as count
    FROM accounting_inbound_shipments
    WHERE store_id = ${storeId}
      AND deleted_at IS NULL
      AND (${searchPattern}::text IS NULL OR (
        LOWER(sku) LIKE ${searchPattern}
        OR LOWER(COALESCE(shipment_id, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(ten_lo_hang, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(sup, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(product_type, '')) LIKE ${searchPattern}
      ))
      AND (${params.status || null}::text IS NULL OR status = ${params.status || null})
      AND (${params.shipmentId || null}::text IS NULL OR shipment_id = ${params.shipmentId || null})
  `;

  const total = parseInt(countRows[0]?.count || "0", 10);

  const items = await sql<InboundShipmentItem[]>`
    SELECT
      s.id,
      s.store_id,
      s.sku_id,
      s.brand,
      s.sup,
      s.ngay_request,
      s.product_type,
      COALESCE(s.mockup, m.mockup_url, m.mockup) as mockup,
      s.sku,
      s.quantity,
      s.line_ship,
      s.base_cost_per_unit::float,
      s.card::float,
      s.tag::float,
      s.shipping_fee::float,
      s.hop_tui::float,
      s.final_basecost::float,
      s.total_basecost::float,
      s.ngay_thanh_toan,
      s.ten_lo_hang,
      s.shipment_id,
      s.ngay_di,
      s.ngay_den,
      s.amazon_received,
      s.tinh_trang_hang_den_kho,
      s.status,
      s.so_luong_amazon_nhan,
      s.discrepancy,
      s.note,
      s.trang_thai,
      s.custom_fields,
      s.created_at::text,
      s.updated_at::text
    FROM accounting_inbound_shipments s
    LEFT JOIN accounting_sku_master m ON m.store_id = s.store_id AND m.sku = s.sku AND m.deleted_at IS NULL
    WHERE s.store_id = ${storeId}
      AND s.deleted_at IS NULL
      AND (${searchPattern}::text IS NULL OR (
        LOWER(s.sku) LIKE ${searchPattern}
        OR LOWER(COALESCE(s.shipment_id, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(s.ten_lo_hang, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(s.sup, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(s.product_type, '')) LIKE ${searchPattern}
      ))
      AND (${params.status || null}::text IS NULL OR s.status = ${params.status || null})
      AND (${params.shipmentId || null}::text IS NULL OR s.shipment_id = ${params.shipmentId || null})
      AND (${cursorCreatedAt}::timestamptz IS NULL OR ${sortField !== "created_at" || params.sortDirection === "asc"} OR (
        s.created_at < ${cursorCreatedAt}::timestamptz
        OR (s.created_at = ${cursorCreatedAt}::timestamptz AND s.id < ${cursorId}::uuid)
      ))
    ORDER BY ${sortExpression} ${sortDirection} NULLS LAST, s.created_at DESC, s.id DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  let nextCursor: string | null = null;
  if (items.length === limit) {
    const last = items[items.length - 1];
    nextCursor = Buffer.from(JSON.stringify({ created_at: last.created_at, id: last.id })).toString("base64");
  }

  return { items, total, page, limit, nextCursor };
}

export async function upsertInboundShipmentItem(
  storeId: string,
  data: Partial<InboundShipmentItem> & { sku: string; quantity: number },
  changedBy = "system",
): Promise<InboundShipmentItem> {
  const sql = await getDatabaseClient();

  const finalBaseCost =
    data.final_basecost ??
    ((data.base_cost_per_unit || 0) +
      (data.card || 0) +
      (data.tag || 0) +
      (data.shipping_fee || 0) +
      (data.hop_tui || 0));

  const totalBaseCost = data.total_basecost ?? finalBaseCost * (data.quantity || 0);
  const isStarShipment = Boolean(data.shipment_id?.trim().toLowerCase().startsWith("star"));
  const effectiveSoLuongAmazonNhan = isStarShipment
    ? (data.quantity || 0)
    : (data.so_luong_amazon_nhan ?? null);
  const discrepancy = isStarShipment
    ? 0
    : (data.discrepancy ??
      ((data.quantity || 0) - (effectiveSoLuongAmazonNhan ?? data.amazon_received ?? 0)));

  let resolvedSkuId = data.sku_id ?? null;
  if (!resolvedSkuId && data.sku?.trim()) {
    const skuRow = await sql<{ id: string }[]>`
      SELECT id FROM accounting_sku_master
      WHERE store_id = ${storeId} AND LOWER(sku) = LOWER(${data.sku.trim()}) AND deleted_at IS NULL
      LIMIT 1
    `;
    if (skuRow[0]?.id) resolvedSkuId = skuRow[0].id;
  }

  const cleanNgayRequest = cleanDateOnly(data.ngay_request);
  const cleanNgayThanhToan = cleanDateOnly(data.ngay_thanh_toan);
  const cleanNgayDi = cleanDateOnly(data.ngay_di);
  const cleanNgayDen = cleanDateOnly(data.ngay_den);

  let targetId = data.id || null;
  if (!targetId && data.sku?.trim()) {
    const cleanShipmentId = data.shipment_id?.trim() || "";
    const cleanTenLoHang = data.ten_lo_hang?.trim() || "";

    if (cleanShipmentId) {
      // 1. Kiểm tra đã có bản ghi cùng SKU + shipment_id hay chưa
      const existingShipment = await sql<{ id: string }[]>`
        SELECT id FROM accounting_inbound_shipments
        WHERE store_id = ${storeId}
          AND LOWER(TRIM(sku)) = LOWER(${data.sku.trim()})
          AND LOWER(TRIM(shipment_id)) = LOWER(${cleanShipmentId})
          AND deleted_at IS NULL
        LIMIT 1
      `;
      if (existingShipment[0]?.id) {
        targetId = existingShipment[0].id;
      } else if (cleanTenLoHang) {
        // 2. Nếu shipment_id mới được điền, tìm bản ghi nháp cũ (cùng tên lô hàng nhưng chưa có shipment_id) để kế thừa cập nhật, tránh sinh bản ghi trùng
        const draftRow = await sql<{ id: string }[]>`
          SELECT id FROM accounting_inbound_shipments
          WHERE store_id = ${storeId}
            AND LOWER(TRIM(sku)) = LOWER(${data.sku.trim()})
            AND LOWER(TRIM(COALESCE(ten_lo_hang, ''))) = LOWER(${cleanTenLoHang})
            AND (shipment_id IS NULL OR TRIM(shipment_id) = '')
            AND deleted_at IS NULL
          LIMIT 1
        `;
        if (draftRow[0]?.id) {
          targetId = draftRow[0].id;
        }
      }
    } else if (cleanTenLoHang) {
      // 3. Nếu chưa có shipment_id, tìm bản ghi nháp cùng tên lô hàng
      const draftRow = await sql<{ id: string }[]>`
        SELECT id FROM accounting_inbound_shipments
        WHERE store_id = ${storeId}
          AND LOWER(TRIM(sku)) = LOWER(${data.sku.trim()})
          AND LOWER(TRIM(COALESCE(ten_lo_hang, ''))) = LOWER(${cleanTenLoHang})
          AND (shipment_id IS NULL OR TRIM(shipment_id) = '')
          AND deleted_at IS NULL
        LIMIT 1
      `;
      if (draftRow[0]?.id) {
        targetId = draftRow[0].id;
      }
    }
  }

  if (targetId) {
    const rows = await sql<InboundShipmentItem[]>`
      UPDATE accounting_inbound_shipments
      SET
        sku_id = ${resolvedSkuId},
        brand = ${data.brand ?? null},
        sup = ${data.sup ?? null},
        ngay_request = ${cleanNgayRequest},
        product_type = ${data.product_type ?? null},
        mockup = ${data.mockup ?? null},
        sku = ${data.sku.trim()},
        quantity = ${data.quantity ?? 0},
        line_ship = ${data.line_ship ?? null},
        base_cost_per_unit = ${data.base_cost_per_unit ?? null},
        card = ${data.card ?? null},
        tag = ${data.tag ?? null},
        shipping_fee = ${data.shipping_fee ?? null},
        hop_tui = ${data.hop_tui ?? null},
        final_basecost = ${finalBaseCost || null},
        total_basecost = ${totalBaseCost || null},
        ngay_thanh_toan = ${cleanNgayThanhToan},
        ten_lo_hang = ${data.ten_lo_hang ?? null},
        shipment_id = ${data.shipment_id ?? null},
        ngay_di = ${cleanNgayDi},
        ngay_den = ${cleanNgayDen},
        amazon_received = ${data.amazon_received ?? null},
        tinh_trang_hang_den_kho = ${data.tinh_trang_hang_den_kho ?? null},
        status = ${data.status ?? null},
        so_luong_amazon_nhan = ${effectiveSoLuongAmazonNhan},
        discrepancy = ${discrepancy},
        note = ${data.note ?? null},
        trang_thai = ${data.trang_thai ?? null},
        last_changed_by = ${changedBy},
        updated_at = NOW()
      WHERE id = ${targetId} AND store_id = ${storeId}
      RETURNING
        id, store_id, sku_id, brand, sup, ngay_request, product_type, mockup,
        sku, quantity, line_ship, base_cost_per_unit::float, card::float,
        tag::float, shipping_fee::float, hop_tui::float, final_basecost::float,
        total_basecost::float, ngay_thanh_toan, ten_lo_hang, shipment_id,
        ngay_di, ngay_den, amazon_received, tinh_trang_hang_den_kho, status,
        so_luong_amazon_nhan, discrepancy, note, trang_thai,
        custom_fields,
        created_at::text, updated_at::text
    `;
    if (rows[0]) return rows[0];
  }

  const rows = await sql<InboundShipmentItem[]>`
    INSERT INTO accounting_inbound_shipments (
      store_id,
      sku_id,
      brand,
      sup,
      ngay_request,
      product_type,
      mockup,
      sku,
      quantity,
      line_ship,
      base_cost_per_unit,
      card,
      tag,
      shipping_fee,
      hop_tui,
      final_basecost,
      total_basecost,
      ngay_thanh_toan,
      ten_lo_hang,
      shipment_id,
      ngay_di,
      ngay_den,
      amazon_received,
      tinh_trang_hang_den_kho,
      status,
      so_luong_amazon_nhan,
      discrepancy,
      note,
      trang_thai,
      last_changed_by,
      updated_at
    ) VALUES (
      ${storeId},
      ${resolvedSkuId},
      ${data.brand ?? null},
      ${data.sup ?? null},
      ${cleanNgayRequest},
      ${data.product_type ?? null},
      ${data.mockup ?? null},
      ${data.sku.trim()},
      ${data.quantity ?? 0},
      ${data.line_ship ?? null},
      ${data.base_cost_per_unit ?? null},
      ${data.card ?? null},
      ${data.tag ?? null},
      ${data.shipping_fee ?? null},
      ${data.hop_tui ?? null},
      ${finalBaseCost || null},
      ${totalBaseCost || null},
      ${cleanNgayThanhToan},
      ${data.ten_lo_hang ?? null},
      ${data.shipment_id ?? null},
      ${cleanNgayDi},
      ${cleanNgayDen},
      ${data.amazon_received ?? null},
      ${data.tinh_trang_hang_den_kho ?? null},
      ${data.status ?? null},
      ${effectiveSoLuongAmazonNhan},
      ${discrepancy},
      ${data.note ?? null},
      ${data.trang_thai ?? null},
      ${changedBy},
      NOW()
    )
    ON CONFLICT (
      store_id,
      LOWER(BTRIM(sku)),
      LOWER(COALESCE(
        NULLIF(BTRIM(shipment_id), ''),
        'lot:' || NULLIF(BTRIM(ten_lo_hang), '')
      ))
    )
    WHERE deleted_at IS NULL
      AND (
        NULLIF(BTRIM(shipment_id), '') IS NOT NULL
        OR NULLIF(BTRIM(ten_lo_hang), '') IS NOT NULL
      )
    DO UPDATE SET
      sku_id = COALESCE(EXCLUDED.sku_id, accounting_inbound_shipments.sku_id),
      brand = EXCLUDED.brand,
      sup = EXCLUDED.sup,
      ngay_request = EXCLUDED.ngay_request,
      product_type = EXCLUDED.product_type,
      mockup = EXCLUDED.mockup,
      sku = EXCLUDED.sku,
      quantity = EXCLUDED.quantity,
      line_ship = EXCLUDED.line_ship,
      base_cost_per_unit = EXCLUDED.base_cost_per_unit,
      card = EXCLUDED.card,
      tag = EXCLUDED.tag,
      shipping_fee = EXCLUDED.shipping_fee,
      hop_tui = EXCLUDED.hop_tui,
      final_basecost = EXCLUDED.final_basecost,
      total_basecost = EXCLUDED.total_basecost,
      ngay_thanh_toan = EXCLUDED.ngay_thanh_toan,
      ten_lo_hang = EXCLUDED.ten_lo_hang,
      shipment_id = EXCLUDED.shipment_id,
      ngay_di = EXCLUDED.ngay_di,
      ngay_den = EXCLUDED.ngay_den,
      amazon_received = EXCLUDED.amazon_received,
      tinh_trang_hang_den_kho = EXCLUDED.tinh_trang_hang_den_kho,
      status = EXCLUDED.status,
      so_luong_amazon_nhan = EXCLUDED.so_luong_amazon_nhan,
      discrepancy = EXCLUDED.discrepancy,
      note = EXCLUDED.note,
      trang_thai = EXCLUDED.trang_thai,
      last_changed_by = EXCLUDED.last_changed_by,
      updated_at = NOW()
    RETURNING
      id, store_id, sku_id, brand, sup, ngay_request, product_type, mockup,
      sku, quantity, line_ship, base_cost_per_unit::float, card::float,
      tag::float, shipping_fee::float, hop_tui::float, final_basecost::float,
      total_basecost::float, ngay_thanh_toan, ten_lo_hang, shipment_id,
      ngay_di, ngay_den, amazon_received, tinh_trang_hang_den_kho, status,
      so_luong_amazon_nhan, discrepancy, note, trang_thai,
      custom_fields,
      created_at::text, updated_at::text
  `;
  return rows[0];
}

export async function patchInboundShipmentField(
  storeId: string,
  id: string,
  field: string,
  value: any,
  changedBy = "system",
): Promise<InboundShipmentItem> {
  const sql = await getDatabaseClient();
  const trimmed = typeof value === "string" ? value.trim() : value;

  if (field.startsWith("custom_")) {
    const rows = await sql<InboundShipmentItem[]>`
      UPDATE accounting_inbound_shipments
      SET
        custom_fields = jsonb_set(COALESCE(custom_fields, '{}'::jsonb), ARRAY[${field}], to_jsonb(${trimmed === "" ? null : trimmed}::text)),
        last_changed_by = ${changedBy},
        updated_at = NOW()
      WHERE id = ${id} AND store_id = ${storeId}
      RETURNING
        id, store_id, sku_id, brand, sup, ngay_request, product_type, mockup,
        sku, quantity, line_ship, base_cost_per_unit::float, card::float,
        tag::float, shipping_fee::float, hop_tui::float, final_basecost::float,
        total_basecost::float, ngay_thanh_toan, ten_lo_hang, shipment_id,
        ngay_di, ngay_den, amazon_received, tinh_trang_hang_den_kho, status,
        so_luong_amazon_nhan, discrepancy, note, trang_thai,
        custom_fields, created_at::text, updated_at::text
    `;
    if (!rows[0]) throw new Error("Không tìm thấy lô hàng cần cập nhật.");
    return rows[0];
  }

  const dateFields = ["ngay_request", "ngay_thanh_toan", "ngay_di", "ngay_den"];
  const intFields = ["quantity", "amazon_received", "so_luong_amazon_nhan", "discrepancy"];
  const floatFields = ["base_cost_per_unit", "card", "tag", "shipping_fee", "hop_tui", "final_basecost", "total_basecost"];

  let val: any = trimmed === "" || trimmed == null ? null : trimmed;
  if (intFields.includes(field)) {
    val = trimmed === "" || trimmed == null ? 0 : parseInt(trimmed, 10);
  } else if (floatFields.includes(field)) {
    val = trimmed === "" || trimmed == null ? null : parseFloat(trimmed);
  } else if (dateFields.includes(field)) {
    val = cleanDateOnly(trimmed);
  }

  const validFields = [
    "brand", "sup", "ngay_request", "product_type", "mockup", "sku",
    "quantity", "line_ship", "base_cost_per_unit", "card", "tag",
    "shipping_fee", "hop_tui", "final_basecost", "total_basecost",
    "ngay_thanh_toan", "ten_lo_hang", "shipment_id", "ngay_di", "ngay_den",
    "amazon_received", "tinh_trang_hang_den_kho", "status",
    "so_luong_amazon_nhan", "discrepancy", "note", "trang_thai"
  ];
  if (!validFields.includes(field)) {
    throw new Error(`Trường '${field}' không hợp lệ.`);
  }

  const rows = await sql<InboundShipmentItem[]>`
    UPDATE accounting_inbound_shipments
    SET
      ${sql(field)} = ${val},
      last_changed_by = ${changedBy},
      updated_at = NOW()
    WHERE id = ${id} AND store_id = ${storeId}
    RETURNING
      id, store_id, sku_id, brand, sup, ngay_request, product_type, mockup,
      sku, quantity, line_ship, base_cost_per_unit::float, card::float,
      tag::float, shipping_fee::float, hop_tui::float, final_basecost::float,
      total_basecost::float, ngay_thanh_toan, ten_lo_hang, shipment_id,
      ngay_di, ngay_den, amazon_received, tinh_trang_hang_den_kho, status,
      so_luong_amazon_nhan, discrepancy, note, trang_thai,
      custom_fields, created_at::text, updated_at::text
  `;
  if (!rows[0]) throw new Error("Không tìm thấy lô hàng cần cập nhật.");

  // Với shipment STAR: luôn giữ cột Số lượng Amazon nhận bằng quantity và discrepancy = 0
  if (rows[0].shipment_id?.trim().toLowerCase().startsWith("star")) {
    if (field === "quantity" || field === "shipment_id" || field === "so_luong_amazon_nhan") {
      const synced = await sql<InboundShipmentItem[]>`
        UPDATE accounting_inbound_shipments
        SET
          so_luong_amazon_nhan = COALESCE(quantity, 0),
          discrepancy = 0,
          updated_at = NOW()
        WHERE id = ${id} AND store_id = ${storeId}
        RETURNING
          id, store_id, sku_id, brand, sup, ngay_request, product_type, mockup,
          sku, quantity, line_ship, base_cost_per_unit::float, card::float,
          tag::float, shipping_fee::float, hop_tui::float, final_basecost::float,
          total_basecost::float, ngay_thanh_toan, ten_lo_hang, shipment_id,
          ngay_di, ngay_den, amazon_received, tinh_trang_hang_den_kho, status,
          so_luong_amazon_nhan, discrepancy, note, trang_thai,
          custom_fields, created_at::text, updated_at::text
      `;
      if (synced[0]) return synced[0];
    }
  }

  return rows[0];
}

export async function deleteInboundShipmentItem(id: string, storeId: string, changedBy = "system"): Promise<boolean> {
  const sql = await getDatabaseClient();
  const res = await sql`
    UPDATE accounting_inbound_shipments
    SET deleted_at = NOW(), last_changed_by = ${changedBy}, updated_at = NOW()
    WHERE id = ${id} AND store_id = ${storeId} AND deleted_at IS NULL
  `;
  return res.count > 0;
}

export async function listInventoryHistory(
  storeId: string,
  entityType?: InventoryEntityType | null,
  entityId?: string | null,
): Promise<InventoryHistoryItem[]> {
  const sql = await getDatabaseClient();
  return sql<InventoryHistoryItem[]>`
    SELECT id, entity_type, entity_id, store_id, action, before_data, after_data,
      changed_by, created_at::text
    FROM inventory_change_history
    WHERE store_id = ${storeId}
      AND (${entityType ?? null}::text IS NULL OR entity_type = ${entityType ?? null})
      AND (${entityId ?? null}::uuid IS NULL OR entity_id = ${entityId ?? null}::uuid)
    ORDER BY created_at DESC
    LIMIT 100
  `;
}

export async function restoreSoftDeletedItem(
  storeId: string,
  entityType: InventoryEntityType,
  entityId: string,
  changedBy = "system",
): Promise<boolean> {
  const sql = await getDatabaseClient();
  const table =
    entityType === "sku"
      ? "accounting_sku_master"
      : entityType === "sku_fbm"
      ? "accounting_sku_master_fbm"
      : entityType === "inbound"
      ? "accounting_inbound_shipments"
      : entityType === "check_shipment"
      ? "accounting_amazon_check_shipments"
      : "accounting_monthly_base_cost";
  const res = await sql`
    UPDATE ${sql(table)}
    SET deleted_at = NULL, last_changed_by = ${changedBy}, updated_at = NOW()
    WHERE id = ${entityId} AND store_id = ${storeId} AND deleted_at IS NOT NULL
  `;
  return res.count > 0;
}

const SKU_RESTORE_FIELDS = [
  "brand", "product_type", "mockup", "sku", "asin", "fnsku", "amazon_fee",
  "referral_fee_pct", "pic_mkt", "loai", "niche", "pic_idea", "status", "event",
  "tinh_trang", "design_pic", "mockup_url", "thang_listing", "thang_danh_gia",
  "event_250th", "ngay_danh_gia_sku_event", "amazon_fba_fee_thay_doi", "basecost_tb",
  "brand_entity_id", "creative_asins_video", "creative_asins_collection", "video_media_ids",
  "creative_headline", "brand_logo_asset_id", "landing_page_url", "custom_fields", "row_order",
] as const;

const INBOUND_RESTORE_FIELDS = [
  "sku_id", "brand", "sup", "ngay_request", "product_type", "mockup", "sku", "quantity",
  "line_ship", "base_cost_per_unit", "card", "tag", "shipping_fee", "hop_tui",
  "final_basecost", "total_basecost", "ngay_thanh_toan", "ten_lo_hang", "shipment_id",
  "ngay_di", "ngay_den", "amazon_received", "tinh_trang_hang_den_kho", "status",
  "so_luong_amazon_nhan", "discrepancy", "note", "trang_thai", "custom_fields", "row_order",
] as const;

const CHECK_SHIPMENT_RESTORE_FIELDS = [
  "ngay_update", "brand", "shipment_name", "shipment_id", "created_date",
  "last_updated_date", "ship_to", "skus_count", "units_expected", "units_located",
  "discrepancy", "status", "custom_fields", "row_order",
] as const;

const MONTHLY_BASE_COST_RESTORE_FIELDS = [
  "period", "sku", "brand", "product_type", "sl_ton_dau_ky", "basecost_dau_ky",
  "gtri_ton_dau_ky", "sl_nhap", "gtri_nhap", "don_gia_nhap_tb", "tong_sl_kha_dung",
  "tong_gtri_kha_dung", "basecost_thang", "calculation_rule", "is_overridden", "note",
] as const;

export async function restoreInventoryHistory(
  storeId: string,
  historyId: string,
  changedBy = "system",
): Promise<{ entityType: InventoryEntityType; entityId: string }> {
  const sql = await getDatabaseClient();
  return sql.begin(async (tx) => {
    const historyRows = await tx<InventoryHistoryItem[]>`
      SELECT id, entity_type, entity_id, store_id, action, before_data, after_data,
        changed_by, created_at::text
      FROM inventory_change_history
      WHERE id = ${historyId} AND store_id = ${storeId}
      FOR UPDATE
    `;
    const history = historyRows[0];
    if (!history) throw new Error("Không tìm thấy phiên bản lịch sử.");

    const table = history.entity_type === "sku"
      ? "accounting_sku_master"
      : history.entity_type === "sku_fbm"
      ? "accounting_sku_master_fbm"
      : history.entity_type === "inbound"
      ? "accounting_inbound_shipments"
      : history.entity_type === "check_shipment"
      ? "accounting_amazon_check_shipments"
      : "accounting_monthly_base_cost";
    const fields = history.entity_type === "sku_fbm"
      ? [...SKU_RESTORE_FIELDS, ...FBM_SKU_EXTRA_FIELDS]
      : history.entity_type === "sku"
      ? [...SKU_RESTORE_FIELDS, ...FBA_SKU_EXTRA_FIELDS]
      : history.entity_type === "inbound"
      ? INBOUND_RESTORE_FIELDS
      : history.entity_type === "check_shipment"
      ? CHECK_SHIPMENT_RESTORE_FIELDS
      : MONTHLY_BASE_COST_RESTORE_FIELDS;

    if (history.action === "create" || !history.before_data) {
      await tx`
        UPDATE ${tx(table)}
        SET deleted_at = NOW(), last_changed_by = ${changedBy}, updated_at = NOW()
        WHERE id = ${history.entity_id} AND store_id = ${storeId}
      `;
    } else {
      const restored = Object.fromEntries(fields.map((field) => [field, history.before_data?.[field] ?? null]));
      await tx`
        UPDATE ${tx(table)}
        SET ${tx(restored as any, [...fields] as any)},
          deleted_at = NULL,
          last_changed_by = ${changedBy},
          updated_at = NOW()
        WHERE id = ${history.entity_id} AND store_id = ${storeId}
      `;
    }

    return { entityType: history.entity_type, entityId: history.entity_id };
  });
}

// ----------------- EXCEL IMPORT ENGINE -----------------

export function getExcelCellValue(cell: ExcelJS.Cell | undefined): string | number | null {
  if (!cell || cell.value === null || cell.value === undefined) return null;
  let val: unknown = cell.value;
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    if (obj.result !== undefined) val = obj.result;
    else if (cell.result !== undefined) val = cell.result;
    else if (obj.text !== undefined) val = obj.text;
    else if (obj.hyperlink !== undefined) val = obj.hyperlink;
  }
  if (cell.result !== undefined && cell.result !== null && (val === null || typeof val === "object")) {
    val = cell.result;
  }
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return val.toISOString();
  }
  if (typeof val === "string") {
    val = val.trim();
    return (val as string).length === 0 ? null : (val as string);
  }
  if (typeof val === "number") return val;
  // Công thức chia sẻ không có cached result không thể được ExcelJS tính lại.
  // Không được biến chúng thành "[object Object]", vì giá trị đó có thể bị import
  // nhầm vào số lượng tồn hay giá vốn.
  return null;
}

export function parseNumeric(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = typeof val === "number" ? val : parseFloat(String(val).replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

export function parseInteger(val: unknown): number | null {
  const n = parseNumeric(val);
  return n === null ? null : Math.round(n);
}

export function normalizeSheetName(name: string): string {
  return name.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function findWorksheetByName(workbook: ExcelJS.Workbook, aliases: string[]): ExcelJS.Worksheet | null {
  const normAliases = aliases.map(normalizeSheetName);
  for (const ws of workbook.worksheets) {
    const norm = normalizeSheetName(ws.name);
    if (normAliases.includes(norm)) {
      return ws;
    }
  }
  return null;
}

// ----------------- INVENTORY TEMPLATES (CÁCH 1) -----------------

export async function saveInventoryTemplate(
  storeId: string,
  templateType: "sku" | "inbound" | "check_shipment" | "all",
  fileName: string,
  buffer: Buffer,
  sheetNames: string[],
  hasSkuSheet: boolean,
  hasInboundSheet: boolean,
  hasCheckShipmentSheet = false,
): Promise<void> {
  const sql = await getDatabaseClient();
  await sql`
    INSERT INTO accounting_inventory_templates (
      store_id,
      template_type,
      file_name,
      file_buffer,
      has_sku_sheet,
      has_inbound_sheet,
      has_check_shipment_sheet,
      sheet_names,
      file_size,
      updated_at
    ) VALUES (
      ${storeId},
      ${templateType},
      ${fileName},
      ${buffer},
      ${hasSkuSheet},
      ${hasInboundSheet},
      ${hasCheckShipmentSheet},
      ${sheetNames},
      ${buffer.length},
      NOW()
    )
    ON CONFLICT (store_id, template_type)
    DO UPDATE SET
      file_name = EXCLUDED.file_name,
      file_buffer = EXCLUDED.file_buffer,
      has_sku_sheet = EXCLUDED.has_sku_sheet,
      has_inbound_sheet = EXCLUDED.has_inbound_sheet,
      has_check_shipment_sheet = EXCLUDED.has_check_shipment_sheet,
      sheet_names = EXCLUDED.sheet_names,
      file_size = EXCLUDED.file_size,
      updated_at = NOW()
  `;
}

export async function processAndSaveImportTemplate(
  storeId: string,
  importType: "sku" | "inbound" | "check_shipment",
  fileName: string,
  buffer: Buffer,
  workbook: ExcelJS.Workbook,
): Promise<void> {
  try {
    const sheetNames = workbook.worksheets.map((w) => w.name);
    const hasSkuSheet = !!findWorksheetByName(workbook, ["BẢNG MÃ", "BANG MA", "SKU MASTER"]);
    const hasInboundSheet = !!findWorksheetByName(workbook, ["CHI TIẾT ĐI HÀNG", "CHI TIET DI HANG", "INBOUND SHIPMENTS"]);
    const hasCheckShipmentSheet = !!findWorksheetByName(workbook, ["CHECK SHIPMENT AMAZON", "CHECK SHIPMENT", "SHIPMENT AMAZON"]);

    // Lưu template cho đúng loại import hiện tại
    await saveInventoryTemplate(
      storeId,
      importType,
      fileName,
      buffer,
      sheetNames,
      hasSkuSheet,
      hasInboundSheet,
      hasCheckShipmentSheet,
    );

    // Nếu file chứa cả 2 sheet chính hoặc nhiều sheet, đồng thời lưu/cập nhật mẫu master "all"
    if (hasSkuSheet && hasInboundSheet) {
      await saveInventoryTemplate(
        storeId,
        "all",
        fileName,
        buffer,
        sheetNames,
        hasSkuSheet,
        hasInboundSheet,
        hasCheckShipmentSheet,
      );
    }
  } catch (err) {
    console.error("[InventoryTemplate] Lỗi khi lưu template tự động:", err);
  }
}

export async function getInventoryTemplate(
  storeId: string,
  templateType: "sku" | "inbound" | "check_shipment" | "all",
): Promise<{ fileName: string; buffer: Buffer; hasSkuSheet: boolean; hasInboundSheet: boolean; hasCheckShipmentSheet?: boolean } | null> {
  const sql = await getDatabaseClient();
  let rows: any[] = [];

  if (templateType === "sku") {
    rows = await sql`
      SELECT file_name, file_buffer, has_sku_sheet, has_inbound_sheet, has_check_shipment_sheet
      FROM accounting_inventory_templates
      WHERE store_id = ${storeId} AND (template_type = 'sku' OR has_sku_sheet = true)
      ORDER BY CASE WHEN template_type = 'sku' THEN 1 ELSE 2 END, updated_at DESC
      LIMIT 1
    `;
  } else if (templateType === "inbound") {
    rows = await sql`
      SELECT file_name, file_buffer, has_sku_sheet, has_inbound_sheet, has_check_shipment_sheet
      FROM accounting_inventory_templates
      WHERE store_id = ${storeId} AND (template_type = 'inbound' OR has_inbound_sheet = true)
      ORDER BY CASE WHEN template_type = 'inbound' THEN 1 ELSE 2 END, updated_at DESC
      LIMIT 1
    `;
  } else if (templateType === "check_shipment") {
    rows = await sql`
      SELECT file_name, file_buffer, has_sku_sheet, has_inbound_sheet, has_check_shipment_sheet
      FROM accounting_inventory_templates
      WHERE store_id = ${storeId} AND (template_type = 'check_shipment' OR has_check_shipment_sheet = true)
      ORDER BY CASE WHEN template_type = 'check_shipment' THEN 1 ELSE 2 END, updated_at DESC
      LIMIT 1
    `;
  } else {
    rows = await sql`
      SELECT file_name, file_buffer, has_sku_sheet, has_inbound_sheet, has_check_shipment_sheet
      FROM accounting_inventory_templates
      WHERE store_id = ${storeId}
      ORDER BY CASE WHEN template_type = 'all' THEN 1 WHEN template_type = 'sku' THEN 2 ELSE 3 END, updated_at DESC
      LIMIT 1
    `;
  }

  if (!rows[0]) return null;
  return {
    fileName: rows[0].file_name,
    buffer: rows[0].file_buffer,
    hasSkuSheet: Boolean(rows[0].has_sku_sheet),
    hasInboundSheet: Boolean(rows[0].has_inbound_sheet),
    hasCheckShipmentSheet: Boolean(rows[0].has_check_shipment_sheet),
  };
}

export const SKU_HEADER_MAP: Record<string, string> = {
  "brand": "brand",
  "thương hiệu": "brand",
  "thuong hieu": "brand",
  "product type": "product_type",
  "loại sản phẩm": "product_type",
  "loai san pham": "product_type",
  "loại sp": "product_type",
  "loai sp": "product_type",
  "mockup": "mockup",
  "mockup url": "mockup_url",
  "url mockup": "mockup_url",
  "link mockup": "mockup_url",
  "hình ảnh": "mockup",
  "hinh anh": "mockup",
  "ảnh": "mockup",
  "anh": "mockup",
  "sku": "sku",
  "mã sku": "sku",
  "ma sku": "sku",
  "asin": "asin",
  "fnsku": "fnsku",
  "amazon fee (chưa có referal fee)": "amazon_fee",
  "amazon fee (chua co referal fee)": "amazon_fee",
  "amazon fee": "amazon_fee",
  "fba fee": "amazon_fee",
  "% referal": "referral_fee_pct",
  "% referral": "referral_fee_pct",
  "referal": "referral_fee_pct",
  "referral": "referral_fee_pct",
  "referral fee": "referral_fee_pct",
  "pic mkt": "pic_mkt",
  "marketing": "pic_mkt",
  "mkt pic": "pic_mkt",
  "loại": "loai",
  "loai": "loai",
  "niche": "niche",
  "pic idea": "pic_idea",
  "idea pic": "pic_idea",
  "trạng thái": "status",
  "trang thai": "status",
  "status": "status",
  "event": "event",
  "sự kiện": "event",
  "su kien": "event",
  "tình trạng": "tinh_trang",
  "tinh trang": "tinh_trang",
  "design pic": "design_pic",
  "pic design": "design_pic",
  "tháng listing": "thang_listing",
  "thang listing": "thang_listing",
  "tháng đánh giá": "thang_danh_gia",
  "thang danh gia": "thang_danh_gia",
  "event 250th": "event_250th",
  "ngày đánh giá sku event": "ngay_danh_gia_sku_event",
  "ngay danh gia sku event": "ngay_danh_gia_sku_event",
  "amazon fba fee thay đổi": "amazon_fba_fee_thay_doi",
  "amazon fba fee thay doi": "amazon_fba_fee_thay_doi",
  "basecost trung bình": "basecost_tb",
  "basecost tb": "basecost_tb",
  "base cost tb": "basecost_tb",
  "brand entity id": "brand_entity_id",
  "creative asins (video)": "creative_asins_video",
  "creative asins video": "creative_asins_video",
  "creative asins (collection)": "creative_asins_collection",
  "creative asins collection": "creative_asins_collection",
  "video media ids": "video_media_ids",
  "video media id": "video_media_ids",
  "creative headline": "creative_headline",
  "brand logo asset id": "brand_logo_asset_id",
  "landing page url": "landing_page_url",
  "landing page": "landing_page_url",
};

export const INBOUND_HEADER_MAP: Record<string, string> = {
  "brand": "brand",
  "thương hiệu": "brand",
  "thuong hieu": "brand",
  "sup": "sup",
  "supplier": "sup",
  "nhà cung cấp": "sup",
  "nha cung cap": "sup",
  "ngày request": "ngay_request",
  "ngay request": "ngay_request",
  "request date": "ngay_request",
  "product type": "product_type",
  "loại sản phẩm": "product_type",
  "loai san pham": "product_type",
  "loại sp": "product_type",
  "loai sp": "product_type",
  "mockup": "mockup",
  "hình ảnh": "mockup",
  "hinh anh": "mockup",
  "ảnh": "mockup",
  "anh": "mockup",
  "sku": "sku",
  "mã sku": "sku",
  "ma sku": "sku",
  "quantity": "quantity",
  "số lượng": "quantity",
  "so luong": "quantity",
  "qty": "quantity",
  "sl": "quantity",
  "line ship": "line_ship",
  "vận chuyển": "line_ship",
  "base cost/unit": "base_cost_per_unit",
  "base cost / unit": "base_cost_per_unit",
  "base cost": "base_cost_per_unit",
  "basecost/unit": "base_cost_per_unit",
  "card": "card",
  "tag": "tag",
  "shipping fee": "shipping_fee",
  "phí ship": "shipping_fee",
  "phi ship": "shipping_fee",
  "hộp/túi": "hop_tui",
  "hop/tui": "hop_tui",
  "hộp": "hop_tui",
  "túi": "hop_tui",
  "final basecost": "final_basecost",
  "final base cost": "final_basecost",
  "total basecost": "total_basecost",
  "total base cost": "total_basecost",
  "ngày thanh toán": "ngay_thanh_toan",
  "ngay thanh toan": "ngay_thanh_toan",
  "tên lô hàng": "ten_lo_hang",
  "ten lo hang": "ten_lo_hang",
  "shipment id": "shipment_id",
  "ngày đi": "ngay_di",
  "ngay di": "ngay_di",
  "ngày đến": "ngay_den",
  "ngay den": "ngay_den",
  "amazon received": "amazon_received",
  "tình trạng hàng đến kho": "tinh_trang_hang_den_kho",
  "tinh trang hang den kho": "tinh_trang_hang_den_kho",
  "status": "status",
  "số lượng amazon nhận": "so_luong_amazon_nhan",
  "so luong amazon nhan": "so_luong_amazon_nhan",
  "discrepancy": "discrepancy",
  "chênh lệch": "discrepancy",
  "chenh lech": "discrepancy",
  "note": "note",
  "ghi chú": "note",
  "ghi chu": "note",
  "trạng thái": "trang_thai",
  "trang thai": "trang_thai",
};

export function createDefaultSkuSheet(ws: ExcelJS.Worksheet, skus: any[] = []): void {
  ws.name = "BẢNG MÃ";
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const columns = [
    { key: "brand", header: "Brand", width: 16, align: "left" },
    { key: "product_type", header: "Product Type", width: 20, align: "left" },
    { key: "mockup", header: "Mockup", width: 16, align: "left" },
    { key: "sku", header: "SKU", width: 20, align: "center", bold: true },
    { key: "asin", header: "ASIN", width: 16, align: "center" },
    { key: "fnsku", header: "FNSKU", width: 16, align: "center" },
    { key: "amazon_fee", header: "AMAZON FEE (chưa có referal fee)", width: 22, align: "right", numFmt: "$#,##0.00" },
    { key: "referral_fee_pct", header: "% Referal", width: 14, align: "right", numFmt: "0.00%" },
    { key: "pic_mkt", header: "PIC MKT", width: 14, align: "left" },
    { key: "loai", header: "Loại", width: 14, align: "left" },
    { key: "niche", header: "Niche", width: 16, align: "left" },
    { key: "pic_idea", header: "PIC Idea", width: 14, align: "left" },
    { key: "status", header: "Trạng thái", width: 14, align: "center" },
    { key: "event", header: "Event", width: 14, align: "left" },
    { key: "tinh_trang", header: "Tình trạng", width: 14, align: "center" },
    { key: "design_pic", header: "DESIGN PIC", width: 14, align: "left" },
    { key: "mockup_url", header: "Mockup url", width: 28, align: "left" },
    { key: "thang_listing", header: "Tháng listing", width: 15, align: "center" },
    { key: "thang_danh_gia", header: "Tháng đánh giá", width: 15, align: "center" },
    { key: "event_250th", header: "Event 250th", width: 14, align: "left" },
    { key: "ngay_danh_gia_sku_event", header: "Ngày đánh giá SKU Event", width: 20, align: "center" },
    { key: "amazon_fba_fee_thay_doi", header: "Amazon FBA Fee thay đổi", width: 20, align: "right", numFmt: "$#,##0.00" },
    { key: "basecost_tb", header: "Basecost trung bình", width: 18, align: "right", numFmt: "$#,##0.00" },
    { key: "brand_entity_id", header: "Brand Entity ID", width: 18, align: "center" },
    { key: "creative_asins_video", header: "Creative ASINs (Video)", width: 20, align: "left" },
    { key: "creative_asins_collection", header: "Creative ASINs (Collection)", width: 20, align: "left" },
    { key: "video_media_ids", header: "Video Media IDs", width: 18, align: "left" },
    { key: "creative_headline", header: "Creative Headline", width: 24, align: "left" },
    { key: "brand_logo_asset_id", header: "Brand Logo Asset ID", width: 18, align: "center" },
    { key: "landing_page_url", header: "Landing Page URL", width: 28, align: "left" },
  ];

  // Header row
  const headerRow = ws.addRow(columns.map((c) => c.header));
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E293B" },
    };
    cell.font = { name: "Calibri", size: 10.5, bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FF334155" } },
      left: { style: "thin", color: { argb: "FF334155" } },
      bottom: { style: "medium", color: { argb: "FF0F172A" } },
      right: { style: "thin", color: { argb: "FF334155" } },
    };
  });

  // Data rows
  skus.forEach((row, idx) => {
    const isEven = idx % 2 === 0;
    const values = columns.map((col) => {
      let val = row[col.key];
      if (col.key === "mockup" && !val && row.mockup_url) {
        val = row.mockup_url;
      }
      if (col.key === "amazon_fee" || col.key === "amazon_fba_fee_thay_doi" || col.key === "basecost_tb") {
        return val != null && val !== "" ? Number(val) : null;
      }
      if (col.key === "referral_fee_pct") {
        if (val == null || val === "") return null;
        const num = Number(val);
        return num > 1 ? num / 100 : num;
      }
      if (col.key === "thang_listing" || col.key === "thang_danh_gia") {
        return cleanMonthOnly(val);
      }
      if (col.key === "ngay_danh_gia_sku_event") {
        return cleanDateOnly(val);
      }
      return val ?? null;
    });

    const addedRow = ws.addRow(values);
    addedRow.height = 21;
    addedRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const colDef = columns[colNumber - 1];
      if (!colDef) return;

      cell.font = {
        name: "Calibri",
        size: 10,
        bold: Boolean(colDef.bold),
        color: { argb: "FF1E293B" },
      };
      cell.alignment = {
        vertical: "middle",
        horizontal: (colDef.align as any) || "left",
      };
      if (colDef.numFmt) {
        cell.numFmt = colDef.numFmt;
      }
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
      if (!isEven) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF8FAFC" },
        };
      }
    });
  });

  columns.forEach((col, idx) => {
    ws.getColumn(idx + 1).width = col.width;
  });
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(skus.length + 1, 1), column: columns.length },
  };
}

export function populateSkuWorksheet(worksheet: ExcelJS.Worksheet, skus: any[]): void {
  worksheet.name = "BẢNG MÃ";
  worksheet.views = [{ state: "frozen", ySplit: 1 }];

  const totalCols = Math.max(worksheet.columnCount || 30, 30);
  const colFieldMap: Record<number, string | null> = {};
  const colStyles: Record<number, Partial<ExcelJS.Style>> = {};
  const colFormulas: Record<number, string> = {};

  const DEFAULT_SKU_COLS = [
    "brand", "product_type", "mockup", "sku", "asin", "fnsku",
    "amazon_fee", "referral_fee_pct", "pic_mkt", "loai", "niche",
    "pic_idea", "status", "event", "tinh_trang", "design_pic",
    "mockup_url", "thang_listing", "thang_danh_gia", "event_250th",
    "ngay_danh_gia_sku_event", "amazon_fba_fee_thay_doi",
    "basecost_tb", "brand_entity_id", "creative_asins_video",
    "creative_asins_collection", "video_media_ids",
    "creative_headline", "brand_logo_asset_id", "landing_page_url"
  ];

  const sampleRow = worksheet.rowCount >= 2 ? worksheet.getRow(2) : null;

  for (let c = 1; c <= totalCols; c++) {
    const headerCell = worksheet.getRow(1).getCell(c);
    const rawHeaderText = getExcelCellValue(headerCell);
    const headerText = rawHeaderText ? String(rawHeaderText).trim().toLowerCase() : "";

    const mappedField = SKU_HEADER_MAP[headerText] || (c <= DEFAULT_SKU_COLS.length ? DEFAULT_SKU_COLS[c - 1] : null);
    colFieldMap[c] = mappedField;

    if (sampleRow) {
      const cell = sampleRow.getCell(c);
      colStyles[c] = {
        font: cell.font ? { ...cell.font } : undefined,
        alignment: cell.alignment ? { ...cell.alignment } : undefined,
        border: cell.border ? { ...cell.border } : undefined,
        numFmt: cell.numFmt,
        fill: cell.fill ? { ...cell.fill } : undefined,
      };
      if (cell.formula) {
        colFormulas[c] = cell.formula;
      }
    }
  }

  // Xóa sạch các dòng dữ liệu cũ trong mẫu trong 1 thao tác duy nhất
  if (worksheet.rowCount >= 2) {
    worksheet.spliceRows(2, worksheet.rowCount - 1);
  }

  // Điền dữ liệu từ cơ sở dữ liệu
  for (let idx = 0; idx < skus.length; idx++) {
    const rowData = skus[idx];
    const targetRowNum = idx + 2;
    const rowValues: any[] = [];

    for (let c = 1; c <= totalCols; c++) {
      const field = colFieldMap[c];
      let val: any = null;
      if (field && rowData[field] !== undefined) {
        val = rowData[field];
      } else if (rowData.custom_fields && field && rowData.custom_fields[field] !== undefined) {
        val = rowData.custom_fields[field];
      }

      if (field === "amazon_fee" || field === "amazon_fba_fee_thay_doi" || field === "basecost_tb") {
        val = val !== null && val !== undefined && val !== "" ? Number(val) : null;
      } else if (field === "referral_fee_pct") {
        if (val != null && val !== "") {
          const num = Number(val);
          val = num > 1 ? num / 100 : num;
        } else {
          val = null;
        }
      } else if (field === "thang_listing" || field === "thang_danh_gia") {
        val = cleanMonthOnly(val);
      } else if (field === "ngay_danh_gia_sku_event") {
        val = cleanDateOnly(val);
      }

      rowValues.push(val);
    }

    const addedRow = worksheet.addRow(rowValues);
    addedRow.height = 21;
    for (let c = 1; c <= totalCols; c++) {
      const cell = addedRow.getCell(c);
      const style = colStyles[c];
      if (style) {
        if (style.font) cell.font = style.font;
        if (style.alignment) cell.alignment = style.alignment;
        if (style.border) cell.border = style.border;
        if (style.numFmt) cell.numFmt = style.numFmt;
        if (style.fill) cell.fill = style.fill;
      }
      if (colFormulas[c]) {
        const adaptedFormula = colFormulas[c].replace(/\b([A-Z]{1,3})2\b/g, `$1${targetRowNum}`);
        cell.value = { formula: adaptedFormula, result: cell.value as any };
      }
    }
  }

  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(skus.length + 1, 1), column: totalCols },
  };
}

export function createDefaultInboundSheet(ws: ExcelJS.Worksheet, shipments: any[] = []): void {
  ws.name = "CHI TIẾT ĐI HÀNG";
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const columns = [
    { key: "brand", header: "BRAND", width: 16, align: "left" }, // A (1)
    { key: "sup", header: "SUP", width: 14, align: "left" }, // B (2)
    { key: "ngay_request", header: "Ngày request", width: 15, align: "center" }, // C (3)
    { key: "product_type", header: "Product Type", width: 20, align: "left" }, // D (4)
    { key: "mockup", header: "Mockup", width: 16, align: "left" }, // E (5)
    { key: "sku", header: "SKU", width: 20, align: "center", bold: true }, // F (6)
    { key: "quantity", header: "Quantity", width: 13, align: "right", numFmt: "#,##0", bold: true }, // G (7)
    { key: "line_ship", header: "Line ship", width: 15, align: "center" }, // H (8)
    { key: "base_cost_per_unit", header: "Base Cost/Unit", width: 16, align: "right", numFmt: "$#,##0.00" }, // I (9)
    { key: "card", header: "Card", width: 12, align: "right", numFmt: "$#,##0.00" }, // J (10)
    { key: "tag", header: "Tag", width: 12, align: "right", numFmt: "$#,##0.00" }, // K (11)
    { key: "shipping_fee", header: "Shipping fee", width: 14, align: "right", numFmt: "$#,##0.00" }, // L (12)
    { key: "hop_tui", header: "Hộp/túi", width: 12, align: "right", numFmt: "$#,##0.00" }, // M (13)
    { key: "final_basecost", header: "Final Basecost", width: 16, align: "right", numFmt: "$#,##0.00", bold: true }, // N (14)
    { key: "total_basecost", header: "Total Basecost", width: 16, align: "right", numFmt: "$#,##0.00", bold: true }, // O (15)
    { key: "ngay_thanh_toan", header: "Ngày thanh toán", width: 16, align: "center" }, // P (16)
    { key: "ten_lo_hang", header: "Tên lô hàng", width: 20, align: "left" }, // Q (17)
    { key: "shipment_id", header: "Shipment ID", width: 22, align: "center", bold: true }, // R (18)
    { key: "ngay_di", header: "Ngày đi", width: 14, align: "center" }, // S (19)
    { key: "ngay_den", header: "Ngày đến", width: 14, align: "center" }, // T (20)
    { key: "amazon_received", header: "Amazon Received", width: 16, align: "right", numFmt: "#,##0" }, // U (21)
    { key: "tinh_trang_hang_den_kho", header: "Tình trạng hàng đến kho", width: 22, align: "left" }, // V (22)
    { key: "status", header: "Status", width: 14, align: "center" }, // W (23)
    { key: "so_luong_amazon_nhan", header: "Số lượng Amazon nhận", width: 20, align: "right", numFmt: "#,##0" }, // X (24)
    { key: "discrepancy", header: "Discrepancy", width: 14, align: "right", numFmt: "#,##0" }, // Y (25)
    { key: "note", header: "Note", width: 22, align: "left" }, // Z (26)
    { key: "trang_thai", header: "Trạng thái", width: 14, align: "center" }, // AA (27)
  ];

  // Header row
  const headerRow = ws.addRow(columns.map((c) => c.header));
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E293B" },
    };
    cell.font = { name: "Calibri", size: 10.5, bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FF334155" } },
      left: { style: "thin", color: { argb: "FF334155" } },
      bottom: { style: "medium", color: { argb: "FF0F172A" } },
      right: { style: "thin", color: { argb: "FF334155" } },
    };
  });

  shipments.forEach((row, idx) => {
    const r = idx + 2;
    const isEven = idx % 2 === 0;

    const qty = row.quantity != null && row.quantity !== "" ? Number(row.quantity) : 0;
    const baseCost = row.base_cost_per_unit != null && row.base_cost_per_unit !== "" ? Number(row.base_cost_per_unit) : null;
    const card = row.card != null && row.card !== "" ? Number(row.card) : null;
    const tag = row.tag != null && row.tag !== "" ? Number(row.tag) : null;
    const shippingFee = row.shipping_fee != null && row.shipping_fee !== "" ? Number(row.shipping_fee) : null;
    const hopTui = row.hop_tui != null && row.hop_tui !== "" ? Number(row.hop_tui) : null;

    const computedFinalBasecost = row.final_basecost != null && row.final_basecost !== ""
      ? Number(row.final_basecost)
      : (baseCost || 0) + (card || 0) + (tag || 0) + (shippingFee || 0) + (hopTui || 0);

    const computedTotalBasecost = row.total_basecost != null && row.total_basecost !== ""
      ? Number(row.total_basecost)
      : computedFinalBasecost * qty;

    const amzReceived = row.amazon_received != null && row.amazon_received !== "" ? Number(row.amazon_received) : null;
    const computedDiscrepancy = row.discrepancy != null && row.discrepancy !== ""
      ? Number(row.discrepancy)
      : (amzReceived != null ? amzReceived - qty : null);

    const values: any[] = [
      row.brand ?? null,
      row.sup ?? null,
      cleanDateOnly(row.ngay_request),
      row.product_type ?? null,
      row.mockup ?? null,
      row.sku ?? null,
      qty,
      row.line_ship ?? null,
      baseCost,
      card,
      tag,
      shippingFee,
      hopTui,
      // N (14) Final Basecost formula
      { formula: `SUM(I${r}:M${r})`, result: computedFinalBasecost },
      // O (15) Total Basecost formula
      { formula: `G${r}*N${r}`, result: computedTotalBasecost },
      cleanDateOnly(row.ngay_thanh_toan),
      row.ten_lo_hang ?? null,
      row.shipment_id ?? null,
      cleanDateOnly(row.ngay_di),
      cleanDateOnly(row.ngay_den),
      amzReceived,
      row.tinh_trang_hang_den_kho ?? null,
      row.status ?? null,
      row.so_luong_amazon_nhan != null && row.so_luong_amazon_nhan !== "" ? Number(row.so_luong_amazon_nhan) : null,
      // Y (25) Discrepancy formula
      { formula: `IF(ISBLANK(U${r}),"",U${r}-G${r})`, result: computedDiscrepancy },
      row.note ?? null,
      row.trang_thai ?? null,
    ];

    const addedRow = ws.addRow(values);
    addedRow.height = 21;
    addedRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const colDef = columns[colNumber - 1];
      if (!colDef) return;

      cell.font = {
        name: "Calibri",
        size: 10,
        bold: Boolean(colDef.bold),
        color: { argb: "FF1E293B" },
      };
      cell.alignment = {
        vertical: "middle",
        horizontal: (colDef.align as any) || "left",
      };
      if (colDef.numFmt) {
        cell.numFmt = colDef.numFmt;
      }
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
      if (!isEven) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF8FAFC" },
        };
      }
    });
  });

  columns.forEach((col, idx) => {
    ws.getColumn(idx + 1).width = col.width;
  });
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(shipments.length + 1, 1), column: columns.length },
  };
}

export function populateInboundWorksheet(worksheet: ExcelJS.Worksheet, shipments: any[]): void {
  worksheet.name = "CHI TIẾT ĐI HÀNG";
  worksheet.views = [{ state: "frozen", ySplit: 1 }];

  const totalCols = Math.max(worksheet.columnCount || 27, 27);
  const colFieldMap: Record<number, string | null> = {};
  const colStyles: Record<number, Partial<ExcelJS.Style>> = {};
  const colFormulas: Record<number, string> = {};

  const DEFAULT_INBOUND_COLS = [
    "brand", "sup", "ngay_request", "product_type", "mockup", "sku",
    "quantity", "line_ship", "base_cost_per_unit", "card", "tag",
    "shipping_fee", "hop_tui", "final_basecost", "total_basecost",
    "ngay_thanh_toan", "ten_lo_hang", "shipment_id", "ngay_di", "ngay_den",
    "amazon_received", "tinh_trang_hang_den_kho", "status",
    "so_luong_amazon_nhan", "discrepancy", "note", "trang_thai"
  ];

  const sampleRow = worksheet.rowCount >= 2 ? worksheet.getRow(2) : null;

  for (let c = 1; c <= totalCols; c++) {
    const headerCell = worksheet.getRow(1).getCell(c);
    const rawHeaderText = getExcelCellValue(headerCell);
    const headerText = rawHeaderText ? String(rawHeaderText).trim().toLowerCase() : "";

    const mappedField = INBOUND_HEADER_MAP[headerText] || (c <= DEFAULT_INBOUND_COLS.length ? DEFAULT_INBOUND_COLS[c - 1] : null);
    colFieldMap[c] = mappedField;

    if (sampleRow) {
      const cell = sampleRow.getCell(c);
      colStyles[c] = {
        font: cell.font ? { ...cell.font } : undefined,
        alignment: cell.alignment ? { ...cell.alignment } : undefined,
        border: cell.border ? { ...cell.border } : undefined,
        numFmt: cell.numFmt,
        fill: cell.fill ? { ...cell.fill } : undefined,
      };
      if (cell.formula) {
        colFormulas[c] = cell.formula;
      }
    }
  }

  // Xóa sạch các dòng dữ liệu cũ trong mẫu trong 1 thao tác duy nhất
  if (worksheet.rowCount >= 2) {
    worksheet.spliceRows(2, worksheet.rowCount - 1);
  }

  for (let idx = 0; idx < shipments.length; idx++) {
    const rowData = shipments[idx];
    const targetRowNum = idx + 2;
    const rowValues: any[] = [];

    for (let c = 1; c <= totalCols; c++) {
      const field = colFieldMap[c];
      let val: any = null;
      if (field && rowData[field] !== undefined) {
        val = rowData[field];
      } else if (rowData.custom_fields && field && rowData.custom_fields[field] !== undefined) {
        val = rowData.custom_fields[field];
      }

      if (
        field === "quantity" || field === "amazon_received" ||
        field === "so_luong_amazon_nhan" || field === "discrepancy"
      ) {
        val = val !== null && val !== undefined && val !== "" ? Number(val) : 0;
      } else if (
        field === "base_cost_per_unit" || field === "card" ||
        field === "tag" || field === "shipping_fee" ||
        field === "hop_tui" || field === "final_basecost" ||
        field === "total_basecost"
      ) {
        val = val !== null && val !== undefined && val !== "" ? Number(val) : null;
      } else if (
        field === "ngay_request" || field === "ngay_thanh_toan" ||
        field === "ngay_di" || field === "ngay_den"
      ) {
        val = cleanDateOnly(val);
      }

      rowValues.push(val);
    }

    const addedRow = worksheet.addRow(rowValues);
    addedRow.height = 21;
    for (let c = 1; c <= totalCols; c++) {
      const cell = addedRow.getCell(c);
      const style = colStyles[c];
      const field = colFieldMap[c];

      if (style) {
        if (style.font) cell.font = style.font;
        if (style.alignment) cell.alignment = style.alignment;
        if (style.border) cell.border = style.border;
        if (style.numFmt) cell.numFmt = style.numFmt;
        if (style.fill) cell.fill = style.fill;
      }

      if (colFormulas[c]) {
        const adaptedFormula = colFormulas[c].replace(/\b([A-Z]{1,3})2\b/g, `$1${targetRowNum}`);
        cell.value = { formula: adaptedFormula, result: cell.value as any };
      } else if (field === "final_basecost") {
        const resVal = cell.value;
        cell.value = { formula: `SUM(I${targetRowNum}:M${targetRowNum})`, result: resVal as any };
      } else if (field === "total_basecost") {
        const resVal = cell.value;
        cell.value = { formula: `G${targetRowNum}*N${targetRowNum}`, result: resVal as any };
      } else if (field === "discrepancy") {
        const resVal = cell.value;
        cell.value = { formula: `IF(ISBLANK(U${targetRowNum}),"",U${targetRowNum}-G${targetRowNum})`, result: resVal as any };
      }
    }
  }

  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(shipments.length + 1, 1), column: totalCols },
  };
}

export async function importSkuMasterFromWorkbook(
  storeId: string,
  workbook: ExcelJS.Workbook,
  channel: SkuChannel = "fba",
  changedBy = "system",
): Promise<{ count: number; errors: string[] }> {
  if (channel === "fbm") {
    const sheetName = pickFbmSkuSheet(workbook.worksheets.map((w) => w.name));
    const ws = sheetName ? workbook.getWorksheet(sheetName) : undefined;
    if (!ws) {
      const available = workbook.worksheets.map((w) => `"${w.name}"`).join(", ");
      throw new Error(`File không có sheet BẢNG MÃ FBM (ví dụ "FBM_<Store>"). Các sheet hiện có trong file: [${available}]`);
    }
    return importFbmSkuRows(storeId, worksheetToRows(ws), changedBy);
  }

  const wsSku = findWorksheetByName(workbook, ["BẢNG MÃ", "BANG MA", "SKU MASTER"]);
  if (!wsSku) {
    const available = workbook.worksheets.map((w) => `"${w.name}"`).join(", ");
    throw new Error(`File không có sheet "BẢNG MÃ". Các sheet hiện có trong file: [${available}]`);
  }

  const errors: string[] = [];
  let count = 0;
  const skuBatch: Partial<SkuMasterItem>[] = [];

  const DEFAULT_SKU_COLS = [
    "brand", "product_type", "mockup", "sku", "asin", "fnsku",
    "amazon_fee", "referral_fee_pct", "pic_mkt", "loai", "niche",
    "pic_idea", "status", "event", "tinh_trang", "design_pic",
    "mockup_url", "thang_listing", "thang_danh_gia", "event_250th",
    "ngay_danh_gia_sku_event", "amazon_fba_fee_thay_doi",
    "basecost_tb", "brand_entity_id", "creative_asins_video",
    "creative_asins_collection", "video_media_ids",
    "creative_headline", "brand_logo_asset_id", "landing_page_url"
  ];

  // 1. Quét dòng 1 để map vị trí cột tự động theo Header Name
  const headerRow = wsSku.getRow(1);
  const totalCols = Math.max(wsSku.columnCount || 30, 30);
  const colFieldMap: Record<number, string> = {};

  for (let c = 1; c <= totalCols; c++) {
    const headerVal = getExcelCellValue(headerRow.getCell(c));
    const headerText = headerVal ? String(headerVal).trim().toLowerCase() : "";
    const mapped = SKU_HEADER_MAP[headerText] || (c <= DEFAULT_SKU_COLS.length ? DEFAULT_SKU_COLS[c - 1] : null);
    if (mapped) {
      colFieldMap[c] = mapped;
    }
  }

  // 2. Đọc từng dòng dữ liệu dựa trên colFieldMap
  wsSku.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const rowValues: Record<string, any> = {};
    for (let c = 1; c <= totalCols; c++) {
      const field = colFieldMap[c];
      if (field) {
        rowValues[field] = getExcelCellValue(row.getCell(c));
      }
    }

    const skuVal = rowValues["sku"];
    if (!skuVal) return;
    const sku = String(skuVal).trim();
    if (!sku) return;

    const brand = (rowValues["brand"] as string) || null;
    const product_type = (rowValues["product_type"] as string) || null;
    const rawMockup = rowValues["mockup"];
    const asin = (rowValues["asin"] as string) || null;
    const fnsku = (rowValues["fnsku"] as string) || null;
    const amazon_fee = parseNumeric(rowValues["amazon_fee"]);
    const rawReferralPct = parseNumeric(rowValues["referral_fee_pct"]);
    const referral_fee_pct = rawReferralPct != null ? (rawReferralPct > 1 ? rawReferralPct / 100 : rawReferralPct) : null;
    const pic_mkt = (rowValues["pic_mkt"] as string) || null;
    const loai = (rowValues["loai"] as string) || null;
    const niche = (rowValues["niche"] as string) || null;
    const pic_idea = (rowValues["pic_idea"] as string) || null;
    const status = (rowValues["status"] as string) || "Active";
    const event = (rowValues["event"] as string) || null;
    const tinh_trang = (rowValues["tinh_trang"] as string) || null;
    const design_pic = (rowValues["design_pic"] as string) || null;
    const mockup_url = (rowValues["mockup_url"] as string) || null;
    const thang_listing = cleanMonthOnly(rowValues["thang_listing"]);
    const thang_danh_gia = cleanMonthOnly(rowValues["thang_danh_gia"]);
    const event_250th = (rowValues["event_250th"] as string) || null;
    const ngay_danh_gia_sku_event = cleanDateOnly(rowValues["ngay_danh_gia_sku_event"]);
    const amazon_fba_fee_thay_doi = parseNumeric(rowValues["amazon_fba_fee_thay_doi"]);
    const basecost_tb = parseNumeric(rowValues["basecost_tb"]);
    const brand_entity_id = (rowValues["brand_entity_id"] as string) || null;
    const creative_asins_video = (rowValues["creative_asins_video"] as string) || null;
    const creative_asins_collection = (rowValues["creative_asins_collection"] as string) || null;
    const video_media_ids = (rowValues["video_media_ids"] as string) || null;
    const creative_headline = (rowValues["creative_headline"] as string) || null;
    const brand_logo_asset_id = (rowValues["brand_logo_asset_id"] as string) || null;
    const landing_page_url = (rowValues["landing_page_url"] as string) || null;

    const cleanUrl = (val: unknown): string | null => {
      if (!val || typeof val !== "string") return null;
      const str = val.trim();
      if (!str || str === "[object Object]" || str.startsWith("=") || str.toUpperCase().startsWith("IMAGE(")) return null;
      if (str.startsWith("http://") || str.startsWith("https://") || str.startsWith("/")) return str;
      return null;
    };
    const resolvedMockup = cleanUrl(mockup_url) || cleanUrl(rawMockup) || null;

    skuBatch.push({
      store_id: storeId,
      sku,
      brand,
      product_type,
      mockup: resolvedMockup,
      mockup_url: resolvedMockup,
      asin,
      fnsku,
      amazon_fee,
      referral_fee_pct,
      pic_mkt,
      loai,
      niche,
      pic_idea,
      status,
      event,
      tinh_trang,
      design_pic,
      thang_listing,
      thang_danh_gia,
      event_250th,
      ngay_danh_gia_sku_event,
      amazon_fba_fee_thay_doi,
      basecost_tb,
      brand_entity_id,
      creative_asins_video,
      creative_asins_collection,
      video_media_ids,
      creative_headline,
      brand_logo_asset_id,
      landing_page_url,
    });
  });

  for (const item of skuBatch) {
    try {
      await upsertSkuMasterItem(storeId, item as SkuMasterItem, "system", channel);
      count++;
    } catch (err) {
      errors.push(`Lỗi SKU ${item.sku}: ${(err as Error).message}`);
    }
  }

  return { count, errors };
}

// ----------------- BẢNG MÃ FBM IMPORT -----------------
// Mẫu sheet "FBM_<Store>" (VD "FBM_EKASPEEK"): map cột theo TÊN tiêu đề, không theo vị trí,
// vì thứ tự cột FBM khác BẢNG MÃ FBA. Dùng chung cho file Excel và link Google Sheet.

export type SheetRows = (string | number | null)[][];

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const FBM_SKU_HEADER_MAP: Record<string, keyof SkuMasterItem | null> = {
  "brand": "brand",
  "product type": "product_type",
  "mockup": null, // =IMAGE(Mockup url) — lấy từ cột Mockup url
  "sku": "sku",
  "asin": "asin",
  "sup": "sup",
  "size": "size",
  "% referal": "referral_fee_pct",
  "% referral": "referral_fee_pct",
  "pic mkt": "pic_mkt",
  "loai": "loai",
  "ngach": "niche",
  "niche": "niche",
  "pic idea": "pic_idea",
  "trang thai": "status",
  "status": "status",
  "event": "event",
  "tinh trang": "tinh_trang",
  "basecost": "basecost",
  "base cost": "basecost",
  "shipping fee": "shipping_fee",
  "add shipping fee": "add_shipping_fee",
  "total": null, // = Basecost + Shipping fee + Add shipping fee, DB tự tính
  "mockup url": "mockup_url",
  "ngay listing": "thang_listing",
  "thang listing": "thang_listing",
  "design pic": "design_pic",
  "ngay len camp": "ngay_len_camp",
  "phan loai kich thuoc": "phan_loai_kich_thuoc",
  "amazon fba fee": "amazon_fee",
  "amazon fee": "amazon_fee",
  "basecost trung binh": "basecost_tb",
  "basecost tb": "basecost_tb",
  "brand entity id": "brand_entity_id",
  "creative asins (video)": "creative_asins_video",
  "creative asins (collection)": "creative_asins_collection",
  "video media ids": "video_media_ids",
  "creative headline": "creative_headline",
  "brand logo asset id": "brand_logo_asset_id",
  "landing page url": "landing_page_url",
};

const FBM_NUMBER_KEYS = new Set<keyof SkuMasterItem>(["basecost", "shipping_fee", "add_shipping_fee", "amazon_fee", "basecost_tb"]);

/** Chọn tab BẢNG MÃ FBM: "FBM_<Store>" / "BẢNG MÃ FBM", nếu không có thì "BẢNG MÃ". */
export function pickFbmSkuSheet(names: string[]): string | null {
  const norm = names.map((name) => ({ name, n: normalizeHeader(name) }));
  return (
    norm.find(({ n }) => n.startsWith("fbm_") || n.startsWith("fbm ") || n === "fbm" || n === "bang ma fbm")?.name ??
    norm.find(({ n }) => n === "bang ma" || n === "sku master")?.name ??
    null
  );
}

export function worksheetToRows(ws: ExcelJS.Worksheet): SheetRows {
  const rows: SheetRows = [];
  const colCount = ws.columnCount;
  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const values: (string | number | null)[] = [];
    for (let c = 1; c <= colCount; c++) values.push(getExcelCellValue(row.getCell(c)));
    rows[rowNumber - 1] = values;
  });
  return Array.from(rows, (r) => r ?? []);
}

function cellText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).replace(/\r/g, "").trim();
  return text && text !== "[object Object]" && text !== "#N/A" ? text : null;
}

/** Serial number ngày của Google Sheet / Excel (gốc 30/12/1899) → "YYYY-MM-DD". */
export function sheetSerialToIsoDate(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 20000 || value > 80000) return null;
  return new Date(Math.round((value - 25569) * 86_400_000)).toISOString().slice(0, 10);
}

function cellNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = cellText(value);
  if (!text) return null;
  const n = parseFloat(text.replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Thứ tự cột của mẫu sheet "FBM_<Store>", dùng khi xuất Excel BẢNG MÃ FBM. */
const FBM_SKU_TEMPLATE: { header: string; key: keyof SkuMasterItem | "mockup_formula" | "total_formula"; width: number }[] = [
  { header: "Brand", key: "brand", width: 14 },
  { header: "Product Type", key: "product_type", width: 18 },
  { header: "Mockup", key: "mockup_formula", width: 12 },
  { header: "SKU", key: "sku", width: 18 },
  { header: "ASIN", key: "asin", width: 14 },
  { header: "SUP", key: "sup", width: 12 },
  { header: "Size", key: "size", width: 10 },
  { header: "% Referal", key: "referral_fee_pct", width: 10 },
  { header: "PIC MKT", key: "pic_mkt", width: 12 },
  { header: "Loại", key: "loai", width: 8 },
  { header: "Ngách", key: "niche", width: 14 },
  { header: "PIC Idea", key: "pic_idea", width: 12 },
  { header: "Trạng thái", key: "status", width: 14 },
  { header: "Event", key: "event", width: 12 },
  { header: "Tinh Trang", key: "tinh_trang", width: 16 },
  { header: "Basecost", key: "basecost", width: 10 },
  { header: "Shipping fee", key: "shipping_fee", width: 11 },
  { header: "Add shipping fee", key: "add_shipping_fee", width: 14 },
  { header: "Total", key: "total_formula", width: 10 },
  { header: "Mockup url", key: "mockup_url", width: 30 },
  { header: "Ngày Listing", key: "thang_listing", width: 12 },
  { header: "DESIGN PIC", key: "design_pic", width: 12 },
  { header: "Ngày Lên Camp", key: "ngay_len_camp", width: 13 },
  { header: "Phân loại kích thước", key: "phan_loai_kich_thuoc", width: 18 },
  { header: "Amazon FBA Fee", key: "amazon_fee", width: 13 },
  { header: "Basecost trung bình", key: "basecost_tb", width: 16 },
  { header: "Brand Entity ID", key: "brand_entity_id", width: 16 },
  { header: "Creative ASINs (Video)", key: "creative_asins_video", width: 18 },
  { header: "Creative ASINs (Collection)", key: "creative_asins_collection", width: 20 },
  { header: "Video Media IDs", key: "video_media_ids", width: 16 },
  { header: "Creative Headline", key: "creative_headline", width: 24 },
  { header: "Brand Logo Asset ID", key: "brand_logo_asset_id", width: 20 },
  { header: "Landing Page URL", key: "landing_page_url", width: 24 },
];

export function createFbmSkuSheet(ws: ExcelJS.Worksheet, skus: Partial<SkuMasterItem>[]): void {
  // Các cột tham chiếu trong công thức đều nằm trong A..Z.
  const col = (key: string) => String.fromCharCode(65 + FBM_SKU_TEMPLATE.findIndex((c) => c.key === key));
  const mockupUrlCol = col("mockup_url");
  const basecostCol = col("basecost");
  const addShippingCol = col("add_shipping_fee");

  ws.columns = FBM_SKU_TEMPLATE.map((c) => ({ header: c.header, width: c.width }));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF9900" } };

  skus.forEach((item, index) => {
    const r = index + 2;
    ws.getRow(r).values = FBM_SKU_TEMPLATE.map((c) => {
      if (c.key === "mockup_formula") return item.mockup_url ? { formula: `IMAGE(${mockupUrlCol}${r},1)` } : null;
      if (c.key === "total_formula") return { formula: `SUM(${basecostCol}${r}:${addShippingCol}${r})`, result: item.total_cost ?? undefined };
      if (c.key === "thang_listing") {
        const m = item.thang_listing?.match(/^(\d{4})-(\d{2})$/);
        return m ? `${Number(m[2])}/${m[1]}` : item.thang_listing ?? null;
      }
      return (item[c.key] as string | number | null | undefined) ?? null;
    });
    ws.getCell(r, FBM_SKU_TEMPLATE.findIndex((c) => c.key === "referral_fee_pct") + 1).numFmt = "0%";
  });
}

/** Đọc các dòng của sheet BẢNG MÃ FBM thành danh sách SKU (thuần, không ghi DB). */
export function parseFbmSkuRows(rows: SheetRows): (Partial<SkuMasterItem> & { sku: string; _row: number })[] {
  // Dòng tiêu đề là dòng đầu tiên (trong 5 dòng đầu) có cột "SKU".
  const headerIndex = rows.slice(0, 5).findIndex((r) => r.some((v) => normalizeHeader(v) === "sku"));
  if (headerIndex === -1) {
    throw new ApiError('Không tìm thấy dòng tiêu đề có cột "SKU" trong sheet BẢNG MÃ FBM.', 400);
  }
  const columns = rows[headerIndex].map((h) => FBM_SKU_HEADER_MAP[normalizeHeader(h)] ?? null);

  const items: (Partial<SkuMasterItem> & { sku: string; _row: number })[] = [];
  for (const [offset, row] of rows.slice(headerIndex + 1).entries()) {
    const raw: Partial<Record<keyof SkuMasterItem, unknown>> = {};
    columns.forEach((key, i) => {
      if (key) raw[key] = row[i];
    });
    const sku = cellText(raw.sku);
    if (!sku) continue;

    const item: Partial<SkuMasterItem> & { sku: string; _row: number } = { sku, _row: headerIndex + offset + 2 };
    const fields = item as Record<string, unknown>;
    for (const key of Object.keys(raw) as (keyof SkuMasterItem)[]) {
      if (key === "sku") continue;
      const value = raw[key];
      if (FBM_NUMBER_KEYS.has(key)) fields[key] = cellNumber(value);
      else if (key === "referral_fee_pct") {
        const pct = cellNumber(value);
        item.referral_fee_pct = pct != null && pct > 1 ? pct / 100 : pct;
      } else if (key === "thang_listing") item.thang_listing = cleanMonthOnly(sheetSerialToIsoDate(value) ?? cellText(value));
      else if (key === "ngay_len_camp") item.ngay_len_camp = cleanDateOnly(sheetSerialToIsoDate(value) ?? cellText(value));
      else fields[key] = cellText(value);
    }
    const url = item.mockup_url;
    item.mockup_url = url && /^(https?:\/\/|\/)/.test(url) ? url : null;
    item.mockup = item.mockup_url;
    items.push(item);
  }
  return items;
}

export async function importFbmSkuRows(
  storeId: string,
  rows: SheetRows,
  changedBy = "system",
): Promise<{ count: number; errors: string[] }> {
  const errors: string[] = [];
  let count = 0;
  for (const item of parseFbmSkuRows(rows)) {
    try {
      await upsertSkuMasterItem(storeId, item, changedBy, "fbm");
      count++;
    } catch (err) {
      errors.push(`Lỗi SKU ${item.sku}: ${(err as Error).message}`);
    }
  }
  return { count, errors };
}

export async function importInboundShipmentsFromWorkbook(
  storeId: string,
  workbook: ExcelJS.Workbook,
): Promise<{ count: number; errors: string[] }> {
  const wsInbound = findWorksheetByName(workbook, ["CHI TIẾT ĐI HÀNG", "CHI TIET DI HANG", "INBOUND SHIPMENTS"]);
  if (!wsInbound) {
    const available = workbook.worksheets.map((w) => `"${w.name}"`).join(", ");
    throw new Error(`File không có sheet "CHI TIẾT ĐI HÀNG". Các sheet hiện có trong file: [${available}]`);
  }

  const errors: string[] = [];
  let count = 0;
  const inboundBatch: Partial<InboundShipmentItem>[] = [];

  const DEFAULT_INBOUND_COLS = [
    "brand", "sup", "ngay_request", "product_type", "mockup", "sku",
    "quantity", "line_ship", "base_cost_per_unit", "card", "tag",
    "shipping_fee", "hop_tui", "final_basecost", "total_basecost",
    "ngay_thanh_toan", "ten_lo_hang", "shipment_id", "ngay_di", "ngay_den",
    "amazon_received", "tinh_trang_hang_den_kho", "status",
    "so_luong_amazon_nhan", "discrepancy", "note", "trang_thai"
  ];

  // 1. Quét dòng 1 để map vị trí cột tự động theo Header Name
  const headerRow = wsInbound.getRow(1);
  const totalCols = Math.max(wsInbound.columnCount || 27, 27);
  const colFieldMap: Record<number, string> = {};

  for (let c = 1; c <= totalCols; c++) {
    const headerVal = getExcelCellValue(headerRow.getCell(c));
    const headerText = headerVal ? String(headerVal).trim().toLowerCase() : "";
    const mapped = INBOUND_HEADER_MAP[headerText] || (c <= DEFAULT_INBOUND_COLS.length ? DEFAULT_INBOUND_COLS[c - 1] : null);
    if (mapped) {
      colFieldMap[c] = mapped;
    }
  }

  // 2. Đọc từng dòng dữ liệu dựa trên colFieldMap
  wsInbound.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const rowValues: Record<string, any> = {};
    for (let c = 1; c <= totalCols; c++) {
      const field = colFieldMap[c];
      if (field) {
        rowValues[field] = getExcelCellValue(row.getCell(c));
      }
    }

    const skuVal = rowValues["sku"];
    if (!skuVal) return;
    const sku = String(skuVal).trim();
    if (!sku) return;

    const brand = (rowValues["brand"] as string) || null;
    const sup = (rowValues["sup"] as string) || null;
    const ngay_request = cleanDateOnly(rowValues["ngay_request"]);
    const product_type = (rowValues["product_type"] as string) || null;
    const rawMockup = rowValues["mockup"];
    const mockup = typeof rawMockup === "string" && !rawMockup.startsWith("=") ? rawMockup : null;
    const quantity = parseInteger(rowValues["quantity"]) || 0;
    const line_ship = (rowValues["line_ship"] as string) || null;
    const base_cost_per_unit = parseNumeric(rowValues["base_cost_per_unit"]);
    const card = parseNumeric(rowValues["card"]);
    const tag = parseNumeric(rowValues["tag"]);
    const shipping_fee = parseNumeric(rowValues["shipping_fee"]);
    const hop_tui = parseNumeric(rowValues["hop_tui"]);
    const final_basecost = parseNumeric(rowValues["final_basecost"]);
    const total_basecost = parseNumeric(rowValues["total_basecost"]);
    const ngay_thanh_toan = cleanDateOnly(rowValues["ngay_thanh_toan"]);
    const ten_lo_hang = (rowValues["ten_lo_hang"] as string) || null;
    const shipment_id = (rowValues["shipment_id"] as string) || null;
    const ngay_di = cleanDateOnly(rowValues["ngay_di"]);
    const ngay_den = cleanDateOnly(rowValues["ngay_den"]);
    const amazon_received = parseInteger(rowValues["amazon_received"]);
    const raw_tinh_trang = (rowValues["tinh_trang_hang_den_kho"] as string) || null;
    const raw_status = (rowValues["status"] as string) || null;
    // Đồng nhất dữ liệu: nếu người dùng gõ 1 trong 2 cột thì tự động fallback cho cột còn lại
    const tinh_trang_hang_den_kho = raw_tinh_trang || raw_status || null;
    const status = raw_status || raw_tinh_trang || null;
    const isStarShipment = Boolean(shipment_id?.trim().toLowerCase().startsWith("star"));
    const raw_so_luong_amazon_nhan = parseInteger(rowValues["so_luong_amazon_nhan"]);
    const so_luong_amazon_nhan = isStarShipment ? (quantity || 0) : raw_so_luong_amazon_nhan;
    const discrepancy = isStarShipment ? 0 : parseInteger(rowValues["discrepancy"]);
    const note = (rowValues["note"] as string) || null;
    const trang_thai = (rowValues["trang_thai"] as string) || null;

    // Bỏ qua dòng placeholder/trống không có số lượng và không có shipment_id
    if (quantity <= 0 && (!shipment_id || !shipment_id.trim())) return;

    inboundBatch.push({
      store_id: storeId,
      sku,
      brand,
      sup,
      ngay_request,
      product_type,
      mockup,
      quantity,
      line_ship,
      base_cost_per_unit,
      card,
      tag,
      shipping_fee,
      hop_tui,
      final_basecost,
      total_basecost,
      ngay_thanh_toan,
      ten_lo_hang,
      shipment_id,
      ngay_di,
      ngay_den,
      amazon_received,
      tinh_trang_hang_den_kho,
      status,
      so_luong_amazon_nhan,
      discrepancy,
      note,
      trang_thai,
    });
  });

  for (const item of inboundBatch) {
    try {
      await upsertInboundShipmentItem(storeId, item as InboundShipmentItem);
      count++;
    } catch (err) {
      errors.push(`Lỗi lô hàng ${item.shipment_id || item.sku}: ${(err as Error).message}`);
    }
  }

  // Tự động đồng bộ ngay với Check Shipment có sẵn để cập nhật tức thì trạng thái và số lượng nhận
  await syncCheckShipmentsToInbound(storeId, undefined, "system").catch(() => {});

  return { count, errors };
}

export interface CheckShipmentColumnDef {
  key: keyof CheckShipmentItem;
  header: string;
  width: number;
  align?: "left" | "center" | "right";
  bold?: boolean;
}

export const DEFAULT_CHECK_SHIPMENT_COLUMNS: CheckShipmentColumnDef[] = [
  { key: "ngay_update", header: "Ngày update", width: 14, align: "center" },
  { key: "brand", header: "Brand", width: 14, align: "center" },
  { key: "shipment_name", header: "Shipment name", width: 34, bold: true },
  { key: "shipment_id", header: "Shipment ID", width: 18, align: "center", bold: true },
  { key: "created_date", header: "Created", width: 16, align: "center" },
  { key: "last_updated_date", header: "Last updated", width: 16, align: "center" },
  { key: "ship_to", header: "Ship to", width: 12, align: "center" },
  { key: "skus_count", header: "SKUs", width: 10, align: "right" },
  { key: "units_expected", header: "Units expected", width: 15, align: "right", bold: true },
  { key: "units_located", header: "Units located", width: 15, align: "right", bold: true },
  { key: "status", header: "Status", width: 14, align: "center" },
];

export const CHECK_SHIPMENT_HEADER_MAP: Record<string, keyof CheckShipmentItem> = {
  "ngày update": "ngay_update",
  "ngay update": "ngay_update",
  "update date": "ngay_update",
  "brand": "brand",
  "store": "brand",
  "shipment name": "shipment_name",
  "tên shipment": "shipment_name",
  "ten shipment": "shipment_name",
  "shipment id": "shipment_id",
  "mã shipment": "shipment_id",
  "created": "created_date",
  "ngày tạo": "created_date",
  "ngay tao": "created_date",
  "last updated": "last_updated_date",
  "cập nhật lần cuối": "last_updated_date",
  "cap nhat lan cuoi": "last_updated_date",
  "ship to": "ship_to",
  "kho đến": "ship_to",
  "kho den": "ship_to",
  "destination": "ship_to",
  "skus": "skus_count",
  "sku": "skus_count",
  "số sku": "skus_count",
  "units expected": "units_expected",
  "dự kiến": "units_expected",
  "du kien": "units_expected",
  "boxes expected": "units_expected",
  "units located": "units_located",
  "thực nhận": "units_located",
  "thuc nhan": "units_located",
  "amazon received": "units_located",
  "boxes received": "units_located",
  "status": "status",
  "trạng thái": "status",
  "trang thai": "status",
  "discrepancy": "discrepancy",
  "chênh lệch": "discrepancy",
  "chenh lech": "discrepancy",
};

export async function listCheckShipments(
  storeId: string,
  params: {
    search?: string;
    status?: string;
    shipmentId?: string;
    page?: number;
    limit?: number;
  } = {},
): Promise<{
  items: CheckShipmentItem[];
  total: number;
  page: number;
  limit: number;
}> {
  const sql = await getDatabaseClient();
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(100, Math.max(1, params.limit || 50));
  const offset = (page - 1) * limit;

  const searchPattern = params.search ? `%${params.search.trim().toLowerCase()}%` : null;

  const countRows = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text as count
    FROM accounting_amazon_check_shipments
    WHERE store_id = ${storeId}
      AND deleted_at IS NULL
      AND (${searchPattern}::text IS NULL OR (
        LOWER(COALESCE(shipment_id, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(shipment_name, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(brand, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(ship_to, '')) LIKE ${searchPattern}
      ))
      AND (${params.status || null}::text IS NULL OR status = ${params.status || null})
      AND (${params.shipmentId || null}::text IS NULL OR shipment_id = ${params.shipmentId || null})
  `;

  const total = parseInt(countRows[0]?.count || "0", 10);

  const items = await sql<CheckShipmentItem[]>`
    SELECT
      id,
      store_id,
      ngay_update,
      brand,
      shipment_name,
      shipment_id,
      created_date,
      last_updated_date,
      ship_to,
      skus_count,
      units_expected,
      units_located,
      discrepancy,
      status,
      custom_fields,
      created_at::text,
      updated_at::text
    FROM accounting_amazon_check_shipments
    WHERE store_id = ${storeId}
      AND deleted_at IS NULL
      AND (${searchPattern}::text IS NULL OR (
        LOWER(COALESCE(shipment_id, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(shipment_name, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(brand, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(ship_to, '')) LIKE ${searchPattern}
      ))
      AND (${params.status || null}::text IS NULL OR status = ${params.status || null})
      AND (${params.shipmentId || null}::text IS NULL OR shipment_id = ${params.shipmentId || null})
    ORDER BY created_date DESC NULLS LAST, created_at DESC, id DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  return { items, total, page, limit };
}

export async function upsertCheckShipmentItem(
  storeId: string,
  data: Partial<CheckShipmentItem> & { shipment_id: string },
  changedBy = "system",
): Promise<CheckShipmentItem & { isUpdate?: boolean }> {
  const sql = await getDatabaseClient();
  const unitsExpected = Number(data.units_expected ?? 0) || 0;
  const unitsLocated = Number(data.units_located ?? 0) || 0;
  const discrepancy = data.discrepancy ?? (unitsLocated - unitsExpected);

  const cleanNgayUpdate = cleanDateOnly(data.ngay_update);
  const cleanCreatedDate = cleanDateOnly(data.created_date);
  const cleanLastUpdated = cleanDateOnly(data.last_updated_date);

  let targetId = data.id || null;
  if (!targetId && data.shipment_id?.trim()) {
    const cleanId = data.shipment_id.trim();
    const existing = await sql<{ id: string }[]>`
      SELECT id FROM accounting_amazon_check_shipments
      WHERE store_id = ${storeId}
        AND LOWER(TRIM(shipment_id)) = LOWER(${cleanId})
        AND deleted_at IS NULL
      LIMIT 1
    `;
    if (existing[0]?.id) {
      targetId = existing[0].id;
    }
  }

  if (targetId) {
    const rows = await sql<CheckShipmentItem[]>`
      UPDATE accounting_amazon_check_shipments
      SET
        ngay_update = COALESCE(${cleanNgayUpdate}, ngay_update),
        brand = COALESCE(${data.brand ?? null}, brand),
        shipment_name = COALESCE(${data.shipment_name ?? null}, shipment_name),
        shipment_id = ${data.shipment_id.trim()},
        created_date = COALESCE(${cleanCreatedDate}, created_date),
        last_updated_date = COALESCE(${cleanLastUpdated}, last_updated_date),
        ship_to = COALESCE(${data.ship_to ?? null}, ship_to),
        skus_count = COALESCE(${data.skus_count ?? null}, skus_count),
        units_expected = ${unitsExpected},
        units_located = ${unitsLocated},
        discrepancy = ${discrepancy},
        status = COALESCE(${data.status ?? null}, status),
        last_changed_by = ${changedBy},
        updated_at = NOW()
      WHERE id = ${targetId} AND store_id = ${storeId}
      RETURNING
        id, store_id, ngay_update, brand, shipment_name, shipment_id,
        created_date, last_updated_date, ship_to, skus_count,
        units_expected, units_located, discrepancy, status,
        custom_fields, created_at::text, updated_at::text
    `;
    if (rows[0]) {
      if (rows[0].shipment_id?.trim()) {
        await syncCheckShipmentsToInbound(storeId, [rows[0].shipment_id.trim()], changedBy).catch(() => {});
      }
      return { ...rows[0], isUpdate: true };
    }
  }

  const rows = await sql<CheckShipmentItem[]>`
    INSERT INTO accounting_amazon_check_shipments (
      store_id,
      ngay_update,
      brand,
      shipment_name,
      shipment_id,
      created_date,
      last_updated_date,
      ship_to,
      skus_count,
      units_expected,
      units_located,
      discrepancy,
      status,
      custom_fields,
      last_changed_by,
      updated_at
    ) VALUES (
      ${storeId},
      ${cleanNgayUpdate},
      ${data.brand ?? null},
      ${data.shipment_name ?? null},
      ${data.shipment_id.trim()},
      ${cleanCreatedDate},
      ${cleanLastUpdated},
      ${data.ship_to ?? null},
      ${data.skus_count ?? 1},
      ${unitsExpected},
      ${unitsLocated},
      ${discrepancy},
      ${data.status ?? "Working"},
      ${data.custom_fields ? JSON.stringify(data.custom_fields) : "{}"}::jsonb,
      ${changedBy},
      NOW()
    )
    RETURNING
      id, store_id, ngay_update, brand, shipment_name, shipment_id,
      created_date, last_updated_date, ship_to, skus_count,
      units_expected, units_located, discrepancy, status,
      custom_fields, created_at::text, updated_at::text
  `;
  const inserted = rows[0];
  if (inserted?.shipment_id?.trim()) {
    await syncCheckShipmentsToInbound(storeId, [inserted.shipment_id.trim()], changedBy).catch(() => {});
  }
  return { ...inserted, isUpdate: false };
}

export async function patchCheckShipmentField(
  storeId: string,
  id: string,
  field: string,
  value: any,
  changedBy = "system",
): Promise<CheckShipmentItem> {
  const sql = await getDatabaseClient();
  const trimmed = typeof value === "string" ? value.trim() : value;

  const validFields = [
    "ngay_update", "brand", "shipment_name", "shipment_id",
    "created_date", "last_updated_date", "ship_to",
    "skus_count", "units_expected", "units_located", "discrepancy", "status"
  ];
  if (!validFields.includes(field)) {
    throw new Error(`Trường '${field}' không hợp lệ.`);
  }

  const intFields = ["skus_count", "units_expected", "units_located", "discrepancy"];
  const dateFields = ["ngay_update", "created_date", "last_updated_date"];
  let val: any = trimmed === "" || trimmed == null ? null : trimmed;
  if (intFields.includes(field)) {
    val = trimmed === "" || trimmed == null ? 0 : parseInt(String(trimmed), 10);
  } else if (dateFields.includes(field)) {
    val = cleanDateOnly(trimmed);
  }

  const rows = await sql<CheckShipmentItem[]>`
    UPDATE accounting_amazon_check_shipments
    SET
      ${sql(field)} = ${val},
      last_changed_by = ${changedBy},
      updated_at = NOW()
    WHERE id = ${id} AND store_id = ${storeId}
    RETURNING
      id, store_id, ngay_update, brand, shipment_name, shipment_id,
      created_date, last_updated_date, ship_to, skus_count,
      units_expected, units_located, discrepancy, status,
      custom_fields, created_at::text, updated_at::text
  `;
  if (!rows[0]) throw new Error("Không tìm thấy Check Shipment cần cập nhật.");

  // If units_expected or units_located changed, auto-recompute discrepancy
  if (field === "units_expected" || field === "units_located") {
    const updated = rows[0];
    const diff = (updated.units_located || 0) - (updated.units_expected || 0);
    const recomputed = await sql<CheckShipmentItem[]>`
      UPDATE accounting_amazon_check_shipments
      SET discrepancy = ${diff}
      WHERE id = ${id}
      RETURNING
        id, store_id, ngay_update, brand, shipment_name, shipment_id,
        created_date, last_updated_date, ship_to, skus_count,
        units_expected, units_located, discrepancy, status,
        custom_fields, created_at::text, updated_at::text
    `;
    const recomputedRow = recomputed[0];
    if (recomputedRow?.shipment_id?.trim()) {
      await syncCheckShipmentsToInbound(storeId, [recomputedRow.shipment_id.trim()], changedBy).catch(() => {});
    }
    return recomputedRow;
  }

  if (["status", "shipment_id"].includes(field) && rows[0]?.shipment_id?.trim()) {
    await syncCheckShipmentsToInbound(storeId, [rows[0].shipment_id.trim()], changedBy).catch(() => {});
  }
  return rows[0];
}

export async function deleteCheckShipmentItem(
  id: string,
  storeId: string,
  changedBy = "system",
): Promise<boolean> {
  const sql = await getDatabaseClient();
  const rows = await sql<{ id: string }[]>`
    UPDATE accounting_amazon_check_shipments
    SET deleted_at = NOW(), last_changed_by = ${changedBy}
    WHERE id = ${id} AND store_id = ${storeId} AND deleted_at IS NULL
    RETURNING id
  `;
  return Boolean(rows[0]);
}

export async function restoreCheckShipmentItem(
  id: string,
  storeId: string,
  changedBy = "system",
): Promise<boolean> {
  const sql = await getDatabaseClient();
  const rows = await sql<{ id: string }[]>`
    UPDATE accounting_amazon_check_shipments
    SET deleted_at = NULL, last_changed_by = ${changedBy}
    WHERE id = ${id} AND store_id = ${storeId} AND deleted_at IS NOT NULL
    RETURNING id
  `;
  return Boolean(rows[0]);
}

export function createDefaultCheckShipmentSheet(
  ws: ExcelJS.Worksheet,
  items: Partial<CheckShipmentItem>[] = [],
): void {
  ws.name = "CHECK SHIPMENT AMAZON";
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const columns = DEFAULT_CHECK_SHIPMENT_COLUMNS;
  const headerRow = ws.addRow(columns.map((c) => c.header));
  headerRow.height = 26;

  headerRow.eachCell((cell, colNumber) => {
    cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
    cell.alignment = { vertical: "middle", horizontal: (columns[colNumber - 1]?.align as any) || "left" };
  });

  items.forEach((item, idx) => {
    const isEven = idx % 2 === 0;
    const r = idx + 2;
    const values = [
      cleanDateOnly(item.ngay_update),
      item.brand ?? null,
      item.shipment_name ?? null,
      item.shipment_id,
      cleanDateOnly(item.created_date),
      cleanDateOnly(item.last_updated_date),
      item.ship_to ?? null,
      item.skus_count ?? 1,
      item.units_expected ?? 0,
      item.units_located ?? 0,
      item.status ?? "Working",
    ];
    const row = ws.addRow(values);
    row.height = 21;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const colDef = columns[colNumber - 1];
      if (!colDef) return;
      cell.font = { name: "Calibri", size: 10, bold: Boolean(colDef.bold), color: { argb: "FF1E293B" } };
      cell.alignment = { vertical: "middle", horizontal: (colDef.align as any) || "left" };
      if (!isEven) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0FDFA" } };
      }
    });
  });

  columns.forEach((col, idx) => {
    ws.getColumn(idx + 1).width = col.width;
  });
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(items.length + 1, 1), column: columns.length },
  };
}

export function populateCheckShipmentWorksheet(worksheet: ExcelJS.Worksheet, items: any[]): void {
  worksheet.name = "CHECK SHIPMENT AMAZON";
  worksheet.views = [{ state: "frozen", ySplit: 1 }];

  const totalCols = Math.max(worksheet.columnCount || 12, 12);
  const colFieldMap: Record<number, string | null> = {};
  const colStyles: Record<number, Partial<ExcelJS.Style>> = {};
  const colFormulas: Record<number, string> = {};

  const headerRow = worksheet.getRow(1);
  for (let c = 1; c <= totalCols; c++) {
    const rawVal = getExcelCellValue(headerRow.getCell(c));
    const headerLower = rawVal ? String(rawVal).trim().toLowerCase() : "";
    colFieldMap[c] = (CHECK_SHIPMENT_HEADER_MAP[headerLower] as string) || (c === 2 ? "brand" : null);

    if (worksheet.rowCount >= 2) {
      const sampleCell = worksheet.getRow(2).getCell(c);
      colStyles[c] = {
        font: sampleCell.font ? { ...sampleCell.font } : undefined,
        alignment: sampleCell.alignment ? { ...sampleCell.alignment } : undefined,
        border: sampleCell.border ? { ...sampleCell.border } : undefined,
        numFmt: sampleCell.numFmt,
        fill: sampleCell.fill ? { ...sampleCell.fill } : undefined,
      };
      if (sampleCell.formula) {
        colFormulas[c] = sampleCell.formula;
      }
    }
  }

  if (worksheet.rowCount >= 2) {
    worksheet.spliceRows(2, worksheet.rowCount - 1);
  }

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    const targetRowNum = idx + 2;
    const rowValues: any[] = [];

    for (let c = 1; c <= totalCols; c++) {
      const field = colFieldMap[c];
      let val = field ? (item as any)[field] : null;

      if (field === "skus_count" || field === "units_expected" || field === "units_located" || field === "discrepancy") {
        val = val !== null && val !== undefined && val !== "" ? Number(val) : null;
      } else if (field === "ngay_update" || field === "created_date" || field === "last_updated_date") {
        val = cleanDateOnly(val);
      }

      rowValues.push(val);
    }

    const addedRow = worksheet.addRow(rowValues);
    addedRow.height = 21;
    for (let c = 1; c <= totalCols; c++) {
      const cell = addedRow.getCell(c);
      const style = colStyles[c];
      const field = colFieldMap[c];

      if (style) {
        if (style.font) cell.font = style.font;
        if (style.alignment) cell.alignment = style.alignment;
        if (style.border) cell.border = style.border;
        if (style.numFmt) cell.numFmt = style.numFmt;
        if (style.fill) cell.fill = style.fill;
      }

      if (colFormulas[c]) {
        const adaptedFormula = colFormulas[c].replace(/\b([A-Z]{1,3})2\b/g, `$1${targetRowNum}`);
        cell.value = { formula: adaptedFormula, result: cell.value as any };
      }
    }
  }

  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(items.length + 1, 1), column: totalCols },
  };
}

export async function importCheckShipmentsFromWorkbook(
  storeId: string,
  workbook: ExcelJS.Workbook,
  changedBy = "system",
): Promise<{
  count: number;
  createdCount: number;
  updatedCount: number;
  cascadeUpdatedCount: number;
  errors: string[];
}> {
  const wsCheck = findWorksheetByName(workbook, [
    "CHECK SHIPMENT AMAZON",
    "CHECK SHIPMENT",
    "CHECK_SHIPMENT",
    "SHIPMENT AMAZON",
    "CHECK SHIPMENT AMZ",
  ]);
  if (!wsCheck) {
    const available = workbook.worksheets.map((w) => `"${w.name}"`).join(", ");
    const hasSku = !!findWorksheetByName(workbook, ["BẢNG MÃ", "BANG MA", "SKU MASTER"]);
    const hasInbound = !!findWorksheetByName(workbook, ["CHI TIẾT ĐI HÀNG", "CHI TIET DI HANG"]);
    let hint = "";
    if (hasSku && !hasInbound) {
      hint = " (File bạn vừa chọn chỉ có sheet 'BẢNG MÃ'. Nếu bạn muốn nạp Bảng Mã, vui lòng đóng modal này và chuyển sang tab 'BẢNG MÃ'). Sheet 'CHECK SHIPMENT AMAZON' nằm trong file 'LIMIMA INVENTORY 2026.xlsx' (ở Downloads/Accounting/3. quản lý kho/).";
    } else if (hasInbound && !hasSku) {
      hint = " (File bạn vừa chọn có sheet 'CHI TIẾT ĐI HÀNG'. Nếu bạn muốn nạp Chi Tiết Đi Hàng, vui lòng chuyển sang tab 'CHI TIẾT ĐI HÀNG').";
    } else {
      hint = " Sheet 'CHECK SHIPMENT AMAZON' nằm trong file 'LIMIMA INVENTORY 2026.xlsx' (ở Downloads/Accounting/3. quản lý kho/).";
    }
    throw new Error(`File không có sheet "CHECK SHIPMENT AMAZON" (các sheet hiện có: [${available}]).${hint}`);
  }

  const sql = await getDatabaseClient();
  const storeRows = await sql<{ name: string }[]>`
    SELECT name FROM stores WHERE id = ${storeId} LIMIT 1
  `;
  const storeName = storeRows[0]?.name?.toLowerCase() || "";

  const errors: string[] = [];
  let count = 0;
  const batch: Partial<CheckShipmentItem>[] = [];

  const headerRow = wsCheck.getRow(1);
  const colIndexMap: Record<number, keyof CheckShipmentItem> = {};

  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const headerText = getExcelCellValue(cell);
    if (!headerText && colNumber === 2) {
      colIndexMap[colNumber] = "brand";
      return;
    }
    if (!headerText) return;
    const cleanHeader = String(headerText).trim().toLowerCase();
    const mappedKey = CHECK_SHIPMENT_HEADER_MAP[cleanHeader];
    if (mappedKey) {
      colIndexMap[colNumber] = mappedKey;
    }
  });

  if (!colIndexMap[2]) {
    colIndexMap[2] = "brand";
  }

  const rowCount = wsCheck.rowCount;
  for (let r = 2; r <= rowCount; r++) {
    const row = wsCheck.getRow(r);
    const rowValues: Record<string, unknown> = {};

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const fieldKey = colIndexMap[colNumber];
      if (fieldKey) {
        rowValues[fieldKey as string] = getExcelCellValue(cell);
      }
    });

    const shipment_id = String(rowValues["shipment_id"] || "").trim();
    const shipment_name = String(rowValues["shipment_name"] || "").trim();
    if (!shipment_id && !shipment_name) continue;

    const rowBrand = String(rowValues["brand"] || "").trim().toLowerCase();
    // If sheet has rows from multiple stores, filter for this store if brand matches
    if (rowBrand && storeName) {
      const matchesStore =
        rowBrand === storeName ||
        storeName.includes(rowBrand) ||
        rowBrand.includes(storeName);
      if (!matchesStore) {
        continue;
      }
    }

    const units_expected = parseInteger(rowValues["units_expected"]) || 0;
    const units_located = parseInteger(rowValues["units_located"]) || 0;
    const discrepancy = parseInteger(rowValues["discrepancy"]) ?? (units_located - units_expected);

    batch.push({
      ngay_update: cleanDateOnly(rowValues["ngay_update"]),
      brand: (rowValues["brand"] as string) || storeRows[0]?.name || null,
      shipment_name: shipment_name || null,
      shipment_id: shipment_id || `SHIP-${Date.now()}-${r}`,
      created_date: cleanDateOnly(rowValues["created_date"]),
      last_updated_date: cleanDateOnly(rowValues["last_updated_date"]),
      ship_to: (rowValues["ship_to"] as string) || null,
      skus_count: parseInteger(rowValues["skus_count"]) || 1,
      units_expected,
      units_located,
      discrepancy,
      status: (rowValues["status"] as string) || "Working",
    });
  }

  let createdCount = 0;
  let updatedCount = 0;
  for (const item of batch) {
    try {
      const res = await upsertCheckShipmentItem(storeId, item as any, changedBy);
      count++;
      if ((res as any)?.isUpdate) {
        updatedCount++;
      } else {
        createdCount++;
      }
    } catch (err) {
      errors.push(`Lỗi dòng ${item.shipment_id}: ${(err as Error).message}`);
    }
  }

  const cascade = await syncCheckShipmentsToInbound(storeId, undefined, changedBy);
  return { count, createdCount, updatedCount, cascadeUpdatedCount: cascade.updatedCount, errors };
}

const AMAZON_MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

export function parseAmazonDate(val: unknown): string | null {
  if (!val) return null;
  const str = String(val).trim();
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const match = str.match(/^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})/);
  if (match) {
    const mo = AMAZON_MONTHS[match[1].toLowerCase().slice(0, 3)];
    const d = match[2].padStart(2, "0");
    const y = match[3];
    if (mo) return `${y}-${mo}-${d}`;
  }
  return cleanDateOnly(str);
}

export function parseAmazonShipmentNameAndId(raw: string): {
  shipment_name: string;
  shipment_id: string;
} {
  const trimmed = (raw || "").trim();
  const match = trimmed.match(/^(.*?)\s*\((FBA[A-Z0-9]+|STAR-[A-Z0-9]+|[A-Z0-9]{10,})\)\s*$/i);
  if (match) {
    return {
      shipment_name: match[1].trim(),
      shipment_id: match[2].trim(),
    };
  }
  const parenMatch = trimmed.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  if (parenMatch && parenMatch[2].length >= 5) {
    return {
      shipment_name: parenMatch[1].trim(),
      shipment_id: parenMatch[2].trim(),
    };
  }
  return {
    shipment_name: trimmed,
    shipment_id: trimmed,
  };
}

/**
 * Đồng bộ dữ liệu từ CHECK SHIPMENT AMAZON sang CHI TIẾT ĐI HÀNG:
 * - units_located -> so_luong_amazon_nhan (KHÔNG map đè vào amazon_received)
 * - status -> status và tinh_trang_hang_den_kho
 * - created_date (cột Created của Check Shipment) -> ngay_di (cột Ngày đi của Đi Hàng)
 * - discrepancy -> (quantity - units_located)
 */
export async function syncCheckShipmentsToInbound(
  storeId: string,
  shipmentIds?: string[],
  changedBy = "system",
): Promise<{ updatedCount: number }> {
  const sql = await getDatabaseClient();
  const validIds = shipmentIds?.map((id) => id.trim().toLowerCase()).filter(Boolean);
  const idFilter =
    validIds && validIds.length > 0
      ? sql`AND LOWER(TRIM(s.shipment_id)) = ANY(${validIds})`
      : sql``;

  const updatedRows = await sql<{ id: string }[]>`
    UPDATE accounting_inbound_shipments s
    SET
      so_luong_amazon_nhan = CASE
        WHEN LOWER(TRIM(s.shipment_id)) LIKE 'star%' THEN COALESCE(s.quantity, 0)
        ELSE c.units_located
      END,
      status = CASE
        WHEN c.status IS NOT NULL AND c.status != '' AND c.status NOT LIKE '%object Object%' THEN c.status
        ELSE COALESCE(NULLIF(s.status, '[object Object]'), 'Working')
      END,
      tinh_trang_hang_den_kho = CASE
        WHEN c.status IS NOT NULL AND c.status != '' AND c.status NOT LIKE '%object Object%' THEN c.status
        WHEN s.tinh_trang_hang_den_kho LIKE '%object Object%' THEN COALESCE(NULLIF(s.status, '[object Object]'), 'Working')
        ELSE COALESCE(s.tinh_trang_hang_den_kho, s.status, 'Working')
      END,
      ngay_di = CASE
        WHEN c.created_date IS NOT NULL AND TRIM(c.created_date) != '' THEN c.created_date
        ELSE s.ngay_di
      END,
      discrepancy = CASE
        WHEN LOWER(TRIM(s.shipment_id)) LIKE 'star%' THEN 0
        ELSE COALESCE(s.quantity, 0) - COALESCE(c.units_located, 0)
      END,
      last_changed_by = ${changedBy},
      updated_at = NOW()
    FROM (
      SELECT DISTINCT ON (LOWER(TRIM(shipment_id)))
        LOWER(TRIM(shipment_id)) AS matched_shipment_id,
        units_located,
        status,
        created_date
      FROM accounting_amazon_check_shipments
      WHERE store_id = ${storeId}
        AND deleted_at IS NULL
        AND shipment_id IS NOT NULL
        AND TRIM(shipment_id) != ''
      ORDER BY LOWER(TRIM(shipment_id)), updated_at DESC
    ) c
    WHERE s.store_id = ${storeId}
      AND LOWER(TRIM(s.shipment_id)) = c.matched_shipment_id
      AND s.deleted_at IS NULL
      ${idFilter}
      AND (
        s.so_luong_amazon_nhan IS DISTINCT FROM (
          CASE
            WHEN LOWER(TRIM(s.shipment_id)) LIKE 'star%' THEN COALESCE(s.quantity, 0)
            ELSE c.units_located
          END
        ) OR
        s.status IS DISTINCT FROM c.status OR
        s.tinh_trang_hang_den_kho IS DISTINCT FROM c.status OR
        (c.created_date IS NOT NULL AND TRIM(c.created_date) != '' AND s.ngay_di IS DISTINCT FROM c.created_date) OR
        s.discrepancy IS DISTINCT FROM (
          CASE
            WHEN LOWER(TRIM(s.shipment_id)) LIKE 'star%' THEN 0
            ELSE COALESCE(s.quantity, 0) - COALESCE(c.units_located, 0)
          END
        )
      )
    RETURNING s.id
  `;

  // Luôn đảm bảo toàn bộ shipment STAR trong kho có so_luong_amazon_nhan = quantity và discrepancy = 0
  await sql`
    UPDATE accounting_inbound_shipments
    SET
      so_luong_amazon_nhan = COALESCE(quantity, 0),
      discrepancy = 0,
      updated_at = NOW()
    WHERE store_id = ${storeId}
      AND deleted_at IS NULL
      AND LOWER(TRIM(shipment_id)) LIKE 'star%'
      AND (
        so_luong_amazon_nhan IS DISTINCT FROM COALESCE(quantity, 0)
        OR discrepancy IS DISTINCT FROM 0
      )
  `;

  return { updatedCount: updatedRows.length };
}

/**
 * Đọc file CSV xuất trực tiếp từ Amazon (fba_shipments_data_page_1.csv)
 * hoặc file CSV chuẩn của Check Shipment và lưu vào DB, sau đó tự động cascade sang Đi Hàng.
 */
export async function importCheckShipmentsFromCsv(
  storeId: string,
  csvText: string,
  changedBy = "system",
): Promise<{
  count: number;
  createdCount: number;
  updatedCount: number;
  cascadeUpdatedCount: number;
  errors: string[];
}> {
  const sql = await getDatabaseClient();
  const storeRows = await sql<{ name: string }[]>`
    SELECT name FROM stores WHERE id = ${storeId} LIMIT 1
  `;
  const storeName = storeRows[0]?.name || "";

  const rows = parseCsv(csvText);
  if (!rows || rows.length < 2) {
    throw new Error("File CSV không có dữ liệu hoặc không đúng định dạng.");
  }

  const rawHeaders = rows[0];
  const headers = rawHeaders.map((h) => h.trim().toLowerCase());

  // Nhận diện định dạng Amazon Seller Central: có 'shipment name' nhưng không có cột riêng 'shipment id'
  const isAmazonFormat =
    headers.includes("shipment name") &&
    !headers.includes("shipment id") &&
    !headers.includes("shipment_id");

  const hasMappedShipmentIdentity = headers.some((header) =>
    ["shipment name", "shipment id", "shipment_id", "tên shipment", "ten shipment", "mã shipment"].includes(header),
  );
  if (!hasMappedShipmentIdentity) {
    throw new Error("CSV CHECK SHIPMENT thiếu cột nhận diện Shipment name hoặc Shipment ID; từ chối import để tránh nạp sai cột.");
  }

  const errors: string[] = [];
  let count = 0;
  let createdCount = 0;
  let updatedCount = 0;
  const todayStr = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD
  const processedShipmentIds: string[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row.some(Boolean)) continue;

    const rowObj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      rowObj[h] = row[idx] || "";
    });

    let shipmentId = "";
    let shipmentName = "";
    let status = "Working";
    let createdDate: string | null = null;
    let lastUpdatedDate: string | null = null;
    let shipTo: string | null = null;
    let skusCount = 1;
    let unitsExpected = 0;
    let unitsLocated = 0;
    let brand = storeName;

    if (isAmazonFormat) {
      const rawName = rowObj["shipment name"] || "";
      const parsed = parseAmazonShipmentNameAndId(rawName);
      shipmentId = parsed.shipment_id;
      shipmentName = parsed.shipment_name;
      status = rowObj["status"]?.trim() || "Working";
      createdDate = parseAmazonDate(rowObj["created"]);
      lastUpdatedDate = parseAmazonDate(rowObj["last updated"]);
      shipTo = rowObj["destination"]?.trim() || null;
      skusCount = parseInteger(rowObj["skus"]) || 1;
      unitsExpected = parseInteger(rowObj["units expected"]) || 0;
      unitsLocated = parseInteger(rowObj["units located"]) || 0;

      // Trích xuất brand prefix nếu có (ví dụ: "FBA ASDN ...")
      const brandMatch = shipmentName.match(/^FBA\s+([A-Za-z0-9_-]+)/i);
      if (brandMatch && brandMatch[1]) {
        brand = brandMatch[1];
      }
    } else {
      const mappedRow: Record<string, string> = {};
      rawHeaders.forEach((rawH, idx) => {
        const cleanH = rawH.trim().toLowerCase();
        const key = CHECK_SHIPMENT_HEADER_MAP[cleanH];
        if (key) {
          mappedRow[key] = row[idx] || "";
        }
      });

      shipmentId = mappedRow["shipment_id"]?.trim() || "";
      shipmentName = mappedRow["shipment_name"]?.trim() || shipmentId;
      status = mappedRow["status"]?.trim() || "Working";
      createdDate = parseAmazonDate(mappedRow["created_date"]) || cleanDateOnly(mappedRow["created_date"]);
      lastUpdatedDate = parseAmazonDate(mappedRow["last_updated_date"]) || cleanDateOnly(mappedRow["last_updated_date"]);
      shipTo = mappedRow["ship_to"]?.trim() || null;
      skusCount = parseInteger(mappedRow["skus_count"]) || 1;
      unitsExpected = parseInteger(mappedRow["units_expected"]) || 0;
      unitsLocated = parseInteger(mappedRow["units_located"]) || 0;
      brand = mappedRow["brand"]?.trim() || storeName;
    }

    if (!shipmentId && !shipmentName) continue;
    if (!shipmentId) {
      shipmentId = `SHIP-${Date.now()}-${r}`;
    }

    try {
      const res = await upsertCheckShipmentItem(
        storeId,
        {
          shipment_id: shipmentId,
          shipment_name: shipmentName || null,
          brand: brand || null,
          ngay_update: todayStr,
          created_date: createdDate,
          last_updated_date: lastUpdatedDate,
          ship_to: shipTo,
          skus_count: skusCount,
          units_expected: unitsExpected,
          units_located: unitsLocated,
          discrepancy: unitsLocated - unitsExpected,
          status,
        },
        changedBy,
      );
      count++;
      if ((res as any)?.isUpdate) {
        updatedCount++;
      } else {
        createdCount++;
      }
      processedShipmentIds.push(shipmentId);
    } catch (err) {
      errors.push(`Dòng ${r} (${shipmentId}): ${(err as Error).message}`);
    }
  }

  // Tự động đồng bộ sang CHI TIẾT ĐI HÀNG
  const cascade = await syncCheckShipmentsToInbound(
    storeId,
    processedShipmentIds.length > 0 ? processedShipmentIds : undefined,
    changedBy,
  );

  return { count, createdCount, updatedCount, cascadeUpdatedCount: cascade.updatedCount, errors };
}

// ----------------- MONTHLY BASE COST ENGINE -----------------

export function getPreviousPeriod(period: string): string {
  const parts = period.split("-");
  let y = parseInt(parts[0], 10) || new Date().getFullYear();
  let m = parseInt(parts[1], 10) || (new Date().getMonth() + 1);
  if (m <= 1) {
    m = 12;
    y -= 1;
  } else {
    m -= 1;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

/**
 * Tính Basecost tháng theo 3 nguyên tắc chuẩn:
 * 1. Nếu còn hàng tồn đầu tháng (ton > 0):
 *    - Nếu có nhập mới (nhap > 0): Bình quân gia quyền = (ton * giaTon + gtriNhap) / (ton + nhap)
 *    - Nếu không nhập (nhap = 0): Giữ nguyên đơn giá tồn đầu kỳ.
 * 2. Nếu đã hết hàng tồn (ton <= 0) và có nhập mới (nhap > 0):
 *    - Tính lại Basecost hoàn toàn theo giá nhập mới = gtriNhap / nhap, không phụ thuộc giá vốn tháng trước.
 * 3. Nếu không có tồn kho (ton <= 0) và không nhập hàng (nhap = 0):
 *    - Giữ lại Basecost trước đó làm giá tham chiếu, tránh mất dữ liệu giá vốn.
 */
export function calculateMonthlyBaseCostCore({
  slTon,
  basecostDauKy,
  slNhap,
  gtriNhap,
}: {
  slTon: number;
  basecostDauKy: number;
  slNhap: number;
  gtriNhap: number;
}) {
  const rawTon = Number(slTon);
  // Excel vẫn hiển thị tồn âm (thiếu hàng), nhưng dùng MAX(tồn, 0) khi tính
  // bình quân giá. Giữ rawTon để tháng sau tiếp tục phản ánh đúng tồn cuối Excel.
  const ton = Number.isFinite(rawTon) ? Math.max(0, rawTon) : 0;
  const giaTon = Math.max(0, Number(basecostDauKy) || 0);
  const gtriTon = ton * giaTon;

  const nhap = Math.max(0, Number(slNhap) || 0);
  const gtriN = Math.max(0, Number(gtriNhap) || 0);
  const donGiaNhap = nhap > 0 ? gtriN / nhap : 0;

  const tongSl = ton + nhap;
  const tongGtri = gtriTon + gtriN;

  let basecost = 0;
  let rule: "weighted_average" | "new_inbound_only" | "carry_over" | "existing_inventory" = "carry_over";
  let ruleLabel = "Giữ tham chiếu cũ";

  if (ton > 0 && nhap > 0) {
    basecost = tongSl > 0 ? tongGtri / tongSl : 0;
    rule = "weighted_average";
    ruleLabel = "Bình quân gia quyền (Tồn + Nhập)";
  } else if (ton > 0 && nhap === 0) {
    basecost = giaTon;
    rule = "existing_inventory";
    ruleLabel = "Theo giá tồn đầu kỳ (Không nhập)";
  } else if (ton <= 0 && nhap > 0) {
    basecost = donGiaNhap;
    rule = "new_inbound_only";
    ruleLabel = "Giá nhập mới 100% (Hết tồn cũ)";
  } else {
    basecost = giaTon;
    rule = "carry_over";
    ruleLabel = "Tham chiếu tháng trước (Không tồn/nhập)";
  }

  return {
    slTonDauKy: Number.isFinite(rawTon) ? rawTon : 0,
    basecostDauKy: giaTon,
    gtriTonDauKy: gtriTon,
    slNhap: nhap,
    gtriNhap: gtriN,
    donGiaNhapTb: donGiaNhap,
    tongSlKhaDung: tongSl,
    tongGtriKhaDung: tongGtri,
    basecostThang: basecost,
    calculationRule: rule,
    ruleLabel,
  };
}

export async function listMonthlyBaseCostPeriods(storeId: string): Promise<string[]> {
  const sql = await getDatabaseClient();
  const rows = await sql<{ period: string }[]>`
    SELECT DISTINCT period
    FROM accounting_monthly_base_cost
    WHERE store_id = ${storeId} AND deleted_at IS NULL
    UNION
    SELECT DISTINCT SUBSTRING(ngay_den FROM 1 FOR 7) as period
    FROM accounting_inbound_shipments
    WHERE store_id = ${storeId}
      AND deleted_at IS NULL
      AND ngay_den ~ '^[0-9]{4}-[0-9]{2}'
    ORDER BY period DESC
  `;
  const set = new Set(rows.map((r) => r.period).filter(Boolean));
  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  set.add(currentPeriod);
  return Array.from(set).sort().reverse();
}

export async function listMonthlyBaseCosts(
  storeId: string,
  period: string,
  search?: string,
): Promise<AccountingMonthlyBaseCostItem[]> {
  const sql = await getDatabaseClient();
  const searchPattern = search?.trim() ? `%${search.trim()}%` : null;
  return sql<AccountingMonthlyBaseCostItem[]>`
    SELECT 
      id, store_id, period, sku, sku_id, brand, product_type,
      sl_ton_dau_ky::float, basecost_dau_ky::float, gtri_ton_dau_ky::float,
      sl_nhap::float, gtri_nhap::float, don_gia_nhap_tb::float,
      tong_sl_kha_dung::float, tong_gtri_kha_dung::float, basecost_thang::float,
      calculation_rule, is_overridden, note, custom_fields, row_order,
      deleted_at::text, last_changed_by, created_at::text, updated_at::text
    FROM accounting_monthly_base_cost
    WHERE store_id = ${storeId}
      AND period = ${period}
      AND deleted_at IS NULL
      AND (
        ${searchPattern}::text IS NULL
        OR sku ILIKE ${searchPattern}
        OR brand ILIKE ${searchPattern}
        OR product_type ILIKE ${searchPattern}
      )
    ORDER BY row_order ASC, sku ASC
  `;
}

export async function upsertMonthlyBaseCostItem(
  storeId: string,
  item: {
    period: string;
    sku: string;
    sku_id?: string | null;
    brand?: string | null;
    product_type?: string | null;
    sl_ton_dau_ky?: number;
    basecost_dau_ky?: number;
    sl_nhap?: number;
    gtri_nhap?: number;
    basecost_thang?: number;
    is_overridden?: boolean;
    note?: string | null;
  },
  changedBy = "system",
): Promise<AccountingMonthlyBaseCostItem> {
  const sql = await getDatabaseClient();
  const sku = item.sku.trim();
  const period = item.period.trim();

  const calc = calculateMonthlyBaseCostCore({
    slTon: item.sl_ton_dau_ky ?? 0,
    basecostDauKy: item.basecost_dau_ky ?? 0,
    slNhap: item.sl_nhap ?? 0,
    gtriNhap: item.gtri_nhap ?? 0,
  });

  const finalBasecost = item.is_overridden && item.basecost_thang != null
    ? item.basecost_thang
    : calc.basecostThang;

  const rows = await sql<AccountingMonthlyBaseCostItem[]>`
    INSERT INTO accounting_monthly_base_cost (
      store_id, period, sku, sku_id, brand, product_type,
      sl_ton_dau_ky, basecost_dau_ky, gtri_ton_dau_ky,
      sl_nhap, gtri_nhap, don_gia_nhap_tb,
      tong_sl_kha_dung, tong_gtri_kha_dung, basecost_thang,
      calculation_rule, is_overridden, note, last_changed_by, updated_at
    ) VALUES (
      ${storeId}, ${period}, ${sku}, ${item.sku_id || null}, ${item.brand || null}, ${item.product_type || null},
      ${calc.slTonDauKy}, ${calc.basecostDauKy}, ${calc.gtriTonDauKy},
      ${calc.slNhap}, ${calc.gtriNhap}, ${calc.donGiaNhapTb},
      ${calc.tongSlKhaDung}, ${calc.tongGtriKhaDung}, ${finalBasecost},
      ${calc.calculationRule}, ${Boolean(item.is_overridden)}, ${item.note || null}, ${changedBy}, NOW()
    )
    ON CONFLICT (store_id, period, sku) DO UPDATE
    SET
      sku_id = COALESCE(EXCLUDED.sku_id, accounting_monthly_base_cost.sku_id),
      brand = COALESCE(EXCLUDED.brand, accounting_monthly_base_cost.brand),
      product_type = COALESCE(EXCLUDED.product_type, accounting_monthly_base_cost.product_type),
      sl_ton_dau_ky = EXCLUDED.sl_ton_dau_ky,
      basecost_dau_ky = EXCLUDED.basecost_dau_ky,
      gtri_ton_dau_ky = EXCLUDED.gtri_ton_dau_ky,
      sl_nhap = EXCLUDED.sl_nhap,
      gtri_nhap = EXCLUDED.gtri_nhap,
      don_gia_nhap_tb = EXCLUDED.don_gia_nhap_tb,
      tong_sl_kha_dung = EXCLUDED.tong_sl_kha_dung,
      tong_gtri_kha_dung = EXCLUDED.tong_gtri_kha_dung,
      basecost_thang = EXCLUDED.basecost_thang,
      calculation_rule = EXCLUDED.calculation_rule,
      is_overridden = EXCLUDED.is_overridden,
      note = COALESCE(EXCLUDED.note, accounting_monthly_base_cost.note),
      deleted_at = NULL,
      last_changed_by = ${changedBy},
      updated_at = NOW()
    RETURNING 
      id, store_id, period, sku, sku_id, brand, product_type,
      sl_ton_dau_ky::float, basecost_dau_ky::float, gtri_ton_dau_ky::float,
      sl_nhap::float, gtri_nhap::float, don_gia_nhap_tb::float,
      tong_sl_kha_dung::float, tong_gtri_kha_dung::float, basecost_thang::float,
      calculation_rule, is_overridden, note, custom_fields, row_order,
      deleted_at::text, last_changed_by, created_at::text, updated_at::text
  `;
  return rows[0];
}

export async function updateMonthlyBaseCostField(
  storeId: string,
  id: string,
  field: string,
  value: unknown,
  changedBy = "system",
): Promise<AccountingMonthlyBaseCostItem> {
  const sql = await getDatabaseClient();

  const currentRows = await sql<AccountingMonthlyBaseCostItem[]>`
    SELECT * FROM accounting_monthly_base_cost
    WHERE id = ${id} AND store_id = ${storeId} AND deleted_at IS NULL
  `;
  const current = currentRows[0];
  if (!current) throw new Error("Không tìm thấy bản ghi Base cost cần sửa.");

  let slTon = current.sl_ton_dau_ky;
  let giaTon = current.basecost_dau_ky;
  let slNhap = current.sl_nhap;
  let gtriNhap = current.gtri_nhap;
  let basecost = current.basecost_thang;
  let isOverridden = current.is_overridden;
  let note = current.note;

  if (field === "sl_ton_dau_ky") {
    slTon = Math.max(0, Number(value) || 0);
  } else if (field === "basecost_dau_ky") {
    giaTon = Math.max(0, Number(value) || 0);
  } else if (field === "sl_nhap") {
    slNhap = Math.max(0, Number(value) || 0);
  } else if (field === "gtri_nhap") {
    gtriNhap = Math.max(0, Number(value) || 0);
  } else if (field === "basecost_thang") {
    basecost = Math.max(0, Number(value) || 0);
    isOverridden = true;
  } else if (field === "note") {
    note = value ? String(value) : null;
  }

  // Tự động tính toán lại nếu không phải người dùng sửa đè trực tiếp ô basecost_thang
  const calc = calculateMonthlyBaseCostCore({
    slTon,
    basecostDauKy: giaTon,
    slNhap,
    gtriNhap,
  });

  if (field !== "basecost_thang" && isOverridden) {
    // Nếu trước đó bị override nhưng giờ sửa sl tồn hoặc sl nhập, hỏi hoặc cập nhật lại
    // Ở đây ta tính lại tự động nếu user sửa số lượng/chi phí
    isOverridden = false;
  }

  const finalBasecost = isOverridden ? basecost : calc.basecostThang;

  const rows = await sql<AccountingMonthlyBaseCostItem[]>`
    UPDATE accounting_monthly_base_cost
    SET
      sl_ton_dau_ky = ${calc.slTonDauKy},
      basecost_dau_ky = ${calc.basecostDauKy},
      gtri_ton_dau_ky = ${calc.gtriTonDauKy},
      sl_nhap = ${calc.slNhap},
      gtri_nhap = ${calc.gtriNhap},
      don_gia_nhap_tb = ${calc.donGiaNhapTb},
      tong_sl_kha_dung = ${calc.tongSlKhaDung},
      tong_gtri_kha_dung = ${calc.tongGtriKhaDung},
      basecost_thang = ${finalBasecost},
      calculation_rule = ${calc.calculationRule},
      is_overridden = ${isOverridden},
      note = ${note ?? null},
      last_changed_by = ${changedBy},
      updated_at = NOW()
    WHERE id = ${id} AND store_id = ${storeId} AND deleted_at IS NULL
    RETURNING 
      id, store_id, period, sku, sku_id, brand, product_type,
      sl_ton_dau_ky::float, basecost_dau_ky::float, gtri_ton_dau_ky::float,
      sl_nhap::float, gtri_nhap::float, don_gia_nhap_tb::float,
      tong_sl_kha_dung::float, tong_gtri_kha_dung::float, basecost_thang::float,
      calculation_rule, is_overridden, note, custom_fields, row_order,
      deleted_at::text, last_changed_by, created_at::text, updated_at::text
  `;
  return rows[0];
}

export async function deleteMonthlyBaseCostItem(
  storeId: string,
  id: string,
  changedBy = "system",
): Promise<boolean> {
  const sql = await getDatabaseClient();
  const res = await sql`
    UPDATE accounting_monthly_base_cost
    SET deleted_at = NOW(), last_changed_by = ${changedBy}, updated_at = NOW()
    WHERE id = ${id} AND store_id = ${storeId} AND deleted_at IS NULL
  `;
  return res.count > 0;
}

/**
 * Tự động tổng hợp số liệu nhập trong tháng từ bảng CHI TIẾT ĐI HÀNG (theo ngay_den),
 * lấy đơn giá tồn từ tháng trước (hoặc Bảng Mã nếu chưa có), kết hợp với số lượng tồn kho đầu kỳ
 * và tính Basecost tháng theo 3 nguyên tắc chuẩn.
 */
export async function syncMonthlyBaseCostFromInbound(
  storeId: string,
  period: string,
  changedBy = "system",
): Promise<{ syncedCount: number; errors: string[] }> {
  const sql = await getDatabaseClient();
  const errors: string[] = [];

  // 1. Lấy tất cả lô hàng trong tháng period (theo ngay_den)
  const inboundRows = await sql<{
    sku: string;
    brand: string | null;
    product_type: string | null;
    total_qty: number;
    total_cost: number;
  }[]>`
    SELECT 
      sku,
      MAX(brand) as brand,
      MAX(product_type) as product_type,
      COALESCE(SUM(quantity), 0)::float as total_qty,
      COALESCE(SUM(COALESCE(total_basecost, final_basecost * quantity, 0)), 0)::float as total_cost
    FROM accounting_inbound_shipments
    WHERE store_id = ${storeId}
      AND deleted_at IS NULL
      AND (
        ngay_den LIKE ${period + '%'}
        OR ngay_den LIKE ${period.replace('-', '/') + '%'}
      )
    GROUP BY sku
  `;

  const inboundMap = new Map<string, { brand: string | null; product_type: string | null; qty: number; cost: number }>();
  for (const r of inboundRows) {
    if (!r.sku) continue;
    inboundMap.set(r.sku.trim(), {
      brand: r.brand,
      product_type: r.product_type,
      qty: r.total_qty,
      cost: r.total_cost,
    });
  }

  // 2. Lấy tất cả SKUs trong SKU Master của store
  const skuMasters = await sql<{
    id: string;
    sku: string;
    brand: string | null;
    product_type: string | null;
    basecost_tb: number | null;
  }[]>`
    SELECT id, sku, brand, product_type, basecost_tb::float
    FROM accounting_sku_master
    WHERE store_id = ${storeId} AND deleted_at IS NULL
  `;

  const allSkuMap = new Map<string, { id?: string; brand?: string | null; product_type?: string | null; fallbackBasecost: number }>();
  for (const sm of skuMasters) {
    allSkuMap.set(sm.sku.trim(), {
      id: sm.id,
      brand: sm.brand,
      product_type: sm.product_type,
      fallbackBasecost: 0,
    });
  }
  for (const [inboundSku, data] of inboundMap.entries()) {
    if (!allSkuMap.has(inboundSku)) {
      allSkuMap.set(inboundSku, {
        brand: data.brand,
        product_type: data.product_type,
        fallbackBasecost: 0,
      });
    }
  }

  // 3. Lấy dữ liệu tháng trước (period - 1 tháng) để lấy đơn giá tồn đầu kỳ
  const prevPeriod = getPreviousPeriod(period);
  const prevMonthRows = await sql<{
    sku: string;
    basecost_thang: number;
  }[]>`
    SELECT sku, basecost_thang::float
    FROM accounting_monthly_base_cost
    WHERE store_id = ${storeId}
      AND period = ${prevPeriod}
      AND deleted_at IS NULL
  `;
  const prevMonthMap = new Map<string, number>();
  for (const r of prevMonthRows) {
    prevMonthMap.set(r.sku.trim(), r.basecost_thang);
  }

  // 4. Lấy tồn kho thực tế từ báo cáo tồn kho (FBA + AWD) chốt vào cuối tháng trước
  // Ví dụ period = "2026-10" thì tìm snapshot_date <= "2026-09-30" (hoặc snapshot gần nhất trước ngày 1 của tháng)
  const [pYear, pMonth] = period.split("-").map(Number);
  const firstDayOfMonth = `${period}-01`;
  const lastDayOfPrevMonthDate = new Date(Date.UTC(pYear, pMonth - 1, 0));
  const defaultPrevMonthLastDay = lastDayOfPrevMonthDate.toISOString().slice(0, 10);

  // Tìm ngày snapshot gần nhất có dữ liệu tồn kho <= firstDayOfMonth
  const latestSnapshotRows = await sql<{ snapshot_date: string }[]>`
    SELECT snapshot_date::text
    FROM (
      SELECT snapshot_date FROM accounting_inventory_ledger WHERE store_id = ${storeId} AND snapshot_date < ${firstDayOfMonth}
      UNION
      SELECT snapshot_date FROM accounting_awd_inventory_ledger WHERE store_id = ${storeId} AND snapshot_date < ${firstDayOfMonth}
    ) s
    ORDER BY snapshot_date DESC
    LIMIT 1
  `;
  const targetLedgerSnapshot = latestSnapshotRows[0]?.snapshot_date || defaultPrevMonthLastDay;

  // Lấy tổng tồn FBA theo SKU tại ngày snapshot
  const fbaLedgerRows = await sql<{ sku: string; fba_ton: number }[]>`
    SELECT sku, COALESCE(SUM(ending_warehouse_balance + in_transit_between_warehouses), 0)::float as fba_ton
    FROM accounting_inventory_ledger
    WHERE store_id = ${storeId} AND snapshot_date = ${targetLedgerSnapshot}
    GROUP BY sku
  `;
  const ledgerStockMap = new Map<string, number>();
  for (const r of fbaLedgerRows) {
    if (!r.sku) continue;
    ledgerStockMap.set(r.sku.trim(), (ledgerStockMap.get(r.sku.trim()) || 0) + r.fba_ton);
  }

  // Lấy tổng tồn AWD theo SKU tại ngày snapshot (hoặc snapshot AWD gần nhất)
  const awdLedgerRows = await sql<{ sku: string; awd_ton: number }[]>`
    SELECT sku, COALESCE(SUM(ton_kho_units), 0)::float as awd_ton
    FROM accounting_awd_inventory_ledger
    WHERE store_id = ${storeId} AND snapshot_date <= ${targetLedgerSnapshot}
    GROUP BY sku
  `;
  for (const r of awdLedgerRows) {
    if (!r.sku) continue;
    ledgerStockMap.set(r.sku.trim(), (ledgerStockMap.get(r.sku.trim()) || 0) + r.awd_ton);
  }

  // 5. Lấy các bản ghi hiện tại của tháng này
  const currentMonthRows = await sql<{
    sku: string;
    sl_ton_dau_ky: number;
    basecost_dau_ky: number;
    is_overridden: boolean;
    basecost_thang: number;
    note: string | null;
  }[]>`
    SELECT sku, sl_ton_dau_ky::float, basecost_dau_ky::float, is_overridden, basecost_thang::float, note
    FROM accounting_monthly_base_cost
    WHERE store_id = ${storeId}
      AND period = ${period}
      AND deleted_at IS NULL
  `;
  const currentMonthMap = new Map<string, { sl_ton_dau_ky: number; basecost_dau_ky: number; is_overridden: boolean; basecost_thang: number; note: string | null }>();
  for (const r of currentMonthRows) {
    currentMonthMap.set(r.sku.trim(), {
      sl_ton_dau_ky: r.sl_ton_dau_ky,
      basecost_dau_ky: r.basecost_dau_ky,
      is_overridden: r.is_overridden,
      basecost_thang: r.basecost_thang,
      note: r.note,
    });
  }

  let syncedCount = 0;

  // 6. Tính toán và UPSERT cho từng SKU
  for (const [sku, meta] of allSkuMap.entries()) {
    try {
      const existing = currentMonthMap.get(sku);
      const inbound = inboundMap.get(sku);

      // Số lượng tồn đầu kỳ: ưu tiên lấy từ báo cáo tồn kho (FBA + AWD) của ngày chốt cuối tháng trước.
      // Nếu có dữ liệu trong báo cáo Ledger (>= 0) thì dùng số thực tế này.
      // Nếu không có trong ledger thì fallback theo số đã lưu (nếu > 0) hoặc 0.
      let slTon = 0;
      if (ledgerStockMap.has(sku)) {
        slTon = ledgerStockMap.get(sku)!;
      } else if (existing && existing.sl_ton_dau_ky > 0) {
        slTon = existing.sl_ton_dau_ky;
      }

      // Đơn giá tồn đầu kỳ: ưu tiên tháng trước -> nếu không có thì lấy fallbackBasecost từ Bảng Mã -> nếu có existing.basecost_dau_ky > 0 thì giữ
      let basecostDauKy = 0;
      if (prevMonthMap.has(sku)) {
        basecostDauKy = prevMonthMap.get(sku)!;
      } else if (existing && existing.basecost_dau_ky > 0) {
        basecostDauKy = existing.basecost_dau_ky;
      } else {
        basecostDauKy = meta.fallbackBasecost;
      }

      // Hàng nhập trong tháng từ Chi Tiết Đi Hàng
      const slNhap = inbound ? inbound.qty : 0;
      const gtriNhap = inbound ? inbound.cost : 0;

      // Áp dụng công thức 3 nguyên tắc
      const calc = calculateMonthlyBaseCostCore({
        slTon,
        basecostDauKy,
        slNhap,
        gtriNhap,
      });

      // Nếu user đã chủ động override basecost thì giữ nguyên basecost_thang của họ
      const finalBasecost = existing?.is_overridden ? existing.basecost_thang : calc.basecostThang;
      const isOverridden = existing?.is_overridden || false;

      await sql`
        INSERT INTO accounting_monthly_base_cost (
          store_id, period, sku, sku_id, brand, product_type,
          sl_ton_dau_ky, basecost_dau_ky, gtri_ton_dau_ky,
          sl_nhap, gtri_nhap, don_gia_nhap_tb,
          tong_sl_kha_dung, tong_gtri_kha_dung, basecost_thang,
          calculation_rule, is_overridden, note, last_changed_by, updated_at
        ) VALUES (
          ${storeId}, ${period}, ${sku}, ${meta.id || null}, ${meta.brand || inbound?.brand || null}, ${meta.product_type || inbound?.product_type || null},
          ${calc.slTonDauKy}, ${calc.basecostDauKy}, ${calc.gtriTonDauKy},
          ${calc.slNhap}, ${calc.gtriNhap}, ${calc.donGiaNhapTb},
          ${calc.tongSlKhaDung}, ${calc.tongGtriKhaDung}, ${finalBasecost},
          ${calc.calculationRule}, ${isOverridden}, ${existing?.note || null}, ${changedBy}, NOW()
        )
        ON CONFLICT (store_id, period, sku) DO UPDATE
        SET
          sku_id = EXCLUDED.sku_id,
          brand = COALESCE(EXCLUDED.brand, accounting_monthly_base_cost.brand),
          product_type = COALESCE(EXCLUDED.product_type, accounting_monthly_base_cost.product_type),
          sl_ton_dau_ky = EXCLUDED.sl_ton_dau_ky,
          basecost_dau_ky = EXCLUDED.basecost_dau_ky,
          gtri_ton_dau_ky = EXCLUDED.gtri_ton_dau_ky,
          sl_nhap = EXCLUDED.sl_nhap,
          gtri_nhap = EXCLUDED.gtri_nhap,
          don_gia_nhap_tb = EXCLUDED.don_gia_nhap_tb,
          tong_sl_kha_dung = EXCLUDED.tong_sl_kha_dung,
          tong_gtri_kha_dung = EXCLUDED.tong_gtri_kha_dung,
          basecost_thang = CASE 
            WHEN accounting_monthly_base_cost.is_overridden THEN accounting_monthly_base_cost.basecost_thang
            ELSE EXCLUDED.basecost_thang
          END,
          calculation_rule = EXCLUDED.calculation_rule,
          last_changed_by = ${changedBy},
          updated_at = NOW()
        WHERE accounting_monthly_base_cost.deleted_at IS NULL
      `;
      syncedCount++;
    } catch (err) {
      errors.push(`SKU ${sku}: ${(err as Error).message}`);
    }
  }

  return { syncedCount, errors };
}

/**
 * Cập nhật Basecost tháng vừa tính vào cột basecost_tb của bảng BẢNG MÃ (accounting_sku_master)
 */
export async function applyMonthlyBaseCostToSkuMaster(
  storeId: string,
  period: string,
  changedBy = "system",
): Promise<{ updatedCount: number }> {
  const sql = await getDatabaseClient();
  const res = await sql`
    UPDATE accounting_sku_master asm
    SET 
      basecost_tb = mbc.basecost_thang,
      last_changed_by = ${changedBy},
      updated_at = NOW()
    FROM accounting_monthly_base_cost mbc
    WHERE asm.store_id = ${storeId}
      AND mbc.store_id = ${storeId}
      AND mbc.period = ${period}
      AND asm.sku = mbc.sku
      AND mbc.deleted_at IS NULL
      AND asm.deleted_at IS NULL
      AND mbc.basecost_thang > 0
  `;
  return { updatedCount: res.count };
}

export interface YearlyBaseCostMonthCell {
  id?: string;
  period: string;
  basecost: number;
  sl_nhap: number;
  gtri_nhap: number;
  don_gia_nhap_tb: number;
  sl_ton_dau_ky: number;
  basecost_dau_ky: number;
  is_overridden: boolean;
  calculation_rule: string;
  has_shipment: boolean;
  note?: string | null;
}

export interface YearlyBaseCostRow {
  sku: string;
  sku_id: string | null;
  brand: string | null;
  product_type: string | null;
  mockup: string | null;
  mockup_url: string | null;
  asin: string | null;
  hang_ton_dau_nam: number;
  gia_von_dau_nam: number;
  months: Record<number, YearlyBaseCostMonthCell>;
  sparkline_points: number[];
}

/**
 * Lấy ma trận Basecost 12 tháng của cả năm theo đúng bố cục Google Sheets:
 * Product Type | Mockup | SKU | ASIN | Hàng tồn 1/1/YYYY | Trung bình giá 1/1/YYYY | Biến động basecost (sparkline) | Basecost tháng 1 .. tháng 12
 */
export async function getYearlyBaseCostMatrix(
  storeId: string,
  year: number,
  search?: string,
): Promise<{ year: number; rows: YearlyBaseCostRow[] }> {
  const sql = await getDatabaseClient();

  // 1. Lấy danh sách SKU Master
  const skuRows = await sql<{
    id: string;
    sku: string;
    brand: string | null;
    product_type: string | null;
    mockup: string | null;
    mockup_url: string | null;
    asin: string | null;
    basecost_tb: number | null;
  }[]>`
    SELECT 
      id, sku, brand, product_type, mockup, mockup_url, asin, basecost_tb::float
    FROM accounting_sku_master
    WHERE store_id = ${storeId} AND deleted_at IS NULL
    ORDER BY COALESCE(row_order, 0) ASC, sku ASC
  `;

  // 2. Lấy dữ liệu 12 tháng từ bảng accounting_monthly_base_cost
  const monthlyRows = await sql<AccountingMonthlyBaseCostItem[]>`
    SELECT 
      id, store_id, period, sku, sku_id, brand, product_type,
      sl_ton_dau_ky::float, basecost_dau_ky::float, gtri_ton_dau_ky::float,
      sl_nhap::float, gtri_nhap::float, don_gia_nhap_tb::float,
      tong_sl_kha_dung::float, tong_gtri_kha_dung::float, basecost_thang::float,
      calculation_rule, is_overridden, note, custom_fields, row_order,
      deleted_at::text, last_changed_by, created_at::text, updated_at::text
    FROM accounting_monthly_base_cost
    WHERE store_id = ${storeId}
      AND period >= ${`${year}-01`}
      AND period <= ${`${year}-12`}
      AND deleted_at IS NULL
  `;

  // Map: `${sku}__${monthNum}` => row
  const monthlyMap = new Map<string, AccountingMonthlyBaseCostItem>();
  for (const r of monthlyRows) {
    const mNum = parseInt(r.period.split("-")[1], 10);
    monthlyMap.set(`${r.sku.trim()}__${mNum}`, r);
  }

  // 3. Lấy thông tin lô hàng từ Chi Tiết Đi Hàng trong năm (theo ngay_den hoặc ngay_request)
  const inboundRows = await sql<{
    sku: string;
    period: string;
    shipment_count: number;
    qty: number;
    cost: number;
  }[]>`
    SELECT 
      sku,
      SUBSTRING(COALESCE(ngay_den, ngay_request), 1, 7) as period,
      COUNT(*)::int as shipment_count,
      SUM(quantity)::float as qty,
      SUM(COALESCE(total_basecost, final_basecost * quantity, 0))::float as cost
    FROM accounting_inbound_shipments
    WHERE store_id = ${storeId}
      AND deleted_at IS NULL
      AND (
        ngay_den LIKE ${`${year}-%`}
        OR (ngay_den IS NULL AND ngay_request LIKE ${`${year}-%`})
      )
    GROUP BY sku, SUBSTRING(COALESCE(ngay_den, ngay_request), 1, 7)
  `;

  // Map: `${sku}__${monthNum}` => inbound
  const inboundMap = new Map<string, { qty: number; cost: number; shipment_count: number }>();
  for (const ib of inboundRows) {
    if (!ib.sku || !ib.period) continue;
    const parts = ib.period.split("-");
    if (parts.length === 2) {
      const mNum = parseInt(parts[1], 10);
      inboundMap.set(`${ib.sku.trim()}__${mNum}`, {
        qty: ib.qty,
        cost: ib.cost,
        shipment_count: ib.shipment_count,
      });
    }
  }

  // 4. Lấy đơn giá lô hàng đầu tiên để fallback làm giá đầu năm nếu chưa có
  const firstShipments = await sql<{
    sku: string;
    first_cost: number;
  }[]>`
    SELECT DISTINCT ON (sku)
      sku,
      COALESCE(final_basecost, base_cost_per_unit, 0)::float as first_cost
    FROM accounting_inbound_shipments
    WHERE store_id = ${storeId}
      AND deleted_at IS NULL
      AND COALESCE(final_basecost, base_cost_per_unit, 0) > 0
    ORDER BY sku, COALESCE(ngay_den, ngay_request) ASC
  `;
  const firstCostMap = new Map<string, number>();
  for (const fs of firstShipments) {
    if (fs.sku) firstCostMap.set(fs.sku.trim(), fs.first_cost);
  }

  // 5. Build từng dòng SKU
  const rows: YearlyBaseCostRow[] = [];

  for (const s of skuRows) {
    const sku = s.sku.trim();
    const m1Record = monthlyMap.get(`${sku}__1`);

    // Hàng tồn & Trung bình giá 1/1/YYYY
    const hangTonDauNam = m1Record ? m1Record.sl_ton_dau_ky : 0;
    let giaVonDauNam = 0;
    if (m1Record && m1Record.basecost_dau_ky > 0) {
      giaVonDauNam = m1Record.basecost_dau_ky;
    } else if (firstCostMap.has(sku)) {
      // Bảng mã không có giá base, giá base gốc 100% lấy từ lô hàng đầu tiên trong Chi Tiết Đi Hàng
      giaVonDauNam = firstCostMap.get(sku)!;
    }

    let runningCost = giaVonDauNam;
    const monthsObj: Record<number, YearlyBaseCostMonthCell> = {};
    const sparklinePoints: number[] = [];

    for (let m = 1; m <= 12; m++) {
      const periodStr = `${year}-${String(m).padStart(2, "0")}`;
      const mRecord = monthlyMap.get(`${sku}__${m}`);
      const ib = inboundMap.get(`${sku}__${m}`);
      const hasShipment = Boolean(ib && ib.qty > 0);

      let cellCost = 0;
      let isOverridden = false;
      let calcRule = "carry_over";
      let slNhap = ib ? ib.qty : 0;
      let gtriNhap = ib ? ib.cost : 0;
      let donGiaNhapTb = slNhap > 0 ? gtriNhap / slNhap : 0;
      let slTonDauKy = 0;
      let basecostDauKy = runningCost;
      let note: string | null = null;
      let id: string | undefined = undefined;

      if (mRecord) {
        id = mRecord.id;
        cellCost = mRecord.basecost_thang;
        isOverridden = mRecord.is_overridden;
        calcRule = mRecord.calculation_rule;
        slNhap = mRecord.sl_nhap;
        gtriNhap = mRecord.gtri_nhap;
        donGiaNhapTb = mRecord.don_gia_nhap_tb;
        slTonDauKy = mRecord.sl_ton_dau_ky;
        basecostDauKy = mRecord.basecost_dau_ky;
        note = mRecord.note ?? null;
        runningCost = cellCost;
      } else {
        // Chưa có trong DB: tự tính toán theo quy tắc
        if (hasShipment && ib) {
          cellCost = Number((ib.cost / ib.qty).toFixed(2));
          calcRule = "new_inbound_only";
          runningCost = cellCost;
        } else {
          cellCost = runningCost;
          calcRule = "carry_over";
        }
      }

      monthsObj[m] = {
        id,
        period: periodStr,
        basecost: cellCost,
        sl_nhap: slNhap,
        gtri_nhap: gtriNhap,
        don_gia_nhap_tb: donGiaNhapTb,
        sl_ton_dau_ky: slTonDauKy,
        basecost_dau_ky: basecostDauKy,
        is_overridden: isOverridden,
        calculation_rule: calcRule,
        has_shipment: hasShipment,
        note,
      };

      sparklinePoints.push(cellCost);
    }

    rows.push({
      sku,
      sku_id: s.id,
      brand: s.brand,
      product_type: s.product_type,
      mockup: s.mockup,
      mockup_url: s.mockup_url,
      asin: s.asin,
      hang_ton_dau_nam: hangTonDauNam,
      gia_von_dau_nam: giaVonDauNam,
      months: monthsObj,
      sparkline_points: sparklinePoints,
    });
  }

  // Lọc theo search nếu có
  let filteredRows = rows;
  if (search && search.trim()) {
    const term = search.trim().toLowerCase();
    filteredRows = rows.filter(
      (r) =>
        r.sku.toLowerCase().includes(term) ||
        (r.asin && r.asin.toLowerCase().includes(term)) ||
        (r.product_type && r.product_type.toLowerCase().includes(term)) ||
        (r.brand && r.brand.toLowerCase().includes(term)),
    );
  }

  return { year, rows: filteredRows };
}

/**
 * Tự động tính toán chuỗi 12 tháng liên tục cho toàn bộ SKUs của một năm từ bảng CHI TIẾT ĐI HÀNG
 */
export async function syncYearlyBaseCostFromInbound(
  storeId: string,
  year: number,
  changedBy = "system",
): Promise<{ totalSynced: number; months: string[]; errors: string[] }> {
  const months: string[] = [];
  let totalSynced = 0;
  const allErrors: string[] = [];

  for (let m = 1; m <= 12; m++) {
    const period = `${year}-${String(m).padStart(2, "0")}`;
    months.push(period);
    try {
      const res = await syncMonthlyBaseCostFromInbound(storeId, period, changedBy);
      totalSynced += res.syncedCount;
      if (res.errors.length > 0) {
        allErrors.push(...res.errors);
      }
    } catch (err) {
      allErrors.push(`Tháng ${period}: ${(err as Error).message}`);
    }
  }

  return { totalSynced, months, errors: allErrors };
}

/**
 * Cập nhật số lượng tồn hoặc trung bình giá đầu năm (1/1/YYYY) của SKU,
 * sau đó tự động kích hoạt tính toán dây chuyền (cascade) cho 12 tháng.
 */
export async function updateYearlyInitialValues(
  storeId: string,
  year: number,
  sku: string,
  data: { hang_ton?: number; gia_von?: number },
  changedBy = "system",
): Promise<{ success: boolean }> {
  const sql = await getDatabaseClient();
  const periodM1 = `${year}-01`;

  // 1. Kiểm tra bản ghi tháng 1 đã có chưa
  const existingRows = await sql<{ id: string; sl_ton_dau_ky: number; basecost_dau_ky: number }[]>`
    SELECT id, sl_ton_dau_ky::float, basecost_dau_ky::float
    FROM accounting_monthly_base_cost
    WHERE store_id = ${storeId} AND period = ${periodM1} AND sku = ${sku} AND deleted_at IS NULL
  `;

  const newSlTon = data.hang_ton !== undefined ? Number(data.hang_ton) : (existingRows[0]?.sl_ton_dau_ky || 0);
  const newGiaTon = data.gia_von !== undefined ? Number(data.gia_von) : (existingRows[0]?.basecost_dau_ky || 0);

  if (existingRows.length > 0) {
    await updateMonthlyBaseCostField(
      storeId,
      existingRows[0].id,
      data.hang_ton !== undefined ? "sl_ton_dau_ky" : "basecost_dau_ky",
      data.hang_ton !== undefined ? newSlTon : newGiaTon,
      changedBy,
    );
  } else {
    // Tạo mới tháng 1
    const skuMaster = await sql<{ id: string; brand: string | null; product_type: string | null }[]>`
      SELECT id, brand, product_type FROM accounting_sku_master
      WHERE store_id = ${storeId} AND sku = ${sku} AND deleted_at IS NULL LIMIT 1
    `;
    const calc = calculateMonthlyBaseCostCore({
      slTon: newSlTon,
      basecostDauKy: newGiaTon,
      slNhap: 0,
      gtriNhap: 0,
    });

    await sql`
      INSERT INTO accounting_monthly_base_cost (
        store_id, period, sku, sku_id, brand, product_type,
        sl_ton_dau_ky, basecost_dau_ky, gtri_ton_dau_ky,
        sl_nhap, gtri_nhap, don_gia_nhap_tb,
        tong_sl_kha_dung, tong_gtri_kha_dung, basecost_thang,
        calculation_rule, is_overridden, last_changed_by, updated_at
      ) VALUES (
        ${storeId}, ${periodM1}, ${sku}, ${skuMaster[0]?.id || null}, ${skuMaster[0]?.brand || null}, ${skuMaster[0]?.product_type || null},
        ${calc.slTonDauKy}, ${calc.basecostDauKy}, ${calc.gtriTonDauKy},
        0, 0, 0,
        ${calc.tongSlKhaDung}, ${calc.tongGtriKhaDung}, ${calc.basecostThang},
        ${calc.calculationRule}, false, ${changedBy}, NOW()
      )
    `;
  }

  // 2. Cascade tính tiếp từ tháng 2 đến tháng 12
  for (let m = 2; m <= 12; m++) {
    const p = `${year}-${String(m).padStart(2, "0")}`;
    await syncMonthlyBaseCostFromInbound(storeId, p, changedBy);
  }

  return { success: true };
}

/**
 * Sửa trực tiếp Basecost của một tháng cụ thể cho một SKU
 */
export async function updateYearlyMonthBaseCost(
  storeId: string,
  year: number,
  month: number,
  sku: string,
  basecost: number,
  changedBy = "system",
): Promise<{ success: boolean }> {
  const sql = await getDatabaseClient();
  const period = `${year}-${String(month).padStart(2, "0")}`;

  const existing = await sql<{ id: string }[]>`
    SELECT id FROM accounting_monthly_base_cost
    WHERE store_id = ${storeId} AND period = ${period} AND sku = ${sku} AND deleted_at IS NULL
  `;

  if (existing.length > 0) {
    await updateMonthlyBaseCostField(
      storeId,
      existing[0].id,
      "basecost_thang",
      basecost,
      changedBy,
    );
  } else {
    const skuMaster = await sql<{ id: string; brand: string | null; product_type: string | null }[]>`
      SELECT id, brand, product_type FROM accounting_sku_master
      WHERE store_id = ${storeId} AND sku = ${sku} AND deleted_at IS NULL LIMIT 1
    `;
    await sql`
      INSERT INTO accounting_monthly_base_cost (
        store_id, period, sku, sku_id, brand, product_type,
        sl_ton_dau_ky, basecost_dau_ky, gtri_ton_dau_ky,
        sl_nhap, gtri_nhap, don_gia_nhap_tb,
        tong_sl_kha_dung, tong_gtri_kha_dung, basecost_thang,
        calculation_rule, is_overridden, last_changed_by, updated_at
      ) VALUES (
        ${storeId}, ${period}, ${sku}, ${skuMaster[0]?.id || null}, ${skuMaster[0]?.brand || null}, ${skuMaster[0]?.product_type || null},
        0, ${basecost}, 0,
        0, 0, 0,
        0, 0, ${basecost},
        'manual_override', true, ${changedBy}, NOW()
      )
    `;
  }

  // Cascade cho các tháng tiếp theo (month + 1 .. 12)
  for (let m = month + 1; m <= 12; m++) {
    const p = `${year}-${String(m).padStart(2, "0")}`;
    await syncMonthlyBaseCostFromInbound(storeId, p, changedBy);
  }

  return { success: true };
}

/**
 * Cập nhật Số lượng tồn đầu kỳ (sl_ton_dau_ky) của một tháng cụ thể cho SKU,
 * sau đó tự động tính toán lại Basecost tháng theo công thức bình quân gia quyền
 * và cascade tiếp cho các tháng còn lại trong năm.
 */
export async function updateYearlyMonthSlTon(
  storeId: string,
  year: number,
  month: number,
  sku: string,
  slTon: number,
  changedBy = "system",
): Promise<{ success: boolean }> {
  const sql = await getDatabaseClient();
  const period = `${year}-${String(month).padStart(2, "0")}`;

  const existing = await sql<AccountingMonthlyBaseCostItem[]>`
    SELECT * FROM accounting_monthly_base_cost
    WHERE store_id = ${storeId} AND period = ${period} AND sku = ${sku} AND deleted_at IS NULL
  `;

  if (existing.length > 0) {
    await updateMonthlyBaseCostField(
      storeId,
      existing[0].id,
      "sl_ton_dau_ky",
      slTon,
      changedBy,
    );
  } else {
    const skuMaster = await sql<{ id: string; brand: string | null; product_type: string | null }[]>`
      SELECT id, brand, product_type FROM accounting_sku_master
      WHERE store_id = ${storeId} AND sku = ${sku} AND deleted_at IS NULL LIMIT 1
    `;

    const inbound = await sql<{ qty: number; cost: number }[]>`
      SELECT 
        COALESCE(SUM(quantity), 0)::float as qty,
        COALESCE(SUM(COALESCE(total_basecost, final_basecost * quantity, 0)), 0)::float as cost
      FROM accounting_inbound_shipments
      WHERE store_id = ${storeId}
        AND sku = ${sku}
        AND deleted_at IS NULL
        AND (
          ngay_den LIKE ${period + '%'}
          OR (ngay_den IS NULL AND ngay_request LIKE ${period + '%'})
        )
    `;
    const slNhap = inbound[0]?.qty || 0;
    const gtriNhap = inbound[0]?.cost || 0;

    const prevPeriod = getPreviousPeriod(period);
    const prevRecord = await sql<{ basecost_thang: number }[]>`
      SELECT basecost_thang::float FROM accounting_monthly_base_cost
      WHERE store_id = ${storeId} AND period = ${prevPeriod} AND sku = ${sku} AND deleted_at IS NULL
    `;
    let giaTon = prevRecord[0]?.basecost_thang || 0;
    if (giaTon === 0) {
      const firstShipment = await sql<{ cost: number }[]>`
        SELECT COALESCE(final_basecost, base_cost_per_unit, 0)::float as cost
        FROM accounting_inbound_shipments
        WHERE store_id = ${storeId} AND sku = ${sku} AND deleted_at IS NULL AND COALESCE(final_basecost, base_cost_per_unit, 0) > 0
        ORDER BY COALESCE(ngay_den, ngay_request) ASC LIMIT 1
      `;
      giaTon = firstShipment[0]?.cost || 0;
    }

    const calc = calculateMonthlyBaseCostCore({
      slTon,
      basecostDauKy: giaTon,
      slNhap,
      gtriNhap,
    });

    await sql`
      INSERT INTO accounting_monthly_base_cost (
        store_id, period, sku, sku_id, brand, product_type,
        sl_ton_dau_ky, basecost_dau_ky, gtri_ton_dau_ky,
        sl_nhap, gtri_nhap, don_gia_nhap_tb,
        tong_sl_kha_dung, tong_gtri_kha_dung, basecost_thang,
        calculation_rule, is_overridden, last_changed_by, updated_at
      ) VALUES (
        ${storeId}, ${period}, ${sku}, ${skuMaster[0]?.id || null}, ${skuMaster[0]?.brand || null}, ${skuMaster[0]?.product_type || null},
        ${calc.slTonDauKy}, ${calc.basecostDauKy}, ${calc.gtriTonDauKy},
        ${calc.slNhap}, ${calc.gtriNhap}, ${calc.donGiaNhapTb},
        ${calc.tongSlKhaDung}, ${calc.tongGtriKhaDung}, ${calc.basecostThang},
        ${calc.calculationRule}, false, ${changedBy}, NOW()
      )
    `;
  }

  // Cascade tiếp cho các tháng sau trong năm
  for (let m = month + 1; m <= 12; m++) {
    const p = `${year}-${String(m).padStart(2, "0")}`;
    await syncMonthlyBaseCostFromInbound(storeId, p, changedBy);
  }

  return { success: true };
}

/**
 * Nhập dữ liệu Basecost Tháng từ file Excel (hỗ trợ đọc hàng tồn 1/1 & trung bình giá 1/1 ban đầu,
 * cùng các cột Basecost tháng 1..12 nếu có sẵn từ Google Sheets/Excel cũ).
 * Sau khi nạp, tự động kích hoạt tính toán cascade dây chuyền cho các tháng tiếp theo.
 */
export async function importMonthlyBaseCostFromWorkbook(
  storeId: string,
  workbook: ExcelJS.Workbook,
  year = 2026,
  changedBy = "system",
): Promise<{ count: number; updatedInitialCount: number; overriddenMonthCount: number; errors: string[] }> {
  // 1. Tìm worksheet thích hợp nhất
  // Tìm Basecost trước. Không gộp "TỒN" vào cùng danh sách vì findWorksheetByName
  // duyệt theo vị trí sheet; trong file LIMIMA, sheet TỒN đứng trước BASECOST THÁNG
  // và đã khiến giá trị tổng tiền tồn bị đọc nhầm là số lượng tồn.
  const ws =
    findWorksheetByName(workbook, [
      "BASE COST THÁNG",
      "BASECOST THÁNG",
      "BASE COST",
      "BASECOST",
      "MONTHLY BASE COST",
      "BASE_COST",
    ]) ||
    findWorksheetByName(workbook, ["TỒN", "TON"]) ||
    workbook.worksheets[0];

  if (!ws) {
    throw new Error("File Excel không có bất kỳ trang tính (sheet) nào.");
  }

  // 2. Quét tìm dòng tiêu đề (Header row)
  let headerRowIndex = 1;
  let skuCol = -1;
  let monthCol = -1;
  let startDateCol = -1;
  let endDateCol = -1;
  let brandCol = -1;
  let asinCol = -1;
  let hangTonCol = -1;
  let hangTonCuoiCol = -1;
  let giaVonCol = -1;
  let slNhapCol = -1;
  let gtriNhapCol = -1;
  let donGiaNhapCol = -1;
  let daBanCol = -1;
  let dienCol = -1;
  let basecostCol = -1;
  const monthCols = new Map<number, number>();

  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= Math.max(row.cellCount, 30); c++) {
      const val = getExcelCellValue(row.getCell(c));
      const str = val ? String(val).trim().toLowerCase() : "";
      if (str === "sku" || str === "mã sku" || str === "ma sku") {
        headerRowIndex = r;
        break;
      }
    }
    if (headerRowIndex === r) break;
  }

  const hRow = ws.getRow(headerRowIndex);
  const totalCols = Math.max(hRow.cellCount, 35);
  for (let c = 1; c <= totalCols; c++) {
    const val = getExcelCellValue(hRow.getCell(c));
    if (!val) continue;
    const str = String(val).trim().toLowerCase().replace(/\s+/g, " ");

    if (str === "sku" || str === "mã sku" || str === "ma sku") {
      skuCol = c;
    } else if (str === "month" || str === "tháng" || str === "thang") {
      monthCol = c;
    } else if (str === "đầu tháng" || str === "dau thang") {
      startDateCol = c;
    } else if (str === "cuối tháng" || str === "cuoi thang") {
      endDateCol = c;
    } else if (str === "brand" || str === "thương hiệu" || str === "thuong hieu") {
      brandCol = c;
    } else if (str === "asin") {
      asinCol = c;
    } else if (
      str.includes("hàng tồn đầu") ||
      str.includes("hang ton dau") ||
      str.includes("hàng tồn 1/1") ||
      str.includes("hang ton 1/1") ||
      str.includes("tồn 1/1") ||
      str.includes("ton 1/1") ||
      str.includes("hang_ton") ||
      str.includes("tồn đầu")
    ) {
      hangTonCol = c;
    } else if (
      str.includes("hàng tồn cuối") ||
      str.includes("hang ton cuoi") ||
      str.includes("tồn cuối") ||
      str.includes("ton cuoi")
    ) {
      hangTonCuoiCol = c;
    } else if (str.includes("số hàng nhập") || str.includes("so hang nhap")) {
      slNhapCol = c;
    } else if (str.includes("tổng tiền đã đi") || str.includes("tong tien da di")) {
      gtriNhapCol = c;
    } else if (
      str.includes("trung bình giá đầu") ||
      str.includes("trung binh gia dau") ||
      str.includes("trung bình giá 1/1") ||
      str.includes("trung binh gia 1/1") ||
      str.includes("giá vốn 1/1") ||
      str.includes("gia von 1/1") ||
      str.includes("basecost 1/1") ||
      str.includes("gia_von")
    ) {
      giaVonCol = c;
    } else if (str === "trung bình giá" || str === "trung binh gia") {
      donGiaNhapCol = c;
    } else if (str === "đã bán" || str === "da ban") {
      daBanCol = c;
    } else if (
      str.includes("basecost tính") ||
      str.includes("basecost tinh")
    ) {
      // Đây là giá bình quân sau khi cộng tồn đầu và hàng nhập, ưu tiên tuyệt đối.
      basecostCol = c;
    } else if (
      str === "basecost" ||
      str.includes("basecost tb") ||
      str.includes("trung bình giá")
    ) {
      // Fallback cho template không có cột "Basecost tính/tháng" rõ ràng.
      if (basecostCol === -1) basecostCol = c;
    } else if (str === "điền" || str === "dien") {
      dienCol = c;
    } else {
      // Nhận diện cột tháng ngang (Format Pivot: Tháng 1 .. Tháng 12)
      const matchMonth =
        str.match(/th[aá]ng\s*(\d{1,2})/i) ||
        str.match(/month\s*(\d{1,2})/i) ||
        str.match(/^m_?(\d{1,2})$/i) ||
        str.match(/^t(\d{1,2})$/i);
      if (matchMonth) {
        const m = parseInt(matchMonth[1], 10);
        if (m >= 1 && m <= 12) {
          monthCols.set(m, c);
        }
      }
    }
  }

  if (skuCol === -1) {
    throw new Error(
      `Không tìm thấy cột "SKU" trong file Excel. Vui lòng kiểm tra lại dòng tiêu đề (Header).`
    );
  }

  const sql = await getDatabaseClient();
  const errors: string[] = [];
  let count = 0;
  let updatedInitialCount = 0;
  let overriddenMonthCount = 0;

  // Lấy trước thông tin SKU Master để gán brand, product_type
  const skuMasters = await sql<{ id: string; sku: string; brand: string | null; product_type: string | null }[]>`
    SELECT id, sku, brand, product_type FROM accounting_sku_master
    WHERE store_id = ${storeId} AND deleted_at IS NULL
  `;
  const skuMasterMap = new Map<string, { id: string; brand: string | null; product_type: string | null }>();
  for (const sm of skuMasters) {
    skuMasterMap.set(sm.sku.trim(), sm);
  }

  const periodM1 = `${year}-01`;
  let lastImportedMonth = 0;

  /**
   * Excel Basecost ghi tồn cuối từng tháng. Giá trị này là tồn đầu của tháng kế tiếp;
   * ví dụ tồn cuối T8 sẽ là tồn đầu T9. Chỉ nhận đơn vị nguyên vì tồn SKU không thể lẻ.
   * Giá trị âm vẫn được giữ để phản ánh thiếu hàng như file gốc; hàm tính Base Cost
   * đã dùng MAX(tồn, 0) nên không lấy số âm vào mẫu số bình quân.
   */
  const saveNextMonthOpeningQuantity = async (
    sku: string,
    month: number,
    rawValue: unknown,
    closingBasecost: number | null = null,
  ) => {
    if (rawValue === null || rawValue === undefined || rawValue === "") return;

    const openingQty = Number(String(rawValue).replace(/,/g, ""));
    if (!Number.isFinite(openingQty) || !Number.isInteger(openingQty)) {
      errors.push(`SKU ${sku}, tháng ${month}: Hàng tồn cuối tháng phải là số nguyên (nhận được: ${String(rawValue)}).`);
      return;
    }

    const nextYear = month >= 12 ? year + 1 : year;
    const nextMonth = month >= 12 ? 1 : month + 1;
    const nextPeriod = `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
    const meta = skuMasterMap.get(sku);
    const basecostDau = closingBasecost !== null && closingBasecost > 0 ? closingBasecost : 0;
    const gtriTon = openingQty * basecostDau;

    await sql`
      INSERT INTO accounting_monthly_base_cost (
        store_id, period, sku, sku_id, brand, product_type,
        sl_ton_dau_ky, basecost_dau_ky, gtri_ton_dau_ky,
        sl_nhap, gtri_nhap, don_gia_nhap_tb,
        tong_sl_kha_dung, tong_gtri_kha_dung, basecost_thang,
        calculation_rule, is_overridden, last_changed_by, updated_at
      ) VALUES (
        ${storeId}, ${nextPeriod}, ${sku}, ${meta?.id || null}, ${meta?.brand || null}, ${meta?.product_type || null},
        ${openingQty}, ${basecostDau}, ${gtriTon},
        0, 0, 0,
        ${openingQty}, ${gtriTon}, ${basecostDau},
        'excel_previous_closing', false, ${changedBy}, NOW()
      )
      ON CONFLICT (store_id, period, sku) DO UPDATE
      SET
        sl_ton_dau_ky = EXCLUDED.sl_ton_dau_ky,
        basecost_dau_ky = CASE 
          WHEN accounting_monthly_base_cost.basecost_dau_ky = 0 THEN EXCLUDED.basecost_dau_ky 
          ELSE accounting_monthly_base_cost.basecost_dau_ky 
        END,
        gtri_ton_dau_ky = CASE 
          WHEN accounting_monthly_base_cost.gtri_ton_dau_ky = 0 THEN EXCLUDED.gtri_ton_dau_ky 
          ELSE accounting_monthly_base_cost.gtri_ton_dau_ky 
        END,
        tong_sl_kha_dung = EXCLUDED.sl_ton_dau_ky + accounting_monthly_base_cost.sl_nhap,
        tong_gtri_kha_dung = (EXCLUDED.sl_ton_dau_ky * CASE 
          WHEN accounting_monthly_base_cost.basecost_dau_ky = 0 THEN EXCLUDED.basecost_dau_ky 
          ELSE accounting_monthly_base_cost.basecost_dau_ky 
        END) + accounting_monthly_base_cost.gtri_nhap,
        basecost_thang = CASE 
          WHEN accounting_monthly_base_cost.is_overridden THEN accounting_monthly_base_cost.basecost_thang
          WHEN accounting_monthly_base_cost.calculation_rule = 'excel_source_snapshot' THEN accounting_monthly_base_cost.basecost_thang
          WHEN accounting_monthly_base_cost.basecost_thang = 0 THEN EXCLUDED.basecost_thang
          ELSE accounting_monthly_base_cost.basecost_thang
        END,
        last_changed_by = ${changedBy},
        updated_at = NOW()
      WHERE accounting_monthly_base_cost.deleted_at IS NULL
    `;
  };

  // Kiểm tra phụ: Nếu file có sheet TỒN riêng biệt, nạp thêm số tồn đầu năm từ sheet TỒN nếu cần
  const wsTon = findWorksheetByName(workbook, ["TỒN", "TON"]);
  const tonDauNamMap = new Map<string, { hangTon: number; giaVon: number }>();
  if (wsTon && wsTon !== ws) {
    let tonSkuCol = -1, tonHangTonCol = -1, tonGiaVonCol = -1;
    for (let c = 1; c <= Math.min(wsTon.columnCount, 25); c++) {
      const v = String(getExcelCellValue(wsTon.getRow(1).getCell(c)) || "").trim().toLowerCase();
      if (v === "sku") tonSkuCol = c;
      else if (v.includes("hàng tồn 1/1") || v.includes("hang ton 1/1")) tonHangTonCol = c;
      else if (v.includes("trung bình giá 1/1") || v.includes("trung binh gia 1/1")) tonGiaVonCol = c;
    }
    if (tonSkuCol !== -1 && (tonHangTonCol !== -1 || tonGiaVonCol !== -1)) {
      for (let r = 2; r <= wsTon.rowCount; r++) {
        const row = wsTon.getRow(r);
        const sku = String(getExcelCellValue(row.getCell(tonSkuCol)) || "").trim();
        if (!sku) continue;
        const ht = tonHangTonCol !== -1 ? Number(getExcelCellValue(row.getCell(tonHangTonCol))) || 0 : 0;
        const gv = tonGiaVonCol !== -1 ? Number(getExcelCellValue(row.getCell(tonGiaVonCol))) || 0 : 0;
        tonDauNamMap.set(sku, { hangTon: ht, giaVon: gv });
      }
    }
  }

  // TRƯỜNG HỢP A: File có cột "Month" (Row-based từng tháng như file thực tế LIMIMA INVENTORY 2026.xlsx)
  if (monthCol !== -1) {
    const skuProcessedSet = new Set<string>();

    for (let r = headerRowIndex + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const skuRaw = getExcelCellValue(row.getCell(skuCol));
      if (!skuRaw) continue;
      const sku = String(skuRaw).trim();
      if (
        !sku ||
        sku.toLowerCase() === "sku" ||
        sku.toLowerCase().startsWith("tổng") ||
        sku.toLowerCase().startsWith("total")
      ) {
        continue;
      }

      const m = Number(getExcelCellValue(row.getCell(monthCol)));
      if (isNaN(m) || m < 1 || m > 12) continue;
      lastImportedMonth = Math.max(lastImportedMonth, m);

      if (!skuProcessedSet.has(sku)) {
        skuProcessedSet.add(sku);
        count++;
      }

      const meta = skuMasterMap.get(sku);
      const numberAt = (column: number): number | null => {
        if (column === -1) return null;
        const value = getExcelCellValue(row.getCell(column));
        if (value === null || value === undefined || value === "") return null;
        const parsed = Number(String(value).replace(/[$,]/g, ""));
        return Number.isFinite(parsed) ? parsed : null;
      };
      const slTon = numberAt(hangTonCol) ?? 0;
      const basecostDau = numberAt(giaVonCol) ?? 0;
      const slNhap = numberAt(slNhapCol) ?? 0;
      const gtriNhap = numberAt(gtriNhapCol) ?? 0;
      const donGiaNhap = numberAt(donGiaNhapCol) ?? (slNhap !== 0 ? gtriNhap / slNhap : 0);
      const basecost = numberAt(basecostCol);
      const closingQty = numberAt(hangTonCuoiCol);
      const importedBrand = brandCol === -1 ? null : getExcelCellValue(row.getCell(brandCol));
      const periodStr = `${year}-${String(m).padStart(2, "0")}`;
      const sourceFields = {
        import_source: "BASECOST THÁNG",
        start_date: startDateCol === -1 ? null : getExcelCellValue(row.getCell(startDateCol)),
        end_date: endDateCol === -1 ? null : getExcelCellValue(row.getCell(endDateCol)),
        brand: importedBrand,
        asin: asinCol === -1 ? null : getExcelCellValue(row.getCell(asinCol)),
        sold_quantity: numberAt(daBanCol),
        closing_quantity: closingQty,
        dien: dienCol === -1 ? null : getExcelCellValue(row.getCell(dienCol)),
      };

      // Mỗi dòng của sheet là một snapshot đã chốt. Giữ nguyên số liệu nguồn,
      // không tính lại hoặc làm tròn trong lúc import.
      if (basecost !== null) {
        if (m === 1) updatedInitialCount++;
        overriddenMonthCount++;
        const gtriTon = slTon * basecostDau;
        await sql`
          INSERT INTO accounting_monthly_base_cost (
            store_id, period, sku, sku_id, brand, product_type,
            sl_ton_dau_ky, basecost_dau_ky, gtri_ton_dau_ky,
            sl_nhap, gtri_nhap, don_gia_nhap_tb,
            tong_sl_kha_dung, tong_gtri_kha_dung, basecost_thang,
            calculation_rule, is_overridden, custom_fields, last_changed_by, updated_at
          ) VALUES (
            ${storeId}, ${periodStr}, ${sku}, ${meta?.id || null}, ${String(importedBrand || meta?.brand || "") || null}, ${meta?.product_type || null},
            ${slTon}, ${basecostDau}, ${gtriTon},
            ${slNhap}, ${gtriNhap}, ${donGiaNhap},
            ${slTon + slNhap}, ${gtriTon + gtriNhap}, ${basecost},
            'excel_source_snapshot', true, ${sql.json(sourceFields)}, ${changedBy}, NOW()
          )
          ON CONFLICT (store_id, period, sku) DO UPDATE SET
            sku_id = COALESCE(EXCLUDED.sku_id, accounting_monthly_base_cost.sku_id),
            brand = COALESCE(EXCLUDED.brand, accounting_monthly_base_cost.brand),
            product_type = COALESCE(EXCLUDED.product_type, accounting_monthly_base_cost.product_type),
            sl_ton_dau_ky = EXCLUDED.sl_ton_dau_ky,
            basecost_dau_ky = EXCLUDED.basecost_dau_ky,
            gtri_ton_dau_ky = EXCLUDED.gtri_ton_dau_ky,
            sl_nhap = EXCLUDED.sl_nhap,
            gtri_nhap = EXCLUDED.gtri_nhap,
            don_gia_nhap_tb = EXCLUDED.don_gia_nhap_tb,
            tong_sl_kha_dung = EXCLUDED.tong_sl_kha_dung,
            tong_gtri_kha_dung = EXCLUDED.tong_gtri_kha_dung,
            basecost_thang = EXCLUDED.basecost_thang,
            calculation_rule = 'excel_source_snapshot',
            is_overridden = true,
            custom_fields = EXCLUDED.custom_fields,
            deleted_at = NULL,
            last_changed_by = ${changedBy},
            updated_at = NOW()
        `;
      }

      // Tồn cuối tháng m là tồn đầu kỳ của tháng m + 1.
      if (hangTonCuoiCol !== -1) {
        await saveNextMonthOpeningQuantity(sku, m, getExcelCellValue(row.getCell(hangTonCuoiCol)), basecost);
      }

    }
  } else {
    // TRƯỜNG HỢP B: File dạng Pivot Ma trận (Các tháng 1..12 là cột ngang)
    for (let r = headerRowIndex + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const skuRaw = getExcelCellValue(row.getCell(skuCol));
      if (!skuRaw) continue;
      const sku = String(skuRaw).trim();
      if (
        !sku ||
        sku.toLowerCase() === "sku" ||
        sku.toLowerCase().startsWith("tổng") ||
        sku.toLowerCase().startsWith("total")
      ) {
        continue;
      }

      count++;
      const meta = skuMasterMap.get(sku);

      // Giá trị đầu năm 1/1 (Hàng tồn & Giá vốn)
      let hangTonVal: number | null = null;
      if (hangTonCol !== -1) {
        const v = getExcelCellValue(row.getCell(hangTonCol));
        if (v !== null && v !== undefined && v !== "") {
          const n = Number(String(v).replace(/,/g, ""));
          if (!isNaN(n)) hangTonVal = Math.max(0, n);
        }
      }

      let giaVonVal: number | null = null;
      if (giaVonCol !== -1) {
        const v = getExcelCellValue(row.getCell(giaVonCol));
        if (v !== null && v !== undefined && v !== "") {
          const n = Number(String(v).replace(/[$,]/g, ""));
          if (!isNaN(n)) giaVonVal = Math.max(0, Math.round(n * 100) / 100);
        }
      }

      if ((hangTonVal === null || giaVonVal === null) && tonDauNamMap.has(sku)) {
        const t = tonDauNamMap.get(sku)!;
        if (hangTonVal === null) hangTonVal = t.hangTon;
        if (giaVonVal === null) giaVonVal = t.giaVon;
      }

      if (hangTonVal !== null || giaVonVal !== null) {
        updatedInitialCount++;
        const slTon = hangTonVal ?? 0;
        const basecostDau = giaVonVal ?? 0;
        const gtriTon = Math.round(slTon * basecostDau * 100) / 100;

        await sql`
          INSERT INTO accounting_monthly_base_cost (
            store_id, period, sku, sku_id, brand, product_type,
            sl_ton_dau_ky, basecost_dau_ky, gtri_ton_dau_ky,
            sl_nhap, gtri_nhap, don_gia_nhap_tb,
            tong_sl_kha_dung, tong_gtri_kha_dung, basecost_thang,
            calculation_rule, is_overridden, last_changed_by, updated_at
          ) VALUES (
            ${storeId}, ${periodM1}, ${sku}, ${meta?.id || null}, ${meta?.brand || null}, ${meta?.product_type || null},
            ${slTon}, ${basecostDau}, ${gtriTon},
            0, 0, 0,
            ${slTon}, ${gtriTon}, ${basecostDau},
            'manual_excel_import', false, ${changedBy}, NOW()
          )
          ON CONFLICT (store_id, period, sku) DO UPDATE
          SET
            sl_ton_dau_ky = ${slTon},
            basecost_dau_ky = ${basecostDau},
            gtri_ton_dau_ky = ${gtriTon},
            last_changed_by = ${changedBy},
            updated_at = NOW()
          WHERE accounting_monthly_base_cost.deleted_at IS NULL
        `;
      }

      // Các cột Basecost tháng 1 .. tháng 12 nếu có sẵn
      for (const [m, c] of monthCols.entries()) {
        const v = getExcelCellValue(row.getCell(c));
        if (v !== null && v !== undefined && v !== "") {
          const n = Number(String(v).replace(/[$,]/g, ""));
          if (!isNaN(n) && n > 0) {
            const cost = Math.round(n * 100) / 100;
            const periodStr = `${year}-${String(m).padStart(2, "0")}`;
            overriddenMonthCount++;

            await sql`
              INSERT INTO accounting_monthly_base_cost (
                store_id, period, sku, sku_id, brand, product_type,
                sl_ton_dau_ky, basecost_dau_ky, gtri_ton_dau_ky,
                sl_nhap, gtri_nhap, don_gia_nhap_tb,
                tong_sl_kha_dung, tong_gtri_kha_dung, basecost_thang,
                calculation_rule, is_overridden, last_changed_by, updated_at
              ) VALUES (
                ${storeId}, ${periodStr}, ${sku}, ${meta?.id || null}, ${meta?.brand || null}, ${meta?.product_type || null},
                0, 0, 0,
                0, 0, 0,
                0, 0, ${cost},
                'manual_excel_import', true, ${changedBy}, NOW()
              )
              ON CONFLICT (store_id, period, sku) DO UPDATE
              SET
                basecost_thang = ${cost},
                is_overridden = true,
                calculation_rule = 'manual_excel_import',
                last_changed_by = ${changedBy},
                updated_at = NOW()
              WHERE accounting_monthly_base_cost.deleted_at IS NULL
            `;
          }
        }
      }
    }
  }

  // Snapshot dạng dòng là dữ liệu gốc: chỉ tự tính các tháng chưa xuất hiện trong file.
  const firstMonthToCalculate = monthCol !== -1 ? lastImportedMonth + 1 : 1;
  for (let m = firstMonthToCalculate; m <= 12; m++) {
    const p = `${year}-${String(m).padStart(2, "0")}`;
    await syncMonthlyBaseCostFromInbound(storeId, p, changedBy);
  }

  return { count, updatedInitialCount, overriddenMonthCount, errors };
}
