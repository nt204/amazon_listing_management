import { NextRequest } from "next/server";
import { runAccountingAgent } from "@/lib/accounting/lark-agent-service";
import {
  cardActionToast,
  processLarkCardAction,
  processLarkMessageEvent,
} from "@/lib/accounting/lark-webhook";

export const maxDuration = 60; // Hỗ trợ multi-step tool calls

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    // 1. Xử lý Challenge URL Verification từ Lark Open Platform (Bắt buộc khi đổi sang Webhook)
    if (body.type === "url_verification" && body.challenge) {
      return Response.json({ challenge: body.challenge });
    }

    // 2. Xử lý Event Webhook từ Lark Bot (im.message.receive_v1). Dùng chung
    // logic với /api/lark/webhook: nhóm chat chỉ chạy khi tag đúng bot.
    if (body.header?.event_type === "im.message.receive_v1" && body.event?.message) {
      await processLarkMessageEvent({ ...body.event, tenant_key: body.header?.tenant_key });
      return Response.json({ code: 0, msg: "success" });
    }

    // 3. Xử lý Event Card Action Trigger từ Lark Bot (khi bấm nút trên Thẻ)
    if (body.header?.event_type === "card.action.trigger" || body.action?.value) {
      return Response.json(cardActionToast(await processLarkCardAction(body.event ?? body)));
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
