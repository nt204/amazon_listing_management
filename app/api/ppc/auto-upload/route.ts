// app/api/ppc/auto-upload/route.ts
import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import {
  executeAutoUploadZeroSpendActions,
  getAutoUploadLogs,
  resolveStoreId,
} from "@/lib/ppc/sku-architecture-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    authorize(request, "read");
    const { searchParams } = new URL(request.url);
    const storeId = await resolveStoreId(searchParams.get("storeId"));

    const logs = await getAutoUploadLogs(storeId);
    return Response.json({ success: true, data: logs });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy lịch sử Auto Upload AdsPower.", 500);
  }
}

export async function POST(request: Request) {
  try {
    authorize(request, "write");
    enforceRequestSize(request);

    const body = await request.json().catch(() => ({}));
    const { searchParams } = new URL(request.url);
    const storeId = await resolveStoreId(body?.storeId || searchParams.get("storeId"));
    const actionIds = Array.isArray(body?.actionIds) ? body.actionIds : undefined;

    const result = await executeAutoUploadZeroSpendActions(storeId, actionIds);

    return Response.json({
      success: true,
      data: result.log,
      message: result.message,
    });
  } catch (error: any) {
    return routeErrorResponse(error, error?.message || "Lỗi khi tự động upload lên AdsPower.", 500);
  }
}
