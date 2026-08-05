import { NextResponse } from "next/server";
import { z } from "zod";
import { generateListing } from "@/lib/ai";
import { getListing, updateListingContent } from "@/lib/db";
import { analyzeListing } from "@/lib/validation";
import { buildListingStrategy } from "@/lib/listing-strategy";

export const runtime = "nodejs";
export const maxDuration = 150;
type RouteContext = { params: Promise<{ id: string }> };

const requestSchema = z.object({
  field: z.enum(["title", "bullet_points", "description", "backend_search_terms"]),
  instruction: z.string().trim().max(500).optional(),
});

const fieldFeedback = {
  title:
    "Write a substantially new title. Improve natural keyword placement, preserve relevant exact artwork text, and remove redundant words.",
  bullet_points:
    "Write five substantially new bullets. Lead with verified technical facts and visible design evidence, with one distinct purpose per bullet.",
  description:
    "Write a substantially new concise description. Keep it factual, specific, and within the target length without repeating the bullets.",
  backend_search_terms:
    "Write substantially new backend search terms. Expand relevant synonym coverage beyond the title without duplicate words.",
} as const;

export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const stored = await getListing(id);
  if (!stored) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  try {
    const { field, instruction } = requestSchema.parse(await request.json());
    const enrichedInput = stored.result.competitor_profile
      ? {
          ...stored.input,
          research: {
            ...stored.input.research,
            competitor_profile: stored.result.competitor_profile,
          },
        }
      : stored.input;
    const regenerated = await generateListing(enrichedInput, {
      productBrief: stored.result.product_analysis,
      writingFeedback: [fieldFeedback[field], instruction].filter(Boolean).join("\n"),
    });
    const content = {
      ...stored.current_listing,
      [field]: regenerated.listing[field],
    };
    const brief = regenerated.product_analysis || stored.result.product_analysis;
    const analysis = analyzeListing(content, enrichedInput, {
      relatedKeywords: brief?.related_keywords,
      suppliedFacts: brief?.supplied_facts,
      factsToAvoid: brief?.facts_to_avoid,
      policyRisks: brief?.policy_risks,
      blockedTerms: stored.result.competitor_profile?.blocked_terms,
      competitorProfile: stored.result.competitor_profile,
      listingStrategy: buildListingStrategy(enrichedInput, brief),
    });
    const result = {
      ...stored.result,
      model_used: regenerated.model_used,
      fallback_used: regenerated.fallback_used,
      image_analysis: regenerated.image_analysis,
      product_analysis: brief,
      status: analysis.policy_validation.passed ? ("success" as const) : ("needs_review" as const),
      listing: content,
      ...analysis,
      metadata: regenerated.metadata,
    };
    return NextResponse.json({
      listing: await updateListingContent(id, content, result, {
        action: `regenerated:${field}`,
        instruction: instruction || fieldFeedback[field],
      }),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not regenerate field." },
      { status: 400 },
    );
  }
}
