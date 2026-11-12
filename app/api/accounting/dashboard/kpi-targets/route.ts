import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { getAccountingAccess, storeChannelsFor } from "@/lib/accounting/access";
import { getStoreWindowTargets } from "@/lib/accounting/kpi-month-targets";
import { kpiWindowOf } from "@/lib/accounting/kpi-progress";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Mục tiêu KPI (FBA, SKU WIN / SKU TEST) của các store trong khung tuần / tháng — thanh tiến độ trang Overview.
// GET ?start_date&end_date&unit=week|month&store_ids=a,b
export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "accounting");
    const access = await getAccountingAccess(actor);
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("start_date") || "";
    const endDate = searchParams.get("end_date") || "";
    if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
      return Response.json({ error: "start_date/end_date phải có dạng YYYY-MM-DD" }, { status: 400 });
    }
    const window = kpiWindowOf(startDate, endDate, searchParams.get("unit") || "");
    if (!window) return Response.json({ window: null, stores: [] });
    const storeIds = (searchParams.get("store_ids") || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 100)
      // KPI kinh doanh là của kênh FBA: chỉ store người dùng được xem FBA
      .filter((id) => access.full || storeChannelsFor(access, id).includes("FBA"));

    const stores = [];
    for (const storeId of storeIds) {
      try {
        stores.push({ storeId, ...(await getStoreWindowTargets(storeId, window)) });
      } catch {
        // Store chưa có dữ liệu KPI → bỏ qua, không làm hỏng cả trang
      }
    }
    return Response.json({ window, stores });
  } catch (error) {
    return routeErrorResponse(error, "Không tải được mục tiêu KPI.", 500);
  }
}
