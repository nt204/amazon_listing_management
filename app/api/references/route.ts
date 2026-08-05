import { NextResponse } from "next/server";
import { z } from "zod";
import { inspectCompetitorReferences } from "@/lib/competitor";

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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not inspect reference listing." },
      { status: 400 },
    );
  }
}
