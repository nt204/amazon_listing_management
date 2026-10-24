import { z } from "zod";
import { authorize, dataScope, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { notifyLarkEventBestEffort } from "@/lib/lark-notifications";

export const runtime = "nodejs";

const batchNotifySchema = z.object({
  successful: z.number().int().min(0),
  total: z.number().int().min(1),
  completedImages: z.number().int().min(0),
  requestedImages: z.number().int().min(0),
  failed: z.number().int().min(0).default(0),
  cardNames: z.array(z.string()).optional(),
});

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "write", "mockups");
    const scope = dataScope(actor);
    enforceRequestSize(request, 20_000);
    const body = batchNotifySchema.parse(await request.json());

    const isAllSuccess = body.failed === 0 && body.successful === body.total;
    const isPartial = body.failed > 0 && body.successful > 0;
    const isAllFailed = body.successful === 0;

    let title = `🎨 **Batch Mockup đã hoàn tất: ${body.successful}/${body.total} thẻ thành công**`;
    if (isPartial) {
      title = `⚠️ **Batch Mockup hoàn tất một phần: ${body.successful}/${body.total} thẻ thành công, ${body.failed} thẻ thất bại**`;
    } else if (isAllFailed) {
      title = `❌ **Batch Mockup thất bại toàn bộ: 0/${body.total} thẻ thành công (${body.failed} thẻ lỗi)**`;
    }

    const lines = [
      title,
      `• Tổng ảnh tạo: ${body.completedImages}/${body.requestedImages} ảnh AI`,
      body.cardNames && body.cardNames.length > 0
        ? `• Thẻ xử lý: ${body.cardNames.slice(0, 5).join(", ")}${body.cardNames.length > 5 ? ` (+${body.cardNames.length - 5} thẻ)` : ""}`
        : "",
    ].filter(Boolean);

    await notifyLarkEventBestEffort(scope, "mockups", lines);

    return Response.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error, "Không thể gửi thông báo batch mockup.");
  }
}
