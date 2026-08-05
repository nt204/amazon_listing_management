import { NextResponse } from "next/server";
import { getListing, setListingStatus } from "@/lib/db";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  if (!(await getListing(id))) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  return NextResponse.json({ listing: await setListingStatus(id, "Exported") });
}
