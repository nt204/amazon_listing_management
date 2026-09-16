import ExcelJS from "exceljs";
import type {
  MatchType,
  PpcAdType,
  PpcPerformanceGrain,
  PpcPerformanceRow,
  PpcReportGranularity,
  PpcSearchTermRow,
} from "./types";

function normalizeHeader(str: string): string {
  return str.trim().toLowerCase().replace(/[–—]/g, "-").replace(/[\s_]+/g, " ");
}

function parseNumber(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  if (typeof val === "object") {
    const structured = val as { result?: unknown; text?: string; richText?: Array<{ text?: string }> };
    if (structured.result !== undefined) return parseNumber(structured.result);
    if (structured.text !== undefined) return parseNumber(structured.text);
    if (structured.richText) return parseNumber(structured.richText.map((part) => part.text || "").join(""));
  }
  const original = String(val).trim();
  const negative = /^\(.*\)$/.test(original);
  const clean = original.replace(/[$,%(),\s]/g, "");
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : negative ? -num : num;
}

function parseInteger(val: unknown): number {
  return Math.round(parseNumber(val));
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object" || value instanceof Date) return String(value);
  const structured = value as { result?: unknown; text?: string; richText?: Array<{ text?: string }> };
  if (structured.result !== undefined) return cellText(structured.result);
  if (structured.text !== undefined) return structured.text;
  if (structured.richText) return structured.richText.map((part) => part.text || "").join("");
  return "";
}

function reportDateString(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && value > 0) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return new Date(excelEpoch + Math.floor(value) * 86_400_000).toISOString().slice(0, 10);
  }
  const text = cellText(value).trim();
  if (!text) return new Date().toISOString().slice(0, 10);
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  throw new Error(`Ngày báo cáo không hợp lệ: ${text}`);
}

function cleanAmazonId(value: unknown): string {
  return cellText(value).trim().replace(/^="(.*)"$/, "$1");
}

function matchTypeValue(value: unknown): MatchType {
  const upperMatch = cellText(value).trim().toUpperCase();
  if (upperMatch.includes("EXACT")) return "Exact";
  if (upperMatch.includes("PHRASE")) return "Phrase";
  if (upperMatch.includes("BROAD")) return "Broad";
  if (upperMatch.includes("AUTO")) return "Auto";
  if (upperMatch.includes("TARGET")) return "Targeting";
  return "Unknown";
}

function calculateMetrics(input: {
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
}) {
  const { impressions, clicks, spend, sales, orders } = input;
  return {
    cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
    ctr: impressions > 0 ? Math.round((clicks / impressions) * 1_000_000) / 1_000_000 : 0,
    cvr: clicks > 0 ? Math.round((orders / clicks) * 1_000_000) / 1_000_000 : 0,
    acos: sales > 0 ? Math.round((spend / sales) * 1000) / 10 : spend > 0 ? 999 : 0,
    roas: spend > 0 ? Math.round((sales / spend) * 10_000) / 10_000 : 0,
  };
}

function deduplicateRows(rows: PpcSearchTermRow[]): PpcSearchTermRow[] {
  const unique = new Map<string, PpcSearchTermRow>();
  for (const row of rows) {
    const key = [
      row.storeName, row.reportDate, row.portfolioName, row.campaignName,
      row.adGroupName, row.targetKeyword, row.customerSearchTerm, row.matchType,
    ].join("\u0000");
    unique.set(key, row);
  }
  return Array.from(unique.values());
}

/**
 * Đọc file Excel Search Term (.xlsx buffer) và chuẩn hóa thành danh sách PpcSearchTermRow
 */
export async function parseSearchTermWorkbook(
  buffer: Buffer,
  storeName = "Store",
  adType: PpcAdType = "UNKNOWN",
): Promise<PpcSearchTermRow[]> {
  const workbook = new ExcelJS.Workbook();
  // @ts-expect-error - ExcelJS accepts Buffer directly in load
  await workbook.xlsx.load(buffer);

  const results: PpcSearchTermRow[] = [];

  // Duyệt qua tất cả các worksheet (SP, SB, Tong Hop)
  workbook.eachSheet((worksheet) => {
    let headerRowNumber = 0;
    for (let rowNumber = 1; rowNumber <= Math.min(20, worksheet.rowCount); rowNumber += 1) {
      const rowValues = worksheet.getRow(rowNumber).values;
      const values = Array.isArray(rowValues) ? rowValues : Object.values(rowValues);
      const headers = values
        .map((value) => normalizeHeader(cellText(value)))
        .filter(Boolean);
      if (
        headers.some((header) => header.includes("campaign")) &&
        headers.some((header) => header.includes("search term"))
      ) {
        headerRowNumber = rowNumber;
        break;
      }
    }
    if (!headerRowNumber) return;

    const headerRow = worksheet.getRow(headerRowNumber);
    const colIndexMap = new Map<string, number>();

    headerRow.eachCell((cell, colNumber) => {
      const val = cellText(cell.value);
      colIndexMap.set(normalizeHeader(val), colNumber);
    });

    const findCol = (possibleNames: string[]): number | undefined => {
      for (const name of possibleNames) {
        const norm = normalizeHeader(name);
        for (const [header, idx] of colIndexMap.entries()) {
          if (header === norm || header.includes(norm)) {
            return idx;
          }
        }
      }
      return undefined;
    };

    const findExactCol = (possibleNames: string[]): number | undefined => {
      for (const name of possibleNames) {
        const found = colIndexMap.get(normalizeHeader(name));
        if (found !== undefined) return found;
      }
      return undefined;
    };

    const dateCol = findCol(["date", "report date"]);
    const portfolioCol = findCol(["portfolio name", "portfolio"]);
    const campaignCol = findCol(["campaign name", "campaign"]);
    const adGroupCol = findCol(["ad group name", "ad group"]);
    // Exact header matching prevents "Keyword ID" from being mistaken for the
    // target keyword text when an export does not include a keyword column.
    const targetCol = findExactCol(["targeting", "targeting expression", "keyword text", "keyword"]);
    const termCol = findCol(["customer search term", "search term"]);
    const matchTypeCol = findCol(["match type"]);
    const impressionsCol = findCol(["impressions"]);
    const clicksCol = findCol(["clicks"]);
    const spendCol = findCol(["spend", "cost"]);
    const salesCol = findCol([
      "14 day total sales",
      "14-day total sales",
      "7 day total sales",
      "total sales",
      "sales",
    ]);
    const ordersCol = findCol([
      "14 day total orders",
      "14-day total orders",
      "7 day total orders",
      "orders",
    ]);
    const unitsCol = findCol([
      "14 day total units",
      "14-day total units",
      "7 day total units",
      "units",
    ]);

    if (!campaignCol || !termCol || !dateCol) {
      // Không phải sheet Search Term hợp lệ, bỏ qua
      return;
    }

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRowNumber) return;

      const getVal = (colIdx?: number) => (colIdx ? row.getCell(colIdx).value : null);

      const campaignName = cellText(getVal(campaignCol)).trim();
      const searchTerm = cellText(getVal(termCol)).trim();

      // Bỏ qua dòng trống hoặc dòng tổng cộng (Total)
      if (!campaignName || !searchTerm || searchTerm.toLowerCase() === "total") return;

      const portfolioName = portfolioCol ? cellText(getVal(portfolioCol)).trim() || "Unassigned" : "Unassigned";
      const adGroupName = adGroupCol ? cellText(getVal(adGroupCol)).trim() : "";
      const targetKeyword = targetCol ? cellText(getVal(targetCol)).trim() : "";
      const rawMatchType = matchTypeCol ? cellText(getVal(matchTypeCol)).trim() : "";

      const matchType = matchTypeValue(rawMatchType);

      const impressions = parseInteger(getVal(impressionsCol));
      const clicks = parseInteger(getVal(clicksCol));
      const spend = Math.round(parseNumber(getVal(spendCol)) * 100) / 100;
      const sales = Math.round(parseNumber(getVal(salesCol)) * 100) / 100;
      const orders = parseInteger(getVal(ordersCol));
      const units = parseInteger(getVal(unitsCol));
      if ([impressions, clicks, spend, sales, orders, units].some((value) => value < 0)) {
        throw new Error(`Sheet "${worksheet.name}" dòng ${rowNumber} có số liệu âm không hợp lệ.`);
      }

      const metrics = calculateMetrics({ impressions, clicks, spend, sales, orders });

      const reportDate = reportDateString(getVal(dateCol));

      results.push({
        storeName,
        reportDate,
        reportStartDate: reportDate,
        reportEndDate: reportDate,
        reportGranularity: "DAILY",
        adType,
        portfolioName,
        campaignName,
        adGroupName,
        targetKeyword,
        customerSearchTerm: searchTerm,
        matchType,
        impressions,
        clicks,
        spend,
        sales,
        orders,
        units,
        cpc: metrics.cpc,
        ctr: metrics.ctr,
        cvr: metrics.cvr,
        acos: metrics.acos,
        roas: metrics.roas,
        campaignId: cleanAmazonId(getVal(findCol(["campaign id"]))),
        adGroupId: cleanAmazonId(getVal(findCol(["ad group id"]))),
        keywordId: cleanAmazonId(getVal(findCol(["keyword id", "target id"]))),
      });
    });
  });

  return deduplicateRows(results);
}


function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n") {
      record.push(field.replace(/\r$/, ""));
      records.push(record);
      record = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || record.length) {
    record.push(field.replace(/\r$/, ""));
    records.push(record);
  }
  return records;
}

function parseEnglishDate(value: string): string {
  const cleaned = value.trim();
  const iso = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const numeric = cleaned.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (numeric) return `${numeric[3]}-${numeric[1].padStart(2, "0")}-${numeric[2].padStart(2, "0")}`;
  const named = cleaned.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})$/);
  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  if (named) {
    const month = months[named[1].slice(0, 3).toLowerCase()];
    if (month) return `${named[3]}-${month}-${named[2].padStart(2, "0")}`;
  }
  throw new Error(`Ngày báo cáo không hợp lệ: ${value}`);
}

function parseDateRange(value: string): { start: string; end: string } {
  const parts = value.split(/\s+-\s+/);
  if (parts.length === 2) return { start: parseEnglishDate(parts[0]), end: parseEnglishDate(parts[1]) };
  const date = parseEnglishDate(value);
  return { start: date, end: date };
}

/** Đọc CSV Search Term xuất trực tiếp từ Amazon Ads. */
export function parseSearchTermCsv(
  buffer: Buffer,
  storeName = "Store",
  adType: PpcAdType = "UNKNOWN",
): PpcSearchTermRow[] {
  const records = parseCsvRecords(buffer.toString("utf8").replace(/^\uFEFF/, ""));
  if (records.length < 2) return [];
  const headers = records[0].map(normalizeHeader);
  const exactIndex = (names: string[]) => {
    for (const name of names) {
      const index = headers.indexOf(normalizeHeader(name));
      if (index >= 0) return index;
    }
    return -1;
  };
  const indexes = {
    date: exactIndex(["date range", "date", "report date"]),
    account: exactIndex(["advertiser account name", "account name"]),
    portfolio: exactIndex(["portfolio name", "portfolio"]),
    campaign: exactIndex(["campaign name", "campaign"]),
    adGroup: exactIndex(["ad group name", "ad group"]),
    target: exactIndex(["targeting", "keyword text", "keyword"]),
    term: exactIndex(["search term", "customer search term"]),
    matchType: exactIndex(["match type"]),
    impressions: exactIndex(["impressions"]),
    clicks: exactIndex(["clicks"]),
    spend: exactIndex(["total cost", "spend", "cost"]),
    sales: exactIndex(["sales", "14 day total sales", "7 day total sales"]),
    orders: exactIndex(["purchases", "orders", "14 day total orders", "7 day total orders"]),
    units: exactIndex(["units sold", "units", "14 day total units", "7 day total units"]),
    campaignId: exactIndex(["campaign id"]),
    adGroupId: exactIndex(["ad group id"]),
    keywordId: exactIndex(["keyword id", "target id"]),
  };
  if (indexes.campaign < 0 || indexes.term < 0 || indexes.date < 0) {
    throw new Error("CSV không có đủ cột Date range, Campaign name và Search term.");
  }

  const parsed: Array<PpcSearchTermRow & { rowStart: string; rowEnd: string }> = [];
  const get = (record: string[], index: number) => index >= 0 ? (record[index] || "").trim() : "";
  for (const record of records.slice(1)) {
    const campaignName = get(record, indexes.campaign);
    const customerSearchTerm = get(record, indexes.term);
    if (!campaignName || !customerSearchTerm || customerSearchTerm.toLowerCase() === "total") continue;
    const accountName = get(record, indexes.account);
    const rowStoreName = accountName || storeName;
    const range = parseDateRange(get(record, indexes.date));
    const impressions = parseInteger(get(record, indexes.impressions));
    const clicks = parseInteger(get(record, indexes.clicks));
    const spend = Math.round(parseNumber(get(record, indexes.spend)) * 100) / 100;
    const sales = Math.round(parseNumber(get(record, indexes.sales)) * 100) / 100;
    const orders = parseInteger(get(record, indexes.orders));
    const units = parseInteger(get(record, indexes.units));
    if ([impressions, clicks, spend, sales, orders, units].some((value) => value < 0)) {
      throw new Error("CSV có số liệu âm không hợp lệ.");
    }
    const metrics = calculateMetrics({ impressions, clicks, spend, sales, orders });
    parsed.push({
      storeName: rowStoreName,
      reportDate: range.end,
      reportStartDate: range.start,
      reportEndDate: range.end,
      reportGranularity: "RANGE",
      adType,
      rowStart: range.start,
      rowEnd: range.end,
      portfolioName: get(record, indexes.portfolio) || "Unassigned",
      campaignName,
      adGroupName: get(record, indexes.adGroup),
      targetKeyword: get(record, indexes.target),
      customerSearchTerm,
      matchType: matchTypeValue(get(record, indexes.matchType)),
      impressions, clicks, spend, sales, orders, units,
      ...metrics,
      campaignId: cleanAmazonId(get(record, indexes.campaignId)),
      adGroupId: cleanAmazonId(get(record, indexes.adGroupId)),
      keywordId: cleanAmazonId(get(record, indexes.keywordId)),
    });
  }
  if (!parsed.length) return [];
  const globalStart = parsed.reduce((min, row) => row.rowStart < min ? row.rowStart : min, parsed[0].rowStart);
  const globalEnd = parsed.reduce((max, row) => row.rowEnd > max ? row.rowEnd : max, parsed[0].rowEnd);
  return deduplicateRows(parsed.map(({ rowStart, rowEnd, ...row }) => {
    void rowStart;
    void rowEnd;
    return {
      ...row,
      reportDate: globalEnd,
      reportStartDate: globalStart,
      reportEndDate: globalEnd,
    };
  }));
}

export interface PpcReportCoverage {
  snapshotDate: string;
  reportStartDate: string;
  reportEndDate: string;
  reportGranularity: PpcReportGranularity;
}

function isoDateFromReference(reference: string): string | null {
  const matches = Array.from(reference.matchAll(/(?:^|\D)(20\d{2})[-_]?([01]\d)[-_]?([0-3]\d)(?:\D|$)/g));
  const match = matches.at(-1);
  if (!match) return null;
  const value = `${match[1]}-${match[2]}-${match[3]}`;
  return Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()) ? null : value;
}

export function inferPpcReportCoverage(
  reference: string,
  options: { days?: number; endDate?: string } = {},
): PpcReportCoverage {
  const rangeMatch = reference.match(/(?:^|\D)(20\d{2})([01]\d)([0-3]\d)-(20\d{2})([01]\d)([0-3]\d)(?:\D|$)/);
  if (rangeMatch && !options.endDate) {
    const startIso = `${rangeMatch[1]}-${rangeMatch[2]}-${rangeMatch[3]}`;
    const endIso = `${rangeMatch[4]}-${rangeMatch[5]}-${rangeMatch[6]}`;
    return {
      snapshotDate: endIso,
      reportStartDate: startIso,
      reportEndDate: endIso,
      reportGranularity: "RANGE",
    };
  }

  const endDate = options.endDate || isoDateFromReference(reference) || new Date().toISOString().slice(0, 10);
  const daysMatch = reference.match(/(?:^|[^0-9])(7|14|30|60|90)\s*(?:day|days|ngay|ngày)(?:[^a-z]|$)/i);
  const days = options.days || (daysMatch ? Number(daysMatch[1]) : 30);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(end.getTime()) || !Number.isInteger(days) || days < 1 || days > 3650) {
    throw new Error("Phạm vi ngày của báo cáo PPC không hợp lệ.");
  }
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return {
    snapshotDate: end.toISOString().slice(0, 10),
    reportStartDate: start.toISOString().slice(0, 10),
    reportEndDate: end.toISOString().slice(0, 10),
    reportGranularity: "RANGE",
  };
}

function bulkAdType(product: string, sheetName: string, hint: PpcAdType): PpcAdType {
  const value = `${product} ${sheetName}`.toLowerCase();
  if (value.includes("sponsored products") || /\bsp\b/.test(value)) return "SP";
  if (value.includes("sponsored brands") || /\bsb\b/.test(value)) return "SB";
  if (value.includes("sponsored display") || /\bsd\b/.test(value)) return "SD";
  return hint;
}

function bulkGrain(entity: string): PpcPerformanceGrain | null {
  const value = entity.trim().toLowerCase();
  if (value === "campaign") return "CAMPAIGN";
  if (value === "ad group" || value === "adgroup") return "AD_GROUP";
  if (value.includes("bidding adjustment") || value.includes("placement")) return "PLACEMENT";
  if (value === "product ad" || value === "ad" || value.includes("product ad")) return "PRODUCT";
  if (
    value === "keyword" || value === "product targeting" || value === "target" || value === "auto targeting" ||
    value.includes("negative keyword") || value.includes("negative product targeting")
  ) {
    return "TARGET";
  }
  return null;
}

/** Parse Bulk Operations without ever summing across different entity grains. */
export async function parseBulkWorkbook(
  buffer: Buffer,
  storeName = "Store",
  options: PpcReportCoverage & { adType?: PpcAdType },
): Promise<PpcPerformanceRow[]> {
  const workbook = new ExcelJS.Workbook();
  // @ts-expect-error ExcelJS accepts Buffer directly in load.
  await workbook.xlsx.load(buffer);
  const parsed: PpcPerformanceRow[] = [];

  workbook.eachSheet((worksheet) => {
    let headerRowNumber = 0;
    for (let rowNumber = 1; rowNumber <= Math.min(20, worksheet.rowCount); rowNumber += 1) {
      const rawValues = worksheet.getRow(rowNumber).values;
      const headers = (Array.isArray(rawValues) ? rawValues : Object.values(rawValues))
        .map((value) => normalizeHeader(cellText(value)));
      if (headers.includes("entity") && headers.some((header) => header.includes("campaign id"))) {
        headerRowNumber = rowNumber;
        break;
      }
    }
    if (!headerRowNumber) return;

    const columns = new Map<string, number>();
    worksheet.getRow(headerRowNumber).eachCell((cell, columnNumber) => {
      columns.set(normalizeHeader(cellText(cell.value)), columnNumber);
    });
    const column = (...names: string[]): number | undefined => {
      for (const name of names) {
        const found = columns.get(normalizeHeader(name));
        if (found !== undefined) return found;
      }
      return undefined;
    };

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRowNumber) return;
      const value = (...names: string[]) => {
        const index = column(...names);
        return index ? row.getCell(index).value : null;
      };
      const entity = cellText(value("Entity")).trim();
      const grain = bulkGrain(entity);
      if (!grain) return;

      const campaignId = cleanAmazonId(value("Campaign ID"));
      const adGroupId = cleanAmazonId(value("Ad Group ID"));
      const keywordId = cleanAmazonId(value("Keyword ID"));
      const productTargetingId = cleanAmazonId(value("Product Targeting ID", "Targeting ID", "Target ID"));
      const adId = cleanAmazonId(value("Ad ID", "Product Ad ID"));
      const placement = cellText(value("Placement", "Bidding Adjustment Placement")).trim();
      const targetExpression = cellText(value(
        "Keyword Text",
        "Product Targeting Expression",
        "Targeting Expression",
        "Resolved Product Targeting Expression (Informational only)",
      )).trim();
      const entityId = grain === "CAMPAIGN"
        ? campaignId
        : grain === "AD_GROUP"
          ? adGroupId
          : grain === "TARGET"
            ? keywordId || productTargetingId
            : grain === "PRODUCT"
              ? adId
              : `${campaignId}:${placement}`;
      if (!entityId && !campaignId) return;

      const impressions = parseInteger(value("Impressions"));
      const clicks = parseInteger(value("Clicks"));
      const spend = Math.round(parseNumber(value("Spend", "Cost", "Total cost")) * 100) / 100;
      const sales = Math.round(parseNumber(value("Sales", "14 Day Total Sales", "14-day Total Sales")) * 100) / 100;
      const orders = parseInteger(value("Orders", "14 Day Total Orders", "14-day Total Orders"));
      const units = parseInteger(value("Units", "14 Day Total Units", "14-day Total Units"));
      if ([impressions, clicks, spend, sales, orders, units].some((metric) => metric < 0)) {
        throw new Error(`Sheet "${worksheet.name}" dòng ${rowNumber} có số liệu âm không hợp lệ.`);
      }

      const product = cellText(value("Product")).trim();
      parsed.push({
        storeName,
        snapshotDate: options.snapshotDate,
        reportStartDate: options.reportStartDate,
        reportEndDate: options.reportEndDate,
        reportGranularity: options.reportGranularity,
        adType: bulkAdType(product, worksheet.name, options.adType || "UNKNOWN"),
        grain,
        entityId: entityId || `${grain}:${campaignId}:${adGroupId}:${targetExpression}:${placement}`,
        campaignId,
        campaignName: cellText(value("Campaign Name (Informational only)", "Campaign Name")).trim(),
        adGroupId,
        adGroupName: cellText(value("Ad Group Name (Informational only)", "Ad Group Name")).trim(),
        targetId: keywordId || productTargetingId,
        targetExpression,
        matchType: matchTypeValue(value("Match Type", "Keyword Match Type", "Auto Match Type")),
        portfolioName: cellText(value("Portfolio Name (Informational only)", "Portfolio Name")).trim(),
        sku: cellText(value("SKU", "Retailer Offer ID")).trim(),
        asin: cellText(value("ASIN (Informational only)", "ASIN")).trim(),
        state: cellText(value("State")).trim(),
        campaignState: cellText(value("Campaign State (Informational only)")).trim(),
        adGroupState: cellText(value("Ad Group State (Informational only)")).trim(),
        targetingType: cellText(value("Targeting Type", "Target Type")).trim(),
        biddingStrategy: cellText(value("Bidding Strategy", "Bid Optimization")).trim(),
        placement,
        dailyBudget: parseNumber(value("Daily Budget", "Budget")),
        bid: parseNumber(value("Bid", "Ad Group Default Bid")),
        placementAdjustment: parseNumber(value("Percentage", "Bid Multiplier", "Bidding Adjustment Percentage")),
        isNegative: /negative/i.test(entity),
        impressions,
        clicks,
        spend,
        sales,
        orders,
        units,
      });
    });
  });

  const unique = new Map<string, PpcPerformanceRow>();
  for (const row of parsed) {
    const key = [row.adType, row.grain, row.entityId, row.sku, row.placement].join("\u0000");
    unique.set(key, row);
  }
  return Array.from(unique.values());
}

/** Large Amazon workbooks are streamed through openpyxl to avoid inflating XML in V8. */
export async function parseLargeBulkWorkbook(
  buffer: Buffer,
  storeName: string,
  options: PpcReportCoverage & { adType?: PpcAdType },
): Promise<PpcPerformanceRow[]> {
  const [{ spawn }, readline, fs, os, path] = await Promise.all([
    import("node:child_process"),
    import("node:readline"),
    import("node:fs/promises"),
    import("node:os"),
    import("node:path"),
  ]);
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "ppc-bulk-"));
  const workbookPath = path.join(tempDirectory, "report.xlsx");
  const scriptPath = path.join(process.cwd(), "scripts", "parse_amazon_bulk.py");
  await fs.writeFile(workbookPath, buffer);
  try {
    return await new Promise<PpcPerformanceRow[]>((resolve, reject) => {
      const rows: PpcPerformanceRow[] = [];
      let stderr = "";
      const child = spawn("python3", [
        scriptPath,
        workbookPath,
        storeName,
        options.snapshotDate,
        options.reportStartDate,
        options.reportEndDate,
        options.reportGranularity,
        options.adType || "UNKNOWN",
      ], { stdio: ["ignore", "pipe", "pipe"] });

      const rl = readline.createInterface({
        input: child.stdout,
        crlfDelay: Infinity,
      });

      rl.on("line", (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          rows.push(JSON.parse(trimmed) as PpcPerformanceRow);
        } catch {
          // ignore corrupted lines
        }
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        if (stderr.length < 8_000) stderr += chunk;
      });

      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) return reject(new Error(stderr.trim() || `Bulk parser exited with code ${code}.`));
        resolve(rows);
      });
    });
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
}
