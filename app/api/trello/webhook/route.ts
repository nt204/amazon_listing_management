import { NextResponse } from "next/server";
import { getDatabaseClient } from "@/lib/db";
import { parseTrelloFbaCard, type TrelloCardDetail } from "@/lib/trello-fba-parser";
import { getTrelloServerCredentials } from "@/lib/trello-server-config";
import { upsertTrelloSku } from "@/lib/trello-fba-sync";
import { fillSkuIdentifiersFromInventory } from "@/lib/accounting/sku-identifiers";

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
    const boardId = model?.id || action?.data?.board?.id;
    const boardShortLink = model?.shortLink || action?.data?.board?.shortLink;

    // Các sự kiện cần xử lý:
    // 1. Kéo thẻ sang cột khác (updateCard:idList)
    // 2. Tạo thẻ mới trong cột (createCard)
    // 3. Cập nhật thẻ (sửa mô tả, thêm nhãn, thêm ảnh mockup) khi thẻ đang nằm trong cột
    const isMove = actionType === "updateCard" && action.data?.listAfter?.id;
    const isCreate = actionType === "createCard" && action.data?.list?.id;
    const isUpdateInList =
      (actionType === "updateCard" || actionType === "addAttachmentToCard") &&
      Boolean(action.data?.list?.id || action.data?.card?.idList);

    if (!isMove && !isCreate && !isUpdateInList) {
      return NextResponse.json({ ok: true, ignored: true, reason: `Action ${actionType} not tracked` });
    }

    const targetListId = isMove
      ? action.data.listAfter.id
      : (action.data?.list?.id || action.data?.card?.idList);
    const targetListName = (isMove ? action.data.listAfter.name : (action.data?.list?.name || "")) || "";
    const cardId = action.data?.card?.id;

    // Webhook chưa xác thực chữ ký Trello: chỉ tin cardId (đúng định dạng), mọi thông tin khác kiểm tra lại từ Trello API.
    if (!cardId || !/^[0-9a-f]{24}$/i.test(String(cardId))) {
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
      WHERE is_active = true AND (
        board_id = ${boardId || ""} OR 
        board_id = ${boardShortLink || ""}
      )
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
    const cardUrl = `https://api.trello.com/1/cards/${cardId}?attachments=true&fields=id,name,desc,dateLastActivity,labels,idList,idBoard&list=true&list_fields=id,name&board=true&board_fields=id,shortLink&key=${apiKey}&token=${token}`;
    const cardRes = await fetch(cardUrl, { cache: "no-store" });
    if (!cardRes.ok) {
      console.error(`[Trello Webhook] Không lấy được chi tiết thẻ ${cardId}: ${cardRes.status}`);
      return NextResponse.json({ ok: false, error: "Failed to fetch card details" }, { status: 500 });
    }

    const cardDetail = (await cardRes.json()) as TrelloCardDetail & {
      idList?: string;
      idBoard?: string;
      list?: { id: string; name: string };
      board?: { id: string; shortLink?: string };
    };

    // Kiểm tra lại bằng dữ liệu thật của Trello (không tin board / cột trong payload)
    const realListName = (cardDetail.list?.name || "").toLowerCase();
    const realListId = cardDetail.list?.id || cardDetail.idList || "";
    const realBoardIds = [cardDetail.board?.id, cardDetail.board?.shortLink, cardDetail.idBoard].filter(Boolean);
    const boardMatches = config ? realBoardIds.includes(config.board_id) : true;
    const listMatches = config
      ? (config.target_list_id ? config.target_list_id === realListId : realListName.includes(config.target_list_name.toLowerCase()))
      : realListName.includes("đi hàng fba") || realListName.includes("di hang fba");
    if (!boardMatches || !listMatches) {
      console.warn(`[Trello Webhook] Bỏ qua thẻ ${cardId}: board / cột thật không khớp payload.`);
      return NextResponse.json({ ok: true, ignored: true, reason: "Card is not in the target list" });
    }

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

    // Upsert vào accounting_sku_master (dòng mới đánh dấu nguồn Trello: đồng bộ sheet không ghi đè / xoá)
    await upsertTrelloSku(parsed, "trello_webhook");
    await fillSkuIdentifiersFromInventory(parsed.storeId);

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

