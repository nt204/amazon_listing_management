import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { generateListing } from "@/lib/ai";
import {
  claimIdempotency,
  completeIdempotency,
  getBrandProfile,
  getListing,
  releaseIdempotency,
  saveGeneratedListing,
  type DataScope,
} from "@/lib/db";
import { listingInputSchema } from "@/lib/schemas";
import { prepareListingImagesForAi } from "@/lib/image-processing";
import type { ListingInput } from "@/lib/types";
import {
  authorize,
  dataScope,
  enforceRateLimit,
  idempotencyKey,
  readJsonBody,
  routeErrorResponse,
} from "@/lib/api-guard";

export const runtime = "nodejs";
export const maxDuration = 150;

export async function POST(request: Request) {
  const endpoint = "/api/listings/generate";
  let scope: DataScope | undefined;
  let requestKey = "";
  let claimed = false;
  try {
    const actor = authorize(request, "write");
    scope = dataScope(actor);
    await enforceRateLimit(actor, "ai-generation");
    requestKey = idempotencyKey(request);
    const idempotency = await claimIdempotency(scope, endpoint, requestKey);
    if (idempotency.state === "pending") {
      return NextResponse.json({ error: "A request with this Idempotency-Key is still processing." }, { status: 409 });
    }
    if (idempotency.state === "complete") {
      const listingId = String(idempotency.response.listing_id || "");
      const listing = listingId ? await getListing(scope, listingId) : null;
      if (listing) return NextResponse.json({ listing }, { status: idempotency.statusCode, headers: { "Idempotent-Replayed": "true" } });
      throw new Error("The idempotent result no longer exists.");
    }
    claimed = true;
    const payload = await readJsonBody(request) as Record<string, unknown>;
    if (!String(payload.internal_name || "").trim()) {
      payload.internal_name =
        String(payload.main_keyword || "").trim() ||
        `${String(payload.product_type || "Product").trim()} listing`;
    }
    if (typeof payload.brand !== "string") payload.brand = "";
    let input: ListingInput = listingInputSchema.parse(payload);
    if (actor.ruleProfile) {
      input = { ...input, configuration: { ...input.configuration, rule_profile: actor.ruleProfile } };
    }
    if (input.brand_profile_id) {
      const profile = await getBrandProfile(scope, input.brand_profile_id);
      if (!profile) {
        return NextResponse.json({ error: "Brand profile not found." }, { status: 400 });
      }
      input = {
        ...input,
        brand: profile.name,
        brand_guidelines: profile.guidelines,
      };
    }
    input = await prepareListingImagesForAi(input);
    const result = await generateListing(input, { signal: request.signal });
    const stored = await saveGeneratedListing(scope, input, result);
    if (!stored) throw new Error("Generated listing could not be stored.");
    await completeIdempotency(scope, endpoint, requestKey, { listing_id: stored.id }, 201);
    return NextResponse.json({ listing: stored }, { status: 201 });
  } catch (error) {
    if (claimed && scope && requestKey) await releaseIdempotency(scope, endpoint, requestKey).catch(() => undefined);
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Please check the required fields.",
          issues: error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 },
      );
    }
    return routeErrorResponse(error, "Listing generation failed.", 502);
  }
}
