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
import { isTemplateReady } from "@/lib/amazon-template-catalog";
import { DEFAULT_GEMINI_MODEL, DEFAULT_OPENAI_MODEL } from "@/lib/models";
import { listingInputSchema } from "@/lib/schemas";
import type { ListingTemplateSummary } from "@/lib/types";
import type { StoredListing } from "@/lib/types";
import { invalidateCachePattern } from "@/lib/redis";
import {
  TRELLO_LISTING_STAGE_UI,
  type TrelloListingStage,
  type TrelloListingStreamEvent,
} from "@/lib/trello-listing-progress";
import {
  attachFileToTrelloCard,
  downloadTrelloAttachment,
  fetchTrelloCardDetail,
  formatRawTrelloKeywords,
  moveTrelloCard,
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

const tinySamplePng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nJkAAAAASUVORK5CYII=";

function throwIfListingCancelled(signal: AbortSignal) {
  if (signal.aborted) {
    throw signal.reason || new Error("Người dùng đã ngắt quá trình tạo Listing.");
  }
}

function inferProductType(itemName: string, defaultType = "3D Card") {
  const lower = itemName.toLowerCase();
  if (lower.includes("card")) return "Greeting Card";
  if (lower.includes("mug")) return "Mug";
  if (lower.includes("shirt") || lower.includes("t-shirt")) return "Apparel";
  if (lower.includes("ornament")) return "Hanging Ornament";
  if (lower.includes("tumbler")) return "Tumbler";
  return defaultType;
}

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

async function processCardRequest(
  request: Request,
  emit: ProgressEmitter = () => undefined,
  signal: AbortSignal = request.signal,
): Promise<ProcessCardResult> {
  const timings: Record<string, number> = {};
  let activeCardId = "";
  const emitProgress = (
    stage: TrelloListingStage,
    status: "started" | "completed",
    durationMs?: number,
  ) => {
    if (durationMs !== undefined) timings[stage] = durationMs;
    const copy = TRELLO_LISTING_STAGE_UI[stage];
    emit({
      type: "progress",
      card_id: activeCardId,
      stage,
      status,
      message: copy[status],
      progress: status === "started" ? copy.started_progress : copy.progress,
      duration_ms: durationMs,
      timings_ms: { ...timings },
    });
  };
  const runStage = async <T>(stage: TrelloListingStage, operation: () => Promise<T> | T) => {
    emitProgress(stage, "started");
    const startedAt = Date.now();
    try {
      return await operation();
    } finally {
      emitProgress(stage, "completed", Date.now() - startedAt);
    }
  };

  const actor = authorize(request, "write");
  const scope = dataScope(actor);
  const body = await request.json();
  const { cardId, brandProfileId, marketplace, productType, shopId, templateId } = processCardSchema.parse(body);
  activeCardId = cardId;
  throwIfListingCancelled(signal);

  const { apiKey, token } = getTrelloServerCredentials();
  const trelloSettings = await getUserTrelloSettings(scope);
  if (!trelloSettings.boardId || !trelloSettings.listingTargetListId) {
    throw new ApiError("Vui lòng cấu hình cột đích cho chức năng Listing.", 400);
  }

  // 1. Fetch card details & attachments from Trello
  const card = await runStage("card", () => fetchTrelloCardDetail(cardId, apiKey, token, signal));
  const { sku, itemName } = parseTrelloCardTitle(card.name);

  // 2. Load the Trello "Make cover" attachment, with filename-based fallbacks.
  const imageAttachments = selectTrelloListingImageAttachments(card);

  const loadedImages: Array<{ name: string; type: string; data_url: string }> = [];

  emitProgress("image_download", "started");
  const imageDownloadStartedAt = Date.now();
  if (imageAttachments.length > 0) {
    const att = imageAttachments[0];
    try {
      const buffer = await downloadTrelloAttachment(att.url, apiKey, token, 50_000_000, signal);
      const mimeType = detectRasterImageMimeType(buffer);
      loadedImages.push({
        name: att.name || `${sku}-design.png`,
        type: mimeType,
        data_url: `data:${mimeType};base64,${buffer.toString("base64")}`,
      });
    } catch (err) {
      throwIfListingCancelled(signal);
      console.warn(`Lỗi khi tải ảnh thiết kế gốc Trello ${att.name}:`, err);
    }
  }

  if (loadedImages.length === 0) {
    loadedImages.push({
      name: `${sku}-mockup-sample.png`,
      type: "image/png",
      data_url: tinySamplePng,
    });
  }
  emitProgress("image_download", "completed", Date.now() - imageDownloadStartedAt);

  // 3. Extract generic keywords from card description
  const rawDesc = (card.desc || "").trim();
  const genericKwLine = rawDesc.split(/\r?\n/).find((line) => /(?:generic|backend)?\s*keywords?\s*:/i.test(line));
  const descKeywords = genericKwLine
    ? genericKwLine.replace(/^.*?(?:generic|backend)?\s*keywords?\s*:\s*/i, "").split(/[,;]/).map((k) => k.trim()).filter((k) => k.length > 1)
    : [];

  // 4. Resolve Brand
  const profile = await getBrandProfile(scope, brandProfileId);
  if (!profile) throw new ApiError("Brand không còn tồn tại.", 404);
  const brandName = profile.name;
  const brandGuidelines = profile.guidelines;

  const computedProductType = productType || inferProductType(itemName);

  emitProgress("template", "started");
  const templateStartedAt = Date.now();
  const dbTemplate = await resolveListingTemplateForBrand(scope, templateId, {
    id: brandProfileId || undefined,
    name: brandName,
  });
  if (!dbTemplate) {
    throw new ApiError(`Brand ${brandName} chưa có blank cho loại phôi đã chọn. Hãy tải blank từ Seller Central ${brandName}.`, 400);
  }
  if (!isTemplateReady(dbTemplate)) {
    throw new ApiError(`Template "${dbTemplate.name}" là file blank chưa thể dùng. Hãy mở file Excel điền dòng mẫu Parent/Child hoặc tải lên phôi đã điền từ shop khác.`, 400);
  }
  if (dbTemplate.shop_id !== shopId || dbTemplate.shop_is_unassigned) {
    throw new ApiError("Template không thuộc shop Amazon đã chọn.", 400);
  }
  const resolvedTemplate = { workbook: dbTemplate.workbook, original_filename: dbTemplate.original_filename };
  const templateDefaults: ListingTemplateSummary["metadata"]["defaults"] = dbTemplate.metadata.defaults;
  emitProgress("template", "completed", Date.now() - templateStartedAt);

  // 5. Construct Listing Input
  const selectedModel = body.model || "";
  const isGpt = selectedModel.startsWith("gpt");

  const rawInputPayload = {
    marketplace,
    product_type: computedProductType,
    internal_name: sku,
    brand: brandName,
    brand_profile_id: brandProfileId || "",
    brand_guidelines: brandGuidelines,
    product_information: {
      material: templateDefaults?.material || "",
      size_capacity: templateDefaults?.size_capacity || "",
      color: templateDefaults?.color || "",
      package_contents: templateDefaults?.package_contents || "",
      features: [...(templateDefaults?.features || [])],
      personalization: "",
      care_instructions: "",
      country_of_origin: templateDefaults?.country_of_origin || "",
    },
    main_keyword: itemName,
    related_keywords: descKeywords.slice(0, 5),
    backend_keywords: descKeywords,
    research: {
      target_customer: "",
      gift_giver: "",
      occasion: ["Birthday", "Celebration", "Special Occasion"],
      customer_insight: rawDesc,
      usp: itemName,
      competitor_asins: [],
      competitor_notes: "",
      notes: rawDesc,
    },
    images: loadedImages,
    configuration: {
      rule_profile: actor.ruleProfile || "",
      ai_provider: isGpt ? "openai" : selectedModel ? "gemini" : "auto",
      gemini_model: selectedModel && !isGpt ? selectedModel : DEFAULT_GEMINI_MODEL,
      openai_model: isGpt ? selectedModel : DEFAULT_OPENAI_MODEL,
      language: "English",
      tone: "Persuasive, benefit-led, natural, and evidence-grounded",
      bullet_count: 5,
      title_length: 200,
      bullet_length: 300,
      generate_description: true,
      generate_search_terms: true,
    },
  };

  const input = await runStage("image_prepare", () => prepareListingImagesForAi(
    listingInputSchema.parse(rawInputPayload),
  ));
  throwIfListingCancelled(signal);

  // 6. Generate AI Listing
  const onAiProgress = (progress: ListingGenerationProgress) => {
    emitProgress(progress.stage, progress.status, progress.duration_ms);
  };
  const result = await generateListing(input, { signal, onProgress: onAiProgress });
  throwIfListingCancelled(signal);
  result.metadata.stage_timings_ms = {
    ...timings,
    ...result.metadata.stage_timings_ms,
  };
  const exactCardKeywords = formatRawTrelloKeywords(rawDesc);
  if (exactCardKeywords) {
    result.listing.backend_search_terms = exactCardKeywords;
  }
  const stored = await runStage("database", () => saveGeneratedListing(scope, input, result, {
    sourceTrelloCardId: cardId,
  }));

  if (!stored) {
    throw new Error("Không thể lưu kết quả Listing vào cơ sở dữ liệu.");
  }
  stored.result.metadata.stage_timings_ms = { ...timings };

  emit({
    type: "listing_ready",
    card_id: cardId,
    sku,
    item_name: itemName,
    listing: stored,
    message: "Listing đã sẵn sàng. Excel và Trello đang tiếp tục xử lý nền.",
    progress: TRELLO_LISTING_STAGE_UI.listing_ready.progress,
    timings_ms: { ...timings },
  });
  throwIfListingCancelled(signal);

  // 7. Resolve corresponding Amazon Excel Template (.xlsx) & Fill AI generated content
  const templateItem = {
    sku,
    image_urls: imageAttachments.map((a) => a.url),
    brand: stored.input.brand,
    listing: stored.current_listing,
    product_information: stored.input.product_information,
  };

  let excelWorkbook: Buffer | null = null;
  let excelFileName = `${sku.toLowerCase()}-amazon-listing.xlsx`;
  let mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  try {
    await runStage("excel", async () => {
      const { createAmazonTemplate, createStandardListingExcel } = await import("@/lib/excel-automation");

      if (resolvedTemplate) {
        try {
          const res = await createAmazonTemplate(
            resolvedTemplate.workbook,
            resolvedTemplate.original_filename,
            [templateItem],
          );
          excelWorkbook = res.workbook;
          excelFileName = `${sku.toLowerCase()}-amazon-template${res.extension}`;
          if (res.extension === ".xlsm") {
            mimeType = "application/vnd.ms-excel.sheet.macroEnabled.12";
          }
        } catch (fillErr) {
          console.error("Lỗi khi điền nội dung AI vào Amazon Template, dùng fallback:", fillErr);
          const res = await createStandardListingExcel([templateItem]);
          excelWorkbook = res.workbook;
        }
      } else {
        const res = await createStandardListingExcel([templateItem]);
        excelWorkbook = res.workbook;
      }
    });
  } catch (excelError) {
    throwIfListingCancelled(signal);
    console.error("Lỗi khi tạo file Listing Excel:", excelError);
    emit({
      type: "warning",
      card_id: cardId,
      stage: "excel",
      message: "Listing đã lưu nhưng chưa thể tạo file Excel.",
      timings_ms: { ...timings },
    });
  }

  // 8. Attach Excel (.xlsx) file back to Trello Card
  throwIfListingCancelled(signal);
  let attachment: TrelloAttachment | null = null;
  await runStage("trello_upload", async () => {
    if (!excelWorkbook) return;
    try {
      attachment = await attachFileToTrelloCard(
        card.id,
        excelWorkbook,
        excelFileName,
        mimeType,
        apiKey,
        token,
        signal,
      );
    } catch (attachErr) {
      throwIfListingCancelled(signal);
      console.error("Lỗi khi đính kèm file Listing Excel vào Trello card:", attachErr);
      emit({
        type: "warning",
        card_id: cardId,
        stage: "trello_upload",
        message: "Listing đã lưu nhưng chưa thể đính kèm file Excel lên Trello.",
        timings_ms: { ...timings },
      });
    }
  });

  // 9. Move the Trello card to the user's configured Listing target list.
  throwIfListingCancelled(signal);
  let updatedCard = card;
  const finalTargetListId = trelloSettings.listingTargetListId;

  await runStage("trello_move", async () => {
    try {
      updatedCard = await moveTrelloCard(card.id, finalTargetListId, apiKey, token, "top", signal);
    } catch (moveErr) {
      throwIfListingCancelled(signal);
      console.error("Lỗi khi chuyển thẻ Trello sang cột đích Listing:", moveErr);
      emit({
        type: "warning",
        card_id: cardId,
        stage: "trello_move",
        message: "Listing đã lưu nhưng chưa thể chuyển thẻ sang cột đích đã chọn.",
        timings_ms: { ...timings },
      });
    }
  });

  // Invalidate Redis card cache so board view updates immediately on client reload/sync
  await invalidateCachePattern("trello:listing:*").catch(() => null);

  emitProgress("complete", "completed", 0);
  console.info("[listing timing]", JSON.stringify({ card_id: cardId, sku, timings_ms: timings }));

  return {
    success: true,
    sku,
    itemName,
    listing: stored,
    trelloAttachment: attachment,
    updatedCard,
    timings_ms: timings,
  };
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
