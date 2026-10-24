import "server-only";

import * as lark from "@larksuiteoapi/node-sdk";
import {
  cardActionToast,
  processLarkCardAction,
  processLarkMessageEvent,
} from "@/lib/accounting/lark-webhook";

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

// The socket only receives events and enqueues them; `npm run lark:agent-worker`
// answers them. This keeps the WS path identical to the HTTP webhook (bot-only
// mention filter, per-member sessions, Redis dedup, per-session ordering).
const eventDispatcher = new lark.EventDispatcher({}).register({
  "im.message.receive_v1": async (data: any) => {
    try {
      await processLarkMessageEvent(data);
    } catch (err) {
      console.error("[LarkWS] Lỗi khi xếp hàng im.message.receive_v1:", err);
    }
  },
  "card.action.trigger": async (data: any) => {
    try {
      return cardActionToast(await processLarkCardAction(data));
    } catch (err: any) {
      console.error("[LarkWS] Lỗi khi xử lý card.action.trigger:", err);
      return {
        toast: { type: "error", content: "Lỗi xử lý: " + (err?.message || "Unknown error") },
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
