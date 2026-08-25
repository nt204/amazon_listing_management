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
  _templateName?: string,
) {
  if (sourceImageMode === "artwork") {
    return [
      "Image 1 is the AUTHORITATIVE BASE TEMPLATE of a clear glass ornament product.",
      "Image 2 is 2D source artwork.",
      "Visually identify the printable face of the glass ornament in Image 1.",
      "Extract ONLY the 2D artwork graphics from Image 2 and fit them naturally onto Image 1's glass ornament AT ITS EXACT PRE-EXISTING POSITION.",
      "STRICT POSITION & COMPOSITION LOCK: Do NOT move, reposition, translate, resize, or alter the glass ornament, red box, ribbon, background, or framing of Image 1.",
      "STRICT ANNOTATION PRESERVATION: Keep all pre-existing text annotations in Image 1 (such as 'PACKAGE INCLUDED', list items, labels, measurement lines) 100% visible, sharp, and completely untouched.",
      "STRICT GEOMETRY LOCK & NO SHAPE DISTORTION: Keep Image 1's exact ornament shape, perfect circle geometry, and outer bevel rim 100% frozen. Do NOT warp, distort, stretch, compress, skew, bend, bulge, or alter Image 1's physical ornament into an oval or ellipse.",
      "SAFE PRINTING MARGIN & CENTERING: Scale and position the extracted artwork cleanly inside Image 1's clear printable glass area with safe padding margins. The top of the artwork (star) must sit comfortably BELOW Image 1's top ribbon loop and hole, leaving a clean gap. The bottom of the artwork must sit comfortably ABOVE the bottom bevel rim.",
      "STRICT EXCLUSION OF HANGER HOLE & HARDWARE: Do NOT copy, transfer, or recreate any top hanger hole, string hole, metal ring, loop, hanging hardware, product, or background elements from Image 2 onto Image 1. Completely exclude all hardware elements from Image 2.",
      "MANDATORY ARTWORK ROTATION ALIGNMENT: In Image 1, the glass ornament's top ribbon hole and hanging ribbon are tilted counter-clockwise at a ~15-degree angle (pointing to ~11 o'clock). You MUST rotate the extracted artwork graphics counter-clockwise (~15 degrees) so that the top of the artwork (the star) points directly toward Image 1's top ribbon hole, aligning with the glass ornament's tilted axis of symmetry. Do NOT render the artwork straight vertical at 0 degrees when the ornament itself is tilted.",
      "POD PRINT COLOR FAITHFULNESS: Preserve the exact vibrant colors, contrast, saturation, text, typography, layout, and sharp details of the source artwork from Image 2.",
      "Keep Image 1's base scene, background, and crystal-clear glass transparency unchanged.",
      "Return the edited Image 1 only.",
    ].join(" ");
  }

  return [
    "Image 1 is the AUTHORITATIVE BASE TEMPLATE of a clear glass ornament product. Image 1's composition, camera framing, glass ornament position, red box, ribbon, bevel rim, text annotations, and circular geometry are 100% FROZEN and IMMUTABLE.",
    "Image 2 is a sample product photo containing printed artwork on a glass ornament.",
    "Visually analyze Image 2 to separate and distinguish the 2D printed artwork graphics from Image 2's photo background and physical product elements.",
    "Extract ONLY the 2D printed graphic elements (illustrations, text, typography, logos) from Image 2.",
    "Identify the printable glass surface of the ornament in Image 1 and fit the extracted 2D artwork naturally onto that decorated surface AT ITS EXACT EXISTING LOCATION IN IMAGE 1 with correct scale, orientation, and centering.",
    "STRICT EXCLUSION OF HANGER HOLE & HARDWARE: Image 2 may show a physical hanger hole, string hole, metal ring, loop, or hanging hardware at the top. Do NOT copy, transfer, or recreate any hanger hole, metal ring, metallic loop, string hole, or hardware from Image 2 onto Image 1. Exclude all product and background elements from Image 2. Extract ONLY the pure printed artwork (illustrations, text, vehicles, stars, dates).",
    "SAFE PRINTING MARGIN & CENTERING: Scale and position the extracted artwork so it sits cleanly INSIDE the clear printable glass area of Image 1 with safe margins. The top of the artwork (the star) must be placed cleanly BELOW the top ribbon loop and hanger hole of Image 1, leaving a visible gap. The bottom of the artwork (e.g. '2026') must be placed cleanly ABOVE the bottom bevel rim. Center the entire artwork design inside Image 1's glass ornament circle without touching or overlapping the ribbon, top hole, or outer bevel edges.",
    "STRICT NO REPOSITIONING: Do NOT move, translate, reposition, or resize the glass ornament in Image 1. The ornament must remain at its exact pre-existing coordinates (e.g. resting partially on the left side of the box in Template 3).",
    "STRICT PRESERVATION OF ALL TEXT & ANNOTATIONS: Do NOT erase, remove, edit, mask, or alter any pre-existing text annotations, titles, bullet lists, or labels in Image 1 (such as 'PACKAGE INCLUDED', '1 - Colored Lanyard', '1 - Gift-Box Included', '1 - Glass Ornament', measurement annotations, etc.). All text and annotations in Image 1 MUST REMAIN 100% VISIBLE and UNTOUCHED.",
    "STRICT GEOMETRY LOCK (NO SHAPE DISTORTION): Do NOT warp, stretch, skew, deform, compress, bulge, or alter Image 1's physical ornament body, outer bevel rim, or background scene. Image 1's circular shape must remain perfectly round and unchanged pixel-for-pixel. Do NOT turn the ornament into an oval or ellipse.",
    "MANDATORY ARTWORK ROTATION ALIGNMENT: In Image 1, the glass ornament's top ribbon hole and hanging ribbon are tilted counter-clockwise at a ~15-degree angle (pointing to ~11 o'clock). You MUST rotate the extracted artwork graphics counter-clockwise (~15 degrees) so that the top of the artwork (the star) points directly toward Image 1's top ribbon hole, aligning with the glass ornament's tilted axis of symmetry. Do NOT render the artwork straight vertical at 0 degrees when the ornament itself is tilted.",
    "POD PRINT COLOR FAITHFULNESS: Preserve and keep the printed artwork colors, text, typography, and layout vibrant, bright, rich, and high-contrast, matching the exact original colors from Image 2.",
    "STRICT CRYSTAL-CLEAR GLASS TRANSPARENCY: Preserve and keep Image 1's base scene, background, framing, and non-printed glass areas 100% crystal-clear, unchanged, and see-through.",
    "Return the edited Image 1 only.",
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
    process.env.CHEAPKEYAI_IMAGE_API_KEY?.trim() ||
    process.env.CHEAPKEYAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      "Chưa cấu hình CHEAPKEYAI_IMAGE_API_KEY hoặc CHEAPKEYAI_API_KEY để tạo Ornament Template Mockup bằng GPT Image 2.",
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
        // CheapKeyAI already routes requests across upstream channels. Avoid
        // multiplying slow 429/5xx requests in the SDK.
        maxRetries: 0,
        timeout: configuredTimeout(),
      },
    );
  } catch (firstError) {
    if (!options.imageEditClient) {
      // Attempt automatic fallback to gpt-image-2-c
      try {
        console.warn(
          `[CheapKeyAI Template Edit] Model ${GLASS_ORNAMENT_IMAGE_MODEL} lỗi. Thử lại với gpt-image-2-c...`,
        );
        response = await client.images.edit(
          {
            model: "gpt-image-2-c",
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
      } catch {
        throw new Error(
          `AI không thể ghép thiết kế vào template: ${describeProviderError(firstError)}`,
          { cause: firstError },
        );
      }
    } else {
      throw new Error(
        `AI không thể ghép thiết kế vào template: ${describeProviderError(firstError)}`,
        { cause: firstError },
      );
    }
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
