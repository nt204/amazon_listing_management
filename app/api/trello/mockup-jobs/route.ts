import { ApiError, authorize, dataScope, enforceRateLimit, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import {
  createMockupJob,
  getMockupJob,
  listMockupJobEvents,
  listMockupJobs,
  type MockupJob,
} from "@/lib/mockup-jobs";
import {
  generateMockupsSchema,
  sanitizeQueuedMockupInput,
} from "@/lib/mockup-request";

export const runtime = "nodejs";
export const maxDuration = 600;

function wait(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(finish, ms);
    const onAbort = () => finish();
    function finish() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isTerminal(job: MockupJob) {
  return ["completed", "partial", "failed", "cancelled"].includes(job.status);
}

function streamMockupJob(
  scope: ReturnType<typeof dataScope>,
  job: MockupJob,
  requestSignal: AbortSignal,
) {
  const encoder = new TextEncoder();
  let stopped = false;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let cursor = 0;
      let lastHeartbeat = Date.now();
      const send = (event: Record<string, unknown>) => {
        if (stopped) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          stopped = true;
        }
      };

      try {
        while (!stopped && !requestSignal.aborted) {
          const events = await listMockupJobEvents(scope, job.id, cursor, 200);
          for (const item of events) {
            cursor = item.id;
            send(item.event);
          }

          const latest = await getMockupJob(scope, job.id);
          if (!latest) {
            send({ type: "error", error: "Không tìm thấy tác vụ mockup." });
            break;
          }
          if (isTerminal(latest)) {
            const hasTerminalEvent = events.some(
              (item) => item.event.type === "complete" || item.event.type === "error",
            );
            if (!hasTerminalEvent && latest.result) {
              send({ type: "complete", data: latest.result });
            } else if (!hasTerminalEvent && latest.status === "failed") {
              send({ type: "error", error: latest.error || "Tác vụ mockup thất bại." });
            } else if (!hasTerminalEvent && latest.status === "cancelled") {
              send({ type: "error", error: "Tác vụ tạo mockup đã được hủy." });
            }
            break;
          }

          if (Date.now() - lastHeartbeat >= 15_000) {
            send({ type: "heartbeat", jobId: job.id, status: latest.status });
            lastHeartbeat = Date.now();
          }
          await wait(750, requestSignal);
        }
      } catch (error) {
        send({
          type: "error",
          error:
            error instanceof Error
              ? error.message
              : "Không thể đọc tiến độ tác vụ mockup.",
        });
      } finally {
        if (!stopped) {
          stopped = true;
          controller.close();
        }
      }
    },
    cancel() {
      // Closing the browser only stops this progress stream. The durable job
      // keeps running until it completes or DELETE explicitly requests cancel.
      stopped = true;
    },
  });

  return new Response(body, {
    status: 202,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Mockup-Job-Id": job.id,
    },
  });
}

export async function GET(request: Request) {
  try {
    const scope = dataScope(authorize(request, "read"));
    const url = new URL(request.url);
    const activeOnly = url.searchParams.get("status") === "active";
    const limit = Number(url.searchParams.get("limit") || 30);
    return Response.json({
      jobs: await listMockupJobs(scope, { activeOnly, limit }),
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải hàng đợi mockup.");
  }
}

export async function POST(request: Request) {
  try {
    const actor = authorize(request, "write");
    const scope = dataScope(actor);
    await enforceRateLimit(
      actor,
      `mockup-job:${actor.userId}`,
      Number(process.env.MOCKUP_JOB_RATE_LIMIT_PER_MINUTE || 10),
    );
    const input = generateMockupsSchema.parse(await readJsonBody(request));
    if (!process.env.TRELLO_API_KEY || !process.env.TRELLO_TOKEN) {
      throw new ApiError(
        "Chế độ hàng đợi yêu cầu TRELLO_API_KEY và TRELLO_TOKEN được cấu hình trên server.",
        503,
      );
    }
    const job = await createMockupJob(scope, sanitizeQueuedMockupInput(input));
    if (input.stream) return streamMockupJob(scope, job, request.signal);
    return Response.json({ job }, { status: 202 });
  } catch (error) {
    const status =
      typeof error === "object" && error && "status" in error
        ? Number(error.status)
        : undefined;
    if (status && Number.isFinite(status)) {
      return Response.json(
        {
          error: error instanceof Error ? error.message : "Không thể xếp hàng mockup.",
          jobId:
            typeof error === "object" && error && "jobId" in error
              ? String(error.jobId)
              : undefined,
        },
        { status },
      );
    }
    return routeErrorResponse(error, "Không thể xếp hàng tạo mockup.");
  }
}
