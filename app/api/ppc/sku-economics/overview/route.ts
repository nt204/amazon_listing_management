import { ApiError, authorize, routeErrorResponse } from "@/lib/api-guard";
import { getSkuEconomicsList, resolveStoreId } from "@/lib/ppc/sku-architecture-service";

export const runtime = "nodejs";

const OVERVIEW_LIMIT = 5;

export async function GET(request: Request) {
  try {
    await authorize(request, "read", "ppc");
    const { searchParams } = new URL(request.url);
    const storeId = await resolveStoreId(searchParams.get("storeId"));
    const days = Number(searchParams.get("days") || 30);

    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      throw new ApiError("Số ngày phải là số nguyên từ 1 đến 3650.", 400);
    }

    // Reuse the shared one-hour economics cache, but keep the overview payload
    // constant-size even when a store grows to thousands of SKUs.
    const economics = await getSkuEconomicsList(storeId, days);
    const attentionSkus = economics
      .filter((item) => (
        (item.spend || 0) > 0
        && item.breakEvenAcos > 0
        && (item.acos || 0) > item.breakEvenAcos
      ))
      .sort((a, b) => {
        const spendDifference = (b.spend || 0) - (a.spend || 0);
        if (spendDifference !== 0) return spendDifference;
        return ((b.acos || 0) - b.breakEvenAcos) - ((a.acos || 0) - a.breakEvenAcos);
      })
      .slice(0, OVERVIEW_LIMIT)
      .map((item) => ({
        sku: item.sku,
        spend: item.spend || 0,
        orders: item.orders || 0,
        sales: item.sales || 0,
        acos: item.acos || 0,
        breakEvenAcos: item.breakEvenAcos,
      }));

    return Response.json({ success: true, data: attentionSkus });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy tổng quan SKU cần chú ý.", 500);
  }
}
