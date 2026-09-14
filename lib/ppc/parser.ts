import ExcelJS from "exceljs";
import type { MatchType, PpcSearchTermRow } from "./types";

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

/**
 * Đọc file Excel Search Term (.xlsx buffer) và chuẩn hóa thành danh sách PpcSearchTermRow
 */
export async function parseSearchTermWorkbook(
  buffer: Buffer,
  storeName = "Store"
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

    const dateCol = findCol(["date", "report date"]);
    const portfolioCol = findCol(["portfolio name", "portfolio"]);
    const campaignCol = findCol(["campaign name", "campaign"]);
    const adGroupCol = findCol(["ad group name", "ad group"]);
    const targetCol = findCol(["targeting", "keyword", "keyword text"]);
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

    if (!campaignCol || !termCol) {
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
      const targetKeyword = targetCol ? cellText(getVal(targetCol)).trim() || searchTerm : searchTerm;
      const rawMatchType = matchTypeCol ? cellText(getVal(matchTypeCol)).trim() || "Auto" : "Auto";

      let matchType: MatchType = "Auto";
      const upperMatch = rawMatchType.toUpperCase();
      if (upperMatch.includes("EXACT")) matchType = "Exact";
      else if (upperMatch.includes("PHRASE")) matchType = "Phrase";
      else if (upperMatch.includes("BROAD")) matchType = "Broad";
      else if (upperMatch.includes("TARGET")) matchType = "Targeting";

      const impressions = parseInteger(getVal(impressionsCol));
      const clicks = parseInteger(getVal(clicksCol));
      const spend = Math.round(parseNumber(getVal(spendCol)) * 100) / 100;
      const sales = Math.round(parseNumber(getVal(salesCol)) * 100) / 100;
      const orders = parseInteger(getVal(ordersCol));
      const units = parseInteger(getVal(unitsCol));
      if ([impressions, clicks, spend, sales, orders, units].some((value) => value < 0)) {
        throw new Error(`Sheet "${worksheet.name}" dòng ${rowNumber} có số liệu âm không hợp lệ.`);
      }

      // SỬA LỖI LOGIC:
      // CTR chuẩn = clicks / impressions
      const ctr = impressions > 0 ? clicks / impressions : 0;
      // CVR chuẩn = orders / clicks
      const cvr = clicks > 0 ? orders / clicks : 0;
      // CPC = spend / clicks
      const cpc = clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0;
      // ACOS chuẩn = spend / sales * 100
      const acos = sales > 0 ? Math.round((spend / sales) * 1000) / 10 : spend > 0 ? 999.0 : 0;
      // ROAS = sales / spend
      const roas = spend > 0 ? Math.round((sales / spend) * 100) / 100 : 0;

      const reportDate = dateCol ? reportDateString(getVal(dateCol)) : new Date().toISOString().slice(0, 10);

      results.push({
        storeName,
        reportDate,
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
        cpc,
        ctr: Math.round(ctr * 10000) / 10000,
        cvr: Math.round(cvr * 10000) / 10000,
        acos,
        roas,
      });
    });
  });

  const unique = new Map<string, PpcSearchTermRow>();
  for (const row of results) {
    const key = [
      row.storeName, row.reportDate, row.portfolioName, row.campaignName,
      row.adGroupName, row.targetKeyword, row.customerSearchTerm, row.matchType,
    ].join("\u0000");
    unique.set(key, row);
  }
  return Array.from(unique.values());
}
