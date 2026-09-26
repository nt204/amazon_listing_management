import "server-only";
import crypto from "node:crypto";

import { getDatabaseClient } from "@/lib/db";
import {
  calculateBreakEvenAcos,
  calculateMaxBid,
  calculateProfitBeforeAds,
  detectProductTypeFromSku,
  getSkuPrefixesForProductType,
  normalizeSkuPrefixes,
  SKU_PREFIX_ERROR_PRODUCT_TYPE,
  type ActionType,
  type BulkExport,
  type CostSource,
  type CrSource,
  type PpcAction,
  type PpcAutoUploadLog,
  type PpcRuleDefinition,
  type PpcRuleVersion,
  type ProductCostMaster,
  type SkuEconomics,
  type SkuPrefixRule,
  type SkuRecommendationGroup,
} from "./sku-architecture-types";
import type { PpcPerformanceRow, PpcRecommendation } from "./types";
import { extractSkuFromText } from "./sku-extractor";
import {
  commonRuleToDefinitions,
  parseAmazonPpcCommonRuleSet,
  type AmazonPpcCommonRuleSet,
} from "./common-rule-parser";
import { objectStorageDriver, putStoredObject, r2KeyPrefix } from "@/lib/object-storage";
import { invalidateGroupedRecommendationsCache } from "./recommendation-cache";

export async function resolveStoreId(storeIdOrName?: string | null): Promise<string> {
  const sql = await getDatabaseClient();
  if (storeIdOrName && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storeIdOrName)) {
    return storeIdOrName;
  }
  if (storeIdOrName && storeIdOrName !== "ALL") {
    const stores = await sql<{ id: string }[]>`
      SELECT id FROM ppc_stores
      WHERE lower(name) = lower(${storeIdOrName})
      ORDER BY created_at ASC LIMIT 1
    `;
    if (stores.length > 0) return stores[0].id;
  }
  const anyStore = await sql<{ id: string }[]>`SELECT id FROM ppc_stores ORDER BY created_at ASC LIMIT 1`;
  return anyStore.length > 0 ? anyStore[0].id : "00000000-0000-0000-0000-000000000000";
}

/* =========================================================================
   1. QUẢN LÝ PHÔI (PRODUCT COST MASTER)
   ========================================================================= */

export async function getCostMasters(storeIdOrName?: string | null): Promise<ProductCostMaster[]> {
  const sql = await getDatabaseClient();
  const storeId = await resolveStoreId(storeIdOrName);

  const rows = await sql<any[]>`
    WITH ranked AS (
      SELECT *,
             ROW_NUMBER() OVER(PARTITION BY product_type ORDER BY version DESC) as rn
      FROM product_cost_master
      WHERE store_id = ${storeId}
    )
    SELECT r.id, r.store_id, r.product_type, r.base_cost, r.default_amazon_fee, r.tax_rate,
           r.default_price, r.break_even_acos, r.sku_prefixes,
           r.version, r.effective_from, r.effective_to, r.notes, r.created_at, r.updated_at,
           COUNT(DISTINCT s.sku)::int as sku_count
    FROM ranked r
    LEFT JOIN sku_economics s ON s.product_type = r.product_type AND s.store_id = ${storeId}
    WHERE r.rn = 1
    GROUP BY r.id, r.store_id, r.product_type, r.base_cost, r.default_amazon_fee, r.tax_rate,
             r.default_price, r.break_even_acos, r.sku_prefixes,
             r.version, r.effective_from, r.effective_to, r.notes, r.created_at, r.updated_at
    ORDER BY r.product_type ASC
  `;

  return rows.map((r: any) => {
    const prefixes = Array.isArray(r.sku_prefixes) ? r.sku_prefixes : [];
    return {
      id: r.id,
      storeId: r.store_id,
      productType: r.product_type,
      baseCost: Number(r.base_cost),
      defaultAmazonFee: Number(r.default_amazon_fee),
      taxRate: Number(r.tax_rate),
      defaultPrice: Number(r.default_price || 0),
      breakEvenAcos: Number(r.break_even_acos || 0),
      skuPrefixes: prefixes,
      skuPrefix: prefixes.length > 0 ? prefixes.join(", ") : null,
      version: Number(r.version),
      effectiveFrom: r.effective_from ? new Date(r.effective_from).toISOString().split("T")[0] : "",
      effectiveTo: r.effective_to ? new Date(r.effective_to).toISOString().split("T")[0] : null,
      notes: r.notes || null,
      skuCount: Number(r.sku_count || 0),
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : "",
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : "",
    };
  });
}

export async function getCostMastersWithStores(storeIdOrName?: string | null): Promise<{
  masters: ProductCostMaster[];
  stores: Array<{ id: string; name: string; marketplace: string }>;
  activeStoreId: string;
}> {
  const sql = await getDatabaseClient();
  const storeRows = await sql<{ id: string; name: string; marketplace: string }[]>`
    SELECT id, name, marketplace FROM ppc_stores ORDER BY name ASC
  `;
  const activeStoreId = await resolveStoreId(storeIdOrName);
  const masters = await getCostMasters(activeStoreId);
  return {
    masters,
    stores: storeRows,
    activeStoreId,
  };
}

export async function saveCostMasterNewVersion(data: {
  storeId?: string;
  productType: string;
  skuPrefixes?: string[] | string;
  skuPrefix?: string;
  baseCost: number;
  defaultAmazonFee: number;
  taxRate: number;
  defaultPrice?: number;
  breakEvenAcos?: number;
  effectiveFrom?: string;
  notes?: string;
}): Promise<ProductCostMaster> {
  const sql = await getDatabaseClient();
  const storeId = await resolveStoreId(data.storeId);
  const effectiveDate = data.effectiveFrom || new Date().toISOString().split("T")[0];

  return await sql.begin(async (tx: any) => {
    // 1. Calculate or fallback break-even ACoS if missing or <= 0
    let beAcos = Number(data.breakEvenAcos || 0);
    const defPrice = Number(data.defaultPrice || 0);

    if (beAcos <= 0) {
      if (defPrice > 0) {
        const profitBeforeAds = defPrice - data.defaultAmazonFee - data.baseCost - (defPrice * data.taxRate);
        beAcos = profitBeforeAds > 0 ? (profitBeforeAds / defPrice) * 100 : 0;
      }
      if (beAcos <= 0) {
        const avgRows = await tx<{ avg_acos: string | null }[]>`
          SELECT AVG(break_even_acos) as avg_acos FROM product_cost_master WHERE store_id = ${storeId} AND break_even_acos > 0
        `;
        beAcos = avgRows[0]?.avg_acos ? Math.round(Number(avgRows[0].avg_acos) * 100) / 100 : 45.5;
      }
    }

    // 2. Find latest version for this store and product_type
    const latest = await tx`
      SELECT version, sku_prefixes FROM product_cost_master
      WHERE store_id = ${storeId} AND product_type = ${data.productType}
      ORDER BY version DESC LIMIT 1
    `;

    const nextVersion = latest.length > 0 ? Number(latest[0].version) + 1 : 1;

    // Handle sku prefixes per store
    let prefixes: string[];
    if (data.skuPrefixes !== undefined || data.skuPrefix !== undefined) {
      prefixes = normalizeSkuPrefixes(data.skuPrefixes ?? data.skuPrefix);
    } else if (latest.length > 0 && Array.isArray(latest[0].sku_prefixes) && latest[0].sku_prefixes.length > 0) {
      prefixes = latest[0].sku_prefixes;
    } else {
      prefixes = getSkuPrefixesForProductType(data.productType).map((p) => p.replace(/\*$/, ""));
    }

    // 3. Set effective_to for previous version of this store
    await tx`
      UPDATE product_cost_master
      SET effective_to = ${effectiveDate}, updated_at = NOW()
      WHERE store_id = ${storeId} AND product_type = ${data.productType} AND effective_to IS NULL
    `;

    // 4. Insert new version
    const inserted = await tx`
      INSERT INTO product_cost_master (
        store_id, product_type, base_cost, default_amazon_fee, tax_rate,
        default_price, break_even_acos, sku_prefixes, version, effective_from, notes
      ) VALUES (
        ${storeId}, ${data.productType}, ${data.baseCost}, ${data.defaultAmazonFee},
        ${data.taxRate}, ${defPrice}, ${beAcos}, ${prefixes}, ${nextVersion},
        ${effectiveDate}, ${data.notes || null}
      )
      RETURNING *
    `;

    // 5. Update SKU Economics inheriting from this Phôi ONLY in this store
    await tx`
      UPDATE sku_economics
      SET base_cost = ${data.baseCost}::numeric,
          amazon_fee = ${data.defaultAmazonFee}::numeric,
          tax_rate = ${data.taxRate}::numeric,
          selling_price = CASE WHEN selling_price <= 0 AND ${defPrice}::numeric > 0 THEN ${defPrice}::numeric ELSE selling_price END,
          profit_before_ads = (selling_price - ${data.defaultAmazonFee}::numeric - ${data.baseCost}::numeric - (selling_price * ${data.taxRate}::numeric)),
          break_even_acos = CASE
            WHEN selling_price > 0 THEN ((selling_price - ${data.defaultAmazonFee}::numeric - ${data.baseCost}::numeric - (selling_price * ${data.taxRate}::numeric)) / selling_price) * 100
            ELSE ${beAcos}::numeric END,
          max_bid = cr * (selling_price - ${data.defaultAmazonFee}::numeric - ${data.baseCost}::numeric - (selling_price * ${data.taxRate}::numeric)),
          updated_at = NOW()
      WHERE store_id = ${storeId} AND product_type = ${data.productType} AND cost_source = 'INHERITED'
    `;

    const r = inserted[0];
    const savedPrefixes = Array.isArray(r.sku_prefixes) ? r.sku_prefixes : prefixes;
    const result = {
      id: r.id,
      storeId: r.store_id,
      productType: r.product_type,
      baseCost: Number(r.base_cost),
      defaultAmazonFee: Number(r.default_amazon_fee),
      taxRate: Number(r.tax_rate),
      defaultPrice: Number(r.default_price || 0),
      breakEvenAcos: Number(r.break_even_acos || 0),
      skuPrefixes: savedPrefixes,
      skuPrefix: savedPrefixes.length > 0 ? savedPrefixes.join(", ") : null,
      version: Number(r.version),
      effectiveFrom: r.effective_from ? new Date(r.effective_from).toISOString().split("T")[0] : "",
      effectiveTo: null,
      notes: r.notes || null,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    };
    invalidateGroupedRecommendationsCache(storeId);
    return result;
  });
}

/**
 * Xuất toàn bộ bảng Cost Master ra file Excel (.xlsx) theo từng store
 */
export async function exportCostMasterToExcel(storeIdOrName?: string | null): Promise<{
  buffer: Buffer;
  storeName: string;
}> {
  const sql = await getDatabaseClient();
  const storeId = await resolveStoreId(storeIdOrName);
  const ExcelJS = (await import("exceljs")).default;
  const masters = await getCostMasters(storeId);

  const storeInfo = await sql<{ name: string; marketplace: string }[]>`
    SELECT name, marketplace FROM ppc_stores WHERE id = ${storeId} LIMIT 1
  `;
  const storeName = storeInfo[0]?.name || "Store";

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Amazon Listing Management";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Cost Master", {
    views: [{ showGridLines: true }],
  });

  sheet.columns = [
    { header: "[BẮT BUỘC] Product Type", key: "productType", width: 26 },
    { header: "[BẮT BUỘC] SKU Prefixes", key: "skuPrefixes", width: 28 },
    { header: "[BẮT BUỘC] Base Cost ($)", key: "baseCost", width: 22 },
    { header: "[BẮT BUỘC] Default Amazon Fee ($)", key: "defaultAmazonFee", width: 28 },
    { header: "[BẮT BUỘC] Default Price ($)", key: "defaultPrice", width: 24 },
    { header: "[TỰ TÍNH - Để trống] Profit Before Ads ($)", key: "profitBeforeAds", width: 30 },
    { header: "[TỰ TÍNH - Để trống] Break-even ACoS (%)", key: "breakEvenAcos", width: 30 },
    { header: "[TỰ TÍNH - Để trống] Min Bid ($)", key: "minBid", width: 24 },
    { header: "[TỰ TÍNH - Để trống] Max Bid ($)", key: "maxBid", width: 24 },
    { header: "[MẶC ĐỊNH 3% - Để trống] Tax Rate", key: "taxRate", width: 26 },
    { header: "Version", key: "version", width: 12 },
    { header: "Số SKU áp dụng", key: "skuCount", width: 16 },
    { header: "[TÙY CHỌN] Ghi chú", key: "notes", width: 45 },
  ];

  // Header styling: Cột 1-5 (thông tin chính cần nhập) tô màu Indigo, các cột còn lại (tự tính/tùy chọn) tô màu xám Slate
  const headerRow = sheet.getRow(1);
  headerRow.height = 32;
  headerRow.eachCell((cell, colNumber) => {
    const isPrimaryInput = colNumber <= 5;
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: isPrimaryInput ? "FF4F46E5" : "FF64748B" }, // Indigo 600 vs Slate 500
    };
    cell.font = {
      name: "Calibri",
      bold: true,
      color: { argb: "FFFFFFFF" },
      size: 11,
    };
    cell.alignment = {
      vertical: "middle",
      horizontal: "center",
      wrapText: true,
    };
    cell.border = {
      top: { style: "thin", color: { argb: isPrimaryInput ? "FF3730A3" : "FF475569" } },
      bottom: { style: "medium", color: { argb: isPrimaryInput ? "FF3730A3" : "FF475569" } },
      left: { style: "thin", color: { argb: isPrimaryInput ? "FF3730A3" : "FF475569" } },
      right: { style: "thin", color: { argb: isPrimaryInput ? "FF3730A3" : "FF475569" } },
    };
  });

  // Data rows or sample rows if empty
  const rowsToExport = masters.length > 0 ? masters : [
    {
      id: "sample-1",
      storeId,
      productType: "Ornament 2D (Ví dụ)",
      skuPrefixes: ["ORN", "GL-ORN"],
      baseCost: 2.00,
      defaultAmazonFee: 6.32,
      defaultPrice: 24.99,
      breakEvenAcos: 63.7,
      taxRate: 0.03,
      version: 1,
      skuCount: 0,
      notes: "👉 HƯỚNG DẪN: Bắt buộc điền 5 cột đầu (A-E). Các cột F->M có thể để trống, hệ thống sẽ tự tính ACoS hòa vốn!",
      effectiveFrom: new Date().toISOString().split("T")[0],
      effectiveTo: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "sample-2",
      storeId,
      productType: "Tumbler 20oz (Ví dụ)",
      skuPrefixes: ["TUM", "BL-TUM"],
      baseCost: 4.50,
      defaultAmazonFee: 7.20,
      defaultPrice: 32.99,
      breakEvenAcos: 61.5,
      taxRate: 0.03,
      version: 1,
      skuCount: 0,
      notes: "👉 SKU Prefixes: [BẮT BUỘC] Nhập 1 hoặc nhiều mã tiền tố SKU nhận diện, cách nhau bằng dấu phẩy",
      effectiveFrom: new Date().toISOString().split("T")[0],
      effectiveTo: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  rowsToExport.forEach((m, idx) => {
    const profitBeforeAds = m.defaultPrice > 0 ? (m.defaultPrice - m.defaultAmazonFee - m.baseCost) : 0;
    const maxBid = profitBeforeAds > 0 ? Number((0.10 * profitBeforeAds).toFixed(2)) : 0.05;
    const prefixes = (m.skuPrefixes && m.skuPrefixes.length > 0)
      ? m.skuPrefixes.join(", ")
      : getSkuPrefixesForProductType(m.productType).map((p) => p.replace(/\*$/, "")).join(", ");

    const row = sheet.addRow({
      productType: m.productType,
      skuPrefixes: prefixes,
      baseCost: m.baseCost,
      defaultAmazonFee: m.defaultAmazonFee,
      defaultPrice: m.defaultPrice,
      profitBeforeAds: profitBeforeAds > 0 ? Number(profitBeforeAds.toFixed(2)) : 0,
      breakEvenAcos: m.breakEvenAcos ? `${Math.round(m.breakEvenAcos)}%` : "0%",
      minBid: 0.05,
      maxBid: maxBid,
      taxRate: m.taxRate,
      version: `v${m.version}`,
      skuCount: m.skuCount || 0,
      notes: m.notes || "",
    });

    row.height = 24;
    const isEven = idx % 2 === 0;
    row.eachCell((cell, colNumber) => {
      cell.font = { name: "Calibri", size: 10 };
      cell.alignment = { vertical: "middle" };
      if (!isEven) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF8FAFC" },
        };
      }
      cell.border = {
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };

      // Currency format for Base Cost (3), Fee (4), Price (5), Profit Before Ads (6), Min Bid (8), Max Bid (9)
      if ([3, 4, 5, 6, 8, 9].includes(colNumber)) {
        cell.numFmt = "$#,##0.00";
        cell.alignment = { vertical: "middle", horizontal: "right" };
      }
      // ACoS col 7
      if (colNumber === 7) {
        cell.alignment = { vertical: "middle", horizontal: "center" };
      }
      // Tax rate col 10
      if (colNumber === 10) {
        cell.numFmt = "0.0%";
        cell.alignment = { vertical: "middle", horizontal: "right" };
      }
      // Version col 11, SKU Count col 12
      if (colNumber === 11 || colNumber === 12) {
        cell.alignment = { vertical: "middle", horizontal: "center" };
      }
    });
  });

  // Tạo thêm Tab 2: "Hướng Dẫn Điền File" để người dùng đọc chi tiết nếu cần
  const guideSheet = workbook.addWorksheet("Hướng Dẫn Điền File", {
    views: [{ showGridLines: true }],
  });
  guideSheet.columns = [
    { header: "Cột", key: "col", width: 10 },
    { header: "Tên Cột", key: "name", width: 32 },
    { header: "Quy Định Nhập", key: "rule", width: 22 },
    { header: "Mô Tả & Hướng Dẫn Chi Tiết", key: "desc", width: 60 },
  ];

  const guideHeaderRow = guideSheet.getRow(1);
  guideHeaderRow.height = 28;
  guideHeaderRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3730A3" } };
    cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });

  const guideRules = [
    { col: "A", name: "[BẮT BUỘC] Product Type", rule: "Bắt buộc điền", desc: "Tên loại phôi sản phẩm (ví dụ: Ornament, Tumbler 20oz, Blanket...)" },
    { col: "B", name: "[BẮT BUỘC] SKU Prefixes", rule: "Bắt buộc điền", desc: "Mã tiền tố SKU trên Amazon (ví dụ: ORN, GL-ORN hoặc BDL, BQL). Có thể điền nhiều mã cách nhau bằng dấu phẩy. BẮT BUỘC để hệ thống nhận diện đúng sản phẩm của store." },
    { col: "C", name: "[BẮT BUỘC] Base Cost ($)", rule: "Bắt buộc điền", desc: "Giá vốn sản xuất / nhập hàng (ví dụ: 2.00 hoặc $2.00)" },
    { col: "D", name: "[BẮT BUỘC] Default Amazon Fee ($)", rule: "Bắt buộc điền", desc: "Phí sàn Amazon ước tính (ví dụ: 6.32 hoặc $6.32). Nếu không có điền 0." },
    { col: "E", name: "[BẮT BUỘC] Default Price ($)", rule: "Bắt buộc điền", desc: "Giá bán niêm yết trên Amazon (ví dụ: 24.99 hoặc $24.99)" },
    { col: "F", name: "[TỰ TÍNH] Profit Before Ads ($)", rule: "CÓ THỂ ĐỂ TRỐNG", desc: "Hệ thống tự động tính: Giá bán - Phí sàn - Giá vốn - (Giá bán x Thuế)" },
    { col: "G", name: "[TỰ TÍNH] Break-even ACoS (%)", rule: "CÓ THỂ ĐỂ TRỐNG", desc: "Hệ thống tự động tính: (Lãi trước ads / Giá bán) x 100%" },
    { col: "H", name: "[TỰ TÍNH] Min Bid ($)", rule: "CÓ THỂ ĐỂ TRỐNG", desc: "Mặc định $0.05" },
    { col: "I", name: "[TỰ TÍNH] Max Bid ($)", rule: "CÓ THỂ ĐỂ TRỐNG", desc: "Hệ thống tự động tính: 10% x Lãi trước ads" },
    { col: "J", name: "[MẶC ĐỊNH 3%] Tax Rate", rule: "CÓ THỂ ĐỂ TRỐNG", desc: "Mặc định 3% nếu bạn để trống" },
    { col: "K", name: "Version", rule: "CÓ THỂ ĐỂ TRỐNG", desc: "Hệ thống tự động quản lý phiên bản v1.0, v2.0..." },
    { col: "L", name: "Số SKU áp dụng", rule: "CÓ THỂ ĐỂ TRỐNG", desc: "Hệ thống tự động đếm SKU thực tế của store đang dùng phôi này" },
    { col: "M", name: "[TÙY CHỌN] Ghi chú", rule: "CÓ THỂ ĐỂ TRỐNG", desc: "Ghi chú nội bộ của bạn (tùy chọn)" },
  ];

  guideRules.forEach((g) => {
    const r = guideSheet.addRow(g);
    r.height = 22;
    r.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    r.getCell(2).font = { bold: true };
    r.getCell(3).font = { bold: true, color: { argb: g.rule.includes("Bắt buộc") ? "FFB91C1C" : "FF047857" } };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(buffer),
    storeName,
  };
}

/**
 * Xóa một bản ghi phôi (Cost Master)
 */
export async function deleteCostMaster(
  id: string,
  storeIdOrName?: string | null,
): Promise<boolean> {
  const sql = await getDatabaseClient();

  // 1. Tìm bản ghi phôi để xác định store_id và product_type chính xác
  let target: { id: string; store_id: string; product_type: string } | null = null;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

  if (isUuid) {
    const rows = await sql<{ id: string; store_id: string; product_type: string }[]>`
      SELECT id, store_id, product_type FROM product_cost_master WHERE id = ${id} LIMIT 1
    `;
    if (rows[0]) target = rows[0];
  }

  if (!target && storeIdOrName) {
    const storeId = await resolveStoreId(storeIdOrName);
    const rows = await sql<{ id: string; store_id: string; product_type: string }[]>`
      SELECT id, store_id, product_type FROM product_cost_master 
      WHERE (id = ${id} OR lower(product_type) = lower(${id})) AND store_id = ${storeId}
      LIMIT 1
    `;
    if (rows[0]) target = rows[0];
  }

  if (!target) {
    return false;
  }

  const actualStoreId = target.store_id;
  const productType = target.product_type;

  // 2. Xóa TẤT CẢ các version của product_type này trong store đó
  const res = await sql`
    DELETE FROM product_cost_master
    WHERE store_id = ${actualStoreId} AND lower(product_type) = lower(${productType})
    RETURNING id
  `;

  if (res.length > 0) {
    invalidateGroupedRecommendationsCache(actualStoreId);
  }
  return res.length > 0;
}

/**
 * Sao chép toàn bộ danh sách phôi từ một store nguồn sang store đích
 */
export async function cloneCostMasters(
  sourceStoreName: string,
  targetStoreName: string,
): Promise<{ clonedCount: number }> {
  const sql = await getDatabaseClient();
  const sourceId = await resolveStoreId(sourceStoreName);
  const targetId = await resolveStoreId(targetStoreName);

  const sourceMasters = await getCostMasters(sourceId);
  if (!sourceMasters.length) return { clonedCount: 0 };

  const effectiveDate = new Date().toISOString().split("T")[0];
  let count = 0;

  for (const m of sourceMasters) {
    await saveCostMasterNewVersion({
      storeId: targetId,
      productType: m.productType,
      skuPrefixes: m.skuPrefixes,
      baseCost: m.baseCost,
      defaultAmazonFee: m.defaultAmazonFee,
      taxRate: m.taxRate,
      defaultPrice: m.defaultPrice,
      breakEvenAcos: m.breakEvenAcos,
      effectiveFrom: effectiveDate,
      notes: `Sao chép từ ${sourceStoreName}`,
    });
    count++;
  }

  invalidateGroupedRecommendationsCache(targetId);
  return { clonedCount: count };
}

/**
 * Helper bóc tách số từ ô Excel (loại bỏ $, ký hiệu tiền tệ, dấu phẩy, khoảng trắng, hoặc formula object)
 */
function parseExcelNumericValue(val: unknown): number {
  if (val === null || val === undefined || val === "") return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if ("result" in obj && obj.result !== null && obj.result !== undefined) {
      return parseExcelNumericValue(obj.result);
    }
    if ("text" in obj && typeof obj.text === "string") {
      return parseExcelNumericValue(obj.text);
    }
  }
  const clean = String(val).replace(/[$€₫,\s]/g, "").trim();
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n;
}

function parseExcelTaxRate(val: unknown): number {
  if (val === null || val === undefined || val === "") return 0.03;
  if (typeof val === "number") {
    if (isNaN(val) || val <= 0) return 0.03;
    return val > 1 ? val / 100 : val;
  }
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if ("result" in obj && obj.result !== null && obj.result !== undefined) {
      return parseExcelTaxRate(obj.result);
    }
  }
  const clean = String(val).replace(/[%,\s]/g, "").trim();
  const n = parseFloat(clean);
  if (isNaN(n) || n <= 0) return 0.03;
  return n > 1 ? n / 100 : n;
}

/**
 * Nhập bảng Cost Master từ file Excel (.xlsx) theo từng store:
 * Người dùng chỉ cần nhập 5 cột chính: Product Type, SKU Prefixes, Base Cost, Amazon Fee, Price.
 * Các cột còn lại (Profit, Break-even ACoS, Min/Max Bid, Version...) nếu để trống hệ thống sẽ tự tính toán.
 */
export async function importCostMasterFromExcel(
  buffer: Buffer,
  storeIdOrName?: string | null,
): Promise<{
  importedCount: number;
  items: Array<{ productType: string; baseCost: number; breakEvenAcos: number }>;
}> {
  const storeId = await resolveStoreId(storeIdOrName);
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  // @ts-expect-error - ExcelJS accepts Buffer directly in load
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("File Excel không có dữ liệu bảng tính hợp lệ.");
  }

  // Find header row and column mapping
  let headerRowNumber = -1;
  const colMap: Record<string, number> = {};

  worksheet.eachRow((row, rowNumber) => {
    if (headerRowNumber !== -1) return;
    const values = (row.values as any[]) || [];
    const textJoined = values.map((v) => String(v || "").toLowerCase()).join(" ");
    const normTextJoined = textJoined.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    if (normTextJoined.includes("product") || normTextJoined.includes("phoi") || normTextJoined.includes("type") || normTextJoined.includes("loai")) {
      headerRowNumber = rowNumber;
      values.forEach((v, idx) => {
        if (!v) return;
        const raw = String(v).trim().toLowerCase();
        const norm = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        if (norm.includes("product") || norm.includes("phoi") || norm.includes("loai")) colMap.productType = idx;
        else if (norm.includes("prefix") || norm.includes("tien to")) colMap.skuPrefixes = idx;
        else if (norm.includes("base") || norm.includes("von") || norm.includes("nhap") || norm.includes("gia goc")) colMap.baseCost = idx;
        else if (norm.includes("fee") || norm.includes("phi") || norm.includes("amz fee")) colMap.defaultAmazonFee = idx;
        else if (norm.includes("price") || norm.includes("gia ban") || norm.includes("don gia")) colMap.defaultPrice = idx;
        else if (norm.includes("acos") || norm.includes("hoa von")) colMap.breakEvenAcos = idx;
        else if (norm.includes("tax") || norm.includes("thue")) colMap.taxRate = idx;
        else if (norm.includes("ghi chu") || norm.includes("note")) colMap.notes = idx;
      });
    }
  });

  if (headerRowNumber === -1 || colMap.productType === undefined) {
    throw new Error("Không nhận diện được tiêu đề cột 'Product Type' hoặc 'Phôi' trong file Excel.");
  }
  if (colMap.skuPrefixes === undefined) {
    throw new Error("Không nhận diện được cột '[BẮT BUỘC] SKU Prefixes' trong file Excel. Vui lòng tải file mẫu mới nhất.");
  }

  const items: Array<{ productType: string; baseCost: number; breakEvenAcos: number }> = [];

  for (let r = headerRowNumber + 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const productTypeRaw = colMap.productType ? String(row.getCell(colMap.productType).value || "").trim() : "";
    if (!productTypeRaw) continue;

    // Tự động bỏ qua các dòng ví dụ mẫu nếu người dùng quên chưa xóa
    const lowerType = productTypeRaw.toLowerCase();
    if (lowerType.includes("(ví dụ)") || lowerType.includes("(vi du)") || lowerType.includes("(sample)") || lowerType.includes("(mẫu)")) {
      continue;
    }

    // Parse Base Cost, Default Amazon Fee, Default Price
    const baseCost = colMap.baseCost ? parseExcelNumericValue(row.getCell(colMap.baseCost).value) : 0;
    const defaultAmazonFee = colMap.defaultAmazonFee ? parseExcelNumericValue(row.getCell(colMap.defaultAmazonFee).value) : 0;
    const defaultPrice = colMap.defaultPrice ? parseExcelNumericValue(row.getCell(colMap.defaultPrice).value) : 0;
    const taxRate = colMap.taxRate ? parseExcelTaxRate(row.getCell(colMap.taxRate).value) : 0.03;

    // Parse Break Even ACoS or auto calculate if left blank
    let breakEvenAcos = 0;
    if (colMap.breakEvenAcos) {
      breakEvenAcos = parseExcelNumericValue(row.getCell(colMap.breakEvenAcos).value);
      if (breakEvenAcos > 0 && breakEvenAcos <= 1) {
        breakEvenAcos = breakEvenAcos * 100;
      }
    }

    // Tự động tính Break-even ACoS nếu người dùng để trống
    if (breakEvenAcos <= 0 && defaultPrice > 0) {
      const profit = defaultPrice - defaultAmazonFee - baseCost - (defaultPrice * taxRate);
      if (profit > 0) {
        breakEvenAcos = Math.round((profit / defaultPrice) * 1000) / 10;
      }
    }

    // Parse Notes & SKU Prefixes
    const notes = colMap.notes ? String(row.getCell(colMap.notes).value || "").trim() : "";
    const prefixRaw = colMap.skuPrefixes ? String(row.getCell(colMap.skuPrefixes).value || "").trim() : "";

    // Cột SKU Prefixes là bắt buộc: nếu người dùng bỏ trống cột này thì báo lỗi rõ ràng
    if (!prefixRaw) {
      throw new Error(`Dòng ${r} (${productTypeRaw}): Cột '[BẮT BUỘC] SKU Prefixes' chưa có dữ liệu. Vui lòng điền tiền tố SKU (ví dụ: ORN, GL-ORN hoặc BDL, BQL...) để hệ thống nhận diện sản phẩm.`);
    }

    const prefixes = normalizeSkuPrefixes(prefixRaw);
    if (!prefixes || prefixes.length === 0) {
      throw new Error(`Dòng ${r} (${productTypeRaw}): Tiền tố SKU không hợp lệ.`);
    }

    const saved = await saveCostMasterNewVersion({
      storeId,
      productType: productTypeRaw,
      skuPrefixes: prefixes,
      baseCost,
      defaultAmazonFee,
      taxRate,
      defaultPrice,
      breakEvenAcos,
      notes,
    });

    items.push({
      productType: saved.productType,
      baseCost: saved.baseCost,
      breakEvenAcos: saved.breakEvenAcos,
    });
  }

  invalidateGroupedRecommendationsCache(storeId);
  return {
    importedCount: items.length,
    items,
  };
}

/* =========================================================================
   2. SKU ECONOMICS (TAB SẢN PHẨM)
   ========================================================================= */

export async function getSkuEconomicsList(storeId: string, days = 30): Promise<SkuEconomics[]> {
  const sql = await getDatabaseClient();

  const masters = await getCostMasters(storeId);
  const masterMap = new Map(masters.map((m) => [m.productType, m]));

  const defaultMaster: ProductCostMaster = masterMap.get("Ornament") || masterMap.get("Glass Ornament") || {
    id: "default-ornament",
    productType: "Ornament",
    baseCost: 2.0,
    defaultAmazonFee: 6.32,
    taxRate: 0.03,
    defaultPrice: 15.99,
    breakEvenAcos: 48.0,
    version: 1,
    effectiveFrom: "2026-09-01",
    effectiveTo: null,
    notes: null,
    skuCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const perfRows = await sql<any[]>`
    WITH latest_snapshot AS (
      SELECT DISTINCT ON (ad_type)
        ad_type, snapshot_date, report_start_date, report_end_date
      FROM ppc_performance_facts
      WHERE store_id = ${storeId}
        AND (report_end_date - report_start_date + 1)
          BETWEEN ${days - 3}::integer AND ${days + 3}::integer
      ORDER BY ad_type, snapshot_date DESC, report_end_date DESC
    )
    SELECT
      NULLIF(TRIM(sku), '') as sku,
      MAX(NULLIF(TRIM(asin), '')) as asin,
      MAX(campaign_name) as sample_campaign,
      SUM(spend) as total_spend,
      SUM(sales) as total_sales,
      SUM(orders) as total_orders,
      SUM(units) as total_units,
      SUM(clicks) as total_clicks,
      SUM(impressions) as total_impressions
    FROM ppc_performance_facts p
    JOIN latest_snapshot latest
      ON latest.ad_type = p.ad_type
      AND latest.snapshot_date = p.snapshot_date
      AND latest.report_start_date = p.report_start_date
      AND latest.report_end_date = p.report_end_date
    WHERE p.store_id = ${storeId}
      AND p.grain = 'PRODUCT'
      AND sku IS NOT NULL AND TRIM(sku) != ''
    GROUP BY NULLIF(TRIM(sku), '')
    ORDER BY total_spend DESC
  `;

  const existingEconomics = await sql<any[]>`
    SELECT * FROM sku_economics WHERE store_id = ${storeId}
  `;
  const econMap = new Map<string, any>(existingEconomics.map((e: any) => [String(e.sku).toUpperCase(), e]));

  // Build store-level prefix rules based on configured cost masters
  const storePrefixRules: SkuPrefixRule[] = [];
  for (const m of masters) {
    const prefixes = (m.skuPrefixes && m.skuPrefixes.length > 0)
      ? m.skuPrefixes
      : getSkuPrefixesForProductType(m.productType).map((p) => p.replace(/\*$/, ""));
    for (const prefix of prefixes) {
      storePrefixRules.push({ prefix, productType: m.productType });
    }
  }

  const result: SkuEconomics[] = [];

  for (const p of perfRows) {
    const sku = (p.sku || "").toUpperCase();
    const existing = econMap.get(sku);

    const spend = Number(p.total_spend || 0);
    const sales = Number(p.total_sales || 0);
    const orders = Number(p.total_orders || 0);
    const units = Number(p.total_units || 0);
    const clicks = Number(p.total_clicks || 0);
    const impressions = Number(p.total_impressions || 0);

    const actualCr = clicks > 0 ? orders / clicks : 0;
    const actualAcos = sales > 0 ? (spend / sales) * 100 : 0;

    const detected = detectProductTypeFromSku(sku, p.sample_campaign, storePrefixRules);
    const productType = existing?.cost_source === "OVERRIDE" && existing?.product_type
      ? existing.product_type
      : detected;
    const hasPrefixError = productType === SKU_PREFIX_ERROR_PRODUCT_TYPE;

    let master: ProductCostMaster = hasPrefixError
      ? {
        ...defaultMaster,
        id: "prefix-error",
        productType: SKU_PREFIX_ERROR_PRODUCT_TYPE,
        baseCost: 0,
        defaultAmazonFee: 0,
        defaultPrice: 0,
        breakEvenAcos: 0,
      }
      : (masterMap.get(productType) || defaultMaster);
    if (master === defaultMaster && productType === "Glass Ornament" && masterMap.has("Ornament")) {
      master = masterMap.get("Ornament")!;
    }
    if (master === defaultMaster && productType === "Ornament" && masterMap.has("Glass Ornament")) {
      master = masterMap.get("Glass Ornament")!;
    }

    // Nếu SKU có đơn hàng: Tính giá bán thực tế trung bình từ doanh thu và số lượng bán
    const dynamicPrice = orders > 0 && sales > 0
      ? (units > 0 ? sales / units : sales / orders)
      : 0;

    let sellingPrice = hasPrefixError
      ? 0
      : existing && existing.cost_source === "OVERRIDE" && Number(existing.selling_price) > 0
        ? Number(existing.selling_price)
        : orders > 0 && dynamicPrice > 0
          ? Math.round(dynamicPrice * 100) / 100
          : existing && Number(existing.selling_price) > 0
            ? Number(existing.selling_price)
            : (master.defaultPrice > 0 ? master.defaultPrice : 15.99);
    let baseCost = existing && existing.cost_source === "OVERRIDE"
      ? Number(existing.base_cost)
      : master.baseCost;
    let amazonFee = existing && existing.cost_source === "OVERRIDE"
      ? Number(existing.amazon_fee)
      : master.defaultAmazonFee;
    let taxRate = existing && existing.cost_source === "OVERRIDE"
      ? Number(existing.tax_rate)
      : master.taxRate;
    let costSource: CostSource = existing?.cost_source || "INHERITED";

    // CR mục tiêu cố định 10% (0.10) cho tất cả các phôi. Max Bid luôn tính theo phôi (Max Bid = 10% * Profit Before Ads).
    // Chỉ thay đổi khi người dùng chủ động OVERRIDE.
    let cr = existing?.cr_source === "OVERRIDE" ? Number(existing.cr) : 0.10;
    let crSource: CrSource = existing?.cr_source === "OVERRIDE" ? "OVERRIDE" : "ASSUMED";

    // Break-even ACoS & Profit Before Ads:
    // - Khi OVERRIDE hoặc khi SKU có đơn hàng (orders > 0): Tính linh hoạt theo giá bán thực tế, base cost và fee giữ nguyên theo phôi.
    // - Khi INHERITED chưa có đơn: Sử dụng các giá trị chuẩn mặc định của phôi
    let profitBeforeAds: number;
    let breakEvenAcos: number;

    if (costSource === "OVERRIDE") {
      profitBeforeAds = calculateProfitBeforeAds(sellingPrice, amazonFee, baseCost, taxRate);
      breakEvenAcos = calculateBreakEvenAcos(profitBeforeAds, sellingPrice);
    } else if (orders > 0 && dynamicPrice > 0) {
      profitBeforeAds = calculateProfitBeforeAds(sellingPrice, amazonFee, baseCost, taxRate);
      breakEvenAcos = calculateBreakEvenAcos(profitBeforeAds, sellingPrice);
    } else {
      profitBeforeAds = master.defaultPrice > 0
        ? Math.round((master.defaultPrice - master.defaultAmazonFee - master.baseCost) * 100) / 100
        : calculateProfitBeforeAds(sellingPrice, amazonFee, baseCost, taxRate);
      breakEvenAcos = master.breakEvenAcos > 0
        ? master.breakEvenAcos
        : calculateBreakEvenAcos(profitBeforeAds, sellingPrice);
    }

    const maxBid = hasPrefixError ? 0 : calculateMaxBid(cr, profitBeforeAds);

    // Đồng bộ vào sku_economics nếu có đơn hàng và giá bán được tính tự động
    if (existing && existing.cost_source === "INHERITED" && orders > 0 && dynamicPrice > 0) {
      void sql`
        UPDATE sku_economics
        SET selling_price = ${sellingPrice},
            profit_before_ads = ${profitBeforeAds},
            break_even_acos = ${breakEvenAcos},
            max_bid = ${maxBid},
            updated_at = NOW()
        WHERE store_id = ${storeId} AND sku = ${sku} AND cost_source = 'INHERITED'
      `.catch(() => { });
    }

    let ppcStatus: "Healthy" | "Review" | "Bleeding" | "Zero Clicks" = "Healthy";
    if (clicks === 0) {
      ppcStatus = "Zero Clicks";
    } else if (actualAcos > breakEvenAcos) {
      ppcStatus = "Bleeding";
    } else if (actualAcos > breakEvenAcos * 0.8) {
      ppcStatus = "Review";
    } else {
      ppcStatus = "Healthy";
    }

    result.push({
      id: existing?.id || `sku-econ-${sku}`,
      storeId,
      sku,
      asin: existing?.asin || p.asin || "B0XXXX",
      productType,
      sellingPrice,
      baseCost,
      amazonFee,
      taxRate,
      profitBeforeAds,
      breakEvenAcos,
      cr: Math.round(cr * 1000) / 1000,
      crSource,
      maxBid,
      costSource,
      ppcStatus,
      spend,
      sales,
      orders,
      clicks,
      impressions,
      acos: Math.round(actualAcos * 10) / 10,
    });
  }

  return result;
}

export async function upsertSkuEconomics(
  storeId: string,
  sku: string,
  data: {
    asin?: string;
    productType?: string;
    sellingPrice?: number;
    baseCost?: number;
    amazonFee?: number;
    taxRate?: number;
    cr?: number;
    crSource?: CrSource;
    costSource?: CostSource;
  },
): Promise<SkuEconomics> {
  const sql = await getDatabaseClient();
  const normalizedSku = sku.toUpperCase().trim();

  const pType = data.productType || "Ornament";
  const masters = await getCostMasters(storeId);
  const master = masters.find((m) => m.productType === pType) || {
    baseCost: 2.0,
    defaultAmazonFee: 6.32,
    taxRate: 0.03,
  };

  const sellingPrice = data.sellingPrice ?? 15.99;
  const baseCost = data.baseCost ?? master.baseCost;
  const amazonFee = data.amazonFee ?? master.defaultAmazonFee;
  const taxRate = data.taxRate ?? master.taxRate;
  const cr = data.cr ?? 0.10;
  const crSource = data.crSource ?? "OVERRIDE";
  const costSource = data.costSource ?? "OVERRIDE";

  const profitBeforeAds = calculateProfitBeforeAds(sellingPrice, amazonFee, baseCost, taxRate);
  const breakEvenAcos = calculateBreakEvenAcos(profitBeforeAds, sellingPrice);
  const maxBid = calculateMaxBid(cr, profitBeforeAds);

  const rows = await sql<any[]>`
    INSERT INTO sku_economics (
      store_id, sku, asin, product_type, selling_price, base_cost,
      amazon_fee, tax_rate, profit_before_ads, break_even_acos,
      cr, cr_source, max_bid, cost_source, updated_at
    ) VALUES (
      ${storeId}, ${normalizedSku}, ${data.asin || ''}, ${pType},
      ${sellingPrice}, ${baseCost}, ${amazonFee}, ${taxRate},
      ${profitBeforeAds}, ${breakEvenAcos}, ${cr}, ${crSource},
      ${maxBid}, ${costSource}, NOW()
    )
    ON CONFLICT (store_id, sku) DO UPDATE
    SET asin = COALESCE(EXCLUDED.asin, sku_economics.asin),
        product_type = EXCLUDED.product_type,
        selling_price = EXCLUDED.selling_price,
        base_cost = EXCLUDED.base_cost,
        amazon_fee = EXCLUDED.amazon_fee,
        tax_rate = EXCLUDED.tax_rate,
        profit_before_ads = EXCLUDED.profit_before_ads,
        break_even_acos = EXCLUDED.break_even_acos,
        cr = EXCLUDED.cr,
        cr_source = EXCLUDED.cr_source,
        max_bid = EXCLUDED.max_bid,
        cost_source = EXCLUDED.cost_source,
        updated_at = NOW()
    RETURNING *
  `;

  const r = rows[0];
  const result = {
    id: r.id,
    storeId: r.store_id,
    sku: r.sku,
    asin: r.asin,
    productType: r.product_type,
    sellingPrice: Number(r.selling_price),
    baseCost: Number(r.base_cost),
    amazonFee: Number(r.amazon_fee),
    taxRate: Number(r.tax_rate),
    profitBeforeAds: Number(r.profit_before_ads),
    breakEvenAcos: Number(r.break_even_acos),
    cr: Number(r.cr),
    crSource: r.cr_source,
    maxBid: Number(r.max_bid),
    costSource: r.cost_source,
  };

  invalidateGroupedRecommendationsCache(storeId);
  return result;
}

/* =========================================================================
   3. RULE ENGINE (SB01, SB05, SP03)
   ========================================================================= */

export async function getRuleVersions(): Promise<PpcRuleVersion[]> {
  const sql = await getDatabaseClient();
  const rows = await sql<any[]>`
    SELECT id, campaign_type, version, status, rule_json, effective_from, created_at
    FROM ppc_rule_versions
    ORDER BY campaign_type ASC, (status = 'PUBLISHED') DESC, created_at DESC
  `;

  return rows.map((r: any) => ({
    id: r.id,
    campaignType: r.campaign_type,
    version: r.version,
    status: r.status,
    ruleJson: r.rule_json as PpcRuleDefinition,
    effectiveFrom: r.effective_from ? new Date(r.effective_from).toISOString().split("T")[0] : "",
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : "",
  }));
}

export async function getAmazonPpcCommonRuleSet(): Promise<AmazonPpcCommonRuleSet> {
  const sql = await getDatabaseClient();
  const rows = await sql<{ config_json: unknown }[]>`
    SELECT config_json FROM ppc_sku_mapping_rules
    WHERE rule_set_id = 'amazon_ppc_common_bid_rules'
    LIMIT 1
  `;
  if (!rows[0]) throw new Error("Chưa có amazon_ppc_common_bid_rules.");
  return parseAmazonPpcCommonRuleSet(rows[0].config_json);
}

export async function replaceAmazonPpcCommonRuleSet(input: unknown): Promise<PpcRuleVersion[]> {
  const ruleSet = parseAmazonPpcCommonRuleSet(input);
  const definitions = commonRuleToDefinitions(ruleSet);
  const sql = await getDatabaseClient();
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO ppc_sku_mapping_rules (rule_set_id, config_json, version)
      VALUES ('amazon_ppc_common_bid_rules', ${tx.json(ruleSet as any)}, ${ruleSet.schema_version})
      ON CONFLICT (rule_set_id) DO UPDATE
      SET config_json = EXCLUDED.config_json, version = EXCLUDED.version, updated_at = NOW()
    `;
    for (const definition of definitions) {
      await tx`
        INSERT INTO ppc_rule_versions (campaign_type, version, status, rule_json, effective_from)
        VALUES (${definition.campaignType}, ${ruleSet.schema_version}, 'PUBLISHED', ${tx.json(definition as any)}, CURRENT_DATE)
        ON CONFLICT (campaign_type, version) DO UPDATE
        SET status = 'PUBLISHED', rule_json = EXCLUDED.rule_json, effective_from = CURRENT_DATE
      `;
      await tx`
        UPDATE ppc_rule_versions SET status = 'ARCHIVED'
        WHERE campaign_type = ${definition.campaignType} AND version <> ${ruleSet.schema_version} AND status = 'PUBLISHED'
      `;
    }
  });
  return getRuleVersions();
}

function inRuleRange(value: number, min: number, max: number, minInclusive: boolean, maxInclusive: boolean) {
  return (minInclusive ? value >= min : value > min) && (maxInclusive ? value <= max : value < max);
}

export function evaluateRowWithRuleEngine(
  row: PpcPerformanceRow,
  ruleMap: Map<string, PpcRuleDefinition>,
  econMap: Map<string, SkuEconomics>,
): PpcRecommendation | null {
  if (row.grain !== "TARGET" || row.isNegative) return null;
  if (/paused|archived/i.test(row.state || row.campaignState || row.adGroupState)) return null;

  const sku = (
    extractSkuFromText(row.sku) ||
    extractSkuFromText(row.campaignName) ||
    (row.sku || (row.campaignName ? row.campaignName.trim().split(/\s+/)[0] : ""))
  ).toUpperCase();
  const campaignName = (row.campaignName || "").toUpperCase();

  // Yêu cầu: Phần chỉnh bid chỉ áp dụng cho SP03, SB05, SB01.
  // SP04, SP01, SP02 tạm thời không áp dụng.
  if (/\bSP01\b|SP01|\bSP02\b|SP02|\bSP04\b|SP04/.test(campaignName)) {
    return null;
  }

  const format = /SB05|\bVIDEO\b/.test(campaignName)
    ? "SB05"
    : /SB01/.test(campaignName)
      ? "SB01"
      : /SP03/.test(campaignName)
        ? "SP03"
        : null;

  if (!format) return null;
  const rule = ruleMap.get(format);
  if (!rule) return null;

  const econ = econMap.get(sku);
  // Không được áp kinh tế của một phôi mặc định cho SKU chưa được ánh xạ.
  if (!econ || econ.productType === SKU_PREFIX_ERROR_PRODUCT_TYPE || econ.maxBid <= 0) return null;

  const baseCpc = typeof row.cpc === "number" && row.cpc > 0 ? row.cpc : 0;
  const currentBid = (row.bid && row.bid > 0) ? row.bid : (baseCpc > 0 ? baseCpc : rule.limits.minBid);
  const avgCpc = row.clicks > 0 ? (row.spend / row.clicks) : (baseCpc > 0 ? baseCpc : currentBid);
  const hasOrders = row.orders > 0;
  const actualAcos = row.sales > 0 ? (row.spend / row.sales) * 100 : 999;

  let recType: "BID_INCREASE" | "BID_DECREASE" | "PAUSE_TARGET" | null = null;
  let targetBid = currentBid;
  let reason = "";
  let priority: "P0" | "P1" | "P2" = "P1";
  let actionState: "ENABLE" | "PAUSED" = "ENABLE";

  const beAcos = econ.breakEvenAcos > 0 ? econ.breakEvenAcos : 45.5;
  const skuMaxBid = econ.maxBid;

  // Trần Max Bid:
  // - SP03 (và SP nói chung): lấy trực tiếp từ trần kinh tế phôi (skuMaxBid)
  // - SB05: bằng 80% max bid SP03 (0.8 * skuMaxBid)
  // - SB01: bằng 80% max bid SP03 (0.8 * skuMaxBid)
  const maxBidFactor = rule.limits.maxBidFactor !== undefined
    ? rule.limits.maxBidFactor
    : (format === "SB01" || format === "SB05" ? 0.8 : 1.0);
  const calculatedMaxBid = Math.round(skuMaxBid * maxBidFactor * 100) / 100;
  const effectiveMaxBid = Math.max(rule.limits.minBid, calculatedMaxBid);
  // Khi trần kinh tế thấp hơn sàn rule, ưu tiên trần để không bid vượt khả năng sinh lời.
  const effectiveMinBid = Math.min(rule.limits.minBid, effectiveMaxBid);

  const tiers = hasOrders ? rule.hasOrder : rule.noOrder;
  const metric = hasOrders ? actualAcos : row.clicks;
  const matches = tiers.filter((tier) => {
    if ("activeWhen" in tier && tier.activeWhen && beAcos <= 40) return false;
    const min = "minRef" in tier && tier.minRef ? beAcos : ("minAcos" in tier ? tier.minAcos : tier.minClicks);
    const max = "maxRef" in tier && tier.maxRef
      ? (tier.maxRef === "min_40_break_even_acos_pct" ? Math.min(40, beAcos) : beAcos)
      : ("maxAcos" in tier ? tier.maxAcos : tier.maxClicks);
    return inRuleRange(metric, min, max, tier.minInclusive ?? true, tier.maxInclusive ?? true);
  });

  // Parser contract: mỗi input chỉ được khớp đúng một zone đang hoạt động.
  if (matches.length !== 1) return null;
  const matched = matches[0];
  if (matched.action === "BID_INCREASE") {
    recType = "BID_INCREASE";
    targetBid = currentBid * (1 + matched.pct / 100);
  } else if (matched.action === "BID_DECREASE") {
    recType = "BID_DECREASE";
    targetBid = avgCpc * (1 + matched.pct / 100);
    priority = matched.pct <= -15 ? "P0" : "P1";
  } else if (matched.action === "PAUSE_TARGET") {
    recType = "PAUSE_TARGET";
    actionState = "PAUSED";
    priority = "P0";
    targetBid = rule.limits.minBid;
  }
  const metricReason = hasOrders
    ? (matched.action === "BID_DECREASE" && actualAcos > beAcos
      ? `ACoS ${actualAcos.toFixed(1)}% vượt ACoS hòa vốn ${beAcos}%`
      : `ACoS ${actualAcos.toFixed(1)}%, ACoS hòa vốn ${beAcos}%`)
    : `${row.clicks} clicks, không có đơn`;
  reason = `[${format}] ${matched.ruleId || "MATCHED_RULE"}: ${metricReason} -> ${matched.description}.`;

  if (!recType) {
    return null;
  }

  // Nếu bid hiện tại đã vượt quá max bid thì không tăng, không giảm nữa mà giữ nguyên
  if (currentBid > effectiveMaxBid && recType !== "PAUSE_TARGET") {
    return null;
  }

  const exceededEffectiveMax = targetBid > effectiveMaxBid;
  const clampedBid = Math.round(Math.min(effectiveMaxBid, Math.max(effectiveMinBid, targetBid)) * 100) / 100;
  if (recType !== "PAUSE_TARGET" && clampedBid === currentBid) {
    return null;
  }

  // Sau khi kẹp trần, tên action phải phản ánh đúng hướng thay đổi thực tế.
  if (recType !== "PAUSE_TARGET") {
    recType = clampedBid > currentBid ? "BID_INCREASE" : "BID_DECREASE";
    if (exceededEffectiveMax) {
      reason += ` Kết quả tính toán được chặn tại trần hiệu lực $${effectiveMaxBid.toFixed(2)}.`;
    }
  }

  const estimatedSavings = recType === "BID_DECREASE" || recType === "PAUSE_TARGET"
    ? Math.round(row.spend * (1 - clampedBid / Math.max(currentBid, 0.01)) * 100) / 100
    : 0;

  return {
    id: `rec-${format}-${row.storeId || row.storeName}-${row.adType}-${row.targetId || row.entityId}`,
    storeId: row.storeId || "store-1",
    storeName: row.storeName || "",
    adType: row.adType,
    recType,
    targetType: /asin|category|brand/i.test(row.targetExpression) ? "PRODUCT" : "EXACT",
    matchType: row.matchType,
    keyword: row.targetExpression || row.targetId,
    campaignName: row.campaignName,
    adGroupName: row.adGroupName,
    sku,
    campaignId: row.campaignId,
    adGroupId: row.adGroupId,
    keywordId: row.targetId,
    priority,
    currentBid,
    recommendedBid: clampedBid,
    reason: `${reason} (Sàn rule: $${rule.limits.minBid.toFixed(2)}; trần campaign: $${effectiveMaxBid.toFixed(2)}; trần SKU: $${skuMaxBid.toFixed(2)}; bid cuối: $${clampedBid.toFixed(2)}.)`,
    estimatedSavings: Math.max(0, estimatedSavings),
    status: "PENDING",
    productType: econ.productType,
    ruleProfile: `${format} v1.0`,
    actionState,
    clicks: row.clicks,
    spend: row.spend,
    sales: row.sales,
    orders: row.orders,
    cpc: row.clicks > 0 ? Number((row.spend / row.clicks).toFixed(2)) : (row.cpc || 0),
    createdAt: new Date().toISOString(),
  };
}

/* =========================================================================
   4. RECOMMENDATIONS GOM THEO SKU (GROUP BY SKU)
   ========================================================================= */

export async function getCommonTargetRecommendations(
  storeId: string,
  targetRows: PpcPerformanceRow[],
  days = 30,
): Promise<{ recommendations: PpcRecommendation[]; economics: SkuEconomics[] }> {
  const economics = await getSkuEconomicsList(storeId, days);
  const econMap = new Map(economics.map((item) => [item.sku.toUpperCase(), item]));
  const ruleVersions = await getRuleVersions();
  const ruleMap = new Map<string, PpcRuleDefinition>();

  for (const version of ruleVersions) {
    if (version.status === "PUBLISHED" && !ruleMap.has(version.campaignType)) {
      ruleMap.set(version.campaignType, version.ruleJson);
    }
  }

  const recommendations = targetRows
    .map((row) => evaluateRowWithRuleEngine(row, ruleMap, econMap))
    .filter((item): item is PpcRecommendation => item !== null);

  return { recommendations, economics };
}

export async function getGroupedRecommendations(
  storeId: string,
  targetRows: PpcPerformanceRow[],
  days = 30,
): Promise<{
  groups: SkuRecommendationGroup[];
  allRecommendations: PpcRecommendation[];
  totalRecommendations: number;
  totalSkus: number;
}> {
  const common = await getCommonTargetRecommendations(storeId, targetRows, days);
  const econList = common.economics;
  const econMap = new Map(econList.map((e) => [e.sku.toUpperCase(), e]));
  const allRecs = common.recommendations;

  const skuRecMap = new Map<string, PpcRecommendation[]>();
  for (const rec of allRecs) {
    const sku = (rec.sku || "UNKNOWN").toUpperCase();
    if (!skuRecMap.has(sku)) skuRecMap.set(sku, []);
    skuRecMap.get(sku)!.push(rec);
  }

  const groups: SkuRecommendationGroup[] = [];
  const processedSkus = new Set<string>();

  // 1. Iterate over all SKUs in econList so that every SKU (including 0 spend / chưa cắn tiền) is in the table!
  for (const econ of econList) {
    const sku = econ.sku.toUpperCase();
    processedSkus.add(sku);
    const recs = skuRecMap.get(sku) || [];

    let increaseCount = 0;
    let decreaseCount = 0;
    let pauseCount = 0;
    let budgetCount = 0;

    for (const r of recs) {
      if (r.recType === "BID_INCREASE") increaseCount++;
      else if (r.recType === "BID_DECREASE") decreaseCount++;
      else if (r.recType === "PAUSE_TARGET") pauseCount++;
    }

    groups.push({
      sku,
      asin: econ.asin || "B0XXXX",
      productType: econ.productType,
      spend: econ.spend || 0,
      sales: econ.sales || 0,
      orders: econ.orders || 0,
      clicks: econ.clicks || 0,
      acos: econ.acos || 0,
      breakEvenAcos: econ.breakEvenAcos,
      totalRecommendations: recs.length,
      increaseCount,
      decreaseCount,
      pauseCount,
      budgetCount,
      economics: econ,
    });
  }

  // 2. Add any SKU found in recommendations that was not in econList
  for (const [sku, recs] of skuRecMap.entries()) {
    if (processedSkus.has(sku)) continue;
    const econ = econMap.get(sku) || {
      id: `econ-${sku}`,
      storeId,
      sku,
      asin: "B0XXXX",
      productType: "Ornament",
      sellingPrice: 15.99,
      baseCost: 2.0,
      amazonFee: 6.32,
      taxRate: 0.03,
      profitBeforeAds: 7.19,
      breakEvenAcos: 45.0,
      cr: 0.10,
      crSource: "ASSUMED" as CrSource,
      maxBid: 0.72,
      costSource: "INHERITED" as CostSource,
      spend: 0,
      sales: 0,
      orders: 0,
      clicks: 0,
      acos: 0,
    };

    let increaseCount = 0;
    let decreaseCount = 0;
    let pauseCount = 0;
    let budgetCount = 0;

    for (const r of recs) {
      if (r.recType === "BID_INCREASE") increaseCount++;
      else if (r.recType === "BID_DECREASE") decreaseCount++;
      else if (r.recType === "PAUSE_TARGET") pauseCount++;
    }

    groups.push({
      sku,
      asin: econ.asin || "B0XXXX",
      productType: econ.productType,
      spend: econ.spend || 0,
      sales: econ.sales || 0,
      orders: econ.orders || 0,
      clicks: econ.clicks || 0,
      acos: econ.acos || 0,
      breakEvenAcos: econ.breakEvenAcos,
      totalRecommendations: recs.length,
      increaseCount,
      decreaseCount,
      pauseCount,
      budgetCount,
      economics: econ,
    });
  }

  groups.sort((a, b) => b.totalRecommendations - a.totalRecommendations || b.spend - a.spend);

  return {
    groups,
    allRecommendations: allRecs,
    totalRecommendations: allRecs.length,
    totalSkus: groups.length,
  };
}

/* =========================================================================
   5. ACTION QUEUE & DUPLICATE RESOLUTION
   ========================================================================= */

export async function approveRecommendationsToActionQueue(
  storeId: string,
  items: Array<{
    recommendation: PpcRecommendation;
    userFinalBid?: number;
    approvedBy?: string;
  }>,
): Promise<{ addedCount: number; supersededCount: number }> {
  if (!items || items.length === 0) {
    return { addedCount: 0, supersededCount: 0 };
  }

  const sql = await getDatabaseClient();
  let addedCount = 0;
  let supersededCount = 0;

  await sql.begin(async (tx: any) => {
    const campaignIds = Array.from(
      new Set(items.map((it) => it.recommendation.campaignId || "").filter(Boolean))
    );

    const existingRows = campaignIds.length > 0
      ? await tx<any[]>`
          SELECT id, campaign_id, target_id, target_keyword, match_type, action_type, status
          FROM ppc_actions
          WHERE store_id = ${storeId}
            AND status IN ('PENDING', 'APPROVED', 'QUEUED')
            AND campaign_id = ANY(${campaignIds})
        `
      : [];

    const supersededIds = new Set<string>();

    const rowsToInsert = items.map((item) => {
      const rec = item.recommendation;
      const sku = (rec.sku || "").toUpperCase();
      const campaignId = rec.campaignId || "";
      const targetId = rec.keywordId || "";
      const actionType: ActionType = rec.recType === "PAUSE_TARGET" ? "PAUSE_TARGET" : "UPDATE_BID";
      const finalValue = item.userFinalBid ?? rec.recommendedBid ?? rec.currentBid ?? 0;

      // Find matching existing actions to supersede
      const matches = existingRows.filter((ex: any) => {
        if (ex.campaign_id !== campaignId) return false;
        return (targetId && ex.target_id === targetId) ||
          (ex.target_keyword === rec.keyword && ex.match_type === (rec.matchType || "Exact"));
      });

      for (const ex of matches) {
        if (ex.action_type === "PAUSE_TARGET" && actionType === "UPDATE_BID") {
          continue;
        }
        supersededIds.add(ex.id);
      }

      return {
        store_id: storeId,
        recommendation_id: rec.id,
        sku,
        campaign_id: campaignId,
        campaign_name: rec.campaignName || "",
        campaign_type: rec.adType || "SP",
        ad_group_id: rec.adGroupId || "",
        ad_group_name: rec.adGroupName || "",
        target_id: targetId,
        target_keyword: rec.keyword,
        match_type: rec.matchType || "Exact",
        entity_type: "KEYWORD",
        action_type: actionType,
        old_value: rec.currentBid || 0,
        system_suggested_value: rec.recommendedBid || 0,
        final_value: finalValue,
        rule_version: rec.ruleProfile || "v1.0",
        status: "APPROVED",
        approved_by: item.approvedBy || "User",
        approved_at: new Date(),
      };
    });

    // Deduplicate within the same batch: later recommendation for the same target supersedes earlier
    const uniqueMap = new Map<string, (typeof rowsToInsert)[0]>();
    for (const row of rowsToInsert) {
      const targetKey = `${row.campaign_id}\0${row.target_id || ""}\0${row.target_keyword}\0${row.match_type}`;
      uniqueMap.set(targetKey, row);
    }
    const finalRowsToInsert = Array.from(uniqueMap.values());

    if (supersededIds.size > 0) {
      const supersededIdArray = Array.from(supersededIds);
      await tx`
        UPDATE ppc_actions
        SET status = 'SUPERSEDED', updated_at = NOW()
        WHERE id = ANY(${supersededIdArray})
      `;
      supersededCount = supersededIdArray.length;
    }

    if (finalRowsToInsert.length > 0) {
      // Chunk inserts in batches of 500 to stay safely below SQL parameter limits
      const chunkSize = 500;
      for (let i = 0; i < finalRowsToInsert.length; i += chunkSize) {
        const chunk = finalRowsToInsert.slice(i, i + chunkSize);
        await tx`
          INSERT INTO ppc_actions ${tx(
          chunk,
          "store_id", "recommendation_id", "sku", "campaign_id", "campaign_name",
          "campaign_type", "ad_group_id", "ad_group_name", "target_id", "target_keyword",
          "match_type", "entity_type", "action_type", "old_value", "system_suggested_value",
          "final_value", "rule_version", "status", "approved_by", "approved_at"
        )}
        `;
      }
      addedCount = finalRowsToInsert.length;
    }
  });

  return { addedCount, supersededCount };
}

export async function getActionQueueCount(storeId: string): Promise<number> {
  const sql = await getDatabaseClient();
  const rows = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int as count
    FROM ppc_actions
    WHERE store_id = ${storeId}
      AND status IN ('APPROVED', 'QUEUED')
  `;
  return Number(rows[0]?.count || 0);
}

export async function getActionQueue(storeId: string): Promise<PpcAction[]> {
  const sql = await getDatabaseClient();
  const rows = await sql<any[]>`
    SELECT 
      a.*,
      COALESCE(p.total_spend, 0) as sku_spend
    FROM ppc_actions a
    LEFT JOIN (
      SELECT UPPER(TRIM(sku)) as sku_code, SUM(spend) as total_spend
      FROM ppc_performance_facts
      WHERE store_id = ${storeId} 
        AND grain = 'PRODUCT' 
        AND sku IS NOT NULL
        AND (snapshot_date, report_start_date, report_end_date) = (
          SELECT snapshot_date, report_start_date, report_end_date
          FROM ppc_performance_facts 
          WHERE store_id = ${storeId} AND grain = 'PRODUCT'
          ORDER BY snapshot_date DESC, (report_end_date - report_start_date) DESC
          LIMIT 1
        )
      GROUP BY UPPER(TRIM(sku))
    ) p ON UPPER(TRIM(a.sku)) = p.sku_code
    WHERE a.store_id = ${storeId}
      AND a.status IN ('APPROVED', 'QUEUED')
    ORDER BY a.created_at DESC
  `;

  return rows.map((r: any) => ({
    id: r.id,
    storeId: r.store_id,
    recommendationId: r.recommendation_id,
    sku: r.sku,
    campaignId: r.campaign_id,
    campaignName: r.campaign_name,
    campaignType: r.campaign_type,
    adGroupId: r.ad_group_id,
    adGroupName: r.ad_group_name,
    targetId: r.target_id,
    targetKeyword: r.target_keyword,
    matchType: r.match_type,
    entityType: r.entity_type,
    actionType: r.action_type,
    oldValue: r.old_value ? Number(r.old_value) : null,
    systemSuggestedValue: r.system_suggested_value ? Number(r.system_suggested_value) : null,
    finalValue: r.final_value ? Number(r.final_value) : null,
    ruleVersion: r.rule_version,
    matchedRuleId: r.matched_rule_id,
    status: r.status,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at ? new Date(r.approved_at).toISOString() : null,
    isZeroSpend: Number(r.sku_spend || 0) <= 0,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  }));
}

export async function removeActionsFromQueue(storeId: string, actionIds: string[]): Promise<number> {
  if (!actionIds || actionIds.length === 0) return 0;
  const sql = await getDatabaseClient();
  const res = await sql`
    UPDATE ppc_actions
    SET status = 'IGNORED', updated_at = NOW()
    WHERE store_id = ${storeId} AND id = ANY(${actionIds})
  `;
  return res.count;
}

export async function removeActionFromQueue(storeId: string, actionId: string): Promise<void> {
  await removeActionsFromQueue(storeId, [actionId]);
}

/* =========================================================================
   6. BULK EXPORT WIZARD & HISTORY
   ========================================================================= */

export async function exportBulkFromQueue(
  storeId: string,
  selectedActionIds?: string[],
): Promise<{
  fileName: string;
  buffer: Buffer;
  actionCount: number;
  summary: { updateBid: number; pause: number; budget: number };
}> {
  const sql = await getDatabaseClient();

  let actions: any[];
  if (selectedActionIds && selectedActionIds.length > 0) {
    actions = await sql<any[]>`
      SELECT * FROM ppc_actions
      WHERE store_id = ${storeId}
        AND id = ANY(${selectedActionIds})
        AND status IN ('APPROVED', 'QUEUED')
    `;
  } else {
    actions = await sql<any[]>`
      SELECT * FROM ppc_actions
      WHERE store_id = ${storeId}
        AND status IN ('APPROVED', 'QUEUED')
    `;
  }

  if (actions.length === 0) {
    throw new Error("Không có action nào trong hàng đợi sẵn sàng xuất file.");
  }

  const missingId = actions.find((a: any) => !a.campaign_id || !a.ad_group_id || !a.target_id);
  if (missingId) {
    throw new Error(`Action "${missingId.target_keyword}" thiếu Campaign ID, Ad Group ID hoặc Target ID để xuất an toàn.`);
  }

  const { spawn } = await import("node:child_process");
  const path = (await import("node:path")).default;
  const fs = (await import("node:fs")).default;

  const pythonScript = path.join(process.cwd(), "scripts", "export_amazon_bulksheet.py");
  const templatePath = path.join(process.cwd(), "templates", "ppc", "AdvertisingBulksheetTemplate-seller.xlsx");

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template Amazon không tồn tại tại: ${templatePath}`);
  }

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const proc = spawn("python3", [pythonScript], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    proc.stdout.on("data", (c) => chunks.push(Buffer.from(c)));
    proc.stderr.on("data", (c) => errChunks.push(Buffer.from(c)));

    proc.on("close", (code) => {
      if (code !== 0) {
        const errText = Buffer.concat(errChunks).toString("utf-8");
        return reject(new Error(`Lỗi khi tạo Bulksheet từ mẫu Amazon: ${errText}`));
      }
      resolve(Buffer.concat(chunks));
    });

    proc.stdin.write(JSON.stringify(actions));
    proc.stdin.end();
  });

  let updateBidCount = 0;
  let pauseCount = 0;
  let budgetCount = 0;

  const exportItemsData: Array<{ actionId: string; entityType: string; op: string; row: any }> = [];

  for (const act of actions) {
    const adType = (act.campaign_type || "SP").toUpperCase();
    const isProduct = act.entity_type === "PRODUCT" || (act.target_keyword && (act.target_keyword.includes("asin=") || act.target_keyword.includes("category=")));
    const entity = adType === "SD"
      ? (act.action_type === "UPDATE_BUDGET" ? "Campaign" : "Contextual Targeting")
      : (isProduct ? "Product Targeting" : (act.action_type === "UPDATE_BUDGET" ? "Campaign" : "Keyword"));
    const product = adType === "SB" ? "Sponsored Brands" : (adType === "SD" ? "Sponsored Display" : "Sponsored Products");
    const op = "Update";
    if (act.action_type === "UPDATE_BID" || act.action_type === "BID_DECREASE" || act.action_type === "BID_INCREASE") {
      updateBidCount++;
    } else if (act.action_type === "PAUSE_TARGET") {
      pauseCount++;
    } else if (act.action_type === "UPDATE_BUDGET") {
      budgetCount++;
    }

    exportItemsData.push({
      actionId: act.id,
      entityType: entity,
      op,
      row: {
        product,
        entity,
        operation: op,
        campaignId: act.campaign_id,
        adGroupId: act.ad_group_id,
        targetId: act.target_id,
        campaignName: act.campaign_name,
        adGroupName: act.ad_group_name,
        targetKeyword: act.target_keyword,
        matchType: act.match_type,
        bid: act.final_value,
        state: act.action_type === "PAUSE_TARGET" ? "paused" : "enabled",
      },
    });
  }

  // 1. Lấy Store Name để tránh nhầm lẫn tài khoản
  const storeRows = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM ppc_stores WHERE id = ${storeId} LIMIT 1
  `;
  const cleanStore = (storeRows[0]?.name || "STORE")
    .replace(/[/\\?%*:|"<>]/g, "_")
    .trim()
    .replace(/\s+/g, "_");

  // 2. Xác định Ad Type: SP, SB, SD hoặc MIXED
  const adTypes = Array.from(new Set(actions.map((a: any) => (a.campaign_type || "SP").toUpperCase())));
  const adTypeLabel = adTypes.length === 1 ? adTypes[0] : "MIXED";

  // 3. Xác định Scope (Target / Phạm vi):
  const distinctCamps = Array.from(new Set(actions.map((a: any) => a.campaign_name).filter(Boolean)));
  const distinctSkus = Array.from(new Set(actions.map((a: any) => a.sku).filter(Boolean)));
  let scopeLabel: string;
  if (distinctCamps.length === 1) {
    scopeLabel = String(distinctCamps[0])
      .replace(/[/\\?%*:|"<>]/g, "_")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 35)
      .replace(/_+$/, "");
  } else if (distinctSkus.length === 1) {
    scopeLabel = `SKU_${String(distinctSkus[0]).replace(/[/\\?%*:|"<>]/g, "_").trim().slice(0, 20)}`;
  } else {
    scopeLabel = `${distinctCamps.length}Camps`;
  }

  // 4. Xác định Action Type Summary:
  let actionLabel: string;
  if (updateBidCount > 0 && pauseCount === 0 && budgetCount === 0) {
    actionLabel = "BidUpdate";
  } else if (pauseCount > 0 && updateBidCount === 0 && budgetCount === 0) {
    actionLabel = "Pause";
  } else if (budgetCount > 0 && updateBidCount === 0 && pauseCount === 0) {
    actionLabel = "Budget";
  } else {
    actionLabel = `${actions.length}Actions`;
  }

  // 5. Timestamp YYYYMMDD_HHMMSS
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const timeStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  // Cấu trúc chuẩn: Upload_{STORE}_{AD_TYPE}_{SCOPE}_{ACTION_TYPE}_{TIMESTAMP}.xlsx
  const fileName = `Upload_${cleanStore}_${adTypeLabel}_${scopeLabel}_${actionLabel}_${timeStr}.xlsx`;

  await sql.begin(async (tx: any) => {
    const bulkInsert = await tx`
      INSERT INTO bulk_exports (
        store_id, file_name, action_count, summary, status
      ) VALUES (
        ${storeId}, ${fileName}, ${actions.length},
        ${JSON.stringify({ updateBidCount, pauseCount, budgetCount, enableCount: 0 })},
        'SUCCESS'
      )
      RETURNING id
    `;
    const bulkExportId = bulkInsert[0].id;

    for (const it of exportItemsData) {
      await tx`
        INSERT INTO bulk_export_items (
          bulk_export_id, action_id, amazon_entity_type, amazon_operation, export_status, row_data
        ) VALUES (
          ${bulkExportId}, ${it.actionId}, ${it.entityType}, ${it.op}, 'EXPORTED', ${JSON.stringify(it.row)}
        )
      `;
    }

    const exportedIds = actions.map((a: any) => a.id);
    await tx`
      UPDATE ppc_actions
      SET status = 'EXPORTED', updated_at = NOW()
      WHERE id = ANY(${exportedIds})
    `;
  });

  return {
    fileName,
    buffer,
    actionCount: actions.length,
    summary: { updateBid: updateBidCount, pause: pauseCount, budget: budgetCount },
  };
}

export async function getBulkExportHistory(storeId?: string | null): Promise<BulkExport[]> {
  const sql = await getDatabaseClient();
  const rows = storeId && storeId !== "ALL"
    ? await sql<any[]>`
        SELECT b.id, b.store_id, s.name as store_name, b.file_name, b.action_count, b.summary, b.status, b.created_at
        FROM bulk_exports b
        LEFT JOIN ppc_stores s ON b.store_id = s.id
        WHERE b.store_id = ${storeId}
        ORDER BY b.created_at DESC
        LIMIT 50
      `
    : await sql<any[]>`
        SELECT b.id, b.store_id, s.name as store_name, b.file_name, b.action_count, b.summary, b.status, b.created_at
        FROM bulk_exports b
        LEFT JOIN ppc_stores s ON b.store_id = s.id
        ORDER BY b.created_at DESC
        LIMIT 50
      `;

  return rows.map((r: any) => ({
    id: r.id,
    storeId: r.store_id,
    storeName: r.store_name || "",
    fileName: r.file_name,
    actionCount: Number(r.action_count),
    summary: typeof r.summary === "string" ? JSON.parse(r.summary) : r.summary,
    status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export async function getBulkExportDetails(bulkExportId: string): Promise<{
  exportRecord: BulkExport;
  items: Array<{
    id: string;
    actionId?: string | null;
    entityType: string;
    operation: string;
    exportStatus: string;
    sku: string;
    campaignName: string;
    adGroupName: string;
    targetKeyword: string;
    matchType: string;
    actionType: string;
    oldValue: number | null;
    finalValue: number | null;
    rowData: Record<string, unknown>;
    errorMessage?: string | null;
  }>;
}> {
  const sql = await getDatabaseClient();
  const exportRows = await sql<any[]>`
    SELECT id, store_id, file_name, action_count, summary, status, created_at
    FROM bulk_exports
    WHERE id = ${bulkExportId}
    LIMIT 1
  `;
  if (exportRows.length === 0) throw new Error("Không tìm thấy đợt xuất file");
  const r = exportRows[0];
  const exportRecord: BulkExport = {
    id: r.id,
    storeId: r.store_id,
    fileName: r.file_name,
    actionCount: Number(r.action_count),
    summary: typeof r.summary === "string" ? JSON.parse(r.summary) : r.summary,
    status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
  };

  const itemRows = await sql<any[]>`
    SELECT i.id, i.action_id, i.amazon_entity_type, i.amazon_operation, i.export_status, i.row_data, i.error_message,
           a.sku, a.campaign_name, a.ad_group_name, a.target_keyword, a.match_type, a.action_type,
           a.old_value, a.final_value
    FROM bulk_export_items i
    LEFT JOIN ppc_actions a ON a.id = i.action_id
    WHERE i.bulk_export_id = ${bulkExportId}
    ORDER BY i.created_at ASC
  `;

  const items = itemRows.map((it: any) => {
    const rawRow = typeof it.row_data === "string" ? JSON.parse(it.row_data) : (it.row_data || {});
    return {
      id: it.id,
      actionId: it.action_id,
      entityType: it.amazon_entity_type,
      operation: it.amazon_operation,
      exportStatus: it.export_status,
      sku: it.sku || rawRow.sku || "",
      campaignName: it.campaign_name || rawRow.campaignName || "",
      adGroupName: it.ad_group_name || rawRow.adGroupName || "",
      targetKeyword: it.target_keyword || rawRow.targetKeyword || "",
      matchType: it.match_type || rawRow.matchType || "",
      actionType: it.action_type || (rawRow.state === "paused" ? "PAUSE_TARGET" : "UPDATE_BID"),
      oldValue: it.old_value ? Number(it.old_value) : null,
      finalValue: it.final_value ? Number(it.final_value) : (rawRow.bid ? Number(rawRow.bid) : null),
      rowData: rawRow,
      errorMessage: it.error_message,
    };
  });

  return { exportRecord, items };
}

export async function reExportBulkFile(bulkExportId: string): Promise<{ buffer: Buffer; fileName: string }> {
  const { exportRecord, items } = await getBulkExportDetails(bulkExportId);

  const actionsForPython = items.map((it) => ({
    id: it.actionId || it.id,
    sku: it.sku,
    campaign_id: String(it.rowData.campaignId || ""),
    campaign_name: it.campaignName,
    campaign_type: String(it.rowData.product || "SP").includes("Brand") ? "SB" : "SP",
    ad_group_id: String(it.rowData.adGroupId || ""),
    ad_group_name: it.adGroupName,
    target_id: String(it.rowData.targetId || ""),
    target_keyword: it.targetKeyword,
    match_type: it.matchType,
    entity_type: it.entityType,
    action_type: it.actionType,
    old_value: it.oldValue,
    final_value: it.finalValue,
  }));

  const { spawn } = await import("node:child_process");
  const path = (await import("node:path")).default;
  const fs = (await import("node:fs")).default;

  const pythonScript = path.join(process.cwd(), "scripts", "export_amazon_bulksheet.py");
  const templatePath = path.join(process.cwd(), "templates", "ppc", "AdvertisingBulksheetTemplate-seller.xlsx");

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template Amazon không tồn tại tại: ${templatePath}`);
  }

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const proc = spawn("python3", [pythonScript], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    proc.stdout.on("data", (c) => chunks.push(Buffer.from(c)));
    proc.stderr.on("data", (c) => errChunks.push(Buffer.from(c)));

    proc.on("close", (code) => {
      if (code !== 0) {
        const errText = Buffer.concat(errChunks).toString("utf-8");
        return reject(new Error(`Lỗi khi tạo Bulksheet từ mẫu Amazon: ${errText}`));
      }
      resolve(Buffer.concat(chunks));
    });

    proc.stdin.write(JSON.stringify(actionsForPython));
    proc.stdin.end();
  });

  return { buffer, fileName: exportRecord.fileName };
}

export async function getAutoUploadLogs(storeId?: string | null): Promise<PpcAutoUploadLog[]> {
  const sql = await getDatabaseClient();
  const rows = storeId && storeId !== "ALL"
    ? await sql<any[]>`
        SELECT l.id, l.store_id, s.name as store_name, l.file_name, l.adspower_profile_id, l.adspower_profile_name,
               l.action_count, l.skus, l.status, l.stage, l.file_status, l.file_error_message,
               l.error_message, l.result_summary, l.duration_ms, l.created_at
        FROM ppc_auto_upload_logs l
        LEFT JOIN ppc_stores s ON l.store_id = s.id
        WHERE l.store_id = ${storeId}
        ORDER BY l.created_at DESC
        LIMIT 50
      `
    : await sql<any[]>`
        SELECT l.id, l.store_id, s.name as store_name, l.file_name, l.adspower_profile_id, l.adspower_profile_name,
               l.action_count, l.skus, l.status, l.stage, l.file_status, l.file_error_message,
               l.error_message, l.result_summary, l.duration_ms, l.created_at
        FROM ppc_auto_upload_logs l
        LEFT JOIN ppc_stores s ON l.store_id = s.id
        ORDER BY l.created_at DESC
        LIMIT 50
      `;

  return rows.map((r: any) => ({
    id: r.id,
    storeId: r.store_id,
    storeName: r.store_name || "",
    fileName: r.file_name || "",
    adspowerProfileId: r.adspower_profile_id,
    adspowerProfileName: r.adspower_profile_name,
    actionCount: Number(r.action_count || 0),
    skus: Array.isArray(r.skus) ? r.skus : (typeof r.skus === "string" ? JSON.parse(r.skus) : []),
    status: r.status,
    stage: r.stage,
    fileStatus: r.file_status || "SUCCESS",
    fileErrorMessage: r.file_error_message,
    errorMessage: r.error_message,
    resultSummary: r.result_summary,
    durationMs: Number(r.duration_ms || 0),
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export async function getAutoUploadDetails(logId: string): Promise<{
  log: PpcAutoUploadLog & { actionIds?: string[] };
  actions: Array<{
    id: string;
    sku: string;
    campaignName: string;
    adGroupName: string;
    targetKeyword: string;
    matchType: string;
    actionType: string;
    oldValue: number | null;
    finalValue: number | null;
    status: string;
  }>;
}> {
  const sql = await getDatabaseClient();
  const logRows = await sql<any[]>`
    SELECT id, store_id, file_name, adspower_profile_id, adspower_profile_name,
           action_count, action_ids, actions_payload, skus, status, stage, file_status, file_error_message,
           error_message, result_summary, duration_ms, created_at
    FROM ppc_auto_upload_logs
    WHERE id = ${logId}
    LIMIT 1
  `;
  if (logRows.length === 0) throw new Error("Không tìm thấy nhật ký auto upload");
  const r = logRows[0];
  const actionIds = Array.isArray(r.action_ids)
    ? r.action_ids
    : (typeof r.action_ids === "string" ? JSON.parse(r.action_ids) : []);

  let actions: any[] = [];
  if (actionIds.length > 0) {
    const actRows = await sql<any[]>`
      SELECT id, sku, campaign_name, ad_group_name, target_keyword, match_type,
             action_type, old_value, final_value, status
      FROM ppc_actions
      WHERE id = ANY(${actionIds})
      ORDER BY sku ASC, campaign_name ASC
    `;
    actions = actRows.map((a: any) => ({
      id: a.id,
      sku: a.sku,
      campaignName: a.campaign_name,
      adGroupName: a.ad_group_name,
      targetKeyword: a.target_keyword,
      matchType: a.match_type,
      actionType: a.action_type,
      oldValue: a.old_value ? Number(a.old_value) : null,
      finalValue: a.final_value ? Number(a.final_value) : null,
      status: a.status,
    }));
  }

  // Fallback 1: Custom actions payload (e.g. ST Optimization direct negative uploads)
  if (actions.length === 0 && r.actions_payload) {
    const rawPayload = Array.isArray(r.actions_payload)
      ? r.actions_payload
      : (typeof r.actions_payload === "string" ? JSON.parse(r.actions_payload) : []);
    if (rawPayload.length > 0) {
      actions = rawPayload.map((p: any, idx: number) => ({
        id: p.id || `act-${idx}`,
        sku: p.sku || "ST_OPTI",
        campaignName: p.campaignName || p.campaign_name || "",
        adGroupName: p.adGroupName || p.ad_group_name || "",
        targetKeyword: p.targetKeyword || p.target_keyword || p.keyword || "Phủ định",
        matchType: p.matchType || p.match_type || "Negative Exact",
        actionType: p.actionType || p.action_type || "NEGATIVE_KEYWORD",
        oldValue: p.oldValue != null ? Number(p.oldValue) : null,
        finalValue: p.finalValue != null ? Number(p.finalValue) : null,
        status: p.status || (r.status === "SUCCESS" ? "APPLIED" : (r.status === "FAILED" ? "FAILED" : "PENDING")),
      }));
    }
  }

  // Fallback 2: Generate from campaigns in skus column if payload was not preserved
  if (actions.length === 0 && Array.isArray(r.skus) && r.skus.length > 0) {
    actions = r.skus.map((campName: string, idx: number) => ({
      id: `fallback-act-${idx}`,
      sku: "ST_OPTI",
      campaignName: campName,
      adGroupName: "Search Term Negative",
      targetKeyword: "Phủ định Search Term lãng phí",
      matchType: "Negative Exact",
      actionType: "NEGATIVE_KEYWORD",
      oldValue: null,
      finalValue: null,
      status: r.status === "SUCCESS" ? "APPLIED" : (r.status === "FAILED" ? "FAILED" : "PENDING"),
    }));
  }

  return {
    log: {
      id: r.id,
      storeId: r.store_id,
      fileName: r.file_name || "",
      adspowerProfileId: r.adspower_profile_id,
      adspowerProfileName: r.adspower_profile_name,
      actionCount: Number(r.action_count || 0),
      skus: Array.isArray(r.skus) ? r.skus : (typeof r.skus === "string" ? JSON.parse(r.skus) : []),
      status: r.status,
      stage: r.stage,
      fileStatus: r.file_status || "SUCCESS",
      fileErrorMessage: r.file_error_message,
      errorMessage: r.error_message,
      resultSummary: r.result_summary,
      durationMs: Number(r.duration_ms || 0),
      createdAt: new Date(r.created_at).toISOString(),
      actionIds,
    },
    actions,
  };
}

export async function cancelAutoUploadJob(logId: string): Promise<boolean> {
  const sql = await getDatabaseClient();
  const rows = await sql<{ id: string; status: string }[]>`
    UPDATE ppc_auto_upload_logs
    SET status = 'CANCELLED',
        error_message = 'Đã hủy bởi người dùng',
        updated_at = NOW()
    WHERE id = ${logId} AND status = 'PENDING'
    RETURNING id, status
  `;
  return rows.length > 0;
}


export async function executeAutoUploadZeroSpendActions(
  storeId: string,
  selectedActionIds?: string[],
  teamId = "default",
  options: { allowAllSkus?: boolean } = {},
): Promise<{
  success: boolean;
  log: PpcAutoUploadLog;
  message: string;
  fileName?: string;
  fileBase64?: string;
}> {
  const sql = await getDatabaseClient();
  const startTime = Date.now();

  const storeRows = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM ppc_stores
    WHERE id = ${storeId} AND team_id = ${teamId}
    LIMIT 1
  `;
  if (!storeRows.length) throw new Error("Store không tồn tại hoặc không thuộc team hiện tại.");
  const storeName = storeRows[0].name;

  // 1. Get all pending/approved actions in the queue
  const queueActions = await getActionQueue(storeId);
  let candidateActions = queueActions;
  if (selectedActionIds && selectedActionIds.length > 0) {
    const idSet = new Set(selectedActionIds);
    candidateActions = queueActions.filter((a) => idSet.has(a.id));
  }

  // 2. Filter actions to upload:
  // If allowAllSkus is enabled or specific actionIds were passed, include candidateActions;
  // otherwise default to zero-spend only.
  const allowAllSkus = options.allowAllSkus ?? Boolean(selectedActionIds && selectedActionIds.length > 0);
  const actionsToUpload = allowAllSkus ? candidateActions : candidateActions.filter((a) => a.isZeroSpend);
  if (actionsToUpload.length === 0) {
    throw new Error(
      allowAllSkus
        ? "Không có hành động nào trong hàng đợi để Auto Upload."
        : "Không có hành động nào thuộc SKU chưa cắn tiền (Zero Spend). Chức năng Auto Upload AdsPower chỉ áp dụng cho SKU chưa cắn tiền.",
    );
  }

  const uploadActionIds = actionsToUpload.map((a) => a.id);
  const distinctSkus = Array.from(new Set(actionsToUpload.map((a) => a.sku).filter(Boolean)));
  const jobId = crypto.randomUUID();

  // Ghi nhận job trước khi tạo file để lỗi tại bước export cũng xuất hiện trong
  // lịch sử thực thi, thay vì biến mất và chỉ hiện như một lỗi request tạm thời.
  const initialLog = await sql<Array<{ id: string; created_at: Date | string }>>`
    INSERT INTO ppc_auto_upload_logs (
      id, team_id, store_id, file_name, action_count, skus, status, stage,
      file_status, progress_pct, action_ids, updated_at
    ) VALUES (
      ${jobId}, ${teamId}, ${storeId}, NULL, ${actionsToUpload.length},
      ${sql.json(distinctSkus)}, 'RUNNING', 'GENERATING_FILE',
      'PENDING', 0, ${sql.json(uploadActionIds)}, NOW()
    )
    RETURNING id, created_at
  `;

  // 3. Export Bulk file using the canonical Amazon template.
  let exportResult: Awaited<ReturnType<typeof exportBulkFromQueue>>;
  try {
    exportResult = await exportBulkFromQueue(storeId, uploadActionIds);
    await sql`
      UPDATE ppc_auto_upload_logs
      SET file_name = ${exportResult.fileName}, file_status = 'SUCCESS',
          stage = 'FILE_CREATED', progress_pct = 20, updated_at = NOW()
      WHERE id = ${jobId} AND team_id = ${teamId}
    `;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sql`
      UPDATE ppc_auto_upload_logs
      SET status = 'FAILED', stage = 'FILE_GENERATION_FAILED',
          file_status = 'FAILED', file_error_message = ${message.slice(0, 4_000)},
          error_message = ${`Tạo file thất bại: ${message}`.slice(0, 4_000)},
          progress_pct = 0, duration_ms = ${Date.now() - startTime},
          completed_at = NOW(), updated_at = NOW()
      WHERE id = ${jobId} AND team_id = ${teamId}
    `;
    throw error;
  }

  const sha256 = crypto.createHash("sha256").update(exportResult.buffer).digest("hex");
  const safeStore = storeName.replace(/[^A-Za-z0-9._-]+/g, "-");
  const r2Key = `${r2KeyPrefix()}/ppc-bulk-upload/${safeStore}/${jobId}/${exportResult.fileName}`;
  try {
    if (objectStorageDriver() !== "r2") {
      throw new Error("Auto Upload remote yêu cầu OBJECT_STORAGE_DRIVER=r2.");
    }
    await putStoredObject({
      key: r2Key,
      bytes: exportResult.buffer,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sha256,
      metadata: { purpose: "amazon-ads-bulk-upload", store: safeStore, job: jobId },
    });

    // AdsPower lives on the Mac mini, so the web server only queues the file.
    await sql`
      UPDATE ppc_auto_upload_logs
      SET status = 'PENDING', stage = 'FILE_READY', progress_pct = 25,
          r2_key = ${r2Key}, sha256 = ${sha256}, updated_at = NOW()
      WHERE id = ${jobId} AND team_id = ${teamId}
    `;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sql`
      UPDATE ppc_auto_upload_logs
      SET status = 'FAILED', stage = 'FILE_STORAGE_FAILED',
          error_message = ${`Đã tạo file nhưng không thể xếp hàng upload: ${message}`.slice(0, 4_000)},
          duration_ms = ${Date.now() - startTime}, completed_at = NOW(), updated_at = NOW()
      WHERE id = ${jobId} AND team_id = ${teamId}
    `;
    throw error;
  }

  return {
    success: true,
    log: {
      id: initialLog[0].id,
      storeId,
      fileName: exportResult.fileName,
      adspowerProfileId: null,
      adspowerProfileName: storeName,
      actionCount: actionsToUpload.length,
      skus: distinctSkus,
      status: "PENDING",
      stage: "FILE_READY",
      fileStatus: "SUCCESS",
      fileErrorMessage: null,
      errorMessage: null,
      durationMs: Date.now() - startTime,
      createdAt: new Date(initialLog[0].created_at).toISOString(),
    },
    fileName: exportResult.fileName,
    message: `Đã tạo file Bulk và xếp hàng upload trên Mac mini (${actionsToUpload.length} actions).`,
  };
}
