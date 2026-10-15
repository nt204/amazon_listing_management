import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { createKanbanCard, listKanbanCards, type KanbanStatus, type KanbanUrgency } from "@/lib/kanban-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const status = (url.searchParams.get("status") || undefined) as KanbanStatus | undefined;
    const urgency = (url.searchParams.get("urgency") || undefined) as KanbanUrgency | undefined;
    const search = url.searchParams.get("search") || undefined;

    const cards = await listKanbanCards({ status, urgency, search });
    return Response.json({ cards }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải danh sách thẻ kanban.");
  }
}

export async function POST(request: Request) {
  try {
    enforceRequestSize(request, 15_000_000); // 15MB to allow base64 screenshots
    let actorDisplayName = "";
    try {
      const actor = await authorize(request, "write");
      actorDisplayName = actor.displayName || actor.userId;
    } catch {
      // Allow fallback if unauthenticated / public note
    }

    const body = (await request.json()) as {
      title?: string;
      description?: string;
      urgency?: KanbanUrgency;
      status?: KanbanStatus;
      images?: string[];
      authorName?: string;
    };

    const title = (body.title || "").trim();
    if (!title) {
      throw new ApiError("Vui lòng nhập tên lỗi hoặc nội dung ý kiến.", 400);
    }

    const urgency: KanbanUrgency =
      body.urgency === "low" || body.urgency === "high" || body.urgency === "urgent"
        ? body.urgency
        : "medium";

    const status: KanbanStatus =
      body.status === "in_progress" || body.status === "done" ? body.status : "todo";

    const authorName = (body.authorName || "").trim() || actorDisplayName || "Thành viên";

    const card = await createKanbanCard({
      title,
      description: body.description || "",
      urgency,
      status,
      images: Array.isArray(body.images) ? body.images : [],
      authorName,
    });

    return Response.json({ success: true, card }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tạo thẻ mới.");
  }
}
