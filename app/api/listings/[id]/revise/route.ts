import { NextResponse } from "next/server";
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
import { mergeReviewEvidence } from "@/lib/review";
import { reviewInstructionSchema } from "@/lib/schemas";
import { authorize, dataScope, enforceRateLimit, enforceRequestSize, idempotencyKey, routeErrorResponse } from "@/lib/api-guard";

export const runtime = "nodejs";
export const maxDuration = 150;
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  let scope: DataScope | undefined;
  let endpoint = "";
  let requestKey = "";
  let claimed = false;
  try {
    const actor = authorize(request, "write");
    scope = dataScope(actor);
    enforceRequestSize(request, 16_000);
    await enforceRateLimit(actor, "ai-revision");
    const { id } = await params;
    endpoint = `/api/listings/${id}/revise`;
    requestKey = idempotencyKey(request);
    const idempotency = await claimIdempotency(scope, endpoint, requestKey);
    if (idempotency.state === "pending") {
      return NextResponse.json({ error: "A revision with this Idempotency-Key is still processing." }, { status: 409 });
    }
    if (idempotency.state === "complete") {
      const listing = await getListing(scope, String(idempotency.response.listing_id || id));
      return NextResponse.json({ listing }, { headers: { "Idempotent-Replayed": "true" } });
    }
    claimed = true;
    const stored = await getListingWithAiImages(scope, id);
    if (!stored) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
    if (!stored.result.product_analysis) {
      return NextResponse.json(
        { error: "This listing has no evidence brief to support a safe revision." },
        { status: 409 },
      );
    }
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
      signal: request.signal,
    });
    const result = {
      ...revised,
      request_id: stored.id,
    };
    const listing = await updateListingContent(scope, stored.id, result.listing, result, {
      action: "ai_revision",
      instruction,
      input: evidence.input,
    });
    await completeIdempotency(scope, endpoint, requestKey, { listing_id: stored.id }, 200);
    return NextResponse.json({ listing });
  } catch (error) {
    if (claimed && scope && endpoint && requestKey) {
      await releaseIdempotency(scope, endpoint, requestKey).catch(() => undefined);
    }
    return routeErrorResponse(error, "Could not revise the listing.");
  }
}
