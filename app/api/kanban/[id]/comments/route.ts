import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { createKanbanComment, listKanbanComments } from "@/lib/kanban-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const comments = await listKanbanComments(id);
    return Response.json({ comments }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải comment của thẻ.");
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    enforceRequestSize(request, 20_000);
    const { id } = await params;
    const body = (await request.json()) as { body?: string };
    const commentBody = (body.body || "").trim();
    if (!commentBody) throw new ApiError("Vui lòng nhập nội dung comment.", 400);

    let authorName = "Thành viên";
    try {
      const actor = await authorize(request, "write");
      authorName = actor.displayName || actor.userId || authorName;
    } catch {
      // Giữ hành vi cho phép phản hồi công khai của Kanban hiện có.
    }

    const comment = await createKanbanComment({ cardId: id, body: commentBody, authorName });
    if (!comment) throw new ApiError("Không tìm thấy thẻ để thêm comment.", 404);
    return Response.json({ success: true, comment }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, "Không thể thêm comment.");
  }
}
