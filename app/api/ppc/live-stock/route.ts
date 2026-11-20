// app/api/ppc/live-stock/route.ts
// Tồn real time (FBA + AWD) + giá trị tồn từng SKU của 1 store PPC — cột "Tồn" / "Giá trị tồn" ở tab SKU, Đề xuất & Auto bid.
// Dữ liệu: accounting_live_inventory (crawler kế toán 16h10), map store PPC → store kế toán.
import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { getAccountingStoreForPpcStore } from "@/lib/ppc/sku-architecture-service";
import { queryLiveStock } from "@/lib/accounting/live-inventory";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const scope = dataScope(await authorize(request, "read", "ppc"));
    const storeName = (new URL(request.url).searchParams.get("storeName") || "").trim();
    if (!storeName || storeName === "ALL") throw new ApiError("Chọn store trước.", 400);

    const sql = await getDatabaseClient();
    const [store] = await sql<{ id: string }[]>`
      SELECT id FROM ppc_stores WHERE team_id = ${scope.teamId} AND lower(name) = lower(${storeName}) LIMIT 1
    `;
    if (!store) throw new ApiError("Không tìm thấy store.", 404);

    const acc = await getAccountingStoreForPpcStore(store.id);
    if (!acc) return Response.json({ success: true, meta: null, items: {} });
    const live = await queryLiveStock(acc.accountingStoreId);
    return Response.json({
      success: true,
      meta: { fbaAt: live.fbaAt, awdAt: live.awdAt, fbaLabel: live.fbaLabel, awdLabel: live.awdLabel },
      items: Object.fromEntries(live.bySku),
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi tải tồn kho real time.", 500);
  }
}
