import { NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import {
  GLASS_ORNAMENT_IMAGE_MODEL,
  renderTemplateMockupWithAi,
} from "./template-mockup";
import { GLASS_ORNAMENT_TEMPLATES } from "./template-mockup-types";

const MAX_IMAGE_BYTES = 25_000_000;
const MAX_REQUEST_BYTES = 36_000_000;
const SUPPORTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const templateIds = new Set(
  GLASS_ORNAMENT_TEMPLATES.map((template) => template.id),
);

const requestSchema = z.object({
  designDataUrl: z.string().min(1),
  selectedTemplateIds: z
    .array(z.string())
    .min(1, "Vui lòng chọn ít nhất 1 ảnh template."),
  mode: z.literal("ai").default("ai"),
});

type RenderWithAi = typeof renderTemplateMockupWithAi;

interface TemplateMockupPostDependencies {
  renderWithAi?: RenderWithAi;
}

function parseImageDataUrl(dataUrl: string): {
  mimeType: string;
  bytes: Buffer;
} {
  const matches = dataUrl.match(
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/,
  );
  if (!matches || !SUPPORTED_MIME_TYPES.has(matches[1])) {
    throw new Error("Định dạng ảnh không hợp lệ. Chỉ hỗ trợ PNG, JPG hoặc WebP.");
  }

  if (matches[2].length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4) {
    throw new Error("Ảnh thiết kế phải nhỏ hơn 25 MB.");
  }

  const bytes = Buffer.from(matches[2], "base64");
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error("Ảnh thiết kế phải nhỏ hơn 25 MB.");
  }
  return { mimeType: matches[1], bytes };
}

async function validateRasterImage(bytes: Buffer, declaredMimeType: string) {
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    metadata = await sharp(bytes).metadata();
  } catch {
    throw new Error("File tải lên không phải là ảnh raster hợp lệ.");
  }

  const actualMimeType =
    metadata.format === "jpeg"
      ? "image/jpeg"
      : metadata.format === "png"
        ? "image/png"
        : metadata.format === "webp"
          ? "image/webp"
          : "";
  if (!actualMimeType || actualMimeType !== declaredMimeType) {
    throw new Error("Nội dung file ảnh không khớp với định dạng đã khai báo.");
  }
  if (!metadata.width || !metadata.height) {
    throw new Error("Không đọc được kích thước ảnh thiết kế.");
  }
  if (metadata.width * metadata.height > 64_000_000) {
    throw new Error("Kích thước ảnh thiết kế vượt quá giới hạn 64 megapixel.");
  }
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

export function createTemplateMockupPostHandler(
  dependencies: TemplateMockupPostDependencies = {},
) {
  const renderWithAi = dependencies.renderWithAi || renderTemplateMockupWithAi;

  return async function handleTemplateMockupPost(request: Request) {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return jsonError("Content-Type phải là application/json.", 415);
    }

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      return jsonError("Dữ liệu tải lên quá lớn.", 413);
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return jsonError("Request phải chứa JSON hợp lệ.", 400);
    }

    const parsed = requestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return jsonError(
        parsed.error.issues[0]?.message || "Dữ liệu tạo mockup không hợp lệ.",
        400,
      );
    }

    const invalidTemplateId = parsed.data.selectedTemplateIds.find(
      (id) => !templateIds.has(id),
    );
    if (invalidTemplateId) {
      return jsonError(`Template không tồn tại: ${invalidTemplateId}`, 400);
    }

    let design: ReturnType<typeof parseImageDataUrl>;
    try {
      design = parseImageDataUrl(parsed.data.designDataUrl);
      await validateRasterImage(design.bytes, design.mimeType);
    } catch (error) {
      return jsonError(
        errorMessage(error, "Ảnh sản phẩm nguồn không hợp lệ."),
        400,
      );
    }

    try {
      const mockups = await Promise.all(
        parsed.data.selectedTemplateIds.map(async (templateId) => {
          const template = GLASS_ORNAMENT_TEMPLATES.find(
            (candidate) => candidate.id === templateId,
          )!;
          const rendered = await renderWithAi({
            templateId,
            designBuffer: design.bytes,
          });

          return {
            templateId: template.id,
            name: template.name,
            badge: template.badge,
            width: rendered.width,
            height: rendered.height,
            dataUrl: `data:${rendered.mimeType};base64,${rendered.buffer.toString(
              "base64",
            )}`,
            providerUsed: rendered.providerUsed,
            mode: "ai",
            model: GLASS_ORNAMENT_IMAGE_MODEL,
          };
        }),
      );

      return NextResponse.json({
        success: true,
        count: mockups.length,
        mode: "ai",
        model: GLASS_ORNAMENT_IMAGE_MODEL,
        mockups,
      });
    } catch (error) {
      const detail = errorMessage(
        error,
        "Nhà cung cấp AI không trả về kết quả.",
      );
      const missingConfiguration =
        /(?:API[ _-]?key|CHEAPKEYAI_API_KEY|chưa cấu hình)/i.test(detail);
      const message = /^Không thể tạo mockup bằng AI:/i.test(detail)
        ? detail
        : `Không thể tạo mockup bằng AI: ${detail}`;
      console.error("[Template Mockup AI Error]:", error);
      return jsonError(message, missingConfiguration ? 503 : 502);
    }
  };
}
