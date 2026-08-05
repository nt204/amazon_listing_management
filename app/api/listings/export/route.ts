import { NextResponse } from "next/server";
import { z } from "zod";
import { buildSellerCentralCsv } from "@/lib/csv";
import { getListing, setListingStatus } from "@/lib/db";

export const runtime = "nodejs";

const requestSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});

export async function POST(request: Request) {
  try {
    const { ids } = requestSchema.parse(await request.json());
    const loaded = await Promise.all(ids.map((id) => getListing(id)));
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

    const csv = buildSellerCentralCsv(listings);
    const updated = await Promise.all(
      listings.map((listing) => setListingStatus(listing.id, "Exported")),
    );
    return NextResponse.json({
      csv,
      filename: `seller-central-${new Date().toISOString().slice(0, 10)}.csv`,
      listings: updated,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not export listings." },
      { status: 400 },
    );
  }
}
