import { NextResponse } from "next/server";
import { getActorFromRequest } from "@/lib/api-guard";
import { syncTrelloFbaToSkuMaster, findFbaInboundListId } from "@/lib/trello-fba-sync";

// POST /api/trello/sync-fba
// Đồng bộ thẻ từ cột 'ĐI HÀNG FBA' trên Trello vào BẢNG MÃ (accounting_sku_master)
export async function POST(req: Request) {
  try {
    const actor = await getActorFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const boardId = body.boardId || process.env.TRELLO_BOARD_ID || "hcmdsBOh";
    const defaultStoreId = body.defaultStoreId || undefined;
    const dryRun = Boolean(body.dryRun);

    const result = await syncTrelloFbaToSkuMaster({
      boardId,
      defaultStoreId,
      dryRun,
    });

    return NextResponse.json({
      ok: true,
      data: result,
    });
  } catch (err: any) {
    console.error("[API Trello Sync FBA Error]:", err);
    return NextResponse.json(
      { ok: false, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
