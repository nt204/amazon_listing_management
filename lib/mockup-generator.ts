import OpenAI, { toFile } from "openai";
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import type { Dimensions3D } from "./trello";

export type MockupModel =
  | "gpt-image-2"
  | "gemini-3.1-flash-image"
  | "gemini-3-pro-image"
  | "fast-graphic";

export type MockupImageQuality = "low" | "medium" | "high";

export interface MockupResult {
  index: number;
  name: string;
  type: string;
  buffer: Buffer;
  mimeType: string;
  description: string;
}

export interface GenerateMockupsOptions {
  sku: string;
  itemName: string;
  dimensions: Dimensions3D;
  inputDesignBuffer: Buffer;
  inputMimeType: string;
  model?: MockupModel;
  quality?: MockupImageQuality;
  /** Test seam; production creates the client from OPENAI_API_KEY. */
  openaiClient?: OpenAI;
  /** Test seam; production creates the client from GEMINI_API_KEY. */
  geminiClient?: GoogleGenAI;
  /** Mockup indexes already stored by the caller and safe to resume past. */
  skipIndexes?: readonly number[];
  /** Called immediately after each AI image is ready, before the next image starts. */
  onMockupReady?: (mockup: MockupResult) => Promise<void> | void;
}

export type MockupProgressCallback = (
  step: number,
  name: string,
  status: "processing" | "success",
) => void;

const DEFAULT_IMAGE_MODEL: MockupModel = "gemini-3.1-flash-image";
const OPENAI_IMAGE_SIZE = "1024x1024";
const OPENAI_INPUT_LIMIT_BYTES = 50 * 1024 * 1024;

const MOCKUP_TYPES = [
  {
    index: 1,
    name: "Mockup 1 - Full Design (Ảnh Gốc Đầu Vào)",
    fileName: "Mockup1_FullDesign.png",
    promptKey: "full_design",
    description: "Ảnh thiết kế đầu vào gốc của sản phẩm.",
  },
  {
    index: 2,
    name: "Mockup 2 - Dimension Diagram (Ảnh Đo Kích Thước 3 Chiều)",
    fileName: "Mockup2_Dimensions_3D.png",
    promptKey: "dimensions_3d",
    description:
      "Ảnh Infographic chi tiết thông số kích thước 3 chiều (Dài x Rộng x Dày).",
  },
  {
    index: 3,
    name: "Mockup 3 - Luxury Gift Box (Ảnh Nằm Trên Hộp Quà)",
    fileName: "Mockup3_Gift_Box.png",
    promptKey: "gift_box",
    description:
      "Ảnh sản phẩm đúc bằng thủy tinh nằm trên hộp quà Giáng Sinh bằng nhung sang trọng.",
  },
  {
    index: 4,
    name: "Mockup 4 - Christmas Tree View 1 (Ảnh Treo Cây Thông 1)",
    fileName: "Mockup4_ChristmasTree_View1.png",
    promptKey: "tree_view1",
    description:
      "Ảnh treo sản phẩm trên nhánh cây thông Noel lung linh đèn LED Giáng Sinh.",
  },
  {
    index: 5,
    name: "Mockup 5 - Christmas Tree View 2 (Ảnh Treo Cây Thông 2)",
    fileName: "Mockup5_ChristmasTree_View2.png",
    promptKey: "tree_view2",
    description:
      "Ảnh cận cảnh (Macro shot) treo trên nhánh thông có tuyết nhẹ và ánh lửa lò sưởi.",
  },
  {
    index: 6,
    name: "Mockup 6 - Gifting Handshake (Ảnh Đưa Tay Tặng Nhau)",
    fileName: "Mockup6_Gifting_Hands.png",
    promptKey: "gifting_hands",
    description:
      "Ảnh ấm áp hai bàn tay trao tặng món quà trang trí cho nhau ngày lễ.",
  },
  {
    index: 7,
    name: "Mockup 7 - Car Rearview Mirror (Ảnh Treo Kính Ô Tô)",
    fileName: "Mockup7_Car_Mirror.png",
    promptKey: "car_mirror",
    description:
      "Ảnh sản phẩm treo trang trí trên gương chiếu hậu kính ô tô sang trọng.",
  },
];

export async function generateAllMockups(
  options: GenerateMockupsOptions,
  progressCallback?: MockupProgressCallback,
): Promise<MockupResult[]> {
  const {
    sku,
    itemName,
    dimensions,
    inputDesignBuffer,
    model = DEFAULT_IMAGE_MODEL,
    quality = configuredImageQuality(),
  } = options;
  const skippedIndexes = new Set(options.skipIndexes || []);

  const normalizedDesignBuffer = await normalizeDesignImage(inputDesignBuffer);
  const base64Design = normalizedDesignBuffer.toString("base64");

  // Mockup 1: Original input design
  progressCallback?.(1, MOCKUP_TYPES[0].name, "processing");
  const mockup1: MockupResult = {
    index: 1,
    name: MOCKUP_TYPES[0].name,
    type: MOCKUP_TYPES[0].fileName,
    buffer: normalizedDesignBuffer,
    mimeType: "image/png",
    description: MOCKUP_TYPES[0].description,
  };
  progressCallback?.(1, MOCKUP_TYPES[0].name, "success");

  const openaiApiKey = process.env.OPENAI_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  let openaiClient = options.openaiClient || null;
  let openaiInput: Awaited<ReturnType<typeof toFile>> | null = null;
  if (model === "gpt-image-2") {
    if (!openaiClient) {
      if (!openaiApiKey?.trim()) {
        throw new Error(
          "OPENAI_API_KEY chưa được cấu hình để tạo mockup bằng ChatGPT Image.",
        );
      }
      openaiClient = new OpenAI({ apiKey: openaiApiKey });
    }
    openaiInput = await toFile(
      normalizedDesignBuffer,
      `${safeFileStem(sku)}-design.png`,
      {
        type: "image/png",
      },
    );
  }

  let genAI: GoogleGenAI | null = options.geminiClient || null;
  if (model === "gemini-3.1-flash-image" || model === "gemini-3-pro-image") {
    if (!genAI) {
      if (!geminiApiKey?.trim()) {
        throw new Error(
          "GEMINI_API_KEY chưa được cấu hình để tạo mockup bằng Gemini Image.",
        );
      }
      genAI = new GoogleGenAI({ apiKey: geminiApiKey });
    }
  }

  const generatedResults = await mapWithConcurrency(
    MOCKUP_TYPES.slice(1).filter((meta) => !skippedIndexes.has(meta.index)),
    configuredConcurrency(model),
    async (meta) => {
      progressCallback?.(meta.index, meta.name, "processing");

      let mockupBuffer: Buffer;

      if (model === "gpt-image-2" && openaiClient && openaiInput) {
        const prompt = buildMockupPrompt(meta.promptKey, itemName, dimensions);
        const response = await openaiClient.images.edit(
          {
            model: "gpt-image-2",
            image: openaiInput,
            prompt,
            n: 1,
            size: OPENAI_IMAGE_SIZE,
            quality,
            output_format: "png",
            background: "opaque",
          },
          {
            maxRetries: 0,
            timeout: configuredOpenAITimeout(),
          },
        );
        const b64 = response?.data?.[0]?.b64_json;
        if (!b64) {
          throw new Error(`OpenAI không trả về dữ liệu ảnh cho ${meta.name}.`);
        }
        mockupBuffer = Buffer.from(b64, "base64");
      } else if (genAI) {
        const prompt = buildMockupPrompt(meta.promptKey, itemName, dimensions);
        const response = await genAI.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                { inlineData: { data: base64Design, mimeType: "image/png" } },
              ],
            },
          ],
          config: {
            responseModalities: ["IMAGE"],
            httpOptions: {
              timeout: configuredGeminiTimeout(),
              retryOptions: {
                attempts: configuredGeminiRetryAttempts(),
                initialDelay: 1,
                maxDelay: 4,
              },
            },
          },
        });
        const imagePart = response?.candidates?.[0]?.content?.parts?.find(
          (part: { inlineData?: { data?: string } }) => part.inlineData?.data,
        );
        if (!imagePart?.inlineData?.data) {
          throw new Error(`Gemini không trả về dữ liệu ảnh cho ${meta.name}.`);
        }
        mockupBuffer = Buffer.from(imagePart.inlineData.data, "base64");
      } else {
        mockupBuffer = await renderGraphicMockup(meta.promptKey, {
          sku,
          itemName,
          dimensions,
          base64Design,
        });
      }

      const result = mockupResult(
        meta,
        await normalizeGeneratedMockup(mockupBuffer),
      );
      progressCallback?.(meta.index, meta.name, "success");
      await options.onMockupReady?.(result);
      return result;
    },
  );

  return [mockup1, ...generatedResults.sort((a, b) => a.index - b.index)];
}

export function mockupIndexFromAttachmentName(name: string): number | null {
  const match = name.trim().match(/^Mockup([2-7])_/i);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isInteger(index) ? index : null;
}

export function buildMockupPrompt(
  promptKey: string,
  itemName: string,
  dimensions: Dimensions3D,
): string {
  const baseSpec = `Use Image 1 as the product reference for "${itemName}". It already shows the finished circular glass ornament and ribbon. Remove its old background and place that same complete ornament into the requested scene. Preserve the printed face exactly as shown—same words, symbols, artwork, colors, spacing, and orientation; keep it flat, front-facing, and readable. Do not redraw or curve the print. Photograph at believable ${dimensions.formatted} scale with subtle glass refraction, restrained highlights, natural gravity, and soft contact shadows. The result must look like an unretouched real product photo, not CGI or a poster. No glow, artificial sparkles, watermark, added text, or rectangular copy of the input image.`;

  switch (promptKey) {
    case "dimensions_3d":
      return `${baseSpec}
SCENE: neutral off-white tabletop studio with the ornament standing upright on a discreet clear acrylic support.
COMPOSITION: straight-on product photo, 50 mm lens look, entire ornament and ribbon visible, ornament occupies about 55% of the square frame with generous margins.
LIGHTING: large diffused softbox from camera-left and a weak fill light, neutral white balance, soft grounded shadow.
INFOGRAPHIC OVERLAY: add only three thin charcoal measurement lines outside the product with exact labels "Length: ${dimensions.length}", "Width: ${dimensions.width}", and "Thickness: ${dimensions.thickness}". Keep arrows outside the printed face and do not cover the ornament.`;
    case "gift_box":
      return `${baseSpec}
Create a square catalog photograph of an open burgundy gift box with an ivory velvet insert on a light-oak table. The ornament rests flat inside the fitted insert; the ribbon lies loosely beside it. Three-quarter overhead view, natural 50 mm perspective. Show the whole box, lid, ornament, and some tabletop. The ornament occupies 40-45% of the frame with clear margins. Use soft side-window daylight, neutral-warm white balance, subdued reflections, and a soft grounded shadow. Keep the pale insert visible around the ornament so the red design does not merge into the box.`;
    case "tree_view1":
      return `${baseSpec}
SCENE: the ornament hangs from a sturdy natural pine branch on a real decorated Christmas tree. The attached ribbon bends around the branch under the ornament's weight. A few warm fairy lights appear well behind the product as soft bokeh, never overlapping its printed face.
COMPOSITION: eye-level medium close-up with a 50 mm lens look. Entire ornament and ribbon visible; ornament occupies about 40% of the square frame. Include nearby needles and branch texture for scale.
LIGHTING: soft ambient room light plus subtle warm tree lights, realistic exposure, no dramatic glow or staged studio sparkle.`;
    case "tree_view2":
      return `${baseSpec}
SCENE: the ornament hangs from a lightly snow-dusted natural pine branch in a cozy living room. A fireplace is far in the background and appears only as soft warm blur. The ribbon is taut at the branch and the product hangs vertically under gravity.
COMPOSITION: realistic 85 mm close-up, entire ornament visible without cropping, ornament occupies about 55% of the square frame. Shallow depth of field affects only the background; the complete printed face remains sharp.
LIGHTING: soft directional room light with one restrained warm reflection on the bevel, natural shadows, no artificial sparkle effects.`;
    case "gifting_hands":
      return `${baseSpec}
SCENE: two adults in simple neutral knit sleeves naturally hand the ornament to one another in a cozy living room. One hand supports the lower outer edge while the other gently holds the ribbon; fingers never cover the printed face.
COMPOSITION: documentary-style waist-level close-up with a 50 mm lens look. Both hands are anatomically natural and relaxed. The entire 3.1-inch ornament is visible at believable hand scale and occupies about 35% of the square frame.
LIGHTING: soft daylight from a nearby window, natural skin texture and color, quiet holiday background blur, no staged glow.`;
    case "car_mirror":
      return `${baseSpec}
SCENE: the ornament hangs from the rear-view mirror inside a clean modern car. The ribbon loops realistically around the mirror stem and the ornament hangs vertically without touching the dashboard. Show the windshield, part of the mirror, and softly focused cabin to establish believable scale.
COMPOSITION: photographed from the front passenger seat with a natural 50 mm lens perspective. Entire ornament visible and facing the camera, occupying about 25-30% of the square frame.
LIGHTING: soft late-afternoon daylight through the windshield, realistic cabin contrast and one subtle glass-edge reflection, no cinematic flare or excessive golden glow.`;
    default:
      return baseSpec;
  }
}

function mockupResult(
  meta: (typeof MOCKUP_TYPES)[number],
  buffer: Buffer,
): MockupResult {
  return {
    index: meta.index,
    name: meta.name,
    type: meta.fileName,
    buffer,
    mimeType: "image/png",
    description: meta.description,
  };
}

async function normalizeDesignImage(input: Buffer): Promise<Buffer> {
  let normalized: Buffer;
  try {
    normalized = await sharp(input)
      .rotate()
      .resize({
        width: 2048,
        height: 2048,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
  } catch (error) {
    throw new Error(
      "Ảnh thiết kế không thể chuyển sang PNG để gửi tới model tạo ảnh.",
      { cause: error },
    );
  }

  if (normalized.byteLength > OPENAI_INPUT_LIMIT_BYTES) {
    throw new Error(
      "Ảnh thiết kế vượt quá giới hạn 50 MB của OpenAI Image API.",
    );
  }
  return normalized;
}

async function normalizeGeneratedMockup(input: Buffer): Promise<Buffer> {
  try {
    // Gemini commonly returns JPEG bytes even when the uploaded Trello filename
    // is PNG. Normalize every provider response so the bytes, MIME type and
    // filename always agree.
    return await sharp(input).rotate().png().toBuffer();
  } catch (error) {
    throw new Error("Model AI trả về dữ liệu không phải là ảnh hợp lệ.", {
      cause: error,
    });
  }
}

export function classifyMockupGenerationError(
  error: unknown,
): { message: string; status: number } | null {
  const record =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)
      : {};
  const status = typeof record.status === "number" ? record.status : undefined;
  const code = typeof record.code === "string" ? record.code : "";
  const type = typeof record.type === "string" ? record.type : "";
  const rawMessage =
    error instanceof Error ? error.message : String(error || "");
  const searchable = `${code} ${type} ${rawMessage}`.toLowerCase();

  if (
    searchable.includes("prepayment credits are depleted") ||
    searchable.includes("prepay credit balance")
  ) {
    return {
      message:
        "Gemini API đã hết credit trả trước. Hãy nạp credit cho đúng project tại https://ai.studio/projects rồi thử lại.",
      status: 402,
    };
  }

  if (
    searchable.includes("credit_balance_exhausted") ||
    searchable.includes("no credits remaining")
  ) {
    return {
      message:
        "OpenAI API đã hết credit. Hãy nạp credit trong OpenAI Billing hoặc chọn Gemini 3.1 Flash Image để tiếp tục.",
      status: 402,
    };
  }

  if (
    searchable.includes("api_key_invalid") ||
    searchable.includes("invalid api key") ||
    status === 401
  ) {
    return {
      message:
        "API key tạo ảnh không hợp lệ hoặc đã bị thu hồi. Hãy cập nhật key trong file .env.",
      status: 401,
    };
  }

  if (status === 403 || searchable.includes("permission_denied")) {
    return {
      message:
        "API key chưa có quyền dùng model tạo ảnh này. Hãy kiểm tra quyền dự án, billing và xác minh tổ chức của provider.",
      status: 403,
    };
  }

  if (
    status === 429 ||
    searchable.includes("resource_exhausted") ||
    searchable.includes("rate limit")
  ) {
    return {
      message:
        "API tạo ảnh đã chạm giới hạn quota hoặc tốc độ. Hãy chờ một lúc rồi thử lại.",
      status: 429,
    };
  }

  if (status === 404 || searchable.includes("not_found")) {
    return {
      message:
        "Model tạo ảnh không tồn tại hoặc chưa khả dụng với API key hiện tại.",
      status: 404,
    };
  }

  if (
    searchable.includes("fetch failed") ||
    searchable.includes("etimedout") ||
    searchable.includes("econnreset") ||
    searchable.includes("socket hang up") ||
    searchable.includes("operation was aborted") ||
    searchable.includes("aborterror")
  ) {
    return {
      message:
        "Kết nối tới API tạo ảnh bị gián đoạn hoặc hết thời gian chờ. Hệ thống đã dừng lần chạy này; hãy thử lại.",
      status: 502,
    };
  }

  if (
    searchable.includes("không trả về dữ liệu ảnh") ||
    searchable.includes("not an image")
  ) {
    return {
      message: rawMessage,
      status: 502,
    };
  }

  return null;
}

function safeFileStem(value: string) {
  return (
    value
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "product"
  );
}

function configuredImageQuality(): MockupImageQuality {
  const configured = process.env.OPENAI_IMAGE_QUALITY?.trim().toLowerCase();
  return configured === "low" || configured === "high" ? configured : "medium";
}

function configuredOpenAITimeout() {
  const parsed = Number(process.env.OPENAI_IMAGE_TIMEOUT_MS || 120_000);
  return Number.isFinite(parsed)
    ? Math.min(240_000, Math.max(30_000, Math.round(parsed)))
    : 120_000;
}

function configuredGeminiTimeout() {
  const parsed = Number(process.env.GEMINI_IMAGE_TIMEOUT_MS || 90_000);
  return Number.isFinite(parsed)
    ? Math.min(120_000, Math.max(30_000, Math.round(parsed)))
    : 90_000;
}

function configuredGeminiRetryAttempts() {
  const parsed = Number(process.env.GEMINI_IMAGE_RETRY_ATTEMPTS || 2);
  return Number.isFinite(parsed)
    ? Math.min(2, Math.max(1, Math.round(parsed)))
    : 2;
}

function configuredConcurrency(model: MockupModel) {
  const isGeminiImage =
    model === "gemini-3.1-flash-image" || model === "gemini-3-pro-image";
  const configured = isGeminiImage
    ? process.env.GEMINI_IMAGE_CONCURRENCY
    : process.env.IMAGE_GENERATION_CONCURRENCY;
  const fallback = isGeminiImage ? 1 : 3;
  const parsed = Number(configured || fallback);
  return Number.isFinite(parsed)
    ? Math.min(6, Math.max(1, Math.round(parsed)))
    : fallback;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

async function renderGraphicMockup(
  promptKey: string,
  params: {
    sku: string;
    itemName: string;
    dimensions: Dimensions3D;
    base64Design: string;
  },
): Promise<Buffer> {
  const { sku, itemName, dimensions, base64Design } = params;

  let bgGradient = "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)";
  let titleBadge = "DIMENSIONS 3D";
  let sceneDesc = `Dimensions: ${dimensions.formatted}`;

  if (promptKey === "dimensions_3d") {
    bgGradient = "linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)";
    titleBadge = "INSPECTION & 3D DIMENSIONS";
    sceneDesc = `Length: ${dimensions.length} | Width: ${dimensions.width} | Thickness: ${dimensions.thickness}`;
  } else if (promptKey === "gift_box") {
    bgGradient = "linear-gradient(135deg, #450a0a 0%, #881337 100%)";
    titleBadge = "PREMIUM GIFT BOX MOCKUP";
    sceneDesc = "Luxury Velvet Holiday Gift Box Presentation";
  } else if (promptKey === "tree_view1") {
    bgGradient = "linear-gradient(135deg, #064e3b 0%, #022c22 100%)";
    titleBadge = "CHRISTMAS TREE MOCKUP #1";
    sceneDesc = "Festive Pine Tree Decoration with Golden Lights";
  } else if (promptKey === "tree_view2") {
    bgGradient = "linear-gradient(135deg, #14532d 0%, #065f46 100%)";
    titleBadge = "CHRISTMAS TREE MOCKUP #2";
    sceneDesc = "Cozy Fireplace & Snow Pine Macro View";
  } else if (promptKey === "gifting_hands") {
    bgGradient = "linear-gradient(135deg, #7c2d12 0%, #451a03 100%)";
    titleBadge = "GIFTING & HANDOVER MOCKUP";
    sceneDesc = "Warm Holiday Gift Exchange Scene";
  } else if (promptKey === "car_mirror") {
    bgGradient = "linear-gradient(135deg, #1c1917 0%, #0c0a09 100%)";
    titleBadge = "CAR REARVIEW MIRROR MOCKUP";
    sceneDesc = "Automotive Hanging Ornament View";
  }

  const svg = `
  <svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${bgGradient.includes("#1e293b") ? "#1e293b" : bgGradient.includes("#450a0a") ? "#450a0a" : bgGradient.includes("#064e3b") ? "#064e3b" : bgGradient.includes("#14532d") ? "#14532d" : bgGradient.includes("#7c2d12") ? "#7c2d12" : "#1c1917"}" />
        <stop offset="100%" stop-color="${bgGradient.includes("#0f172a") ? "#0f172a" : bgGradient.includes("#881337") ? "#881337" : bgGradient.includes("#022c22") ? "#022c22" : bgGradient.includes("#065f46") ? "#065f46" : bgGradient.includes("#451a03") ? "#451a03" : "#0c0a09"}" />
      </linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="16" stdDeviation="24" flood-color="#000000" flood-opacity="0.6"/>
      </filter>
      <radialGradient id="glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.3"/>
        <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
      <clipPath id="circleClip">
        <circle cx="512" cy="480" r="280"/>
      </clipPath>
    </defs>

    <!-- Background -->
    <rect width="1024" height="1024" fill="url(#bg)"/>
    <circle cx="512" cy="480" r="400" fill="url(#glow)"/>

    <!-- Decorative Bokeh -->
    <circle cx="200" cy="200" r="40" fill="#fef08a" opacity="0.2"/>
    <circle cx="800" cy="250" r="60" fill="#fef08a" opacity="0.15"/>
    <circle cx="850" cy="700" r="50" fill="#fef08a" opacity="0.2"/>
    <circle cx="150" cy="750" r="45" fill="#fef08a" opacity="0.1"/>

    <!-- Header Badge -->
    <rect x="262" y="50" width="500" height="44" rx="22" fill="#38bdf8" opacity="0.15"/>
    <text x="512" y="78" text-anchor="middle" fill="#38bdf8" font-family="system-ui, sans-serif" font-size="16" font-weight="700" letter-spacing="2">${escapeXml(titleBadge)}</text>

    <text x="512" y="125" text-anchor="middle" fill="#ffffff" font-family="system-ui, sans-serif" font-size="28" font-weight="800">${escapeXml(itemName)}</text>
    <text x="512" y="155" text-anchor="middle" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="18" font-weight="500">SKU: ${escapeXml(sku)}</text>

    <!-- Glass Bevel Bezel Outer Ring -->
    <circle cx="512" cy="480" r="290" fill="none" stroke="#ffffff" stroke-width="8" opacity="0.8" filter="url(#shadow)"/>
    <circle cx="512" cy="480" r="286" fill="none" stroke="#cbd5e1" stroke-width="3" opacity="0.9"/>
    
    <!-- Hanging Ribbon Loop -->
    <rect x="496" y="160" width="32" height="50" rx="4" fill="#f8fafc" opacity="0.9"/>
    <circle cx="512" cy="205" r="8" fill="#cbd5e1"/>

    <!-- Embedded Artwork -->
    <g clip-path="url(#circleClip)">
      <image href="data:image/png;base64,${base64Design}" x="232" y="200" width="560" height="560" preserveAspectRatio="xMidYMid slice"/>
    </g>

    <!-- Bevel Glass Shine Overlay -->
    <circle cx="512" cy="480" r="280" fill="none" stroke="url(#glow)" stroke-width="20" opacity="0.6"/>

    ${
      promptKey === "dimensions_3d"
        ? `
      <!-- Dimension Overlay Arrows & Callouts -->
      <line x1="200" y1="800" x2="824" y2="800" stroke="#38bdf8" stroke-width="3" stroke-dasharray="6 6"/>
      <line x1="200" y1="785" x2="200" y2="815" stroke="#38bdf8" stroke-width="3"/>
      <line x1="824" y1="785" x2="824" y2="815" stroke="#38bdf8" stroke-width="3"/>
      <rect x="412" y="776" width="200" height="48" rx="8" fill="#0f172a" stroke="#38bdf8" stroke-width="2"/>
      <text x="512" y="806" text-anchor="middle" fill="#38bdf8" font-family="system-ui, sans-serif" font-size="20" font-weight="700">W: ${escapeXml(dimensions.width)}</text>

      <line x1="860" y1="190" x2="860" y2="770" stroke="#38bdf8" stroke-width="3" stroke-dasharray="6 6"/>
      <line x1="845" y1="190" x2="875" y2="190" stroke="#38bdf8" stroke-width="3"/>
      <line x1="845" y1="770" x2="875" y2="770" stroke="#38bdf8" stroke-width="3"/>
      <rect x="880" y="456" width="120" height="48" rx="8" fill="#0f172a" stroke="#38bdf8" stroke-width="2"/>
      <text x="940" y="486" text-anchor="middle" fill="#38bdf8" font-family="system-ui, sans-serif" font-size="18" font-weight="700">H: ${escapeXml(dimensions.length)}</text>

      <rect x="50" y="456" width="140" height="48" rx="8" fill="#0f172a" stroke="#f43f5e" stroke-width="2"/>
      <text x="120" y="486" text-anchor="middle" fill="#f43f5e" font-family="system-ui, sans-serif" font-size="18" font-weight="700">Dày: ${escapeXml(dimensions.thickness)}</text>
    `
        : ""
    }

    <!-- Bottom Description Footer -->
    <rect x="112" y="900" width="800" height="70" rx="16" fill="#090d16" opacity="0.8" stroke="#334155" stroke-width="1.5"/>
    <text x="512" y="932" text-anchor="middle" fill="#f1f5f9" font-family="system-ui, sans-serif" font-size="20" font-weight="700">${escapeXml(sceneDesc)}</text>
    <text x="512" y="955" text-anchor="middle" fill="#64748b" font-family="system-ui, sans-serif" font-size="14">AI Auto Mockup Generator • Listing Desk Platform</text>
  </svg>
  `;

  // Rasterize SVG into crisp 1024x1024 PNG binary image
  return await sharp(Buffer.from(svg)).png().toBuffer();
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
