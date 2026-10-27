import { z } from "zod";
import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { finishCrawlerJob, heartbeatCrawlerJob, pollCrawlerJob } from "@/lib/accounting/crawler-jobs";

export const runtime = "nodejs";

// Chỉ máy Mac (accounting_job_worker.ts, Bearer WEB_APP_AUTH_TOKEN) gọi route này.
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("poll"),
    worker_id: z.string().trim().min(1).max(100),
    stores: z.array(z.string().max(100)).max(100).default([]),
    info: z.record(z.string(), z.unknown()).default({}),
  }),
  z.object({
    action: z.literal("heartbeat"),
    worker_id: z.string().trim().min(1).max(100),
    job_id: z.string().uuid(),
    current_step: z.string().max(500).nullable().default(null),
    log_tail: z.string().max(20_000).nullable().default(null),
  }),
  z.object({
    action: z.literal("finish"),
    worker_id: z.string().trim().min(1).max(100),
    job_id: z.string().uuid(),
    exit_code: z.number().int().nullable(),
    log_tail: z.string().max(20_000).nullable().default(null),
    error: z.string().max(2_000).nullable().default(null),
  }),
]);

export async function POST(request: Request) {
  try {
    await authorize(request, "write", "accounting");
    const input = schema.parse(await readJsonBody(request, 40_000));
    if (input.action === "poll") {
      return Response.json({ job: await pollCrawlerJob(input.worker_id, input.stores, input.info) });
    }
    if (input.action === "heartbeat") {
      return Response.json(await heartbeatCrawlerJob(input.job_id, input.worker_id, input.current_step, input.log_tail));
    }
    await finishCrawlerJob(input.job_id, input.worker_id, {
      exitCode: input.exit_code,
      logTail: input.log_tail,
      error: input.error,
    });
    return Response.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi xử lý lệnh crawler từ máy Mac.");
  }
}
