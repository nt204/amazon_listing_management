import { NextResponse } from "next/server";
import { getListing, updateListingContent } from "@/lib/db";
import { generatedListingSchema } from "@/lib/schemas";
import { analyzeListing } from "@/lib/validation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const listing = await getListing(id);
  if (!listing) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  return NextResponse.json({ listing });
}

export async function PUT(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const stored = await getListing(id);
  if (!stored) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  try {
    const content = generatedListingSchema.parse((await request.json()).listing);
    const brief = stored.result.product_analysis;
    const analysis = analyzeListing(content, stored.input, {
      relatedKeywords: brief?.related_keywords,
      suppliedFacts: brief?.supplied_facts,
      factsToAvoid: brief?.facts_to_avoid,
      policyRisks: brief?.policy_risks,
    });
    const result = {
      ...stored.result,
      status: analysis.policy_validation.passed ? ("success" as const) : ("needs_review" as const),
      listing: content,
      ...analysis,
    };
    const listing = await updateListingContent(id, content, result);
    return NextResponse.json({ listing });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save changes." },
      { status: 400 },
    );
  }
}
