import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ImageEditParamsNonStreaming } from "openai/resources/images";
import { GLASS_ORNAMENT_TEMPLATES } from "./template-mockup-types";

export * from "./template-mockup-types";

export type TemplateMockupSourceImageMode = "artwork" | "product-photo";
export const GLASS_ORNAMENT_IMAGE_MODEL = "gpt-image-2" as const;

export interface RenderTemplateOptions {
  templateId: string;
  designBuffer: Buffer;
  targetWidth?: number;
  targetHeight?: number;
  /** Test/custom input seam; production reads the selected template asset. */
  templateBuffer?: Buffer;
  sourceImageMode?: TemplateMockupSourceImageMode;
}

export interface TemplateMockupImageEditResponse {
  data?: Array<{ b64_json?: string | null }>;
  size?: string | null;
}

export interface TemplateMockupImageEditRequestOptions {
  maxRetries?: number;
  timeout?: number;
}

/** Minimal OpenAI-compatible client surface, intentionally small for unit tests. */
export interface TemplateMockupImageEditClient {
  images: {
    edit(
      body: ImageEditParamsNonStreaming,
      options?: TemplateMockupImageEditRequestOptions,
    ): Promise<TemplateMockupImageEditResponse>;
  };
}

export interface RenderTemplateWithAiOptions extends RenderTemplateOptions {
  quality?: "low" | "medium" | "high" | "auto";
  cheapKeyAIApiKey?: string;
  cheapKeyAIBaseUrl?: string;
  imageEditClient?: TemplateMockupImageEditClient;
  /** Label returned to the caller when an injected client is used. */
  injectedProviderName?: string;
}

export interface TemplateMockupRenderResult {
  buffer: Buffer;
  width: number;
  height: number;
  mimeType: "image/png";
}

export interface TemplateMockupAiRenderResult
  extends TemplateMockupRenderResult {
  providerUsed: string;
}

type SupportedInputImage = {
  extension: "jpg" | "png" | "webp";
  mimeType: "image/jpeg" | "image/png" | "image/webp";
};

type OutputQuality = NonNullable<ImageEditParamsNonStreaming["quality"]>;

const DEFAULT_OUTPUT_WIDTH = 2000;
const DEFAULT_OUTPUT_HEIGHT = 2000;
const DEFAULT_QUALITY: OutputQuality = "high";
const DEFAULT_CHEAPKEYAI_BASE_URL = "https://cheapkeyai.shop/v1";
const DEFAULT_TIMEOUT_MS = 600_000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function templateById(templateId: string) {
  const spec = GLASS_ORNAMENT_TEMPLATES.find(
    (template) => template.id === templateId,
  );
  if (!spec) {
    throw new Error(`Template Glass Ornament không tồn tại: ${templateId}`);
  }
  return spec;
}

function detectInputImage(buffer: Buffer, label: string): SupportedInputImage {
  if (
    buffer.length >= PNG_SIGNATURE.length &&
    buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    return { extension: "png", mimeType: "image/png" };
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { extension: "jpg", mimeType: "image/jpeg" };
  }

  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { extension: "webp", mimeType: "image/webp" };
  }

  throw new Error(
    `${label} không phải ảnh PNG, JPEG hoặc WebP hợp lệ để gửi cho AI.`,
  );
}

function configuredQuality(
  requestedQuality?: RenderTemplateWithAiOptions["quality"],
): OutputQuality {
  if (requestedQuality) return requestedQuality;

  const configured = process.env.TEMPLATE_MOCKUP_IMAGE_QUALITY
    ?.trim()
    .toLowerCase();
  if (
    configured === "low" ||
    configured === "medium" ||
    configured === "high" ||
    configured === "auto"
  ) {
    return configured;
  }
  return DEFAULT_QUALITY;
}

function validateOutputSize(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width % 16 !== 0 ||
    height % 16 !== 0
  ) {
    throw new Error(
      "Kích thước ảnh AI phải là số nguyên dương và chia hết cho 16.",
    );
  }

  const aspectRatio = width / height;
  if (aspectRatio < 1 / 3 || aspectRatio > 3) {
    throw new Error("Tỷ lệ ảnh AI phải nằm trong khoảng 1:3 đến 3:1.");
  }

  return { width, height, value: `${width}x${height}` };
}

function configuredOutputSize(options: RenderTemplateOptions) {
  if (options.targetWidth !== undefined || options.targetHeight !== undefined) {
    const width =
      options.targetWidth ?? options.targetHeight ?? DEFAULT_OUTPUT_WIDTH;
    const height =
      options.targetHeight ?? options.targetWidth ?? DEFAULT_OUTPUT_HEIGHT;
    return validateOutputSize(width, height);
  }

  const configured = process.env.TEMPLATE_MOCKUP_IMAGE_SIZE?.trim();
  if (configured) {
    const match = configured.match(/^(\d+)x(\d+)$/i);
    if (!match) {
      throw new Error(
        "TEMPLATE_MOCKUP_IMAGE_SIZE phải có định dạng WIDTHxHEIGHT.",
      );
    }
    return validateOutputSize(Number(match[1]), Number(match[2]));
  }

  return validateOutputSize(DEFAULT_OUTPUT_WIDTH, DEFAULT_OUTPUT_HEIGHT);
}

function configuredTimeout() {
  const parsed = Number(
    process.env.TEMPLATE_MOCKUP_IMAGE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS,
  );
  return Number.isFinite(parsed)
    ? Math.min(DEFAULT_TIMEOUT_MS, Math.max(30_000, Math.round(parsed)))
    : DEFAULT_TIMEOUT_MS;
}

function buildAiEditPrompt(
  sourceImageMode: TemplateMockupSourceImageMode,
  templateName: string,
) {
  const sourceDefinition =
    sourceImageMode === "artwork"
      ? "IMAGE 2 is standalone source artwork. Treat the complete image, including any intentional artwork background, as the design to transfer."
      : "IMAGE 2 is a finished source-product photo. It can include a product, scene background, props, hanger, glass rim, glare, reflections, shadows, and the printed artwork.";
  const sourceAnalysis =
    sourceImageMode === "artwork"
      ? "Use the complete content of IMAGE 2 as the artwork. Do not discard its intentional background, fill, text, illustration, color, or texture."
      : "Visually analyze IMAGE 2 and separate the actual artwork from the physical product and surrounding scene. The artwork means only the intentional printed visual content: illustrations, characters, typography, names, dates, numbers, colors, textures, and layout. An internal color or texture that belongs to the printed composition is part of the artwork; the photo background and physical ornament are not.";

  return [
    "You are performing one precise multi-image product-mockup edit.",
    "",
    `IMAGE 1 — AUTHORITATIVE BASE TEMPLATE (${templateName}) AND FINAL CANVAS:`,
    "Use IMAGE 1 as the final image. Visually identify the glass ornament and infer its intended printable/decorated face from the product geometry and existing visual cues. Determine the correct placement, boundary, scale, orientation, perspective, curvature, and foreground occlusions yourself; no coordinates or mask are provided.",
    "",
    "IMAGE 2 — SOURCE DESIGN REFERENCE:",
    sourceDefinition,
    sourceAnalysis,
    "",
    "EDIT TASK:",
    "Extract only the complete artwork from IMAGE 2 and transfer only that artwork onto the printable face of the glass ornament in IMAGE 1. Replace any blank or existing printed design in that target area.",
    "Fit the complete artwork naturally within the target surface while preserving its composition and relative layout. Keep it fully contained; do not crop or stretch it. Adapt only its placement, uniform scale, orientation, perspective, and surface curvature as needed so it looks genuinely printed on that ornament rather than pasted on top.",
    "Preserve the source artwork faithfully: keep every visible element, exact wording, spelling, names, dates, numbers, colors, character appearance, typography, and relative positioning. Do not redesign, simplify, reinterpret, add, remove, rewrite, or duplicate artwork elements.",
    "",
    "DO NOT TRANSFER THE SOURCE PRODUCT OR SCENE:",
    "Do not copy IMAGE 2's photo background, ornament body, circular glass edge, bevel, hole, ribbon, hanger, stand, glare, reflections, shadows, hands, props, or lighting. Do not place a rectangular or circular crop of IMAGE 2 into IMAGE 1. Do not create an ornament inside another ornament.",
    "",
    "PRESERVE IMAGE 1:",
    "Change only the printed artwork on the target ornament. Keep IMAGE 1's background, framing, crop, camera angle, ornament shape and position, transparent glass material, outer rim, bevel, hole, ribbon/hanger, hands, props, foreground objects, highlights, glare, reflections, shadows, lighting, measurement guides, text, labels, and size annotations unchanged. Retain IMAGE 1's glass effects, reflections, highlights, refraction, shadows, and foreground occlusions over the transferred artwork.",
    "Return one finished opaque PNG of the edited IMAGE 1 only. No comparison, border, caption, watermark, or extra panel.",
  ].join("\n");
}

async function resolveImageEditClient(
  options: RenderTemplateWithAiOptions,
): Promise<{
  client: TemplateMockupImageEditClient;
  providerUsed: string;
}> {
  const injectedClient = options.imageEditClient;
  if (injectedClient) {
    return {
      client: injectedClient,
      providerUsed:
        options.injectedProviderName?.trim() ||
        `CheapKeyAI Image Edit (${GLASS_ORNAMENT_IMAGE_MODEL})`,
    };
  }

  const apiKey =
    options.cheapKeyAIApiKey?.trim() ||
    process.env.CHEAPKEYAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      "Chưa cấu hình CHEAPKEYAI_API_KEY để tạo Ornament Template Mockup bằng GPT Image 2.",
    );
  }

  const { default: OpenAI } = await import("openai");
  const baseURL = (
    options.cheapKeyAIBaseUrl ||
    process.env.CHEAPKEYAI_BASE_URL ||
    DEFAULT_CHEAPKEYAI_BASE_URL
  )
    .trim()
    .replace(/\/+$/, "");
  const openai = new OpenAI({ apiKey, baseURL });

  return {
    client: {
      images: {
        edit: (body, requestOptions) =>
          openai.images.edit(body, requestOptions),
      },
    },
    providerUsed: `CheapKeyAI Image Edit (${GLASS_ORNAMENT_IMAGE_MODEL})`,
  };
}

function decodeBase64Image(encoded: string | null | undefined) {
  const normalized = encoded?.replace(/\s+/g, "") || "";
  if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error("AI không trả về dữ liệu ảnh base64 hợp lệ.");
  }

  const buffer = Buffer.from(normalized, "base64");
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("AI không trả về ảnh PNG hợp lệ như đã yêu cầu.");
  }
  if (buffer.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Ảnh PNG do AI trả về không có header IHDR hợp lệ.");
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height) {
    throw new Error("Không đọc được kích thước ảnh PNG do AI trả về.");
  }

  return { buffer, width, height };
}

function describeProviderError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Provider không cung cấp thông tin lỗi.";
}

/**
 * Creates the mockup exclusively through one GPT Image edit request.
 *
 * Input order is deliberate: the template is the base image (#1), while the
 * selected source product/artwork is the visual reference (#2). No crop,
 * masking, compositing, rendering fallback, or post-generation resize occurs.
 */
export async function renderTemplateMockupWithAi(
  options: RenderTemplateWithAiOptions,
): Promise<TemplateMockupAiRenderResult> {
  const spec = templateById(options.templateId);
  const quality = configuredQuality(options.quality);
  const outputSize = configuredOutputSize(options);
  const sourceImageMode = options.sourceImageMode || "product-photo";
  const templateBuffer =
    options.templateBuffer ||
    (await readFile(path.join(process.cwd(), spec.templateAssetPath)).catch(
      (error: unknown) => {
        throw new Error(
          `Không tìm thấy hoặc không đọc được ảnh template: ${spec.templateAssetPath}`,
          { cause: error },
        );
      },
    ));
  const templateFormat = detectInputImage(templateBuffer, "Ảnh template");
  const sourceFormat = detectInputImage(
    options.designBuffer,
    "Ảnh sản phẩm nguồn",
  );
  const { client, providerUsed } = await resolveImageEditClient(options);
  const { toFile } = await import("openai");
  const templateFile = await toFile(
    templateBuffer,
    `template-base.${templateFormat.extension}`,
    { type: templateFormat.mimeType },
  );
  const sourceFile = await toFile(
    options.designBuffer,
    `source-product.${sourceFormat.extension}`,
    { type: sourceFormat.mimeType },
  );

  let response: TemplateMockupImageEditResponse;
  try {
    response = await client.images.edit(
      {
        model: GLASS_ORNAMENT_IMAGE_MODEL,
        image: [templateFile, sourceFile],
        prompt: buildAiEditPrompt(sourceImageMode, spec.name),
        n: 1,
        size: outputSize.value,
        quality,
        output_format: "png",
        background: "opaque",
      },
      {
        maxRetries: 0,
        timeout: configuredTimeout(),
      },
    );
  } catch (error) {
    throw new Error(
      `AI không thể ghép thiết kế vào template: ${describeProviderError(error)}`,
      { cause: error },
    );
  }

  const decoded = decodeBase64Image(response.data?.[0]?.b64_json);
  return {
    ...decoded,
    mimeType: "image/png",
    providerUsed,
  };
}

/** Backwards-compatible alias; this path is AI-only and has no local fallback. */
export async function renderTemplateMockup(
  options: RenderTemplateWithAiOptions,
): Promise<TemplateMockupAiRenderResult> {
  return renderTemplateMockupWithAi(options);
}
