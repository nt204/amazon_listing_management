import { NextResponse } from "next/server";
import { z } from "zod";
import { generateListing, type ListingGenerationProgress } from "@/lib/ai";
import {
  detectRasterImageMimeType,
  prepareListingImagesForAi,
} from "@/lib/image-processing";
import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { getBrandProfile, getUserTrelloSettings, saveGeneratedListing } from "@/lib/db";
import { resolveListingTemplateForBrand } from "@/lib/listing-template-resolver";
import { publicRequestOrigin, publishTrelloListingImages } from "@/lib/amazon-listing-image-publisher";
import { isTemplateReady } from "@/lib/amazon-template-catalog";
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_OPENAI_MODEL,
  isCheapKeyTextModel,
} from "@/lib/models";
import { listingInputSchema } from "@/lib/schemas";
import type { StoredListing } from "@/lib/types";
import { invalidateCachePattern } from "@/lib/redis";
import {
  TRELLO_LISTING_STAGE_UI,
  type TrelloListingStage,
  type TrelloListingStreamEvent,
} from "@/lib/trello-listing-progress";
import {
  attachFileToTrelloCard,
  buildTrelloAiProductInformation,
  downloadTrelloAttachment,
  fetchTrelloCardDetail,
  moveTrelloCard,
  parseTrelloListingDescription,
  parseTrelloCardTitle,
  selectTrelloListingImageAttachments,
  type TrelloAttachment,
} from "@/lib/trello";
import { getTrelloServerCredentials } from "@/lib/trello-server-config";

export const runtime = "nodejs";
const processCardSchema = z.object({
  cardId: z.string().min(1, "cardId là bắt buộc"),
  brandProfileId: z.uuid("Hãy chọn Brand trước khi tạo listing."),
  marketplace: z.enum(["US", "UK", "DE"]).default("US"),
  productType: z.string().optional(),
  model: z.string().optional(),
  shopId: z.uuid("Shop Amazon không hợp lệ."),
  templateId: z.uuid("Template Amazon không hợp lệ."),
}).strict();

type ProgressEmitter = (event: TrelloListingStreamEvent) => void;

interface ProcessCardResult {
  success: true;
  sku: string;
  itemName: string;
  listing: StoredListing;
  trelloAttachment: TrelloAttachment | null;
  updatedCard: Awaited<ReturnType<typeof fetchTrelloCardDetail>>;
  timings_ms: Record<string, number>;
}

import { executeSingleTrelloListing } from "@/lib/trello-listing-processor";

async function processCardRequest(
  request: Request,
  emit: ProgressEmitter = () => undefined,
  signal: AbortSignal = request.signal,
): Promise<ProcessCardResult> {
  const actor = await authorize(request, "write");
  const scope = dataScope(actor);
  const body = await request.json();
  const { cardId, brandProfileId, marketplace, productType, model, shopId, templateId } = processCardSchema.parse(body);

  const result = await executeSingleTrelloListing({
    cardId,
    brandProfileId,
    marketplace,
    productType,
    model,
    shopId,
    templateId,
    scope,
    actorRuleProfile: actor.ruleProfile || "",
    publicOrigin: publicRequestOrigin(request),
    emit,
    signal,
  });

  return result as ProcessCardResult;
}

function streamProcessCard(request: Request) {
  const encoder = new TextEncoder();
  const abortController = new AbortController();
  const relayRequestAbort = () => abortController.abort(request.signal.reason);
  if (request.signal.aborted) relayRequestAbort();
  else request.signal.addEventListener("abort", relayRequestAbort, { once: true });
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit: ProgressEmitter = (event) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };
      void processCardRequest(request, emit, abortController.signal)
        .then((result) => {
          emit({
            type: "complete",
            card_id: result.updatedCard.id,
            sku: result.sku,
            attachment: result.trelloAttachment,
            message: result.trelloAttachment
              ? "Đã tạo listing, đính kèm Excel và cập nhật thẻ Trello."
              : "Đã tạo listing. Cần kiểm tra lại bước đính kèm Excel trên Trello.",
            progress: 100,
            timings_ms: result.timings_ms,
          });
        })
        .catch((error) => {
          emit({
            type: "error",
            card_id: "",
            message: error instanceof Error ? error.message : "Không thể xử lý thẻ Trello.",
          });
        })
        .finally(() => {
          request.signal.removeEventListener("abort", relayRequestAbort);
          if (!closed) {
            closed = true;
            controller.close();
          }
        });
    },
    cancel() {
      closed = true;
      abortController.abort(new Error("Người dùng đã ngắt quá trình tạo Listing."));
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(request: Request) {
  if (request.headers.get("accept")?.includes("application/x-ndjson")) {
    return streamProcessCard(request);
  }
  try {
    return NextResponse.json(await processCardRequest(request));
  } catch (error) {
    return routeErrorResponse(error, "Không thể xử lý thẻ Trello.");
  }
}
