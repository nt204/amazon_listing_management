import { NextResponse } from "next/server";
import { getListing, setListingStatus } from "@/lib/db";
import { analyzeListing } from "@/lib/validation";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const stored = await getListing(id);
  if (!stored) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  if (stored.status !== "Review") {
    return NextResponse.json(
      { error: "Send the listing to review before approving it." },
      { status: 409 },
    );
  }
  const brief = stored.result.product_analysis;
  const validation = analyzeListing(stored.current_listing, stored.input, {
    relatedKeywords: brief?.related_keywords,
    suppliedFacts: brief?.supplied_facts,
    factsToAvoid: brief?.facts_to_avoid,
    policyRisks: brief?.policy_risks,
  });
  if (!validation.policy_validation.passed) {
    return NextResponse.json(
      { error: "Resolve policy errors before approving this listing." },
      { status: 409 },
    );
  }
  return NextResponse.json({ listing: await setListingStatus(id, "Approved") });
}
