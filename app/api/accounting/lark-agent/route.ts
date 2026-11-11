import { NextRequest } from "next/server";
import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { runAccountingAgent } from "@/lib/accounting/lark-agent-service";
import { POST as verifiedLarkWebhook } from "@/app/api/lark/webhook/route";

export const runtime = "nodejs";
export const maxDuration = 60; // Hỗ trợ multi-step tool calls

/** Callback từ Lark (URL cũ): xác minh challenge / sự kiện / bấm nút. */
function isLarkCallback(body: Record<string, unknown>) {
  return Boolean(
    body.type === "url_verification" ||
      body.challenge ||
      body.encrypt ||
      body.header ||
      body.schema ||
      body.action ||
      body.event,
  );
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  let body: Record<string, unknown>;
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // 1. Sự kiện Lark gửi vào URL cũ: chuyển cho webhook chính để xác minh token / chữ ký trước khi xử lý.
  //    (Trước đây URL này xử lý thẳng nên ai cũng giả được tin nhắn / bấm nút xác nhận PPC của người khác.)
  if (isLarkCallback(body)) {
    return verifiedLarkWebhook(
      new Request(request.url, { method: "POST", headers: request.headers, body: raw }),
    );
  }

  // 2. Hỏi trực tiếp (test trên web / curl): bắt buộc đăng nhập, chỉ thấy store mình được cấp quyền hỏi đáp,
  //    và chỉ được gửi kết quả sang Lark của chính mình.
  try {
    const actor = await authorize(request, "read", "accounting");
    const directMessage = typeof body.message === "string" ? body.message.trim() : "";
    if (!directMessage) {
      return Response.json({ error: "Vui lòng cung cấp nội dung câu hỏi trong trường 'message'." }, { status: 400 });
    }
    if (directMessage.length > 2_000) {
      return Response.json({ error: "Câu hỏi quá dài." }, { status: 400 });
    }

    let receiveId: string | undefined;
    let receiveIdType: "email" | "open_id" | undefined;
    if (body.sendToLark === true) {
      const sql = await getDatabaseClient();
      const [connection] = await sql<Array<{ receive_id: string; receive_id_type: string }>>`
        SELECT receive_id, receive_id_type FROM lark_user_connections
        WHERE team_id = ${actor.teamId} AND actor_id = ${actor.userId} AND enabled = TRUE
        LIMIT 1
      `;
      if (!connection?.receive_id) {
        return Response.json({ error: "Tài khoản của bạn chưa liên kết Lark nên không gửi sang Lark được." }, { status: 400 });
      }
      receiveId = connection.receive_id;
      receiveIdType = connection.receive_id_type === "email" ? "email" : "open_id";
    }

    const sessionId = `web:${actor.teamId}:${actor.userId}`;
    const result = await runAccountingAgent({
      message: directMessage,
      receiveId,
      receiveIdType,
      sessionId,
      sendToLark: Boolean(receiveId),
      webActor: { teamId: actor.teamId, actorId: actor.userId },
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
  } catch (error) {
    return routeErrorResponse(error, "Lỗi xử lý yêu cầu kế toán.", 500);
  }
}
