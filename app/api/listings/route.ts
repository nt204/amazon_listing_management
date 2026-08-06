import { NextResponse } from "next/server";
import { getWorkflowMetrics, listListings } from "@/lib/db";
import { authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const scope = dataScope(authorize(request, "read"));
    const [listings, metrics] = await Promise.all([listListings(scope, 100), getWorkflowMetrics(scope)]);
    return NextResponse.json({ listings, metrics });
  } catch (error) {
    return routeErrorResponse(error, "Could not load listing history.", 503);
  }
}
