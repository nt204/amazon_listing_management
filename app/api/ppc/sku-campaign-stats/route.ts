// app/api/ppc/sku-campaign-stats/route.ts
// Số thật theo campaign + target của 1 SKU trong cùng snapshot mà Auto Bid dùng (coverage = days).
import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { loadSkuCampaignStats } from "@/lib/ppc/sku-campaign-stats";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const scope = dataScope(await authorize(request, "read", "ppc"));
    const { searchParams } = new URL(request.url);
    const storeName = (searchParams.get("storeName") || "ALL").trim();
    const sku = (searchParams.get("sku") || "").trim();
    const days = Number(searchParams.get("days") || 30);

    if (!sku || sku.length > 200 || storeName.length > 80) throw new ApiError("Thiếu SKU hoặc store không hợp lệ.", 400);
    if (!Number.isInteger(days) || days < 1 || days > 3650) throw new ApiError("Số ngày không hợp lệ.", 400);

    const sql = await getDatabaseClient();
    const stats = await loadSkuCampaignStats(sql, { teamId: scope.teamId, storeName, days, sku });
    return Response.json({ sku, storeName, days, ...stats });
  } catch (error) {
    return routeErrorResponse(error, "Không tải được số liệu campaign của SKU", 500);
  }
}
