import { NextResponse } from "next/server";
import { getListing, setListingStatus } from "@/lib/db";
import { workflowStatusSchema } from "@/lib/schemas";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const stored = await getListing(id);
  if (!stored) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  if (stored.status !== "Draft") {
    return NextResponse.json(
      { error: "Only a draft can be sent to review." },
      { status: 409 },
    );
  }
  try {
    const { status } = workflowStatusSchema.parse(await request.json());
    return NextResponse.json({ listing: await setListingStatus(id, status) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update workflow status." },
      { status: 400 },
    );
  }
}
