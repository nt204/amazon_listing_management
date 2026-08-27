import { ApiError, authorize, routeErrorResponse } from "@/lib/api-guard";
import { deleteSystemGuide, getSystemGuideById } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    authorize(request, "read");
    const { id } = await params;
    const guide = await getSystemGuideById(id);
    if (!guide) {
      return new Response("Không tìm thấy tài liệu hướng dẫn.", { status: 404 });
    }

    const encodedFilename = encodeURIComponent(guide.filename);
    return new Response(new Uint8Array(guide.pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`,
        "Content-Length": String(guide.pdfBytes.byteLength),
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải file PDF.");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = authorize(request, "write");
    if (actor.role !== "admin") {
      throw new ApiError("Chỉ có Quản trị viên mới được quyền xóa tài liệu hướng dẫn.", 403);
    }
    const { id } = await params;
    const deleted = await deleteSystemGuide(id);
    if (!deleted) {
      return Response.json({ error: "Không tìm thấy tài liệu cần xóa." }, { status: 404 });
    }
    return Response.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error, "Không thể xóa tài liệu hướng dẫn.");
  }
}
