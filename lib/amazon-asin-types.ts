export interface AmazonCompetitorCandidate {
  asin: string;
  title: string;
  brand: string;
  price: string;
  priceNum: number | null;
  revenue?: number | null;
  monthlySales?: number | null;
  parentSales?: number | null;
  parentRevenue?: number | null;
  recentPurchases?: string;
  fees?: number | null;
  bsr?: number | null;
  bsrText?: string;
  creationDate?: string;
  sellerCountry?: string;
  fulfillment?: string;
  reviewVelocity?: number | null;
  rating: number | null;
  ratingText: string;
  reviewCount: number;
  img: string;
  isSponsored: boolean;
  isBestSeller: boolean;
  isAmazonChoice: boolean;
  categoryGroup: "top_organic" | "best_seller" | "direct_competitor" | "outlier_cross_niche" | "excluded";
  exclusionReason?: string;
  isRecommended: boolean;
}

export interface AmazonCompetitorSearchResult {
  query: string;
  marketplace: string;
  source?: "amazon_live_crawl" | "helium10_xray_csv";
  searchVolume?: number;
  totalFound: number;
  totalRecommended: number;
  candidates: AmazonCompetitorCandidate[];
  recommendedAsins: string[];
  stats: {
    avgPrice: number;
    avgReviews: number;
    avgRating: number;
    avgRevenue?: number;
    totalRevenue?: number;
    avgBsr?: number;
    topBrands: string[];
  };
}

/**
 * Parses raw CSV string into matrix of strings
 */
function parseCSVRows(text: string): string[][] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length === 0) return [];
  const rows: string[][] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const row: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === "," && !inQuotes) {
        row.push(cur.trim());
        cur = "";
      } else {
        cur += c;
      }
    }
    row.push(cur.trim());
    rows.push(row);
  }
  return rows;
}

const MONOPOLY_BRANDS = [
  "yeti", "stanley", "hydro flask", "contigo", "starbucks", "thermos", 
  "disney", "nike", "apple", "under armour", "champion", "tervis", "brümate", "coldest"
];

export function extractBrandFromTitle(title: string): string {
  const clean = title.trim();
  const firstWord = clean.split(/[\s\-:,]+/)[0] || "";
  return firstWord;
}

export function parsePriceNumber(priceStr: string): number | null {
  if (!priceStr) return null;
  const match = priceStr.match(/[\$£€]?\s*(\d+(?:[.,]\d+)?)/);
  if (!match) return null;
  return parseFloat(match[1].replace(/,/g, ""));
}

export function parseRatingNumber(ratingStr: string): number | null {
  if (!ratingStr) return null;
  const match = ratingStr.match(/(\d+(?:\.\d+)?)\s*(?:out of|\/)/i) || ratingStr.match(/^(\d+(?:\.\d+)?)/);
  if (!match) return null;
  return parseFloat(match[1]);
}

export function parseReviewCount(reviewStr: string): number {
  if (!reviewStr) return 0;
  const clean = reviewStr.replace(/[^0-9]/g, "");
  return parseInt(clean, 10) || 0;
}

/**
 * Applies smart multi-criteria filtering & classifies candidates into 4 diverse groups (10-15 recommended)
 */
export function classifyAndFilterCompetitors(
  candidates: AmazonCompetitorCandidate[],
  mainQuery: string
): AmazonCompetitorSearchResult {
  const classified: AmazonCompetitorCandidate[] = [];

  const validPrices = candidates.map((c) => c.priceNum).filter((p): p is number => p !== null && p > 0);
  const avgPrice = validPrices.length > 0
    ? Number((validPrices.reduce((a, b) => a + b, 0) / validPrices.length).toFixed(2))
    : 16.5;

  const validReviews = candidates.map((c) => c.reviewCount).filter((r) => r > 0);
  const avgReviews = validReviews.length > 0
    ? Math.round(validReviews.reduce((a, b) => a + b, 0) / validReviews.length)
    : 350;

  const validRatings = candidates.map((c) => c.rating).filter((r): r is number => r !== null && r > 0);
  const avgRating = validRatings.length > 0
    ? Number((validRatings.reduce((a, b) => a + b, 0) / validRatings.length).toFixed(1))
    : 4.7;

  let topOrganicCount = 0;
  let bestSellerCount = 0;
  let directCompetitorCount = 0;
  let outlierCount = 0;

  for (let i = 0; i < candidates.length; i++) {
    const item = { ...candidates[i] };
    const lowerTitle = item.title.toLowerCase();
    const lowerBrand = item.brand.toLowerCase();

    // Check exclusion: Monopoly brands
    if (MONOPOLY_BRANDS.some((mb) => lowerBrand.includes(mb) || lowerTitle.includes(mb))) {
      item.categoryGroup = "excluded";
      item.exclusionReason = "Brand độc quyền/quá lớn (Yeti/Stanley...) — Dễ làm lệch data";
      item.isRecommended = false;
      classified.push(item);
      continue;
    }

    // Check exclusion: Poor rating
    if (item.rating !== null && item.rating < 3.8) {
      item.categoryGroup = "excluded";
      item.exclusionReason = "Đánh giá thấp (< 3.8 sao) — Hàng kém chất lượng";
      item.isRecommended = false;
      classified.push(item);
      continue;
    }

    // Check exclusion: Bundle mismatch (e.g. 10 pack, 100 pcs, toppers)
    if (
      lowerTitle.includes("cupcake") ||
      lowerTitle.includes("topper") ||
      lowerTitle.includes("balloon") ||
      lowerTitle.includes("pack of 12") ||
      lowerTitle.includes("set of 6")
    ) {
      item.categoryGroup = "excluded";
      item.exclusionReason = "Khác cấu trúc sản phẩm (Combo/Bundle phụ kiện)";
      item.isRecommended = false;
      classified.push(item);
      continue;
    }

    // Assign Diverse Portfolio Group
    if ((item.isBestSeller || item.isAmazonChoice || item.reviewCount > 1500 || (item.revenue && item.revenue > 15000)) && bestSellerCount < 3) {
      item.categoryGroup = "best_seller";
      item.isRecommended = true;
      bestSellerCount++;
    } else if (
      item.priceNum !== null &&
      Math.abs(item.priceNum - avgPrice) <= 6 &&
      item.reviewCount >= 50 &&
      directCompetitorCount < 3
    ) {
      item.categoryGroup = "direct_competitor";
      item.isRecommended = true;
      directCompetitorCount++;
    } else if (
      (lowerTitle.includes("tumbler") || lowerTitle.includes("stoneware") || lowerTitle.includes("insulated")) &&
      outlierCount < 2
    ) {
      item.categoryGroup = "outlier_cross_niche";
      item.isRecommended = true;
      outlierCount++;
    } else if (topOrganicCount < 7) {
      item.categoryGroup = "top_organic";
      item.isRecommended = true;
      topOrganicCount++;
    } else {
      item.categoryGroup = "top_organic";
      item.isRecommended = false;
    }

    classified.push(item);
  }

  const recommendedAsins = classified.filter((c) => c.isRecommended).map((c) => c.asin);

  // Top Brands stats
  const brandCounts: Record<string, number> = {};
  classified.forEach((c) => {
    if (c.brand && c.brand.length > 2) {
      brandCounts[c.brand] = (brandCounts[c.brand] || 0) + 1;
    }
  });
  const topBrands = Object.entries(brandCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([b]) => b);

  const validRevenues = classified.map((c) => c.parentRevenue || c.revenue).filter((r): r is number => typeof r === "number" && r > 0);
  const totalRevenue = validRevenues.length > 0 ? Math.round(validRevenues.reduce((a, b) => a + b, 0)) : undefined;
  const avgRevenue = validRevenues.length > 0 ? Math.round(totalRevenue! / validRevenues.length) : undefined;

  const validBsrs = classified.map((c) => c.bsr).filter((b): b is number => typeof b === "number" && b > 0);
  const avgBsr = validBsrs.length > 0 ? Math.round(validBsrs.reduce((a, b) => a + b, 0) / validBsrs.length) : undefined;

  return {
    query: mainQuery,
    marketplace: "US",
    totalFound: classified.length,
    totalRecommended: recommendedAsins.length,
    candidates: classified,
    recommendedAsins,
    stats: {
      avgPrice,
      avgReviews,
      avgRating,
      avgRevenue,
      totalRevenue,
      avgBsr,
      topBrands,
    },
  };
}

/**
 * Parses a Helium 10 Xray CSV export into enriched AmazonCompetitorSearchResult
 */
export function parseHelium10XrayCSV(csvText: string, query: string = "Helium 10 Import"): AmazonCompetitorSearchResult {
  const matrix = parseCSVRows(csvText);
  if (matrix.length < 2) {
    throw new Error("File CSV không có dữ liệu hợp lệ.");
  }

  const headerRow = matrix[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const getColIdx = (aliases: string[]) => {
    return headerRow.findIndex((h) => aliases.some((a) => h.includes(a)));
  };

  const idxAsin = getColIdx(["asin"]);
  const idxTitle = getColIdx(["productdetails", "title"]);
  const idxBrand = getColIdx(["brand"]);
  const idxPrice = getColIdx(["priceus", "price"]);
  const idxSales = getColIdx(["asinsales", "sales"]);
  const idxRevenue = getColIdx(["asinrevenue", "revenue"]);
  const idxParentSales = getColIdx(["parentlevelsales"]);
  const idxParentRevenue = getColIdx(["parentlevelrevenue"]);
  const idxRecent = getColIdx(["recentpurchases"]);
  const idxFees = getColIdx(["feesus", "fees"]);
  const idxBsr = getColIdx(["bsr"]);
  const idxCategory = getColIdx(["category"]);
  const idxRating = getColIdx(["ratings", "rating"]);
  const idxReviews = getColIdx(["reviewcount", "reviews"]);
  const idxImg = getColIdx(["imageurl", "image"]);
  const idxCountry = getColIdx(["sellercountry", "country"]);
  const idxCreation = getColIdx(["creationdate", "date"]);
  const idxFulfillment = getColIdx(["fulfillment"]);
  const idxVelocity = getColIdx(["reviewvelocity"]);
  const idxSponsored = getColIdx(["sponsored"]);

  if (idxAsin === -1) {
    throw new Error("Không tìm thấy cột ASIN trong file CSV Helium 10.");
  }

  const rawCandidates: AmazonCompetitorCandidate[] = [];

  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i];
    const asin = row[idxAsin]?.trim() || "";
    if (!asin || asin.length !== 10) continue;

    const title = idxTitle !== -1 ? row[idxTitle] || "" : "";
    const brand = idxBrand !== -1 ? row[idxBrand] || "" : extractBrandFromTitle(title);
    const priceStr = idxPrice !== -1 ? row[idxPrice] || "" : "";
    const priceNum = parsePriceNumber(priceStr);

    const salesStr = idxSales !== -1 ? row[idxSales]?.replace(/[^0-9]/g, "") || "" : "";
    const monthlySales = salesStr ? parseInt(salesStr, 10) : null;

    const parentSalesStr = idxParentSales !== -1 ? row[idxParentSales]?.replace(/[^0-9]/g, "") || "" : "";
    const parentSales = parentSalesStr ? parseInt(parentSalesStr, 10) : monthlySales;

    const revStr = idxRevenue !== -1 ? row[idxRevenue]?.replace(/[^0-9.]/g, "") || "" : "";
    const revenue = revStr ? parseFloat(revStr) : null;

    const parentRevStr = idxParentRevenue !== -1 ? row[idxParentRevenue]?.replace(/[^0-9.]/g, "") || "" : "";
    const parentRevenue = parentRevStr ? parseFloat(parentRevStr) : revenue;

    const recentPurchases = idxRecent !== -1 ? row[idxRecent]?.trim() || "" : "";

    const feesStr = idxFees !== -1 ? row[idxFees]?.replace(/[^0-9.]/g, "") || "" : "";
    const fees = feesStr ? parseFloat(feesStr) : null;

    const category = idxCategory !== -1 ? row[idxCategory]?.trim() || "" : "";
    const bsrStr = idxBsr !== -1 ? row[idxBsr] || "" : "";
    const bsrNum = bsrStr ? parseInt(bsrStr.replace(/[^0-9]/g, ""), 10) : null;
    const bsrText = bsrNum ? (category ? `${category} #${bsrNum.toLocaleString()}` : `#${bsrNum.toLocaleString()}`) : undefined;

    const ratingStr = idxRating !== -1 ? row[idxRating] || "" : "";
    const ratingNum = parseRatingNumber(ratingStr);

    const reviewsStr = idxReviews !== -1 ? row[idxReviews] || "" : "";
    const reviewCount = parseReviewCount(reviewsStr);

    const img = idxImg !== -1 ? row[idxImg] || "" : "";
    const sellerCountry = idxCountry !== -1 ? row[idxCountry] || "" : "";
    const creationDate = idxCreation !== -1 ? row[idxCreation] || "" : "";
    const fulfillment = idxFulfillment !== -1 ? row[idxFulfillment] || "" : "";
    const velocityStr = idxVelocity !== -1 ? row[idxVelocity]?.replace(/[^0-9]/g, "") || "" : "";
    const reviewVelocity = velocityStr ? parseInt(velocityStr, 10) : null;

    const isSponsored = idxSponsored !== -1 ? Boolean(row[idxSponsored]?.toLowerCase().includes("sponsored")) : false;
    const isBestSeller = (bsrNum !== null && bsrNum > 0 && bsrNum <= 5000);
    const isAmazonChoice = (revenue !== null && revenue > 20000);

    rawCandidates.push({
      asin,
      title,
      brand,
      price: priceNum ? `$${priceNum.toFixed(2)}` : priceStr || "$19.99",
      priceNum,
      revenue,
      monthlySales,
      parentSales,
      parentRevenue,
      recentPurchases,
      fees,
      bsr: bsrNum,
      bsrText: bsrStr ? `#${bsrStr}` : undefined,
      creationDate,
      sellerCountry,
      fulfillment,
      reviewVelocity,
      rating: ratingNum || 4.7,
      ratingText: `${ratingNum || 4.7} out of 5 stars`,
      reviewCount,
      img,
      isSponsored,
      isBestSeller,
      isAmazonChoice,
      categoryGroup: "top_organic",
      isRecommended: true,
    });
  }

  rawCandidates.sort((a, b) => (b.revenue || 0) - (a.revenue || 0));

  const result = classifyAndFilterCompetitors(rawCandidates, query);
  result.source = "helium10_xray_csv";

  const validRevenues = rawCandidates.map((c) => c.revenue).filter((r): r is number => typeof r === "number" && r > 0);
  if (validRevenues.length > 0) {
    const totalRevenue = validRevenues.reduce((a, b) => a + b, 0);
    result.stats.totalRevenue = Math.round(totalRevenue);
    result.stats.avgRevenue = Math.round(totalRevenue / validRevenues.length);
  }

  return result;
}
