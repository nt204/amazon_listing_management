import { authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { listPpcDailyCampaignsFromDb } from "@/lib/ppc/repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const scope = dataScope(authorize(request, "read"));
    const { searchParams } = new URL(request.url);
    const storeName = searchParams.get("storeName") || "ALL";
    const days = Math.min(Math.max(Number(searchParams.get("days") || 7), 1), 30);

    // Drill-down phải phản ánh ngay dữ liệu vừa ingest. Không cache kết quả này
    // vì phần KPI theo ngày được cập nhật tức thời và cache cũ sẽ khiến hai phần
    // cùng một màn hình hiển thị khác nhau.
    const data = await listPpcDailyCampaignsFromDb(scope, { storeName, days });

    return Response.json({
      success: true,
      storeName,
      days,
      data,
    }, {
      headers: {
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi máy chủ khi tải thống kê chiến dịch theo ngày.", 500);
  }
}
