import { authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { reportDailyBusinessData } from "@/lib/accounting/daily-business-reporter";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const scope = dataScope(actor);
    const body = await request.json().catch(() => ({}));
    const force = Boolean(body?.force);

    const result = await reportDailyBusinessData(scope, { force });
    return Response.json(result);
  } catch (error) {
    return routeErrorResponse(error, "Không thể gửi báo cáo kinh doanh ngày qua Lark.");
  }
}
