import { NextResponse } from "next/server";
import { getListing, updateListingContent } from "@/lib/db";
import { generatedListingSchema } from "@/lib/schemas";
import { buildAnalysisContext, inputWithResultResearch, revalidateStoredListing } from "@/lib/listing-analysis";
import { analyzeListing } from "@/lib/validation";
import { authorize, dataScope, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const scope = dataScope(authorize(request, "read"));
    const { id } = await params;
    const listing = await getListing(scope, id);
    if (!listing) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
    const current = revalidateStoredListing(listing);
    return NextResponse.json({ listing: { ...listing, input: current.input, result: current.result } });
  } catch (error) {
    return routeErrorResponse(error, "Could not load listing.", 500);
  }
}

export async function PUT(request: Request, { params }: RouteContext) {
  try {
    const scope = dataScope(authorize(request, "write"));
    enforceRequestSize(request, 100_000);
    const { id } = await params;
    const stored = await getListing(scope, id);
    if (!stored) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
    const content = generatedListingSchema.parse((await request.json()).listing);
    const input = inputWithResultResearch(stored.input, stored.result);
    const analysis = analyzeListing(content, input, buildAnalysisContext(input, stored.result));
    const result = {
      ...stored.result,
      status: analysis.policy_validation.passed ? ("success" as const) : ("needs_review" as const),
      listing: content,
      ...analysis,
    };
    const listing = await updateListingContent(scope, id, content, result, {
      action: "manual_edit",
      instruction: "Manual content edit",
      input,
    });
    return NextResponse.json({ listing });
  } catch (error) {
    return routeErrorResponse(error, "Could not save changes.");
  }
}
