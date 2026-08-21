import { NextResponse } from "next/server";
import { mineSellerSpriteKeywords } from "@/lib/sellersprite";
import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    authorize(request, "write");
    const body = (await readJsonBody(request)) as {
      asin?: string;
      keyword?: string;
      marketplace?: "US" | "UK" | "DE" | "JP";
      limit?: number;
    };

    const query = (body.asin || body.keyword || "").trim();
    if (!query) {
      return NextResponse.json(
        { error: "Vui lòng nhập ASIN hoặc Seed Keyword để đào." },
        { status: 400 },
      );
    }

    const result = await mineSellerSpriteKeywords({
      asin: body.asin,
      keyword: body.keyword,
      marketplace: body.marketplace || "US",
      limit: body.limit || 30,
    });

    return NextResponse.json(result);
  } catch (error) {
    return routeErrorResponse(error, "Không thể đào keyword từ SellerSprite.", 500);
  }
}
