import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { getAccountingDashboard } from "@/lib/accounting/dashboard-db";
import type { DashboardCompareMode } from "@/lib/accounting/dashboard-periods";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COMPARE_MODES = new Set<DashboardCompareMode>(["prev", "week", "month", "yoy", "none"]);

export async function GET(request: Request) {
  try {
    await authorize(request, "read", "accounting");
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

    const compareParam = searchParams.get("compare") as DashboardCompareMode | null;
    const compare = compareParam && COMPARE_MODES.has(compareParam) ? compareParam : "prev";

    const fresh = searchParams.get("fresh") === "1";
    const team = searchParams.get("team") || "";

    const data = await getAccountingDashboard({ startDate, endDate, storeIds, compare, fresh, team });
    return Response.json(data);
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải Dashboard kế toán.", 500);
  }
}
