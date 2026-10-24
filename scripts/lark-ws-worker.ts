import "server-only";

import * as lark from "@larksuiteoapi/node-sdk";
import { runAccountingAgent } from "@/lib/accounting/lark-agent-service";

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
});

async function start() {
  console.log("[LarkWS] Đang kết nối Persistent WebSocket tới Lark...");
  await wsClient.start({ eventDispatcher });
  console.log("[LarkWS] WebSocket đã kết nối và đang lắng nghe sự kiện 24/7!");
}

start().catch((err) => {
  console.error("[LarkWS] Lỗi khởi động WebSocket:", err);
});
