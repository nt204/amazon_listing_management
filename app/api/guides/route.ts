import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { listSystemGuides, saveSystemGuide } from "@/lib/db";
import { extname } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    authorize(request, "read");
    const guides = await listSystemGuides();
    return Response.json({ guides }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải danh sách hướng dẫn.");
  }
}

export async function POST(request: Request) {
  try {
    const actor = authorize(request, "write");
    if (actor.role !== "admin") {
      throw new ApiError("Chỉ có Quản trị viên mới được quyền tải lên tài liệu hướng dẫn.", 403);
    }
    enforceRequestSize(request, 30_000_000); // 30MB limit
    const formData = await request.formData();
    const title = String(formData.get("title") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const file = formData.get("file");

    if (!title || title.length < 2) {
      throw new ApiError("Tiêu đề tài liệu hướng dẫn phải có ít nhất 2 ký tự.", 400);
    }
    if (!(file instanceof File)) {
      throw new ApiError("Hãy chọn file PDF hướng dẫn.", 400);
    }
    if (file.size > 25_000_000) {
      throw new ApiError("File PDF không được vượt quá 25MB.", 413);
    }
    const ext = extname(file.name).toLowerCase();
    if (ext !== ".pdf") {
      throw new ApiError("Hệ thống chỉ hỗ trợ định dạng file PDF (.pdf).", 400);
    }

    const pdfBytes = Buffer.from(await file.arrayBuffer());
    const guide = await saveSystemGuide({
      title,
      description,
      filename: file.name,
      pdfBytes,
    });

    return Response.json({ success: true, guide });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải lên tài liệu hướng dẫn.");
  }
}
