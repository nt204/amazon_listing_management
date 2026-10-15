import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorize, dataScope } from "@/lib/api-guard";
import {
  createTrelloListingBatch,
  listListingBatchHistory,
} from "@/lib/trello-listing-batches";
import { publicRequestOrigin } from "@/lib/amazon-listing-image-publisher";
import { getTrelloServerCredentials } from "@/lib/trello-server-config";
import { fetchTrelloCardDetail } from "@/lib/trello";

export const runtime = "nodejs";

const createBatchSchema = z.object({
  cards: z
    .array(
      z.union([
        z.object({ id: z.string().min(1), name: z.string().optional() }),
        z.string().min(1),
      ])
    )
    .optional(),
  cardIds: z.array(z.string().min(1)).optional(),
  brandProfileId: z.string().uuid("Brand không hợp lệ"),
  brandName: z.string().optional(),
  shopId: z.string().uuid("Shop không hợp lệ"),
  shopName: z.string().optional(),
  templateId: z.string().uuid("Template không hợp lệ"),
  templateName: z.string().optional(),
  marketplace: z.enum(["US", "UK", "DE"]).default("US"),
  model: z.string().optional(),
  concurrency: z.number().int().min(1).max(4).default(2),
});

export async function POST(request: NextRequest) {
  try {
    const actor = await authorize(request, "write");
    const scope = dataScope(actor);
    const body = await request.json();
    const validated = createBatchSchema.parse(body);

    const rawCards = validated.cards || (validated.cardIds ? validated.cardIds.map((id) => ({ id, name: id })) : []);
    const normalizedCards: Array<{ id: string; name: string }> = rawCards.map((c) =>
      typeof c === "string" ? { id: c, name: c } : { id: c.id, name: c.name || c.id }
    );

    if (normalizedCards.length === 0) {
      return NextResponse.json(
        { error: "Cần chọn ít nhất 1 thẻ Trello để tạo Batch Listing." },
        { status: 400 }
      );
    }

    const batch = await createTrelloListingBatch({
      teamId: scope.teamId,
      actorId: actor.userId,
      brandProfileId: validated.brandProfileId,
      brandName: validated.brandName,
      shopId: validated.shopId,
      shopName: validated.shopName,
      templateId: validated.templateId,
      templateName: validated.templateName,
      marketplace: validated.marketplace,
      model: validated.model,
      concurrency: validated.concurrency,
      cards: normalizedCards,
      publicOrigin: publicRequestOrigin(request),
    });

    return NextResponse.json({
      success: true,
      batchId: batch.id,
      status: batch.status,
      totalCards: batch.total_cards,
      message: `Đã đưa ${batch.total_cards} thẻ vào tiến trình Listing chạy ngầm trên server!`,
    });
  } catch (error: any) {
    console.error("POST /api/trello/batch-jobs error:", error);
    return NextResponse.json(
      { error: error.message || "Không thể tạo Batch Listing" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const actor = await authorize(request, "read");
    const { getDatabaseClient } = await import("@/lib/db");
    const sql = await getDatabaseClient();

    // 1. Lấy lịch sử các batch thuộc tài khoản của chính user này
    const history = await sql<any[]>`
      SELECT * FROM trello_listing_batches
      WHERE actor_id = ${actor.userId}
      ORDER BY created_at DESC
      LIMIT 30;
    `;

    if (history.length === 0) {
      return NextResponse.json({ success: true, history: [] });
    }

    // 2. Lấy chi tiết các items của các batch trên để có danh sách SKU và Card IDs
    const batchIds = history.map((b) => b.id);
    const items = await sql<any[]>`
      SELECT batch_id, card_id, sku, item_name, card_name, status
      FROM trello_listing_batch_items
      WHERE batch_id IN ${sql(batchIds)}
      ORDER BY created_at ASC;
    `;

    const itemsByBatch = new Map<string, any[]>();
    for (const item of items) {
      const list = itemsByBatch.get(item.batch_id) || [];
      list.push(item);
      itemsByBatch.set(item.batch_id, list);
    }

    // 3. Chuẩn hóa format trả về cho giao diện Modal Lịch Sử
    const formattedHistory = history.map((b) => {
      const bItems = itemsByBatch.get(b.id) || [];
      const completedItems = bItems.filter((i) => i.status === "completed");
      const skus = bItems
        .map((i) => i.sku || i.item_name || i.card_name)
        .filter(Boolean);
      const cardIds = (completedItems.length > 0 ? completedItems : bItems).map((i) => i.card_id);

      return {
        id: b.id,
        createdAt: b.created_at,
        completedAt: b.completed_at,
        shopName: b.shop_name || "Shop",
        templateName: b.template_name || "Template",
        shopId: b.shop_id,
        templateId: b.template_id,
        total: b.total_cards,
        successCount: b.completed_cards,
        failedCount: b.failed_cards,
        status: b.status,
        skus,
        cardIds,
      };
    });

    return NextResponse.json({ success: true, history: formattedHistory });
  } catch (error: any) {
    console.error("GET /api/trello/batch-jobs error:", error);
    return NextResponse.json(
      { error: error.message || "Không thể tải lịch sử Batch" },
      { status: 500 }
    );
  }
}
