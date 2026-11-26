import { NextResponse } from "next/server";
import { getDatabaseClient } from "@/lib/db";
import { getTrelloServerCredentials } from "@/lib/trello-server-config";
import { authorize, routeErrorResponse, ApiError } from "@/lib/api-guard";

function extractBoardId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/trello\.com\/b\/([a-zA-Z0-9]+)/);
  if (match) return match[1];
  return trimmed;
}

const WEBHOOK_CALLBACK_URL = "https://fulfill.ncehub.net/api/trello/webhook";

/**
 * Đăng ký hoặc tái kích hoạt Webhook trên Trello
 */
async function registerTrelloWebhook(boardHexId: string, boardName: string, apiKey: string, token: string) {
  try {
    // 1. Kiểm tra webhook đã tồn tại chưa
    const listRes = await fetch(`https://api.trello.com/1/tokens/${token}/webhooks?key=${apiKey}`);
    if (listRes.ok) {
      const hooks = (await listRes.json()) as Array<{
        id: string;
        idModel: string;
        callbackURL: string;
        active: boolean;
      }>;
      const existing = hooks.find((h) => h.idModel === boardHexId && h.callbackURL === WEBHOOK_CALLBACK_URL);
      if (existing) {
        if (!existing.active) {
          await fetch(`https://api.trello.com/1/webhooks/${existing.id}?active=true&key=${apiKey}&token=${token}`, {
            method: "PUT",
          });
        }
        return { webhookId: existing.id, error: null };
      }
    }

    // 2. Tạo mới webhook
    const createRes = await fetch(`https://api.trello.com/1/webhooks/?key=${apiKey}&token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callbackURL: WEBHOOK_CALLBACK_URL,
        idModel: boardHexId,
        description: `NCE FBA Webhook - ${boardName}`,
        active: true,
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      return { webhookId: null, error: `Lỗi đăng ký Webhook Trello (${createRes.status}): ${errText}` };
    }

    const data = (await createRes.json()) as { id: string };
    return { webhookId: data.id, error: null };
  } catch (err: any) {
    return { webhookId: null, error: err?.message || String(err) };
  }
}

/**
 * Xóa webhook khỏi Trello
 */
async function deleteTrelloWebhook(webhookId: string, apiKey: string, token: string) {
  try {
    await fetch(`https://api.trello.com/1/webhooks/${webhookId}?key=${apiKey}&token=${token}`, {
      method: "DELETE",
    });
  } catch (err) {
    console.error("Xóa webhook trên Trello thất bại:", err);
  }
}

// GET: Lấy danh sách các Board Trello đã cấu hình + danh sách Store để chọn
export async function GET(req: Request) {
  try {
    await authorize(req, "read");
    const sql = await getDatabaseClient();

    const boards = await sql<Array<{
      id: string;
      board_id: string;
      board_name: string;
      target_list_name: string;
      target_list_id: string | null;
      webhook_id: string | null;
      default_store_id: string | null;
      default_store_name: string | null;
      is_active: boolean;
      last_event_at: string | null;
      created_at: string;
    }>>`
      SELECT 
        b.id,
        b.board_id,
        b.board_name,
        b.target_list_name,
        b.target_list_id,
        b.webhook_id,
        b.default_store_id,
        s.name AS default_store_name,
        b.is_active,
        b.last_event_at,
        b.created_at
      FROM trello_fba_boards b
      LEFT JOIN stores s ON s.id = b.default_store_id
      ORDER BY b.created_at ASC;
    `;

    const stores = await sql<Array<{ id: string; name: string }>>`
      SELECT id, name FROM stores ORDER BY name;
    `;

    return NextResponse.json({ ok: true, boards, stores });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải cấu hình Trello FBA boards");
  }
}

// POST: Thêm mới hoặc kết nối board Trello
export async function POST(req: Request) {
  try {
    await authorize(req, "write");
    const body = await req.json();
    const rawBoard = body.urlOrId || body.boardId;
    if (!rawBoard) {
      throw new ApiError("Vui lòng nhập Link hoặc ID của Trello Board.", 400);
    }

    const boardKey = extractBoardId(rawBoard);
    const targetListName = (body.targetListName || "ĐI HÀNG FBA").trim();
    const defaultStoreId = body.defaultStoreId || null;

    // 1. Gọi Trello API để xác thực board và lấy danh sách cột
    const { apiKey, token } = getTrelloServerCredentials();
    const boardUrl = `https://api.trello.com/1/boards/${boardKey}?fields=id,name,shortLink,url&lists=open&list_fields=id,name&key=${apiKey}&token=${token}`;
    const boardRes = await fetch(boardUrl, { cache: "no-store" });
    if (!boardRes.ok) {
      const errText = await boardRes.text();
      throw new ApiError(`Không thể truy cập Trello Board "${boardKey}" (${boardRes.status}): ${errText}`, 400);
    }

    const boardInfo = (await boardRes.json()) as {
      id: string;
      name: string;
      shortLink: string;
      lists?: Array<{ id: string; name: string }>;
    };

    // Tìm list ID tương ứng với targetListName
    const lists = boardInfo.lists || [];
    const targetList = lists.find((l) => {
      const n = l.name.toLowerCase().trim();
      const target = targetListName.toLowerCase().trim();
      return n === target || n.includes(target) || (target.includes("đi hàng") && n.includes("đi hàng"));
    });

    const targetListId = targetList?.id || null;
    const resolvedListName = targetList?.name || targetListName;

    // 2. Thử đăng ký Webhook với Trello
    const { webhookId, error: webhookError } = await registerTrelloWebhook(
      boardInfo.id,
      boardInfo.name,
      apiKey,
      token,
    );

    // 3. Lưu vào DB
    const sql = await getDatabaseClient();
    const boardIdToSave = boardInfo.shortLink || boardKey;

    const inserted = await sql<Array<{ id: string }>>`
      INSERT INTO trello_fba_boards (
        board_id,
        board_name,
        target_list_name,
        target_list_id,
        webhook_id,
        default_store_id,
        is_active,
        updated_at
      ) VALUES (
        ${boardIdToSave},
        ${boardInfo.name},
        ${resolvedListName},
        ${targetListId},
        ${webhookId},
        ${defaultStoreId},
        true,
        NOW()
      )
      ON CONFLICT (board_id) DO UPDATE SET
        board_name = EXCLUDED.board_name,
        target_list_name = EXCLUDED.target_list_name,
        target_list_id = COALESCE(EXCLUDED.target_list_id, trello_fba_boards.target_list_id),
        webhook_id = COALESCE(EXCLUDED.webhook_id, trello_fba_boards.webhook_id),
        default_store_id = EXCLUDED.default_store_id,
        is_active = true,
        updated_at = NOW()
      RETURNING id;
    `;

    return NextResponse.json({
      ok: true,
      boardId: boardIdToSave,
      boardName: boardInfo.name,
      targetListName: resolvedListName,
      targetListId,
      webhookId,
      webhookWarning: webhookError,
      message: webhookId
        ? `Đã kết nối Board "${boardInfo.name}" và kích hoạt Webhook tự động thành công!`
        : `Đã kết nối Board "${boardInfo.name}". (Lưu ý Webhook: ${webhookError || "chờ triển khai"})`,
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể kết nối Trello board");
  }
}

// PATCH: Cập nhật trạng thái bật/tắt hoặc thử kích hoạt lại webhook
export async function PATCH(req: Request) {
  try {
    await authorize(req, "write");
    const body = await req.json();
    const { id, isActive, defaultStoreId, retryWebhook } = body;

    if (!id) throw new ApiError("Thiếu ID bản ghi cần cập nhật.", 400);

    const sql = await getDatabaseClient();
    const existing = await sql<Array<{
      id: string;
      board_id: string;
      board_name: string;
      webhook_id: string | null;
      target_list_id: string | null;
      target_list_name: string;
    }>>`
      SELECT id, board_id, board_name, webhook_id, target_list_id, target_list_name
      FROM trello_fba_boards
      WHERE id = ${id}
      LIMIT 1;
    `;

    if (existing.length === 0) throw new ApiError("Không tìm thấy cấu hình board.", 404);
    const board = existing[0];

    let newWebhookId = board.webhook_id;
    let webhookWarning: string | null = null;

    if (retryWebhook || (!board.webhook_id && isActive !== false)) {
      const { apiKey, token } = getTrelloServerCredentials();
      // Lấy full hex ID từ Trello
      const boardRes = await fetch(`https://api.trello.com/1/boards/${board.board_id}?fields=id,name&key=${apiKey}&token=${token}`);
      if (boardRes.ok) {
        const info = (await boardRes.json()) as { id: string; name: string };
        const res = await registerTrelloWebhook(info.id, info.name, apiKey, token);
        if (res.webhookId) {
          newWebhookId = res.webhookId;
        } else {
          webhookWarning = res.error;
        }
      }
    }

    await sql`
      UPDATE trello_fba_boards
      SET 
        is_active = COALESCE(${isActive !== undefined ? isActive : null}, is_active),
        default_store_id = ${defaultStoreId !== undefined ? defaultStoreId : sql`default_store_id`},
        webhook_id = ${newWebhookId},
        updated_at = NOW()
      WHERE id = ${id};
    `;

    return NextResponse.json({
      ok: true,
      webhookId: newWebhookId,
      webhookWarning,
      message: "Đã cập nhật cấu hình Board thành công!",
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể cập nhật Trello board");
  }
}

// DELETE: Xóa cấu hình board và gỡ webhook
export async function DELETE(req: Request) {
  try {
    await authorize(req, "write");
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) throw new ApiError("Thiếu ID bản ghi cần xóa.", 400);

    const sql = await getDatabaseClient();
    const existing = await sql<Array<{ id: string; webhook_id: string | null }>>`
      SELECT id, webhook_id FROM trello_fba_boards WHERE id = ${id} LIMIT 1;
    `;

    if (existing.length > 0) {
      const { webhook_id } = existing[0];
      if (webhook_id) {
        const { apiKey, token } = getTrelloServerCredentials();
        await deleteTrelloWebhook(webhook_id, apiKey, token);
      }
      await sql`DELETE FROM trello_fba_boards WHERE id = ${id};`;
    }

    return NextResponse.json({ ok: true, message: "Đã xóa cấu hình Board và hủy Webhook." });
  } catch (error) {
    return routeErrorResponse(error, "Không thể xóa Trello board");
  }
}

