import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authorize,
  readJsonBody,
  routeErrorResponse,
} from "@/lib/api-guard";
import { buildMockupConcept } from "@/lib/mockup-generator";

export const runtime = "nodejs";

const promptPreviewSchema = z.object({
  promptKey: z.string().trim().min(1).max(30_000),
  dimensions: z.object({
    length: z.string().max(100),
    width: z.string().max(100),
    thickness: z.string().max(100),
    formatted: z.string().max(300),
    capacity: z.string().max(100).optional(),
  }),
});

export async function POST(request: Request) {
  try {
    authorize(request, "read");
    const input = promptPreviewSchema.parse(await readJsonBody(request, 50_000));
    return NextResponse.json({
      prompt: buildMockupConcept(input.promptKey, input.dimensions),
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải prompt của mockup.");
  }
}
