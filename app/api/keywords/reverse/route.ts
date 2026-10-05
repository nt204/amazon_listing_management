import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/api-guard";
import { reverseSellerSpriteKeywords } from "@/lib/sellersprite";
import { mineHelium10Keywords } from "@/lib/helium10-playwright";

export const runtime = "nodejs";
export const maxDuration = 60;

export interface UnifiedReverseKeywordItem {
  keyword: string;
  search_volume: number | null;
  cpc: number | null;
  aba_rank: number | null;
  organic_rank: number | null;
  relevance_score: number | null;
  competing_products: number | null;
  asin_count: number;
  matched_asins: string[];
}

export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request)) as {
      asins?: string[];
      productTitle?: string;
      marketplace?: "US" | "UK" | "DE" | "JP";
      tool?: "sellersprite" | "helium10" | "auto";
      limit?: number;
    };

    const asins = (Array.isArray(body.asins) ? body.asins : [])
      .map((a) => String(a || "").trim())
      .filter((a) => /^[A-Z0-9]{10}$/i.test(a));

    const productTitle = String(body.productTitle || "").trim();
    const marketplace = body.marketplace || "US";
    const tool = body.tool || "helium10"; // Default: Helium 10
    const limit = Math.min(500, Math.max(10, body.limit || 200));

    if (asins.length === 0) {
      return NextResponse.json(
        { error: "Vui lòng chọn ít nhất 1 ASIN hợp lệ để thực hiện Reverse từ khóa." },
        { status: 400 }
      );
    }

    if (tool === "helium10") {
      // 100% Authentic Helium 10 Cerebro Reverse
      const h10Result = await mineHelium10Keywords({
        asins,
        keyword: productTitle || asins.join(" "),
        marketplace: marketplace as any,
        limit,
      });

      const keywords: UnifiedReverseKeywordItem[] = (h10Result.keywords || []).map((k) => ({
        keyword: k.keyword,
        search_volume: k.search_volume,
        cpc: k.cpc,
        aba_rank: null,
        organic_rank: k.organic_rank,
        relevance_score: k.iq_score,
        competing_products: k.competing_products,
        asin_count: asins.length,
        matched_asins: asins,
      }));

      return NextResponse.json({
        asins,
        productTitle,
        marketplace,
        totalKeywords: h10Result.totalResults || keywords.length,
        keywords,
        source: "helium10_live",
      });
    }

    // Authentic SellerSprite Reverse API
    const { keywords, total } = await reverseSellerSpriteKeywords(asins, marketplace, limit);

    return NextResponse.json({
      asins,
      productTitle,
      marketplace,
      totalKeywords: total,
      keywords,
      source: "sellersprite_live",
    });
  } catch (error) {
    console.error("Reverse ASIN failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lỗi khi thực hiện Reverse ASIN." },
      { status: 500 }
    );
  }
}
