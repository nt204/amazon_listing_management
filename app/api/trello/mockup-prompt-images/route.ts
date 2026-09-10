import sharp from "sharp";
import {
  ApiError,
  authorize,
  dataScope,
  enforceRequestSize,
  routeErrorResponse,
} from "@/lib/api-guard";
import {
  pruneExpiredMockupPromptReferenceImages,
  saveMockupPromptReferenceImage,
} from "@/lib/db";
import { detectRasterImageMimeType } from "@/lib/image-processing";

export const runtime = "nodejs";

const MAX_REFERENCE_IMAGE_BYTES = 10_000_000;

export async function POST(request: Request) {
  try {
    const scope = dataScope(authorize(request, "write"));
    enforceRequestSize(request, MAX_REFERENCE_IMAGE_BYTES + 1_000_000);
    const form = await request.formData();
    const image = form.get("image");
    if (!(image instanceof File)) {
      throw new ApiError("Clipboard không chứa tệp ảnh hợp lệ.", 400);
    }
    if (image.size <= 0 || image.size > MAX_REFERENCE_IMAGE_BYTES) {
      throw new ApiError("Mỗi ảnh prompt phải nhỏ hơn 10 MB.", 413);
    }
    const storageScope = form.get("scope") === "shared" ? "shared" : "temporary";
    const presetId = String(form.get("presetId") || "").trim();
    const contentId = Number(form.get("contentId"));
    if (
      storageScope === "shared" &&
      (!/^[A-Za-z0-9_-]{1,160}$/.test(presetId) ||
        !Number.isInteger(contentId) ||
        contentId < 1 ||
        contentId > 10_000)
    ) {
      throw new ApiError("Phôi hoặc Content của ảnh prompt không hợp lệ.", 400);
    }

    const bytes = Buffer.from(await image.arrayBuffer());
    let mimeType: "image/png" | "image/jpeg" | "image/webp";
    try {
      mimeType = detectRasterImageMimeType(bytes) as typeof mimeType;
      await sharp(bytes, { failOn: "warning" }).metadata();
    } catch {
      throw new ApiError("Chỉ hỗ trợ ảnh PNG, JPEG hoặc WEBP hợp lệ.", 400);
    }
    const referenceImage = await saveMockupPromptReferenceImage(scope, {
      storageScope,
      presetId: storageScope === "shared" ? presetId : undefined,
      contentId: storageScope === "shared" ? contentId : undefined,
      fileName: (image.name || `clipboard-${Date.now()}`).slice(0, 240),
      mimeType,
      bytes,
    });
    void pruneExpiredMockupPromptReferenceImages().catch(() => undefined);
    return Response.json({ image: referenceImage }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, "Không thể lưu ảnh tham chiếu của prompt.");
  }
}
