import { authorize, dataScope, enforceRateLimit, routeErrorResponse } from "@/lib/api-guard";
import { syncPpcReportsFromR2 } from "@/lib/ppc/service";

export const runtime = "nodejs";

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const actor = authorize(request, "write");
    await enforceRateLimit(actor, "ppc-r2-sync", 3, 60);
    const body = await request.json().catch(() => ({})) as {
      batchId?: unknown;
      batchDate?: unknown;
      storeNames?: unknown;
    };
    const hasTarget = body.batchId != null || body.batchDate != null || body.storeNames != null;
    const target = hasTarget ? {
      batchId: String(body.batchId || ""),
      batchDate: String(body.batchDate || ""),
      storeNames: Array.isArray(body.storeNames) ? body.storeNames.map(String) : [],
    } : undefined;
    const result = await syncPpcReportsFromR2(dataScope(actor), target);
    const failureSuffix = result.failed ? ` Có ${result.failed} file lỗi.` : "";
    return Response.json({
      success: result.failed === 0,
      message: `Đã quét ${result.filesFound} file: xử lý ${result.filesProcessed} báo cáo PPC (${result.bulkFiles} Bulk, ${result.searchTermFiles} Search Term), bỏ qua ${result.ignored} file không nhận diện; ghi ${result.totalNew} dòng mới.${failureSuffix}`,
      result,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi quét Cloudflare R2.", 500);
  }
}
