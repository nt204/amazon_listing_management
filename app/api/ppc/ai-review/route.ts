import { NextResponse } from "next/server";
import { authorize, dataScope, enforceRateLimit, routeErrorResponse } from "@/lib/api-guard";
import type { PpcRecommendation } from "@/lib/ppc/types";
import { reviewPpcRecommendationWithAi } from "@/lib/ppc/ai-review-service";

export const maxDuration = 60; // Allow sufficient time for gpt-5.6-terra

export async function POST(req: Request) {
  try {
    const actor = await authorize(req, "read", "ppc");
    const scope = dataScope(actor);
    await enforceRateLimit(actor, "ppc-ai-review", 10, 60);
    const body = await req.json();
    const rec: PpcRecommendation = body.recommendation;

    if (!rec || !rec.id) {
      return NextResponse.json({ error: "Missing recommendation in request body" }, { status: 400 });
    }

    const review = await reviewPpcRecommendationWithAi(scope.teamId, rec);
    return NextResponse.json({ success: true, ...review });
  } catch (error: unknown) {
    console.error("[PPC AI Review API] Failed:", error);
    return routeErrorResponse(error, "Internal error running AI Review", 500);
  }
}
