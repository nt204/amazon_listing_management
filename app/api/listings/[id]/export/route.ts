import { NextResponse } from "next/server";
import { getListing, setListingStatusWithValidation } from "@/lib/db";
import { buildListingDeskCsv } from "@/lib/csv";
import { revalidateStoredListing } from "@/lib/listing-analysis";
import { authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const scope = dataScope(authorize(request, "export"));
    const { id } = await params;
    const stored = await getListing(scope, id);
    if (!stored) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
    if (stored.status !== "Approved") {
      return NextResponse.json({ error: "Only approved listings can be exported." }, { status: 409 });
    }
    const current = revalidateStoredListing(stored);
    if (!current.analysis.policy_validation.passed) {
      await setListingStatusWithValidation(scope, id, "Review", current.input, current.result);
      return NextResponse.json(
        { error: "The listing no longer passes the current policy and was returned to review." },
        { status: 409 },
      );
    }
    const validated = { ...stored, input: current.input, result: current.result };
    const csv = buildListingDeskCsv([validated]);
    const filename = `${stored.input.internal_name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "listing"}-listing-desk.csv`;
    return NextResponse.json({
      csv,
      filename,
      export_format: "listing-desk-v1",
      listing: await setListingStatusWithValidation(scope, id, "Exported", current.input, current.result),
    });
  } catch (error) {
    return routeErrorResponse(error, "Could not export listing.", 500);
  }
}
