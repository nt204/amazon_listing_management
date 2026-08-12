import { NextResponse } from "next/server";
import { z } from "zod";
import { generateListing } from "@/lib/ai";
import {
  claimIdempotency,
  completeIdempotency,
  getListing,
  getListingWithAiImages,
  releaseIdempotency,
  updateListingContent,
  type DataScope,
} from "@/lib/db";
import { analyzeListing } from "@/lib/validation";
import { buildAnalysisContext } from "@/lib/listing-analysis";
import { getRuleProfile } from "@/lib/rules";
import { authorize, dataScope, enforceRateLimit, enforceRequestSize, idempotencyKey, routeErrorResponse } from "@/lib/api-guard";

export const runtime = "nodejs";
export const maxDuration = 150;
type RouteContext = { params: Promise<{ id: string }> };

const requestSchema = z.object({
  field: z.enum(["title", "bullet_points", "description", "backend_search_terms"]),
  instruction: z.string().trim().max(500).optional(),
});

export async function POST(request: Request, { params }: RouteContext) {
  let scope: DataScope | undefined;
  let endpoint = "";
  let requestKey = "";
  let claimed = false;
  try {
    const actor = authorize(request, "write");
    scope = dataScope(actor);
    enforceRequestSize(request, 16_000);
    await enforceRateLimit(actor, "ai-regeneration");
    const { id } = await params;
    endpoint = `/api/listings/${id}/regenerate`;
    requestKey = idempotencyKey(request);
    const idempotency = await claimIdempotency(scope, endpoint, requestKey);
    if (idempotency.state === "pending") {
      return NextResponse.json({ error: "A regeneration with this Idempotency-Key is still processing." }, { status: 409 });
    }
    if (idempotency.state === "complete") {
      const listing = await getListing(scope, String(idempotency.response.listing_id || id));
      return NextResponse.json({ listing }, { headers: { "Idempotent-Replayed": "true" } });
    }
    claimed = true;
    const stored = await getListingWithAiImages(scope, id);
    if (!stored) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
    const { field, instruction } = requestSchema.parse(await request.json());
    const fieldFeedback = getRuleProfile(stored.input).generation.field_revision_rules;
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
      signal: request.signal,
    });
    const content = {
      ...stored.current_listing,
      [field]: regenerated.listing[field],
    };
    const brief = regenerated.product_analysis || stored.result.product_analysis;
    const analysis = analyzeListing(content, enrichedInput, buildAnalysisContext(enrichedInput, {
      product_analysis: brief,
      competitor_profile: stored.result.competitor_profile,
    }));
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
    const listing = await updateListingContent(scope, id, content, result, {
        action: `regenerated:${field}`,
        instruction: instruction || fieldFeedback[field],
        input: enrichedInput,
      });
    await completeIdempotency(scope, endpoint, requestKey, { listing_id: id }, 200);
    return NextResponse.json({ listing });
  } catch (error) {
    if (claimed && scope && endpoint && requestKey) {
      await releaseIdempotency(scope, endpoint, requestKey).catch(() => undefined);
    }
    return routeErrorResponse(error, "Could not regenerate field.");
  }
}
