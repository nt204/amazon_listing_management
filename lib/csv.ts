import type { ListingInput, StoredListing } from "@/lib/types";

export const batchTemplateHeaders = [
  "marketplace",
  "product_type",
  "internal_name",
  "main_keyword",
  "product_details",
  "brand",
  "reference_listing",
  "image_files",
] as const;

export interface BatchImportRow {
  marketplace: string;
  product_type: string;
  internal_name: string;
  main_keyword: string;
  product_details: string;
  brand: string;
  reference_listing: string;
  image_files: string;
}

function escapeCsv(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function encodeCsv(rows: unknown[][]) {
  return `\uFEFF${rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n")}`;
}

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field.trim());
      field = "";
    } else if (character === "\n") {
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function parseBatchCsv(text: string): BatchImportRow[] {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.toLowerCase().trim());
  const missing = batchTemplateHeaders.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`CSV thiếu cột: ${missing.join(", ")}.`);

  return rows.slice(1).map((values) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
    return Object.fromEntries(
      batchTemplateHeaders.map((header) => [header, record[header] || ""]),
    ) as unknown as BatchImportRow;
  });
}

export function buildBatchTemplateCsv() {
  return encodeCsv([
    [...batchTemplateHeaders],
    [
      "US",
      "Mug",
      "Cat Dad Mug 001",
      "cat dad mug",
      "Material: Ceramic\nCapacity: 11 oz",
      "Limima",
      "B09XXXXXXXX",
      "cat-dad-front.png|cat-dad-back.png",
    ],
  ]);
}

function skuFromInput(input: ListingInput) {
  return (
    input.internal_name
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || `listing-${Date.now()}`
  ).toUpperCase();
}

export function buildListingDeskCsv(listings: StoredListing[]) {
  const headers = [
    "seller-sku",
    "marketplace",
    "product-type",
    "item-name",
    "brand-name",
    "bullet-point1",
    "bullet-point2",
    "bullet-point3",
    "bullet-point4",
    "bullet-point5",
    "product-description",
    "generic-keywords",
  ];
  const rows = listings.map((stored) => [
    skuFromInput(stored.input),
    stored.input.marketplace,
    stored.input.product_type,
    stored.current_listing.title,
    stored.input.brand,
    ...stored.current_listing.bullet_points.slice(0, 5),
    stored.current_listing.description,
    stored.current_listing.backend_search_terms,
  ]);
  return encodeCsv([headers, ...rows]);
}

/** @deprecated Use buildListingDeskCsv. Category-specific Seller Central adapters must be explicit. */
export const buildSellerCentralCsv = buildListingDeskCsv;
