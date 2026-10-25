import "server-only";

import { resolveLarkRecipients, type LarkNotificationCategory } from "@/lib/lark-notification-settings";
import type { DataScope } from "@/lib/db";

const LARK_API_BASE_URL = "https://open.larksuite.com/open-apis";
const DEFAULT_TIMEOUT_MS = 10_000;

type LarkTokenResponse = {
  code?: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
};

type LarkApiResponse = {
  code?: number;
  msg?: string;
};

export type LarkNotificationResult =
  | { sent: true }
  | { sent: false; reason: "not_configured" };

let cachedToken: { value: string; expiresAt: number } | null = null;
let pendingToken: Promise<string> | null = null;

function configuredTimeoutMs() {
  const value = Number(process.env.LARK_NOTIFICATION_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return Number.isFinite(value) && value >= 1_000 ? value : DEFAULT_TIMEOUT_MS;
}

function humanizeLarkError(code?: number, msg?: string, statusText?: string): string {
  const detail = msg || statusText || "Lỗi không xác định";
  if (code === 230001) {
    return `Địa chỉ nhận không tồn tại hoặc không hợp lệ trên Lark (email/open_id/chat_id chưa thuộc tổ chức Lark hoặc bot chưa có quyền).`;
  }
  if (code === 230013) {
    return `Bot Lark chưa được thêm vào nhóm chat này (vui lòng thêm bot vào nhóm trên Lark).`;
  }
  if (code === 99991663 || code === 99991668) {
    return `App Lark chưa được cấp quyền gửi tin nhắn hoặc chưa publish phiên bản mới (${detail}).`;
  }
  return `Lark API lỗi (${code ?? 500}): ${detail}`;
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: init.signal || AbortSignal.timeout(configuredTimeoutMs()),
  });
  const body = (await response.json().catch(() => ({}))) as T & LarkApiResponse;
  if (!response.ok || (typeof body.code === "number" && body.code !== 0)) {
    throw new Error(humanizeLarkError(body.code, body.msg, response.statusText));
  }
  return body;
}

async function getTenantAccessToken(appId: string, appSecret: string) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  if (pendingToken) return pendingToken;

  pendingToken = (async () => {
    const result = await fetchJson<LarkTokenResponse>(
      `${LARK_API_BASE_URL}/auth/v3/tenant_access_token/internal`,
      {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      },
    );
    if (!result.tenant_access_token) throw new Error("Lark không trả về tenant_access_token.");
    cachedToken = {
      value: result.tenant_access_token,
      expiresAt: Date.now() + Math.max(60, result.expire || 7_200) * 1_000,
    };
    return cachedToken.value;
  })();

  try {
    return await pendingToken;
  } finally {
    pendingToken = null;
  }
}

export type LarkRecipient = {
  receiveId: string;
  receiveIdType: string;
  /** Reply in-thread to this message instead of posting a new chat message. */
  replyToMessageId?: string;
};

function larkSendRequest(recipient: LarkRecipient, msgType: string, content: string) {
  const replyTo = recipient.replyToMessageId?.trim();
  if (replyTo) {
    return {
      url: `${LARK_API_BASE_URL}/im/v1/messages/${encodeURIComponent(replyTo)}/reply`,
      body: JSON.stringify({ msg_type: msgType, content }),
    };
  }
  return {
    url: `${LARK_API_BASE_URL}/im/v1/messages?receive_id_type=${encodeURIComponent(recipient.receiveIdType.trim())}`,
    body: JSON.stringify({ receive_id: recipient.receiveId.trim(), msg_type: msgType, content }),
  };
}

/** Adds an emoji reaction (e.g. "OnIt") so the asker sees instantly that the bot picked the message up. */
export async function addLarkMessageReaction(messageId: string, emojiType: string): Promise<void> {
  const appId = process.env.LARK_APP_ID?.trim();
  const appSecret = process.env.LARK_APP_SECRET?.trim();
  if (!appId || !appSecret || !messageId.trim()) return;

  const token = await getTenantAccessToken(appId, appSecret);
  await fetchJson<LarkApiResponse>(
    `${LARK_API_BASE_URL}/im/v1/messages/${encodeURIComponent(messageId.trim())}/reactions`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ reaction_type: { emoji_type: emojiType } }),
    },
  );
}

/** Creation time (ms) of a Lark message, or null when it cannot be looked up. */
export async function getLarkMessageCreatedAt(messageId: string): Promise<number | null> {
  const appId = process.env.LARK_APP_ID?.trim();
  const appSecret = process.env.LARK_APP_SECRET?.trim();
  if (!appId || !appSecret || !messageId.trim()) return null;

  const token = await getTenantAccessToken(appId, appSecret);
  const result = await fetchJson<{ data?: { items?: Array<{ create_time?: string }> } }>(
    `${LARK_API_BASE_URL}/im/v1/messages/${encodeURIComponent(messageId.trim())}`,
    { method: "GET", headers: { authorization: `Bearer ${token}` } },
  );
  const createdAt = Number(result.data?.items?.[0]?.create_time);
  return Number.isFinite(createdAt) && createdAt > 0 ? createdAt : null;
}

let cachedBotOpenId: string | null = null;

/** open_id of this app's bot, used to tell "@bot" apart from mentions of other members. */
export async function getLarkBotOpenId(): Promise<string | null> {
  const configured = process.env.LARK_BOT_OPEN_ID?.trim();
  if (configured) return configured;
  if (cachedBotOpenId) return cachedBotOpenId;

  const appId = process.env.LARK_APP_ID?.trim();
  const appSecret = process.env.LARK_APP_SECRET?.trim();
  if (!appId || !appSecret) return null;

  const token = await getTenantAccessToken(appId, appSecret);
  const result = await fetchJson<{ bot?: { open_id?: string } }>(
    `${LARK_API_BASE_URL}/bot/v3/info`,
    { method: "GET", headers: { authorization: `Bearer ${token}` } },
  );
  cachedBotOpenId = result.bot?.open_id || null;
  return cachedBotOpenId;
}

export async function sendLarkTextNotification(
  text: string,
  recipient: LarkRecipient,
): Promise<LarkNotificationResult> {
  const appId = process.env.LARK_APP_ID?.trim();
  const appSecret = process.env.LARK_APP_SECRET?.trim();
  const receiveId = recipient.receiveId.trim();

  if (!appId || !appSecret || !receiveId) return { sent: false, reason: "not_configured" };

  const token = await getTenantAccessToken(appId, appSecret);
  const request = larkSendRequest(recipient, "text", JSON.stringify({ text }));
  await fetchJson<LarkApiResponse>(request.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: request.body,
  });
  return { sent: true };
}

export async function sendLarkCardNotification(
  card: Record<string, any>,
  recipient: LarkRecipient,
): Promise<LarkNotificationResult> {
  const appId = process.env.LARK_APP_ID?.trim();
  const appSecret = process.env.LARK_APP_SECRET?.trim();
  const receiveId = recipient.receiveId.trim();

  if (!appId || !appSecret || !receiveId) return { sent: false, reason: "not_configured" };

  const token = await getTenantAccessToken(appId, appSecret);
  const request = larkSendRequest(recipient, "interactive", JSON.stringify(card));
  await fetchJson<LarkApiResponse>(request.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: request.body,
  });
  return { sent: true };
}

export async function uploadLarkImage(
  imageBuffer: Buffer,
  filename = "report.png",
): Promise<string> {
  const appId = process.env.LARK_APP_ID?.trim();
  const appSecret = process.env.LARK_APP_SECRET?.trim();
  if (!appId || !appSecret) throw new Error("Lark credentials not configured");

  const token = await getTenantAccessToken(appId, appSecret);
  const formData = new FormData();
  formData.append("image_type", "message");
  formData.append("image", new Blob([new Uint8Array(imageBuffer)], { type: "image/png" }), filename);

  const res = await fetch(`${LARK_API_BASE_URL}/im/v1/images`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  const data = (await res.json().catch(() => ({}))) as {
    code?: number;
    msg?: string;
    data?: { image_key?: string };
  };

  if (data.code !== 0 || !data.data?.image_key) {
    throw new Error(`Upload image to Lark failed (${data.code}): ${data.msg || "unknown error"}`);
  }
  return data.data.image_key;
}

export async function sendLarkImageNotification(
  imageKey: string,
  recipient: LarkRecipient,
): Promise<LarkNotificationResult> {
  const appId = process.env.LARK_APP_ID?.trim();
  const appSecret = process.env.LARK_APP_SECRET?.trim();
  const receiveId = recipient.receiveId.trim();
  const receiveIdType = recipient.receiveIdType.trim();

  if (!appId || !appSecret || !receiveId) return { sent: false, reason: "not_configured" };

  const token = await getTenantAccessToken(appId, appSecret);
  await fetchJson<LarkApiResponse>(
    `${LARK_API_BASE_URL}/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        receive_id: receiveId,
        msg_type: "image",
        content: JSON.stringify({ image_key: imageKey }),
      }),
    },
  );
  return { sent: true };
}

export type LarkNotificationPayload =
  | string
  | string[]
  | { imageKey: string; fallbackText?: string }
  | { card: Record<string, any>; fallbackText?: string };

export async function notifyLarkEventBestEffort(
  scope: DataScope,
  category: LarkNotificationCategory,
  payload: LarkNotificationPayload,
) {
  try {
    const recipients = await resolveLarkRecipients(scope, category);
    if (!recipients.length) return;

    const isCard = typeof payload === "object" && payload !== null && !Array.isArray(payload) && "card" in payload;
    const isImage = typeof payload === "object" && payload !== null && !Array.isArray(payload) && "imageKey" in payload;

    const results = await Promise.allSettled(
      recipients.map(async (recipient) => {
        const target = {
          receiveId: recipient.receive_id,
          receiveIdType: recipient.receive_id_type,
        };
        if (isImage) {
          try {
            return await sendLarkImageNotification((payload as { imageKey: string }).imageKey, target);
          } catch (imgErr) {
            if ("fallbackText" in payload && payload.fallbackText) {
              return await sendLarkTextNotification(payload.fallbackText, target);
            }
            throw imgErr;
          }
        }
        if (isCard) {
          try {
            return await sendLarkCardNotification((payload as { card: Record<string, any> }).card, target);
          } catch (cardErr) {
            if ("fallbackText" in payload && payload.fallbackText) {
              return await sendLarkTextNotification(payload.fallbackText, target);
            }
            throw cardErr;
          }
        }
        const messageText = Array.isArray(payload) ? payload.filter(Boolean).join("\n") : String(payload);
        return await sendLarkTextNotification(messageText, target);
      }),
    );
    for (const result of results) {
      if (result.status === "rejected") {
        console.warn("[Lark] Không thể gửi một thông báo:", result.reason instanceof Error ? result.reason.message : result.reason);
      }
    }
  } catch (error) {
    console.warn("[Lark] Không thể resolve người nhận:", error instanceof Error ? error.message : error);
  }
}

export function resetLarkNotificationStateForTests() {
  cachedToken = null;
  pendingToken = null;
  cachedBotOpenId = null;
}
