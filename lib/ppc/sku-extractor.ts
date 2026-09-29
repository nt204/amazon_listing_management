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

/**
 * Checks if a search term is an ASIN or product targeting expression.
 * Returns true if the term is an ASIN or product target (which should be skipped for KW campaigns).
 */
export function isAsinProductTarget(term: string | null | undefined): boolean {
  const t = (term || "").trim();
  if (!t) return false;
  const lower = t.toLowerCase();
  if (lower.startsWith("asin=") || lower.startsWith("category=")) return true;
  if (/^[bB][0-9a-zA-Z]{9}$/.test(t)) return true;
  if (/^b0[a-z0-9]{8}$/i.test(t)) return true;
  if (lower.startsWith("b0") && t.length >= 10 && !t.includes(" ")) return true;
  return false;
}

/**
 * Format date to 6-digit DDMMYY format (e.g. 100124 for 10/01/2024, or 270926 for 27/09/2026)
 * Uses Asia/Ho_Chi_Minh timezone by default.
 */
export function formatDDMMYY(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).formatToParts(date);
  const day = parts.find((p) => p.type === "day")?.value || "01";
  const month = parts.find((p) => p.type === "month")?.value || "01";
  const year = parts.find((p) => p.type === "year")?.value || "26";
  return `${day}${month}${year}`;
}

/** Format a Sale KW launch date as YYYYMMDD in Vietnam time. */
export function formatYYYYMMDD(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);
  const day = parts.find((p) => p.type === "day")?.value || "01";
  const month = parts.find((p) => p.type === "month")?.value || "01";
  const year = parts.find((p) => p.type === "year")?.value || "2026";
  return `${year}${month}${day}`;
}

export function normalizeSaleKwDate(dateStr?: string | null, fallbackDate = new Date()): string {
  const value = String(dateStr || "").trim();
  const isValidDate = (year: number, month: number, day: number) => {
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  };

  const longDate = value.match(/^(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/);
  if (longDate && isValidDate(Number(longDate[1]), Number(longDate[2]), Number(longDate[3]))) return value;

  const shortDate = value.match(/^(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])(\d{2})$/);
  if (shortDate && isValidDate(2000 + Number(shortDate[3]), Number(shortDate[2]), Number(shortDate[1]))) {
    return `20${shortDate[3]}${shortDate[2]}${shortDate[1]}`;
  }

  return formatYYYYMMDD(fallbackDate);
}

export type SaleKwRunTypeCode = "SP03" | "SB05" | "SP04" | "SB01";

const SALE_KW_RUN_TYPE_LABELS: Record<SaleKwRunTypeCode, string> = {
  SP03: "SP03 KW",
  SB05: "SB05 Video",
  SP04: "SP04 Auto",
  SB01: "SB01",
};

export function formatSaleKwRunType(adTypeCode?: string | null): string {
  const raw = String(adTypeCode || "SP03").trim().toUpperCase();
  if (raw.includes("SB05") || raw.includes("VIDEO")) return "SB05 Video";
  if (raw.includes("SP04") || raw.includes("AUTO")) return "SP04 Auto";
  if (raw.includes("SB01")) return "SB01";
  if (raw.includes("SP03") || raw.includes("KW")) return "SP03 KW";
  const code = raw as SaleKwRunTypeCode;
  return SALE_KW_RUN_TYPE_LABELS[code] || SALE_KW_RUN_TYPE_LABELS.SP03;
}

export function sanitizeSaleKwUserName(userName?: string | null): string {
  const ascii = String(userName || "")
    .replace(/Đ/g, "D")
    .replace(/đ/g, "d")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._ -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32)
    .trim();
  return ascii || "Loan";
}

/**
 * Extract PPC ad type code from campaign name (e.g. SP03, SP01, SP04, SB05, etc.)
 * Defaults to "SP03" for Keyword campaigns.
 */
export function extractAdTypeCode(campaignName?: string | null): string {
  if (!campaignName) return "SP03";
  const m = campaignName.match(/\b(SP01|SP02|SP03|SP04|SB01|SB02|SB05|SD01|SD02)\b/i);
  if (m) return m[1].toUpperCase();
  return "SP03";
}

/**
 * Build campaign name according to the rule:
 * "{SKU} {dạng chạy} {match type} FBA {tên người dùng} {YYYYMMDD} (sale kw)"
 * Example:
 * BTV260203MR SP03 KW Phrase FBA Truong 20260430 (sale kw)
 */
export function buildSaleKwCampaignName(params: {
  sku: string;
  adTypeCode?: string;
  userName?: string;
  matchType: "Exact" | "Phrase" | "Broad";
  dateStr?: string;
}): string {
  const cleanSku = (params.sku || "").trim().toUpperCase() || "SKU";
  const runType = formatSaleKwRunType(params.adTypeCode);
  const user = sanitizeSaleKwUserName(params.userName);
  const dateStr = normalizeSaleKwDate(params.dateStr);
  return `${cleanSku} ${runType} ${params.matchType} FBA ${user} ${dateStr} (sale kw)`;
}

/**
 * Generate 3 campaign names (Exact, Phrase, Broad) for a given SKU.
 */
export function generateSaleKwCampaignTriad(params: {
  sku: string;
  adTypeCode?: string;
  userName?: string;
  dateStr?: string;
}): { exact: string; phrase: string; broad: string } {
  return {
    exact: buildSaleKwCampaignName({ ...params, matchType: "Exact" }),
    phrase: buildSaleKwCampaignName({ ...params, matchType: "Phrase" }),
    broad: buildSaleKwCampaignName({ ...params, matchType: "Broad" }),
  };
}

/**
 * Resolve SKU for a PPC search term row
 */
export function resolveSkuForSearchTerm(
  term: { customerSearchTerm?: string; campaignName?: string; portfolioName?: string; adGroupName?: string; sku?: string },
  selectedSku?: string
): string {
  if (selectedSku && selectedSku !== "ALL" && selectedSku !== "ALL_SKUS") {
    return selectedSku.trim().toUpperCase();
  }
  const rawSku = (term as any).sku;
  if (rawSku && String(rawSku).trim()) {
    return String(rawSku).trim().toUpperCase();
  }
  const fromCamp = extractSkuFromText(term.campaignName);
  if (fromCamp) return fromCamp;
  const fromPort = extractSkuFromText(term.portfolioName);
  if (fromPort) return fromPort;
  const fromAg = extractSkuFromText(term.adGroupName);
  if (fromAg) return fromAg;
  const firstToken = (term.campaignName || "").trim().split(/\s+/)[0];
  if (firstToken && firstToken.length >= 4 && /[A-Za-z]/.test(firstToken) && /\d/.test(firstToken)) {
    return firstToken.toUpperCase();
  }
  return "UNKNOWN_SKU";
}

/**
 * Extract date from file date, report date, or filename into 6-digit DDMMYY format
 * E.g.
 * - "2026-09-26" -> "260926"
 * - "2024-01-10" -> "100124"
 * - "LIMIMA_Search_Term_SP_30Days_20260926_(Y65DVF).xlsx" -> "260926"
 * - "2026-09-26T22:39:14.572Z" -> "260926"
 */
export function extractFileDateDDMMYY(dateStrOrObj?: string | Date | null): string | null {
  if (!dateStrOrObj) return null;
  if (dateStrOrObj instanceof Date) {
    return formatDDMMYY(dateStrOrObj);
  }
  const str = String(dateStrOrObj).trim();
  // 1. Check for YYYY-MM-DD e.g. 2026-09-26 or 2026/09/26
  const mYmd = str.match(/\b(20\d{2})[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b/);
  if (mYmd) {
    const yy = mYmd[1].slice(-2);
    const mm = mYmd[2];
    const dd = mYmd[3];
    return `${dd}${mm}${yy}`;
  }
  // 2. Check for 8-digit YYYYMMDD in string or filename e.g. 20260926
  const m8 = str.match(/\b(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/);
  if (m8) {
    const yy = m8[1].slice(-2);
    const mm = m8[2];
    const dd = m8[3];
    return `${dd}${mm}${yy}`;
  }
  // 3. Check for 6-digit DDMMYY already e.g. 100124
  const m6 = str.match(/\b(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])(\d{2})\b/);
  if (m6) {
    return m6[0];
  }
  return null;
}
