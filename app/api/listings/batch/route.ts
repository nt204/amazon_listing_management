import { NextResponse } from "next/server";
import { generateListing } from "@/lib/ai";
import {
  claimIdempotency,
  completeIdempotency,
  getBrandProfile,
  getListing,
  releaseIdempotency,
  saveGeneratedListing,
} from "@/lib/db";
import { batchListingSchema } from "@/lib/schemas";
import type { ListingInput, StoredListing } from "@/lib/types";
import { ApiError, authorize, dataScope, enforceRateLimit, idempotencyKey, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import type { DataScope } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

async function resolveBrandProfile(scope: DataScope, input: ListingInput) {
  if (!input.brand_profile_id) return input;
  const profile = await getBrandProfile(scope, input.brand_profile_id);
  if (!profile) throw new Error(`Brand profile not found for ${input.internal_name}.`);
  return { ...input, brand: profile.name, brand_guidelines: profile.guidelines };
}
export async function POST(request: Request) {
  const endpoint = "/api/listings/batch";
  let scope: DataScope | undefined;
  let requestKey = "";
  let claimed = false;
  try {
    const actor = authorize(request, "write");
    scope = dataScope(actor);
    await enforceRateLimit(actor, "ai-batch", Number(process.env.AI_BATCH_RATE_LIMIT_PER_MINUTE || 3));
    requestKey = idempotencyKey(request);
    const idempotency = await claimIdempotency(scope, endpoint, requestKey);
    if (idempotency.state === "pending") {
      return NextResponse.json({ error: "A batch with this Idempotency-Key is still processing." }, { status: 409 });
    }
    if (idempotency.state === "complete") {
      const stored = Array.isArray(idempotency.response.results) ? idempotency.response.results : [];
      const results = await Promise.all(stored.map(async (item) => {
        const record = item as { index: number; listing_id?: string; error?: string };
        return record.listing_id
          ? { index: record.index, listing: await getListing(scope!, record.listing_id) }
          : { index: record.index, error: record.error || "Listing generation failed." };
      }));
      return NextResponse.json({ results }, { status: 207, headers: { "Idempotent-Replayed": "true" } });
    }
    claimed = true;
    const activeScope = scope;
    const parsed = batchListingSchema.parse(await readJsonBody(request));
    const maxSyncItems = Math.min(10, Math.max(1, Number(process.env.MAX_SYNC_BATCH_ITEMS || 4)));
    if (parsed.items.length > maxSyncItems) {
      throw new ApiError(`A synchronous batch supports at most ${maxSyncItems} items. Split larger imports into chunks.`, 400);
    }
    const items = actor.ruleProfile
      ? parsed.items.map((item) => ({
          ...item,
          configuration: { ...item.configuration, rule_profile: actor.ruleProfile },
        }))
      : parsed.items;
    const results: Array<
      { index: number; listing: StoredListing | null; error?: never } | { index: number; error: string; listing?: never }
    > = new Array(items.length);
    let cursor = 0;

    const worker = async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        try {
          const input = await resolveBrandProfile(activeScope, items[index]);
          const generated = await generateListing(input, { signal: request.signal });
          results[index] = { index, listing: await saveGeneratedListing(activeScope, input, generated) };
        } catch (error) {
          results[index] = {
            index,
            error: error instanceof Error ? error.message : "Listing generation failed.",
          };
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(2, items.length) }, () => worker()));
    await completeIdempotency(activeScope, endpoint, requestKey, {
      results: results.map((item) => item.listing
        ? { index: item.index, listing_id: item.listing.id }
        : { index: item.index, error: item.error }),
    }, 207);
    return NextResponse.json({ results }, { status: 207 });
  } catch (error) {
    if (claimed && scope && requestKey) await releaseIdempotency(scope, endpoint, requestKey).catch(() => undefined);
    return routeErrorResponse(error, "Could not process the batch.");
  }
}
