import "server-only";
import fs from "node:fs";
import path from "node:path";

import { getDatabaseClient } from "@/lib/db";
import {
  calculateBreakEvenAcos,
  calculateMaxBid,
  calculateProfitBeforeAds,
  detectProductTypeFromSku,
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
  type SkuRecommendationGroup,
} from "./sku-architecture-types";
import type { PpcPerformanceRow, PpcRecommendation } from "./types";
import { extractSkuFromText } from "./sku-extractor";
import { AMAZON_BULKSHEET_SP_COLUMNS } from "./service";
import {
  commonRuleToDefinitions,
  parseAmazonPpcCommonRuleSet,
  type AmazonPpcCommonRuleSet,
} from "./common-rule-parser";
import { uploadBulkFileToAmazonAds } from "./adspower-service";

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

export async function getCostMasters(): Promise<ProductCostMaster[]> {
  const sql = await getDatabaseClient();

  const rows = await sql<any[]>`
    WITH ranked AS (
      SELECT *,
             ROW_NUMBER() OVER(PARTITION BY product_type ORDER BY version DESC) as rn
      FROM product_cost_master
    )
    SELECT r.id, r.product_type, r.base_cost, r.default_amazon_fee, r.tax_rate,
           r.default_price, r.break_even_acos,
           r.version, r.effective_from, r.effective_to, r.notes, r.created_at, r.updated_at,
           COUNT(DISTINCT s.sku)::int as sku_count
    FROM ranked r
    LEFT JOIN sku_economics s ON s.product_type = r.product_type
    WHERE r.rn = 1
    GROUP BY r.id, r.product_type, r.base_cost, r.default_amazon_fee, r.tax_rate,
             r.default_price, r.break_even_acos,
             r.version, r.effective_from, r.effective_to, r.notes, r.created_at, r.updated_at
    ORDER BY r.product_type ASC
  `;

  return rows.map((r: any) => ({
    id: r.id,
    productType: r.product_type,
    baseCost: Number(r.base_cost),
    defaultAmazonFee: Number(r.default_amazon_fee),
    taxRate: Number(r.tax_rate),
    defaultPrice: Number(r.default_price || 0),
    breakEvenAcos: Number(r.break_even_acos || 0),
    version: Number(r.version),
    effectiveFrom: r.effective_from ? new Date(r.effective_from).toISOString().split("T")[0] : "",
    effectiveTo: r.effective_to ? new Date(r.effective_to).toISOString().split("T")[0] : null,
    notes: r.notes || null,
    skuCount: Number(r.sku_count || 0),
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : "",
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : "",
  }));
}

export async function saveCostMasterNewVersion(data: {
  productType: string;
  baseCost: number;
  defaultAmazonFee: number;
  taxRate: number;
  defaultPrice?: number;
  breakEvenAcos?: number;
  effectiveFrom?: string;
  notes?: string;
}): Promise<ProductCostMaster> {
  const sql = await getDatabaseClient();
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
          SELECT AVG(break_even_acos) as avg_acos FROM product_cost_master WHERE break_even_acos > 0
        `;
        beAcos = avgRows[0]?.avg_acos ? Math.round(Number(avgRows[0].avg_acos) * 100) / 100 : 45.5;
      }
    }

    // 2. Find latest version
    const latest = await tx`
      SELECT version FROM product_cost_master
      WHERE product_type = ${data.productType}
      ORDER BY version DESC LIMIT 1
    `;

    const nextVersion = latest.length > 0 ? Number(latest[0].version) + 1 : 1;

    // 3. Set effective_to for previous version
    await tx`
      UPDATE product_cost_master
      SET effective_to = ${effectiveDate}, updated_at = NOW()
      WHERE product_type = ${data.productType} AND effective_to IS NULL
    `;

    // 4. Insert new version
    const inserted = await tx`
      INSERT INTO product_cost_master (
        product_type, base_cost, default_amazon_fee, tax_rate,
        default_price, break_even_acos, version, effective_from, notes
      ) VALUES (
        ${data.productType}, ${data.baseCost}, ${data.defaultAmazonFee},
        ${data.taxRate}, ${defPrice}, ${beAcos}, ${nextVersion},
        ${effectiveDate}, ${data.notes || null}
      )
      RETURNING *
    `;

    // 5. Update SKU Economics inheriting from this Phôi
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
      WHERE product_type = ${data.productType} AND cost_source = 'INHERITED'
    `;

    const r = inserted[0];
    return {
      id: r.id,
      productType: r.product_type,
      baseCost: Number(r.base_cost),
      defaultAmazonFee: Number(r.default_amazon_fee),
      taxRate: Number(r.tax_rate),
      defaultPrice: Number(r.default_price || 0),
      breakEvenAcos: Number(r.break_even_acos || 0),
      version: Number(r.version),
      effectiveFrom: r.effective_from ? new Date(r.effective_from).toISOString().split("T")[0] : "",
      effectiveTo: null,
      notes: r.notes || null,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  });
}

/**
 * Xuất toàn bộ bảng Cost Master ra file Excel (.xlsx)
 */
export async function exportCostMasterToExcel(): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const masters = await getCostMasters();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Amazon Listing Management";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Cost Master", {
    views: [{ showGridLines: true }],
  });

  sheet.columns = [
    { header: "Product Type", key: "productType", width: 22 },
    { header: "Base Cost ($)", key: "baseCost", width: 16 },
    { header: "Default Amazon Fee ($)", key: "defaultAmazonFee", width: 24 },
    { header: "Default Price ($)", key: "defaultPrice", width: 18 },
    { header: "Profit Before Ads ($)", key: "profitBeforeAds", width: 22 },
    { header: "Break-even ACoS", key: "breakEvenAcos", width: 20 },
    { header: "Min Bid ($)", key: "minBid", width: 14 },
    { header: "Max Bid ($)", key: "maxBid", width: 14 },
    { header: "Tax Rate", key: "taxRate", width: 14 },
    { header: "Version", key: "version", width: 12 },
    { header: "Số SKU áp dụng", key: "skuCount", width: 16 },
    { header: "Ghi chú", key: "notes", width: 38 },
  ];

  // Header styling
  const headerRow = sheet.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4F46E5" }, // Indigo 600
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
    };
    cell.border = {
      top: { style: "thin", color: { argb: "FF3730A3" } },
      bottom: { style: "medium", color: { argb: "FF3730A3" } },
      left: { style: "thin", color: { argb: "FF3730A3" } },
      right: { style: "thin", color: { argb: "FF3730A3" } },
    };
  });

  // Data rows
  masters.forEach((m, idx) => {
    const profitBeforeAds = m.defaultPrice > 0 ? (m.defaultPrice - m.defaultAmazonFee - m.baseCost) : 0;
    const maxBid = profitBeforeAds > 0 ? Number((0.10 * profitBeforeAds).toFixed(2)) : 0.05;
    const row = sheet.addRow({
      productType: m.productType,
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

    row.height = 22;
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

      // Currency format for Base Cost (2), Fee (3), Price (4), Profit Before Ads (5), Min Bid (7), Max Bid (8)
      if ([2, 3, 4, 5, 7, 8].includes(colNumber)) {
        cell.numFmt = "$#,##0.00";
        cell.alignment = { vertical: "middle", horizontal: "right" };
      }
      // ACoS col 6
      if (colNumber === 6) {
        cell.alignment = { vertical: "middle", horizontal: "center" };
      }
      // Tax rate col 9
      if (colNumber === 9) {
        cell.numFmt = "0.0%";
        cell.alignment = { vertical: "middle", horizontal: "right" };
      }
      // Version col 10, SKU Count col 11
      if (colNumber === 10 || colNumber === 11) {
        cell.alignment = { vertical: "middle", horizontal: "center" };
      }
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Nhập bảng Cost Master từ file Excel (.xlsx)
 */
export async function importCostMasterFromExcel(buffer: Buffer): Promise<{
  importedCount: number;
  items: Array<{ productType: string; baseCost: number; breakEvenAcos: number }>;
}> {
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

    if (textJoined.includes("product") || textJoined.includes("phôi") || textJoined.includes("type") || textJoined.includes("loại")) {
      headerRowNumber = rowNumber;
      values.forEach((v, idx) => {
        const str = String(v || "").trim().toLowerCase();
        if (!str) return;
        if (str.includes("product") || str.includes("phôi") || str.includes("loại")) colMap.productType = idx;
        else if (str.includes("base") || str.includes("vốn") || str.includes("nhập")) colMap.baseCost = idx;
        else if (str.includes("fee") || str.includes("phí")) colMap.defaultAmazonFee = idx;
        else if (str.includes("tax") || str.includes("thuế")) colMap.taxRate = idx;
        else if (str.includes("price") || str.includes("giá bán")) colMap.defaultPrice = idx;
        else if (str.includes("acos") || str.includes("hòa")) colMap.breakEvenAcos = idx;
        else if (str.includes("ghi chú") || str.includes("note")) colMap.notes = idx;
      });
    }
  });

  if (headerRowNumber === -1 || colMap.productType === undefined) {
    throw new Error("Không nhận diện được tiêu đề cột 'Product Type' hoặc 'Phôi' trong file Excel.");
  }

  const items: Array<{ productType: string; baseCost: number; breakEvenAcos: number }> = [];

  for (let r = headerRowNumber + 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const productTypeRaw = colMap.productType ? String(row.getCell(colMap.productType).value || "").trim() : "";
    if (!productTypeRaw) continue;

    // Parse Base Cost
    const baseCostRaw = colMap.baseCost ? Number(row.getCell(colMap.baseCost).value) : 0;
    const baseCost = isNaN(baseCostRaw) ? 0 : baseCostRaw;

    // Parse Default Fee
    const feeRaw = colMap.defaultAmazonFee ? Number(row.getCell(colMap.defaultAmazonFee).value) : 0;
    const defaultAmazonFee = isNaN(feeRaw) ? 0 : feeRaw;

    // Parse Tax Rate
    let taxRate = 0.03;
    if (colMap.taxRate) {
      const val = row.getCell(colMap.taxRate).value;
      if (typeof val === "number") {
        taxRate = val > 1 ? val / 100 : val;
      } else if (typeof val === "string") {
        const cleaned = parseFloat(val.replace("%", "").trim());
        if (!isNaN(cleaned)) taxRate = cleaned > 1 ? cleaned / 100 : cleaned;
      }
    }

    // Parse Default Price
    const priceRaw = colMap.defaultPrice ? Number(row.getCell(colMap.defaultPrice).value) : 0;
    const defaultPrice = isNaN(priceRaw) ? 0 : priceRaw;

    // Parse Break Even ACoS
    let breakEvenAcos = 0;
    if (colMap.breakEvenAcos) {
      const val = row.getCell(colMap.breakEvenAcos).value;
      if (typeof val === "number") {
        breakEvenAcos = val <= 1 && val > 0 ? val * 100 : val;
      } else if (typeof val === "string") {
        const cleaned = parseFloat(val.replace("%", "").trim());
        if (!isNaN(cleaned)) {
          breakEvenAcos = cleaned <= 1 && cleaned > 0 ? cleaned * 100 : cleaned;
        }
      }
    }

    if (!breakEvenAcos && defaultPrice > 0) {
      const profit = defaultPrice - defaultAmazonFee - baseCost;
      if (profit > 0) {
        breakEvenAcos = Math.round((profit / defaultPrice) * 100);
      }
    }

    // Parse Notes
    const notes = colMap.notes ? String(row.getCell(colMap.notes).value || "").trim() : "";

    const saved = await saveCostMasterNewVersion({
      productType: productTypeRaw,
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

  const masters = await getCostMasters();
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

    const detected = detectProductTypeFromSku(sku, p.sample_campaign);
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
  const masters = await getCostMasters();
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
  return {
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
  const format = /SB05|\bVIDEO\b/.test(campaignName)
    ? "SB05"
    : /SB01/.test(campaignName)
      ? "SB01"
      : /SP01/.test(campaignName)
        ? "SP01"
        : /SP03/.test(campaignName)
          ? "SP03"
          : /SP04/.test(campaignName)
            ? "SP04"
            : null;
  if (!format) return null;
  const isSponsoredProduct = format.startsWith("SP");
  const rule = ruleMap.get(format) || (isSponsoredProduct ? ruleMap.get("SP03") : undefined);
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
    if (currentBid <= effectiveMaxBid) return null;
    recType = "BID_DECREASE";
    targetBid = effectiveMaxBid;
    priority = "P0";
    const factorLabel = maxBidFactor !== 1 ? ` x ${Math.round(maxBidFactor * 100)}%` : "";
    reason = `[${format}] Bid hiện tại $${currentBid.toFixed(2)} vượt trần an toàn $${effectiveMaxBid.toFixed(2)} (Trần phôi $${skuMaxBid.toFixed(2)}${factorLabel}) -> Giảm về trần an toàn.`;
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
      if (clampedBid < currentBid) priority = "P0";
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
  const sql = await getDatabaseClient();

  let addedCount = 0;
  let supersededCount = 0;

  await sql.begin(async (tx: any) => {
    for (const item of items) {
      const rec = item.recommendation;
      const sku = (rec.sku || "").toUpperCase();
      const campaignId = rec.campaignId || "";
      const targetId = rec.keywordId || "";
      const actionType: ActionType = rec.recType === "PAUSE_TARGET" ? "PAUSE_TARGET" : "UPDATE_BID";
      const finalValue = item.userFinalBid ?? rec.recommendedBid ?? rec.currentBid ?? 0;

      const existing = await tx`
        SELECT id, action_type, status FROM ppc_actions
        WHERE store_id = ${storeId}
          AND campaign_id = ${campaignId}
          AND (target_id = ${targetId} OR (target_keyword = ${rec.keyword} AND match_type = ${rec.matchType || 'Exact'}))
          AND status IN ('PENDING', 'APPROVED', 'QUEUED')
      `;

      if (existing.length > 0) {
        for (const ex of existing) {
          if (ex.action_type === "PAUSE_TARGET" && actionType === "UPDATE_BID") {
            continue;
          }
          await tx`
            UPDATE ppc_actions
            SET status = 'SUPERSEDED', updated_at = NOW()
            WHERE id = ${ex.id}
          `;
          supersededCount++;
        }
      }

      await tx`
        INSERT INTO ppc_actions (
          store_id, recommendation_id, sku, campaign_id, campaign_name,
          campaign_type, ad_group_id, ad_group_name, target_id, target_keyword,
          match_type, entity_type, action_type, old_value, system_suggested_value,
          final_value, rule_version, status, approved_by, approved_at
        ) VALUES (
          ${storeId}, ${rec.id}, ${sku}, ${campaignId}, ${rec.campaignName || ''},
          ${rec.adType || 'SP'}, ${rec.adGroupId || ''}, ${rec.adGroupName || ''},
          ${targetId}, ${rec.keyword}, ${rec.matchType || 'Exact'}, 'KEYWORD',
          ${actionType}, ${rec.currentBid || 0}, ${rec.recommendedBid || 0},
          ${finalValue}, ${rec.ruleProfile || 'v1.0'}, 'APPROVED',
          ${item.approvedBy || 'User'}, NOW()
        )
      `;
      addedCount++;
    }
  });

  return { addedCount, supersededCount };
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
      WHERE store_id = ${storeId} AND grain = 'PRODUCT' AND sku IS NOT NULL
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
    const isProduct = act.entity_type === "PRODUCT" || (act.target_keyword && (act.target_keyword.includes("asin=") || act.target_keyword.includes("category=")));
    const entity = isProduct ? "Product Targeting" : (act.action_type === "UPDATE_BUDGET" ? "Campaign" : "Keyword");
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
        product: "Sponsored Products",
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

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const timeStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  // Format: Upload + tên camp + time
  const rawCampName = actions.find((a: any) => a.campaign_name)?.campaign_name || actions[0]?.sku || "AmazonAds";
  const cleanCamp = rawCampName
    .replace(/[/\\?%*:|"<>]/g, "_")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 70)
    .replace(/_+$/, "");

  const fileName = `Upload_${cleanCamp}_${timeStr}.xlsx`;

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

export async function getBulkExportHistory(storeId: string): Promise<BulkExport[]> {
  const sql = await getDatabaseClient();
  const rows = await sql<any[]>`
    SELECT id, store_id, file_name, action_count, summary, status, created_at
    FROM bulk_exports
    WHERE store_id = ${storeId}
    ORDER BY created_at DESC
    LIMIT 50
  `;

  return rows.map((r: any) => ({
    id: r.id,
    storeId: r.store_id,
    fileName: r.file_name,
    actionCount: Number(r.action_count),
    summary: typeof r.summary === "string" ? JSON.parse(r.summary) : r.summary,
    status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export async function getAutoUploadLogs(storeId: string): Promise<PpcAutoUploadLog[]> {
  const sql = await getDatabaseClient();
  const rows = await sql<any[]>`
    SELECT id, store_id, file_name, adspower_profile_id, adspower_profile_name,
           action_count, skus, status, error_message, duration_ms, created_at
    FROM ppc_auto_upload_logs
    WHERE store_id = ${storeId}
    ORDER BY created_at DESC
    LIMIT 50
  `;

  return rows.map((r: any) => ({
    id: r.id,
    storeId: r.store_id,
    fileName: r.file_name,
    adspowerProfileId: r.adspower_profile_id,
    adspowerProfileName: r.adspower_profile_name,
    actionCount: Number(r.action_count || 0),
    skus: Array.isArray(r.skus) ? r.skus : (typeof r.skus === "string" ? JSON.parse(r.skus) : []),
    status: r.status,
    errorMessage: r.error_message,
    durationMs: Number(r.duration_ms || 0),
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export async function executeAutoUploadZeroSpendActions(
  storeId: string,
  selectedActionIds?: string[],
): Promise<{
  success: boolean;
  log: PpcAutoUploadLog;
  message: string;
  fileName?: string;
  fileBase64?: string;
}> {
  const sql = await getDatabaseClient();
  const startTime = Date.now();

  // 1. Get all pending/approved actions in the queue
  const queueActions = await getActionQueue(storeId);
  let candidateActions = queueActions;
  if (selectedActionIds && selectedActionIds.length > 0) {
    const idSet = new Set(selectedActionIds);
    candidateActions = queueActions.filter((a) => idSet.has(a.id));
  }

  // 2. Filter ONLY actions belonging to Zero-Spend SKUs (chưa cắn tiền)
  const zeroSpendActions = candidateActions.filter((a) => a.isZeroSpend);
  if (zeroSpendActions.length === 0) {
    throw new Error(
      "Không có hành động nào thuộc SKU chưa cắn tiền (Zero Spend). Chức năng Auto Upload AdsPower chỉ áp dụng cho SKU chưa cắn tiền.",
    );
  }

  const zeroSpendActionIds = zeroSpendActions.map((a) => a.id);
  const distinctSkus = Array.from(new Set(zeroSpendActions.map((a) => a.sku).filter(Boolean)));

  // 3. Export Bulk file using canonical function
  const exportResult = await exportBulkFromQueue(storeId, zeroSpendActionIds);

  // 4. Save file to scratch directory
  const scratchDir = path.join(process.cwd(), "scratch");
  if (!fs.existsSync(scratchDir)) {
    fs.mkdirSync(scratchDir, { recursive: true });
  }
  const tempFilePath = path.join(scratchDir, exportResult.fileName);
  fs.writeFileSync(tempFilePath, exportResult.buffer);

  // 5. Get store name for AdsPower
  const storeRows = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM ppc_stores WHERE id = ${storeId} LIMIT 1
  `;
  const storeName = storeRows.length > 0 ? storeRows[0].name : "HSOSTORE";

  // 6. Record initial RUNNING log
  const initialLog = await sql<any[]>`
    INSERT INTO ppc_auto_upload_logs (
      store_id, file_name, action_count, skus, status
    ) VALUES (
      ${storeId}, ${exportResult.fileName}, ${zeroSpendActions.length},
      ${JSON.stringify(distinctSkus)}::jsonb, 'RUNNING'
    )
    RETURNING id, created_at
  `;
  const logId = initialLog[0].id;

  try {
    // 7. Upload to Amazon Ads via AdsPower
    const uploadRes = await uploadBulkFileToAmazonAds({
      filePath: tempFilePath,
      storeName,
    });

    const durationMs = Date.now() - startTime;

    // 8. Update log as SUCCESS
    await sql`
      UPDATE ppc_auto_upload_logs
      SET status = 'SUCCESS',
          adspower_profile_id = ${uploadRes.profileId || null},
          adspower_profile_name = ${uploadRes.profileName || storeName},
          duration_ms = ${durationMs},
          error_message = NULL
      WHERE id = ${logId}
    `;

    return {
      success: true,
      log: {
        id: logId,
        storeId,
        fileName: exportResult.fileName,
        adspowerProfileId: uploadRes.profileId || null,
        adspowerProfileName: uploadRes.profileName || storeName,
        actionCount: zeroSpendActions.length,
        skus: distinctSkus,
        status: "SUCCESS",
        errorMessage: null,
        durationMs,
        createdAt: new Date(initialLog[0].created_at).toISOString(),
      },
      fileName: exportResult.fileName,
      fileBase64: exportResult.buffer.toString("base64"),
      message: `Đã tự động xuất và upload thành công ${zeroSpendActions.length} actions của ${distinctSkus.length} SKU chưa cắn tiền lên Amazon Ads!`,
    };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    const errorMsg = String(err?.message || err);

    await sql`
      UPDATE ppc_auto_upload_logs
      SET status = 'FAILED',
          duration_ms = ${durationMs},
          error_message = ${errorMsg}
      WHERE id = ${logId}
    `;

    throw new Error(`Auto Upload thất bại: ${errorMsg}`);
  }
}
