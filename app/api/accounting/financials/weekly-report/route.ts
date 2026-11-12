import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { getAccountingAccess, storeChannelsFor } from "@/lib/accounting/access";
import { getWeeklyReport } from "@/lib/accounting/weekly-report";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// BÁO CÁO TUẦN tổng hợp mọi store — GET ?date=YYYY-MM-DD (ngày bất kỳ trong tuần; bỏ trống = tuần mới nhất)
export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "accounting");
    const access = await getAccountingAccess(actor);
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || "";
    const report = await getWeeklyReport({
      date: DATE_RE.test(date) ? date : new Date().toISOString().slice(0, 10),
      allowedChannels: access.full ? undefined : (id: string) => storeChannelsFor(access, id),
      canViewPayout: actor.role === "admin" || actor.role === "accountant",
    });
    return Response.json(report);
  } catch (error) {
    return routeErrorResponse(error, "Không tải được báo cáo tuần.", 500);
  }
}
