import { NextResponse } from "next/server";
import { z } from "zod";
import { inspectCompetitorReference } from "@/lib/competitor";

export const runtime = "nodejs";
export const maxDuration = 10;

const requestSchema = z.object({
  value: z.string().trim().min(1).max(4_000),
  marketplace: z.enum(["US", "UK", "DE"]),
});

export async function POST(request: Request) {
  try {
    const { value, marketplace } = requestSchema.parse(await request.json());
    const startedAt = Date.now();
    const reference = await inspectCompetitorReference(value, marketplace);
    return NextResponse.json({
      resolved: reference.resolved,
      asin: reference.asin,
      content_available: Boolean(reference.content),
      elapsed_ms: Date.now() - startedAt,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not inspect reference listing." },
      { status: 400 },
    );
  }
}
