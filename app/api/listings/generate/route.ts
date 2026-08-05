import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { generateListing } from "@/lib/ai";
import { getBrandProfile, saveGeneratedListing } from "@/lib/db";
import { listingInputSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 150;

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    if (!String(payload.internal_name || "").trim()) {
      payload.internal_name =
        String(payload.main_keyword || "").trim() ||
        `${String(payload.product_type || "Product").trim()} listing`;
    }
    if (typeof payload.brand !== "string") payload.brand = "";
    let input = listingInputSchema.parse(payload);
    if (input.brand_profile_id) {
      const profile = await getBrandProfile(input.brand_profile_id);
      if (!profile) {
        return NextResponse.json({ error: "Brand profile not found." }, { status: 400 });
      }
      input = {
        ...input,
        brand: profile.name,
        brand_guidelines: profile.guidelines,
      };
    }
    const result = await generateListing(input);
    const stored = await saveGeneratedListing(input, result);
    return NextResponse.json({ listing: stored }, { status: 201 });
  } catch (error) {
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
    console.error("Generate listing failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Listing generation failed." },
      { status: 502 },
    );
  }
}
