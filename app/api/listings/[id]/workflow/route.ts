import { NextResponse } from "next/server";
import { getListing, setListingStatus } from "@/lib/db";
import { workflowStatusSchema } from "@/lib/schemas";
import { authorize, dataScope, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const scope = dataScope(authorize(request, "write"));
    enforceRequestSize(request, 10_000);
    const { id } = await params;
    const stored = await getListing(scope, id);
    if (!stored) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
    if (stored.status !== "Draft") {
      return NextResponse.json({ error: "Only a draft can be sent to review." }, { status: 409 });
    }
    const { status } = workflowStatusSchema.parse(await request.json());
    return NextResponse.json({ listing: await setListingStatus(scope, id, status) });
  } catch (error) {
    return routeErrorResponse(error, "Could not update workflow status.");
  }
}
