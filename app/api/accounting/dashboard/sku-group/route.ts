import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { getAccountingAccess, storeChannelsFor } from "@/lib/accounting/access";
import { getDashboardSkuGroup, type DashboardSkuGroup } from "@/lib/accounting/dashboard-db";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const GROUPS = new Set<DashboardSkuGroup>(["win", "test"]);

/** Stores Performance chỉ tính SKU Win (Bảng mã "Phát triển") hoặc SKU Test (Bảng mã "Test"). */
export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "accounting");
    const access = await getAccountingAccess(actor);
    const allowedChannels = access.full ? undefined : (id: string) => storeChannelsFor(access, id);
    const { searchParams } = new URL(request.url);
    const group = searchParams.get("group") as DashboardSkuGroup | null;
    if (!group || !GROUPS.has(group)) return Response.json({ error: "group phải là win hoặc test" }, { status: 400 });
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

    const data = await getDashboardSkuGroup({ group, startDate, endDate, storeIds, team, allowedChannels });
    return Response.json(data);
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải số liệu nhóm SKU.", 500);
  }
}
