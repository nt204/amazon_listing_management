import { NextResponse } from "next/server";
import { searchSellerSpriteCompetitors } from "@/lib/sellersprite";
import { discoverCompetitors } from "@/lib/competitor-discovery/services/competitor-discovery.service";
import type { AmazonCompetitorCandidate, AmazonCompetitorSearchResult } from "@/lib/amazon-asin-types";
import type { CandidateScoreWeights, ScoredCandidate } from "@/lib/competitor-discovery/domain/competitor.types";
import { decodeHtml } from "@/lib/competitor-discovery/domain/normalize";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const query = String(body?.query || "").trim();
    const marketplace = String(body?.marketplace || "US").toUpperCase();
    const rawWeights = body?.weights as Partial<CandidateScoreWeights> | undefined;
    const weights = rawWeights
      ? {
          relevance: Number(rawWeights.relevance),
          revenue: Number(rawWeights.revenue),
          sales: Number(rawWeights.sales),
          bsr: Number(rawWeights.bsr),
        }
      : undefined;
    if (weights) {
      const values = Object.values(weights);
      const total = values.reduce((sum, value) => sum + value, 0);
      if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 1) || Math.abs(total - 1) > 0.001) {
        return NextResponse.json({ error: "Tổng trọng số đánh giá phải bằng 100%." }, { status: 400 });
      }
    }

    if (!query) {
      return NextResponse.json(
        { error: "Vui lòng nhập Tên sản phẩm hoặc ASINs để tìm kiếm ASIN đối thủ." },
        { status: 400 }
      );
    }

    const isAsinList = /^[A-Z0-9]{10}$/i.test(query) || (query.includes(",") && query.length <= 150);

    // If query is an ASIN or list of ASINs, query SellerSprite directly by ASINs
    if (isAsinList) {
      const spriteResult = await searchSellerSpriteCompetitors(query, marketplace);
      return NextResponse.json(spriteResult);
    }

    // Full 7-stage Competitor Discovery Pipeline (SellerSprite + Gemini 3.7 Flash)
    const discovery = await discoverCompetitors({
      productName: query,
      marketplace,
      limit: 10,
      weights,
    });

    const mapToCandidate = (c: ScoredCandidate): AmazonCompetitorCandidate => {
      const badges = c.badges || [];
      const isBestSeller = badges.includes("BS");
      const isAmazonChoice = badges.includes("AC");

      return {
        asin: c.asin,
        title: decodeHtml(c.title),
        brand: decodeHtml(c.brand || ""),
        category: c.category || "",
        bsrCategory: c.category || "",
        price: c.price ? `$${c.price.toFixed(2)}` : "",
        priceNum: c.price ?? null,
        revenue: c.monthlyRevenue ?? null,
        monthlySales: c.monthlySales ?? null,
        fees: c.fees ?? null,
        bsr: c.bsr ?? null,
        bsrText: c.bsr ? `#${c.bsr.toLocaleString()} in ${c.category || "All"}` : "",
        sellerCountry: c.sellerCountry || "",
        fulfillment: c.sellerType || "FBA",
        rating: c.rating ?? null,
        ratingText: c.rating ? `${c.rating.toFixed(1)} out of 5 stars` : "",
        reviewCount: c.reviewCount ?? 0,
        img: c.image || "",
        isSponsored: c.placement === "sponsored",
        isBestSeller,
        isAmazonChoice,
        categoryGroup: c.placement === "sponsored"
          ? "sponsored"
          : isBestSeller
            ? "best_seller"
            : "top_organic",
        isRecommended: true,
        profit: c.profit ?? null,
        aiScore: c.scores?.relevance ?? null,
        aiReason: c.ai?.reason ?? null,
        finalScore: c.scores?.final ?? null,
        relevanceScore: c.scores?.relevance ?? null,
        revenueScore: c.scores?.revenue ?? null,
        salesScore: c.scores?.sales ?? null,
        bsrScore: c.scores?.bsr ?? null,
      };
    };

    const candidates: AmazonCompetitorCandidate[] = discovery.competitors.map(mapToCandidate);
    const allCandidates: AmazonCompetitorCandidate[] = (discovery.allEligible || discovery.competitors).map(mapToCandidate);

    const validPrices = candidates.map((c) => c.priceNum).filter((p): p is number => typeof p === "number" && p > 0);
    const avgPrice = validPrices.length > 0 ? Number((validPrices.reduce((a, b) => a + b, 0) / validPrices.length).toFixed(2)) : 0;
 
    const validReviews = candidates.map((c) => c.reviewCount).filter((r) => r > 0);
    const avgReviews = validReviews.length > 0 ? Math.round(validReviews.reduce((a, b) => a + b, 0) / validReviews.length) : 0;

    const validRatings = candidates.map((c) => c.rating).filter((r): r is number => typeof r === "number" && r > 0);
    const avgRating = validRatings.length > 0 ? Number((validRatings.reduce((a, b) => a + b, 0) / validRatings.length).toFixed(1)) : 0;

    const totalRevenue = Math.round(candidates.reduce((sum, c) => sum + (c.revenue || 0), 0));
    const totalUnits = candidates.reduce((sum, c) => sum + (c.monthlySales || 0), 0);

    const validBsrs = candidates.map((c) => c.bsr).filter((b): b is number => typeof b === "number" && b > 0);
    const avgBsr = validBsrs.length > 0 ? Math.round(validBsrs.reduce((a, b) => a + b, 0) / validBsrs.length) : 0;

    const brands = Array.from(new Set(candidates.map((c) => c.brand).filter(Boolean))).slice(0, 5);

    const result: AmazonCompetitorSearchResult = {
      query,
      marketplace,
      source: "sellersprite_live",
      totalFound: discovery.stats.raw,
      totalRecommended: candidates.length,
      candidates,
      allCandidates,
      recommendedAsins: candidates.map((c) => c.asin),
      stats: {
        avgPrice,
        avgReviews,
        avgRating,
        avgRevenue: candidates.length > 0 ? Math.round(totalRevenue / candidates.length) : 0,
        totalRevenue,
        avgBsr,
        totalUnits,
        topBrands: brands,
      },
      discoveryStats: discovery.stats,
      rejected: discovery.rejected,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("SellerSprite Competitor Discovery failed:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Lỗi khi lấy dữ liệu ASIN từ SellerSprite.",
      },
      { status: 500 }
    );
  }
}
