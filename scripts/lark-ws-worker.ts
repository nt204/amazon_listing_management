import "server-only";

import * as lark from "@larksuiteoapi/node-sdk";
import { runAccountingAgent } from "@/lib/accounting/lark-agent-service";
import { checkAndMarkMessageProcessed } from "@/lib/accounting/lark-conversation-memory";

const appId = process.env.LARK_APP_ID?.trim();
const appSecret = process.env.LARK_APP_SECRET?.trim();

if (!appId || !appSecret) {
  console.error("[LarkWS] Lỗi: Thiếu LARK_APP_ID hoặc LARK_APP_SECRET trong môi trường.");
  process.exit(1);
}

console.log("[LarkWS] Khởi tạo Lark WebSocket Client với App ID:", appId);

const wsClient = new lark.WSClient({
  appId,
  appSecret,
  domain: lark.Domain.Lark,
  loggerLevel: lark.LoggerLevel.info,
});

const eventDispatcher = new lark.EventDispatcher({}).register({
  "im.message.receive_v1": async (data: any) => {
    try {
      const message = data.message;
      if (!message) return;

      // 1. Chống lặp vòng bot: Chỉ xử lý tin nhắn từ người dùng thật
      if (data.sender?.sender_type && data.sender.sender_type !== "user") {
        return;
      }

      // 2. Chống SPAM / duplicate events: Kiểm tra message_id đã xử lý chưa
      const messageId = message.message_id;
      if (messageId) {
        const isDuplicate = await checkAndMarkMessageProcessed(messageId);
        if (isDuplicate) {
          console.log(`[LarkWS] Bỏ qua tin nhắn trùng lặp (message_id: ${messageId})`);
          return;
        }
      }

      const chatType = message.chat_type; // "group" | "p2p"
      const mentions = message.mentions || [];

      // BẮT BUỘC: Nếu là nhóm chat, chỉ trả lời khi được tag @bot
      if (chatType === "group" && mentions.length === 0) {
        return;
      }

      let rawContent = "";
      try {
        const parsed = JSON.parse(message.content || "{}");
        rawContent = parsed.text || "";
      } catch {
        rawContent = message.content || "";
      }

      // Xóa bỏ các placeholder tag (@_user_1, ...)
      const cleanText = rawContent.replace(/@_user_\d+/g, "").trim();
      if (!cleanText) {
        return;
      }

      console.log(`[LarkWS] Nhận tin nhắn từ chat ${message.chat_id}: "${cleanText}"`);

      // Dùng chat_id (hoặc thread/root_id) làm sessionId để lưu ngữ cảnh 30 phút
      const sessionId = message.root_id || message.chat_id;

      // Xử lý bằng AI Agent và tự động gửi lại Card phản hồi vào nhóm/chat
      await runAccountingAgent({
        message: cleanText,
        receiveId: message.chat_id,
        receiveIdType: "chat_id",
        sessionId,
        sendToLark: true,
      });

      console.log(`[LarkWS] Đã gửi phản hồi thành công vào chat ${message.chat_id}`);
    } catch (err: any) {
      console.error("[LarkWS] Lỗi khi xử lý sự kiện im.message.receive_v1:", err);
    }
  },
  "card.action.trigger": async (data: any) => {
    try {
      const action = data.action;
      const value = action?.value || {};
      const actionType = value.action;
      const sessionId = value.sessionId;
      const chatId = data.context?.open_chat_id || data.open_chat_id;

      console.log(`[LarkWS] Nhận card.action.trigger: ${actionType} (session: ${sessionId}, chat: ${chatId})`);

      if (actionType === "CONFIRM_NEGATIVE" && sessionId) {
        await runAccountingAgent({
          message: "Xác nhận",
          receiveId: chatId || sessionId,
          receiveIdType: "chat_id",
          sessionId,
          sendToLark: true,
        });

        return {
          toast: {
            type: "success",
            content: "Đã tự động đẩy từ khóa vào danh sách Negative thành công!",
          },
        };
      } else if (actionType === "CANCEL_NEGATIVE" && sessionId) {
        await runAccountingAgent({
          message: "Hủy",
          receiveId: chatId || sessionId,
          receiveIdType: "chat_id",
          sessionId,
          sendToLark: true,
        });

        return {
          toast: {
            type: "info",
            content: "Đã hủy thao tác phủ định từ khóa.",
          },
        };
      }

      return {
        toast: {
          type: "info",
          content: "Đã ghi nhận tương tác thẻ.",
        },
      };
    } catch (err: any) {
      console.error("[LarkWS] Lỗi khi xử lý card.action.trigger:", err);
      return {
        toast: {
          type: "error",
          content: "Lỗi xử lý: " + (err.message || "Unknown error"),
        },
      };
    }
  },
});


async function start() {
  console.log("[LarkWS] Đang kết nối Persistent WebSocket tới Lark...");
  await wsClient.start({ eventDispatcher });
  console.log("[LarkWS] WebSocket đã kết nối và đang lắng nghe sự kiện 24/7!");
}

start().catch((err) => {
  console.error("[LarkWS] Lỗi khởi động WebSocket:", err);
});
