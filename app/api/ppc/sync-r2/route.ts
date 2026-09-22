import { authorize, dataScope, enforceRateLimit, routeErrorResponse } from "@/lib/api-guard";
import { syncPpcReportsFromR2 } from "@/lib/ppc/service";

export const runtime = "nodejs";

export const maxDuration = 300;

const activeSyncPromises = new Map<string, Promise<any>>();

export async function POST(request: Request) {
  try {
    const actor = authorize(request, "write");
    await enforceRateLimit(actor, "ppc-r2-sync", 5, 60);
    const body = await request.json().catch(() => ({})) as {
      batchId?: unknown;
      batchDate?: unknown;
      storeNames?: unknown;
      batches?: unknown;
    };
    const hasTarget = body.batchId != null || body.batchDate != null || body.storeNames != null || body.batches != null;
    const target = hasTarget ? {
      batchId: String(body.batchId || ""),
      batchDate: String(body.batchDate || ""),
      storeNames: Array.isArray(body.storeNames) ? body.storeNames.map(String) : [],
      batches: Array.isArray(body.batches) ? body.batches.map((batch) => {
        const item = batch && typeof batch === "object" ? batch as Record<string, unknown> : {};
        return {
          batchId: String(item.batchId || ""),
          batchDate: String(item.batchDate || ""),
          storeName: String(item.storeName || ""),
        };
      }) : undefined,
    } : undefined;

    const lockKey = `${actor.teamId}:${target?.batchId || "ALL"}`;
    if (activeSyncPromises.has(lockKey)) {
      console.log(`[R2 Sync] Đang có tiến trình đồng bộ ${lockKey} chạy nền, chờ kết quả thay vì chạy mới...`);
      const existingResult = await activeSyncPromises.get(lockKey);
      return Response.json({
        success: true,
        message: "Đồng bộ R2 hoàn tất thành công (từ tiến trình nền song song).",
        result: existingResult,
      });
    }

    const syncPromise = syncPpcReportsFromR2(dataScope(actor), target)
      .finally(() => {
        activeSyncPromises.delete(lockKey);
      });

    activeSyncPromises.set(lockKey, syncPromise);
    const result = await syncPromise;

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
