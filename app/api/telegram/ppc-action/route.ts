// Webhook của bot Telegram action PPC (@nce_ppc_action_bot) — lib/telegram-action-bot.ts.
// Đăng ký bằng scripts/telegram-action-set-webhook.ts; Telegram gửi kèm header X-Telegram-Bot-Api-Secret-Token.
import { timingSafeEqual } from "node:crypto";
import { handleTelegramUpdate, telegramActionConfig, type TelegramUpdate } from "@/lib/telegram-action-bot";

export const runtime = "nodejs";
export const maxDuration = 30;

function secretMatches(received: string | null, expected: string) {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const { secret, token } = telegramActionConfig();
  if (!token || !secret) return Response.json({ ok: false, error: "not configured" }, { status: 503 });
  if (!secretMatches(request.headers.get("x-telegram-bot-api-secret-token"), secret)) {
    return Response.json({ ok: false }, { status: 403 });
  }
  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;
  if (!update || typeof update.update_id !== "number") return Response.json({ ok: true });
  try {
    await handleTelegramUpdate(update);
  } catch (error) {
    // Trả 200 để Telegram không gửi lại cùng một cập nhật (tránh xử lý trùng); lỗi ghi log.
    console.error("[telegram-action] Xử lý cập nhật lỗi:", error);
  }
  return Response.json({ ok: true });
}
