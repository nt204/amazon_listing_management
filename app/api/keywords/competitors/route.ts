import { NextResponse } from "next/server";
import { crawlAndClassifyCompetitors } from "@/lib/amazon-asin-crawler";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const query = String(body?.query || "").trim();
    const marketplace = String(body?.marketplace || "US").toUpperCase();

    if (!query) {
      return NextResponse.json(
        { error: "Vui lòng nhập Seed Keyword để crawl ASIN đối thủ." },
        { status: 400 }
      );
    }

    const result = await crawlAndClassifyCompetitors(query, marketplace);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Competitor ASIN search failed:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Không thể crawl danh sách ASIN đối thủ từ Amazon.",
      },
      { status: 500 }
    );
  }
}
