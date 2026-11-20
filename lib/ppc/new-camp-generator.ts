// Lên camp SKU mới — port 1:1 từ tool NCE-Campaign-Auto-Web (services.py, kw_generator.py).
// Giữ nguyên cách đọc file keyword "Chia Part test", file "ASIN CRAWL", cách đặt tên campaign,
// hệ số bid, cột và kiểu dữ liệu từng ô (kể cả các hành vi đặc thù của pandas) để file bulk
// xuất ra giống hệt tool cũ. Chỉ chạy phía server (exceljs, jszip).
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { DEFAULT_ADVANCED, buildCampaignName, isWinStatus, type AdvancedOptions, type NamingOptions } from "./new-camp-fields";

export const COLUMN_TITLES_SP03 = [
  "Product", "Entity", "Operation", "Campaign ID", "Ad Group ID", "Portfolio ID",
  "Ad ID", "Keyword ID", "Product Targeting ID", "Campaign Name", "Ad Group Name",
  "Campaign Name (Informational only)", "Ad Group Name (Informational only)",
  "Portfolio Name (Informational only)", "Start Date", "End Date", "Targeting Type",
  "State", "Campaign State (Informational only)", "Ad Group State (Informational only)",
  "Daily Budget", "SKU", "ASIN (Informational only)", "Eligibility Status (Informational only)",
  "Reason for Ineligibility (Informational only)", "Ad Group Default Bid",
  "Ad Group Default Bid (Informational only)", "Bid", "Keyword Text", "Match Type",
  "Bidding Strategy", "Placement", "Percentage", "Product Targeting Expression",
];
export const COLUMN_TITLES_SB = [
  "Product", "Entity", "Operation", "Campaign ID", "Draft Campaign ID", "Portfolio ID",
  "Ad Group ID", "Keyword ID", "Product Targeting ID", "Campaign Name", "Campaign Name (Informational only)",
  "Ad Group Name (Informational only)", "Start Date", "End Date",
  "State", "Campaign State (Informational only)", "Campaign Serving Status (Informational only)",
  "Budget Type", "Budget", "Bid Optimization", "Bid Multiplier",
  "Bid", "Keyword Text", "Match Type",
  "Product Targeting Expression", "Resolved Product Targeting Expression (Informational only)",
  "Ad Format", "Ad Format (Informational only)", "Landing Page URL", "Landing Page ASINs",
  "Landing Page Type (Informational only)", "Brand Entity ID", "Brand Name", "Brand Logo Asset ID",
  "Brand Logo URL (Informational only)", "Creative Headline", "Creative ASINs", "Video Media IDs", "Creative Type",
];
export const COLUMN_TITLES_AUTO = [
  "Product", "Entity", "Operation", "Campaign Id", "Ad Group Id", "Portfolio Id", "Ad Id (Read only)",
  "Keyword Id (Read only)", "Product Targeting Id (Read only)", "Campaign Name", "Ad Group Name",
  "Campaign Name (Informational only)", "Ad Group Name (Informational only)", "Portfolio Name (Informational only)",
  "Start Date", "End Date", "Targeting Type", "State", "Campaign State (Informational only)",
  "Ad Group State (Informational only)", "Daily Budget", "SKU", "Ad Group Default Bid", "Bid", "Keyword Text",
  "Match Type", "Bidding Strategy", "Placement", "Percentage", "Product Targeting Expression",
];
export const COLUMN_TITLES_FLASIN = [
  "Product", "Entity", "Operation", "Campaign Id", "Ad Group Id", "Portfolio Id", "Ad Id (Read only)",
  "Keyword Id (Read only)", "Product Targeting Id (Read only)", "Campaign Name", "Ad Group Name", "Start Date",
  "End Date", "Targeting Type", "State", "Daily Budget", "SKU", "Ad Group Default Bid", "Bid", "Keyword Text",
  "Match Type", "Bidding Strategy", "Placement", "Percentage", "Product Targeting Expression",
];

export const KEYWORD_SHEET_NAME = "Chia Part test";
export const ASIN_SHEET_NAME = "ASIN CRAWL";

/** Ô trong file xuất: null = ô trống (NaN / '' của pandas). */
export type Cell = string | number | null;
type Row = Record<string, Cell>;

/** Giá trị đọc từ Excel như pandas: null = NaN. */
type RawValue = string | number | boolean | Date | null;

export interface KeywordPart {
  name: string;
  keywords: Array<string | number>;
  /** Bid đã xử lý: số (có thể NaN) hoặc chuỗi không phải số / '' */
  bids: Array<number | string>;
}

/** Thông tin SKU lấy từ BẢNG MÃ (cùng các cột tool cũ đọc từ Google Sheets). */
export interface NewCampSkuInfo {
  sku: string;
  productType: string;
  niche: string;
  picMkt: string;
  brand: string;
  brandEntityId: string;
  creativeAsinsVideo: string;
  creativeAsinsCollection: string;
  videoMediaIds: string;
  creativeHeadline: string;
  brandLogoAssetId: string;
  landingPageUrl: string;
  storeName?: string;
  /** Trạng thái trong Bảng mã ("Phát triển" = Win) — dùng khi trạng thái chọn "Auto" */
  status?: string;
  /** Chỉ để hiển thị (ảnh mockup, ASIN) — không dùng khi sinh file. */
  asin?: string;
  mockupUrl?: string;
}

export interface MatchRunForm {
  run: boolean;
  exact: boolean;
  phrase: boolean;
  broad: boolean;
  dailyBudget: string;
}

/** Giá trị form giữ nguyên dạng chuỗi như form HTML của tool cũ (ghi vào file đúng như vậy). */
export interface NewCampForm {
  loaiHinh: "FBA" | "FBM";
  /** "Test" | "Win" như tool cũ, hoặc "Auto" = theo trạng thái từng SKU trong Bảng mã */
  trangThai: string;
  ngay: string;
  selectedSkus: string[];
  sp03: MatchRunForm;
  sb01: MatchRunForm;
  sb05: MatchRunForm;
  sp04: { run: boolean; dailyBudget: string; bidClose: string; bidLoose: string; bidComp: string; bidSub: string };
  flasin: { run: boolean; dailyBudget: string; bid: string };
  /** Tuỳ chọn thêm — không truyền thì giống hệt tool cũ */
  naming?: NamingOptions;
  advanced?: Partial<AdvancedOptions>;
}

export interface GeneratedFile {
  fileName: string;
  columns: string[];
  rows: Row[];
}

export class NewCampInputError extends Error {}

// ---------------------------------------------------------------------------
// Tiện ích mô phỏng Python / pandas
// ---------------------------------------------------------------------------

// na_values mặc định của pandas khi đọc Excel: các chuỗi này thành NaN.
const PANDAS_NA_STRINGS = new Set([
  "", "#N/A", "#N/A N/A", "#NA", "-1.#IND", "-1.#QNAN", "-NaN", "-nan", "1.#IND", "1.#QNAN",
  "<NA>", "N/A", "NA", "NULL", "NaN", "None", "n/a", "nan", "null",
]);

/** float() của Python cho chuỗi: null nếu không parse được. */
function pyFloatString(value: string): number | null {
  const s = value.trim().replace(/(\d)_(?=\d)/g, "$1");
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return Number(s);
  const lower = s.toLowerCase();
  if (/^[+-]?(inf|infinity)$/.test(lower)) return lower.startsWith("-") ? -Infinity : Infinity;
  if (/^[+-]?nan$/.test(lower)) return NaN;
  return null;
}

/** round(x, 2) của Python: làm tròn chính xác theo giá trị nhị phân, hoà thì về số chẵn. */
export function pyRound2(x: number): number {
  if (!Number.isFinite(x)) return x;
  const eighths = x * 8;
  if (Number.isInteger(eighths) && Math.abs(eighths) % 2 === 1) {
    // Giá trị đúng bằng điểm giữa (vd 0.125): chọn chữ số cuối chẵn.
    const lo = Math.floor(x * 100);
    return (lo % 2 === 0 ? lo : lo + 1) / 100;
  }
  return Number(x.toFixed(2));
}

/** str(value) của Python cho giá trị đọc từ Excel (int nguyên không có ".0"). */
function pyStr(value: string | number): string {
  return typeof value === "number" ? String(value) : value;
}

function isBlankKeyword(v: Cell | string | number): boolean {
  return v === null || (typeof v === "number" && Number.isNaN(v)) || String(v).trim() === "";
}

// pd.to_numeric(errors='coerce'): số giữ nguyên, còn lại NaN (biểu diễn bằng null).
function toNumericOrNull(v: Cell): number | null {
  if (typeof v === "number") return Number.isNaN(v) ? null : v;
  if (typeof v === "string") {
    const n = pyFloatString(v);
    return n === null || Number.isNaN(n) ? null : n;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Đọc Excel giống pandas.read_excel(engine='openpyxl')
// ---------------------------------------------------------------------------

function excelCellValue(cell: ExcelJS.Cell): RawValue {
  const v = cell.value as unknown;
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return PANDAS_NA_STRINGS.has(v) ? null : v;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) {
      const text = (o.richText as Array<{ text?: string }>).map((r) => r.text || "").join("");
      return PANDAS_NA_STRINGS.has(text) ? null : text;
    }
    if ("formula" in o || "sharedFormula" in o) {
      const r = o.result as unknown;
      if (r === null || r === undefined || (typeof r === "object" && !(r instanceof Date))) return null;
      return r as RawValue;
    }
    if ("text" in o && typeof o.text === "string") return PANDAS_NA_STRINGS.has(o.text) ? null : o.text;
    if ("error" in o) return null;
  }
  return null;
}

async function loadWorkbook(buffer: Buffer | Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new NewCampInputError("File không đúng định dạng Excel (.xlsx).");
  }
  return wb;
}

/** Lưới giá trị bắt đầu từ ô A1 (pandas header=None), bỏ các dòng trống ở cuối. */
function sheetGrid(ws: ExcelJS.Worksheet): RawValue[][] {
  const grid: RawValue[][] = [];
  const rowCount = ws.rowCount;
  const colCount = ws.columnCount;
  for (let r = 1; r <= rowCount; r++) {
    const row = ws.getRow(r);
    const values: RawValue[] = [];
    for (let c = 1; c <= colCount; c++) values.push(excelCellValue(row.getCell(c)));
    grid.push(values);
  }
  while (grid.length > 0 && grid[grid.length - 1].every((v) => v === null)) grid.pop();
  return grid;
}

function rawToKeywordValue(v: RawValue): string | number | null {
  if (v === null) return null;
  if (typeof v === "number") return Number.isNaN(v) ? null : v;
  if (typeof v === "boolean") return v ? "True" : "False";
  if (v instanceof Date) return v.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
  return v;
}

/** Xử lý bid như process_excel_data_keyword: float() được thì số, không thì giữ chuỗi. */
function processBid(v: RawValue | ""): number | string {
  if (v === "") return "";
  if (v === null) return NaN;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString(); // float() lỗi → giữ dạng không phải số
  const n = pyFloatString(v);
  return n === null ? v : n;
}

/** Đọc sheet "Chia Part test": mỗi part (dòng trên header) là 1 bộ keyword + bid. */
export type KeywordFileFormat = "chia-part" | "sheets" | "csv";

/**
 * Đọc file keyword:
 * - Có sheet "Chia Part test" → đọc y như tool cũ (parseKeywordWorkbook).
 * - Không có → mỗi sheet là 1 part (cột Keyword + Bid/CPC nếu có), gồm cả file xuất từ trang Đào Keyword.
 * - File CSV → 1 part.
 */
export async function parseKeywordFile(buffer: Buffer | Uint8Array): Promise<{ parts: KeywordPart[]; format: KeywordFileFormat }> {
  const isZip = buffer.length > 3 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (!isZip) return { parts: parseLooseRows([csvRows(Buffer.from(buffer).toString("utf8"))], ["Part 01"]), format: "csv" };
  const wb = await loadWorkbook(buffer);
  if (wb.worksheets.some((w) => w.name === KEYWORD_SHEET_NAME)) return { parts: await parseKeywordWorkbook(buffer), format: "chia-part" };
  const sheets = wb.worksheets.filter((w) => !/tổng hợp|negative/i.test(w.name));
  const parts = parseLooseRows(
    sheets.map((w) => sheetGrid(w).map((row) => row.map((v) => (v instanceof Date ? null : (v as string | number | boolean | null))))),
    sheets.map((w, i) => (/^sheet\s*\d*$/i.test(w.name.trim()) ? `Part ${String(i + 1).padStart(2, "0")}` : w.name.trim())),
  );
  if (parts.length === 0) {
    throw new NewCampInputError(`Không tìm thấy keyword: file cần sheet "${KEYWORD_SHEET_NAME}" hoặc có cột Keyword.`);
  }
  return { parts, format: "sheets" };
}

const LOOSE_KW_HEADERS = new Set(["keyword phrase", "keyword", "keywords", "từ khóa", "từ khoá", "tu khoa", "search term", "customer search term", "kw"]);

function looseHeader(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function looseBid(v: unknown): number | string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") return Number.isFinite(v) ? v : "";
  const n = pyFloatString(String(v).replace(/[$,\s]/g, ""));
  return n === null || Number.isNaN(n) ? "" : n;
}

/** Mỗi bảng (sheet / CSV) = 1 part: tìm dòng tiêu đề có cột Keyword, cột Bid (ưu tiên) hoặc CPC. */
function parseLooseRows(tables: Array<Array<Array<string | number | boolean | null>>>, names: string[]): KeywordPart[] {
  const parts: KeywordPart[] = [];
  tables.forEach((rows, t) => {
    const headerIdx = rows.slice(0, 30).findIndex((r) => r.some((v) => LOOSE_KW_HEADERS.has(looseHeader(v))));
    if (headerIdx < 0) return;
    const header = rows[headerIdx].map(looseHeader);
    const kwCol = header.findIndex((h) => LOOSE_KW_HEADERS.has(h));
    let bidCol = header.findIndex((h) => h === "bid" || h === "bid ($)");
    if (bidCol < 0) bidCol = header.findIndex((h) => h.startsWith("bid"));
    if (bidCol < 0) bidCol = header.findIndex((h) => h === "cpc" || h === "cpc ($)");
    const seen = new Set<string>();
    const keywords: string[] = [];
    const bids: Array<number | string> = [];
    for (const r of rows.slice(headerIdx + 1)) {
      const kw = String(r[kwCol] ?? "").replace(/\s+/g, " ").trim();
      if (!kw || seen.has(kw.toLowerCase())) continue;
      seen.add(kw.toLowerCase());
      keywords.push(kw);
      bids.push(bidCol >= 0 ? looseBid(r[bidCol]) : "");
    }
    if (keywords.length) parts.push({ name: names[t] || `Part ${String(t + 1).padStart(2, "0")}`, keywords, bids });
  });
  return parts;
}

/** CSV đơn giản: dấu phẩy / chấm phẩy / tab, hỗ trợ ô trong ngoặc kép. */
function csvRows(text: string): Array<Array<string | null>> {
  const clean = text.replace(/^\uFEFF/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const sep = [",", ";", "\t"].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((v) => (v.trim() === "" ? null : v.trim())));
}

/** Tạo file "Chia Part test" nhiều part (mỗi part 7 cột: Keyword Phrase … Bid), đọc lại được bằng parseKeywordWorkbook. */
export async function createKeywordWorkbookParts(parts: Array<{ name: string; keywords: string[]; bids: Array<string | number> }>): Promise<Buffer> {
  const usable = parts.filter((p) => p.keywords.length > 0);
  if (usable.length === 0) throw new NewCampInputError("Chưa có keyword nào.");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(KEYWORD_SHEET_NAME);
  usable.forEach((p, i) => {
    const col = 2 + i * 7;
    ws.getCell(2, col).value = p.name;
    ws.getCell(2, col).font = { bold: true };
    ws.getCell(3, col).value = "Keyword Phrase";
    ws.getCell(3, col + 5).value = "Bid";
    ws.getRow(3).font = { bold: true };
    ws.getColumn(col).width = 34;
    p.keywords.forEach((kw, r) => {
      ws.getCell(4 + r, col).value = kw;
      const b = typeof p.bids[r] === "number" ? (p.bids[r] as number) : pyFloatString(String(p.bids[r] ?? ""));
      if (b !== null && Number.isFinite(b)) ws.getCell(4 + r, col + 5).value = b;
    });
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** File mẫu tải về để điền. */
export function createKeywordTemplate(): Promise<Buffer> {
  return createKeywordWorkbookParts([
    { name: "Part 01 (Top KW)", keywords: ["gifts for dad", "dad gifts", "dad birthday gift"], bids: [1.11, 1.11, 1.11] },
    { name: "Part 02 (Christmas)", keywords: ["christmas gifts for dad", "dad christmas gifts"], bids: [0.9, 0.9] },
    { name: "Part 03 (Long tail)", keywords: ["gifts for dad from daughter"], bids: [0.75] },
  ]);
}

export async function parseKeywordWorkbook(buffer: Buffer | Uint8Array): Promise<KeywordPart[]> {
  const wb = await loadWorkbook(buffer);
  const ws = wb.worksheets.find((w) => w.name === KEYWORD_SHEET_NAME);
  if (!ws) throw new NewCampInputError(`File keyword không có sheet "${KEYWORD_SHEET_NAME}".`);
  const all = sheetGrid(ws);
  const first = all.findIndex((row) => row.some((v) => v !== null));
  if (first < 0) return [];
  const grid = all.slice(first);
  const width = Math.max(0, ...grid.map((r) => r.length));

  const headerIdx = grid.findIndex((row) => row.some((v) => v !== null && String(v instanceof Date ? "" : v).includes("Keyword Phrase")));
  if (headerIdx < 0) throw new NewCampInputError("Không tìm thấy dòng header chứa 'Keyword Phrase' trong file Keyword.");
  const partRow: RawValue[] = headerIdx - 1 < 0 ? ["PART 1"] : grid[headerIdx - 1];
  const headerRow = grid[headerIdx];

  const partStarts = new Map<number, string>();
  partRow.forEach((v, i) => {
    if (typeof v === "string" && v.trim() !== "") partStarts.set(i, v.trim());
  });
  if (partStarts.size === 0) partStarts.set(0, "PART 1");
  const indices = [...partStarts.keys()].sort((a, b) => a - b);

  const parts = new Map<string, KeywordPart>();
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i];
    const name = partStarts.get(start)!;
    const end = i + 1 < indices.length ? indices[i + 1] : width;
    let kwCol = -1;
    let bidCol = -1;
    for (let j = start; j < end; j++) {
      const h = headerRow[j];
      if (typeof h === "string") {
        if (h.includes("Keyword Phrase")) kwCol = j;
        else if (h.includes("Bid")) bidCol = j;
      }
    }
    if (kwCol === -1) continue;
    const keywords: Array<string | number> = [];
    for (let r = headerIdx + 1; r < grid.length; r++) {
      const kw = rawToKeywordValue(grid[r][kwCol] ?? null);
      if (kw !== null) keywords.push(kw);
    }
    if (keywords.length === 0) continue;
    const rawBids: Array<RawValue | ""> = [];
    if (bidCol !== -1) {
      // pandas lấy bid theo vị trí dòng (không theo dòng có keyword)
      for (let r = headerIdx + 1; r < Math.min(grid.length, headerIdx + 1 + keywords.length); r++) {
        rawBids.push(grid[r][bidCol] ?? null);
      }
    }
    while (rawBids.length < keywords.length) rawBids.push("");
    parts.set(name, { name, keywords, bids: rawBids.map(processBid) });
  }
  return [...parts.values()];
}

/** Đọc cột "Data-ASIN" của sheet "ASIN CRAWL". */
export async function parseAsinWorkbook(buffer: Buffer | Uint8Array): Promise<string[]> {
  const wb = await loadWorkbook(buffer);
  const ws = wb.worksheets.find((w) => w.name === ASIN_SHEET_NAME);
  if (!ws) throw new NewCampInputError(`File ASIN không có sheet "${ASIN_SHEET_NAME}".`);
  const grid = sheetGrid(ws);
  const headerIdx = grid.findIndex((row) => row.some((v) => v !== null));
  if (headerIdx < 0) return [];
  const col = grid[headerIdx].findIndex((v) => v === "Data-ASIN");
  if (col < 0) throw new NewCampInputError("File ASIN thiếu cột 'Data-ASIN'.");
  const asins: string[] = [];
  for (let r = headerIdx + 1; r < grid.length; r++) {
    const v = rawToKeywordValue(grid[r][col] ?? null);
    if (v !== null) asins.push(pyStr(v));
  }
  return asins;
}

/** Tạo file keyword "Chia Part test" từ list keyword + bid (kw_generator.create_kw_excel_from_list). */
export async function createKeywordWorkbook(keywords: string[], bids: string[]): Promise<Buffer> {
  if (keywords.length === 0 || keywords.length !== bids.length) {
    throw new NewCampInputError("Danh sách keyword và bid không khớp hoặc bị rỗng.");
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(KEYWORD_SHEET_NAME);
  ws.getCell("B2").value = "part 1 (kw chon loc)";
  ws.getCell("B3").value = "Keyword Phrase";
  ws.getCell("G3").value = "Bid";
  ws.getCell("I2").value = "part 1 plus (kw chon loc)";
  ws.getCell("I3").value = "Keyword Phrase";
  ws.getCell("N3").value = "Bid";
  keywords.forEach((kw, i) => {
    const row = 4 + i;
    ws.getCell(`B${row}`).value = kw;
    ws.getCell(`I${row}`).value = kw;
    const bid = pyFloatString(bids[i] ?? "");
    if (bid !== null && !Number.isNaN(bid)) {
      ws.getCell(`G${row}`).value = bid;
      ws.getCell(`N${row}`).value = bid;
    }
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------------------
// Sinh campaign
// ---------------------------------------------------------------------------

function emptyRow(columns: string[]): Row {
  const row: Row = {};
  for (const c of columns) row[c] = null;
  return row;
}

function campaignName(sku: string, loaiChay: string, info: NewCampSkuInfo, form: NewCampForm, tail: string): string {
  return buildCampaignName(
    {
      sku, loaiChay, productType: info.productType, niche: info.niche, loaiHinh: form.loaiHinh,
      // "Auto" chỉ đọc trạng thái Bảng mã với FBA; FBM luôn Test (trạng thái FBM mang nghĩa khác: OFF, Active, MAX BID…)
      trangThai: form.trangThai === "Auto" ? (form.loaiHinh === "FBA" && isWinStatus(info.status) ? "Win" : "Test") : form.trangThai,
      picMkt: info.picMkt, ngay: form.ngay, tail,
    },
    form.naming,
  );
}

function adv(form: NewCampForm): AdvancedOptions {
  return { ...DEFAULT_ADVANCED, ...form.advanced };
}

// df.replace("Exact", X, regex=True): thay trong mọi ô chuỗi
function replaceExact(rows: Row[], to: string): Row[] {
  return rows.map((row) => {
    const out: Row = {};
    for (const [k, v] of Object.entries(row)) out[k] = typeof v === "string" ? v.split("Exact").join(to) : v;
    return out;
  });
}

function selectedMatchTypes(m: MatchRunForm): Array<"Exact" | "Phrase" | "Broad"> {
  const out: Array<"Exact" | "Phrase" | "Broad"> = [];
  if (m.exact) out.push("Exact");
  if (m.phrase) out.push("Phrase");
  if (m.broad) out.push("Broad");
  return out;
}

/** Nhân bản bộ dòng Exact thành Exact / Phrase (bid x0.9) / Broad (bid x0.8). */
function expandMatchTypes(base: Row[], types: Array<"Exact" | "Phrase" | "Broad">, form: NewCampForm): Row[] {
  const a = adv(form);
  const out: Row[] = [];
  for (const type of types) {
    let rows = type === "Exact" ? base.map((r) => ({ ...r })) : replaceExact(base, type);
    rows = rows.map((r) => (r.Entity === "Keyword" ? { ...r, "Match Type": type } : r));
    if (type !== "Exact") {
      const factor = (type === "Phrase" ? a.phrasePct : a.broadPct) / 100;
      rows = rows.map((r) => ({ ...r, Bid: (toNumericOrNull(r.Bid) ?? 0) * factor }));
    }
    out.push(...rows);
  }
  return out;
}

function createBaseRowsSp03(sku: string, info: NewCampSkuInfo, form: NewCampForm, parts: KeywordPart[]): Row[] {
  const usable = parts.filter((p) => p.keywords.length > 0);
  const texts: Array<string | number> = [];
  const bids: Array<number | null> = [];
  for (const p of usable) {
    texts.push("", "", "", ...p.keywords);
    const ext: Array<number | string> = ["", "", "", ...p.bids.map((b) => (b !== "" ? b : 0.09))];
    while (ext.length < p.keywords.length + 3) ext.push(0.09);
    for (const b of ext.slice(0, p.keywords.length + 3)) {
      bids.push(typeof b === "number" && !Number.isNaN(b) ? b : null);
    }
  }
  if (texts.length === 0) throw new NewCampInputError(`Không tìm thấy keyword nào hợp lệ trong file keyword cho SKU ${sku}`);

  const rows: Row[] = texts.map((t, i) => ({
    ...emptyRow(COLUMN_TITLES_SP03),
    "Keyword Text": t,
    Bid: bids[i],
    Product: "Sponsored Products",
    Operation: "Create",
  }));

  let emptySeq = 0;
  for (const row of rows) {
    if (isBlankKeyword(row["Keyword Text"])) {
      emptySeq += 1;
      if (emptySeq > 3) emptySeq = 1;
      row.Entity = ["Campaign", "Ad Group", "Product Ad"][emptySeq - 1];
      if (emptySeq === 3) emptySeq = 0;
    } else {
      row.Entity = "Keyword";
      emptySeq = 0;
    }
  }

  const titles = usable.map((p) => p.name);
  let j = -1;
  for (const row of rows) {
    if (row.Entity === "Campaign") {
      j += 1;
      if (j >= titles.length) j = titles.length - 1;
    }
    const title = j < titles.length ? titles.at(j)! : "UNKNOWN PART";
    row["Campaign ID"] = campaignName(sku, "SP03 KW Exact", info, form, title);
  }

  for (const row of rows) {
    row.State = "enabled";
    const id = row["Campaign ID"];
    if (row.Entity === "Campaign") {
      row["Start Date"] = form.ngay;
      row["Targeting Type"] = "Manual";
      row["Daily Budget"] = form.sp03.dailyBudget;
      row["Bidding Strategy"] = adv(form).sp03BiddingStrategy;
      row["Campaign Name"] = id;
      row["Ad Group ID"] = "";
    } else {
      row["Ad Group ID"] = id;
    }
    if (row.Entity === "Ad Group") {
      row["Ad Group Name"] = id;
      row["Ad Group Default Bid"] = adv(form).adGroupDefaultBid.trim() || "0.09";
    }
    if (row.Entity === "Product Ad") {
      row.SKU = sku;
      row["Ad ID"] = id;
    }
  }
  return rows;
}

function generateSp03(skus: string[], infos: Map<string, NewCampSkuInfo>, form: NewCampForm, parts: KeywordPart[]): Row[] | null {
  const types = selectedMatchTypes(form.sp03);
  if (types.length === 0) return null;
  const out: Row[] = [];
  for (const sku of skus) {
    const info = infos.get(sku);
    if (!info) continue;
    let base: Row[];
    try {
      base = createBaseRowsSp03(sku, info, form, parts);
    } catch {
      continue;
    }
    out.push(...expandMatchTypes(base, types, form));
  }
  return out.length > 0 ? out : null;
}

function generateSb(kind: "SB01" | "SB05", skus: string[], infos: Map<string, NewCampSkuInfo>, form: NewCampForm, parts: KeywordPart[]): Row[] | null {
  const loaiChay = kind === "SB05" ? "SB05 VIDEO" : "SB01 CK KW";
  const settings = kind === "SB05" ? form.sb05 : form.sb01;
  const types = selectedMatchTypes(settings);
  if (types.length === 0) return null;
  const modifier = kind === "SB05" ? 0.9 : 0.8;
  const defaultBid = pyRound2(0.09 * modifier);
  const out: Row[] = [];

  for (const sku of skus) {
    const info = infos.get(sku);
    if (!info) continue;
    const usable = parts.filter((p) => p.keywords.length > 0);
    const texts: Array<string | number> = [];
    const bids: Array<number | null> = [];
    for (const p of usable) {
      texts.push("", ...p.keywords);
      const adjusted = p.bids.map((b) => {
        if (b === "") return pyRound2(0.09 * modifier);
        if (typeof b === "number") return pyRound2(b * modifier);
        return defaultBid; // float() lỗi
      });
      const ext: Array<number | ""> = ["", ...adjusted];
      while (ext.length < p.keywords.length + 1) ext.push(defaultBid);
      for (const b of ext.slice(0, p.keywords.length + 1)) bids.push(typeof b === "number" && !Number.isNaN(b) ? b : null);
    }
    if (texts.length === 0) continue;

    const rows: Row[] = texts.map((t, i) => ({
      ...emptyRow(COLUMN_TITLES_SB),
      "Keyword Text": t,
      Bid: bids[i],
      Product: "Sponsored Brands",
      Operation: "Create",
      State: "enabled",
      Entity: isBlankKeyword(t) ? "Campaign" : "Keyword",
    }));

    const titles = usable.map((p) => p.name);
    let j = -1;
    for (const row of rows) {
      if (row.Entity === "Campaign") {
        j += 1;
        if (j >= titles.length) j = titles.length - 1;
      }
      const title = j < titles.length ? titles.at(j)! : "UNKNOWN PART";
      row["Campaign ID"] = campaignName(sku, `${loaiChay} Exact`, info, form, title);
    }

    for (const row of rows) {
      if (row.Entity === "Campaign") {
        row["Campaign Name"] = row["Campaign ID"];
        row["Start Date"] = form.ngay;
        row["Budget Type"] = "Daily";
        row["Bid Optimization"] = "Auto";
        row["Brand Entity ID"] = info.brandEntityId;
        row["Brand Name"] = info.brand;
        if (kind === "SB05") {
          row.Budget = form.sb05.dailyBudget;
          row["Ad Format"] = "Video";
          row["Creative ASINs"] = info.creativeAsinsVideo;
          row["Video Media IDs"] = info.videoMediaIds;
          row["Creative Type"] = "Video";
        } else {
          row.Budget = form.sb01.dailyBudget;
          row["Ad Format"] = "Product Collection";
          row["Landing Page URL"] = info.landingPageUrl;
          row["Brand Logo Asset ID"] = info.brandLogoAssetId;
          row["Creative ASINs"] = info.creativeAsinsCollection;
          row["Creative Headline"] = info.creativeHeadline;
        }
      } else {
        row["Ad Group ID"] = row["Campaign ID"];
      }
    }
    out.push(...expandMatchTypes(rows, types, form));
  }
  return out.length > 0 ? out : null;
}

function bidOrDefault(value: string): number {
  if (!value) return 0.09;
  const n = pyFloatString(value);
  return n === null ? 0.09 : n;
}

function generateSp04(skus: string[], infos: Map<string, NewCampSkuInfo>, form: NewCampForm): Row[] | null {
  const targets = ["close-match", "loose-match", "complements", "substitutes"] as const;
  const formBids: Record<(typeof targets)[number], string> = {
    "close-match": form.sp04.bidClose,
    "loose-match": form.sp04.bidLoose,
    complements: form.sp04.bidComp,
    substitutes: form.sp04.bidSub,
  };
  const entities = ["Campaign", "Ad Group", "Product Ad", "Product Targeting", "Product Targeting", "Product Targeting", "Product Targeting"];
  const expressions = ["", "", "", "close-match", "loose-match", "complements", "substitutes"];
  const out: Row[] = [];

  for (const sku of skus) {
    const info = infos.get(sku);
    if (!info) continue;
    for (const t of targets) {
      const id = campaignName(sku, "SP04 Auto", info, form, `(${t})`);
      for (let k = 0; k < 7; k++) {
        const row: Row = {};
        for (const c of COLUMN_TITLES_AUTO) row[c] = "";
        const entity = entities[k];
        const expr = expressions[k];
        Object.assign(row, {
          Product: "Sponsored Products",
          Operation: "Create",
          State: "enabled",
          "Campaign State (Informational only)": "enabled",
          Entity: entity,
          "Product Targeting Expression": expr,
          "Campaign Id": id,
          "Campaign Name (Informational only)": id,
        });
        if (entity === "Campaign") {
          Object.assign(row, {
            "Campaign Name": id,
            "Daily Budget": form.sp04.dailyBudget,
            "Bidding Strategy": adv(form).sp04BiddingStrategy,
            "Start Date": form.ngay,
            "Targeting Type": "Auto",
          });
        } else {
          Object.assign(row, {
            "Ad Group Id": id,
            "Ad Group State (Informational only)": "enabled",
            "Ad Group Name (Informational only)": id,
          });
        }
        if (entity === "Ad Group") {
          row["Ad Group Name"] = id;
          row["Ad Group Default Bid"] = bidOrDefault(adv(form).adGroupDefaultBid.trim());
        }
        if (entity === "Product Ad") row.SKU = sku;
        if (entity === "Product Targeting") {
          let bid = 0.09;
          for (const target of targets) {
            if (id.includes(target) && target === expr) {
              bid = bidOrDefault(formBids[target]);
              break;
            }
          }
          row.Bid = bid;
        }
        out.push(row);
      }
    }
  }
  return out.length > 0 ? out : null;
}

function generateFlAsin(skus: string[], infos: Map<string, NewCampSkuInfo>, form: NewCampForm, asins: string[]): Row[] | null {
  if (asins.length === 0) return null;
  const out: Row[] = [];
  for (const sku of skus) {
    const info = infos.get(sku);
    if (!info) continue;
    const id = campaignName(sku, "FL Asin", info, form, "(FL ASIN)");
    const head = ["Campaign", "Bidding Adjustment", "Bidding Adjustment", "Ad Group", "Product Ad"];
    const total = asins.length + 5;
    for (let i = 0; i < total; i++) {
      const row: Row = {};
      for (const c of COLUMN_TITLES_FLASIN) row[c] = "";
      row.Product = "Sponsored Products";
      row.Operation = "Create";
      row["Campaign Id"] = id;
      row.Entity = i < 5 ? head[i] : "Product Targeting";
      if (i >= 3) row["Ad Group Id"] = id;
      if (i === 0 || i >= 3) row.State = "enabled";
      if (i <= 2) row["Bidding Strategy"] = "Fixed bid";
      if (i === 0) {
        row["Campaign Name"] = id;
        row["Start Date"] = form.ngay;
        row["Targeting Type"] = "MANUAL";
        row["Daily Budget"] = form.flasin.dailyBudget;
      }
      if (i === 1) row.Placement = "placementProductPage";
      if (i === 2) row.Placement = "placementTop";
      if (i === 1 || i === 2) row.Percentage = "0.00";
      if (i === 3) {
        row["Ad Group Name"] = id;
        row["Ad Group Default Bid"] = adv(form).adGroupDefaultBid.trim() || "0.1";
      }
      if (i === 4) row.SKU = sku;
      if (i >= 5) {
        row.Bid = form.flasin.bid;
        row["Product Targeting Expression"] = `asin-expanded="${asins[i - 5]}"`;
      }
      out.push(row);
    }
  }
  return out;
}

export function isValidCampDate(value: string): boolean {
  if (!/^\d{8}$/.test(value)) return false;
  const y = Number(value.slice(0, 4)), m = Number(value.slice(4, 6)), d = Number(value.slice(6, 8));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function needsKeywordFile(form: NewCampForm): boolean {
  return form.sp03.run || form.sb01.run || form.sb05.run;
}

/** generate_all_files: thứ tự file SP03, SB01, SB05, SP04, FL Asin. */
export function generateAllFiles(
  form: NewCampForm,
  infos: Map<string, NewCampSkuInfo>,
  parts: KeywordPart[] | null,
  asins: string[],
): GeneratedFile[] {
  if (!isValidCampDate(form.ngay)) {
    throw new NewCampInputError(`Định dạng ngày '${form.ngay}' không hợp lệ. Cần định dạng YYYYMMDD.`);
  }
  const skus = form.selectedSkus;
  const first = skus[0];
  const files: GeneratedFile[] = [];
  const push = (prefix: string, columns: string[], rows: Row[] | null) => {
    if (rows && rows.length > 0) files.push({ fileName: `${prefix} - ${first} - ${form.ngay}.xlsx`, columns, rows });
  };
  if (form.sp03.run && parts) push("SP03 KW", COLUMN_TITLES_SP03, generateSp03(skus, infos, form, parts));
  if (form.sb01.run && parts) push("SB01 CK KW", COLUMN_TITLES_SB, generateSb("SB01", skus, infos, form, parts));
  if (form.sb05.run && parts) push("SB05 VIDEO", COLUMN_TITLES_SB, generateSb("SB05", skus, infos, form, parts));
  if (form.sp04.run) push("SP04 Auto", COLUMN_TITLES_AUTO, generateSp04(skus, infos, form));
  if (form.flasin.run) push("FL Asin", COLUMN_TITLES_FLASIN, generateFlAsin(skus, infos, form, asins));
  return files;
}

// ---------------------------------------------------------------------------
// Ghi file
// ---------------------------------------------------------------------------

/** df.to_excel(index=False): sheet "Sheet1", header in đậm có viền. */
export async function writeGeneratedXlsx(file: GeneratedFile): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  const header = ws.getRow(1);
  file.columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c;
    cell.font = { bold: true };
    cell.alignment = { horizontal: "center", vertical: "top" };
    cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
  });
  file.rows.forEach((row, r) => {
    const xr = ws.getRow(r + 2);
    file.columns.forEach((c, i) => {
      const v = row[c];
      if (v === null || v === undefined || v === "") return;
      if (typeof v === "number" && !Number.isFinite(v)) return;
      // openpyxl ghi số theo "%.16g": 0.17*0.9 → 0.153 (không phải 0.15300000000000002)
      xr.getCell(i + 1).value = typeof v === "number" ? Number(v.toPrecision(16)) : v;
    });
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function buildCampaignZip(files: GeneratedFile[]): Promise<Buffer> {
  const zip = new JSZip();
  for (const f of files) zip.file(f.fileName, await writeGeneratedXlsx(f));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

// ---------------------------------------------------------------------------
// Danh sách camp sẽ tạo (xem trước / sửa tên) — cùng thứ tự và cùng cách ghép tên với các hàm generate* ở trên
// ---------------------------------------------------------------------------

export interface PlannedCampaign {
  /** Mã cố định của camp (không đổi khi đổi Phôi / Ngách / đuôi tên) để gắn tên sửa tay */
  key: string;
  sku: string;
  /** Nhãn ngắn: "SP03 · Exact", "SB05 · Phrase", "SP04 · close-match", "FL Asin" */
  label: string;
  name: string;
}

export function planCampaigns(
  form: NewCampForm,
  infos: Map<string, NewCampSkuInfo>,
  parts: KeywordPart[] | null,
  asinCount: number,
): PlannedCampaign[] {
  const out: PlannedCampaign[] = [];
  const usable = (parts ?? []).filter((p) => p.keywords.length > 0);
  const kwRuns: Array<{ run: "SP03" | "SB01" | "SB05"; settings: MatchRunForm; loaiChay: string }> = [
    { run: "SP03", settings: form.sp03, loaiChay: "SP03 KW" },
    { run: "SB01", settings: form.sb01, loaiChay: "SB01 CK KW" },
    { run: "SB05", settings: form.sb05, loaiChay: "SB05 VIDEO" },
  ];
  for (const k of kwRuns) {
    if (!k.settings.run || usable.length === 0) continue;
    const types = selectedMatchTypes(k.settings);
    for (const sku of form.selectedSkus) {
      const info = infos.get(sku);
      if (!info) continue;
      for (const type of types) {
        for (const p of usable) {
          const exactName = campaignName(sku, `${k.loaiChay} Exact`, info, form, p.name);
          out.push({
            key: `${k.run}|${sku}|${type}|${p.name}`,
            sku,
            label: `${k.run} · ${type}`,
            name: type === "Exact" ? exactName : exactName.split("Exact").join(type),
          });
        }
      }
    }
  }
  if (form.sp04.run) {
    for (const sku of form.selectedSkus) {
      const info = infos.get(sku);
      if (!info) continue;
      for (const t of ["close-match", "loose-match", "complements", "substitutes"]) {
        out.push({ key: `SP04|${sku}|${t}`, sku, label: `SP04 · ${t}`, name: campaignName(sku, "SP04 Auto", info, form, `(${t})`) });
      }
    }
  }
  if (form.flasin.run && asinCount > 0) {
    for (const sku of form.selectedSkus) {
      const info = infos.get(sku);
      if (!info) continue;
      out.push({ key: `FL|${sku}`, sku, label: "FL Asin", name: campaignName(sku, "FL Asin", info, form, "(FL ASIN)") });
    }
  }
  return out;
}

/** Đổi tên camp đã sửa tay: thay mọi ô mang đúng tên cũ (Campaign ID / Name, Ad Group, Ad ID...). */
export function applyNameEdits(files: GeneratedFile[], plan: PlannedCampaign[], edits: Record<string, string>): number {
  const rename = new Map<string, string>();
  for (const c of plan) {
    const next = edits[c.key]?.replace(/\s+/g, " ").trim();
    if (next && next !== c.name) rename.set(c.name, next);
  }
  if (rename.size === 0) return 0;
  for (const f of files) {
    for (const row of f.rows) {
      for (const [col, v] of Object.entries(row)) {
        if (typeof v === "string" && rename.has(v)) row[col] = rename.get(v)!;
      }
    }
  }
  return rename.size;
}
