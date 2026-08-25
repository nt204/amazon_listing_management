import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { isTemplateForShop } from "@/lib/amazon-template-shop";
import { isTemplateReady } from "@/lib/amazon-template-catalog";
import { createAmazonTemplate } from "@/lib/excel-automation";
import { getLatestListingForTrelloCard, getListing, getListingTemplate } from "@/lib/db";
import { resolveListingTemplateForBrand } from "@/lib/listing-template-resolver";
import {
  fetchTrelloCardDetail,
  parseTrelloCardTitle,
  selectTrelloListingImageAttachments,
} from "@/lib/trello";
import { getTrelloServerCredentials } from "@/lib/trello-server-config";

export const runtime = "nodejs";
export const maxDuration = 150;

export async function GET(request: Request) {
  try {
    const actor = authorize(request, "read");
    const scope = dataScope(actor);
    const { searchParams } = new URL(request.url);

    const cardId = searchParams.get("cardId");
    const listingId = searchParams.get("listingId");

    if (!cardId && !listingId) {
      return NextResponse.json({ error: "cardId hoặc listingId là bắt buộc" }, { status: 400 });
    }

    const shopId = searchParams.get("shopId") || "";
    const templateId = searchParams.get("templateId") || "";
    if (!z.uuid().safeParse(shopId).success || !z.uuid().safeParse(templateId).success) {
      throw new ApiError("Hãy chọn shop và template đích trước khi xuất.", 400);
    }
    const selectedTemplate = await getListingTemplate(scope, templateId);
    if (!selectedTemplate) throw new ApiError("Template Amazon đã chọn không còn tồn tại.", 404);
    if (!isTemplateForShop(selectedTemplate, shopId)) {
      throw new ApiError("Template không thuộc shop Amazon đã chọn.", 400);
    }

    let templateItem: {
      sku: string;
      image_urls: string[];
      brand: string;
      brand_profile_id?: string;
      listing: {
        title: string;
        bullet_points: string[];
        description: string;
        backend_search_terms: string;
      };
      product_information?: NonNullable<Awaited<ReturnType<typeof getListing>>>["input"]["product_information"];
    } | null = null;

    let excelFileName = "amazon-listing.xlsx";

    // 1. Try fetching from Trello if cardId is a valid Trello ID (24 hex characters)
    const isTrelloCardId = Boolean(cardId && /^[a-fA-F0-9]{24}$/.test(cardId));
    if (isTrelloCardId) {
      try {
        const { apiKey, token } = getTrelloServerCredentials();
        const card = await fetchTrelloCardDetail(cardId!, apiKey, token);
        const { sku } = parseTrelloCardTitle(card.name);
        const stored = listingId
          ? await getListing(scope, listingId)
          : await getLatestListingForTrelloCard(scope, cardId!, sku);
        if (!stored) {
          throw new ApiError("Không tìm thấy nội dung listing đã lưu cho thẻ này. Hãy tạo listing lại một lần.", 404);
        }
        const imageAttachments = selectTrelloListingImageAttachments(card);
        const listingContent = stored.current_listing || stored.result.listing;
        templateItem = {
          sku,
          image_urls: imageAttachments.map((a) => a.url),
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
        excelFileName = `${sku.toLowerCase()}-amazon-listing.xlsx`;
      } catch (trelloErr) {
        if (trelloErr instanceof ApiError) throw trelloErr;
        console.warn("Could not resolve the saved Trello listing:", trelloErr);
      }
    }

    // 2. Fallback to stored database listing if Trello card fetch wasn't used or failed
    if (!templateItem) {
      const targetListingId = listingId || cardId;
      if (targetListingId) {
        const stored = await getListing(scope, targetListingId);
        if (stored) {
          const rawName = stored.input.internal_name || "listing";
          const { sku } = parseTrelloCardTitle(rawName);
          const listingContent = stored.current_listing || stored.result.listing;

          let imageUrls: string[] = [];
          if (stored.source_trello_card_id) {
            try {
              const { apiKey, token } = getTrelloServerCredentials();
              const card = await fetchTrelloCardDetail(stored.source_trello_card_id, apiKey, token);
              const imageAttachments = selectTrelloListingImageAttachments(card);
              imageUrls = imageAttachments.map((a) => a.url);
            } catch {
              // fallback below
            }
          }

          if (imageUrls.length === 0) {
            const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
            const proto = request.headers.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
            const origin = host ? `${proto}://${host}` : "";

            imageUrls = (stored.input.images || []).slice(0, 7).map((img) => {
              const rawUrl = typeof img === "string" ? img : img.download_url || img.data_url || "";
              if (rawUrl.startsWith("/") && origin) {
                return `${origin}${rawUrl}`;
              }
              return rawUrl;
            });
          }

          templateItem = {
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
          excelFileName = `${sku.toLowerCase()}-amazon-listing.xlsx`;
        }
      }
    }

    if (!templateItem) {
      return NextResponse.json({ error: "Không tìm thấy thông tin Listing hoặc Trello Card." }, { status: 404 });
    }
    if (!templateItem.brand || !templateItem.brand_profile_id) {
      throw new ApiError("Listing chưa có Brand hợp lệ. Hãy tạo lại listing sau khi chọn Brand.", 400);
    }

    const resolvedTemplate = await resolveListingTemplateForBrand(scope, selectedTemplate.id, {
      id: templateItem.brand_profile_id,
      name: templateItem.brand,
    });
    if (!resolvedTemplate) {
      throw new ApiError(`Brand ${templateItem.brand} chưa có blank cho loại phôi đã chọn. Hãy tải blank từ Seller Central ${templateItem.brand}.`, 400);
    }
    if (!isTemplateReady(resolvedTemplate)) {
      throw new ApiError(`Template "${resolvedTemplate.name}" là file blank chưa thể dùng. Hãy mở file Excel điền dòng mẫu Parent/Child hoặc tải lên phôi đã điền từ shop khác.`, 400);
    }
    if (!isTemplateForShop(resolvedTemplate, shopId)) {
      throw new ApiError("Template tự động không thuộc shop Amazon đã chọn.", 400);
    }

    // Build from the resolved destination-shop workbook. Mapping only copied field values into its structure.
    const res = await createAmazonTemplate(
      resolvedTemplate.workbook,
      resolvedTemplate.original_filename,
      [templateItem],
    );
    const excelWorkbook = res.workbook;
    const safeShopName = resolvedTemplate.shop_name.replace(/[^A-Za-z0-9_-]/g, "-") || "shop";
    excelFileName = `${safeShopName}-${templateItem.sku.toLowerCase()}-amazon-template${res.extension}`;
    const isMacro = res.extension === ".xlsm";

    return new Response(new Uint8Array(excelWorkbook), {
      headers: {
        "Content-Type": isMacro
          ? "application/vnd.ms-excel.sheet.macroEnabled.12"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${excelFileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải file Excel.");
  }
}
