import { NextResponse } from "next/server";
import { getListing, setListingStatus } from "@/lib/db";
import { buildSellerCentralCsv } from "@/lib/csv";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const stored = await getListing(id);
  if (!stored) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  if (stored.status !== "Approved") {
    return NextResponse.json(
      { error: "Only approved listings can be exported." },
      { status: 409 },
    );
  }
  const csv = buildSellerCentralCsv([stored]);
  const filename = `${stored.input.internal_name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "listing"}-seller-central.csv`;
  return NextResponse.json({
    csv,
    filename,
    listing: await setListingStatus(id, "Exported"),
  });
}
