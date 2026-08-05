import { NextResponse } from "next/server";
import { getListing, setListingStatus } from "@/lib/db";
import { analyzeListing } from "@/lib/validation";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const stored = await getListing(id);
  if (!stored) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  const validation = analyzeListing(stored.current_listing, stored.input);
  if (!validation.policy_validation.passed) {
    return NextResponse.json(
      { error: "Resolve policy errors before approving this listing." },
      { status: 409 },
    );
  }
  return NextResponse.json({ listing: await setListingStatus(id, "Approved") });
}
