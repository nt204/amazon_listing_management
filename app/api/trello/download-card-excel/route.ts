import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { createAmazonTemplate, createStandardListingExcel } from "@/lib/excel-automation";
import { getListingTemplate, listListingTemplates } from "@/lib/db";
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
    if (!cardId) {
      return NextResponse.json({ error: "cardId là bắt buộc" }, { status: 400 });
    }

    const apiKey = searchParams.get("apiKey") || process.env.TRELLO_API_KEY || "";
    const token = searchParams.get("token") || process.env.TRELLO_TOKEN || "";
    const templateId = searchParams.get("templateId") || "";

    if (!apiKey || !token) {
      return NextResponse.json({ error: "Trello API Key & Token chưa được cấu hình." }, { status: 400 });
    }

    // Fetch card details from Trello
    const card = await fetchTrelloCardDetail(cardId, apiKey, token);
    const { sku, itemName } = parseTrelloCardTitle(card.name);

    // Look for attached CSV / Excel file or generate fresh Excel file
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

    // Direct fallback generation
    const rawDesc = (card.desc || "").trim();
    const descKeywords = rawDesc
      .split(/\r?\n|,|;/)
      .map((k) => k.trim())
      .filter((k) => k.length > 1 && !k.toLowerCase().startsWith("generic keywords"));

    const imageAttachments = selectTrelloImageAttachments(card);

    const templateItem = {
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

    let excelWorkbook: Buffer;
    let excelFileName = `${sku.toLowerCase()}-amazon-listing.xlsx`;

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
      excelFileName = `${sku.toLowerCase()}-amazon-template${res.extension}`;
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
