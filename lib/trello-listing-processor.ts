import { z } from "zod";
import { generateListing, type ListingGenerationProgress } from "@/lib/ai";
import {
  detectRasterImageMimeType,
  prepareListingImagesForAi,
} from "@/lib/image-processing";
import { ApiError } from "@/lib/api-guard";
import { getBrandProfile, getUserTrelloSettings, saveGeneratedListing, type DataScope } from "@/lib/db";
import { resolveListingTemplateForBrand } from "@/lib/listing-template-resolver";
import { publishTrelloListingImages } from "@/lib/amazon-listing-image-publisher";
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
import { notifyLarkEventBestEffort } from "@/lib/lark-notifications";

const tinySamplePng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nJkAAAAASUVORK5CYII=";

function throwIfListingCancelled(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw signal.reason || new Error("Người dùng đã ngắt quá trình tạo Listing.");
  }
}

function inferProductType(itemName: string, defaultType = "") {
  return itemName?.trim() || defaultType;
}

export type ProgressEmitter = (event: TrelloListingStreamEvent) => void;

export interface SingleTrelloListingOptions {
  cardId: string;
  brandProfileId: string;
  marketplace?: "US" | "UK" | "DE";
  productType?: string;
  model?: string;
  shopId: string;
  templateId: string;
  scope: DataScope;
  actorRuleProfile?: string;
  publicOrigin?: string;
  emit?: ProgressEmitter;
  signal?: AbortSignal;
  skipNotification?: boolean;
}

export interface SingleTrelloListingResult {
  success: true;
  sku: string;
  itemName: string;
  listing: StoredListing;
  trelloAttachment: TrelloAttachment | null;
  updatedCard: Awaited<ReturnType<typeof fetchTrelloCardDetail>>;
  excelWorkbook?: Buffer | null;
  excelFileName?: string;
  timings_ms: Record<string, number>;
}

export async function executeSingleTrelloListing(
  options: SingleTrelloListingOptions
): Promise<SingleTrelloListingResult> {
  const {
    cardId,
    brandProfileId,
    marketplace = "US",
    productType,
    model,
    shopId,
    templateId,
    scope,
    actorRuleProfile = "",
    publicOrigin,
    emit = () => undefined,
    signal,
  } = options;

  const timings: Record<string, number> = {};
  const activeCardId = cardId;

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

  let cardDetail: any = null;
  try {
    throwIfListingCancelled(signal);

    const { apiKey, token } = getTrelloServerCredentials();
    const trelloSettings = await getUserTrelloSettings(scope);
    if (!trelloSettings.boardId || !trelloSettings.listingTargetListId) {
      throw new ApiError("Vui lòng cấu hình cột đích cho chức năng Listing.", 400);
    }

    // 1. Fetch card details & attachments from Trello
    const card = await runStage("card", () => fetchTrelloCardDetail(cardId, apiKey, token, signal));
    cardDetail = card;
    const { sku, itemName } = parseTrelloCardTitle(card.name);

    // 2. Load the Trello "Make cover" attachment
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
  const descriptionFacts = parseTrelloListingDescription(rawDesc);
  const descKeywords = descriptionFacts.genericKeywords;

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
    throw new ApiError(`Template "${dbTemplate.name}" chưa được cấu hình đủ các trường bắt buộc. Hãy nạp lại blank template để hoàn tất.`, 400);
  }
  if (dbTemplate.shop_id !== shopId || dbTemplate.shop_is_unassigned) {
    throw new ApiError("Template không thuộc shop Amazon đã chọn.", 400);
  }
  const resolvedTemplate = { workbook: dbTemplate.workbook, original_filename: dbTemplate.original_filename };
  emitProgress("template", "completed", Date.now() - templateStartedAt);

  // 5. Construct Listing Input
  const selectedModel = model || DEFAULT_OPENAI_MODEL;
  const usesOpenAIAdapter = selectedModel.startsWith("gpt") || isCheapKeyTextModel(selectedModel);

  const isPersonalized = Boolean(
    descriptionFacts.personalization ||
    /\b(custom|personalized|personalise|personalization|customized|customizable|tùy biến|cá nhân hóa|your photo|your name|photo here)\b/i.test(itemName + " " + rawDesc)
  );
  if (isPersonalized && !descriptionFacts.personalization) {
    descriptionFacts.personalization = "Customizable / Personalized with shopper's photo or text";
  }

  const rawInputPayload = {
    marketplace,
    product_type: computedProductType,
    internal_name: sku,
    brand: brandName,
    brand_profile_id: brandProfileId || "",
    brand_guidelines: brandGuidelines,
    product_information: buildTrelloAiProductInformation(descriptionFacts),
    main_keyword: itemName,
    related_keywords: descKeywords.slice(0, 5),
    backend_keywords: descKeywords,
    research: {
      target_customer: descriptionFacts.recipient || "",
      gift_giver: "",
      occasion: descriptionFacts.occasions || [],
      customer_insight: rawDesc,
      usp: itemName,
      competitor_asins: [],
      competitor_notes: "",
      notes: rawDesc,
    },
    images: loadedImages,
    configuration: {
      rule_profile: actorRuleProfile,
      ai_provider: usesOpenAIAdapter ? "openai" : "gemini",
      gemini_model: selectedModel && !usesOpenAIAdapter ? selectedModel : DEFAULT_GEMINI_MODEL,
      openai_model: usesOpenAIAdapter ? selectedModel : DEFAULT_OPENAI_MODEL,
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
  const exactCardKeywords = descriptionFacts.formattedGenericKeywords;
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
  let excelWorkbook: Buffer | null = null;
  let excelFileName = `${sku.toLowerCase()}-amazon-listing.xlsx`;
  let mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  try {
    await runStage("excel", async () => {
      const { createAmazonTemplate, createStandardListingExcel } = await import("@/lib/excel-automation");
      const publicImageUrls = await publishTrelloListingImages({
        scope,
        cardId,
        attachments: imageAttachments,
        apiKey,
        token,
        publicOrigin: publicOrigin || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:2411",
        signal,
      });
      const templateItem = {
        sku,
        image_urls: publicImageUrls,
        brand: stored.input.brand,
        listing: stored.current_listing,
        product_information: stored.input.product_information,
      };

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

  if (!options.skipNotification) {
    const baseUrl = publicOrigin || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:2411";
    const uploadedAttachment = attachment as TrelloAttachment | null;
    const downloadUrl = uploadedAttachment?.url || `${baseUrl}/api/trello/download-card-excel?cardId=${encodeURIComponent(card.id)}&shopId=${encodeURIComponent(shopId)}&templateId=${encodeURIComponent(templateId)}`;

    await notifyLarkEventBestEffort(scope, "listing", [
      `🎉 **Listing đã hoàn tất: ${sku}**`,
      `• Sản phẩm: ${itemName}`,
      `• Thẻ Trello: ${updatedCard.name || card.name} (${updatedCard.url || card.url || `https://trello.com/c/${card.id}`})`,
      `• 📥 **Link tải Excel:** ${downloadUrl}`,
    ]);
  }

  return {
    success: true,
    sku,
    itemName,
    listing: stored,
    trelloAttachment: attachment,
    updatedCard,
    excelWorkbook,
    excelFileName,
    timings_ms: timings,
  };
  } catch (error) {
    if (!options.skipNotification) {
      await notifyLarkEventBestEffort(scope, "listing", [
        `❌ **Listing thất bại: ${cardDetail?.name || cardId}**`,
        `• Lỗi: ${error instanceof Error ? error.message : String(error)}`,
      ]).catch(() => {});
    }
    throw error;
  }
}
