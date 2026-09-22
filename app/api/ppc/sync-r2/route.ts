import { ApiError, authorize, dataScope, enforceRateLimit, routeErrorResponse } from "@/lib/api-guard";
import { enqueuePpcIngestion, getPpcIngestion } from "@/lib/ppc/ingestion-jobs";
import { findLatestR2Markers } from "@/lib/ppc/service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const actor = authorize(request, "read");
    const id = new URL(request.url).searchParams.get("jobId")?.trim();
    if (!id) throw new ApiError("Thiếu ingestion jobId.", 400);
    const job = await getPpcIngestion(dataScope(actor), id);
    if (!job) throw new ApiError("Không tìm thấy ingestion job.", 404);
    return Response.json({ success: job.status === "COMPLETED", job });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi đọc trạng thái đồng bộ R2.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = authorize(request, "write");
    await enforceRateLimit(actor, "ppc-r2-sync", 10, 60);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    let batchId = String(body.batchId || "").trim();
    let batchDate = String(body.batchDate || "").trim();
    let storeNames = Array.isArray(body.storeNames)
      ? body.storeNames.map(String).map((v) => v.trim()).filter(Boolean)
      : [];
    const isManualWebSync = !batchId;
    const force = Boolean(body.force ?? isManualWebSync);

    // Nếu không truyền batchId (thao tác click Đồng bộ R2 thủ công trên Web UI)
    if (!batchId) {
      const filterStore = typeof body.storeName === "string" ? body.storeName.trim() : undefined;
      const markers = await findLatestR2Markers(dataScope(actor), filterStore);
      if (!markers.length) {
        throw new ApiError(
          "Không tìm thấy batch báo cáo hoàn chỉnh (_COMPLETE.json) nào trên Cloudflare R2. Vui lòng chạy crawler hoặc tải file lên trước.",
          404,
        );
      }
      const latest = markers[0];
      batchId = latest.batchId;
      batchDate = latest.batchDate;
      const sameBatchMarkers = markers.filter((m) => m.batchId === batchId);
      storeNames = [...new Set(sameBatchMarkers.map((m) => m.storeName))];
    }

    if (!/^[A-Za-z0-9_.-]{1,120}$/.test(batchId)) throw new ApiError("batchId không hợp lệ.", 400);
    if (!/^\d{4}-?\d{2}-?\d{2}$|^\d{8}$/.test(batchDate)) throw new ApiError("batchDate không hợp lệ.", 400);
    if (!storeNames.length || storeNames.length > 50) throw new ApiError("storeNames không hợp lệ.", 400);

    const job = await enqueuePpcIngestion(dataScope(actor), { batchId, batchDate, storeNames }, { force });
    return Response.json(
      {
        success: true,
        accepted: job.status !== "COMPLETED",
        message:
          job.status === "COMPLETED"
            ? `Batch ${batchId} (${storeNames.join(", ")}) đã đồng bộ trước đó.`
            : `Batch ${batchId} (${storeNames.join(", ")}) đã được đưa vào hàng đợi đồng bộ.`,
        job,
      },
      { status: job.status === "COMPLETED" ? 200 : 202 },
    );
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi quét Cloudflare R2.", 500);
  }
}
