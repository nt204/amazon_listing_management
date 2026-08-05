import { NextResponse } from "next/server";
import { listListings } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ listings: await listListings() });
  } catch (error) {
    console.error("List listings failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load listing history." },
      { status: 503 },
    );
  }
}
