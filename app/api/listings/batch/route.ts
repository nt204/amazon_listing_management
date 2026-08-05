import { NextResponse } from "next/server";
import { generateListing } from "@/lib/ai";
import { getBrandProfile, saveGeneratedListing } from "@/lib/db";
import { batchListingSchema } from "@/lib/schemas";
import type { ListingInput, StoredListing } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

async function resolveBrandProfile(input: ListingInput) {
  if (!input.brand_profile_id) return input;
  const profile = await getBrandProfile(input.brand_profile_id);
  if (!profile) throw new Error(`Brand profile not found for ${input.internal_name}.`);
  return { ...input, brand: profile.name, brand_guidelines: profile.guidelines };
}
export async function POST(request: Request) {
  try {
    const { items } = batchListingSchema.parse(await request.json());
    const results: Array<
      { index: number; listing: StoredListing | null; error?: never } | { index: number; error: string; listing?: never }
    > = new Array(items.length);
    let cursor = 0;

    const worker = async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        try {
          const input = await resolveBrandProfile(items[index]);
          const generated = await generateListing(input);
          results[index] = { index, listing: await saveGeneratedListing(input, generated) };
        } catch (error) {
          results[index] = {
            index,
            error: error instanceof Error ? error.message : "Listing generation failed.",
          };
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(2, items.length) }, () => worker()));
    return NextResponse.json({ results }, { status: 207 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not process the batch." },
      { status: 400 },
    );
  }
}
