import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

export interface AmazonCompetitorCandidate {
  asin: string;
  title: string;
  brand: string;
  price: string;
  priceNum: number | null;
  revenue?: number | null;
  monthlySales?: number | null;
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
  const idxBsr = getColIdx(["bsr"]);
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

    const revStr = idxRevenue !== -1 ? row[idxRevenue]?.replace(/[^0-9.]/g, "") || "" : "";
    const revenue = revStr ? parseFloat(revStr) : null;

    const bsrStr = idxBsr !== -1 ? row[idxBsr] || "" : "";
    const bsrNum = bsrStr ? parseInt(bsrStr.replace(/[^0-9]/g, ""), 10) : null;

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

  // Sort by Revenue descending if revenue exists
  rawCandidates.sort((a, b) => (b.revenue || 0) - (a.revenue || 0));

  const result = classifyAndFilterCompetitors(rawCandidates, query);
  result.source = "helium10_xray_csv";

  // Calculate revenue stats
  const validRevenues = rawCandidates.map((c) => c.revenue).filter((r): r is number => typeof r === "number" && r > 0);
  if (validRevenues.length > 0) {
    const totalRevenue = validRevenues.reduce((a, b) => a + b, 0);
    result.stats.totalRevenue = Math.round(totalRevenue);
    result.stats.avgRevenue = Math.round(totalRevenue / validRevenues.length);
  }

  return result;
}

const MONOPOLY_BRANDS = [
  "yeti", "stanley", "hydro flask", "contigo", "starbucks", "thermos", 
  "disney", "nike", "apple", "under armour", "champion", "tervis"
];

function extractBrandFromTitle(title: string): string {
  const clean = title.trim();
  const firstWord = clean.split(/[\s\-:,]+/)[0] || "";
  return firstWord;
}

function parsePriceNumber(priceStr: string): number | null {
  if (!priceStr) return null;
  const match = priceStr.match(/[\$£€]?\s*(\d+(?:[.,]\d+)?)/);
  if (!match) return null;
  return parseFloat(match[1].replace(/,/g, ""));
}

function parseRatingNumber(ratingStr: string): number | null {
  if (!ratingStr) return null;
  const match = ratingStr.match(/(\d+(?:\.\d+)?)\s*(?:out of|\/)/i) || ratingStr.match(/^(\d+(?:\.\d+)?)/);
  if (!match) return null;
  return parseFloat(match[1]);
}

function parseReviewCount(reviewStr: string): number {
  if (!reviewStr) return 0;
  const clean = reviewStr.replace(/[^0-9]/g, "");
  return parseInt(clean, 10) || 0;
}

/**
 * Scrapes Amazon US Search Results Page using Chromium
 */
export async function scrapeAmazonSearchPage(query: string, marketplace: string = "US"): Promise<AmazonCompetitorCandidate[]> {
  const macChromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_PATH || (existsSync(macChromePath) ? macChromePath : undefined);

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      viewport: { width: 1366, height: 900 },
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    const page = await context.newPage();
    const domain = marketplace === "UK" ? "amazon.co.uk" : "amazon.com";
    const searchUrl = `https://www.${domain}/s?k=${encodeURIComponent(query)}&ref=nb_sb_noss`;

    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: 35000,
    });
    await page.waitForTimeout(2000);

    const rawList = await page.$$eval("div[data-asin]", (elements) => {
      return elements.map((el) => {
        const asin = el.getAttribute("data-asin")?.trim() || "";
        if (!asin || asin.length !== 10) return null;

        const titleEl = el.querySelector("h2 a span, h2 span, a.a-link-normal span.a-text-normal");
        const title = titleEl ? titleEl.textContent?.trim() || "" : "";
        if (!title || title.length < 5) return null;

        const priceEl = el.querySelector(".a-price .a-offscreen, .a-price-whole");
        const price = priceEl ? priceEl.textContent?.trim() || "" : "";

        const ratingEl = el.querySelector("i.a-icon-star-small span, .a-icon-alt");
        const rating = ratingEl ? ratingEl.textContent?.trim() || "" : "";

        const reviewEl = el.querySelector("span.a-size-base.s-underline-text, a[href*='#customerReviews'] span, .s-c-review-count span");
        const reviews = reviewEl ? reviewEl.textContent?.trim() || "" : "";

        const imgEl = el.querySelector("img.s-image");
        const img = imgEl ? imgEl.getAttribute("src") || "" : "";

        const isSponsored = Boolean(
          el.querySelector(".puis-sponsored-label-text, .s-sponsored-label-info-icon, .puis-label-popover-default")
        );
        const isBestSeller = Boolean(
          el.querySelector(".a-badge-text, .a-badge-label") &&
          el.textContent?.toLowerCase().includes("best seller")
        );
        const isAmazonChoice = Boolean(
          el.textContent?.toLowerCase().includes("overall pick") ||
          el.textContent?.toLowerCase().includes("amazon's choice")
        );

        return {
          asin,
          title,
          price,
          rating,
          reviews,
          img,
          isSponsored,
          isBestSeller,
          isAmazonChoice,
        };
      }).filter(Boolean);
    });

    await context.close();

    // Map and filter raw items
    const candidates: AmazonCompetitorCandidate[] = [];
    const seenAsins = new Set<string>();

    for (const item of rawList) {
      if (!item || seenAsins.has(item.asin)) continue;
      seenAsins.add(item.asin);

      const brand = extractBrandFromTitle(item.title);
      const priceNum = parsePriceNumber(item.price);
      const ratingNum = parseRatingNumber(item.rating);
      const reviewCount = parseReviewCount(item.reviews);

      candidates.push({
        asin: item.asin,
        title: item.title,
        brand,
        price: item.price || "$15.99",
        priceNum: priceNum || 15.99,
        rating: ratingNum || 4.7,
        ratingText: item.rating || "4.7 out of 5 stars",
        reviewCount,
        img: item.img,
        isSponsored: item.isSponsored,
        isBestSeller: item.isBestSeller,
        isAmazonChoice: item.isAmazonChoice,
        categoryGroup: "top_organic",
        isRecommended: true,
      });
    }

    return candidates;
  } catch (err) {
    console.error("Playwright Amazon Search error:", err);
    return [];
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

/**
 * Applies smart multi-criteria filtering & classifies candidates into 4 diverse groups (10-15 recommended)
 */
export function classifyAndFilterCompetitors(
  candidates: AmazonCompetitorCandidate[],
  mainQuery: string
): AmazonCompetitorSearchResult {
  const classified: AmazonCompetitorCandidate[] = [];
  const queryTokens = mainQuery.toLowerCase().split(/\s+/).filter(Boolean);
  const coreNoun = queryTokens[queryTokens.length - 1] || "";

  // 1. Calculate price quartiles for price clustering
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

  // Track allocation quotas (Total target 10-15 ASINs)
  // - Top Organic: 5-7
  // - Best Seller: 2-3
  // - Direct Competitor (Same price & target): 2-3
  // - Outlier / Cross-Niche: 1-2
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
    if ((item.isBestSeller || item.isAmazonChoice || item.reviewCount > 1500) && bestSellerCount < 3) {
      item.categoryGroup = "best_seller";
      item.isRecommended = true;
      bestSellerCount++;
    } else if (
      item.priceNum !== null &&
      Math.abs(item.priceNum - avgPrice) <= 5 &&
      item.reviewCount >= 80 &&
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
      // Remaining valid candidates
      item.categoryGroup = "top_organic";
      item.isRecommended = false; // Available for manual selection
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
      topBrands,
    },
  };
}

/**
 * Main Crawler & Classifier entry point
 */
export async function crawlAndClassifyCompetitors(
  query: string,
  marketplace: string = "US"
): Promise<AmazonCompetitorSearchResult> {
  const rawCandidates = await scrapeAmazonSearchPage(query, marketplace);
  return classifyAndFilterCompetitors(rawCandidates, query);
}
