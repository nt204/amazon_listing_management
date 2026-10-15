import { z } from "zod";
import JSZip from "jszip";
import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { isTemplateForShop } from "@/lib/amazon-template-shop";
import { isTemplateReady } from "@/lib/amazon-template-catalog";
import { createAmazonTemplate, createStandardListingExcel } from "@/lib/excel-automation";
import { getLatestListingForTrelloCard, getListing, getListingTemplate } from "@/lib/db";
import { resolveListingTemplateForBrand } from "@/lib/listing-template-resolver";
import { publicRequestOrigin, publishTrelloListingImages } from "@/lib/amazon-listing-image-publisher";
import {
  fetchTrelloCardDetail,
  parseTrelloCardTitle,
  selectTrelloListingImageAttachments,
} from "@/lib/trello";
import { getTrelloServerCredentials } from "@/lib/trello-server-config";

export const runtime = "nodejs";
export const maxDuration = 300;

const batchZipSchema = z.object({
  cardIds: z.array(z.string().min(1)).min(1, "Cần chọn ít nhất 1 thẻ"),
  shopId: z.string().uuid().optional(),
  templateId: z.string().uuid().optional(),
  batchId: z.string().optional(),
}).strict();

interface SingleCardExcelResult {
  cardId: string;
  sku: string;
  fileName: string;
  buffer: Buffer;
}

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "read");
    const scope = dataScope(actor);
    const body = await request.json();
    const { cardIds, shopId, templateId, batchId } = batchZipSchema.parse(body);

    const { apiKey, token } = getTrelloServerCredentials();

    let selectedTemplate: Awaited<ReturnType<typeof getListingTemplate>> | null = null;
    if (templateId) {
      selectedTemplate = await getListingTemplate(scope, templateId);
      if (selectedTemplate && shopId && !isTemplateForShop(selectedTemplate, shopId)) {
        throw new ApiError("Template không thuộc shop Amazon đã chọn.", 400);
      }
    }

    const zip = new JSZip();
    const excelResults: SingleCardExcelResult[] = [];
    const errors: Array<{ cardId: string; error: string }> = [];

    // Process each card to obtain its Excel workbook
    for (const cardId of cardIds) {
      try {
        let cardDetail: Awaited<ReturnType<typeof fetchTrelloCardDetail>> | null = null;
        if (/^[a-fA-F0-9]{24}$/.test(cardId)) {
          cardDetail = await fetchTrelloCardDetail(cardId, apiKey, token, request.signal);
        }

        const skuFromCard = cardDetail ? parseTrelloCardTitle(cardDetail.name).sku : "";

        // Always regenerate so old batches also receive durable public image URLs.
        const stored = await getLatestListingForTrelloCard(scope, cardId, skuFromCard)
          || await getListing(scope, cardId);

        if (!stored) {
          errors.push({ cardId, error: "Chưa có listing hoặc file Excel cho thẻ này." });
          continue;
        }

        const rawName = stored.input.internal_name || skuFromCard || "listing";
        const sku = parseTrelloCardTitle(rawName).sku;
        const listingContent = stored.current_listing || stored.result.listing;

        let imageUrls: string[] = [];
        if (cardDetail) {
          const imageAttachments = selectTrelloListingImageAttachments(cardDetail);
          imageUrls = await publishTrelloListingImages({
            scope,
            cardId,
            attachments: imageAttachments,
            apiKey,
            token,
            publicOrigin: publicRequestOrigin(request),
            signal: request.signal,
          });
        }
        if (imageUrls.length === 0) {
          imageUrls = (stored.input.images || []).slice(0, 7).map((img) => {
            return typeof img === "string" ? img : img.download_url || img.data_url || "";
          });
        }

        const templateItem = {
          sku,
          image_urls: imageUrls,
          brand: stored.input.brand || "",
          brand_profile_id: stored.input.brand_profile_id || undefined,
          listing: {
            title: listingContent.title,
            bullet_points: listingContent.bullet_points,
            description: listingContent.description,
            backend_search_terms: listingContent.backend_search_terms,
          },
          product_information: stored.input.product_information,
        };

        let excelBuffer: Buffer;
        let generatedFileName = `${sku.toLowerCase()}-amazon-listing.xlsx`;

        if (selectedTemplate && templateItem.brand && templateItem.brand_profile_id) {
          const resolvedTemplate = await resolveListingTemplateForBrand(scope, selectedTemplate.id, {
            id: templateItem.brand_profile_id,
            name: templateItem.brand,
          });

          if (resolvedTemplate && isTemplateReady(resolvedTemplate)) {
            const res = await createAmazonTemplate(
              resolvedTemplate.workbook,
              resolvedTemplate.original_filename,
              [templateItem],
            );
            excelBuffer = res.workbook;
            const safeShopName = resolvedTemplate.shop_name.replace(/[^A-Za-z0-9_-]/g, "-") || "shop";
            generatedFileName = `${safeShopName}-${sku.toLowerCase()}-amazon-template${res.extension}`;
          } else {
            const res = await createStandardListingExcel([templateItem]);
            excelBuffer = res.workbook;
          }
        } else {
          const res = await createStandardListingExcel([templateItem]);
          excelBuffer = res.workbook;
        }

        excelResults.push({
          cardId,
          sku,
          fileName: generatedFileName,
          buffer: excelBuffer,
        });
      } catch (cardErr) {
        console.error(`Error generating excel for card ${cardId} in batch zip:`, cardErr);
        errors.push({
          cardId,
          error: cardErr instanceof Error ? cardErr.message : "Không thể tạo file Excel",
        });
      }
    }

    if (excelResults.length === 0) {
      const details = errors.map((e) => e.error).join("; ");
      throw new ApiError(`Không tìm thấy file Excel nào để đóng gói ZIP. Chi tiết: ${details || "Các thẻ chưa có listing."}`, 404);
    }

    // Add files to zip with deduplicated filenames
    const seenNames = new Map<string, number>();
    for (const item of excelResults) {
      let finalName = item.fileName;
      const count = seenNames.get(finalName) || 0;
      if (count > 0) {
        const dotIndex = finalName.lastIndexOf(".");
        if (dotIndex !== -1) {
          finalName = `${finalName.slice(0, dotIndex)}_${count}${finalName.slice(dotIndex)}`;
        } else {
          finalName = `${finalName}_${count}`;
        }
      }
      seenNames.set(item.fileName, count + 1);
      zip.file(finalName, item.buffer);
    }

    const zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const nowStr = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const zipName = batchId ? `batch-${batchId}-listings.zip` : `batch-listings-${nowStr}.zip`;

    return new Response(new Uint8Array(zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zipName}"`,
        "Content-Length": String(zipBuffer.byteLength),
        "Cache-Control": "private, no-store",
        "X-Files-Count": String(excelResults.length),
        "X-Errors-Count": String(errors.length),
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tạo file ZIP cho batch.");
  }
}
