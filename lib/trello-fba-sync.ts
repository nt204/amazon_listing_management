import "server-only";

import { getDatabaseClient } from "@/lib/db";
import {
  fetchCardsFromTrelloList,
  parseTrelloFbaCard,
  getCardMoveDate,
  type ParsedTrelloFbaCard,
} from "./trello-fba-parser";

export interface SyncTrelloFbaOptions {
  boardId: string;
  listId?: string;
  defaultStoreId?: string;
  dryRun?: boolean;
}

export interface SyncTrelloFbaResult {
  totalCards: number;
  insertedSkus: string[];
  updatedSkus: string[];
  skippedCards: Array<{ title: string; reason: string }>;
  parsedDetails: ParsedTrelloFbaCard[];
  dryRun: boolean;
}

/**
 * Tìm List ID của cột 'ĐI HÀNG FBA' trên Board
 */
export async function findFbaInboundListId(boardId: string): Promise<string> {
  const { getTrelloServerCredentials } = await import("@/lib/trello-server-config");
  const { apiKey, token } = getTrelloServerCredentials();
  const url = `https://api.trello.com/1/boards/${boardId}/lists?fields=id,name&key=${apiKey}&token=${token}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Không lấy được danh sách cột của Board ${boardId} (${res.status})`);
  }

  const lists = (await res.json()) as Array<{ id: string; name: string }>;
  const target = lists.find((l) => {
    const n = l.name.toLowerCase().trim();
    return n.includes("đi hàng fba") || n.includes("di hang fba") || n.includes("đi hàng") || n.includes("fba inbound");
  });

  if (!target) {
    throw new Error(
      `Không tìm thấy cột "ĐI HÀNG FBA" trên Board. Các cột hiện có: ${lists.map((l) => l.name).join(", ")}`
    );
  }

  return target.id;
}

/**
 * Đồng bộ thẻ từ cột 'ĐI HÀNG FBA' trên Trello vào bảng accounting_sku_master
 */
export async function syncTrelloFbaToSkuMaster(options: SyncTrelloFbaOptions): Promise<SyncTrelloFbaResult> {
  const sql = await getDatabaseClient();

  // 1. Xác định list ID
  const listId = options.listId || (await findFbaInboundListId(options.boardId));

  // 2. Lấy danh sách Store và Product Type chuẩn từ DB để so khớp không phân biệt hoa thường
  const stores = await sql<Array<{ id: string; name: string }>>`
    SELECT id, name FROM stores ORDER BY name;
  `;
  const ptRows = await sql<Array<{ product_type: string }>>`
    SELECT DISTINCT product_type FROM accounting_sku_master 
    WHERE product_type IS NOT NULL AND product_type != ''
    ORDER BY product_type;
  `;
  const knownProductTypes = ptRows.map((r) => r.product_type);

  // 3. Tải danh sách thẻ từ Trello
  const rawCards = await fetchCardsFromTrelloList(listId);

  const insertedSkus: string[] = [];
  const updatedSkus: string[] = [];
  const skippedCards: Array<{ title: string; reason: string }> = [];
  const parsedDetails: ParsedTrelloFbaCard[] = [];

  for (const card of rawCards) {
    // Lấy ngày thẻ được kéo vào cột (nếu có trong 10 actions gần nhất)
    const moveDate = await getCardMoveDate(card.id, listId);
    const parsed = await parseTrelloFbaCard(card, stores, knownProductTypes, moveDate);

    // Nếu thẻ không có nhãn store nhưng có defaultStoreId thì fallback
    if (!parsed.storeId && options.defaultStoreId) {
      const defStore = stores.find((s) => s.id === options.defaultStoreId);
      if (defStore) {
        parsed.storeId = defStore.id;
        parsed.storeName = defStore.name;
      }
    }

    parsedDetails.push(parsed);

    // Kiểm tra tính hợp lệ tối thiểu
    if (!parsed.sku) {
      skippedCards.push({ title: card.name, reason: "Không tìm thấy mã SKU" });
      continue;
    }
    if (!parsed.storeId) {
      skippedCards.push({
        title: card.name,
        reason: `Chưa gán nhãn Store (cần 1 trong các nhãn: ${stores.map((s) => s.name).join(", ")})`,
      });
      continue;
    }

    if (options.dryRun) {
      insertedSkus.push(parsed.sku);
      continue;
    }

    // 4. Upsert vào accounting_sku_master
    const upsertRes = await sql<{ id: string; xmax: string }[]>`
      INSERT INTO accounting_sku_master (
        store_id,
        sku,
        brand,
        product_type,
        mockup,
        mockup_url,
        niche,
        pic_mkt,
        pic_idea,
        status,
        event,
        thang_listing,
        file_design,
        last_changed_by,
        created_at,
        updated_at
      ) VALUES (
        ${parsed.storeId},
        ${parsed.sku},
        ${parsed.storeName},
        ${parsed.productType},
        ${parsed.mockupUrl},
        ${parsed.mockupUrl},
        ${parsed.niche},
        ${parsed.picMkt},
        ${parsed.picIdea},
        ${parsed.status},
        ${parsed.event},
        ${parsed.thangListing},
        ${parsed.fileDesign},
        'trello_sync',
        NOW(),
        NOW()
      )
      ON CONFLICT (store_id, sku) DO UPDATE SET
        brand = COALESCE(EXCLUDED.brand, accounting_sku_master.brand),
        product_type = COALESCE(EXCLUDED.product_type, accounting_sku_master.product_type),
        mockup = CASE 
          WHEN EXCLUDED.mockup IS NOT NULL AND EXCLUDED.mockup != '[object Object]' THEN EXCLUDED.mockup
          ELSE accounting_sku_master.mockup
        END,
        mockup_url = CASE 
          WHEN EXCLUDED.mockup_url IS NOT NULL AND EXCLUDED.mockup_url != '[object Object]' THEN EXCLUDED.mockup_url
          ELSE accounting_sku_master.mockup_url
        END,
        niche = COALESCE(EXCLUDED.niche, accounting_sku_master.niche),
        pic_mkt = COALESCE(EXCLUDED.pic_mkt, accounting_sku_master.pic_mkt),
        pic_idea = COALESCE(EXCLUDED.pic_idea, accounting_sku_master.pic_idea),
        status = COALESCE(EXCLUDED.status, accounting_sku_master.status),
        event = COALESCE(EXCLUDED.event, accounting_sku_master.event),
        thang_listing = COALESCE(EXCLUDED.thang_listing, accounting_sku_master.thang_listing),
        file_design = COALESCE(EXCLUDED.file_design, accounting_sku_master.file_design),
        deleted_at = NULL,
        last_changed_by = 'trello_sync',
        updated_at = NOW()
      RETURNING id, (xmax = 0)::text as is_inserted;
    `;

    const row = upsertRes[0];
    if (row?.is_inserted === "true") {
      insertedSkus.push(parsed.sku);
    } else {
      updatedSkus.push(parsed.sku);
    }
  }

  return {
    totalCards: rawCards.length,
    insertedSkus,
    updatedSkus,
    skippedCards,
    parsedDetails,
    dryRun: Boolean(options.dryRun),
  };
}

