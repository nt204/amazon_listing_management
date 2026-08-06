import { NextResponse } from "next/server";
import { getListing, setListingStatusWithValidation } from "@/lib/db";
import { revalidateStoredListing } from "@/lib/listing-analysis";
import { authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const scope = dataScope(authorize(request, "approve"));
    const { id } = await params;
    const stored = await getListing(scope, id);
    if (!stored) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
    if (stored.status !== "Review") {
      return NextResponse.json({ error: "Send the listing to review before approving it." }, { status: 409 });
    }
    const current = revalidateStoredListing(stored);
    if (!current.analysis.policy_validation.passed) {
      return NextResponse.json({ error: "Resolve policy errors before approving this listing." }, { status: 409 });
    }
    return NextResponse.json({
      listing: await setListingStatusWithValidation(scope, id, "Approved", current.input, current.result),
    });
  } catch (error) {
    return routeErrorResponse(error, "Could not approve listing.", 500);
  }
}
