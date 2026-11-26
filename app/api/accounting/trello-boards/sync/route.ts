import { NextResponse } from "next/server";
import { authorize, routeErrorResponse, ApiError } from "@/lib/api-guard";
import { syncTrelloFbaToSkuMaster } from "@/lib/trello-fba-sync";
import { getDatabaseClient } from "@/lib/db";

// POST /api/accounting/trello-boards/sync
// Đồng bộ toàn bộ thẻ hiện có trong cột 'ĐI HÀNG FBA' của Board vào Bảng Mã
export async function POST(req: Request) {
  try {
    await authorize(req, "write");
    const body = await req.json();
    const { boardId, listId, defaultStoreId } = body;

    if (!boardId) {
      throw new ApiError("Vui lòng cung cấp boardId cần đồng bộ.", 400);
    }

    const result = await syncTrelloFbaToSkuMaster({
      boardId,
      listId,
      defaultStoreId,
      dryRun: false,
    });

    // Cập nhật last_event_at trong DB
    try {
      const sql = await getDatabaseClient();
      await sql`
        UPDATE trello_fba_boards 
        SET last_event_at = NOW(), updated_at = NOW() 
        WHERE board_id = ${boardId};
      `;
    } catch {
      // ignore
    }

    return NextResponse.json({
      ok: true,
      totalCards: result.totalCards,
      insertedCount: result.insertedSkus.length,
      updatedCount: result.updatedSkus.length,
      skippedCount: result.skippedCards.length,
      skippedCards: result.skippedCards,
      message: `Đồng bộ thành công ${result.insertedSkus.length + result.updatedSkus.length}/${result.totalCards} thẻ Trello vào Bảng Mã!`,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi đồng bộ thẻ Trello");
  }
}

