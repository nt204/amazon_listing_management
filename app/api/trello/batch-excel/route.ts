import { z } from "zod";
import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { isTemplateForShop } from "@/lib/amazon-template-shop";
import { isTemplateReady } from "@/lib/amazon-template-catalog";
import { getLatestListingForTrelloCard, getListingTemplate } from "@/lib/db";
import { createAmazonTemplate } from "@/lib/excel-automation";
import type { AmazonTemplateItem } from "@/lib/excel-batch";
import { resolveListingTemplateForBrand } from "@/lib/listing-template-resolver";
import { runWithConcurrency } from "@/lib/run-with-concurrency";
import {
  fetchTrelloCardDetail,
  selectTrelloListingImageAttachments,
} from "@/lib/trello";
import { getTrelloServerCredentials } from "@/lib/trello-server-config";
import { publicRequestOrigin, publishTrelloListingImages } from "@/lib/amazon-listing-image-publisher";

export const runtime = "nodejs";
export const maxDuration = 300;

const batchExcelSchema = z.object({
  cardIds: z.array(z.string().min(1)).min(1, "Cần chọn ít nhất 1 thẻ"),
  shopId: z.string().uuid(),
  templateId: z.string().uuid(),
  batchId: z.string().optional(),
}).strict();

interface ResolvedBatchItem {
  item: AmazonTemplateItem;
  templateId: string;
  template: NonNullable<Awaited<ReturnType<typeof getListingTemplate>>>;
}

function safeFilePart(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "read");
    const scope = dataScope(actor);
    const { cardIds, shopId, templateId, batchId } = batchExcelSchema.parse(await request.json());

    const selectedTemplate = await getListingTemplate(scope, templateId);
    if (!selectedTemplate) throw new ApiError("Template Amazon đã chọn không còn tồn tại.", 404);
    if (!isTemplateForShop(selectedTemplate, shopId)) {
      throw new ApiError("Template không thuộc shop Amazon của batch này.", 400);
    }

    const { apiKey, token } = getTrelloServerCredentials();
    const resolvedItems: Array<ResolvedBatchItem | null> = Array(cardIds.length).fill(null);
    const errors: string[] = [];

    await runWithConcurrency(cardIds, 8, async (cardId, index) => {
      try {
        const stored = await getLatestListingForTrelloCard(scope, cardId);
        if (!stored) throw new Error("không tìm thấy listing đã lưu");
        if (!stored.input.brand || !stored.input.brand_profile_id) {
          throw new Error("listing chưa có Brand hợp lệ");
        }

        const resolvedTemplate = await resolveListingTemplateForBrand(scope, templateId, {
          id: stored.input.brand_profile_id,
          name: stored.input.brand,
        });
        if (!resolvedTemplate) {
          throw new Error(`Brand ${stored.input.brand} chưa có blank cho loại phôi đã chọn`);
        }
        if (!isTemplateReady(resolvedTemplate) || !isTemplateForShop(resolvedTemplate, shopId)) {
          throw new Error(`blank của Brand ${stored.input.brand} chưa sẵn sàng hoặc không thuộc shop`);
        }

        let imageUrls: string[] = [];
        if (/^[a-fA-F0-9]{24}$/.test(cardId)) {
          const card = await fetchTrelloCardDetail(cardId, apiKey, token, request.signal);
          imageUrls = await publishTrelloListingImages({
            scope,
            cardId: card.id,
            attachments: selectTrelloListingImageAttachments(card),
            apiKey,
            token,
            publicOrigin: publicRequestOrigin(request),
            signal: request.signal,
          });
        }
        if (imageUrls.length === 0) {
          imageUrls = (stored.input.images || []).slice(0, 7).map((image) =>
            typeof image === "string" ? image : image.download_url || image.data_url || "",
          ).filter(Boolean);
        }

        const listing = stored.current_listing || stored.result.listing;
        resolvedItems[index] = {
          templateId: resolvedTemplate.id,
          template: resolvedTemplate,
          item: {
            sku: stored.input.internal_name,
            image_urls: imageUrls,
            brand: stored.input.brand,
            listing: {
              title: listing.title,
              bullet_points: listing.bullet_points,
              description: listing.description,
              backend_search_terms: listing.backend_search_terms,
            },
            product_information: stored.input.product_information,
          },
        };
      } catch (error) {
        errors.push(`${cardId}: ${error instanceof Error ? error.message : "không thể đọc listing"}`);
      }
    });

    const successful = resolvedItems.filter((entry): entry is ResolvedBatchItem => Boolean(entry));
    if (successful.length === 0) {
      throw new ApiError(`Không có listing hợp lệ để tạo file tổng hợp. ${errors.join("; ")}`, 404);
    }

    const templateIds = new Set(successful.map((entry) => entry.templateId));
    if (templateIds.size > 1) {
      throw new ApiError(
        "Batch đang chứa nhiều blank Amazon khác cấu trúc nên không thể gộp an toàn vào một file. Hãy chạy batch riêng theo từng Brand/phôi.",
        400,
      );
    }

    const destination = successful[0].template;
    const result = await createAmazonTemplate(
      destination.workbook,
      destination.original_filename,
      successful.map((entry) => entry.item),
    );
    const safeBatchId = safeFilePart(batchId || new Date().toISOString().replace(/[:.]/g, "-"));
    const fileName = `batch-${safeBatchId || "listings"}-combined${result.extension}`;
    const isMacro = result.extension === ".xlsm";

    return new Response(new Uint8Array(result.workbook), {
      headers: {
        "Content-Type": isMacro
          ? "application/vnd.ms-excel.sheet.macroEnabled.12"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(result.workbook.byteLength),
        "Cache-Control": "private, no-store",
        "X-Listings-Count": String(successful.length),
        "X-Errors-Count": String(errors.length),
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tạo file Excel tổng hợp cho batch.");
  }
}
