// lib/telegram-action-bot.ts
//
// Bot Telegram RIÊNG cho action PPC (@nce_ppc_action_bot) — khác bot báo tiến độ crawler của Mac mini
// (bot đó do watchdog đọc getUpdates nên không nhận được lượt bấm nút).
//   • Liên kết: modal Auto giảm Bid tạo link t.me/<bot>?start=<mã một lần> → người dùng bấm Start → webhook nhận
//     "/start <mã>" → gắn chat_id với tài khoản. "/stop" để ngừng nhận.
//   • Lượt bấm nút (callback_query) chuyển cho lib/ppc/auto-decrease.ts xử lý.
// Production nhận cập nhật qua webhook (app/api/telegram/ppc-action/route.ts, kiểm tra secret_token);
// máy dev dùng scripts/telegram-action-poll.ts (getUpdates) để test.
//   PPC_ACTION_TELEGRAM_BOT_TOKEN, PPC_ACTION_TELEGRAM_BOT_USERNAME, PPC_ACTION_TELEGRAM_WEBHOOK_SECRET,
//   PPC_ACTION_TELEGRAM_PROXY_URL (tuỳ chọn, khi server không gọi thẳng được api.telegram.org)
import "server-only";

import { getDatabaseClient } from "@/lib/db";

const LINK_CODE_TTL_MINUTES = 15;

export function telegramActionConfig() {
  const token = process.env.PPC_ACTION_TELEGRAM_BOT_TOKEN?.trim() || "";
  const username = (process.env.PPC_ACTION_TELEGRAM_BOT_USERNAME?.trim() || "").replace(/^@/, "");
  const secret = process.env.PPC_ACTION_TELEGRAM_WEBHOOK_SECRET?.trim() || "";
  const base = (process.env.PPC_ACTION_TELEGRAM_PROXY_URL?.trim() || "https://api.telegram.org").replace(/\/+$/, "");
  return { token, username, secret, base };
}

export function isTelegramActionConfigured(): boolean {
  const { token, username } = telegramActionConfig();
  return Boolean(token && username);
}

export class TelegramApiError extends Error {
  constructor(message: string, public readonly code?: number) {
    super(message);
  }
}

export async function telegramApi<T = unknown>(method: string, payload: Record<string, unknown>): Promise<T> {
  const { token, base } = telegramActionConfig();
  if (!token) throw new TelegramApiError("Chưa cấu hình PPC_ACTION_TELEGRAM_BOT_TOKEN.");
  // getUpdates giữ kết nối tới `timeout` giây → chờ lâu hơn chừng đó.
  const longPoll = typeof payload.timeout === "number" ? payload.timeout * 1000 : 0;
  const res = await fetch(`${base}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000 + longPoll),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; error_code?: number };
  if (!body.ok) {
    const code = body.error_code ?? res.status;
    const hint = code === 403 ? " (người nhận chưa bấm Start bot hoặc đã chặn bot)" : "";
    throw new TelegramApiError(`Telegram ${method} lỗi (${code}): ${body.description || res.statusText}${hint}`, code);
  }
  return body.result as T;
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type InlineKeyboard = Array<Array<{ text: string; callback_data?: string; url?: string }>>;

export async function sendTelegramHtml(chatId: string, html: string, keyboard?: InlineKeyboard): Promise<number> {
  const message = await telegramApi<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
  return message.message_id;
}

export async function editTelegramHtml(chatId: string, messageId: number, html: string, keyboard?: InlineKeyboard) {
  try {
    await telegramApi("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: html,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: keyboard || [] },
    });
  } catch (error) {
    // Bấm lại đúng trạng thái cũ → Telegram báo "message is not modified": bỏ qua.
    if (error instanceof TelegramApiError && /not modified/i.test(error.message)) return;
    throw error;
  }
}

export async function editTelegramKeyboard(chatId: string, messageId: number, keyboard: InlineKeyboard) {
  try {
    await telegramApi("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: keyboard } });
  } catch (error) {
    if (error instanceof TelegramApiError && /not modified/i.test(error.message)) return;
    throw error;
  }
}

export async function answerTelegramCallback(callbackId: string, text: string, showAlert = false) {
  await telegramApi("answerCallbackQuery", { callback_query_id: callbackId, text: text.slice(0, 190), show_alert: showAlert })
    .catch((error) => console.warn("[telegram-action] answerCallbackQuery lỗi:", error instanceof Error ? error.message : error));
}

/* ------------------------------------------------------------------ */
/* Liên kết tài khoản                                                   */
/* ------------------------------------------------------------------ */

export interface TelegramLink {
  chatId: string;
  username: string | null;
  name: string | null;
  enabled: boolean;
  linkedAt: string;
}

export async function getTelegramLink(teamId: string, actorId: string): Promise<TelegramLink | null> {
  const sql = await getDatabaseClient();
  const rows = await sql<Array<{ chat_id: string; telegram_username: string | null; telegram_name: string | null; enabled: boolean; linked_at: Date }>>`
    SELECT chat_id, telegram_username, telegram_name, enabled, linked_at
    FROM ppc_telegram_links WHERE team_id = ${teamId} AND actor_id = ${actorId} LIMIT 1
  `;
  const row = rows[0];
  return row
    ? { chatId: row.chat_id, username: row.telegram_username, name: row.telegram_name, enabled: row.enabled, linkedAt: new Date(row.linked_at).toISOString() }
    : null;
}

/** Link một lần để mở bot và tự liên kết (hết hạn sau 15 phút). */
export async function createTelegramLinkUrl(teamId: string, actorId: string) {
  const { username } = telegramActionConfig();
  if (!username) throw new TelegramApiError("Chưa cấu hình PPC_ACTION_TELEGRAM_BOT_USERNAME.");
  const code = crypto.randomUUID().replace(/-/g, "");
  const sql = await getDatabaseClient();
  await sql`DELETE FROM ppc_telegram_link_codes WHERE expires_at < NOW() OR (team_id = ${teamId} AND actor_id = ${actorId})`;
  await sql`
    INSERT INTO ppc_telegram_link_codes (code, team_id, actor_id, expires_at)
    VALUES (${code}, ${teamId}, ${actorId}, NOW() + ${LINK_CODE_TTL_MINUTES} * INTERVAL '1 minute')
  `;
  return { url: `https://t.me/${username}?start=${code}`, expiresInMinutes: LINK_CODE_TTL_MINUTES };
}

export async function unlinkTelegram(teamId: string, actorId: string) {
  const sql = await getDatabaseClient();
  await sql`DELETE FROM ppc_telegram_links WHERE team_id = ${teamId} AND actor_id = ${actorId}`;
}

/** chat_id (= id người dùng trong chat riêng) → tài khoản đã liên kết. */
export async function resolveTelegramActor(chatId: string) {
  const sql = await getDatabaseClient();
  const rows = await sql<Array<{ team_id: string; actor_id: string; display_name: string }>>`
    SELECT link.team_id, link.actor_id, app_user.display_name
    FROM ppc_telegram_links link
    JOIN app_users app_user ON app_user.team_id = link.team_id AND app_user.user_id = link.actor_id
    WHERE link.chat_id = ${chatId} AND link.enabled = TRUE AND app_user.status = 'approved'
    LIMIT 1
  `;
  return rows[0] ? { teamId: rows[0].team_id, actorId: rows[0].actor_id, displayName: rows[0].display_name } : null;
}

async function linkFromStartCode(code: string, chatId: string, from: TelegramUser | undefined): Promise<string> {
  const sql = await getDatabaseClient();
  const claimed = await sql<Array<{ team_id: string; actor_id: string }>>`
    UPDATE ppc_telegram_link_codes SET used_at = NOW()
    WHERE code = ${code} AND used_at IS NULL AND expires_at > NOW()
    RETURNING team_id, actor_id
  `;
  if (!claimed[0]) return "Link liên kết không hợp lệ hoặc đã hết hạn. Mở lại modal <b>Auto giảm Bid</b> trên NCE Hub và bấm <b>Kết nối Telegram</b>.";
  const { team_id: teamId, actor_id: actorId } = claimed[0];
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(" ") || null;
  await sql.begin(async (tx) => {
    // Telegram này đang gắn với tài khoản khác → chuyển sang tài khoản mới (một Telegram ↔ một tài khoản).
    await tx`DELETE FROM ppc_telegram_links WHERE chat_id = ${chatId} AND NOT (team_id = ${teamId} AND actor_id = ${actorId})`;
    await tx`
      INSERT INTO ppc_telegram_links (team_id, actor_id, chat_id, telegram_username, telegram_name, enabled, linked_at, updated_at)
      VALUES (${teamId}, ${actorId}, ${chatId}, ${from?.username || null}, ${name}, TRUE, NOW(), NOW())
      ON CONFLICT (team_id, actor_id) DO UPDATE SET
        chat_id = EXCLUDED.chat_id, telegram_username = EXCLUDED.telegram_username,
        telegram_name = EXCLUDED.telegram_name, enabled = TRUE, linked_at = NOW(), updated_at = NOW()
    `;
  });
  const users = await sql<Array<{ display_name: string }>>`
    SELECT display_name FROM app_users WHERE team_id = ${teamId} AND user_id = ${actorId} LIMIT 1
  `;
  return `✅ Đã liên kết với tài khoản <b>${escapeHtml(users[0]?.display_name || actorId)}</b> trên NCE Hub.\nBạn sẽ nhận thông báo Auto giảm Bid của các store mình phụ trách tại đây. Gõ /stop để ngừng nhận.`;
}

/* ------------------------------------------------------------------ */
/* Nhận cập nhật (webhook / polling)                                    */
/* ------------------------------------------------------------------ */

interface TelegramUser { id: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean }

export interface TelegramUpdate {
  update_id: number;
  message?: { message_id: number; chat: { id: number; type: string }; from?: TelegramUser; text?: string };
  callback_query?: {
    id: string;
    from: TelegramUser;
    data?: string;
    message?: { message_id: number; chat: { id: number; type: string } };
  };
}

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  if (update.message?.text && update.message.chat.type === "private" && !update.message.from?.is_bot) {
    const chatId = String(update.message.chat.id);
    const text = update.message.text.trim();
    const start = text.match(/^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{8,64}))?$/);
    if (start) {
      const reply = start[1]
        ? await linkFromStartCode(start[1], chatId, update.message.from)
        : "Chào bạn! Để liên kết, mở modal <b>Auto giảm Bid</b> trên NCE Hub và bấm <b>Kết nối Telegram</b>.";
      await sendTelegramHtml(chatId, reply);
      return;
    }
    if (/^\/stop(?:@\w+)?$/.test(text)) {
      const sql = await getDatabaseClient();
      const rows = await sql`UPDATE ppc_telegram_links SET enabled = FALSE, updated_at = NOW() WHERE chat_id = ${chatId} RETURNING actor_id`;
      await sendTelegramHtml(chatId, rows.length ? "Đã ngừng nhận thông báo. Kết nối lại trong modal Auto giảm Bid trên NCE Hub." : "Telegram này chưa liên kết tài khoản nào.");
      return;
    }
    await sendTelegramHtml(chatId, "Bot này chỉ gửi thông báo và nhận nút bấm. Quản lý trong tab <b>Đề xuất &amp; Auto Bid</b> trên NCE Hub.");
    return;
  }

  const cb = update.callback_query;
  if (cb?.data && cb.message && cb.message.chat.type === "private") {
    const { handleAutoDecreaseTelegramCallback } = await import("@/lib/ppc/auto-decrease");
    await handleAutoDecreaseTelegramCallback({
      callbackId: cb.id,
      data: cb.data,
      chatId: String(cb.message.chat.id),
      fromId: String(cb.from.id),
      messageId: cb.message.message_id,
    });
  }
}
