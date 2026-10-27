import { z } from "zod";
import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import {
  ACCOUNTING_CRAWLERS,
  cancelCrawlerJob,
  enqueueCrawlerJob,
  getCrawlerOverview,
  type AccountingCrawler,
} from "@/lib/accounting/crawler-jobs";

export const runtime = "nodejs";

const runSchema = z.object({
  action: z.literal("run"),
  crawler: z.enum(Object.keys(ACCOUNTING_CRAWLERS) as [AccountingCrawler, ...AccountingCrawler[]]),
  store_name: z.string().trim().max(100).optional().nullable(),
  target_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày phải có dạng YYYY-MM-DD")
    .optional()
    .nullable()
    .or(z.literal("")),
});
const cancelSchema = z.object({ action: z.literal("cancel"), job_id: z.string().uuid() });

/** System Admin → Crawler: trạng thái máy Mac, các crawler, lịch sử lệnh. */
export async function GET(request: Request) {
  try {
    await authorize(request, "read", "accounting");
    return Response.json(await getCrawlerOverview());
  } catch (error) {
    return routeErrorResponse(error, "Không tải được trạng thái crawler.", 500);
  }
}

/** Chạy thủ công 1 crawler (cho 1 store / 1 ngày nếu chọn) hoặc hủy lệnh. */
export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const actorName = actor.email || actor.displayName || actor.userId || "system";
    const body = await readJsonBody(request, 2_000);
    if ((body as { action?: string })?.action === "cancel") {
      const input = cancelSchema.parse(body);
      return Response.json({ job: await cancelCrawlerJob(input.job_id) });
    }
    const input = runSchema.parse(body);
    const job = await enqueueCrawlerJob(
      input.crawler,
      { storeName: input.store_name, targetDate: input.target_date || null },
      actorName,
    );
    return Response.json({ job });
  } catch (error) {
    return routeErrorResponse(error, "Không tạo được lệnh crawler.");
  }
}
