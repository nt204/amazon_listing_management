// lib/ppc/sku-architecture-service.ts
import "server-only";

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
  type PpcRuleDefinition,
  type PpcRuleVersion,
  type ProductCostMaster,
  type SkuEconomics,
  type SkuRecommendationGroup,
} from "./sku-architecture-types";
import type { PpcPerformanceRow, PpcRecommendation } from "./types";
import { extractSkuFromText } from "./sku-extractor";
import { AMAZON_BULKSHEET_SP_COLUMNS } from "./service";

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

    let sellingPrice = hasPrefixError
      ? 0
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

    // CR mục tiêu cố định 10% (0.10) cho tất cả các phôi. Max Bid luôn cố định theo phôi (Max Bid = 10% * Profit Before Ads).
    // Chỉ thay đổi khi người dùng chủ động OVERRIDE.
    let cr = existing?.cr_source === "OVERRIDE" ? Number(existing.cr) : 0.10;
    let crSource: CrSource = existing?.cr_source === "OVERRIDE" ? "OVERRIDE" : "ASSUMED";

    // Break-even ACoS & Profit Before Ads:
    // When costSource is INHERITED, use the Cost Master values directly (from Phôi configuration)
    let profitBeforeAds: number;
    let breakEvenAcos: number;

    if (costSource === "INHERITED") {
      profitBeforeAds = master.defaultPrice > 0
        ? Math.round((master.defaultPrice - master.defaultAmazonFee - master.baseCost) * 100) / 100
        : calculateProfitBeforeAds(sellingPrice, amazonFee, baseCost, taxRate);
      breakEvenAcos = master.breakEvenAcos > 0
        ? master.breakEvenAcos
        : calculateBreakEvenAcos(profitBeforeAds, sellingPrice);
    } else {
      profitBeforeAds = calculateProfitBeforeAds(sellingPrice, amazonFee, baseCost, taxRate);
      breakEvenAcos = calculateBreakEvenAcos(profitBeforeAds, sellingPrice);
    }

    const maxBid = hasPrefixError ? 0 : calculateMaxBid(cr, profitBeforeAds);

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
    ORDER BY campaign_type ASC, version DESC
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
  if (!econ || econ.productType === SKU_PREFIX_ERROR_PRODUCT_TYPE) return null;

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
  const skuMaxBid = econ.maxBid > 0 ? econ.maxBid : rule.limits.maxBid;
  const effectiveMaxBid = Math.min(rule.limits.maxBid, skuMaxBid);
  // Khi trần kinh tế thấp hơn sàn rule, ưu tiên trần để không bid vượt khả năng sinh lời.
  const effectiveMinBid = Math.min(rule.limits.minBid, effectiveMaxBid);

  if (hasOrders) {
    if (isSponsoredProduct) {
      if (actualAcos > 0 && actualAcos < 20) {
        recType = "BID_INCREASE";
        targetBid = currentBid * 1.08;
        reason = `[${format}] ACOS ${actualAcos.toFixed(1)}% (< 20%) -> Tăng bid +8% so với Bid hiện tại ($${currentBid.toFixed(2)}).`;
      } else if (actualAcos >= 20 && actualAcos < 30) {
        recType = "BID_INCREASE";
        targetBid = currentBid * 1.05;
        reason = `[${format}] ACOS ${actualAcos.toFixed(1)}% (20% - 30%) -> Tăng bid +5% so với Bid hiện tại ($${currentBid.toFixed(2)}).`;
      } else if (actualAcos >= 30 && actualAcos <= 40) {
        // HOLD; phần kiểm tra trần bid bên dưới vẫn có thể yêu cầu giảm.
      } else if (actualAcos > 40 && actualAcos <= beAcos) {
        recType = "BID_DECREASE";
        targetBid = avgCpc * 0.92;
        priority = "P1";
        reason = `[${format}] ACOS ${actualAcos.toFixed(1)}% (40% đến ACoS hòa vốn ${beAcos}%) -> Giảm bid -8% so với CPC TB ($${avgCpc.toFixed(2)}).`;
      } else if (actualAcos > beAcos) {
        recType = "BID_DECREASE";
        targetBid = avgCpc * 0.85;
        priority = "P0";
        reason = `[${format}] ACOS ${actualAcos.toFixed(1)}% vượt ACoS hòa vốn ${beAcos}% -> Giảm bid mạnh -15% so với CPC TB ($${avgCpc.toFixed(2)}).`;
      }
    } else {
      // SB01 and SB05
      if (actualAcos > 0 && actualAcos < 15) {
        recType = "BID_INCREASE";
        targetBid = currentBid * 1.08;
        reason = `[${format}] ACOS ${actualAcos.toFixed(1)}% (< 15%) -> Tăng bid +8% so với Bid hiện tại ($${currentBid.toFixed(2)}).`;
      } else if (actualAcos >= 15 && actualAcos < 25) {
        recType = "BID_INCREASE";
        targetBid = currentBid * 1.05;
        reason = `[${format}] ACOS ${actualAcos.toFixed(1)}% (15% - 25%) -> Tăng bid +5% so với Bid hiện tại ($${currentBid.toFixed(2)}).`;
      } else if (actualAcos >= 25 && actualAcos <= 40) {
        // HOLD; phần kiểm tra trần bid bên dưới vẫn có thể yêu cầu giảm.
      } else if (actualAcos > 40 && actualAcos <= beAcos) {
        recType = "BID_DECREASE";
        targetBid = avgCpc * 0.92;
        priority = "P1";
        reason = `[${format}] ACOS ${actualAcos.toFixed(1)}% (40% đến ACoS hòa vốn ${beAcos}%) -> Giảm bid -8% so với CPC TB ($${avgCpc.toFixed(2)}).`;
      } else if (actualAcos > beAcos) {
        recType = "BID_DECREASE";
        targetBid = avgCpc * 0.85;
        priority = "P0";
        reason = `[${format}] ACOS ${actualAcos.toFixed(1)}% (vượt ACoS hòa vốn ${beAcos}%) -> Giảm bid mạnh -15% so với CPC TB ($${avgCpc.toFixed(2)}).`;
      }
    }
  } else {
    // No orders (orders == 0)
    if (isSponsoredProduct) {
      if (row.clicks < 1) {
        recType = "BID_INCREASE";
        targetBid = currentBid * 1.05;
        reason = `[${format}] 0 clicks trong kỳ -> Tăng bid +5% so với Bid hiện tại ($${currentBid.toFixed(2)}) kích traffic.`;
      } else if (row.clicks >= 1 && row.clicks <= 7) {
        // HOLD; phần kiểm tra trần bid bên dưới vẫn có thể yêu cầu giảm.
      } else if (row.clicks > 7 && row.clicks <= 10) {
        recType = "BID_DECREASE";
        targetBid = avgCpc * 0.90;
        reason = `[${format}] Đã tiêu ${row.clicks} clicks ($${row.spend.toFixed(2)}) không ra đơn -> Giảm bid -10% so với CPC TB ($${avgCpc.toFixed(2)}).`;
      } else if (row.clicks > 10) {
        recType = "PAUSE_TARGET";
        actionState = "PAUSED";
        priority = "P0";
        targetBid = rule.limits.minBid;
        reason = `[${format}] Đã tiêu ${row.clicks} clicks (> 10 clicks) không ra đơn -> Đề xuất Tạm dừng (Pause).`;
      }
    } else if (format === "SB05") {
      if (row.clicks < 1) {
        recType = "BID_INCREASE";
        targetBid = currentBid * 1.05;
        reason = `[SB05] 0 clicks trong kỳ -> Tăng bid +5% so với Bid hiện tại ($${currentBid.toFixed(2)}) kích traffic.`;
      } else if (row.clicks >= 1 && row.clicks <= 8) {
        // HOLD; phần kiểm tra trần bid bên dưới vẫn có thể yêu cầu giảm.
      } else if (row.clicks > 8 && row.clicks <= 11) {
        recType = "BID_DECREASE";
        targetBid = avgCpc * 0.90;
        reason = `[SB05] Đã tiêu ${row.clicks} clicks ($${row.spend.toFixed(2)}) không ra đơn -> Giảm bid -10% so với CPC TB ($${avgCpc.toFixed(2)}).`;
      } else if (row.clicks > 11) {
        recType = "PAUSE_TARGET";
        actionState = "PAUSED";
        priority = "P0";
        targetBid = rule.limits.minBid;
        reason = `[SB05] Đã tiêu ${row.clicks} clicks (> 11 clicks) không ra đơn -> Đề xuất Tạm dừng (Pause).`;
      }
    } else {
      // SB01
      if (row.clicks < 1) {
        recType = "BID_INCREASE";
        targetBid = currentBid * 1.05;
        reason = `[SB01] 0 clicks trong kỳ -> Tăng bid +5% so với Bid hiện tại ($${currentBid.toFixed(2)}) kích traffic.`;
      } else if (row.clicks >= 1 && row.clicks <= 9) {
        // HOLD; phần kiểm tra trần bid bên dưới vẫn có thể yêu cầu giảm.
      } else if (row.clicks > 9 && row.clicks <= 13) {
        recType = "BID_DECREASE";
        targetBid = avgCpc * 0.90;
        reason = `[SB01] Đã tiêu ${row.clicks} clicks ($${row.spend.toFixed(2)}) không ra đơn -> Giảm bid -10% so với CPC TB ($${avgCpc.toFixed(2)}).`;
      } else if (row.clicks > 13) {
        recType = "PAUSE_TARGET";
        actionState = "PAUSED";
        priority = "P0";
        targetBid = rule.limits.minBid;
        reason = `[SB01] Đã tiêu ${row.clicks} clicks (> 13 clicks) không ra đơn -> Đề xuất Tạm dừng (Pause).`;
      }
    }
  }

  if (!recType) {
    if (currentBid <= effectiveMaxBid) return null;
    recType = "BID_DECREASE";
    targetBid = effectiveMaxBid;
    priority = "P0";
    reason = `[${format}] Bid hiện tại $${currentBid.toFixed(2)} vượt trần kinh tế SKU $${skuMaxBid.toFixed(2)} -> Giảm về trần an toàn.`;
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
    reason: `${reason} (Sàn rule: $${rule.limits.minBid.toFixed(2)}; trần campaign: $${rule.limits.maxBid.toFixed(2)}; trần SKU: $${skuMaxBid.toFixed(2)}; bid cuối: $${clampedBid.toFixed(2)}.)`,
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
          AND target_id = ${targetId}
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
    SELECT * FROM ppc_actions
    WHERE store_id = ${storeId}
      AND status IN ('APPROVED', 'QUEUED')
    ORDER BY created_at DESC
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
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  }));
}

export async function removeActionFromQueue(storeId: string, actionId: string): Promise<void> {
  const sql = await getDatabaseClient();
  await sql`
    UPDATE ppc_actions
    SET status = 'IGNORED', updated_at = NOW()
    WHERE store_id = ${storeId} AND id = ${actionId}
  `;
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

  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Amazon Advertising";
  workbook.created = new Date();

  const portfolioSheet = workbook.addWorksheet("Portfolios");
  portfolioSheet.addRow(["Portfolio ID", "Portfolio Name", "Currency"]);

  const spSheet = workbook.addWorksheet("Sponsored Products Campaigns");
  const headerRow = spSheet.addRow(AMAZON_BULKSHEET_SP_COLUMNS);
  headerRow.font = { name: "Arial", size: 10, bold: true };

  let updateBidCount = 0;
  let pauseCount = 0;
  let budgetCount = 0;

  const exportItemsData: Array<{ actionId: string; entityType: string; op: string; row: any }> = [];

  for (const act of actions) {
    let entity = "Keyword";
    let operation = "Update";
    let state = act.action_type === "PAUSE_TARGET" ? "paused" : "enabled";
    let bidVal: number | string = "";

    if (act.action_type === "UPDATE_BID") {
      updateBidCount++;
      bidVal = act.final_value ? Number(Number(act.final_value).toFixed(2)) : "";
    } else if (act.action_type === "PAUSE_TARGET") {
      pauseCount++;
      bidVal = "";
    } else if (act.action_type === "UPDATE_BUDGET") {
      budgetCount++;
      entity = "Campaign";
    }

    const row = new Array(AMAZON_BULKSHEET_SP_COLUMNS.length).fill("");
    row[0] = "Sponsored Products";
    row[1] = entity;
    row[2] = operation;
    row[3] = act.campaign_id || "";
    row[4] = act.ad_group_id || "";
    row[7] = act.target_id || "";
    row[9] = act.campaign_name || "";
    row[10] = act.ad_group_name || "";
    row[11] = act.campaign_name || "";
    row[12] = act.ad_group_name || "";
    row[15] = act.target_keyword || "";
    row[16] = act.match_type || "Exact";
    row[19] = state;
    row[21] = bidVal;

    spSheet.addRow(row);
    exportItemsData.push({
      actionId: act.id,
      entityType: entity,
      op: operation,
      row,
    });
  }

  const dateStr = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const fileName = `bulk_export_${dateStr}.xlsx`;
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

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
