import { getDatabaseClient, type DataScope } from "@/lib/db";
import { executeSingleTrelloListing } from "@/lib/trello-listing-processor";
import { notifyLarkEventBestEffort } from "@/lib/lark-notifications";
import JSZip from "jszip";
import { parseTrelloCardTitle } from "@/lib/trello";

export interface TrelloListingBatchRecord {
  id: string;
  team_id: string;
  actor_id: string;
  brand_profile_id: string;
  brand_name: string | null;
  shop_id: string;
  shop_name: string | null;
  template_id: string;
  template_name: string | null;
  marketplace: string;
  model: string | null;
  status: "queued" | "running" | "paused" | "completed" | "cancelled" | "failed";
  total_cards: number;
  completed_cards: number;
  failed_cards: number;
  concurrency: number;
  zip_r2_key: string | null;
  zip_url: string | null;
  zip_filename: string | null;
  excel_combined_r2_key: string | null;
  excel_combined_url: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface TrelloListingBatchItemRecord {
  id: string;
  batch_id: string;
  card_id: string;
  card_name: string;
  sku: string | null;
  item_name: string | null;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  current_stage: string | null;
  stage_message: string | null;
  listing_id: string | null;
  trello_attachment_id: string | null;
  excel_r2_key: string | null;
  excel_url: string | null;
  excel_filename: string | null;
  error_message: string | null;
  attempt_count: number;
  timings_ms: Record<string, number>;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// In-memory registry of running batch abort controllers so user can pause/cancel immediately
const batchControllers = new Map<string, AbortController>();
const activeBatchWorkerRunning = new Set<string>();

export async function createTrelloListingBatch(params: {
  teamId: string;
  actorId: string;
  brandProfileId: string;
  brandName?: string;
  shopId: string;
  shopName?: string;
  templateId: string;
  templateName?: string;
  marketplace?: "US" | "UK" | "DE";
  model?: string;
  concurrency?: number;
  cards: Array<{ id: string; name: string }>;
  publicOrigin?: string;
}): Promise<TrelloListingBatchRecord> {
  const sql = await getDatabaseClient();
  const {
    teamId,
    actorId,
    brandProfileId,
    brandName = "Brand",
    shopId,
    shopName = "Shop",
    templateId,
    templateName = "Template",
    marketplace = "US",
    model = "gpt-5-mini",
    concurrency = 2,
    cards,
    publicOrigin,
  } = params;

  if (cards.length === 0) {
    throw new Error("Không có thẻ Trello nào để tạo Batch Listing.");
  }

  // 1. Create batch record
  const [batch] = await sql<TrelloListingBatchRecord[]>`
    INSERT INTO trello_listing_batches (
      team_id, actor_id, brand_profile_id, brand_name,
      shop_id, shop_name, template_id, template_name,
      marketplace, model, concurrency, total_cards, status
    ) VALUES (
      ${teamId}, ${actorId}, ${brandProfileId}, ${brandName},
      ${shopId}, ${shopName}, ${templateId}, ${templateName},
      ${marketplace}, ${model}, ${concurrency}, ${cards.length}, 'running'
    )
    RETURNING *;
  `;

  // 2. Create batch items
  for (const card of cards) {
    const { sku, itemName } = parseTrelloCardTitle(card.name);
    await sql`
      INSERT INTO trello_listing_batch_items (
        batch_id, card_id, card_name, sku, item_name, status, progress, stage_message
      ) VALUES (
        ${batch.id}, ${card.id}, ${card.name}, ${sku || null}, ${itemName || null},
        'queued', 0, 'Đang chờ đến lượt xử lý...'
      );
    `;
  }

  // 3. Trigger worker process in background (detached promise)
  setTimeout(() => {
    void processBatchQueue(batch.id, publicOrigin);
  }, 100);

  return batch;
}

export async function getActiveListingBatches(teamId?: string, actorId?: string): Promise<{
  activeBatches: TrelloListingBatchRecord[];
  activeItems: Record<string, TrelloListingBatchItemRecord[]>;
}> {
  const sql = await getDatabaseClient();
  const batches = actorId
    ? await sql<TrelloListingBatchRecord[]>`
        SELECT * FROM trello_listing_batches
        WHERE actor_id = ${actorId}
          AND (
            status IN ('running', 'paused', 'queued')
            OR (status IN ('completed', 'failed', 'cancelled') AND updated_at > NOW() - INTERVAL '10 minutes')
          )
        ORDER BY created_at DESC
        LIMIT 5;
      `
    : await sql<TrelloListingBatchRecord[]>`
        SELECT * FROM trello_listing_batches
        WHERE status IN ('running', 'paused', 'queued')
           OR (status IN ('completed', 'failed', 'cancelled') AND updated_at > NOW() - INTERVAL '10 minutes')
        ORDER BY created_at DESC
        LIMIT 5;
      `;

  const activeItems: Record<string, TrelloListingBatchItemRecord[]> = {};
  for (const b of batches) {
    const items = await sql<TrelloListingBatchItemRecord[]>`
      SELECT * FROM trello_listing_batch_items
      WHERE batch_id = ${b.id}
      ORDER BY created_at ASC;
    `;
    activeItems[b.id] = items;
  }

  return { activeBatches: batches, activeItems };
}

export async function getListingBatchDetail(batchId: string): Promise<{
  batch: TrelloListingBatchRecord | null;
  items: TrelloListingBatchItemRecord[];
}> {
  const sql = await getDatabaseClient();
  const [batch] = await sql<TrelloListingBatchRecord[]>`
    SELECT * FROM trello_listing_batches WHERE id = ${batchId} LIMIT 1;
  `;
  if (!batch) return { batch: null, items: [] };

  const items = await sql<TrelloListingBatchItemRecord[]>`
    SELECT * FROM trello_listing_batch_items
    WHERE batch_id = ${batchId}
    ORDER BY created_at ASC;
  `;
  return { batch, items };
}

export async function listListingBatchHistory(limit = 30): Promise<TrelloListingBatchRecord[]> {
  const sql = await getDatabaseClient();
  return await sql<TrelloListingBatchRecord[]>`
    SELECT * FROM trello_listing_batches
    ORDER BY created_at DESC
    LIMIT ${limit};
  `;
}

export async function pauseListingBatch(batchId: string): Promise<void> {
  const sql = await getDatabaseClient();
  await sql`
    UPDATE trello_listing_batches
    SET status = 'paused', updated_at = NOW()
    WHERE id = ${batchId} AND status = 'running';
  `;
  batchControllers.get(batchId)?.abort(new Error("Batch đã bị tạm dừng bởi người dùng."));
  batchControllers.delete(batchId);
}

export async function resumeListingBatch(batchId: string, publicOrigin?: string): Promise<void> {
  const sql = await getDatabaseClient();
  await sql`
    UPDATE trello_listing_batches
    SET status = 'running', updated_at = NOW()
    WHERE id = ${batchId} AND status = 'paused';
  `;
  setTimeout(() => {
    void processBatchQueue(batchId, publicOrigin);
  }, 100);
}

export async function cancelListingBatch(batchId: string): Promise<void> {
  const sql = await getDatabaseClient();
  batchControllers.get(batchId)?.abort(new Error("Batch đã bị hủy bởi người dùng."));
  batchControllers.delete(batchId);

  await sql`
    UPDATE trello_listing_batch_items
    SET status = 'cancelled', stage_message = 'Đã hủy theo yêu cầu batch', updated_at = NOW()
    WHERE batch_id = ${batchId} AND status = 'queued';
  `;

  await sql`
    UPDATE trello_listing_batches
    SET status = 'cancelled', completed_at = NOW(), updated_at = NOW()
    WHERE id = ${batchId};
  `;
}

export async function retryBatchItem(itemId: string, publicOrigin?: string): Promise<void> {
  const sql = await getDatabaseClient();
  const [item] = await sql<TrelloListingBatchItemRecord[]>`
    UPDATE trello_listing_batch_items
    SET status = 'queued', progress = 0, error_message = NULL, stage_message = 'Đang chờ thử lại...', updated_at = NOW()
    WHERE id = ${itemId}
    RETURNING *;
  `;
  if (!item) return;

  await sql`
    UPDATE trello_listing_batches
    SET status = 'running', updated_at = NOW()
    WHERE id = ${item.batch_id} AND status IN ('completed', 'failed', 'paused');
  `;

  setTimeout(() => {
    void processBatchQueue(item.batch_id, publicOrigin);
  }, 100);
}

export async function retryAllFailedBatchItems(batchId: string, publicOrigin?: string): Promise<void> {
  const sql = await getDatabaseClient();
  await sql`
    UPDATE trello_listing_batch_items
    SET status = 'queued', progress = 0, error_message = NULL, stage_message = 'Đang chờ thử lại...', updated_at = NOW()
    WHERE batch_id = ${batchId} AND status = 'failed';
  `;

  await sql`
    UPDATE trello_listing_batches
    SET status = 'running', updated_at = NOW()
    WHERE id = ${batchId};
  `;

  setTimeout(() => {
    void processBatchQueue(batchId, publicOrigin);
  }, 100);
}

/**
 * Worker chính xử lý hàng đợi Batch chạy nền trên Server
 */
async function processBatchQueue(batchId: string, publicOrigin?: string): Promise<void> {
  if (activeBatchWorkerRunning.has(batchId)) return;
  activeBatchWorkerRunning.add(batchId);

  const abortController = new AbortController();
  batchControllers.set(batchId, abortController);

  const sql = await getDatabaseClient();

  try {
    while (!abortController.signal.aborted) {
      // 1. Kiểm tra trạng thái batch
      const [batch] = await sql<TrelloListingBatchRecord[]>`
        SELECT * FROM trello_listing_batches WHERE id = ${batchId} LIMIT 1;
      `;
      if (!batch || batch.status !== "running") break;

      const concurrency = Math.max(1, Math.min(4, batch.concurrency || 2));

      // 2. Lấy các item đang chạy xem còn chỗ không
      const runningCountRows = await sql<{ count: string }[]>`
        SELECT COUNT(*)::text as count FROM trello_listing_batch_items
        WHERE batch_id = ${batchId} AND status = 'running';
      `;
      const currentRunning = parseInt(runningCountRows[0]?.count || "0", 10);
      const slotsAvailable = concurrency - currentRunning;

      if (slotsAvailable <= 0) {
        // Đợi 1.5 giây rồi kiểm tra lại
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }

      // 3. Claim các item kế tiếp trong hàng đợi
      const queuedItems = await sql<TrelloListingBatchItemRecord[]>`
        SELECT * FROM trello_listing_batch_items
        WHERE batch_id = ${batchId} AND status = 'queued'
        ORDER BY created_at ASC
        LIMIT ${slotsAvailable};
      `;

      if (queuedItems.length === 0) {
        if (currentRunning === 0) {
          // Toàn bộ các item đã hoàn thành (hoặc failed/cancelled)
          await finalizeBatchCompletion(batchId);
          break;
        }
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }

      // 4. Kích hoạt xử lý song song các item đã claim
      for (const item of queuedItems) {
        void executeBatchItemTask({
          batch,
          item,
          publicOrigin,
          signal: abortController.signal,
        });
      }

      await new Promise((r) => setTimeout(r, 800));
    }
  } catch (err: any) {
    console.error(`[Batch Worker ${batchId}] Lỗi tiến trình worker:`, err);
  } finally {
    activeBatchWorkerRunning.delete(batchId);
    if (batchControllers.get(batchId) === abortController) {
      batchControllers.delete(batchId);
    }
  }
}

async function executeBatchItemTask(params: {
  batch: TrelloListingBatchRecord;
  item: TrelloListingBatchItemRecord;
  publicOrigin?: string;
  signal: AbortSignal;
}): Promise<void> {
  const { batch, item, publicOrigin, signal } = params;
  const sql = await getDatabaseClient();

  // Đánh dấu item sang trạng thái running
  await sql`
    UPDATE trello_listing_batch_items
    SET status = 'running', progress = 5, started_at = NOW(), stage_message = 'Bắt đầu xử lý...', updated_at = NOW()
    WHERE id = ${item.id};
  `;

  const scope: DataScope = { teamId: batch.team_id, actorId: batch.actor_id };

  try {
    const result = await executeSingleTrelloListing({
      cardId: item.card_id,
      brandProfileId: batch.brand_profile_id,
      shopId: batch.shop_id,
      templateId: batch.template_id,
      marketplace: (batch.marketplace as any) || "US",
      model: batch.model || undefined,
      scope,
      publicOrigin,
      signal,
      skipNotification: true,
      emit: (event) => {
        if (event.type === "progress") {
          void sql`
            UPDATE trello_listing_batch_items
            SET progress = ${event.progress}, current_stage = ${event.stage},
                stage_message = ${event.message}, timings_ms = ${JSON.stringify(event.timings_ms)},
                updated_at = NOW()
            WHERE id = ${item.id};
          `.catch(() => {});
        } else if (event.type === "warning") {
          void sql`
            UPDATE trello_listing_batch_items
            SET stage_message = ${event.message}, updated_at = NOW()
            WHERE id = ${item.id};
          `.catch(() => {});
        }
      },
    });

    // Thành công
    await sql`
      UPDATE trello_listing_batch_items
      SET status = 'completed', progress = 100, current_stage = 'complete',
          stage_message = 'Đã hoàn tất listing và đính kèm Trello.',
          listing_id = ${result.listing.id},
          trello_attachment_id = ${result.trelloAttachment?.id || null},
          sku = ${result.sku},
          item_name = ${result.itemName},
          timings_ms = ${JSON.stringify(result.timings_ms)},
          completed_at = NOW(), updated_at = NOW()
      WHERE id = ${item.id};
    `;

    // Cập nhật số lượng hoàn thành trên batch
    await sql`
      UPDATE trello_listing_batches
      SET completed_cards = (
        SELECT COUNT(*) FROM trello_listing_batch_items WHERE batch_id = ${batch.id} AND status = 'completed'
      ), updated_at = NOW()
      WHERE id = ${batch.id};
    `;
  } catch (err: any) {
    const isCancelled = signal.aborted || String(err?.message || "").includes("hủy") || String(err?.message || "").includes("ngắt");
    await sql`
      UPDATE trello_listing_batch_items
      SET status = ${isCancelled ? "cancelled" : "failed"},
          progress = ${isCancelled ? 0 : 100},
          error_message = ${err?.message || "Lỗi xử lý listing"},
          stage_message = ${isCancelled ? "Đã dừng." : `Lỗi: ${err?.message || "Thất bại"}`},
          completed_at = NOW(), updated_at = NOW()
      WHERE id = ${item.id};
    `;

    await sql`
      UPDATE trello_listing_batches
      SET failed_cards = (
        SELECT COUNT(*) FROM trello_listing_batch_items WHERE batch_id = ${batch.id} AND status = 'failed'
      ), updated_at = NOW()
      WHERE id = ${batch.id};
    `;
  }
}

/**
 * Đóng gói hoàn tất Batch (tạo file ZIP tổng hợp nếu có các file Excel)
 */
async function finalizeBatchCompletion(batchId: string): Promise<void> {
  const sql = await getDatabaseClient();
  const [batch] = await sql<TrelloListingBatchRecord[]>`
    SELECT * FROM trello_listing_batches WHERE id = ${batchId} LIMIT 1;
  `;
  if (!batch || batch.status === "completed") return;

  const items = await sql<TrelloListingBatchItemRecord[]>`
    SELECT * FROM trello_listing_batch_items WHERE batch_id = ${batchId};
  `;

  const completedCount = items.filter((i) => i.status === "completed").length;
  const failedCount = items.filter((i) => i.status === "failed").length;

  const finalStatus =
    completedCount === 0 && failedCount > 0
      ? "failed"
      : "completed";

  await sql`
    UPDATE trello_listing_batches
    SET status = ${finalStatus},
        completed_cards = ${completedCount},
        failed_cards = ${failedCount},
        completed_at = NOW(),
        updated_at = NOW()
    WHERE id = ${batchId};
  `;

  console.log(`[Batch Worker ${batchId}] Đã hoàn tất: ${completedCount}/${items.length} thẻ thành công, ${failedCount} lỗi.`);

  if (completedCount > 0) {
    const skuList = items
      .filter((i) => i.status === "completed" && i.sku)
      .map((i) => i.sku as string);
    const skuPreview = skuList.slice(0, 5).join(", ");
    const remaining = skuList.length > 5 ? ` (+${skuList.length - 5} SKU)` : "";
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:2411";
    const downloadUrl = `${baseUrl}/api/trello/batch-jobs/${batchId}/excel`;

    await notifyLarkEventBestEffort(
      { teamId: batch.team_id, actorId: batch.actor_id },
      "listing",
      [
        `🎉 **Batch Listing đã hoàn tất: ${completedCount}/${items.length} thẻ thành công**`,
        batch.shop_name || batch.template_name ? `• Shop: ${batch.shop_name || "Mặc định"} | Template: ${batch.template_name || "Mặc định"}` : "",
        skuList.length > 0 ? `• SKU: ${skuPreview}${remaining}` : "",
        `• 📥 **Link tải Excel tổng hợp:** ${downloadUrl}`,
      ].filter(Boolean),
    );
  }
}
