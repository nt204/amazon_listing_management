import "server-only";
import { Readable } from "node:stream";

import { getDatabaseClient } from "@/lib/db";
import ExcelJS from "exceljs";
import JSZip from "jszip";

export interface AdsItem {
  id: string;
  store_id: string;
  date: string;
  portfolio: string;
  status: string;
  budget_type: string;
  budget: number;
  budget_start: string;
  budget_end: string;
  campaign_count: number;
  impressions: number;
  clicks: number;
  ctr: number;
  spend: number;
  cpc: number;
  orders: number;
  sales: number;
  acos: number;
  roas: number;
  ntb_orders: number;
  pct_orders_ntb: number;
  ntb_sales: number;
  pct_sales_ntb: number;
  viewable_impressions: number;
  vcpm: number;
  sku: string;
  loai: string;
  mkt_pic: string;
  tuan: number;
  thang: number;
  quy: number;
  thue_10: number;
  trang_thai: string;
  custom_fields?: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

export interface AdsStats {
  totalRows: number;
  totalSpend: number;
  totalSales: number;
  totalClicks: number;
  totalOrders: number;
  totalImpressions: number;
  avgCpc: number;
  avgAcos: number;
  avgRoas: number;
  totalThue10: number;
}

export function cleanAdsDate(val: unknown): string | null {
  if (val == null) return null;

  // Excel serial date number (e.g. 46022 -> 2025-12-31)
  if (typeof val === "number" && !isNaN(val) && val > 20000 && val < 80000) {
    const date = new Date(Math.round((val - 25569) * 86400 * 1000));
    if (!isNaN(date.getTime())) {
      return date.toISOString().split("T")[0];
    }
  }

  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return val.toISOString().split("T")[0];
  }

  let s = String(val).trim();
  if (!s || s === "—" || s === "-" || s === "null" || s === "None" || s === "undefined") return null;

  const num = parseFloat(s);
  if (!isNaN(num) && num > 20000 && num < 80000 && /^\d+(\.\d+)?$/.test(s)) {
    const date = new Date(Math.round((num - 25569) * 86400 * 1000));
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

  // MM/DD/YYYY or DD/MM/YYYY
  const parts = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (parts) {
    const p1 = parseInt(parts[1], 10);
    const p2 = parseInt(parts[2], 10);
    const year = parts[3];
    // In Amazon US reports, format is MM/DD/YYYY
    if (p1 <= 12) {
      return `${year}-${String(p1).padStart(2, "0")}-${String(p2).padStart(2, "0")}`;
    } else {
      return `${year}-${String(p2).padStart(2, "0")}-${String(p1).padStart(2, "0")}`;
    }
  }

  return null;
}

export function getIsoWeek(dateStr: string): number {
  const d = new Date(dateStr + "T00:00:00Z");
  if (isNaN(d.getTime())) return 0;
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function getMonthAndQuarter(dateStr: string): { month: number; quarter: number } {
  const d = new Date(dateStr + "T00:00:00Z");
  if (isNaN(d.getTime())) return { month: 0, quarter: 0 };
  const month = d.getUTCMonth() + 1;
  const quarter = Math.ceil(month / 3);
  return { month, quarter };
}

function extractDateFromFilename(fileName: string): string | null {
  // Check YYYY-MM-DD
  const isoMatch = fileName.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  // Check Oct_12_2026 or Oct 12 2026
  const textMatch = fileName.match(/([A-Za-z]{3})[_\s](\d{1,2})[_\s](\d{4})/);
  if (textMatch) {
    const monthNames: Record<string, string> = {
      jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
      jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
    };
    const mStr = monthNames[textMatch[1].toLowerCase()];
    if (mStr) {
      return `${textMatch[3]}-${mStr}-${textMatch[2].padStart(2, "0")}`;
    }
  }

  return null;
}

export async function listAds(
  storeId: string,
  options?: {
    page?: number;
    limit?: number;
    search?: string;
    dateSort?: "asc" | "desc";
    startDate?: string;
    endDate?: string;
    sku?: string;
    mktPic?: string;
    filters?: Record<string, string>;
  }
): Promise<{
  rows: AdsItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  stats: AdsStats;
  availableDates: string[];
}> {
  const sql = await getDatabaseClient();
  const page = Math.max(1, options?.page || 1);
  const limit = Math.max(1, Math.min(500, options?.limit || 50));
  const offset = (page - 1) * limit;
  const dateSort = options?.dateSort === "asc" ? "asc" : "desc";

  const conditions = [sql`store_id = ${storeId}`];

  if (options?.startDate) {
    conditions.push(sql`date >= ${options.startDate}::date`);
  }
  if (options?.endDate) {
    conditions.push(sql`date <= ${options.endDate}::date`);
  }
  if (options?.sku) {
    conditions.push(sql`sku ILIKE ${`%${options.sku.trim()}%`}`);
  }
  if (options?.mktPic) {
    conditions.push(sql`mkt_pic ILIKE ${`%${options.mktPic.trim()}%`}`);
  }

  if (options?.search) {
    const q = `%${options.search.trim()}%`;
    conditions.push(sql`(
      portfolio ILIKE ${q} OR
      sku ILIKE ${q} OR
      mkt_pic ILIKE ${q} OR
      status ILIKE ${q} OR
      trang_thai ILIKE ${q} OR
      loai ILIKE ${q}
    )`);
  }

  if (options?.filters && Object.keys(options.filters).length > 0) {
    const safeColumns = [
      "status", "budget_type", "sku", "loai", "mkt_pic", "trang_thai",
    ];
    for (const [key, val] of Object.entries(options.filters)) {
      if (val && safeColumns.includes(key)) {
        conditions.push(sql`${sql(key)} ILIKE ${`%${val.trim()}%`}`);
      }
    }
  }

  const whereClause = conditions.reduce((prev, curr) => sql`${prev} AND ${curr}`);

  // Fetch paginated rows
  const rows = await sql<AdsItem[]>`
    SELECT
      id,
      store_id,
      date::text,
      portfolio,
      status,
      budget_type,
      budget::float,
      budget_start,
      budget_end,
      campaign_count,
      impressions::float,
      clicks::float,
      ctr::float,
      spend::float,
      cpc::float,
      orders::float,
      sales::float,
      acos::float,
      roas::float,
      ntb_orders::float,
      pct_orders_ntb::float,
      ntb_sales::float,
      pct_sales_ntb::float,
      viewable_impressions::float,
      vcpm::float,
      sku,
      loai,
      mkt_pic,
      tuan,
      thang,
      quy,
      thue_10::float,
      trang_thai,
      custom_fields,
      created_at::text,
      updated_at::text
    FROM accounting_ads
    WHERE ${whereClause}
    ORDER BY ${
      dateSort === "asc"
        ? sql`date ASC NULLS FIRST, spend DESC NULLS LAST, portfolio ASC`
        : sql`date DESC NULLS LAST, spend DESC NULLS LAST, portfolio ASC`
    }
    LIMIT ${limit} OFFSET ${offset}
  `;

  // Aggregate stats
  const statsRes = await sql<any[]>`
    SELECT
      COUNT(*)::text as count,
      COALESCE(SUM(spend), 0)::float as total_spend,
      COALESCE(SUM(sales), 0)::float as total_sales,
      COALESCE(SUM(clicks), 0)::float as total_clicks,
      COALESCE(SUM(orders), 0)::float as total_orders,
      COALESCE(SUM(impressions), 0)::float as total_impressions,
      COALESCE(SUM(thue_10), 0)::float as total_thue_10
    FROM accounting_ads
    WHERE ${whereClause}
  `;

  const s = statsRes[0] || {};
  const totalRows = parseInt(s.count || "0", 10);
  const totalSpend = Number(s.total_spend) || 0;
  const totalSales = Number(s.total_sales) || 0;
  const totalClicks = Number(s.total_clicks) || 0;
  const totalOrders = Number(s.total_orders) || 0;
  const totalImpressions = Number(s.total_impressions) || 0;
  const totalThue10 = Number(s.total_thue_10) || 0;

  const avgCpc = totalClicks > 0 ? Number((totalSpend / totalClicks).toFixed(2)) : 0;
  const avgAcos = totalSales > 0 ? Number(((totalSpend / totalSales) * 100).toFixed(2)) : 0;
  const avgRoas = totalSpend > 0 ? Number((totalSales / totalSpend).toFixed(2)) : 0;

  const stats: AdsStats = {
    totalRows,
    totalSpend: Number(totalSpend.toFixed(2)),
    totalSales: Number(totalSales.toFixed(2)),
    totalClicks,
    totalOrders,
    totalImpressions,
    avgCpc,
    avgAcos,
    avgRoas,
    totalThue10: Number(totalThue10.toFixed(2)),
  };

  // Distinct dates for quick filter
  const datesRes = await sql<{ date: string }[]>`
    SELECT DISTINCT date::text
    FROM accounting_ads
    WHERE store_id = ${storeId}
    ORDER BY date DESC
    LIMIT 60
  `;

  return {
    rows,
    total: totalRows,
    page,
    limit,
    totalPages: Math.ceil(totalRows / limit) || 1,
    stats,
    availableDates: datesRes.map((d) => d.date),
  };
}

export async function parseAdsBuffer(
  buffer: Buffer,
  fileName: string,
  storeId: string
): Promise<Array<Omit<AdsItem, "id" | "created_at" | "updated_at">>> {
  const isExcel = fileName.endsWith(".xlsx") || fileName.endsWith(".xls");
  const fallbackDate = extractDateFromFilename(fileName) || new Date().toISOString().split("T")[0];

  // Fetch known SKUs & PICs from accounting_sku_master for intelligent mapping
  const sql = await getDatabaseClient();
  const knownSkus = await sql<{ sku: string; pic_mkt: string; loai: string; status: string }[]>`
    SELECT sku, COALESCE(pic_mkt, '') as pic_mkt, COALESCE(loai, 'FBA') as loai, COALESCE(status, '') as status
    FROM accounting_sku_master
    WHERE store_id = ${storeId} AND sku IS NOT NULL AND sku != ''
  `;

  const skuMap = new Map<string, { pic_mkt: string; loai: string; status: string }>();
  for (const item of knownSkus) {
    skuMap.set(item.sku.trim().toUpperCase(), item);
  }

  const results: Array<Omit<AdsItem, "id" | "created_at" | "updated_at">> = [];

  if (isExcel) {
    if (fileName.endsWith(".xlsx")) {
      try {
        const zip = await JSZip.loadAsync(buffer);
        const workbookXml = await zip.file("xl/workbook.xml")?.async("text");
        const sheetMatches = [...(workbookXml?.matchAll(/<sheet [^>]*name=\"([^\"]+)\"/g) || [])].map((m) => m[1]);

        let targetSheetName = "";
        if (sheetMatches.length > 0) {
          targetSheetName =
            sheetMatches.find((n) => n.trim().toUpperCase() === "ADS") ||
            sheetMatches.find((n) => n.toLowerCase().includes("ads")) ||
            sheetMatches[0];
        }

        if (targetSheetName) {
          const stream = Readable.from(buffer);
          const workbookReader = new (ExcelJS.stream.xlsx as any).WorkbookReader(stream, {
            entries: "emit",
            sharedStrings: "cache",
            styles: "ignore",
            hyperlinks: "ignore",
            worksheets: "emit",
          });

          const headers: string[] = [];
          let targetFound = false;

          for await (const ws of workbookReader) {
            if (ws.name === targetSheetName) {
              targetFound = true;
              let isHeaderRow = true;
              for await (const row of ws) {
                const vals = (row.values as any[]) || [];
                if (isHeaderRow) {
                  isHeaderRow = false;
                  vals.forEach((v, idx) => {
                    if (v != null) {
                      let str = "";
                      if (typeof v === "object" && v !== null) {
                        str = String((v as any).result || (v as any).text || (v as any).formula || "").trim().toLowerCase();
                      } else {
                        str = String(v).trim().toLowerCase();
                      }
                      headers[idx] = str;
                    }
                  });
                } else {
                  const getColVal = (patterns: string[]): any => {
                    for (const p of patterns) {
                      const idx = headers.indexOf(p.toLowerCase());
                      if (idx !== -1 && vals[idx] !== undefined) {
                        let c = vals[idx];
                        while (c && typeof c === "object" && !(c instanceof Date)) {
                          if ("result" in c) c = c.result;
                          else if ("text" in c) c = c.text;
                          else break;
                        }
                        return c;
                      }
                    }
                    return null;
                  };

                  const portfolioVal = getColVal(["portfolio", "portfolio name", "state"]);
                  if (!portfolioVal) continue;
                  const portfolio = String(portfolioVal).trim();
                  if (!portfolio) continue;

                  const dateRaw = getColVal(["date", "ngày", "state"]) || fallbackDate;
                  const cleanDate = cleanAdsDate(dateRaw) || fallbackDate;

                  const spend = Number(getColVal(["spend(usd)", "spend", "chi phí"])) || 0;
                  const sales = Number(getColVal(["sales(usd)", "sales", "doanh thu"])) || 0;
                  const clicks = Number(getColVal(["clicks", "click"])) || 0;
                  const impressions = Number(getColVal(["impressions", "impression"])) || 0;
                  const orders = Number(getColVal(["orders", "order"])) || 0;
                  const status = String(getColVal(["status", "trạng thái portfolio"]) || "PORTFOLIO_STATUS_ENABLED").trim();
                  const budgetType = String(getColVal(["budget type", "loại budget"]) || "NO_CAP").trim();
                  const budget = Number(getColVal(["budget(usd)", "budget"])) || 0;
                  const budgetStart = String(getColVal(["budget start"]) || "").trim();
                  const budgetEnd = String(getColVal(["budget end"]) || "").trim();
                  const campaignCount = Number(getColVal(["campaign count"])) || 0;
                  const ctr = Number(getColVal(["ctr"])) || (impressions > 0 ? clicks / impressions : 0);
                  const cpc = Number(getColVal(["cpc(usd)", "cpc"])) || (clicks > 0 ? spend / clicks : 0);
                  const acos = Number(getColVal(["acos"])) || (sales > 0 ? spend / sales : 0);
                  const roas = Number(getColVal(["roas"])) || (spend > 0 ? sales / spend : 0);
                  const ntbOrders = Number(getColVal(["ntb orders"])) || 0;
                  const pctOrdersNtb = Number(getColVal(["% of orders ntb"])) || 0;
                  const ntbSales = Number(getColVal(["ntb sales(usd)", "ntb sales"])) || 0;
                  const pctSalesNtb = Number(getColVal(["% of sales ntb"])) || 0;
                  const viewableImpressions = Number(getColVal(["viewable impressions"])) || 0;
                  const vcpm = Number(getColVal(["vcpm(usd)", "vcpm"])) || 0;

                  let sku = String(getColVal(["sku"]) || "").trim();
                  let loai = String(getColVal(["loại", "loai"]) || "").trim();
                  let mktPic = String(getColVal(["mkt pic", "pic mkt", "pic"]) || "").trim();
                  let trangThai = String(getColVal(["trạng thái", "trang thai"]) || "").trim();

                  if (!sku) {
                    for (const [knownSkuKey] of skuMap) {
                      if (portfolio.toUpperCase().includes(knownSkuKey)) {
                        sku = knownSkuKey;
                        break;
                      }
                    }
                    if (!sku) {
                      const tokens = portfolio.split(/\s+/);
                      const lastToken = tokens[tokens.length - 1];
                      if (lastToken && /^[A-Z0-9-]+$/i.test(lastToken) && lastToken.length >= 4) {
                        sku = lastToken;
                      }
                    }
                  }

                  const matchedMaster = sku ? skuMap.get(sku.toUpperCase()) : null;
                  if (!loai) loai = matchedMaster?.loai || "FBA";
                  if (!mktPic) {
                    mktPic = matchedMaster?.pic_mkt || portfolio.split(/\s+/)[0] || "";
                  }
                  if (!trangThai) {
                    trangThai = matchedMaster?.status || "Phát triển";
                  }

                  const { month, quarter } = getMonthAndQuarter(cleanDate);
                  const tuan = Number(getColVal(["tuần", "tuan"])) || getIsoWeek(cleanDate);
                  const thang = Number(getColVal(["tháng", "thang"])) || month;
                  const quy = Number(getColVal(["quý", "quy"])) || quarter;
                  const thue10 = Number(getColVal(["thuế 10%", "thue 10%"])) || Number((spend * 0.1).toFixed(3));

                  results.push({
                    store_id: storeId,
                    date: cleanDate,
                    portfolio,
                    status,
                    budget_type: budgetType,
                    budget,
                    budget_start: budgetStart,
                    budget_end: budgetEnd,
                    campaign_count: campaignCount,
                    impressions,
                    clicks,
                    ctr,
                    spend,
                    cpc,
                    orders,
                    sales,
                    acos,
                    roas,
                    ntb_orders: ntbOrders,
                    pct_orders_ntb: pctOrdersNtb,
                    ntb_sales: ntbSales,
                    pct_sales_ntb: pctSalesNtb,
                    viewable_impressions: viewableImpressions,
                    vcpm,
                    sku,
                    loai,
                    mkt_pic: mktPic,
                    tuan,
                    thang,
                    quy,
                    thue_10: thue10,
                    trang_thai: trangThai,
                  });
                }
              }
              break;
            } else {
              for await (const _ of ws) {}
            }
          }

          if (targetFound && results.length > 0) {
            return results;
          }
        }
      } catch (streamErr) {
        console.warn("[parseAdsBuffer] Lỗi streaming xlsx, chuyển về chế độ tải tiêu chuẩn:", streamErr);
      }
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    // Look for sheet named "ADS" or "ads"
    let worksheet = workbook.worksheets.find(
      (ws) => ws.name.trim().toUpperCase() === "ADS"
    );
    if (!worksheet) {
      worksheet = workbook.worksheets[0];
    }
    if (!worksheet) {
      return [];
    }

    // Row 1 is header
    const headerRow = worksheet.getRow(1);
    const colIndexMap = new Map<string, number>();
    headerRow.eachCell((cell, colNumber) => {
      let raw = cell.value;
      if (raw && typeof raw === "object") {
        raw = (raw as any).result || (raw as any).text || (raw as any).formula;
      }
      const val = String(raw || "").trim().toLowerCase();
      if (val) colIndexMap.set(val, colNumber);
    });

    const getVal = (row: ExcelJS.Row, keyPatterns: string[]): any => {
      for (const p of keyPatterns) {
        const idx = colIndexMap.get(p.toLowerCase());
        if (idx !== undefined) {
          const c = row.getCell(idx);
          if (c && c.value != null) {
            // handle formula cell
            if (typeof c.value === "object" && "result" in c.value) {
              return (c.value as any).result;
            }
            return c.value;
          }
        }
      }
      return null;
    };

    const numRows = worksheet.rowCount;
    for (let r = 2; r <= numRows; r++) {
      const row = worksheet.getRow(r);
      const portfolioVal = getVal(row, ["portfolio", "portfolio name", "state"]);
      if (!portfolioVal) continue;

      const portfolio = String(portfolioVal).trim();
      if (!portfolio) continue;

      const dateRaw = getVal(row, ["date", "ngày", "state"]) || fallbackDate;
      const cleanDate = cleanAdsDate(dateRaw) || fallbackDate;

      const spend = Number(getVal(row, ["spend(usd)", "spend", "chi phí"])) || 0;
      const sales = Number(getVal(row, ["sales(usd)", "sales", "doanh thu"])) || 0;
      const clicks = Number(getVal(row, ["clicks", "click"])) || 0;
      const impressions = Number(getVal(row, ["impressions", "impression"])) || 0;
      const orders = Number(getVal(row, ["orders", "order"])) || 0;
      const status = String(getVal(row, ["status", "trạng thái portfolio"]) || "PORTFOLIO_STATUS_ENABLED").trim();
      const budgetType = String(getVal(row, ["budget type", "loại budget"]) || "NO_CAP").trim();
      const budget = Number(getVal(row, ["budget(usd)", "budget"])) || 0;
      const budgetStart = String(getVal(row, ["budget start"]) || "").trim();
      const budgetEnd = String(getVal(row, ["budget end"]) || "").trim();
      const campaignCount = Number(getVal(row, ["campaign count"])) || 0;
      const ctr = Number(getVal(row, ["ctr"])) || (impressions > 0 ? clicks / impressions : 0);
      const cpc = Number(getVal(row, ["cpc(usd)", "cpc"])) || (clicks > 0 ? spend / clicks : 0);
      const acos = Number(getVal(row, ["acos"])) || (sales > 0 ? spend / sales : 0);
      const roas = Number(getVal(row, ["roas"])) || (spend > 0 ? sales / spend : 0);
      const ntbOrders = Number(getVal(row, ["ntb orders"])) || 0;
      const pctOrdersNtb = Number(getVal(row, ["% of orders ntb"])) || 0;
      const ntbSales = Number(getVal(row, ["ntb sales(usd)", "ntb sales"])) || 0;
      const pctSalesNtb = Number(getVal(row, ["% of sales ntb"])) || 0;
      const viewableImpressions = Number(getVal(row, ["viewable impressions"])) || 0;
      const vcpm = Number(getVal(row, ["vcpm(usd)", "vcpm"])) || 0;

      // Derived fields from sheet ADS
      let sku = String(getVal(row, ["sku"]) || "").trim();
      let loai = String(getVal(row, ["loại", "loai"]) || "").trim();
      let mktPic = String(getVal(row, ["mkt pic", "pic mkt", "pic"]) || "").trim();
      let trangThai = String(getVal(row, ["trạng thái", "trang thai"]) || "").trim();

      // Intelligent auto-detection if missing in row
      if (!sku) {
        // Try to match from known SKUs in this store
        for (const [knownSkuKey] of skuMap) {
          if (portfolio.toUpperCase().includes(knownSkuKey)) {
            sku = knownSkuKey;
            break;
          }
        }
        if (!sku) {
          // Extract last token of portfolio as SKU candidate
          const tokens = portfolio.split(/\s+/);
          const lastToken = tokens[tokens.length - 1];
          if (lastToken && /^[A-Z0-9-]+$/i.test(lastToken) && lastToken.length >= 4) {
            sku = lastToken;
          }
        }
      }

      const matchedMaster = sku ? skuMap.get(sku.toUpperCase()) : null;
      if (!loai) loai = matchedMaster?.loai || "FBA";
      if (!mktPic) {
        mktPic = matchedMaster?.pic_mkt || portfolio.split(/\s+/)[0] || "";
      }
      if (!trangThai) {
        trangThai = matchedMaster?.status || "Phát triển";
      }

      const { month, quarter } = getMonthAndQuarter(cleanDate);
      const tuan = Number(getVal(row, ["tuần", "tuan"])) || getIsoWeek(cleanDate);
      const thang = Number(getVal(row, ["tháng", "thang"])) || month;
      const quy = Number(getVal(row, ["quý", "quy"])) || quarter;
      const thue10 = Number(getVal(row, ["thuế 10%", "thue 10%"])) || Number((spend * 0.1).toFixed(3));

      results.push({
        store_id: storeId,
        date: cleanDate,
        portfolio,
        status,
        budget_type: budgetType,
        budget,
        budget_start: budgetStart,
        budget_end: budgetEnd,
        campaign_count: campaignCount,
        impressions,
        clicks,
        ctr,
        spend,
        cpc,
        orders,
        sales,
        acos,
        roas,
        ntb_orders: ntbOrders,
        pct_orders_ntb: pctOrdersNtb,
        ntb_sales: ntbSales,
        pct_sales_ntb: pctSalesNtb,
        viewable_impressions: viewableImpressions,
        vcpm,
        sku,
        loai,
        mkt_pic: mktPic,
        tuan,
        thang,
        quy,
        thue_10: thue10,
        trang_thai: trangThai,
      });
    }
  } else {
    // CSV / TSV handling
    const content = buffer.toString("utf-8").replace(/^\uFEFF/, "");
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return [];

    const delimiter = lines[0].includes("\t") ? "\t" : ",";
    const parseCsvLine = (line: string): string[] => {
      const row: string[] = [];
      let inQuotes = false;
      let current = "";
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === delimiter && !inQuotes) {
          row.push(current.trim().replace(/^"|"$/g, "").replace(/""/g, '"'));
          current = "";
        } else {
          current += char;
        }
      }
      row.push(current.trim().replace(/^"|"$/g, "").replace(/""/g, '"'));
      return row;
    };

    const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
    const getCol = (cells: string[], keyPatterns: string[]): string => {
      for (const p of keyPatterns) {
        const idx = headers.indexOf(p.toLowerCase());
        if (idx !== -1 && cells[idx] !== undefined) return cells[idx];
      }
      return "";
    };

    for (let i = 1; i < lines.length; i++) {
      const cells = parseCsvLine(lines[i]);
      if (cells.length < 2) continue;

      const portfolioVal = getCol(cells, ["portfolio", "portfolio name"]);
      if (!portfolioVal) continue;
      const portfolio = portfolioVal.trim();
      if (!portfolio) continue;

      const dateRaw = getCol(cells, ["date", "ngày"]) || fallbackDate;
      const cleanDate = cleanAdsDate(dateRaw) || fallbackDate;

      const spend = parseFloat(getCol(cells, ["spend(usd)", "spend", "chi phí"])) || 0;
      const sales = parseFloat(getCol(cells, ["sales(usd)", "sales", "doanh thu"])) || 0;
      const clicks = parseFloat(getCol(cells, ["clicks", "click"])) || 0;
      const impressions = parseFloat(getCol(cells, ["impressions", "impression"])) || 0;
      const orders = parseFloat(getCol(cells, ["orders", "order"])) || 0;
      const status = getCol(cells, ["status", "trạng thái portfolio"]).trim() || "PORTFOLIO_STATUS_ENABLED";
      const budgetType = getCol(cells, ["budget type", "loại budget"]).trim() || "NO_CAP";
      const budget = parseFloat(getCol(cells, ["budget(usd)", "budget"])) || 0;
      const budgetStart = getCol(cells, ["budget start"]).trim();
      const budgetEnd = getCol(cells, ["budget end"]).trim();
      const campaignCount = parseInt(getCol(cells, ["campaign count"]), 10) || 0;
      const ctr = parseFloat(getCol(cells, ["ctr"])) || (impressions > 0 ? clicks / impressions : 0);
      const cpc = parseFloat(getCol(cells, ["cpc(usd)", "cpc"])) || (clicks > 0 ? spend / clicks : 0);
      const acos = parseFloat(getCol(cells, ["acos"])) || (sales > 0 ? spend / sales : 0);
      const roas = parseFloat(getCol(cells, ["roas"])) || (spend > 0 ? sales / spend : 0);
      const ntbOrders = parseFloat(getCol(cells, ["ntb orders"])) || 0;
      const pctOrdersNtb = parseFloat(getCol(cells, ["% of orders ntb"])) || 0;
      const ntbSales = parseFloat(getCol(cells, ["ntb sales(usd)", "ntb sales"])) || 0;
      const pctSalesNtb = parseFloat(getCol(cells, ["% of sales ntb"])) || 0;
      const viewableImpressions = parseFloat(getCol(cells, ["viewable impressions"])) || 0;
      const vcpm = parseFloat(getCol(cells, ["vcpm(usd)", "vcpm"])) || 0;

      let sku = getCol(cells, ["sku"]).trim();
      let loai = getCol(cells, ["loại", "loai"]).trim();
      let mktPic = getCol(cells, ["mkt pic", "pic mkt", "pic"]).trim();
      let trangThai = getCol(cells, ["trạng thái", "trang thai"]).trim();

      if (!sku) {
        for (const [knownSkuKey] of skuMap) {
          if (portfolio.toUpperCase().includes(knownSkuKey)) {
            sku = knownSkuKey;
            break;
          }
        }
        if (!sku) {
          const tokens = portfolio.split(/\s+/);
          const lastToken = tokens[tokens.length - 1];
          if (lastToken && /^[A-Z0-9-]+$/i.test(lastToken) && lastToken.length >= 4) {
            sku = lastToken;
          }
        }
      }

      const matchedMaster = sku ? skuMap.get(sku.toUpperCase()) : null;
      if (!loai) loai = matchedMaster?.loai || "FBA";
      if (!mktPic) {
        mktPic = matchedMaster?.pic_mkt || portfolio.split(/\s+/)[0] || "";
      }
      if (!trangThai) {
        trangThai = matchedMaster?.status || "Phát triển";
      }

      const { month, quarter } = getMonthAndQuarter(cleanDate);
      const tuan = parseInt(getCol(cells, ["tuần", "tuan"]), 10) || getIsoWeek(cleanDate);
      const thang = parseInt(getCol(cells, ["tháng", "thang"]), 10) || month;
      const quy = parseInt(getCol(cells, ["quý", "quy"]), 10) || quarter;
      const thue10 = parseFloat(getCol(cells, ["thuế 10%", "thue 10%"])) || Number((spend * 0.1).toFixed(3));

      results.push({
        store_id: storeId,
        date: cleanDate,
        portfolio,
        status,
        budget_type: budgetType,
        budget,
        budget_start: budgetStart,
        budget_end: budgetEnd,
        campaign_count: campaignCount,
        impressions,
        clicks,
        ctr,
        spend,
        cpc,
        orders,
        sales,
        acos,
        roas,
        ntb_orders: ntbOrders,
        pct_orders_ntb: pctOrdersNtb,
        ntb_sales: ntbSales,
        pct_sales_ntb: pctSalesNtb,
        viewable_impressions: viewableImpressions,
        vcpm,
        sku,
        loai,
        mkt_pic: mktPic,
        tuan,
        thang,
        quy,
        thue_10: thue10,
        trang_thai: trangThai,
      });
    }
  }

  return results;
}

export async function batchUpsertAds(
  storeId: string,
  items: Array<Omit<AdsItem, "id" | "created_at" | "updated_at">>
): Promise<{ count: number; createdCount: number; updatedCount: number }> {
  if (items.length === 0) return { count: 0, createdCount: 0, updatedCount: 0 };

  const sql = await getDatabaseClient();

  // Deduplicate items on (store_id, date, portfolio)
  const dedupedMap = new Map<string, Omit<AdsItem, "id" | "created_at" | "updated_at">>();
  for (const item of items) {
    const key = `${item.date}::${item.portfolio.trim().toUpperCase()}`;
    dedupedMap.set(key, item);
  }
  const deduped = Array.from(dedupedMap.values());

  const CHUNK_SIZE = 500;
  let totalProcessed = 0;

  for (let i = 0; i < deduped.length; i += CHUNK_SIZE) {
    const chunk = deduped.slice(i, i + CHUNK_SIZE);

    const cols = [
      "store_id", "date", "portfolio", "status", "budget_type", "budget",
      "budget_start", "budget_end", "campaign_count", "impressions", "clicks",
      "ctr", "spend", "cpc", "orders", "sales", "acos", "roas",
      "ntb_orders", "pct_orders_ntb", "ntb_sales", "pct_sales_ntb",
      "viewable_impressions", "vcpm", "sku", "loai", "mkt_pic",
      "tuan", "thang", "quy", "thue_10", "trang_thai"
    ] as const;

    await sql`
      INSERT INTO accounting_ads ${sql(chunk, ...cols)}
      ON CONFLICT (store_id, date, portfolio) DO UPDATE SET
        status = EXCLUDED.status,
        budget_type = EXCLUDED.budget_type,
        budget = EXCLUDED.budget,
        budget_start = EXCLUDED.budget_start,
        budget_end = EXCLUDED.budget_end,
        campaign_count = EXCLUDED.campaign_count,
        impressions = EXCLUDED.impressions,
        clicks = EXCLUDED.clicks,
        ctr = EXCLUDED.ctr,
        spend = EXCLUDED.spend,
        cpc = EXCLUDED.cpc,
        orders = EXCLUDED.orders,
        sales = EXCLUDED.sales,
        acos = EXCLUDED.acos,
        roas = EXCLUDED.roas,
        ntb_orders = EXCLUDED.ntb_orders,
        pct_orders_ntb = EXCLUDED.pct_orders_ntb,
        ntb_sales = EXCLUDED.ntb_sales,
        pct_sales_ntb = EXCLUDED.pct_sales_ntb,
        viewable_impressions = EXCLUDED.viewable_impressions,
        vcpm = EXCLUDED.vcpm,
        sku = CASE WHEN EXCLUDED.sku != '' THEN EXCLUDED.sku ELSE accounting_ads.sku END,
        loai = CASE WHEN EXCLUDED.loai != '' THEN EXCLUDED.loai ELSE accounting_ads.loai END,
        mkt_pic = CASE WHEN EXCLUDED.mkt_pic != '' THEN EXCLUDED.mkt_pic ELSE accounting_ads.mkt_pic END,
        tuan = EXCLUDED.tuan,
        thang = EXCLUDED.thang,
        quy = EXCLUDED.quy,
        thue_10 = EXCLUDED.thue_10,
        trang_thai = CASE WHEN EXCLUDED.trang_thai != '' THEN EXCLUDED.trang_thai ELSE accounting_ads.trang_thai END,
        updated_at = NOW()
    `;

    totalProcessed += chunk.length;
  }

  return {
    count: totalProcessed,
    createdCount: totalProcessed,
    updatedCount: 0,
  };
}

export async function updateAdsCell(
  storeId: string,
  id: string,
  field: string,
  value: any
): Promise<void> {
  const sql = await getDatabaseClient();
  const allowedFields = [
    "sku", "loai", "mkt_pic", "trang_thai", "status", "budget_type",
    "budget", "spend", "sales", "clicks", "orders", "thue_10", "tuan", "thang", "quy",
  ];

  if (!allowedFields.includes(field)) {
    throw new Error(`Field '${field}' is not allowed to be updated directly.`);
  }

  let finalVal = value;
  if (["budget", "spend", "sales", "clicks", "orders", "thue_10"].includes(field)) {
    finalVal = value == null || value === "" ? 0 : parseFloat(value) || 0;
  } else if (["tuan", "thang", "quy"].includes(field)) {
    finalVal = value == null || value === "" ? 0 : parseInt(value, 10) || 0;
  }

  await sql`
    UPDATE accounting_ads
    SET ${sql(field)} = ${finalVal}, updated_at = NOW()
    WHERE id = ${id} AND store_id = ${storeId}
  `;
}

export async function deleteAds(storeId: string, id: string): Promise<void> {
  const sql = await getDatabaseClient();
  await sql`
    DELETE FROM accounting_ads
    WHERE id = ${id} AND store_id = ${storeId}
  `;
}

export async function deleteAdsBatch(storeId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const sql = await getDatabaseClient();
  const res = await sql`
    DELETE FROM accounting_ads
    WHERE store_id = ${storeId} AND id IN ${sql(ids)}
  `;
  return res.count || ids.length;
}
