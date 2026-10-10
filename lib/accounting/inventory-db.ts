import "server-only";

import { getDatabaseClient } from "@/lib/db";
import ExcelJS from "exceljs";

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

export interface InventoryHistoryItem {
  id: string;
  entity_type: "sku" | "inbound";
  entity_id: string;
  store_id: string;
  action: "create" | "update" | "delete" | "restore";
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  changed_by: string;
  created_at: string;
}

export interface InventoryFieldOptions {
  sku: Record<"product_type" | "pic_mkt" | "loai" | "niche" | "pic_idea" | "status" | "event" | "tinh_trang" | "design_pic", string[]>;
  inbound: Record<"product_type" | "brand" | "sup" | "line_ship" | "status" | "tinh_trang_hang_den_kho" | "trang_thai", string[]>;
}

export interface InventoryFieldSetting {
  entity_type: "sku" | "inbound";
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
    options: Array.isArray(row.options)
      ? row.options
      : typeof row.options === "string"
        ? JSON.parse(row.options)
        : [],
  }));
}

export async function saveInventoryFieldSetting(storeId: string, setting: InventoryFieldSetting) {
  const sql = await getDatabaseClient();
  const options = [...new Set(setting.options.map((value) => value.trim()).filter(Boolean))];
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
  const inboundFields = ["product_type", "brand", "sup", "line_ship", "status", "tinh_trang_hang_den_kho", "trang_thai"] as const;

  const getValues = async (table: "accounting_sku_master" | "accounting_inbound_shipments", field: string) => {
    const rows = await sql<{ value: string }[]>`
      SELECT DISTINCT BTRIM(${sql(field)}) AS value
      FROM ${sql(table)}
      WHERE store_id = ${storeId}
        AND deleted_at IS NULL
        AND ${sql(field)} IS NOT NULL
        AND BTRIM(${sql(field)}) <> ''
      ORDER BY value ASC
    `;
    return rows.map((row) => row.value);
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
  params: { search?: string; status?: string; productType?: string; cursor?: string; page?: number; limit?: number } = {},
): Promise<{ items: SkuMasterItem[]; total: number; page: number; limit: number; nextCursor: string | null }> {
  const sql = await getDatabaseClient();
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(1000, Math.max(1, params.limit || 50));
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
    FROM accounting_sku_master
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
      custom_fields,
      created_at::text,
      updated_at::text
    FROM accounting_sku_master
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
    ORDER BY thang_listing DESC NULLS LAST, created_at DESC, id DESC
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
): Promise<SkuMasterItem> {
  const sql = await getDatabaseClient();
  const rows = await sql<SkuMasterItem[]>`
    INSERT INTO accounting_sku_master (
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
      ${data.status ?? "Active"},
      ${data.event ?? null},
      ${data.tinh_trang ?? null},
      ${data.design_pic ?? null},
      ${data.mockup_url ?? null},
      ${data.thang_listing ?? null},
      ${data.thang_danh_gia ?? null},
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
      ${changedBy},
      NOW()
    )
    ON CONFLICT (store_id, sku) DO UPDATE SET
      brand = EXCLUDED.brand,
      product_type = EXCLUDED.product_type,
      mockup = COALESCE(EXCLUDED.mockup, accounting_sku_master.mockup),
      asin = COALESCE(EXCLUDED.asin, accounting_sku_master.asin),
      fnsku = COALESCE(EXCLUDED.fnsku, accounting_sku_master.fnsku),
      amazon_fee = COALESCE(EXCLUDED.amazon_fee, accounting_sku_master.amazon_fee),
      referral_fee_pct = COALESCE(EXCLUDED.referral_fee_pct, accounting_sku_master.referral_fee_pct),
      pic_mkt = COALESCE(EXCLUDED.pic_mkt, accounting_sku_master.pic_mkt),
      loai = COALESCE(EXCLUDED.loai, accounting_sku_master.loai),
      niche = COALESCE(EXCLUDED.niche, accounting_sku_master.niche),
      pic_idea = COALESCE(EXCLUDED.pic_idea, accounting_sku_master.pic_idea),
      status = COALESCE(EXCLUDED.status, accounting_sku_master.status),
      event = COALESCE(EXCLUDED.event, accounting_sku_master.event),
      tinh_trang = COALESCE(EXCLUDED.tinh_trang, accounting_sku_master.tinh_trang),
      design_pic = COALESCE(EXCLUDED.design_pic, accounting_sku_master.design_pic),
      mockup_url = COALESCE(EXCLUDED.mockup_url, accounting_sku_master.mockup_url),
      thang_listing = COALESCE(EXCLUDED.thang_listing, accounting_sku_master.thang_listing),
      thang_danh_gia = COALESCE(EXCLUDED.thang_danh_gia, accounting_sku_master.thang_danh_gia),
      event_250th = COALESCE(EXCLUDED.event_250th, accounting_sku_master.event_250th),
      ngay_danh_gia_sku_event = COALESCE(EXCLUDED.ngay_danh_gia_sku_event, accounting_sku_master.ngay_danh_gia_sku_event),
      amazon_fba_fee_thay_doi = COALESCE(EXCLUDED.amazon_fba_fee_thay_doi, accounting_sku_master.amazon_fba_fee_thay_doi),
      basecost_tb = COALESCE(EXCLUDED.basecost_tb, accounting_sku_master.basecost_tb),
      brand_entity_id = COALESCE(EXCLUDED.brand_entity_id, accounting_sku_master.brand_entity_id),
      creative_asins_video = COALESCE(EXCLUDED.creative_asins_video, accounting_sku_master.creative_asins_video),
      creative_asins_collection = COALESCE(EXCLUDED.creative_asins_collection, accounting_sku_master.creative_asins_collection),
      video_media_ids = COALESCE(EXCLUDED.video_media_ids, accounting_sku_master.video_media_ids),
      creative_headline = COALESCE(EXCLUDED.creative_headline, accounting_sku_master.creative_headline),
      brand_logo_asset_id = COALESCE(EXCLUDED.brand_logo_asset_id, accounting_sku_master.brand_logo_asset_id),
      landing_page_url = COALESCE(EXCLUDED.landing_page_url, accounting_sku_master.landing_page_url),
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
      custom_fields,
      created_at::text, updated_at::text
  `;
  return rows[0];
}

export async function deleteSkuMasterItem(id: string, storeId: string, changedBy = "system"): Promise<boolean> {
  const sql = await getDatabaseClient();
  const res = await sql`
    UPDATE accounting_sku_master
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
): Promise<SkuMasterItem> {
  const sql = await getDatabaseClient();
  const trimmed = typeof value === "string" ? value.trim() : value;

  if (field.startsWith("custom_")) {
    const rows = await sql<SkuMasterItem[]>`
      UPDATE accounting_sku_master
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
        custom_fields, created_at::text, updated_at::text
    `;
    if (!rows[0]) throw new Error("Không tìm thấy SKU cần cập nhật.");
    return rows[0];
  }

  const numFields = ["amazon_fee", "referral_fee_pct", "amazon_fba_fee_thay_doi", "basecost_tb"];
  const val = numFields.includes(field)
    ? trimmed === "" || trimmed == null ? null : parseFloat(trimmed)
    : trimmed === "" || trimmed == null ? null : trimmed;

  const validFields = [
    "brand", "product_type", "mockup", "sku", "asin", "fnsku",
    "amazon_fee", "referral_fee_pct", "pic_mkt", "loai", "niche",
    "pic_idea", "status", "event", "tinh_trang", "design_pic", "mockup_url",
    "thang_listing", "thang_danh_gia", "event_250th", "ngay_danh_gia_sku_event",
    "amazon_fba_fee_thay_doi", "basecost_tb", "brand_entity_id",
    "creative_asins_video", "creative_asins_collection", "video_media_ids",
    "creative_headline", "brand_logo_asset_id", "landing_page_url"
  ];
  if (!validFields.includes(field)) {
    throw new Error(`Trường '${field}' không hợp lệ.`);
  }

  const rows = await sql<SkuMasterItem[]>`
    UPDATE accounting_sku_master
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
      custom_fields, created_at::text, updated_at::text
  `;
  if (!rows[0]) throw new Error("Không tìm thấy SKU cần cập nhật.");
  return rows[0];
}

export async function listInboundShipments(
  storeId: string,
  params: { search?: string; status?: string; shipmentId?: string; cursor?: string; page?: number; limit?: number } = {},
): Promise<{ items: InboundShipmentItem[]; total: number; page: number; limit: number; nextCursor: string | null }> {
  const sql = await getDatabaseClient();
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(1000, Math.max(1, params.limit || 50));
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
      AND (${cursorCreatedAt}::timestamptz IS NULL OR (
        s.created_at < ${cursorCreatedAt}::timestamptz
        OR (s.created_at = ${cursorCreatedAt}::timestamptz AND s.id < ${cursorId}::uuid)
      ))
    ORDER BY s.ngay_di DESC NULLS LAST, s.created_at DESC, s.id DESC
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
  const discrepancy =
    data.discrepancy ??
    (data.quantity || 0) - (data.so_luong_amazon_nhan ?? data.amazon_received ?? 0);

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
      ${data.sku_id ?? null},
      ${data.brand ?? null},
      ${data.sup ?? null},
      ${data.ngay_request ?? null},
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
      ${data.ngay_thanh_toan ?? null},
      ${data.ten_lo_hang ?? null},
      ${data.shipment_id ?? null},
      ${data.ngay_di ?? null},
      ${data.ngay_den ?? null},
      ${data.amazon_received ?? null},
      ${data.tinh_trang_hang_den_kho ?? null},
      ${data.status ?? null},
      ${data.so_luong_amazon_nhan ?? null},
      ${discrepancy},
      ${data.note ?? null},
      ${data.trang_thai ?? null},
      ${changedBy},
      NOW()
    )
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

  const intFields = ["quantity", "amazon_received", "so_luong_amazon_nhan", "discrepancy"];
  const floatFields = ["base_cost_per_unit", "card", "tag", "shipping_fee", "hop_tui", "final_basecost", "total_basecost"];

  let val: any = trimmed === "" || trimmed == null ? null : trimmed;
  if (intFields.includes(field)) {
    val = trimmed === "" || trimmed == null ? 0 : parseInt(trimmed, 10);
  } else if (floatFields.includes(field)) {
    val = trimmed === "" || trimmed == null ? null : parseFloat(trimmed);
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
  entityType?: "sku" | "inbound" | null,
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
  entityType: "sku" | "inbound",
  entityId: string,
  changedBy = "system",
): Promise<boolean> {
  const sql = await getDatabaseClient();
  const table = entityType === "sku" ? "accounting_sku_master" : "accounting_inbound_shipments";
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

export async function restoreInventoryHistory(
  storeId: string,
  historyId: string,
  changedBy = "system",
): Promise<{ entityType: "sku" | "inbound"; entityId: string }> {
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
      : "accounting_inbound_shipments";
    const fields = history.entity_type === "sku" ? SKU_RESTORE_FIELDS : INBOUND_RESTORE_FIELDS;

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
    else if (obj.text !== undefined) val = obj.text;
    else if (obj.hyperlink !== undefined) val = obj.hyperlink;
    else if (val instanceof Date) return val.toISOString();
  }
  if (typeof val === "string") {
    val = val.trim();
    return (val as string).length === 0 ? null : (val as string);
  }
  if (typeof val === "number") return val;
  return val ? String(val) : null;
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
  templateType: "sku" | "inbound" | "all",
  fileName: string,
  buffer: Buffer,
  sheetNames: string[],
  hasSkuSheet: boolean,
  hasInboundSheet: boolean,
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
      sheet_names = EXCLUDED.sheet_names,
      file_size = EXCLUDED.file_size,
      updated_at = NOW()
  `;
}

export async function processAndSaveImportTemplate(
  storeId: string,
  importType: "sku" | "inbound",
  fileName: string,
  buffer: Buffer,
  workbook: ExcelJS.Workbook,
): Promise<void> {
  try {
    const sheetNames = workbook.worksheets.map((w) => w.name);
    const hasSkuSheet = !!findWorksheetByName(workbook, ["BẢNG MÃ", "BANG MA", "SKU MASTER"]);
    const hasInboundSheet = !!findWorksheetByName(workbook, ["CHI TIẾT ĐI HÀNG", "CHI TIET DI HANG", "INBOUND SHIPMENTS"]);

    // Lưu template cho đúng loại import hiện tại
    await saveInventoryTemplate(storeId, importType, fileName, buffer, sheetNames, hasSkuSheet, hasInboundSheet);

    // Nếu file chứa cả 2 sheet, đồng thời lưu/cập nhật mẫu master "all"
    if (hasSkuSheet && hasInboundSheet) {
      await saveInventoryTemplate(storeId, "all", fileName, buffer, sheetNames, hasSkuSheet, hasInboundSheet);
    }
  } catch (err) {
    console.error("[InventoryTemplate] Lỗi khi lưu template tự động:", err);
  }
}

export async function getInventoryTemplate(
  storeId: string,
  templateType: "sku" | "inbound" | "all",
): Promise<{ fileName: string; buffer: Buffer; hasSkuSheet: boolean; hasInboundSheet: boolean } | null> {
  const sql = await getDatabaseClient();
  let rows: any[] = [];

  if (templateType === "sku") {
    rows = await sql`
      SELECT file_name, file_buffer, has_sku_sheet, has_inbound_sheet
      FROM accounting_inventory_templates
      WHERE store_id = ${storeId} AND (template_type = 'sku' OR has_sku_sheet = true)
      ORDER BY CASE WHEN template_type = 'sku' THEN 1 ELSE 2 END, updated_at DESC
      LIMIT 1
    `;
  } else if (templateType === "inbound") {
    rows = await sql`
      SELECT file_name, file_buffer, has_sku_sheet, has_inbound_sheet
      FROM accounting_inventory_templates
      WHERE store_id = ${storeId} AND (template_type = 'inbound' OR has_inbound_sheet = true)
      ORDER BY CASE WHEN template_type = 'inbound' THEN 1 ELSE 2 END, updated_at DESC
      LIMIT 1
    `;
  } else {
    rows = await sql`
      SELECT file_name, file_buffer, has_sku_sheet, has_inbound_sheet
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

export function populateSkuWorksheet(worksheet: ExcelJS.Worksheet, skus: any[]): void {
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

  // Xóa sạch các dòng dữ liệu cũ trong mẫu, giữ lại dòng 1 (Tiêu đề)
  for (let i = worksheet.rowCount; i >= 2; i--) {
    worksheet.spliceRows(i, 1);
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

      if (field === "amazon_fee" || field === "referral_fee_pct" || field === "amazon_fba_fee_thay_doi" || field === "basecost_tb") {
        val = val !== null && val !== undefined && val !== "" ? Number(val) : null;
      }

      rowValues.push(val);
    }

    const addedRow = worksheet.addRow(rowValues);
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
}

export function populateInboundWorksheet(worksheet: ExcelJS.Worksheet, shipments: any[]): void {
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

  for (let i = worksheet.rowCount; i >= 2; i--) {
    worksheet.spliceRows(i, 1);
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
      }

      rowValues.push(val);
    }

    const addedRow = worksheet.addRow(rowValues);
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
}

export async function importSkuMasterFromWorkbook(
  storeId: string,
  workbook: ExcelJS.Workbook,
): Promise<{ count: number; errors: string[] }> {
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
    const referral_fee_pct = parseNumeric(rowValues["referral_fee_pct"]);
    const pic_mkt = (rowValues["pic_mkt"] as string) || null;
    const loai = (rowValues["loai"] as string) || null;
    const niche = (rowValues["niche"] as string) || null;
    const pic_idea = (rowValues["pic_idea"] as string) || null;
    const status = (rowValues["status"] as string) || "Active";
    const event = (rowValues["event"] as string) || null;
    const tinh_trang = (rowValues["tinh_trang"] as string) || null;
    const design_pic = (rowValues["design_pic"] as string) || null;
    const mockup_url = (rowValues["mockup_url"] as string) || null;
    const thang_listing = (rowValues["thang_listing"] as string) || null;
    const thang_danh_gia = (rowValues["thang_danh_gia"] as string) || null;
    const event_250th = (rowValues["event_250th"] as string) || null;
    const ngay_danh_gia_sku_event = (rowValues["ngay_danh_gia_sku_event"] as string) || null;
    const amazon_fba_fee_thay_doi = parseNumeric(rowValues["amazon_fba_fee_thay_doi"]);
    const basecost_tb = parseNumeric(rowValues["basecost_tb"]);
    const brand_entity_id = (rowValues["brand_entity_id"] as string) || null;
    const creative_asins_video = (rowValues["creative_asins_video"] as string) || null;
    const creative_asins_collection = (rowValues["creative_asins_collection"] as string) || null;
    const video_media_ids = (rowValues["video_media_ids"] as string) || null;
    const creative_headline = (rowValues["creative_headline"] as string) || null;
    const brand_logo_asset_id = (rowValues["brand_logo_asset_id"] as string) || null;
    const landing_page_url = (rowValues["landing_page_url"] as string) || null;

    const resolvedMockup =
      mockup_url ||
      (typeof rawMockup === "string" && !rawMockup.startsWith("=") ? rawMockup : null);

    skuBatch.push({
      store_id: storeId,
      sku,
      brand,
      product_type,
      mockup: resolvedMockup,
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
    });
  });

  for (const item of skuBatch) {
    try {
      await upsertSkuMasterItem(storeId, item as SkuMasterItem);
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
    const ngay_request = (rowValues["ngay_request"] as string) || null;
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
    const ngay_thanh_toan = (rowValues["ngay_thanh_toan"] as string) || null;
    const ten_lo_hang = (rowValues["ten_lo_hang"] as string) || null;
    const shipment_id = (rowValues["shipment_id"] as string) || null;
    const ngay_di = (rowValues["ngay_di"] as string) || null;
    const ngay_den = (rowValues["ngay_den"] as string) || null;
    const amazon_received = parseInteger(rowValues["amazon_received"]);
    const tinh_trang_hang_den_kho = (rowValues["tinh_trang_hang_den_kho"] as string) || null;
    const status = (rowValues["status"] as string) || null;
    const so_luong_amazon_nhan = parseInteger(rowValues["so_luong_amazon_nhan"]);
    const discrepancy = parseInteger(rowValues["discrepancy"]);
    const note = (rowValues["note"] as string) || null;
    const trang_thai = (rowValues["trang_thai"] as string) || null;

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

  return { count, errors };
}
