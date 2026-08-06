import { NextResponse } from "next/server";
import { z } from "zod";
import { inspectCompetitorReferences } from "@/lib/competitor";
import { authorize, enforceRateLimit, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";

export const runtime = "nodejs";
export const maxDuration = 10;

const requestSchema = z.object({
  value: z.string().trim().min(1).max(4_000),
  marketplace: z.enum(["US", "UK", "DE"]),
});

export async function POST(request: Request) {
  try {
    const actor = authorize(request, "write");
    enforceRequestSize(request, 16_000);
    await enforceRateLimit(actor, "reference-research", Number(process.env.REFERENCE_RATE_LIMIT_PER_MINUTE || 20));
    const { value, marketplace } = requestSchema.parse(await request.json());
    const startedAt = Date.now();
    const references = await inspectCompetitorReferences(value, marketplace);
    const contentCount = references.filter((reference) => reference.content).length;
    return NextResponse.json({
      resolved: references.length > 0,
      resolved_count: references.length,
      content_count: contentCount,
      content_available: contentCount > 0,
      elapsed_ms: Date.now() - startedAt,
    });
  } catch (error) {
    return routeErrorResponse(error, "Could not inspect reference listing.");
  }
}
