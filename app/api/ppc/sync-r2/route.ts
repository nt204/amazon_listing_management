import { authorize, dataScope, enforceRateLimit, routeErrorResponse } from "@/lib/api-guard";
import { syncPpcReportsFromR2 } from "@/lib/ppc/service";

export const runtime = "nodejs";

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const actor = authorize(request, "write");
    await enforceRateLimit(actor, "ppc-r2-sync", 3, 60);
    const result = await syncPpcReportsFromR2(dataScope(actor));
    const failureSuffix = result.failed ? ` Có ${result.failed} file lỗi.` : "";
    return Response.json({
      success: true,
      message: `Đã quét ${result.filesFound} file: ${result.filesProcessed} file được xử lý, ${result.skipped} file không đổi; ${result.totalNew} dòng mới, ${result.totalUpdated} dòng cập nhật.${failureSuffix}`,
      result,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi quét Cloudflare R2.", 500);
  }
}
