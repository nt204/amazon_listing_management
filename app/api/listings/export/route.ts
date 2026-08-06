import { NextResponse } from "next/server";
import { z } from "zod";
import { buildListingDeskCsv } from "@/lib/csv";
import { getListing, setListingStatusWithValidation } from "@/lib/db";
import { revalidateStoredListing } from "@/lib/listing-analysis";
import { authorize, dataScope, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";

export const runtime = "nodejs";

const requestSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});

export async function POST(request: Request) {
  try {
    const scope = dataScope(authorize(request, "export"));
    enforceRequestSize(request, 100_000);
    const { ids } = requestSchema.parse(await request.json());
    const loaded = await Promise.all(ids.map((id) => getListing(scope, id)));
    const missing = loaded.findIndex((listing) => !listing);
    if (missing >= 0) {
      return NextResponse.json({ error: `Listing ${ids[missing]} was not found.` }, { status: 404 });
    }
    const listings = loaded.filter((listing) => listing !== null);
    const notApproved = listings.filter((listing) => listing.status !== "Approved");
    if (notApproved.length) {
      return NextResponse.json(
        { error: `${notApproved.length} listing(s) are not approved and were not exported.` },
        { status: 409 },
      );
    }

    const current = listings.map((listing) => ({ listing, validation: revalidateStoredListing(listing) }));
    const invalid = current.filter(({ validation }) => !validation.analysis.policy_validation.passed);
    if (invalid.length) {
      await Promise.all(invalid.map(({ listing, validation }) =>
        setListingStatusWithValidation(scope, listing.id, "Review", validation.input, validation.result),
      ));
      return NextResponse.json(
        { error: `${invalid.length} listing(s) no longer pass the current policy and were returned to review.` },
        { status: 409 },
      );
    }
    const validatedListings = current.map(({ listing, validation }) => ({
      ...listing,
      input: validation.input,
      result: validation.result,
    }));
    const csv = buildListingDeskCsv(validatedListings);
    const updated = await Promise.all(
      current.map(({ listing, validation }) =>
        setListingStatusWithValidation(scope, listing.id, "Exported", validation.input, validation.result),
      ),
    );
    return NextResponse.json({
      csv,
      filename: `listing-desk-${new Date().toISOString().slice(0, 10)}.csv`,
      export_format: "listing-desk-v1",
      listings: updated,
    });
  } catch (error) {
    return routeErrorResponse(error, "Could not export listings.");
  }
}
