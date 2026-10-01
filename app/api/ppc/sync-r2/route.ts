import { ApiError, authorize, dataScope, enforceRateLimit, routeErrorResponse } from "@/lib/api-guard";
import {
  claimPpcIngestion,
  completePpcIngestion,
  enqueueCrawlerPpcIngestion,
  enqueuePpcIngestion,
  failPpcIngestion,
  getPpcIngestion,
} from "@/lib/ppc/ingestion-jobs";
import { findLatestR2Markers, syncPpcReportsFromR2, verifyExactR2BatchMarkers } from "@/lib/ppc/service";
import type postgres from "postgres";

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
    const crawlerJobId = String(body.crawlerJobId || "").trim();
    const crawlerLeaseToken = String(body.crawlerLeaseToken || "").trim();

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

    let job;
    if (crawlerJobId || crawlerLeaseToken) {
      if (!/^[0-9a-f-]{36}$/i.test(crawlerJobId) || !crawlerLeaseToken) {
        throw new ApiError("Thiếu crawlerJobId hoặc crawlerLeaseToken hợp lệ.", 400);
      }
      const taskStates = Array.isArray(body.taskStates) ? body.taskStates : [];
      const processedFiles = Number(body.processedFiles);
      const taskIds = new Set<string>();
      const expectedStores = new Set(storeNames.map((name) => name.toLowerCase()));
      const tasksValid = taskStates.length === storeNames.length * 6 && taskStates.every((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        const task = value as Record<string, unknown>;
        const id = String(task.id || "");
        const store = String(task.store || "").toLowerCase();
        if (!id || taskIds.has(id) || task.status !== "UPLOADED" || !expectedStores.has(store)) return false;
        taskIds.add(id);
        return true;
      });
      if (!tasksValid || !Number.isInteger(processedFiles) || processedFiles !== taskStates.length) {
        throw new ApiError("Crawler handoff yêu cầu đúng 6 task UPLOADED cho mỗi store.", 409);
      }
      await verifyExactR2BatchMarkers({ batchId, batchDate, storeNames });
      try {
        job = await enqueueCrawlerPpcIngestion(dataScope(actor), {
          crawlerJobId,
          crawlerLeaseToken,
          batchId,
          batchDate,
          storeNames,
          taskStates: taskStates as postgres.JSONValue[],
          processedFiles,
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("CRAWLER_HANDOFF_MISMATCH")) {
          throw new ApiError(error.message.replace("CRAWLER_HANDOFF_MISMATCH: ", ""), 409);
        }
        throw error;
      }
    } else {
      job = await enqueuePpcIngestion(dataScope(actor), { batchId, batchDate, storeNames }, { force });
    }

    // Tự động kích hoạt nạp dữ liệu ngầm nếu chưa có worker nhận (đặc biệt khi chạy local)
    if (job.status !== "COMPLETED") {
      void (async () => {
        // Đợi 1.5 giây để nhường worker độc lập (nếu có) claim trước
        await new Promise((r) => setTimeout(r, 1500));
        const workerId = `web-auto-${process.pid}-${Date.now()}`;
        try {
          const claimed = await claimPpcIngestion(workerId);
          if (!claimed) return; // Đã có worker claim thành công
          const token = claimed.lease_token!;
          console.log(`[Auto Ingestion] Bắt đầu tự động nạp batch ${claimed.batch_id} từ Cloudflare R2...`);
          const result = await syncPpcReportsFromR2(
            { teamId: claimed.team_id, actorId: claimed.actor_id },
            { batchId: claimed.batch_id, batchDate: claimed.batch_date, storeNames: claimed.store_names },
          );
          if (result.failed > 0) {
            throw new Error(`${result.failed} file ingest lỗi: ${JSON.stringify(result.failures)}`);
          }
          await completePpcIngestion(claimed.id, token, result);
          console.log(`[Auto Ingestion] ✅ Nạp thành công batch ${claimed.batch_id}: ${result.filesProcessed} files.`);
          try {
            const { cleanupDuplicateR2Batches } = await import("@/lib/ppc/file-manager");
            await cleanupDuplicateR2Batches();
          } catch {}
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[Auto Ingestion] Lỗi khi tự nạp R2:", message);
        }
      })();
    }

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

