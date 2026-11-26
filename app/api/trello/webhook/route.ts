import { NextResponse } from "next/server";
import { getDatabaseClient } from "@/lib/db";
import { parseTrelloFbaCard, type TrelloCardDetail } from "@/lib/trello-fba-parser";
import { getTrelloServerCredentials } from "@/lib/trello-server-config";

// HEAD /api/trello/webhook
// Trello gọi HEAD request khi đăng ký Webhook để kiểm tra endpoint có tồn tại (phải trả về HTTP 200)
export async function HEAD() {
  return new Response(null, { status: 200 });
}

// GET /api/trello/webhook
// Dự phòng cho một số trình duyệt / service ping thử
export async function GET() {
  return new Response("OK", { status: 200 });
}

// POST /api/trello/webhook
// Trello bắn payload sự kiện khi có bất kỳ thay đổi nào trên Board
export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => null);
    if (!payload || !payload.action) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    const action = payload.action;
    const actionType = action.type;
    const model = payload.model; // Board info
    const boardId = model?.id;

    // Chỉ quan tâm sự kiện di chuyển thẻ sang cột khác (updateCard:idList) hoặc tạo thẻ mới trong cột (createCard)
    const isMove = actionType === "updateCard" && action.data?.listAfter?.id;
    const isCreate = actionType === "createCard" && action.data?.list?.id;

    if (!isMove && !isCreate) {
      return NextResponse.json({ ok: true, ignored: true, reason: "Not a card move or create action" });
    }

    const targetListId = isMove ? action.data.listAfter.id : action.data.list.id;
    const targetListName = (isMove ? action.data.listAfter.name : action.data.list.name) || "";
    const cardId = action.data?.card?.id;

    if (!cardId) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    // Kiểm tra xem board này có trong danh sách theo dõi không
    const sql = await getDatabaseClient();
    const boards = await sql<Array<{
      id: string;
      board_id: string;
      target_list_name: string;
      target_list_id: string | null;
      default_store_id: string | null;
    }>>`
      SELECT id, board_id, target_list_name, target_list_id, default_store_id
      FROM trello_fba_boards
      WHERE is_active = true AND (board_id = ${boardId} OR board_id = ${model?.shortLink || ""})
      LIMIT 1;
    `;

    const config = boards[0];
    // Nếu chưa cấu hình trong DB nhưng tên cột chứa 'ĐI HÀNG FBA' thì vẫn xử lý tự động
    const isTargetList = config
      ? (config.target_list_id ? config.target_list_id === targetListId : targetListName.toLowerCase().includes(config.target_list_name.toLowerCase()))
      : targetListName.toLowerCase().includes("đi hàng fba") || targetListName.toLowerCase().includes("di hang fba");

    if (!isTargetList) {
      return NextResponse.json({ ok: true, ignored: true, reason: `List ${targetListName} is not target list` });
    }

    console.log(`[Trello Webhook] Phát hiện thẻ ${cardId} chuyển vào cột ${targetListName} trên board ${boardId}`);

    // Tải thông tin chi tiết đầy đủ của thẻ từ Trello API (kèm labels, attachments, desc)
    const { apiKey, token } = getTrelloServerCredentials();
    const cardUrl = `https://api.trello.com/1/cards/${cardId}?attachments=true&fields=id,name,desc,dateLastActivity,labels&key=${apiKey}&token=${token}`;
    const cardRes = await fetch(cardUrl, { cache: "no-store" });
    if (!cardRes.ok) {
      console.error(`[Trello Webhook] Không lấy được chi tiết thẻ ${cardId}: ${cardRes.status}`);
      return NextResponse.json({ ok: false, error: "Failed to fetch card details" }, { status: 500 });
    }

    const cardDetail = (await cardRes.json()) as TrelloCardDetail;

    // Lấy danh sách Store và Product Type chuẩn từ DB
    const stores = await sql<Array<{ id: string; name: string }>>`SELECT id, name FROM stores ORDER BY name;`;
    const ptRows = await sql<Array<{ product_type: string }>>`
      SELECT DISTINCT product_type FROM accounting_sku_master 
      WHERE product_type IS NOT NULL AND product_type != ''
      ORDER BY product_type;
    `;
    const knownProductTypes = ptRows.map((r) => r.product_type);

    // Bóc tách thẻ
    const parsed = await parseTrelloFbaCard(cardDetail, stores, knownProductTypes, action.date);

    if (!parsed.storeId && config?.default_store_id) {
      const defStore = stores.find((s) => s.id === config.default_store_id);
      if (defStore) {
        parsed.storeId = defStore.id;
        parsed.storeName = defStore.name;
      }
    }

    if (!parsed.sku || !parsed.storeId) {
      console.warn(`[Trello Webhook] Thẻ ${cardDetail.name} thiếu SKU hoặc Store, không thể nạp vào Bảng Mã.`);
      return NextResponse.json({ ok: true, skipped: true, reason: "Missing SKU or Store" });
    }

    // Upsert vào accounting_sku_master
    await sql`
      INSERT INTO accounting_sku_master (
        store_id, sku, brand, product_type, mockup, mockup_url,
        niche, pic_mkt, pic_idea, status, event, thang_listing,
        file_design, last_changed_by, created_at, updated_at
      ) VALUES (
        ${parsed.storeId}, ${parsed.sku}, ${parsed.storeName}, ${parsed.productType},
        ${parsed.mockupUrl}, ${parsed.mockupUrl}, ${parsed.niche}, ${parsed.picMkt},
        ${parsed.picIdea}, ${parsed.status}, ${parsed.event}, ${parsed.thangListing},
        ${parsed.fileDesign}, 'trello_webhook', NOW(), NOW()
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
        last_changed_by = 'trello_webhook',
        updated_at = NOW()
    `;

    // Cập nhật timestamp cho board
    if (config) {
      await sql`UPDATE trello_fba_boards SET last_event_at = NOW(), updated_at = NOW() WHERE id = ${config.id}`;
    }

    console.log(`[Trello Webhook] ✅ Đã tự động nạp SKU ${parsed.sku} (${parsed.storeName}) vào Bảng Mã thành công!`);

    return NextResponse.json({ ok: true, synced: true, sku: parsed.sku });
  } catch (err: any) {
    console.error("[Trello Webhook Error]:", err);
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
