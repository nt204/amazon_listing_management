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
  created_at: string;
  updated_at: string;
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
      created_at::text,
      updated_at::text
    FROM accounting_sku_master
    WHERE store_id = ${storeId}
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
      updated_at = NOW()
    RETURNING
      id, store_id, brand, product_type, mockup, sku, asin, fnsku,
      amazon_fee::float, referral_fee_pct::float, pic_mkt, loai, niche,
      pic_idea, status, event, tinh_trang, design_pic, mockup_url,
      thang_listing, thang_danh_gia, event_250th, ngay_danh_gia_sku_event,
      amazon_fba_fee_thay_doi::float, basecost_tb::float, brand_entity_id,
      creative_asins_video, creative_asins_collection, video_media_ids,
      creative_headline, brand_logo_asset_id, landing_page_url,
      created_at::text, updated_at::text
  `;
  return rows[0];
}

export async function deleteSkuMasterItem(id: string, storeId: string): Promise<boolean> {
  const sql = await getDatabaseClient();
  const res = await sql`
    DELETE FROM accounting_sku_master WHERE id = ${id} AND store_id = ${storeId}
  `;
  return res.count > 0;
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
      s.created_at::text,
      s.updated_at::text
    FROM accounting_inbound_shipments s
    LEFT JOIN accounting_sku_master m ON m.store_id = s.store_id AND m.sku = s.sku
    WHERE s.store_id = ${storeId}
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
    ORDER BY s.created_at DESC, s.id DESC
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
      NOW()
    )
    RETURNING
      id, store_id, sku_id, brand, sup, ngay_request, product_type, mockup,
      sku, quantity, line_ship, base_cost_per_unit::float, card::float,
      tag::float, shipping_fee::float, hop_tui::float, final_basecost::float,
      total_basecost::float, ngay_thanh_toan, ten_lo_hang, shipment_id,
      ngay_di, ngay_den, amazon_received, tinh_trang_hang_den_kho, status,
      so_luong_amazon_nhan, discrepancy, note, trang_thai,
      created_at::text, updated_at::text
  `;
  return rows[0];
}

export async function deleteInboundShipmentItem(id: string, storeId: string): Promise<boolean> {
  const sql = await getDatabaseClient();
  const res = await sql`
    DELETE FROM accounting_inbound_shipments WHERE id = ${id} AND store_id = ${storeId}
  `;
  return res.count > 0;
}

// ----------------- EXCEL IMPORT ENGINE -----------------

function getExcelCellValue(cell: ExcelJS.Cell | undefined): string | number | null {
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

function parseNumeric(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = typeof val === "number" ? val : parseFloat(String(val).replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

function parseInteger(val: unknown): number | null {
  const n = parseNumeric(val);
  return n === null ? null : Math.round(n);
}

function normalizeSheetName(name: string): string {
  return name.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function findWorksheetByName(workbook: ExcelJS.Workbook, aliases: string[]): ExcelJS.Worksheet | null {
  const normAliases = aliases.map(normalizeSheetName);
  for (const ws of workbook.worksheets) {
    const norm = normalizeSheetName(ws.name);
    if (normAliases.includes(norm)) {
      return ws;
    }
  }
  return null;
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

  wsSku.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const skuVal = getExcelCellValue(row.getCell(4));
    if (!skuVal) return;
    const sku = String(skuVal).trim();
    if (!sku) return;

    const brand = (getExcelCellValue(row.getCell(1)) as string) || null;
    const product_type = (getExcelCellValue(row.getCell(2)) as string) || null;
    const rawMockup = getExcelCellValue(row.getCell(3));
    const asin = (getExcelCellValue(row.getCell(5)) as string) || null;
    const fnsku = (getExcelCellValue(row.getCell(6)) as string) || null;
    const amazon_fee = parseNumeric(getExcelCellValue(row.getCell(7)));
    const referral_fee_pct = parseNumeric(getExcelCellValue(row.getCell(8)));
    const pic_mkt = (getExcelCellValue(row.getCell(9)) as string) || null;
    const loai = (getExcelCellValue(row.getCell(10)) as string) || null;
    const niche = (getExcelCellValue(row.getCell(11)) as string) || null;
    const pic_idea = (getExcelCellValue(row.getCell(12)) as string) || null;
    const status = (getExcelCellValue(row.getCell(13)) as string) || "Active";
    const event = (getExcelCellValue(row.getCell(14)) as string) || null;
    const tinh_trang = (getExcelCellValue(row.getCell(15)) as string) || null;
    const design_pic = (getExcelCellValue(row.getCell(16)) as string) || null;
    const mockup_url = (getExcelCellValue(row.getCell(17)) as string) || null;
    const thang_listing = (getExcelCellValue(row.getCell(18)) as string) || null;
    const thang_danh_gia = (getExcelCellValue(row.getCell(19)) as string) || null;
    const event_250th = (getExcelCellValue(row.getCell(20)) as string) || null;
    const ngay_danh_gia_sku_event = (getExcelCellValue(row.getCell(21)) as string) || null;
    const amazon_fba_fee_thay_doi = parseNumeric(getExcelCellValue(row.getCell(22)));
    const basecost_tb = parseNumeric(getExcelCellValue(row.getCell(23)));
    const brand_entity_id = (getExcelCellValue(row.getCell(24)) as string) || null;
    const creative_asins_video = (getExcelCellValue(row.getCell(25)) as string) || null;
    const creative_asins_collection = (getExcelCellValue(row.getCell(26)) as string) || null;
    const video_media_ids = (getExcelCellValue(row.getCell(27)) as string) || null;
    const creative_headline = (getExcelCellValue(row.getCell(28)) as string) || null;
    const brand_logo_asset_id = (getExcelCellValue(row.getCell(29)) as string) || null;
    const landing_page_url = (getExcelCellValue(row.getCell(30)) as string) || null;

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

  wsInbound.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const skuVal = getExcelCellValue(row.getCell(6));
    if (!skuVal) return;
    const sku = String(skuVal).trim();
    if (!sku) return;

    const brand = (getExcelCellValue(row.getCell(1)) as string) || null;
    const sup = (getExcelCellValue(row.getCell(2)) as string) || null;
    const ngay_request = (getExcelCellValue(row.getCell(3)) as string) || null;
    const product_type = (getExcelCellValue(row.getCell(4)) as string) || null;
    const rawMockup = getExcelCellValue(row.getCell(5));
    const mockup = typeof rawMockup === "string" && !rawMockup.startsWith("=") ? rawMockup : null;
    const quantity = parseInteger(getExcelCellValue(row.getCell(7))) || 0;
    const line_ship = (getExcelCellValue(row.getCell(8)) as string) || null;
    const base_cost_per_unit = parseNumeric(getExcelCellValue(row.getCell(9)));
    const card = parseNumeric(getExcelCellValue(row.getCell(10)));
    const tag = parseNumeric(getExcelCellValue(row.getCell(11)));
    const shipping_fee = parseNumeric(getExcelCellValue(row.getCell(12)));
    const hop_tui = parseNumeric(getExcelCellValue(row.getCell(13)));
    const final_basecost = parseNumeric(getExcelCellValue(row.getCell(14)));
    const total_basecost = parseNumeric(getExcelCellValue(row.getCell(15)));
    const ngay_thanh_toan = (getExcelCellValue(row.getCell(16)) as string) || null;
    const ten_lo_hang = (getExcelCellValue(row.getCell(17)) as string) || null;
    const shipment_id = (getExcelCellValue(row.getCell(18)) as string) || null;
    const ngay_di = (getExcelCellValue(row.getCell(19)) as string) || null;
    const ngay_den = (getExcelCellValue(row.getCell(20)) as string) || null;
    const amazon_received = parseInteger(getExcelCellValue(row.getCell(21)));
    const tinh_trang_hang_den_kho = (getExcelCellValue(row.getCell(22)) as string) || null;
    const status = (getExcelCellValue(row.getCell(23)) as string) || null;
    const so_luong_amazon_nhan = parseInteger(getExcelCellValue(row.getCell(24)));
    const discrepancy = parseInteger(getExcelCellValue(row.getCell(25)));
    const note = (getExcelCellValue(row.getCell(26)) as string) || null;
    const trang_thai = (getExcelCellValue(row.getCell(27)) as string) || null;

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
