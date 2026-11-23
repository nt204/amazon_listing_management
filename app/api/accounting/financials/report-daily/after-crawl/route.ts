import { ApiError, authorize, routeErrorResponse } from "@/lib/api-guard";
import { triggerDailyReportCheckAfterImport } from "@/lib/accounting/daily-business-reporter";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Mac mini gọi 1 lần ở cuối run_accounting_daily.sh, sau khi đã nạp xong Orders, Returns, Service Fees,
 * Ads của mọi store. Chạy đúng luồng tự động (đủ 100% store mới gửi, đã gửi ngày đó thì không gửi lại),
 * nên gọi nhiều lần (chạy bù từng store) cũng không gửi trùng.
 */
export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const body = await request.json().catch(() => ({}));
    const targetDate = typeof body?.targetDate === "string" ? body.targetDate.trim() : "";
    if (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      throw new ApiError("targetDate phải có dạng YYYY-MM-DD.", 400);
    }
    const result = await triggerDailyReportCheckAfterImport(actor.teamId, targetDate || undefined);
    if (!result) throw new ApiError("Không kiểm tra được báo cáo ngày (xem log server).", 500);
    return Response.json(result);
  } catch (error) {
    return routeErrorResponse(error, "Không thể kích hoạt báo cáo ngày sau khi crawl.");
  }
}
