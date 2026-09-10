import {
  ApiError,
  authorize,
  dataScope,
  routeErrorResponse,
} from "@/lib/api-guard";
import {
  deleteMockupPromptReferenceImages,
  getMockupPromptReferenceImage,
} from "@/lib/db";

export const runtime = "nodejs";

function validImageId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new ApiError("ID ảnh prompt không hợp lệ.", 400);
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const scope = dataScope(authorize(request, "read"));
    const { id } = await context.params;
    validImageId(id);
    const image = await getMockupPromptReferenceImage(scope, id);
    if (!image) throw new ApiError("Không tìm thấy ảnh prompt.", 404);
    return new Response(new Uint8Array(image.buffer), {
      headers: {
        "Content-Type": image.mimeType,
        "Content-Length": String(image.buffer.byteLength),
        "Cache-Control":
          image.storageScope === "shared"
            ? "private, max-age=3600"
            : "private, no-store",
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải ảnh tham chiếu của prompt.", 500);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const scope = dataScope(authorize(request, "write"));
    const { id } = await context.params;
    validImageId(id);
    const deleted = await deleteMockupPromptReferenceImages(scope, [id]);
    if (!deleted) throw new ApiError("Không tìm thấy ảnh prompt.", 404);
    return Response.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error, "Không thể xóa ảnh tham chiếu của prompt.");
  }
}
