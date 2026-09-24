/**
 * PPC SKU, Product, Date and Filename Extractor & Formatter
 *
 * Example input:
 * "Quynh test 20th Anniversary Blanket BHL180620A01 Campaign File SP 30 day.xlsx Sep 14, 2026 2:54 PM"
 * -> SKU: "BHL180620A01"
 * -> Product Type: "Blanket"
 * -> Title: "Quynh test 20th Anniversary Blanket"
 * -> Ad Type: "SP"
 * -> Time Range: "30 day"
 * -> Output Filename: "Quynh test 20th Anniversary Blanket BHL180620A01 Campaign File SP 30 day.xlsx"
 */

// Common product types mapped to keywords and SKU prefixes
const PRODUCT_TYPE_PATTERNS: Array<{ type: string; test: RegExp }> = [
  { type: "Glass Ornament", test: /\b(glass ornament|ornament|ornaments)\b|^(GO|GODL|GOL|GOQL)/i },
  { type: "Blanket", test: /\b(blanket|quilt|chăn)\b|^(BH|BHL|BD|BKL|BQL)/i },
  { type: "Blanket Hoodie", test: /\b(blanket hoodie|hoodie blanket|hooded blanket|oodie)\b|^(CBH|OHN|OC|OD)/i },
  { type: "Poncho", test: /\b(poncho)\b|^(PC)/i },
  { type: "Tumbler", test: /\b(tumbler|cup|mug)\b|^(TB|MG)/i },
  { type: "T-Shirt / Hoodie", test: /\b(shirt|tshirt|tee|hoodie|sweatshirt)\b|^(TS|HD)/i },
  { type: "Plaque / Sign", test: /\b(plaque|sign|decor)\b|^(PQ|SN)/i },
];

/**
 * Extracts standard Amazon seller SKU from a string.
 * Example patterns: BHL180620A01, BD270226HB90TH, OD270226PB, PC170820241MFBA, GOL1006YG01, GODL1905M01
 */
export function extractSkuFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const cleaned = text.trim();

  // Pattern 1: Standalone SKU token with letters + numbers (e.g. BHL180620A01, BD270226HB90TH, GODL1905M01)
  const m1 = cleaned.match(/\b([A-Z]{2,5}\d{4,8}[A-Z0-9]*)\b/i);
  if (m1) return m1[1].toUpperCase();

  // Pattern 2: Fallback for shorter codes like OD270226C, OHN200225MB, CBH100103W
  const m2 = cleaned.match(/\b([A-Z]{2,4}\d{4,6}[A-Z0-9]{1,4})\b/i);
  if (m2) return m2[1].toUpperCase();

  return null;
}

/**
 * Extracts campaign creation/launch date as integer YYYYMMDD for accurate chronological sorting.
 * Examples:
 * - "OD240902WFTYTH SB05 VIDEO Quynh Phrase 20260415 P5" -> 20260415
 * - "OHN200225MB SP03 Quynh Phrase 250902 3KW" -> 20250902
 * - "OD240905WFTYTH SB01 Quynh Phrase 100226" -> 20240905 / 20260210
 */
export function extractCampaignDate(name: string | null | undefined, now = new Date()): number {
  if (!name) return 0;
  // 1. Look for explicit 8-digit date YYYYMMDD (2023xxxx - 2029xxxx)
  const m8 = name.match(/\b(202[3-9][0-1][0-9][0-3][0-9])\b/);
  if (m8) return parseInt(m8[1], 10);

  // 2. Campaign operators use both YYMMDD and DDMMYY. When both are valid,
  // choose the date closest to today and reject implausibly distant futures.
  const matches = Array.from(name.matchAll(/\b(2[3-9][0-1][0-9][0-3][0-9])\b/g));
  if (matches.length > 0) {
    const parsed = parseAmbiguousSixDigitDate(matches[matches.length - 1][1], now);
    if (parsed) return parsed;
  }

  // 3. Look for 6-digit date in SKU prefix (e.g. OD240905 -> 20240905)
  const mSku = name.match(/^[A-Z]{2,5}(2[3-9][0-1][0-9][0-3][0-9])/);
  if (mSku) return parseInt(`20${mSku[1]}`, 10);

  return 0;
}

function parseAmbiguousSixDigitDate(value: string, now = new Date()): number {
  const candidates: Date[] = [];
  const yy = Number(value.slice(0, 2));
  const mm = Number(value.slice(2, 4));
  const dd = Number(value.slice(4, 6));
  const dmyDay = Number(value.slice(0, 2));
  const dmyMonth = Number(value.slice(2, 4));
  const dmyYear = Number(value.slice(4, 6));

  const addCandidate = (year: number, month: number, day: number) => {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      const latestReasonable = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 180));
      if (date <= latestReasonable) candidates.push(date);
    }
  };

  addCandidate(2000 + yy, mm, dd);
  addCandidate(2000 + dmyYear, dmyMonth, dmyDay);
  if (candidates.length === 0) return 0;
  candidates.sort((a, b) => Math.abs(a.getTime() - now.getTime()) - Math.abs(b.getTime() - now.getTime()));
  const best = candidates[0];
  return best.getUTCFullYear() * 10000 + (best.getUTCMonth() + 1) * 100 + best.getUTCDate();
}

/**
 * Detects product type from text or SKU
 */
export function detectProductType(text: string | null | undefined, sku?: string | null): string {
  const combined = `${text || ""} ${sku || ""}`.trim();
  for (const { type, test } of PRODUCT_TYPE_PATTERNS) {
    if (test.test(combined)) {
      return type;
    }
  }
  return "General";
}

export interface ParsedPpcFilename {
  raw: string;
  sku: string | null;
  productType: string;
  title: string;
  adType: "SP" | "SB" | "SD" | "UNKNOWN";
  fileType: string;
  rangeDays: string;
  timestamp: string | null;
}

/**
 * Parses full filename or campaign / portfolio string into structured PPC metadata
 */
export function parsePpcFilename(filenameOrText: string): ParsedPpcFilename {
  const raw = filenameOrText.trim();
  const sku = extractSkuFromText(raw);
  const productType = detectProductType(raw, sku);

  let adType: "SP" | "SB" | "SD" | "UNKNOWN" = "UNKNOWN";
  if (/\bSP\b|sponsored products/i.test(raw)) adType = "SP";
  else if (/\bSB\b|sponsored brands/i.test(raw)) adType = "SB";
  else if (/\bSD\b|sponsored display/i.test(raw)) adType = "SD";

  const rangeMatch = raw.match(/\b(\d+)\s*(?:day|days|d)\b/i);
  const rangeDays = rangeMatch ? `${rangeMatch[1]} day` : "30 day";

  const fileType = /bulk\s*(?:collection|video|file)/i.test(raw)
    ? "Bulk File"
    : /campaign\s*file/i.test(raw)
    ? "Campaign File"
    : "Bulksheet Update";

  const tsMatch = raw.match(/\b([A-Za-z]{3}\s+\d{1,2},\s*\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM))\b/i)
    || raw.match(/\b(\d{4}[-_]\d{2}[-_]\d{2}(?:[ _]\d{2}[:\-_]\d{2})?)\b/);
  const timestamp = tsMatch ? tsMatch[1] : null;

  let title = raw.replace(/\.xlsx.*$/i, "").replace(/\.csv.*$/i, "").trim();
  if (sku) {
    const skuIndex = title.indexOf(sku);
    if (skuIndex > 0) {
      title = title.slice(0, skuIndex).trim();
    }
  }
  title = title.replace(/\s*(?:Campaign File|Bulk File|Bulksheet Update).*$/i, "").trim();

  return {
    raw,
    sku,
    productType,
    title,
    adType,
    fileType,
    rangeDays,
    timestamp,
  };
}

/**
 * Generates an Amazon PPC output filename matching the user requested convention:
 * "[Title] [SKU] Campaign File [AdType] [Days] day.xlsx"
 *
 * Example:
 * "Quynh test 20th Anniversary Blanket BHL180620A01 Campaign File SP 30 day.xlsx"
 */
export function formatPpcExportFilename(options: {
  title?: string;
  sku?: string;
  campaignName?: string;
  portfolioName?: string;
  adType?: "SP" | "SB" | "SD" | string;
  days?: number | string;
  fileType?: "Campaign File" | "Bulksheet Update" | "Bulk File";
  extension?: "xlsx" | "csv";
}): string {
  const fileType = options.fileType || "Campaign File";
  const adType = (options.adType || "SP").toUpperCase();
  const days = options.days ? `${options.days} day` : "30 day";
  const ext = options.extension || "xlsx";

  let sku = options.sku || null;
  if (!sku && options.portfolioName) sku = extractSkuFromText(options.portfolioName);
  if (!sku && options.campaignName) sku = extractSkuFromText(options.campaignName);

  let title = options.title?.trim();
  if (!title && options.portfolioName) {
    const parsed = parsePpcFilename(options.portfolioName);
    title = parsed.title;
  }
  if (!title && options.campaignName) {
    const cleanCamp = options.campaignName.replace(/^([A-Z0-9]+\s+)+/, "").trim();
    title = cleanCamp || options.campaignName;
  }

  const parts: string[] = [];
  if (title && title !== sku) parts.push(title);
  if (sku) parts.push(sku);
  parts.push(fileType);
  parts.push(adType);
  parts.push(days);

  let filename = parts.filter(Boolean).join(" ");
  filename = filename.replace(/[/\\?%*:|"<>]/g, "_").replace(/\s+/g, " ").trim();

  return `${filename}.${ext}`;
}
