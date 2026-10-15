import { ApiError, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import {
  deleteKanbanCard,
  getKanbanCardById,
  moveKanbanCard,
  updateKanbanCard,
  type KanbanStatus,
  type KanbanUrgency,
} from "@/lib/kanban-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const card = await getKanbanCardById(id);
    if (!card) {
      throw new ApiError("Không tìm thấy thẻ.", 404);
    }
    return Response.json({ card });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải thông tin thẻ.");
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    enforceRequestSize(request, 15_000_000);
    const { id } = await params;
    const body = (await request.json()) as {
      title?: string;
      description?: string;
      urgency?: KanbanUrgency;
      status?: KanbanStatus;
      images?: string[];
      authorName?: string;
      position?: number;
    };

    // If only moving status/position
    if (body.status && Object.keys(body).length <= 2 && (body.position !== undefined || Object.keys(body).length === 1)) {
      const moved = await moveKanbanCard(id, body.status, body.position);
      if (!moved) throw new ApiError("Không tìm thấy thẻ để di chuyển.", 404);
      return Response.json({ success: true, card: moved });
    }

    const card = await updateKanbanCard(id, body);
    if (!card) {
      throw new ApiError("Không tìm thấy thẻ để cập nhật.", 404);
    }

    return Response.json({ success: true, card });
  } catch (error) {
    return routeErrorResponse(error, "Không thể cập nhật thẻ.");
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const deleted = await deleteKanbanCard(id);
    if (!deleted) {
      throw new ApiError("Không tìm thấy thẻ để xóa.", 404);
    }
    return Response.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error, "Không thể xóa thẻ.");
  }
}
