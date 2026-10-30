import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { hasFullAccountingAccess } from "@/lib/accounting/access";
import { reportDailyBusinessData } from "@/lib/accounting/daily-business-reporter";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    // Báo cáo gộp mọi store: chỉ người toàn quyền kế toán được gửi
    if (!hasFullAccountingAccess(actor)) throw new ApiError("Chỉ Admin hoặc Kế toán được gửi báo cáo ngày.", 403);
    const scope = dataScope(actor);
    const body = await request.json().catch(() => ({}));
    const force = Boolean(body?.force);
    const targetDate = typeof body?.targetDate === "string" ? body.targetDate.trim() : undefined;

    let recipient: { receiveId: string; receiveIdType: string } | undefined;
    if (body?.recipient && typeof body.recipient === "object") {
      recipient = {
        receiveId: String(body.recipient.receiveId || "").trim(),
        receiveIdType: String(body.recipient.receiveIdType || "email").trim(),
      };
    } else if (typeof body?.email === "string" && body.email.trim()) {
      recipient = {
        receiveId: body.email.trim(),
        receiveIdType: "email",
      };
    } else if (typeof body?.recipient === "string" && body.recipient.trim()) {
      const rec = body.recipient.trim();
      recipient = {
        receiveId: rec,
        receiveIdType: rec.includes("@") ? "email" : "open_id",
      };
    }

    const result = await reportDailyBusinessData(scope, { force, targetDate, recipient });
    return Response.json(result);
  } catch (error) {
    return routeErrorResponse(error, "Không thể gửi báo cáo kinh doanh ngày qua Lark.");
  }
}
