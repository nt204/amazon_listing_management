import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { createAmazonTemplate, createStandardListingExcel } from "@/lib/excel-automation";
import { getListing, getListingTemplate } from "@/lib/db";
import {
  downloadTrelloAttachment,
  fetchTrelloCardDetail,
  formatRawTrelloKeywords,
  parseTrelloCardTitle,
  selectTrelloImageAttachments,
  selectLatestTrelloWorkbookAttachment,
} from "@/lib/trello";

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

    const apiKey = searchParams.get("apiKey") || process.env.TRELLO_API_KEY || "";
    const token = searchParams.get("token") || process.env.TRELLO_TOKEN || "";
    const templateId = searchParams.get("templateId") || "";

    let templateItem: {
      sku: string;
      image_urls: string[];
      brand: string;
      listing: {
        title: string;
        bullet_points: string[];
        description: string;
        backend_search_terms: string;
      };
    } | null = null;

    let excelFileName = "amazon-listing.xlsx";

    // 1. Try fetching from Trello if cardId is a valid Trello ID (24 hex characters)
    const isTrelloCardId = Boolean(cardId && /^[a-fA-F0-9]{24}$/.test(cardId));
    if (isTrelloCardId && apiKey && token) {
      try {
        const card = await fetchTrelloCardDetail(cardId!, apiKey, token);
        const { sku, itemName } = parseTrelloCardTitle(card.name);

        const excelAttachment = selectLatestTrelloWorkbookAttachment(card.attachments || []);
        if (excelAttachment && excelAttachment.url) {
          try {
            const buffer = await downloadTrelloAttachment(excelAttachment.url, apiKey, token);
            return new Response(new Uint8Array(buffer), {
              headers: {
                "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition": `attachment; filename="${excelAttachment.name}"`,
                "Cache-Control": "private, no-store",
              },
            });
          } catch (dlErr) {
            console.warn("Lỗi tải attachment từ Trello, tiến hành sinh file Excel trực tiếp:", dlErr);
          }
        }

        const rawDesc = (card.desc || "").trim();
        const descKeywords = rawDesc
          .split(/\r?\n|,|;/)
          .map((k) => k.trim())
          .filter((k) => k.length > 1 && !k.toLowerCase().startsWith("generic keywords"));

        const imageAttachments = selectTrelloImageAttachments(card);

        templateItem = {
          sku,
          image_urls: imageAttachments.map((a) => a.url),
          brand: "Limima",
          listing: {
            title: card.name,
            bullet_points: [
              `High Quality Craftsmanship for ${itemName}`,
              "Durable and Premium Materials",
              "Vibrant Colors and Eye-Catching Design",
              "Perfect Gift Choice for Special Occasions",
              "Satisfaction Guaranteed Product",
            ],
            description: rawDesc || `Premium ${itemName} designed with high quality materials.`,
            backend_search_terms: formatRawTrelloKeywords(rawDesc) || descKeywords.join(" "),
          },
        };
        excelFileName = `${sku.toLowerCase()}-amazon-listing.xlsx`;
      } catch (trelloErr) {
        console.warn("Could not fetch Trello card detail, fallback to DB listing:", trelloErr);
      }
    }

    // 2. Fallback to stored database listing if Trello card fetch wasn't used or failed
    if (!templateItem) {
      const targetListingId = listingId || cardId;
      if (targetListingId) {
        const stored = await getListing(scope, targetListingId);
        if (stored) {
          const sku = stored.input.internal_name || "listing";
          const listingContent = stored.current_listing || stored.result.listing;
          templateItem = {
            sku,
            image_urls: (stored.input.images || []).map((img: any) =>
              typeof img === "string" ? img : img.data_url || img.download_url || "",
            ),
            brand: stored.input.brand || "Limima",
            listing: {
              title: listingContent.title,
              bullet_points: listingContent.bullet_points,
              description: listingContent.description,
              backend_search_terms: listingContent.backend_search_terms,
            },
          };
          excelFileName = `${sku.toLowerCase()}-amazon-listing.xlsx`;
        }
      }
    }

    if (!templateItem) {
      return NextResponse.json({ error: "Không tìm thấy thông tin Listing hoặc Trello Card." }, { status: 404 });
    }

    // 3. Build Excel File using Amazon template or fallback standard generator
    let excelWorkbook: Buffer;
    const defaultTemplatePath = join(process.cwd(), "examples", "HANGING_ORNAMENT_3_SKU_INPUT.xlsx");
    let resolvedTemplate: { workbook: Buffer; original_filename: string } | null = null;

    if (templateId) {
      const dbTemplate = await getListingTemplate(scope, templateId);
      if (dbTemplate) {
        resolvedTemplate = { workbook: dbTemplate.workbook, original_filename: dbTemplate.original_filename };
      }
    }

    if (!resolvedTemplate && existsSync(defaultTemplatePath)) {
      resolvedTemplate = {
        workbook: readFileSync(defaultTemplatePath),
        original_filename: "HANGING_ORNAMENT_3_SKU_INPUT.xlsx",
      };
    }

    if (resolvedTemplate) {
      const res = await createAmazonTemplate(resolvedTemplate.workbook, resolvedTemplate.original_filename, [
        templateItem,
      ]);
      excelWorkbook = res.workbook;
      excelFileName = `${templateItem.sku.toLowerCase()}-amazon-template${res.extension}`;
    } else {
      const res = await createStandardListingExcel([templateItem]);
      excelWorkbook = res.workbook;
    }

    return new Response(new Uint8Array(excelWorkbook), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${excelFileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải file Excel.");
  }
}
