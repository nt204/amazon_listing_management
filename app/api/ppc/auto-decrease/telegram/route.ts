// Kết nối Telegram cá nhân với bot action PPC (lib/telegram-action-bot.ts):
//   GET    → trạng thái kết nối của chính người đang đăng nhập
//   POST { action: "link" } → link t.me/<bot>?start=<mã một lần>
//   POST { action: "test" } → gửi tin thử
//   DELETE → ngắt kết nối
import { ApiError, authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import {
  createTelegramLinkUrl,
  getTelegramLink,
  isTelegramActionConfigured,
  telegramActionConfig,
  unlinkTelegram,
} from "@/lib/telegram-action-bot";
import { sendTelegramTestMessage } from "@/lib/ppc/auto-decrease";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "ppc");
    const link = await getTelegramLink(actor.teamId, actor.userId);
    return Response.json({
      configured: isTelegramActionConfigured(),
      botUsername: telegramActionConfig().username || null,
      link: link ? { username: link.username, name: link.name, enabled: link.enabled, linkedAt: link.linkedAt } : null,
    });
  } catch (error) {
    return routeErrorResponse(error, "Không tải được trạng thái Telegram.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "read", "ppc");
    const body = (await readJsonBody(request, 10_000)) as { action?: string };
    if (!isTelegramActionConfigured()) throw new ApiError("Bot Telegram chưa được cấu hình trên server.", 503);
    if (body.action === "link") return Response.json(await createTelegramLinkUrl(actor.teamId, actor.userId));
    if (body.action === "test") {
      try {
        await sendTelegramTestMessage(actor.teamId, actor.userId);
      } catch (error) {
        throw new ApiError(error instanceof Error ? error.message : String(error), 400);
      }
      return Response.json({ ok: true });
    }
    throw new ApiError("Hành động không hợp lệ.", 400);
  } catch (error) {
    return routeErrorResponse(error, "Không xử lý được yêu cầu Telegram.", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await authorize(request, "read", "ppc");
    await unlinkTelegram(actor.teamId, actor.userId);
    return Response.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, "Không ngắt được kết nối Telegram.", 500);
  }
}
