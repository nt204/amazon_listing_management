import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { getAccountingAccess, storeChannelsFor } from "@/lib/accounting/access";
import { getDashboardTopProducts } from "@/lib/accounting/dashboard-db";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "accounting");
    // Phân quyền kế toán: chỉ tính store / kênh được xem
    const access = await getAccountingAccess(actor);
    const allowedChannels = access.full ? undefined : (id: string) => storeChannelsFor(access, id);
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("start_date") || "";
    const endDate = searchParams.get("end_date") || "";
    if ((startDate && !DATE_RE.test(startDate)) || (endDate && !DATE_RE.test(endDate))) {
      return Response.json({ error: "start_date/end_date phải có dạng YYYY-MM-DD" }, { status: 400 });
    }
    const storeIds = (searchParams.get("store_ids") || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const team = searchParams.get("team") || "";

    const data = await getDashboardTopProducts({ startDate, endDate, storeIds, team, allowedChannels });
    return Response.json(data);
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải Top sản phẩm.", 500);
  }
}
