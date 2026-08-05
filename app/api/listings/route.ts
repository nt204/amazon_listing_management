import { NextResponse } from "next/server";
import { getWorkflowMetrics, listListings } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const [listings, metrics] = await Promise.all([listListings(100), getWorkflowMetrics()]);
    return NextResponse.json({ listings, metrics });
  } catch (error) {
    console.error("List listings failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load listing history." },
      { status: 503 },
    );
  }
}
