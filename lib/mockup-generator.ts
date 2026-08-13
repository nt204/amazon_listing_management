import OpenAI, { toFile } from "openai";
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import type { Dimensions3D } from "./trello";
import { detectRasterImageMimeType } from "./image-processing";
import { generateChatGPTWebImage } from "./chatgpt-web-automation";

export type MockupModel =
  | "gpt-image-2"
  | "gpt-image-2-c"
  | "gpt-image-1.5"
  | "gemini-3.1-flash-image"
  | "gemini-3-pro-image"
  | "fast-graphic"
  | "chatgpt-web-automation";

export type MockupImageQuality = "low" | "medium" | "high";

export interface MockupResult {
  index: number;
  name: string;
  type: string;
  buffer: Buffer;
  mimeType: string;
  description: string;
  providerTrace?: {
    provider: "openai" | "cheapkeyai";
    requestId: string | null;
    model: MockupModel;
    quality: MockupImageQuality;
    size: string;
    imageCount: 1;
    inputFidelity: "low" | "high" | null;
    /** Fixed provider price or an estimate from response usage, in USD. */
    estimatedCostUsd: number | null;
    usage: {
      inputTokens: number;
      inputImageTokens: number;
      inputTextTokens: number;
      outputTokens: number;
      totalTokens: number;
    } | null;
  };
}

export interface GenerateMockupsOptions {
  sku: string;
  itemName: string;
  dimensions: Dimensions3D;
  inputDesignBuffer: Buffer;
  inputMimeType: string;
  model?: MockupModel;
  quality?: MockupImageQuality;
  /** Test seam; production creates the client from the selected image provider key. */
  openaiClient?: OpenAI;
  /** Test seam; production creates the client from GEMINI_API_KEY. */
  geminiClient?: GoogleGenAI;
  /** Mockup indexes already stored by the caller and safe to resume past. */
  skipIndexes?: readonly number[];
  /** Specific mockup indexes selected by user to generate. */
  selectedIndexes?: readonly number[];
  /** Called immediately after each AI image is ready, before the next image starts. */
  onMockupReady?: (mockup: MockupResult) => Promise<void> | void;
}

export type MockupProgressCallback = (
  step: number,
  name: string,
  status: "processing" | "success",
) => void;

const DEFAULT_IMAGE_MODEL: MockupModel = "gpt-image-1.5";
const OPENAI_IMAGE_SIZE = "1024x1024";
const OPENAI_INPUT_LIMIT_BYTES = 50 * 1024 * 1024;
const CHEAPKEYAI_GPT_IMAGE_2_PRICE_USD = 0.005;

export function isOpenAIImageModel(model: MockupModel) {
  return model === "gpt-image-2" || model === "gpt-image-1.5";
}

export function isCheapKeyAIImageModel(model: MockupModel) {
  return model === "gpt-image-2-c";
}

export function isImageApiModel(model: MockupModel) {
  return isOpenAIImageModel(model) || isCheapKeyAIImageModel(model);
}

export function isChatGPTWebModel(model: MockupModel) {
  return model === "chatgpt-web-automation";
}

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
      "Ảnh sản phẩm treo trang trí trên gương chiếu hậu kính ô Tô sang trọng.",
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

  // Mockup 1: 3D Dimensions Graphic with thickness callout
  progressCallback?.(1, MOCKUP_TYPES[0].name, "processing");
  const mockup1Buffer = await renderGraphicMockup("dimensions_3d", {
    sku,
    itemName,
    dimensions,
    base64Design,
  });
  const mockup1: MockupResult = {
    index: 1,
    name: MOCKUP_TYPES[0].name,
    type: MOCKUP_TYPES[0].fileName,
    buffer: mockup1Buffer,
    mimeType: "image/png",
    description: MOCKUP_TYPES[0].description,
  };
  progressCallback?.(1, MOCKUP_TYPES[0].name, "success");

  const openaiApiKey = process.env.OPENAI_API_KEY;
  const cheapKeyAIApiKey = process.env.CHEAPKEYAI_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  let openaiClient = options.openaiClient || null;
  let openaiInput: Awaited<ReturnType<typeof toFile>> | null = null;
  if (isImageApiModel(model)) {
    if (!openaiClient) {
      if (isCheapKeyAIImageModel(model)) {
        if (!cheapKeyAIApiKey?.trim()) {
          throw new Error(
            "CHEAPKEYAI_API_KEY chưa được cấu hình để tạo mockup bằng gpt-image-2-c.",
          );
        }
        openaiClient = new OpenAI({
          apiKey: cheapKeyAIApiKey,
          baseURL: configuredCheapKeyAIBaseUrl(),
        });
      } else if (!openaiApiKey?.trim()) {
        throw new Error(
          "OPENAI_API_KEY chưa được cấu hình để tạo mockup bằng ChatGPT Image.",
        );
      } else {
        openaiClient = new OpenAI({ apiKey: openaiApiKey });
      }
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

  const selectedIndexesSet = options.selectedIndexes
    ? new Set(options.selectedIndexes)
    : null;

  const targetMockups = MOCKUP_TYPES.slice(1).filter((meta) => {
    if (skippedIndexes.has(meta.index)) return false;
    if (selectedIndexesSet && !selectedIndexesSet.has(meta.index)) return false;
    return true;
  });

  const generatedResults = await mapWithConcurrency(
    targetMockups,
    configuredConcurrency(model),
    async (meta) => {
      progressCallback?.(meta.index, meta.name, "processing");

      let mockupBuffer: Buffer;
      let providerTrace: MockupResult["providerTrace"];

      if (isImageApiModel(model) && openaiClient && openaiInput) {
        const prompt = buildMockupPrompt(meta.promptKey, itemName, dimensions);
        const usesCheapKeyAI = isCheapKeyAIImageModel(model);
        // Output quality and source fidelity are independent. CheapKeyAI bills
        // GPT Image 2 per image, so preserve the uploaded artwork at high
        // fidelity even when the requested output quality is low.
        const inputFidelity =
          usesCheapKeyAI
            ? "high"
            : model === "gpt-image-1.5"
            ? quality === "low"
              ? "low"
              : "high"
            : null;
        console.info(
          "[Image API edit attempt]",
          JSON.stringify({
            mockupIndex: meta.index,
            provider: isCheapKeyAIImageModel(model)
              ? "cheapkeyai"
              : "openai",
            model,
            quality,
            size: OPENAI_IMAGE_SIZE,
            imageCount: 1,
            inputFidelity,
          }),
        );
        const upstreamModel = usesCheapKeyAI
          ? process.env.CHEAPKEYAI_UPSTREAM_MODEL?.trim() || model
          : model;
        const response = await openaiClient.images.edit(
          {
            model: upstreamModel,
            image: openaiInput,
            prompt,
            n: 1,
            size: OPENAI_IMAGE_SIZE,
            quality,
            input_fidelity: inputFidelity || undefined,
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
          throw new Error(
            `Provider tạo ảnh không trả về dữ liệu ảnh cho ${meta.name}.`,
          );
        }
        const usage = response.usage;
        const inputImageTokens = usage?.input_tokens_details?.image_tokens || 0;
        const inputTextTokens = usage
          ? (usage.input_tokens_details?.text_tokens ??
            Math.max(0, usage.input_tokens - inputImageTokens))
          : 0;
        const outputTokens = usage?.output_tokens || 0;
        providerTrace = {
          provider: isCheapKeyAIImageModel(model) ? "cheapkeyai" : "openai",
          requestId: response?._request_id || null,
          model,
          quality,
          size: response?.size || OPENAI_IMAGE_SIZE,
          imageCount: 1,
          inputFidelity,
          estimatedCostUsd: usesCheapKeyAI
            ? CHEAPKEYAI_GPT_IMAGE_2_PRICE_USD
            : usage
              ? Number(
                  (
                    (inputTextTokens * 5 +
                      inputImageTokens * 8 +
                      outputTokens * (model === "gpt-image-2" ? 30 : 32)) /
                    1_000_000
                  ).toFixed(6),
                )
              : null,
          usage: usage
            ? {
              inputTokens: usage.input_tokens,
              inputImageTokens,
              inputTextTokens,
              outputTokens,
              totalTokens: usage.total_tokens,
            }
            : null,
        };
        console.info(
          "[Image API edit]",
          JSON.stringify({
            mockupIndex: meta.index,
            ...providerTrace,
          }),
        );
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
      } else if (isChatGPTWebModel(model)) {
        const prompt = buildMockupPrompt(meta.promptKey, itemName, dimensions);
        console.info(`[ChatGPT Web Automation] Generating ${meta.name} with prompt: ${prompt.substring(0, 100)}...`);
        mockupBuffer = await generateChatGPTWebImage(prompt, { inputImageBuffer: normalizedDesignBuffer });
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
        await validateGeneratedMockup(mockupBuffer),
        providerTrace,
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
  let concept: string;
  switch (promptKey) {
    case "dimensions_3d":
      concept = `Product Size & Thickness Infographic Photography.
- Hand holding white satin ribbon hanging loop at top against warm golden holiday bokeh background.
- Water-clear transparent crystal glass disc ornament.
- Vertical dashed white dimension line on the right side labeled "${dimensions.length}".
- Horizontal dashed white dimension line at the bottom labeled "${dimensions.width}".
- Callout pointer box at top right corner pointing to thick faceted bevel edge labeled "Thickness ${dimensions.thickness}".
- Bold white serif text at bottom center reading "PRODUCT SIZE".`;
      break;
    case "gift_box":
      concept =
        "Sản phẩm nằm bên trong một HỘP QUÀ MÀU ĐỎ SANG TRỌNG đang mở (open RED GIFT BOX), lót vải lụa trắng satin sáng bóng (soft white satin lining).";
      break;
    case "tree_view1":
      concept = "Sản phẩm treo trên nhánh cây thông xanh tươi.";
      break;
    case "tree_view2":
      concept =
        "Sản phẩm treo trên cây thông trong phòng khách tươi sáng, nền trắng và xanh tươi.";
      break;
    case "gifting_hands":
      concept = "Hai người trao tặng sản phẩm cho nhau trong không gian sáng, sạch.";
      break;
    case "car_mirror":
      concept =
        "Sản phẩm treo trên gương chiếu hậu của ô tô vào ban ngày, ngoài cửa kính là cây xanh và bầu trời sáng.";
      break;
    default:
      concept = "Ảnh mockup sản phẩm.";
  }

  const dimensionsLine =
    promptKey === "dimensions_3d"
      ? `\n\nKích thước 3 chiều: ${dimensions.formatted}.`
      : "";

  return `Sử dụng Ảnh 1 làm ảnh tham chiếu cho sản phẩm "${itemName}".

Quan sát Ảnh 1 để nhận diện chính xác:
- hình dáng và tỷ lệ sản phẩm
- thiết kế in
- chữ và typography
- các hình minh họa
- màu sắc của CÁC CHI TIẾT ĐƯỢC IN
- lỗ treo và dây treo

QUAN TRỌNG VỀ CHẤT LIỆU VÀ ĐỘ TRONG SUỐT (100% WATER-CLEAR GLASS):
Sản phẩm được làm từ acrylic / glass 100% TRONG SUỐT, KHÔNG MÀU, có độ trong quang học cao như pha lê (water-clear optical crystal).

LƯU Ý NGUYÊN TẮC QUAN TRỌNG:
- Màu nâu, vàng, cam hoặc bất kỳ màu đĩa nền nào trong Ảnh 1 KHÔNG PHẢI MÀU CỦA IN và TUYỆT ĐỐI KHÔNG ĐƯỢC GIỮ LẠI.
- Loại bỏ hoàn toàn mảng đĩa tròn màu nâu phía sau.
- Tất cả các vùng không được in PHẢI HOÀN TOÀN TRONG SUỐT, NHÌN XUYÊN THỦNG QUA MÔI TRƯỜNG BACKGROUND MỚI.
- Phải thấy rõ background mới (Hộp quà màu đỏ / Cây thông xanh / Phòng khách) hiện lên trực tiếp phía sau đĩa sản phẩm trong suốt.
- Chỉ các chữ, nét vẽ và chi tiết thiết kế thực sự mới có màu in trên bề mặt kính.

Các vùng không được in phải:
- trong suốt, không màu và rất trong trẻo
- nhìn rõ BACKGROUND MỚI xuyên qua
- có cảm giác giống crystal/glass cao cấp
- có độ sâu và khúc xạ ánh sáng tự nhiên
- không bị đục, mờ, matte hoặc smoky

CẠNH SẢN PHẨM:
Tạo cạnh acrylic dày, trong suốt và được đánh bóng cao.
Cạnh vát/faceted bevel phải bắt sáng mạnh như crystal.
Tạo các highlight trắng sắc nét trên cạnh.
Có refraction, specular reflections và các điểm lóe sáng nhỏ tự nhiên.
Các cạnh có thể tạo subtle rainbow/prismatic reflections khi bắt sáng.

ÁNH SÁNG:
Sử dụng phong cách chụp sản phẩm high-key, sáng và sạch.
Có soft white backlight chiếu xuyên qua acrylic và bright clean rim lighting quanh cạnh sản phẩm.
Có những điểm specular highlight trắng sáng và crisp trên bề mặt và cạnh.
Sản phẩm phải có cảm giác luminous, glossy, sparkling và crystal-clear.
Không dùng ánh sáng vàng, amber, orange, muddy hoặc phủ màu nâu lên toàn bộ sản phẩm.

BACKGROUND:
Bối cảnh phía sau sản phẩm phải sáng, mềm và có shallow depth of field.
Bokeh nên là soft white bokeh hoặc light green bokeh.
Không đặt một mảng cây tối hoặc vật thể tối phủ kín ngay phía sau toàn bộ sản phẩm.
Cành cây có thể xuất hiện xung quanh sản phẩm nhưng không làm phần acrylic trung tâm trở nên tối hoặc đục.

Giữ thiết kế in rõ nét và trung thành với ảnh tham chiếu.
Không tự ý thay đổi nội dung chữ, hình minh họa hoặc bố cục thiết kế.

Mục tiêu hình ảnh:
premium commercial product photography,
water-clear colorless acrylic,
high optical clarity,
polished faceted edges,
strong clean white specular highlights,
bright white rim light,
realistic light refraction,
subtle prismatic reflections,
sparkling crystal appearance,
bright white and fresh green bokeh background,
luxurious glossy finish.

Concept: ${concept}${dimensionsLine}`;
}


function mockupResult(
  meta: (typeof MOCKUP_TYPES)[number],
  image: { buffer: Buffer; mimeType: string; extension: string },
  providerTrace?: MockupResult["providerTrace"],
): MockupResult {
  return {
    index: meta.index,
    name: meta.name,
    type: meta.fileName.replace(/\.[A-Za-z0-9]+$/, image.extension),
    buffer: image.buffer,
    mimeType: image.mimeType,
    description: meta.description,
    providerTrace,
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
      "Ảnh thiết kế vượt quá giới hạn 50 MB của Image API.",
    );
  }
  return normalized;
}

async function validateGeneratedMockup(input: Buffer): Promise<{
  buffer: Buffer;
  mimeType: string;
  extension: string;
}> {
  try {
    // Validate the provider payload, then retain those exact bytes. Re-encoding
    // an already generated image cannot add detail and may lose quality.
    await sharp(input, { failOn: "warning" }).metadata();
    const mimeType = detectRasterImageMimeType(input);
    return {
      buffer: input,
      mimeType,
      extension:
        mimeType === "image/png"
          ? ".png"
          : mimeType === "image/webp"
            ? ".webp"
            : ".jpg",
    };
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
    error instanceof Error
      ? error.message
      : typeof record.message === "string"
        ? record.message
        : String(error || "");
  const searchable = `${code} ${type} ${rawMessage}`.toLowerCase();

  if (
    code === "get_channel_failed" ||
    searchable.includes("no available channel") ||
    searchable.includes("可用渠道不存在") ||
    searchable.includes("无可用渠道")
  ) {
    const requestId = rawMessage.match(/request id:\s*([^\s)]+)/i)?.[1];
    return {
      message: `CheapKeyAI chưa có channel khả dụng cho gpt-image-2 trong group của API key này. Hãy đổi/tạo key ở đúng group hoặc gửi${
        requestId ? ` request ID ${requestId}` : " request ID trong log"
      } cho CheapKeyAI support; hệ thống không fallback sang model khác.`,
      status: 503,
    };
  }

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
    status === 402 ||
    searchable.includes("insufficient balance") ||
    searchable.includes("insufficient credit")
  ) {
    return {
      message:
        "Tài khoản API provider đã hết số dư. Hãy nạp thêm credit cho đúng tài khoản/key rồi thử lại.",
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

  if (
    status === 404 ||
    searchable.includes("not_found") ||
    searchable.includes("model not found") ||
    searchable.includes("has no access to model")
  ) {
    return {
      message:
        "Model tạo ảnh không tồn tại hoặc API key CheapKeyAI chưa được mở quyền cho model này (chọn All Models khi tạo key).",
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
  return configured === "medium" || configured === "high" ? configured : "low";
}

function configuredOpenAITimeout() {
  const parsed = Number(process.env.OPENAI_IMAGE_TIMEOUT_MS || 120_000);
  return Number.isFinite(parsed)
    ? Math.min(240_000, Math.max(30_000, Math.round(parsed)))
    : 120_000;
}

function configuredCheapKeyAIBaseUrl() {
  return (
    process.env.CHEAPKEYAI_BASE_URL?.trim().replace(/\/+$/, "") ||
    "https://cheapkeyai.shop/v1"
  );
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
  if (model === "chatgpt-web-automation") return 1;
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
  let hasError = false;
  let firstError: unknown;

  async function worker() {
    while (!hasError && cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await mapper(items[index], index);
      } catch (error) {
        if (!hasError) {
          hasError = true;
          firstError = error;
        }
        return;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  if (hasError) throw firstError;
  return results;
}

export async function renderGraphicMockup(
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
    bgGradient = "linear-gradient(135deg, #1c150c 0%, #3d2612 50%, #170d06 100%)";
    titleBadge = "PRODUCT SIZE INFOGRAPHIC";
    sceneDesc = `Product Dimensions: ${dimensions.formatted}`;
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

    <!-- Decorative Warm Golden Bokeh (Matching Sample Image 1) -->
    <circle cx="240" cy="220" r="55" fill="#f97316" opacity="0.35"/>
    <circle cx="310" cy="180" r="45" fill="#eab308" opacity="0.4"/>
    <circle cx="730" cy="190" r="60" fill="#f97316" opacity="0.35"/>
    <circle cx="820" cy="240" r="50" fill="#eab308" opacity="0.3"/>
    <circle cx="120" cy="740" r="65" fill="#f97316" opacity="0.4"/>
    <circle cx="860" cy="720" r="70" fill="#eab308" opacity="0.35"/>

    <!-- Header Badge -->
    <rect x="262" y="50" width="500" height="44" rx="22" fill="#38bdf8" opacity="0.15"/>
    <text x="512" y="78" text-anchor="middle" fill="#38bdf8" font-family="system-ui, sans-serif" font-size="16" font-weight="700" letter-spacing="2">${escapeXml(titleBadge)}</text>

    <text x="512" y="125" text-anchor="middle" fill="#ffffff" font-family="system-ui, sans-serif" font-size="28" font-weight="800">${escapeXml(itemName)}</text>
    <text x="512" y="155" text-anchor="middle" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="18" font-weight="500">SKU: ${escapeXml(sku)}</text>

    <!-- Product Rim Accent -->
    <circle cx="512" cy="480" r="290" fill="none" stroke="#ffffff" stroke-width="8" opacity="0.8" filter="url(#shadow)"/>
    <circle cx="512" cy="480" r="286" fill="none" stroke="#cbd5e1" stroke-width="3" opacity="0.9"/>
    
    <!-- Hanging Ribbon Loop -->
    <rect x="496" y="160" width="32" height="50" rx="4" fill="#f8fafc" opacity="0.9"/>
    <circle cx="512" cy="205" r="8" fill="#cbd5e1"/>

    <!-- Embedded Artwork -->
    <g clip-path="url(#circleClip)">
      <image href="data:image/png;base64,${base64Design}" x="232" y="200" width="560" height="560" preserveAspectRatio="xMidYMid slice"/>
    </g>

    <!-- Subtle Material-Neutral Edge Accent -->
    <circle cx="512" cy="480" r="280" fill="none" stroke="url(#glow)" stroke-width="20" opacity="0.6"/>

    <!-- PRODUCT SIZE Title at Bottom -->
    <text x="512" y="940" text-anchor="middle" fill="#ffffff" font-family="'Times New Roman', Georgia, serif" font-size="44" font-weight="900" letter-spacing="4">PRODUCT SIZE</text>

    ${promptKey === "dimensions_3d"
      ? `
      <!-- Horizontal Width Dimension Line (Bottom) -->
      <line x1="210" y1="810" x2="814" y2="810" stroke="#ffffff" stroke-width="3" stroke-dasharray="8 6"/>
      <line x1="210" y1="795" x2="210" y2="825" stroke="#ffffff" stroke-width="4"/>
      <line x1="814" y1="795" x2="814" y2="825" stroke="#ffffff" stroke-width="4"/>
      <rect x="100" y="786" width="100" height="48" rx="8" fill="#0f172a" opacity="0.8" stroke="#ffffff" stroke-width="1.5"/>
      <text x="150" y="818" text-anchor="middle" fill="#ffffff" font-family="system-ui, sans-serif" font-size="24" font-weight="800">${escapeXml(dimensions.width)}</text>

      <!-- Vertical Height Dimension Line (Right) -->
      <line x1="850" y1="210" x2="850" y2="760" stroke="#ffffff" stroke-width="3" stroke-dasharray="8 6"/>
      <line x1="835" y1="210" x2="865" y2="210" stroke="#ffffff" stroke-width="4"/>
      <line x1="835" y1="760" x2="865" y2="760" stroke="#ffffff" stroke-width="4"/>
      <rect x="872" y="320" width="100" height="48" rx="8" fill="#0f172a" opacity="0.8" stroke="#ffffff" stroke-width="1.5"/>
      <text x="922" y="352" text-anchor="middle" fill="#ffffff" font-family="system-ui, sans-serif" font-size="24" font-weight="800">${escapeXml(dimensions.length)}</text>

      <!-- Top Right Corner Thickness Callout Box -->
      <line x1="770" y1="230" x2="710" y2="280" stroke="#ef4444" stroke-width="3"/>
      <circle cx="710" cy="280" r="6" fill="#ef4444"/>
      <rect x="755" y="170" width="200" height="65" rx="12" fill="#0f172a" stroke="#ef4444" stroke-width="2.5" filter="url(#shadow)"/>
      <text x="855" y="196" text-anchor="middle" fill="#94a3b8" font-family="'Times New Roman', Georgia, serif" font-size="16" font-weight="700">Thickness</text>
      <text x="855" y="224" text-anchor="middle" fill="#ef4444" font-family="system-ui, sans-serif" font-size="20" font-weight="800">${escapeXml(dimensions.thickness)}</text>
    `
      : ""
    }
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
