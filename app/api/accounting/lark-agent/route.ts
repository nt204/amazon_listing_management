import { NextRequest } from "next/server";
import { runAccountingAgent } from "@/lib/accounting/lark-agent-service";
import { checkAndMarkMessageProcessed } from "@/lib/accounting/lark-conversation-memory";

export const maxDuration = 60; // Hỗ trợ multi-step tool calls

// Set để deduplicate in-flight requests theo sessionId hoặc chatId
const inFlightRequests = new Set<string>();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    // 1. Xử lý Challenge URL Verification từ Lark Open Platform (Bắt buộc khi đổi sang Webhook)
    if (body.type === "url_verification" && body.challenge) {
      return Response.json({ challenge: body.challenge });
    }

    // 2. Xử lý Event Webhook từ Lark Bot (im.message.receive_v1)
    if (body.header?.event_type === "im.message.receive_v1" && body.event?.message) {
      const messageObj = body.event.message;
      const eventId = body.header?.event_id;
      const messageId = messageObj.message_id;

      // Chống lặp / SPAM tin nhắn trùng lặp theo message_id hoặc event_id
      const dedupKey = messageId || eventId;
      if (dedupKey) {
        const isDuplicate = await checkAndMarkMessageProcessed(dedupKey);
        if (isDuplicate) {
          console.log(`[LarkWebhook] Bỏ qua tin nhắn trùng lặp: ${dedupKey}`);
          return Response.json({ code: 0, msg: "ignored: duplicate message" });
        }
      }

      // Chỉ xử lý tin nhắn từ người dùng thật
      if (body.event?.sender?.sender_type && body.event.sender.sender_type !== "user") {
        return Response.json({ code: 0, msg: "ignored: not user sender" });
      }

      const isGroup = messageObj.chat_type === "group";
      const mentions = messageObj.mentions || [];

      // BẮT BUỘC: Nếu là nhóm chat thì PHẢI tag bot mới xử lý
      if (isGroup && mentions.length === 0) {
        return Response.json({ code: 0, msg: "ignored: bot not tagged in group chat" });
      }

      // Rút trích nội dung văn bản & loại bỏ các tag mention (@_user_1, ...)
      let rawText = "";
      try {
        const parsed = JSON.parse(messageObj.content || "{}");
        rawText = parsed.text || "";
      } catch {
        rawText = messageObj.content || "";
      }

      const cleanText = rawText.replace(/@_user_\d+/g, "").trim();
      if (!cleanText) {
        return Response.json({ code: 0, msg: "empty message after mention strip" });
      }

      const chatId = messageObj.chat_id;
      const sessionId = messageObj.root_id || chatId;

      // Khóa phiên: Nếu request trước đó cho cùng session đang chạy thì bỏ qua để không lặp kết quả
      if (inFlightRequests.has(sessionId)) {
        console.log(`[LarkWebhook] Phiên ${sessionId} đang chạy, bỏ qua request retry.`);
        return Response.json({ code: 0, msg: "ignored: session in-flight" });
      }

      // QUAN TRỌNG NHẤT:
      // Lark Webhook yêu cầu phản hồi HTTP 200 trong 3 GIÂY! Nếu xử lý LLM đồng bộ (mất 5-8s), Lark sẽ coi là timeout và tự động retry gây lặp tin nhắn!
      // Do đó, ta trả về HTTP 200 { code: 0 } ngay lập tức (<50ms) và chạy AI Agent trong background:
      inFlightRequests.add(sessionId);

      void (async () => {
        try {
          console.log(`[LarkWebhook] Bắt đầu xử lý cho chat ${chatId}: "${cleanText}"`);
          const result = await runAccountingAgent({
            message: cleanText,
            receiveId: chatId,
            receiveIdType: "chat_id",
            sessionId,
            sendToLark: true,
          });
          console.log(`[LarkWebhook] Hoàn tất gửi Lark cho chat ${chatId}. larkSent:`, result.larkSent);
        } catch (agentErr) {
          console.error(`[LarkWebhook] Lỗi xử lý runAccountingAgent:`, agentErr);
        } finally {
          inFlightRequests.delete(sessionId);
        }
      })();

      return Response.json({ code: 0, msg: "success" });
    }

    // 3. Xử lý Event Card Action Trigger từ Lark Bot (khi bấm nút trên Thẻ)
    if (body.header?.event_type === "card.action.trigger" || body.action?.value) {
      const action = body.action || body.event?.action;
      const value = action?.value || {};
      const actionType = value.action;
      const sessionId = value.sessionId;
      const chatId = body.event?.context?.open_chat_id || body.open_chat_id;

      if (actionType === "CONFIRM_NEGATIVE" && sessionId) {
        if (!inFlightRequests.has(sessionId)) {
          inFlightRequests.add(sessionId);
          void (async () => {
            try {
              await runAccountingAgent({
                message: "Xác nhận",
                receiveId: chatId || sessionId,
                receiveIdType: "chat_id",
                sessionId,
                sendToLark: true,
              });
            } catch (e) {
              console.error("[LarkWebhook] Card confirm error:", e);
            } finally {
              inFlightRequests.delete(sessionId);
            }
          })();
        }
        return Response.json({
          toast: { type: "success", content: "Đang tiến hành tạo Bulksheet và đẩy từ khóa..." },
        });
      } else if (actionType === "CANCEL_NEGATIVE" && sessionId) {
        if (!inFlightRequests.has(sessionId)) {
          inFlightRequests.add(sessionId);
          void (async () => {
            try {
              await runAccountingAgent({
                message: "Hủy",
                receiveId: chatId || sessionId,
                receiveIdType: "chat_id",
                sessionId,
                sendToLark: true,
              });
            } catch (e) {
              console.error("[LarkWebhook] Card cancel error:", e);
            } finally {
              inFlightRequests.delete(sessionId);
            }
          })();
        }
        return Response.json({
          toast: { type: "info", content: "Đã hủy thao tác phủ định từ khóa." },
        });
      }
    }

    // 4. Xử lý Direct API Request (dành cho frontend test hoặc curl)
    const directMessage = body.message?.trim();
    if (!directMessage) {
      return Response.json(
        { error: "Vui lòng cung cấp nội dung câu hỏi trong trường 'message'." },
        { status: 400 }
      );
    }

    const recipientEmail = (body.recipientEmail || "ndtrince@gmail.com").trim();
    const sendToLark = body.sendToLark ?? false;
    const sessionId = (body.sessionId || recipientEmail).trim();

    const result = await runAccountingAgent({
      message: directMessage,
      recipientEmail,
      sessionId,
      sendToLark,
    });

    return Response.json({
      success: true,
      query: directMessage,
      sessionId,
      toolsUsed: result.toolsUsed,
      replyText: result.replyText,
      larkSent: result.larkSent,
      larkDetail: result.larkDetail,
    });
  } catch (error: unknown) {
    console.error("Accounting Lark Agent error:", error);
    const message = error instanceof Error ? error.message : "Lỗi xử lý yêu cầu kế toán.";
    return Response.json(
      { error: message },
      { status: 500 }
    );
  }
}
