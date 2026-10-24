import { NextRequest, NextResponse } from "next/server";
import { getListingBatchDetail } from "@/lib/trello-listing-batches";
import { getDatabaseClient, getLatestListingForTrelloCard, getListingTemplate } from "@/lib/db";
import { resolveListingTemplateForBrand } from "@/lib/listing-template-resolver";
import { isTemplateForShop } from "@/lib/amazon-template-shop";
import { isTemplateReady } from "@/lib/amazon-template-catalog";
import { createAmazonTemplate } from "@/lib/excel-automation";
import { fetchTrelloCardDetail, selectTrelloListingImageAttachments } from "@/lib/trello";
import { getTrelloServerCredentials } from "@/lib/trello-server-config";
import { publicRequestOrigin, publishTrelloListingImages } from "@/lib/amazon-listing-image-publisher";
import { runWithConcurrency } from "@/lib/run-with-concurrency";
import type { AmazonTemplateItem } from "@/lib/excel-batch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ResolvedBatchItem {
  item: AmazonTemplateItem;
  templateId: string;
  template: NonNullable<Awaited<ReturnType<typeof getListingTemplate>>>;
}

function safeFilePart(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: batchId } = await params;
    if (!batchId) {
      return NextResponse.json({ error: "Thiếu mã batch." }, { status: 400 });
    }

    const { batch, items } = await getListingBatchDetail(batchId);
    if (!batch) {
      return NextResponse.json({ error: "Không tìm thấy batch listing." }, { status: 404 });
    }

    const completedCards = items.filter((i) => i.status === "completed");
    if (completedCards.length === 0) {
      return NextResponse.json({ error: "Batch chưa có thẻ nào hoàn tất thành công." }, { status: 400 });
    }

    const scope = { teamId: batch.team_id, actorId: batch.actor_id };
    const { apiKey, token } = getTrelloServerCredentials();
    const resolvedItems: Array<ResolvedBatchItem | null> = Array(completedCards.length).fill(null);
    const errors: string[] = [];

    await runWithConcurrency(completedCards, 6, async (item, index) => {
      try {
        const stored = await getLatestListingForTrelloCard(scope, item.card_id, item.sku || undefined);
        if (!stored) throw new Error("không tìm thấy listing đã lưu");
        if (!stored.input.brand || !stored.input.brand_profile_id) {
          throw new Error("listing chưa có Brand hợp lệ");
        }

        const resolvedTemplate = await resolveListingTemplateForBrand(scope, batch.template_id, {
          id: stored.input.brand_profile_id,
          name: stored.input.brand,
        });
        if (!resolvedTemplate) {
          throw new Error(`Brand ${stored.input.brand} chưa có template`);
        }

        let imageUrls: string[] = [];
        if (/^[a-fA-F0-9]{24}$/.test(item.card_id)) {
          const card = await fetchTrelloCardDetail(item.card_id, apiKey, token, request.signal).catch(() => null);
          if (card) {
            imageUrls = await publishTrelloListingImages({
              scope,
              cardId: card.id,
              attachments: selectTrelloListingImageAttachments(card),
              apiKey,
              token,
              publicOrigin: publicRequestOrigin(request),
              signal: request.signal,
            }).catch(() => []);
          }
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
            sku: stored.input.internal_name || item.sku || "SKU",
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
      } catch (err: any) {
        errors.push(`${item.card_name || item.card_id}: ${err?.message || "lỗi"}`);
      }
    });

    const successful = resolvedItems.filter((entry): entry is ResolvedBatchItem => Boolean(entry));
    if (successful.length === 0) {
      return NextResponse.json(
        { error: `Không thể tạo file Excel tổng hợp: ${errors.join("; ")}` },
        { status: 400 },
      );
    }

    const destination = successful[0].template;
    const result = await createAmazonTemplate(
      destination.workbook,
      destination.original_filename,
      successful.map((entry) => entry.item),
    );

    const safeBatchId = safeFilePart(batch.id);
    const shopPart = safeFilePart(batch.shop_name || "shop");
    const fileName = `batch-${safeBatchId}-${shopPart}-combined${result.extension}`;
    const isMacro = result.extension === ".xlsm";

    return new Response(new Uint8Array(result.workbook), {
      headers: {
        "Content-Type": isMacro
          ? "application/vnd.ms-excel.sheet.macroEnabled.12"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error: any) {
    console.error("Lỗi khi tải file Excel tổng hợp batch:", error);
    return NextResponse.json(
      { error: error?.message || "Không thể tạo file Excel tổng hợp." },
      { status: 500 },
    );
  }
}
