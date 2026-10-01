import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/api-guard";
import { discoverCompetitors } from "@/lib/competitor-discovery/services/competitor-discovery.service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      productName?: string;
      marketplace?: string;
      limit?: number;
    };

    const productName = String(body?.productName || "").trim();
    const marketplace = String(body?.marketplace || "US").toUpperCase();
    const limit = typeof body?.limit === "number" ? Math.min(50, Math.max(1, body.limit)) : 10;

    if (!productName) {
      return NextResponse.json(
        { error: "Vui lòng cung cấp productName để thực hiện Competitor Discovery." },
        { status: 400 }
      );
    }

    const result = await discoverCompetitors({
      productName,
      marketplace,
      limit,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[CompetitorDiscovery] Error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Lỗi khi thực hiện Competitor Discovery.",
      },
      { status: 500 }
    );
  }
}
