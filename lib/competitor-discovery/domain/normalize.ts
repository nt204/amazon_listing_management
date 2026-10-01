import type { SellerSpriteCandidate, PlacementType } from "./competitor.types";

/**
 * Parses monetary values into clean numbers without $, commas or whitespace
 */
export function parseMoney(val: unknown): number | undefined {
  if (typeof val === "number" && Number.isFinite(val)) {
    return val > 0 ? Number(val.toFixed(2)) : undefined;
  }
  if (!val) return undefined;
  const cleaned = String(val).replace(/[^0-9.-]/g, "").trim();
  const num = parseFloat(cleaned);
  return Number.isFinite(num) && num > 0 ? Number(num.toFixed(2)) : undefined;
}

/**
 * Parses integer and count values without commas or #
 */
export function parseNumber(val: unknown): number | undefined {
  if (typeof val === "number" && Number.isFinite(val)) {
    return Math.round(val);
  }
  if (!val) return undefined;
  const cleaned = String(val).replace(/[^0-9-]/g, "").trim();
  const num = parseInt(cleaned, 10);
  return Number.isFinite(num) ? num : undefined;
}

/**
 * Decodes common HTML entities found in Amazon/SellerSprite titles
 */
export function decodeHtml(value: string): string {
  if (!value) return "";
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&quot;": '"',
    "&#34;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&lt;": "<",
    "&gt;": ">",
    "&nbsp;": " ",
    "&copy;": "©",
    "&reg;": "®",
    "&trade;": "™",
    "&ndash;": "–",
    "&mdash;": "—",
  };
  return value
    .replace(/&(amp|quot|#34|#39|apos|lt|gt|nbsp|copy|reg|trade|ndash|mdash);/gi, (entity) => entities[entity.toLowerCase()] || entity)
    .replace(/&#(\d+);/g, (_, code: string) => {
      try {
        return String.fromCodePoint(Number(code));
      } catch {
        return _;
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => {
      try {
        return String.fromCodePoint(Number.parseInt(code, 16));
      } catch {
        return _;
      }
    });
}

/**
 * Normalizes raw SellerSprite item into clean typed domain model
 */
export function normalizeCandidate(raw: any, index: number = 0): SellerSpriteCandidate {
  const asin = String(raw.asin || "").trim().toUpperCase();
  const parentAsin = raw.parent && String(raw.parent).trim().toUpperCase() !== asin
    ? String(raw.parent).trim().toUpperCase()
    : undefined;

  const title = decodeHtml(String(raw.title || "").trim());
  const brand = raw.brand ? decodeHtml(String(raw.brand).trim()) : undefined;
  const category = raw.bsr_label || raw.node_label_path || raw.category || undefined;

  const monthlyRevenue = parseMoney(raw.amount ?? raw.sub_total_amount ?? raw.monthlyRevenue);
  const monthlySales = parseNumber(raw.units ?? raw.month_units ?? raw.monthlySales);
  const bsr = parseNumber(raw.bsr);
  const price = parseMoney(raw.price);

  const badges: string[] = Array.isArray(raw.badges) ? raw.badges : [];
  let placement: PlacementType = "organic";

  if (
    badges.includes("SP") ||
    badges.includes("SPB") ||
    badges.includes("SPV") ||
    Boolean(raw.adPosition) ||
    Boolean(raw.isSponsored) ||
    Boolean(raw.sponsored) ||
    Boolean(raw.ad)
  ) {
    placement = "sponsored";
  } else if (!raw.badges && !raw.bsrList && typeof raw.rankPosition === "undefined") {
    placement = "unknown";
  }

  return {
    asin,
    parentAsin,
    title,
    brand,
    category,
    monthlyRevenue,
    monthlySales,
    bsr,
    price,
    position: index + 1,
    placement,
    image: raw.image_zoom || raw.image || undefined,
    rating: typeof raw.rating === "number" ? raw.rating : parseMoney(raw.rating),
    reviewCount: parseNumber(raw.reviews ?? raw.reviewCount),
    fees: parseMoney(raw.fba ?? raw.fees),
    profit: typeof raw.profit === "number" ? raw.profit : undefined,
    sellerCountry: raw.seller_dto?.nation_name || raw.seller_dto?.nation_code || raw.sellerCountry || undefined,
    sellerType: raw.seller_type || raw.fulfillment || undefined,
    badges,
    status: "RAW",
  };
}
