import "server-only";

import { getLarkBotOpenId } from "@/lib/lark-notifications";
import { enqueueLarkAgentJobOnce, isStaleLarkMessage } from "./lark-agent-queue";

type LarkMessageEvent = {
  tenant_key?: string;
  sender?: {
    sender_type?: string;
    sender_id?: {
      open_id?: string;
      user_id?: string;
      union_id?: string;
    };
  };
  message?: {
    message_id?: string;
    create_time?: string;
    chat_id?: string;
    chat_type?: "group" | "p2p" | string;
    message_type?: string;
    thread_id?: string;
    root_id?: string;
    content?: string;
    mentions?: LarkMention[];
  };
};

type LarkMention = {
  key?: string;
  name?: string;
  id?: { open_id?: string; user_id?: string; union_id?: string };
};

type LarkCardActionEvent = {
  tenant_key?: string;
  open_id?: string;
  operator?: { open_id?: string; user_id?: string; union_id?: string };
  open_chat_id?: string;
  context?: { open_chat_id?: string };
  action?: { value?: Record<string, unknown> };
};

function cleanSessionPart(value: unknown, fallback: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || fallback;
}

/**
 * Group members get independent short-term memory. A thread/root keeps its own
 * conversation while p2p chats remain naturally isolated by chat_id.
 */
export function buildLarkSessionId(input: {
  tenantKey?: string;
  chatId: string;
  chatType?: string;
  threadId?: string;
  rootId?: string;
  senderId?: string;
}): string {
  const tenant = cleanSessionPart(input.tenantKey, "tenant");
  const conversation = cleanSessionPart(
    input.threadId || input.rootId || input.chatId,
    input.chatId,
  );

  if (input.chatType !== "p2p") {
    return [tenant, conversation, cleanSessionPart(input.senderId, "member")].join(":");
  }

  return [tenant, conversation].join(":");
}

async function isBotMention(mention: LarkMention, botOpenId: string | null): Promise<boolean> {
  if (botOpenId) return mention.id?.open_id === botOpenId;
  const botName = process.env.LARK_BOT_NAME?.trim();
  return Boolean(botName && mention.name === botName);
}

/**
 * Removes the bot's own "@_user_N" placeholder and turns other mentions back
 * into "@Name" so the agent still knows who the user is talking about.
 */
function cleanMessageText(rawText: string, mentions: LarkMention[], botKeys: Set<string>) {
  let text = rawText;
  for (const mention of mentions) {
    if (!mention.key) continue;
    text = text.split(mention.key).join(botKeys.has(mention.key) ? "" : `@${mention.name || ""}`);
  }
  return text.replace(/@_user_\d+/g, "").replace(/\s+/g, " ").trim();
}

export async function processLarkMessageEvent(
  data: LarkMessageEvent,
): Promise<void> {
  const message = data.message;
  if (!message?.chat_id) return;

  // Never answer messages emitted by bots/apps, which would create a loop.
  if (data.sender?.sender_type && data.sender.sender_type !== "user") return;
  const mentions = Array.isArray(message.mentions) ? message.mentions : [];
  const isGroup = message.chat_type !== "p2p";
  const botKeys = new Set<string>();
  if (mentions.length > 0) {
    const botOpenId = await getLarkBotOpenId().catch((error) => {
      console.error("[LarkWebhook] Không lấy được bot open_id:", error);
      return null;
    });
    if (!botOpenId && !process.env.LARK_BOT_NAME?.trim()) {
      console.error("[LarkWebhook] Thiếu LARK_BOT_OPEN_ID/LARK_BOT_NAME, không xác định được tag bot.");
    }
    for (const mention of mentions) {
      if (mention.key && (await isBotMention(mention, botOpenId))) botKeys.add(mention.key);
    }
    // Nếu cả botOpenId và LARK_BOT_NAME đều chưa có nhưng trong nhóm có mention bot
    if (botKeys.size === 0 && !botOpenId && !process.env.LARK_BOT_NAME?.trim()) {
      for (const mention of mentions) {
        if (mention.key) botKeys.add(mention.key);
      }
    }
  }

  // Trong bất kỳ nhóm nào (group, topic_group, channel...), NẾU KHÔNG CÓ TAG BOT THÌ BẮT BUỘC BỎ QUA!
  if (isGroup && (mentions.length === 0 || botKeys.size === 0)) {
    console.info(`[LarkWebhook] Bỏ qua vì KHÔNG tag bot trong nhóm (${message.chat_type || "group"}).`);
    return;
  }

  const cleanText = cleanMessageText(extractText(message.content), mentions, botKeys);
  if (!cleanText) return;

  const senderId =
    data.sender?.sender_id?.open_id ||
    data.sender?.sender_id?.user_id ||
    data.sender?.sender_id?.union_id;
  const sessionId = buildLarkSessionId({
    tenantKey: data.tenant_key,
    chatId: message.chat_id,
    chatType: message.chat_type,
    threadId: message.thread_id,
    rootId: message.root_id,
    senderId,
  });

  const jobInput = {
    message: cleanText,
    receiveId: message.chat_id,
    receiveIdType: "chat_id" as const,
    sessionId,
    replyToMessageId: message.message_id,
    messageCreatedAt: Number(message.create_time) || undefined,
  };
  // Without a message_id Lark retries cannot be told apart, so drop the event
  // rather than risk answering twice.
  if (!message.message_id) return;
  // Late redeliveries of old messages (e.g. after the endpoint was down) must
  // not trigger answers to questions asked hours ago.
  if (isStaleLarkMessage(jobInput.messageCreatedAt)) {
    console.info(`[LarkWebhook] Bỏ qua tin nhắn cũ ${message.message_id} (gửi lúc ${new Date(jobInput.messageCreatedAt!).toISOString()}).`);
    return;
  }
  const result = await enqueueLarkAgentJobOnce(message.message_id, jobInput);
  if (!result.enqueued) {
    console.info(`[LarkWebhook] ACK message trùng: ${message.message_id}`);
    return;
  }
  console.info(`[LarkWebhook] Queued ${result.job.id} for message ${message.message_id}`);
}

function extractText(content: string | undefined): string {
  try {
    const parsed = JSON.parse(content || "{}") as {
      text?: unknown;
      content?: Array<Array<{ tag?: string; text?: string; user_id?: string }>>;
    };
    if (typeof parsed.text === "string") return parsed.text;
    // Rich-text ("post") messages keep mentions as "at" nodes.
    if (Array.isArray(parsed.content)) {
      return parsed.content
        .map((line) => line.map((node) => (node.tag === "at" ? node.user_id || "" : node.text || "")).join(""))
        .join("\n");
    }
    return "";
  } catch {
    return content || "";
  }
}

export type LarkCardActionResult =
  | { status: "queued" | "duplicate" | "ignored" }
  | { status: "forbidden" };

export async function processLarkCardAction(data: LarkCardActionEvent): Promise<LarkCardActionResult> {
  const value = data.action?.value || {};
  const actionType = value.action;
  const sessionId = typeof value.sessionId === "string" ? value.sessionId : "";
  const chatId = data.context?.open_chat_id || data.open_chat_id;

  if (!sessionId || !chatId) return { status: "ignored" };
  if (actionType !== "CONFIRM_NEGATIVE" && actionType !== "CANCEL_NEGATIVE") return { status: "ignored" };

  // Group sessions end with the asker's id; only that member may confirm or
  // cancel, otherwise anyone in the group could push someone else's negatives.
  const operatorIds = [
    data.operator?.open_id, data.operator?.user_id, data.operator?.union_id, data.open_id,
  ].filter(Boolean);
  const sessionParts = sessionId.split(":");
  if (sessionParts.length >= 3 && !operatorIds.includes(sessionParts[sessionParts.length - 1])) {
    return { status: "forbidden" };
  }

  // A double-click produces two callbacks; only the first one should run.
  const result = await enqueueLarkAgentJobOnce(`card:${sessionId}`, {
    message: actionType === "CONFIRM_NEGATIVE" ? "Xác nhận" : "Hủy",
    receiveId: chatId,
    receiveIdType: "chat_id",
    sessionId,
  }, 15);
  return { status: result.enqueued ? "queued" : "duplicate" };
}

export function cardActionToast(result: LarkCardActionResult) {
  if (result.status === "forbidden") {
    return { toast: { type: "warning", content: "Chỉ người đã yêu cầu mới được xác nhận thao tác này." } };
  }
  if (result.status === "duplicate") {
    return { toast: { type: "info", content: "Yêu cầu đang được xử lý..." } };
  }
  return { toast: { type: "info", content: "Đang xử lý yêu cầu..." } };
}
