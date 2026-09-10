import { NextResponse } from "next/server";
import { mineHelium10Keywords } from "@/lib/helium10-playwright";
import { authorize, readJsonBody } from "@/lib/api-guard";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    authorize(request, "write");
    const body = (await readJsonBody(request)) as {
      asin?: string;
      keyword?: string;
      marketplace?: "US" | "UK" | "DE" | "JP" | "CA";
      limit?: number;
    };

    const query = (body.asin || body.keyword || "").trim();
    if (!query) {
      return NextResponse.json(
        { error: "Vui lòng nhập ASIN hoặc Seed Keyword để đào từ Helium 10." },
        { status: 400 },
      );
    }

    const result = await mineHelium10Keywords({
      asin: body.asin,
      keyword: body.keyword,
      marketplace: body.marketplace || "US",
      limit: body.limit || 500,
    });

    return NextResponse.json(result);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Không thể đào keyword từ Helium 10.";
    return NextResponse.json({ error: errorMsg }, { status: 400 });
  }
}
