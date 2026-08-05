import { NextResponse } from "next/server";
import { generateListing } from "@/lib/ai";
import { getListing, updateListingContent } from "@/lib/db";
import { mergeReviewEvidence } from "@/lib/review";
import { reviewInstructionSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 150;
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const stored = await getListing(id);
  if (!stored) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  if (!stored.result.product_analysis) {
    return NextResponse.json(
      { error: "This listing has no evidence brief to support a safe revision." },
      { status: 409 },
    );
  }

  try {
    const { instruction } = reviewInstructionSchema.parse(await request.json());
    const evidence = mergeReviewEvidence(
      stored.input,
      stored.result.product_analysis,
      instruction,
    );
    if (stored.result.competitor_profile) {
      evidence.input.research.competitor_profile = stored.result.competitor_profile;
    }
    const revised = await generateListing(evidence.input, {
      productBrief: evidence.brief,
      currentListing: stored.current_listing,
      reviewInstruction: instruction,
    });
    const result = {
      ...revised,
      request_id: stored.id,
    };
    const listing = await updateListingContent(stored.id, result.listing, result, {
      action: "ai_revision",
      instruction,
      input: evidence.input,
    });
    return NextResponse.json({ listing });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not revise the listing." },
      { status: 400 },
    );
  }
}
