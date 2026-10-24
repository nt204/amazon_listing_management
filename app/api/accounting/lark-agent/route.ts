import { NextRequest } from "next/server";
import { runAccountingAgent } from "@/lib/accounting/lark-agent-service";

export const maxDuration = 60; // Hỗ trợ multi-step tool calls

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    // 1. Xử lý Challenge URL Verification từ Lark Open Platform
    if (body.type === "url_verification" && body.challenge) {
      return Response.json({ challenge: body.challenge });
    }

    // 2. Xử lý Event Webhook từ Lark Bot (im.message.receive_v1)
    if (body.header?.event_type === "im.message.receive_v1" && body.event?.message) {
      const messageObj = body.event.message;
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
        // Chỉ tag bot mà không có nội dung câu hỏi
        return Response.json({ code: 0, msg: "empty message after mention strip" });
      }

      const chatId = messageObj.chat_id;
      // Dùng chat_id (hoặc root_id nếu là thread) làm sessionId để lưu lịch sử hội thoại ngắn (30 phút)
      const sessionId = messageObj.root_id || chatId;

      const result = await runAccountingAgent({
        message: cleanText,
        receiveId: chatId,
        receiveIdType: "chat_id",
        sessionId,
        sendToLark: true,
      });

      return Response.json({
        code: 0,
        msg: "success",
        data: {
          query: cleanText,
          toolsUsed: result.toolsUsed,
          larkSent: result.larkSent,
        },
      });
    }

    // 2.1 Xử lý Event Card Action Trigger từ Lark Bot
    if (body.header?.event_type === "card.action.trigger" || body.action?.value) {
      const action = body.action || body.event?.action;
      const value = action?.value || {};
      const actionType = value.action;
      const sessionId = value.sessionId;
      const chatId = body.event?.context?.open_chat_id || body.open_chat_id;

      if (actionType === "CONFIRM_NEGATIVE" && sessionId) {
        await runAccountingAgent({
          message: "Xác nhận",
          receiveId: chatId || sessionId,
          receiveIdType: "chat_id",
          sessionId,
          sendToLark: true,
        });
        return Response.json({
          toast: { type: "success", content: "Đã tự động đẩy từ khóa vào danh sách Negative thành công!" },
        });
      } else if (actionType === "CANCEL_NEGATIVE" && sessionId) {
        await runAccountingAgent({
          message: "Hủy",
          receiveId: chatId || sessionId,
          receiveIdType: "chat_id",
          sessionId,
          sendToLark: true,
        });
        return Response.json({
          toast: { type: "info", content: "Đã hủy thao tác phủ định từ khóa." },
        });
      }
    }

    // 3. Xử lý Direct API Request (dành cho frontend test hoặc curl)
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
  } catch (error: any) {
    console.error("Accounting Lark Agent error:", error);
    return Response.json(
      { error: error.message || "Lỗi xử lý yêu cầu kế toán." },
      { status: 500 }
    );
  }
}
