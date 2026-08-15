import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { generateListing } from "@/lib/ai";
import {
  detectRasterImageMimeType,
  prepareListingImagesForAi,
} from "@/lib/image-processing";
import { authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { getBrandProfile, getListingTemplate, listListingTemplates, saveGeneratedListing } from "@/lib/db";
import { DEFAULT_GEMINI_MODEL, DEFAULT_OPENAI_MODEL } from "@/lib/models";
import { listingInputSchema } from "@/lib/schemas";
import type { ListingTemplateSummary } from "@/lib/types";
import { invalidateCachePattern } from "@/lib/redis";
import {
  attachFileToTrelloCard,
  downloadTrelloAttachment,
  fetchTrelloCardDetail,
  fetchTrelloLists,
  formatRawTrelloKeywords,
  moveTrelloCard,
  parseTrelloCardTitle,
  selectTrelloImageAttachments,
  type TrelloAttachment,
} from "@/lib/trello";

export const runtime = "nodejs";
export const maxDuration = 150;

const processCardSchema = z.object({
  cardId: z.string().min(1, "cardId là bắt buộc"),
  targetListId: z.string().optional(),
  apiKey: z.string().optional(),
  token: z.string().optional(),
  brandProfileId: z.string().optional(),
  marketplace: z.enum(["US", "UK", "DE"]).default("US"),
  productType: z.string().optional(),
  model: z.string().optional(),
  templateId: z.string().optional(),
});

const tinySamplePng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nJkAAAAASUVORK5CYII=";

function inferProductType(itemName: string, defaultType = "3D Card") {
  const lower = itemName.toLowerCase();
  if (lower.includes("card")) return "Greeting Card";
  if (lower.includes("mug")) return "Mug";
  if (lower.includes("shirt") || lower.includes("t-shirt")) return "Apparel";
  if (lower.includes("ornament")) return "Hanging Ornament";
  if (lower.includes("tumbler")) return "Tumbler";
  return defaultType;
}

export async function POST(request: Request) {
  try {
    const actor = authorize(request, "write");
    const scope = dataScope(actor);
    const body = await request.json();
    const { cardId, targetListId, brandProfileId, marketplace, productType, templateId } = processCardSchema.parse(body);

    const apiKey = body.apiKey || process.env.TRELLO_API_KEY || "";
    const token = body.token || process.env.TRELLO_TOKEN || "";

    if (!apiKey || !token) {
      return NextResponse.json({ error: "Vui lòng cung cấp Trello API Key và Token." }, { status: 400 });
    }

    // 1. Fetch card details & attachments from Trello
    const card = await fetchTrelloCardDetail(cardId, apiKey, token);
    const { sku, itemName } = parseTrelloCardTitle(card.name);

    // 2. Load primary cover image attachment (Full Design) from Trello card
    const imageAttachments = selectTrelloImageAttachments(card);

    const loadedImages: Array<{ name: string; type: string; data_url: string }> = [];

    if (imageAttachments.length > 0) {
      const att = imageAttachments[0];
      try {
        const buffer = await downloadTrelloAttachment(att.url, apiKey, token);
        const mimeType = detectRasterImageMimeType(buffer);
        loadedImages.push({
          name: att.name || `${sku}-design.png`,
          type: mimeType,
          data_url: `data:${mimeType};base64,${buffer.toString("base64")}`,
        });
      } catch (err) {
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

    // 3. Extract generic keywords from card description
    const rawDesc = (card.desc || "").trim();
    const genericKwLine = rawDesc.split(/\r?\n/).find((line) => /(?:generic|backend)?\s*keywords?\s*:/i.test(line));
    const descKeywords = genericKwLine
      ? genericKwLine.replace(/^.*?(?:generic|backend)?\s*keywords?\s*:\s*/i, "").split(/[,;]/).map((k) => k.trim()).filter((k) => k.length > 1)
      : [];

    // 4. Resolve Brand
    let brandName = "Limima";
    let brandGuidelines = "";
    if (brandProfileId) {
      const profile = await getBrandProfile(scope, brandProfileId);
      if (profile) {
        brandName = profile.name;
        brandGuidelines = profile.guidelines;
      }
    }

    const computedProductType = productType || inferProductType(itemName);
    const defaultTemplatePath = join(process.cwd(), "examples", "HANGING_ORNAMENT_3_SKU_INPUT.xlsx");
    let resolvedTemplate: { workbook: Buffer; original_filename: string } | null = null;
    let templateDefaults: ListingTemplateSummary["metadata"]["defaults"] | undefined;

    if (templateId) {
      const dbTemplate = await getListingTemplate(scope, templateId);
      if (dbTemplate) {
        resolvedTemplate = { workbook: dbTemplate.workbook, original_filename: dbTemplate.original_filename };
        templateDefaults = dbTemplate.metadata.defaults;
      }
    }

    if (!resolvedTemplate && computedProductType) {
      try {
        const allTemplates = await listListingTemplates(scope);
        const match = allTemplates.find(
          (template) =>
            template.product_type?.toLowerCase() === computedProductType.toLowerCase() ||
            template.name.toLowerCase().includes(computedProductType.toLowerCase()),
        );
        if (match) {
          const dbTemplate = await getListingTemplate(scope, match.id);
          if (dbTemplate) {
            resolvedTemplate = { workbook: dbTemplate.workbook, original_filename: dbTemplate.original_filename };
            templateDefaults = dbTemplate.metadata.defaults;
          }
        }
      } catch (error) {
        console.warn("Không tìm thấy template tương ứng trong DB:", error);
      }
    }

    if (!resolvedTemplate && existsSync(defaultTemplatePath)) {
      resolvedTemplate = {
        workbook: readFileSync(defaultTemplatePath),
        original_filename: "HANGING_ORNAMENT_3_SKU_INPUT.xlsx",
      };
    }

    // 5. Construct Listing Input
    const selectedModel = body.model || "";
    const isGpt = selectedModel.startsWith("gpt");

    const rawInputPayload = {
      marketplace,
      product_type: computedProductType,
      internal_name: `${sku}_${itemName}`,
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

    const input = await prepareListingImagesForAi(
      listingInputSchema.parse(rawInputPayload),
    );

    // 6. Generate AI Listing
    const result = await generateListing(input, { signal: request.signal });
    const exactCardKeywords = formatRawTrelloKeywords(rawDesc);
    if (exactCardKeywords) {
      result.listing.backend_search_terms = exactCardKeywords;
    }
    const stored = await saveGeneratedListing(scope, input, result);

    if (!stored) {
      throw new Error("Không thể lưu kết quả Listing vào cơ sở dữ liệu.");
    }

    // 7. Resolve corresponding Amazon Excel Template (.xlsx) & Fill AI generated content
    const templateItem = {
      sku,
      image_urls: imageAttachments.map((a) => a.url),
      brand: stored.input.brand,
      listing: stored.current_listing,
      product_information: stored.input.product_information,
    };

    let excelWorkbook: Buffer;
    let excelFileName = `${sku.toLowerCase()}-amazon-listing.xlsx`;
    let mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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

    // 8. Attach Excel (.xlsx) file back to Trello Card
    let attachment: TrelloAttachment | null = null;
    try {
      attachment = await attachFileToTrelloCard(
        card.id,
        excelWorkbook,
        excelFileName,
        mimeType,
        apiKey,
        token,
      );
    } catch (attachErr) {
      console.error("Lỗi khi đính kèm file Listing Excel vào Trello card:", attachErr);
    }

    // 9. Move Trello Card to "Listing" list if targetListId provided (or auto-detected)
    let updatedCard = card;
    let finalTargetListId = targetListId;

    if (!finalTargetListId && (card.idBoard || process.env.TRELLO_BOARD_ID)) {
      try {
        const boardId = card.idBoard || process.env.TRELLO_BOARD_ID || "";
        const lists = await fetchTrelloLists(boardId, apiKey, token);
        const listingNameQuery = (process.env.TRELLO_LISTING_LIST || "Listing").trim().toLowerCase();
        const match = lists.find(
          (l) => l.name.trim().toLowerCase() === listingNameQuery || l.name.toLowerCase().includes("listing"),
        );
        if (match) {
          finalTargetListId = match.id;
        }
      } catch (detectErr) {
        console.warn("Cảnh báo không thể tự động tìm danh sách Listing trên Trello:", detectErr);
      }
    }

    if (finalTargetListId) {
      try {
        updatedCard = await moveTrelloCard(card.id, finalTargetListId, apiKey, token);
      } catch (moveErr) {
        console.error("Lỗi khi chuyển thẻ Trello sang cột Listing:", moveErr);
      }
    }

    // Invalidate Redis card cache so board view updates immediately on client reload/sync
    await invalidateCachePattern("trello:board:*").catch(() => null);

    return NextResponse.json({
      success: true,
      sku,
      itemName,
      listing: stored,
      trelloAttachment: attachment,
      updatedCard,
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể xử lý thẻ Trello.");
  }
}
