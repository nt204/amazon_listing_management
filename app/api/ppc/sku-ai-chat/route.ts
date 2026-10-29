import { z } from "zod";
import { ApiError, authorize, dataScope, enforceRateLimit, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { loadSkuChatState, resolveSkuThread, runSkuAiChat, type SkuChatEvent } from "@/lib/ppc/sku-ai-chat";
import { clearThread, deleteSkuNote, listSkuNotes } from "@/lib/ppc/sku-ai-chat-memory";

export const runtime = "nodejs";
export const maxDuration = 300;

const postSchema = z.object({
  storeId: z.string().trim().min(1).max(128),
  sku: z.string().trim().min(1).max(256),
  goal: z.enum(["BALANCED", "PROFIT", "SCALE", "LAUNCH", "LIQUIDATE"]).default("BALANCED"),
  message: z.string().trim().min(1).max(4000),
});

function readSkuParams(request: Request) {
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("storeId")?.trim() || "";
  const sku = searchParams.get("sku")?.trim() || "";
  if (!storeId || !sku || storeId.length > 128 || sku.length > 256) {
    throw new ApiError("Thiếu storeId hoặc sku.", 400);
  }
  return { storeId, sku, noteId: searchParams.get("noteId") };
}

/** Lịch sử chat của người dùng với SKU + ghi nhớ chung của SKU. */
export async function GET(request: Request) {
  try {
    const scope = dataScope(await authorize(request, "read", "ppc"));
    const { storeId, sku } = readSkuParams(request);
    const { messages, notes } = await loadSkuChatState(scope, storeId, sku);
    return Response.json({ success: true, messages, notes });
  } catch (error) {
    return routeErrorResponse(error, "Không tải được lịch sử AI chat.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "read", "ppc");
    await enforceRateLimit(actor, "ppc-sku-ai-chat", 20, 60);
    const input = postSchema.parse(await readJsonBody(request, 50_000));
    const scope = dataScope(actor);

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        const emit = (event: SkuChatEvent) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            closed = true;
          }
        };
        try {
          await runSkuAiChat({ ...input, scope }, emit, request.signal);
        } catch (error) {
          console.error("[SKU AI Chat] Failed:", error);
          emit({ type: "error", error: error instanceof Error ? error.message : "Lỗi AI chat." });
        } finally {
          closed = true;
          controller.close();
        }
      },
    });

    return new Response(body, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Không chạy được AI chat cho SKU.", 500);
  }
}

/** Có noteId: xóa 1 ghi nhớ của SKU. Không có: xóa cuộc hội thoại của người dùng (giữ ghi nhớ). */
export async function DELETE(request: Request) {
  try {
    const scope = dataScope(await authorize(request, "read", "ppc"));
    const { storeId, sku, noteId } = readSkuParams(request);
    const thread = await resolveSkuThread(scope, storeId, sku);
    if (noteId) {
      const id = Number(noteId);
      if (!Number.isInteger(id) || id <= 0) throw new ApiError("noteId không hợp lệ.", 400);
      await deleteSkuNote(thread, id);
      return Response.json({ success: true, notes: await listSkuNotes(thread) });
    }
    await clearThread(thread);
    return Response.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error, "Không xóa được.", 500);
  }
}
