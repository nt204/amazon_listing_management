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

export async function sendLarkTextNotification(
  text: string,
  recipient: { receiveId: string; receiveIdType: string },
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
        msg_type: "text",
        content: JSON.stringify({ text }),
      }),
    },
  );
  return { sent: true };
}

export async function notifyLarkEventBestEffort(
  scope: DataScope,
  category: LarkNotificationCategory,
  text: string | string[],
) {
  try {
    const recipients = await resolveLarkRecipients(scope, category);
    if (!recipients.length) return;
    const messageText = Array.isArray(text) ? text.filter(Boolean).join("\n") : text;
    const results = await Promise.allSettled(recipients.map((recipient) =>
      sendLarkTextNotification(messageText, {
        receiveId: recipient.receive_id,
        receiveIdType: recipient.receive_id_type,
      })
    ));
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
}
