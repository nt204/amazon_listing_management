import OpenAI, { toFile } from "openai";
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import type { Dimensions3D } from "./trello";
import { detectRasterImageMimeType } from "./image-processing";
import { generateChatGPTWebImage } from "./chatgpt-web-automation";

import {
  MAX_AI_MOCKUPS_PER_PRODUCT,
  type MockupModel,
  type MockupImageQuality,
  mockupIndexFromAttachmentName,
} from "./mockup-types";
import { getBulletTumblerConcept } from "./mockup-bullet-tumbler-prompts";
import { getSlatePlateConcept } from "./mockup-slate-plate-prompts";

export * from "./mockup-types";

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
  /** Product details from the source card, including material when available. */
  productContext?: string;
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
  /** User-defined scene concepts, beginning at index 11. */
  customMockups?: readonly { id: number; label: string; promptKey?: string; customPrompt?: string }[];
  /** Optional custom user refinement prompt notes per mockup index. */
  customRefinementNotes?: Record<number, string>;
  /** Cancels queued/provider work when the browser disconnects or the user stops the job. */
  signal?: AbortSignal;
  /** Shared provider semaphore supplied by the API route. */
  acquireImageSlot?: (
    signal?: AbortSignal,
    pool?: "cheapkeyai" | "openai" | "gemini" | "chatgpt-web" | "default",
  ) => Promise<{ release(): Promise<void> }>;
  /** Called immediately after each AI image is ready, before the next image starts. */
  onMockupReady?: (mockup: MockupResult) => Promise<void> | void;
}

export type MockupProgressCallback = (
  step: number,
  name: string,
  status: "processing" | "success",
) => void;

const DEFAULT_IMAGE_MODEL: MockupModel = "gpt-image-2-cheapkey";
const OPENAI_IMAGE_SIZE = "1024x1024";
const OPENAI_INPUT_LIMIT_BYTES = 50 * 1024 * 1024;
const CHEAPKEYAI_GPT_IMAGE_2_PRICE_USD = 0.005;

export function isOpenAIImageModel(model: MockupModel) {
  return model === "gpt-image-2" || model === "gpt-image-1.5";
}

export function isCheapKeyAIImageModel(model: MockupModel) {
  return model === "gpt-image-2-c" || model === "gpt-image-2-cheapkey";
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
      "Ảnh flat-lay ornament và đầy đủ phụ kiện đóng gói trong hộp quà đỏ.",
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
    name: "Mockup 5 - Pine Branch & Bokeh (Ảnh Treo Cành Thông & Đèn Bokeh)",
    fileName: "Mockup5_Pine_Branch_Bokeh.png",
    promptKey: "tree_view2",
    description:
      "Ảnh cận cảnh treo trên cành thông xanh tươi với dây đay, quả thông, quả mọng đỏ và nền đèn bokeh Giáng sinh lung linh.",
  },
  {
    index: 6,
    name: "Mockup 6 - Gifting Handshake (Ảnh Đưa Tay Tặng Nhau)",
    fileName: "Mockup6_Gifting_Hands.png",
    promptKey: "gifting_hands",
    description:
      "Ảnh cận cảnh hai bàn tay trao ornament bằng dây treo với thông điệp Perfect Gift Idea.",
  },
  {
    index: 7,
    name: "Mockup 7 - Car Rearview Mirror (Ảnh Treo Kính Ô Tô)",
    fileName: "Mockup7_Car_Mirror.png",
    promptKey: "car_mirror",
    description:
      "Ảnh sản phẩm treo trang trí trên gương chiếu hậu kính ô Tô sang trọng.",
  },
  {
    index: 8,
    name: "Mockup 8 - Sunlit Glass Refraction (Ảnh Thủy Tinh Chiếu Ánh Sáng Sunburst)",
    fileName: "Mockup8_Sunlit_Glass_Refraction.png",
    promptKey: "glass_sunburst",
    description:
      "Ảnh sản phẩm thủy tinh / glass ornament đặt trong ánh nắng tự nhiên lung linh, chiếu hiệu ứng sunburst và vạt khúc xạ ánh sáng lấp lánh.",
  },
  {
    index: 9,
    name: "Mockup 9 - Product Thickness Callout (Ảnh Góc Nghiêng Thấp & Cận Cảnh Độ Dày 3D)",
    fileName: "Mockup9_Product_Thickness_Callout.png",
    promptKey: "glass_thickness_callout",
    description:
      "Ảnh chụp góc thấp 3D đặc tả độ nghiêng foreshortened, độ dày cạnh viền và lớp 3D sản phẩm với đường chỉ chú thích 6mm thickness.",
  },
  {
    index: 10,
    name: "Mockup 10 - Wood Tabletop Flat-Lay with Pine (Ảnh Flat-Lay Mặt Bàn Gỗ & Nhánh Thông Noel)",
    fileName: "Mockup10_Wood_Flatlay_Pine.png",
    promptKey: "wood_flatlay_pine",
    description:
      "Ảnh chụp góc thẳng từ trên xuống (flat-lay) sản phẩm nằm trên mặt bàn gỗ tự nhiên, trang trí nhánh thông xanh ở mép trái và hiệu ứng trong suốt nhìn xuyên nền gỗ.",
  },
  {
    index: 11,
    name: "Mockup 11 - 2-Layer Wooden Ornament Breakdown (Ảnh Tách Lớp Gỗ 3D Layer 1 + Layer 2)",
    fileName: "Mockup11_2Layer_Wood_Breakdown.png",
    promptKey: "ornament_2layer_breakdown",
    description:
      "Ảnh infographic tách chi tiết 2 lớp gỗ sản phẩm (Layer 1 + Layer 2) kèm chỉ dẫn độ dày 6mm góc nghiêng 3D.",
  },
];

export async function generateAllMockups(
  options: GenerateMockupsOptions,
  progressCallback?: MockupProgressCallback,
): Promise<MockupResult[]> {
  const {
    sku,
    itemName,
    productContext,
    dimensions,
    inputDesignBuffer,
    model = DEFAULT_IMAGE_MODEL,
    quality = configuredImageQuality(),
  } = options;
  const skippedIndexes = new Set(options.skipIndexes || []);
  const customMap = new Map((options.customMockups || []).map((c) => [c.id, c]));
  const effectiveMockupTypes = MOCKUP_TYPES.map((defaultType) => {
    const custom = customMap.get(defaultType.index);
    if (custom) {
      const effectivePromptKey = custom.customPrompt?.trim()
        ? `custom:${custom.customPrompt.trim()}`
        : (custom.promptKey || defaultType.promptKey);
      return {
        index: defaultType.index,
        name: custom.label.startsWith("Mockup")
          ? custom.label
          : `Mockup ${defaultType.index} - ${custom.label.replace(/^Content\s*\d+:\s*/i, "")}`,
        fileName: `Mockup${defaultType.index}_${safeFileStem(custom.label)}.png`,
        promptKey: effectivePromptKey,
        description: `Ảnh mockup: ${custom.label}`,
      };
    }
    return defaultType;
  });

  (options.customMockups || []).forEach((custom) => {
    if (!effectiveMockupTypes.some((t) => t.index === custom.id)) {
      const effectivePromptKey = custom.customPrompt?.trim()
        ? `custom:${custom.customPrompt.trim()}`
        : (custom.promptKey || `custom:${custom.label}`);
      effectiveMockupTypes.push({
        index: custom.id,
        name: custom.label.startsWith("Mockup")
          ? custom.label
          : `Mockup ${custom.id} - ${custom.label.replace(/^Content\s*\d+:\s*/i, "")}`,
        fileName: `Mockup${custom.id}_${safeFileStem(custom.label)}.png`,
        promptKey: effectivePromptKey,
        description: `Ảnh mockup tùy chỉnh: ${custom.label}`,
      });
    }
  });

  throwIfAborted(options.signal);
  const normalizedDesign = await normalizeDesignImage(
    inputDesignBuffer,
    model === "fast-graphic",
  );
  const normalizedDesignBuffer = normalizedDesign.buffer;
  const base64Design = normalizedDesignBuffer.toString("base64");

  const selectedIndexesSet = options.selectedIndexes
    ? new Set([
      ...(options.selectedIndexes.includes(1) ? [1] : []),
      ...Array.from(
        new Set(options.selectedIndexes.filter((index) => index >= 2)),
      ).slice(0, MAX_AI_MOCKUPS_PER_PRODUCT),
    ])
    : null;

  const shouldRenderMockup1 =
    !skippedIndexes.has(1) &&
    (!selectedIndexesSet || selectedIndexesSet.has(1));

  let mockup1: MockupResult | null = null;

  if (shouldRenderMockup1) {
    // Mockup 1: Full Design (Ảnh Gốc Đầu Vào)
    progressCallback?.(1, MOCKUP_TYPES[0].name, "processing");
    mockup1 = {
      index: 1,
      name: MOCKUP_TYPES[0].name,
      type: MOCKUP_TYPES[0].fileName.replace(
        /\.[A-Za-z0-9]+$/,
        normalizedDesign.extension,
      ),
      buffer: normalizedDesignBuffer,
      mimeType: normalizedDesign.mimeType,
      description: MOCKUP_TYPES[0].description,
    };
    progressCallback?.(1, MOCKUP_TYPES[0].name, "success");
    await options.onMockupReady?.(mockup1);
  }

  const openaiApiKey = process.env.OPENAI_API_KEY;
  const cheapKeyAIApiKey =
    process.env.CHEAPKEYAI_IMAGE_API_KEY?.trim() ||
    process.env.CHEAPKEYAI_API_KEY?.trim();
  const geminiApiKey = process.env.GEMINI_API_KEY;

  let openaiClient = options.openaiClient || null;
  let openaiInput: Awaited<ReturnType<typeof toFile>> | null = null;
  if (isImageApiModel(model)) {
    if (!openaiClient) {
      if (isCheapKeyAIImageModel(model)) {
        if (!cheapKeyAIApiKey?.trim()) {
          throw new Error(
            "CHEAPKEYAI_IMAGE_API_KEY hoặc CHEAPKEYAI_API_KEY chưa được cấu hình để tạo mockup bằng gpt-image-2-c.",
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
      `${safeFileStem(sku)}-design${normalizedDesign.extension}`,
      {
        type: normalizedDesign.mimeType,
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

  const targetMockups = effectiveMockupTypes.slice(1).filter((meta) => {
    if (skippedIndexes.has(meta.index)) return false;
    if (selectedIndexesSet) return selectedIndexesSet.has(meta.index);
    return meta.index <= 7;
  });

  const generatedResults = await mapWithConcurrency(
    targetMockups,
    configuredConcurrency(model),
    async (meta) => {
      throwIfAborted(options.signal);
      progressCallback?.(meta.index, meta.name, "processing");

      let mockupBuffer: Buffer;
      let providerTrace: MockupResult["providerTrace"];

      const refinementNote = options.customRefinementNotes?.[meta.index];
      const imagePool = isCheapKeyAIImageModel(model)
        ? "cheapkeyai"
        : model === "gemini-3.1-flash-image" || model === "gemini-3-pro-image"
          ? "gemini"
          : model === "chatgpt-web-automation"
            ? "chatgpt-web"
            : "openai";
      const imageSlot = await options.acquireImageSlot?.(
        options.signal,
        imagePool,
      );

      try {
        if (isImageApiModel(model) && openaiClient && openaiInput) {
        const prompt = buildMockupPrompt(
          meta.promptKey,
          itemName,
          dimensions,
          productContext,
          refinementNote,
        );
        const usesCheapKeyAI = isCheapKeyAIImageModel(model);
        const configuredUpstream = process.env.CHEAPKEYAI_UPSTREAM_MODEL?.trim();
        const primaryUpstreamModel = usesCheapKeyAI
          ? configuredUpstream || (model === "gpt-image-2-cheapkey" ? "gpt-image-2" : model)
          : model;
        const fallbackUpstreamModel =
          usesCheapKeyAI && !configuredUpstream
            ? primaryUpstreamModel === "gpt-image-2"
              ? "gpt-image-2-c"
              : primaryUpstreamModel === "gpt-image-2-c"
                ? "gpt-image-2"
                : null
            : null;

        // GPT Image 2 always uses high input fidelity and rejects this field.
        // Only the GPT Image 1 family accepts input_fidelity.
        const inputFidelity =
          primaryUpstreamModel === "gpt-image-1" || primaryUpstreamModel === "gpt-image-1.5"
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
            model: primaryUpstreamModel,
            fallbackModel: fallbackUpstreamModel,
            quality,
            size: OPENAI_IMAGE_SIZE,
            imageCount: 1,
            inputFidelity,
          }),
        );
        let response;
        let activeModelUsed = primaryUpstreamModel;
        try {
          response = await openaiClient.images.edit(
            {
              model: primaryUpstreamModel,
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
              // CheapKeyAI may fan a retry out to another upstream channel. Do
              // not let the SDK duplicate a slow/overloaded image request too.
              maxRetries: usesCheapKeyAI ? 0 : configuredOpenAIRetries(),
              timeout: configuredOpenAITimeout(),
              signal: options.signal,
            },
          );
        } catch (firstError) {
          throwIfAborted(options.signal);
          if (fallbackUpstreamModel) {
            console.warn(
              `[CheapKeyAI Image Edit] Model ${primaryUpstreamModel} gặp lỗi (${(firstError as Error)?.message || firstError}). Đang tự động fallback sang ${fallbackUpstreamModel}...`,
            );
            activeModelUsed = fallbackUpstreamModel;
            response = await openaiClient.images.edit(
              {
                model: fallbackUpstreamModel,
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
                signal: options.signal,
              },
            );
          } else {
            throw firstError;
          }
        }
        throwIfAborted(options.signal);
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
        const prompt = buildMockupPrompt(
          meta.promptKey,
          itemName,
          dimensions,
          productContext,
          refinementNote,
        );
        const response = await genAI.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                { inlineData: { data: base64Design, mimeType: normalizedDesign.mimeType } },
              ],
            },
          ],
          config: {
            responseModalities: ["IMAGE"],
            abortSignal: options.signal,
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
        throwIfAborted(options.signal);
        const imagePart = response?.candidates?.[0]?.content?.parts?.find(
          (part: { inlineData?: { data?: string } }) => part.inlineData?.data,
        );
        if (!imagePart?.inlineData?.data) {
          throw new Error(`Gemini không trả về dữ liệu ảnh cho ${meta.name}.`);
        }
        mockupBuffer = Buffer.from(imagePart.inlineData.data, "base64");
        } else if (isChatGPTWebModel(model)) {
        const prompt = buildMockupPrompt(
          meta.promptKey,
          itemName,
          dimensions,
          productContext,
          refinementNote,
        );
        console.info(`[ChatGPT Web Automation] Generating ${meta.name} with prompt: ${prompt.substring(0, 100)}...`);
        mockupBuffer = await raceWithSignal(
          generateChatGPTWebImage(prompt, { inputImageBuffer: normalizedDesignBuffer }),
          options.signal,
        );
        } else {
          mockupBuffer = await renderGraphicMockup(meta.promptKey, {
            sku,
            itemName,
            dimensions,
            base64Design,
            base64MimeType: normalizedDesign.mimeType,
          });
        }
      } finally {
        await imageSlot?.release();
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

  const allResults = mockup1 ? [mockup1, ...generatedResults] : generatedResults;
  return allResults.sort((a, b) => a.index - b.index);
}

function applyPromptDimensionPlaceholders(
  prompt: string,
  dimensions: Dimensions3D,
) {
  const values: Record<string, string> = {
    length: dimensions.length || "not provided",
    width: dimensions.width || "not provided",
    thickness: dimensions.thickness || "not provided",
    formatted: dimensions.formatted || "not provided",
    capacity: dimensions.capacity || "not provided",
  };
  return prompt.replace(
    /\{\{(length|width|thickness|formatted|capacity)\}\}/gi,
    (_, key: string) => values[key.toLowerCase()],
  );
}

export function buildMockupConcept(
  promptKey: string,
  dimensions: Dimensions3D,
): string {
  let concept: string;
  switch (promptKey) {
    case "dimensions_3d":
      concept = `Product Size & Thickness Infographic Photography.
- Hand holding the top hanging lanyard / ribbon / string (matching the exact ribbon color, string material, and loop style from Image 1) against warm golden holiday bokeh background.
- Render the product with the exact material, opacity, surface finish, shape and edge construction supported by the product information and reference image.
- Vertical dashed white dimension line on the right side labeled "${dimensions.length}".
- Horizontal dashed white dimension line at the bottom labeled "${dimensions.width}".
- Callout pointer box at top right corner pointing to the product edge labeled "Thickness ${dimensions.thickness}".
- Bold white serif text at bottom center reading "PRODUCT SIZE".`;
      break;
    case "gift_box":
      concept = `PACKAGE INCLUDED gift-box flat-lay, matching this composition:
- Square 1:1 image, clean top-down product photography on a warm ivory or pale neutral tabletop.
- Place one open square red gift-box base in the left/lower area. Its interior is black velvet or black foam with a thin red rim.
- Lay exactly one complete ornament on top of the open box base. Keep the ornament fully visible, centered, correctly scaled and unobstructed; preserve its exact shape, material, printed artwork, text and colors from Image 1.
- Show the included hanging cord/lanyard attached to the ornament (copying the exact ribbon/string color and style from Image 1) and draped naturally near the top. Do not cover important artwork or lettering.
- Place the matching closed red textured gift-box lid separately in the upper-right area, rotated slightly and overlapping only the corner of the open box. The lid must not cover the ornament.
- PLAIN UNBRANDED BOX (STRICT ZERO PATTERNS OR TEXT ON BOX): The gift-box base and lid MUST BE PLAIN AND SOLID COLORED. ABSOLUTELY NO PATTERNS, NO PRINTED GRAPHICS, NO LOGOS, NO BRAND NAMES, AND NO TEXT ON THE BOX SURFACE OR LID!
- Use soft diffused studio lighting, realistic contact shadows and a premium e-commerce catalog finish. No hands, Christmas tree, lifestyle scene or decorative clutter.
- Reserve a clean area across the bottom for centered black typography. Render this exact package list clearly and spell it correctly:
"PACKAGE INCLUDED"
"1 - Colored Lanyard"
"1 - Gift Box Included"
"1 - Ornament"
- Do not add extra products, duplicate ornaments, extra accessories, logos or additional text.`;
      break;
    case "tree_view1":
      concept = "Sản phẩm treo trên nhánh cây thông xanh tươi. Giữ nguyên màu sắc và kiểu dây treo gốc từ Ảnh 1.";
      break;
    case "tree_view2":
      concept = `BRIGHT & CRYSTAL CLEAR PINE BRANCH & BOKEH product photography, matching this composition:
- Square 1:1 close-up holiday product photograph with the ornament from Image 1 hanging vertically from a fresh green pine branch in the upper right.
- ULTRA CRYSTAL CLEAR GLASS (100% PRISTINE WHITE GLASS TRANSPARENCY): If Image 1 is a glass ornament, the glass disc MUST be ultra pristine crystal clear transparent glass with bright white studio light reflections. Absolutely NO brown tint, NO tan gradient, NO muddy fog inside the glass disc (matching the clean white glass transparency of Content 4).
- Top hanging ribbon / string (copying exact ribbon color and material from Image 1) draped naturally from the pine branch.
- Soft-focus background: Bright white glowing fairy lights, fresh green pine needles, and clean white high-key studio illumination.
- Preserve exact shape, material, glass bevels, printed artwork, and original colors from Image 1.`;
      break;
    case "gifting_hands":
      concept = `PERFECT GIFT HAND-TO-HAND ORNAMENT PRESENTATION, matching this exact composition:
- Square 1:1 close-up holiday lifestyle photography featuring TWO realistic female hands presenting the ornament:
  1) Upper hand entering from upper-right holding the top hanging ribbon / lanyard (COPYING THE EXACT RIBBON COLOR, STRING MATERIAL, AND HOLE ATTACHMENT FROM IMAGE 1, e.g. red satin ribbon if Image 1 has red ribbon; do not change ribbon color).
  2) Lower receiving hand wearing a cozy white knit sweater sleeve, entering from lower-left with fingers and palm gently cupping and supporting beneath the bottom edge of the ornament.
- MATERIAL FIDELITY (PRESERVE EXACT MATERIAL FROM IMAGE 1):
  * If Image 1 is transparent glass: render ultra crystal clear 100% transparent glass with sparkling diamond-cut beveled facets.
  * If Image 1 is opaque wood / plywood / ceramic / resin / metal (like a wooden suncatcher / ornament): PRESERVE 100% OPAQUE WOODEN EDGE, DARK WOOD GRAIN TEXTURE, AND SURFACE OPACITY FROM IMAGE 1. DO NOT TURN OPAQUE WOOD INTO GLASS OR ACRYLIC! DO NOT ADD GLASS BEVELS OR METAL CHAINS!
- VIVID & RICH COLOR CONTRAST (NOT PALE OR WASHED OUT): Rich vibrant color saturation and crisp photographic contrast. Deep rich crimson red gift box with a bold red ribbon bow on the lower-right white tabletop. Fresh vibrant green Christmas tree pine needles and warm golden-white glowing fairy light bokeh circles in the left background.
- SKIN TONES & LIGHTING: Natural warm peach-beige skin tones with realistic fingers and nails. Soft, luminous, high-contrast studio lighting highlighting the printed design artwork, lettering, and actual product material vividly.
- Preserve exact printed artwork, text, graphics, and original vibrant colors from Image 1 centered on the ornament.`;
      break;
    case "car_mirror":
      concept =
        "Sản phẩm treo trên gương chiếu hậu của ô tô vào ban ngày (giữ đúng loại và màu dây treo gốc từ Ảnh 1), ngoài cửa kính là cây xanh và bầu trời sáng.";
      break;
    case "glass_sunburst":
      concept = `SUNLIT LIGHT REFRACTION product photography, matching this composition:
- Square 1:1 luxury product photograph featuring the ornament from Image 1 placed prominently on a warm polished wooden surface or hanging in direct natural sunlight.
- Bright golden sunburst light ray hitting the ornament from the background or angle, creating soft specular highlights, edge sheen, and warm luminous light flares.
- CRITICAL SHAPE & MATERIAL FIDELITY: Maintain the EXACT outer shape, silhouette, and material of the product from Image 1. If Image 1 is a die-cut custom shaped ornament (such as a house, star, tree, heart, acrylic cut, wood piece, or ceramic shape), keep ONLY that exact custom outer contour shape. Do NOT enclose or surround the product in an artificial circular glass disc, outer glass frame, or extra glass circle.
- Soft warm blurred background with golden sunlight bokeh circles, subtle sunbeams, and realistic tabletop contact shadows.
- Hanging ribbon/string (copying exact color and material from Image 1) passing cleanly through the top loop. Preserve exact design artwork, lettering, and original colors from Image 1.`;
      break;
    case "glass_thickness_callout":
      concept = `EXTREME LOW-ANGLE 3D PERSPECTIVE & PRODUCT THICKNESS CALLOUT commercial photography, matching this exact composition:
- CAMERA ANGLE & PERSPECTIVE (COMPULSORY EXTREME LOW ANGLE): Shot from an extreme low camera angle (close to surface level, looking slightly down at a 20-30 degree low-perspective angle). The ornament lies flat on the surface but is strongly foreshortened in perspective, showing its shape tilted into a dramatic 3D oval perspective.
- THICK SIDE EDGE PROMINENCE: The thick outer edge profile of the product MUST face directly toward the front/lower camera view. Show the visible side edge thickness (e.g. 6mm thick wood layers, cut acrylic edge, ceramic edge, or glass rim) clearly extending along the entire bottom-left edge curve with distinct 3D depth, material texture, and shadow.
- MULTI-LAYERED 3D DEPTH & RELIEF: Tightly capture the 3D raised multi-layer construction, showing printed elements, lettering, and figures popping up above the base layer with visible cast shadows beneath each layer.
- BACKGROUND SURFACE: Lying flat on an aesthetic background surface that naturally fits the product style in Image 1 (such as soft fluffy white faux-fur / plush fabric, luxury silk, natural wood, or marble surface).
- INDICATOR CALLOUT LINE & TEXT: Render a precise dark-blue indicator callout line with a solid round dot attached directly to the thick bottom-left side edge profile of the ornament. The pointer line extends downwards-left to a 2-line bold navy blue text label reading:
"${dimensions.thickness || "6mm"}
thickness"
- Top hanging ribbon/string (matching exact ribbon color and material from Image 1) attached at top left and draping naturally towards the upper left.
- DO NOT render front height/width dimension lines or "PRODUCT SIZE" footers.
- CRITICAL MATERIAL & SHAPE FIDELITY: Preserve 100% exact material, surface texture, outer contour shape, printed design graphics, text, and colors from Image 1.`;
      break;
    case "ornament_2layer_breakdown":
      concept = `2-LAYER WOODEN ORNAMENT PRODUCT DETAIL & LAYER BREAKDOWN INFOGRAPHIC, matching this exact composition:
- HEADER TEXT AT TOP: "PRODUCT DETAIL" rendered at top left in clean dark grey typography.
- TOP HALF EXPLODED LAYER BREAKDOWN:
  1) Upper Left: Isolated solid wooden background layer labeled "Layer 1-wooden" beneath it, with a circular zoom callout pointing to the wood thickness labeled "${dimensions.thickness || "0.3cm~0.12in"}".
  2) Center: A clear bold plus symbol "+" between the two isolated layers.
  3) Upper Right: Isolated front cutout frame layer labeled "Layer 2 -wooden" beneath it, displaying the printed outer ring and design elements from Image 1.
- BOTTOM HALF ASSEMBLED 3D PERSPECTIVE:
  Center bottom displays the fully assembled 2-layer wooden ornament placed flat on a surface at a 20-30 degree low-perspective angle.
  A clean indicator pointer line with a solid dot points to the thick side edge profile of the assembled ornament, labeled:
"${dimensions.thickness || "6mm"}
thickness"
- Corner decoration: Subtle fresh green pine branch at the lower left corner.
- CLEAN 100% PURE WHITE BACKGROUND (#FFFFFF).
- CRITICAL MATERIAL & DESIGN FIDELITY: Preserve 100% exact printed artwork, lettering, colors, and 2-layer wood construction from Image 1.`;
      break;
    case "wood_flatlay_pine":
      concept = `NATURAL WOOD TABLETOP FLAT-LAY WITH PINE BRANCH product photography, matching this composition:
- Clean top-down 1:1 flat-lay product photograph with the EXACT ornament from Image 1 lying flat in the center on a vertical-grain light natural wood tabletop.
- Fresh green pine / fir tree branches with subtle snow frosting placed elegantly along the left edge of the frame.
- CRITICAL SHAPE & MATERIAL FIDELITY: Maintain the exact outer shape, silhouette, edge contour, and material of the product from Image 1.
- If Image 1 is a die-cut custom shaped ornament (such as a house, star, tree, heart, acrylic cut, wood piece, or ceramic shape), keep ONLY that exact custom outer contour shape. Do NOT enclose or surround the product in an artificial circular glass disc, outer glass frame, or extra glass circle.
- If Image 1 is a transparent glass ornament, preserve its glass translucency and bevel cuts. If Image 1 is opaque (resin, wood, ceramic), preserve its opaque material and surface texture faithfully.
- Top hanging ribbon/string (copying exact ribbon color and material from Image 1) attached to top loop and drapes naturally upwards. Preserve exact artwork, text, and colors from Image 1.`;
      break;

    case "ornament_fireplace_mantle":
      concept = `COZY FIREPLACE MANTLE & HOLIDAY AMBIENCE product photography:
- CAMERA ANGLE & PERSPECTIVE: 35-degree eye-level lifestyle perspective photograph featuring the ornament from Image 1 hanging gracefully near a rustic wooden fireplace mantelpiece.
- Background: Warm glowing Christmas stocking decor, lush green pine garlands with red berries, lit pillar candles, and soft warm fire embers glowing in the fireplace with soft bokeh.
- Top hanging ribbon/string (copying exact ribbon color, string material, and loop style from Image 1) attached securely.
- CRITICAL MATERIAL & SHAPE FIDELITY: Preserve 100% exact material (glass, wood, acrylic, ceramic), surface finish, outer contour shape, printed design artwork, and original colors from Image 1.`;
      break;

    case "ornament_sunlit_window":
      concept = `SUNLIT WINDOW PANE & SNOWY GARDEN VIEW product photography:
- CAMERA ANGLE & PERSPECTIVE: 30-degree macro perspective photograph with the ornament from Image 1 hanging near a clear frost-dusted window pane.
- Background: Bright morning sunlight illuminating the scene from outside, showing a serene snowy pine garden background with crisp daylight sunbeams.
- Light refraction: Golden sunlight filtering through the edge bevels or material grain, creating crisp luminous specular highlights along the edge profile.
- Top hanging ribbon/string (matching exact ribbon color and material from Image 1) draped naturally.
- CRITICAL MATERIAL & SHAPE FIDELITY: Preserve 100% exact outer shape, material opacity/transparency, printed artwork, text, and vibrant colors from Image 1.`;
      break;

    case "ornament_lifestyle_adaptive":
      concept = `ADAPTIVE OCCASION LIFESTYLE ORNAMENT PHOTOGRAPHY:
- CAMERA ANGLE & PERSPECTIVE: 35-degree angled lifestyle perspective photograph of the ornament from Image 1.
- DYNAMIC OCCASION & BACKGROUND ADAPTATION: Observe the ornament design, text, and theme from Image 1 (such as Christmas holiday, Wedding/Anniversary, New Baby, Pet/Dog, Memorial/Angel, Graduation, Autumn/Thanksgiving, or Family gift). Automatically select an authentic, aesthetic lifestyle environment and background setting that perfectly matches THAT SPECIFIC OCCASION and theme (e.g. cozy holiday mantel for Christmas; warm sunny nursery/window for Baby; rustic romantic wood for Wedding; cozy autumn porch for Fall; warm living room display for Family/Pet).
- Top hanging ribbon/string (copying exact ribbon color, string material, and loop style from Image 1) attached naturally.
- Shallow depth of field with soft background bokeh.
- CRITICAL MATERIAL & SHAPE FIDELITY: Maintain 100% exact outer shape, physical material (wood, glass, acrylic, ceramic), surface finish, printed artwork, text, and colors from Image 1.`;
      break;

    case "ornament_package_adaptive":
      concept = `STANDARD RETAIL GIFT BOX PACKAGING & ACCESSORIES FLAT-LAY:
- CAMERA ANGLE: 90-degree top-down 1:1 flat-lay photograph on an aesthetic surface.
- STANDARD RETAIL GIFT BOX: Display a standard, sturdy commercial retail gift box (a realistic product gift box with custom interior foam/cushioning insert tray, matching ribbon/lanyard, and thank-you card).
- Composition: Lay the ornament from Image 1 flat in the center-left area, next to its open standard retail gift box showing the protective interior lining, string lanyard, and gifting card.
- Text callout area across bottom clearly rendering:
"PACKAGE INCLUDED"
"1 - Colored Lanyard"
"1 - Gift Box Included"
"1 - Ornament"
- Authentic commercial e-commerce packaging presentation with realistic contact shadows.
- Preserve 100% exact product contour silhouette, material, printed artwork, and colors from Image 1.`;
      break;

    case "ornament_sunburst_adaptive":
      concept = `ADAPTIVE SUNLIT LIGHT REFRACTION & SEASONAL ORNAMENT PHOTOGRAPHY:
- CAMERA ANGLE & PERSPECTIVE: 30-degree macro close-up perspective photograph featuring the ornament from Image 1 displayed near a natural light source.
- Dynamic sunlight & environment: Bright golden morning sunlight ray hitting the ornament from an angle, creating crisp specular highlights, edge sheen, and luminous light flares along the bevels or material texture.
- Occasion-adaptive background: The background environment automatically complements the ornament's specific event/theme (e.g., sunlit window pane near greenery/snow, sunny garden window sill, or cozy rustic indoor backdrop).
- Top hanging ribbon/string (matching exact ribbon color and material from Image 1) draped naturally.
- CRITICAL MATERIAL & SHAPE FIDELITY: Maintain 100% exact outer shape silhouette, material finish, printed artwork, text, and colors from Image 1.`;
      break;
    case "bullet_insulation_box":
    case "bullet_capacity_size":
    case "bullet_press_lid_pour":
    case "bullet_outdoor_camping":
    case "bullet_car_cupholder":
    case "bullet_men_gifting":
      concept = getBulletTumblerConcept(promptKey, dimensions) || "";
      break;

    case "slate_main_white":
    case "slate_features_infographic":
    case "slate_dimensions_size":
    case "slate_front_back_stack":
    case "slate_home_decor_lifestyle":
    case "slate_gifting_emotion":
    case "slate_packaging_box":
      concept = getSlatePlateConcept(promptKey, dimensions) || "";
      break;

    case "universal_main_white":
      concept = `HERO MAIN E-COMMERCE PRODUCT PHOTOGRAPHY (AMAZON MAIN IMAGE - IMAGE 1):
- CAMERA ANGLE: Clean full-front straight-on view (0 to 5 degree camera angle) for maximum visual clarity on Amazon search results.
- 100% PURE SOLID WHITE BACKGROUND (#FFFFFF, zero grey tint, zero background objects, clean crisp contact shadow).
- Centered product placement occupying 80% to 90% of the 2000x2000 square image frame.
- High-key professional studio lighting highlighting vivid true printed artwork colors and physical material finish.
- Preserve 100% exact product silhouette, material, printed design graphics, text, and original colors from Image 1.`;
      break;

    case "universal_lifestyle":
      concept = `REALISTIC LIFESTYLE & IN-USE PHOTOGRAPHY (AMAZON LIFESTYLE - IMAGE 2):
- CAMERA ANGLE & PERSPECTIVE: Dynamic 45-degree angled perspective view (placed in realistic depth within an authentic lifestyle setting).
- Place the product in a high-end environment naturally matching its niche, usage, and US seasonal vibe.
- STRICT DYNAMIC MATERIAL FIDELITY & TRANSPARENCY ACCURACY (CRITICAL):
  1) IF IMAGE 1 IS A CLEAR GLASS / ACRYLIC ORNAMENT: The non-printed glass area MUST BE 100% CRYSTAL CLEAR LUMINOUS TRANSPARENT. The underlying background scene (e.g. green pine needles, sunlit window, or bokeh lights) MUST BE CLEARLY VISIBLE AND REFRACTED THROUGH THE UNPRINTED GLASS BODY, with sparkling prismatic diamond-cut beveled facets along the outer rim edge.
  2) IF IMAGE 1 IS AN OPAQUE PRODUCT (WOOD, CERAMIC, METAL, RESIN): PRESERVE 100% SOLID AND OPAQUE BASE MATERIAL AND SURFACE TEXTURE FROM IMAGE 1.
- Shallow depth of field with soft blurred background to keep the product as the main sharp focus.
- Preserve 100% exact product material, silhouette, and printed design from Image 1.`;
      break;

    case "universal_dimensions":
      concept = `PRODUCT SIZE & INFOGRAPHIC DIMENSIONS (AMAZON DIMENSIONS - IMAGE 3):
- CAMERA ANGLE & PERSPECTIVE: Front isometric view of the product displayed on an aesthetic lifestyle background surface (such as light marble, elegant wooden desk, or soft blurred holiday bokeh background - DO NOT use a plain white void background).
- STRICT DYNAMIC MATERIAL FIDELITY (DO NOT DEFAULT TO GLASS):
  1) IF IMAGE 1 IS A CLEAR GLASS / ACRYLIC ORNAMENT: Render ultra crystal clear 100% luminous transparent glass with sparkling diamond-cut bevel highlights along the outer rim edge.
  2) IF IMAGE 1 IS AN OPAQUE PRODUCT (WOOD, CERAMIC, METAL, RESIN, PLYWOOD): PRESERVE 100% SOLID AND OPAQUE BASE MATERIAL, WOOD GRAIN TEXTURE, AND ORIGINAL SURFACE COLOR FROM IMAGE 1. DO NOT DEFAULT TO GLASS OR TRANSPARENT ACRYLIC! DO NOT ADD GLASS BEVELS TO WOOD/CERAMIC!
- BOLD "PRODUCT SIZE" TITLE: Render clear bold sans-serif typography reading "PRODUCT SIZE" at the bottom center (or top banner area). Use solid WHITE text on a dark area or solid BLACK/DARK-CHARCOAL text on a light area. NEVER use blue, navy, cyan, teal, gradients, outlines, glow, or decorative colored lettering for this title.
- DIMENSION CALLOUTS: Display clear, elegant height dimension line labeled "${dimensions.length}" and width dimension line labeled "${dimensions.width}".
- EXCLUDE SIDE THICKNESS: Do NOT display side edge thickness callouts or side thickness bars in Image 3 (thickness details are reserved exclusively for Image 4).
- Use clean, highly legible neutral black/white typography for the title and professional measurement callout indicators.
- Maintain accurate real-life proportions, material texture, and printed artwork from Image 1.`;
      break;

    case "universal_features_zoom":
      concept = `EXTREME LOW-ANGLE 3D PERSPECTIVE THICKNESS & MATERIAL CALLOUT (AMAZON FEATURES - IMAGE 4):
- CAMERA ANGLE & PERSPECTIVE (COMPULSORY EXTREME LOW ANGLE): Shot from an extreme low camera angle (close to surface level, looking slightly down at a 20-30 degree low-perspective angle). The product lies flat on an aesthetic background surface (such as soft plush fabric, white faux fur, luxury silk, natural wood, or marble) but is strongly foreshortened in perspective, showing its shape tilted into a dramatic 3D oval perspective.
- THICK SIDE EDGE PROMINENCE: The thick outer edge profile of the product MUST face directly toward the front/lower camera view. Show the visible side edge thickness (e.g. 6mm beveled crystal glass edge, cut acrylic edge, ceramic edge, or metallic rim) clearly extending along the entire lower edge curve with distinct 3D depth, material texture, and shadow.
- STRICT DYNAMIC MATERIAL FIDELITY & TRANSPARENCY ACCURACY (CRITICAL):
  1) IF IMAGE 1 IS A CLEAR GLASS / ACRYLIC ORNAMENT: The non-printed glass body MUST BE 100% CRYSTAL CLEAR LUMINOUS TRANSPARENT. The underlying background surface (e.g. wood grain, marble, silk, or fur fabric) MUST BE CLEARLY VISIBLE AND REFRACTED THROUGH THE UNPRINTED GLASS BODY, with sparkling prismatic diamond-cut beveled facets along the outer rim edge. DO NOT render a solid dark, brown, or opaque body for glass! DO NOT invent fake multi-layer wood stacks if Image 1 is a single glass disc!
  2) IF IMAGE 1 IS AN OPAQUE PRODUCT (WOOD, CERAMIC, METAL, RESIN, PLYWOOD): PRESERVE 100% SOLID AND OPAQUE BASE MATERIAL, WOOD GRAIN TEXTURE, AND ORIGINAL SURFACE COLOR FROM IMAGE 1. DO NOT DEFAULT TO GLASS! DO NOT ADD GLASS BEVELS TO WOOD OR CERAMIC!
- INDICATOR CALLOUT LINE & TEXT: Render a crisp indicator callout line ending with a solid dot pointing directly to the thick lower-left side edge profile of the product. Pointer line extends to a 2-line bold navy/black text label reading:
"${dimensions.thickness || "6mm"}
thickness"
- Top hanging ribbon/string or accessories (matching exact color and material from Image 1) attached and draping naturally.
- DO NOT render front height/width dimension arrows or "PRODUCT SIZE" footers.
- CRITICAL MATERIAL & SHAPE FIDELITY: Preserve 100% exact material, surface texture, outer contour shape, printed design graphics, text, and colors from Image 1.`;
      break;

    case "universal_gifting":
      concept = `PERFECT GIFT HAND-TO-HAND PRODUCT PRESENTATION PHOTOGRAPHY (AMAZON GIFTING - IMAGE 5):
- CAMERA ANGLE & PERSPECTIVE: 35-45 degree close-up presentation angle featuring TWO realistic hands presenting the product from Image 1 in a warm hand-to-hand gift handover moment:
  1) Upper hand (entering from top-right) holding the top hanging ribbon/lanyard (COPYING THE EXACT RIBBON COLOR, MATERIAL, AND HOLE ATTACHMENT FROM IMAGE 1).
  2) Lower receiving hand (wearing a cozy white or neutral knit sweater sleeve, entering from lower-left) with fingers and palm gently cupping and supporting beneath the bottom edge of the product.
- STRICT DYNAMIC MATERIAL FIDELITY & TRANSPARENCY ACCURACY (CRITICAL):
  1) IF IMAGE 1 IS A CLEAR GLASS / ACRYLIC ORNAMENT: The non-printed glass area MUST BE 100% CRYSTAL CLEAR LUMINOUS TRANSPARENT. The background and hands behind the glass MUST BE VISIBLE THROUGH THE UNPRINTED GLASS BODY, with sparkling prismatic diamond-cut beveled facets along the outer rim edge.
  2) IF IMAGE 1 IS AN OPAQUE PRODUCT (WOOD, CERAMIC, METAL): PRESERVE 100% OPAQUE BASE MATERIAL AND TEXTURE.
- RETAIL GIFT BOX: Displays a sturdy, elegant retail gift box with soft interior cushioning tray on the tabletop beside the handover scene.
- SKIN TONES & LIGHTING: Natural warm skin tones, soft luminous high-contrast lighting highlighting the printed design artwork, lettering, and product material vividly.
- Preserve 100% exact printed design artwork, text, outer silhouette contour shape, and material details from Image 1.`;
      break;

    case "universal_packaging":
      concept = `PACKAGE INCLUDED & RETAIL GIFT BOX FLAT-LAY (AMAZON PACKAGING - IMAGE 6):
- CAMERA ANGLE: 90-degree top-down 1:1 flat-lay photograph looking straight down at a clean studio background.
- STRICT DYNAMIC MATERIAL FIDELITY & TRANSPARENCY ACCURACY (CRITICAL):
  1) IF IMAGE 1 IS A CLEAR GLASS / ACRYLIC ORNAMENT: The non-printed glass area MUST BE 100% CRYSTAL CLEAR LUMINOUS TRANSPARENT. The underlying box interior / background MUST BE VISIBLE THROUGH THE UNPRINTED GLASS BODY, with sparkling prismatic diamond-cut beveled facets along the outer rim edge.
  2) IF IMAGE 1 IS AN OPAQUE PRODUCT (WOOD, CERAMIC, METAL): PRESERVE 100% OPAQUE BASE MATERIAL AND TEXTURE.
- RETAIL GIFT BOX: Displaying the product from Image 1 alongside a sturdy standard retail gift box with protective interior lining, hanging ribbon, and thank-you card.
- PLAIN GIFT BOX LID (STRICT NO TEXT ON LID): The retail gift box and lid MUST BE CLEAN AND PLAIN SOLID COLORED. ABSOLUTELY NO TEXT, NO PRINTED LETTERS, NO LOGO, AND NO GRAPHICS ON THE GIFT BOX LID.
- Text callout area listing included items ("PACKAGE INCLUDED: 1x Product, 1x Gift Box, Included Accessories").
- High-quality commercial e-commerce presentation with soft realistic shadows.
- Preserve exact product shape, material, and design from Image 1.`;
      break;

    case "universal_artwork_macro":
    case "universal_card_flatlay_adaptive":
    case "ornament_card_flatlay_adaptive":
      concept = `ADAPTIVE THEME GREETING CARD FLAT-LAY PHOTOGRAPHY (AMAZON CARD & THEME LIFESTYLE - IMAGE 7):
- CAMERA ANGLE & COMPOSITION: 90-degree top-down 1:1 flat-lay photograph looking straight down at an aesthetic background surface.
- PRODUCT IN CENTER: The product from Image 1 rests prominently in the center of the flat-lay composition with its top hanging ribbon draped neatly.
- STRICT MATERIAL FIDELITY & TRANSPARENCY ACCURACY (CRITICAL):
  1) IF IMAGE 1 IS A CLEAR GLASS / ACRYLIC ORNAMENT: The non-printed glass disc area MUST BE 100% CRYSTAL CLEAR LUMINOUS TRANSPARENT. The underlying flat-lay background texture (e.g. wood grain, water ripples, silk fabric) MUST be clearly visible and refracted through the unprinted glass body, with sparkling prismatic diamond-cut bevel highlights along the outer rim edge.
  2) IF IMAGE 1 IS AN OPAQUE PRODUCT (WOOD, CERAMIC, METAL, RESIN, PLYWOOD): The product body MUST REMAIN 100% SOLID AND OPAQUE WITH ITS EXACT ORIGINAL MATERIAL TEXTURE AND BASE COLOR. DO NOT MAKE OPAQUE WOOD/CERAMIC SEETHROUGH OR TRANSPARENT! DO NOT ADD GLASS BEVELS TO WOOD OR CERAMIC!
- AUTOMATIC THEME EVALUATION & DYNAMIC QUOTE CARD:
  * AI VISION AUTOMATICALLY EVALUATES THE DESIGN THEME FROM IMAGE 1 (e.g. Camper/Travel, Diving/Sea, Pet/Dog, Wedding/Anniversary, New Baby, Profession, Memorial, Christmas, Family).
  * TOP-RIGHT OR TOP-LEFT CORNER QUOTE CARD: Position a square or rectangular cream/kraft paper greeting card in the TOP-RIGHT or TOP-LEFT corner of the frame, tilted naturally at a 10-15 degree angle.
  * HANDWRITTEN QUOTE & TEXT: On the card, render a clear handwritten cursive quote matching THAT SPECIFIC THEME with a small heart symbol ♡ (e.g., "Home is where we park it ♡" for Camper; "Life is better when you're diving ♡" for Diving; "Stay Axolotl Positive ♡" for Axolotl/Pet; "Our First Christmas ♡" for Holiday; "In Loving Memory ♡" for Memorial; "Best Mom Ever ♡" for Family).
- THEME-MATCHING FLAT-LAY PROPS: Surround the flat-lay with authentic decorative props matching the theme (e.g. camper toy model & map for camper; diving mask & sea shells for diving; corals & pet figurine for axolotl/pet; pine cones & fairy lights for Xmas; dry flowers & candle for memorial).
- CRITICAL SHAPE & COLOR FIDELITY: Preserve 100% exact product contour silhouette, printed artwork, typography, and original colors from Image 1.`;
      break;
    default:
      concept = promptKey.startsWith("custom:")
        ? applyPromptDimensionPlaceholders(
            promptKey.slice("custom:".length).trim(),
            dimensions,
          )
        : "Ảnh mockup sản phẩm.";
  }

  return concept;
}

export function buildMockupPrompt(
  promptKey: string,
  itemName: string,
  dimensions: Dimensions3D,
  productContext?: string,
  refinementNote?: string,
): string {
  const concept = buildMockupConcept(promptKey, dimensions);

  const dimensionsLine =
    promptKey === "dimensions_3d" && dimensions.formatted
      ? `\n\nKích thước 3 chiều: ${dimensions.formatted}.`
      : "";

  const productContextLine = productContext?.trim()
    ? `\nTHÔNG TIN BỔ SUNG TỪ THẺ SẢN PHẨM — chỉ dùng khi không mâu thuẫn với yêu cầu riêng hoặc Ảnh 1:\n${productContext.trim()}\n`
    : "";

  const refinementLine = refinementNote?.trim()
    ? `\n\n[CHỈ DẪN TINH CHỈNH TỪ NGƯỜI DÙNG / USER REFINEMENT NOTE]:\n${refinementNote.trim()}\n`
    : "";

  return `Tạo một ảnh mockup thương mại mới cho sản phẩm "${itemName}", sử dụng Ảnh 1 làm tham chiếu hình ảnh chính.

THỨ TỰ ƯU TIÊN:
1. Yêu cầu riêng của Content bên dưới.
2. Các đặc điểm sản phẩm nhìn thấy rõ trong Ảnh 1.
3. Thông tin bổ sung từ thẻ sản phẩm.

NGUYÊN TẮC CHUNG TRUNG TÍNH:
- Không mặc định bất kỳ loại sản phẩm, chất liệu, hình dạng, công dụng, dịp lễ hoặc phong cách bối cảnh nào.
- Giữ đúng sản phẩm trong Ảnh 1: đường viền ngoài, tỷ lệ, cấu tạo, vật liệu, độ trong/đục, màu nền vật liệu, bề mặt, độ bóng/mờ, độ dày và kiểu hoàn thiện cạnh.
- Giữ nguyên thiết kế POD: artwork, chữ, typography, hình minh họa, màu sắc và bố cục. Không viết lại, sửa chính tả, dịch, thay thế hoặc sáng tạo lại nội dung in.
- Không tự thêm hoặc thay đổi bộ phận, phụ kiện hay kết cấu không có trong Ảnh 1 và không được yêu cầu riêng nêu rõ. Chỉ hiển thị phụ kiện khi có căn cứ từ ảnh hoặc yêu cầu riêng.
- Phân biệt sản phẩm thật với nền ảnh nguồn. Khi đổi bối cảnh, chỉ thay phần môi trường; không biến nền cũ thành một phần của sản phẩm.
- Ánh sáng, phản xạ, bóng đổ và phối cảnh phải phù hợp vật lý với đúng vật liệu và hình học của sản phẩm.
- Nếu thông tin bổ sung mơ hồ hoặc mâu thuẫn, ưu tiên yêu cầu riêng và những gì quan sát được trong Ảnh 1; không tự suy đoán để lấp chỗ trống.
${productContextLine}

YÊU CẦU RIÊNG CỦA CONTENT — ƯU TIÊN CAO NHẤT:
${concept}${dimensionsLine}${refinementLine}`;
}

function mockupResult(
  meta: (typeof MOCKUP_TYPES)[number] | {
    index: number;
    name: string;
    fileName: string;
    promptKey: string;
    description: string;
  },
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

async function normalizeDesignImage(
  input: Buffer,
  forcePng = false,
): Promise<{ buffer: Buffer; mimeType: string; extension: string }> {
  if (input.byteLength > OPENAI_INPUT_LIMIT_BYTES) {
    throw new Error("Ảnh thiết kế vượt quá giới hạn 50 MB của Image API.");
  }

  let normalized: Buffer;
  let mimeType: "image/png" | "image/jpeg";
  try {
    const metadata = await sharp(input, { failOn: "warning" }).metadata();
    const pipeline = sharp(input, { failOn: "warning" })
      .rotate()
      .resize({
        width: configuredInputMaxDimension(),
        height: configuredInputMaxDimension(),
        fit: "inside",
        withoutEnlargement: true,
      });
    if (forcePng || metadata.hasAlpha || metadata.format === "png") {
      mimeType = "image/png";
      normalized = await pipeline.png({ compressionLevel: 9 }).toBuffer();
    } else {
      mimeType = "image/jpeg";
      normalized = await pipeline
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
        .toBuffer();
    }
  } catch (error) {
    throw new Error(
      "Ảnh thiết kế không thể chuẩn hóa để gửi tới model tạo ảnh.",
      { cause: error },
    );
  }

  if (normalized.byteLength > OPENAI_INPUT_LIMIT_BYTES) {
    throw new Error(
      "Ảnh thiết kế vượt quá giới hạn 50 MB của Image API.",
    );
  }
  return {
    buffer: normalized,
    mimeType,
    extension: mimeType === "image/png" ? ".png" : ".jpg",
  };
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
      message: `CheapKeyAI chưa có channel khả dụng cho gpt-image-2 trong group của API key này. Hãy đổi/tạo key ở đúng group hoặc gửi${requestId ? ` request ID ${requestId}` : " request ID trong log"
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
    searchable.includes("上游负载已饱和") ||
    searchable.includes("upstream load") ||
    searchable.includes("upstream is overloaded")
  ) {
    return {
      message:
        "Upstream của CheapKeyAI đang quá tải. Hệ thống đã dừng request này và không tự retry; hãy chờ một lúc rồi thử lại.",
      status: 429,
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
    searchable.includes("model not found")
  ) {
    return {
      message:
        "Model tạo ảnh không tồn tại hoặc key hiện tại chưa thuộc đúng nhóm model.",
      status: 404,
    };
  }

  if (
    searchable.includes("fetch failed") ||
    searchable.includes("etimedout") ||
    searchable.includes("timed out") ||
    searchable.includes("request timeout") ||
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
  const parsed = Number(process.env.OPENAI_IMAGE_TIMEOUT_MS || 600_000);
  return Number.isFinite(parsed)
    ? Math.min(600_000, Math.max(30_000, Math.round(parsed)))
    : 600_000;
}

function configuredOpenAIRetries() {
  const parsed = Number(process.env.OPENAI_IMAGE_RETRY_ATTEMPTS || 1);
  return Number.isFinite(parsed)
    ? Math.min(2, Math.max(0, Math.round(parsed)))
    : 1;
}

function configuredInputMaxDimension() {
  const parsed = Number(process.env.MOCKUP_INPUT_MAX_DIMENSION || 1536);
  return Number.isFinite(parsed)
    ? Math.min(2048, Math.max(1024, Math.round(parsed)))
    : 1536;
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
  const isCheapKeyAI = isCheapKeyAIImageModel(model);
  const isGeminiImage =
    model === "gemini-3.1-flash-image" || model === "gemini-3-pro-image";
  const configured = isGeminiImage
    ? process.env.GEMINI_IMAGE_CONCURRENCY
    : process.env.IMAGE_GENERATION_CONCURRENCY;
  const fallback = isGeminiImage ? 1 : 6;
  const parsed = Number(configured || fallback);
  const maxAllowed = isCheapKeyAI ? 3 : 6;
  return Number.isFinite(parsed)
    ? Math.min(maxAllowed, Math.max(1, Math.round(parsed)))
    : Math.min(maxAllowed, fallback);
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

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw signal.reason || new DOMException("Tác vụ tạo ảnh đã bị hủy.", "AbortError");
  }
}

async function raceWithSignal<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(signal.reason || new DOMException("Tác vụ tạo ảnh đã bị hủy.", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export async function renderGraphicMockup(
  promptKey: string,
  params: {
    sku: string;
    itemName: string;
    dimensions: Dimensions3D;
    base64Design: string;
    base64MimeType?: string;
  },
): Promise<Buffer> {
  const {
    sku,
    itemName,
    dimensions,
    base64Design,
    base64MimeType = "image/png",
  } = params;

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
  } else if (promptKey === "glass_sunburst") {
    bgGradient = "linear-gradient(135deg, #78350f 0%, #451a03 100%)";
    titleBadge = "SUNLIT GLASS REFRACTION MOCKUP";
    sceneDesc = "Golden Sunlight Refraction & Beveled Glass Shine";
  } else if (promptKey === "glass_thickness_callout") {
    bgGradient = "linear-gradient(135deg, #2e1065 0%, #0f172a 100%)";
    titleBadge = "GLASS THICKNESS CALLOUT MOCKUP";
    sceneDesc = `Beveled Glass Edge Thickness: ${dimensions.thickness || "6mm"}`;
  } else if (promptKey === "wood_flatlay_pine") {
    bgGradient = "linear-gradient(135deg, #451a03 0%, #1c1917 100%)";
    titleBadge = "WOOD FLAT-LAY & PINE MOCKUP";
    sceneDesc = "Natural Wood Tabletop with Festive Pine Decor";
  } else if (promptKey === "ornament_fireplace_mantle") {
    bgGradient = "linear-gradient(135deg, #7c2d12 0%, #451a03 100%)";
    titleBadge = "COZY FIREPLACE MANTLE MOCKUP";
    sceneDesc = "Festive Mantle Decoration with Warm Firelight Bokeh";
  } else if (promptKey === "ornament_sunlit_window") {
    bgGradient = "linear-gradient(135deg, #0369a1 0%, #0c4a6e 100%)";
    titleBadge = "SUNLIT WINDOW & SNOW MOCKUP";
    sceneDesc = "Morning Sunlight Refraction & Frosty Window View";
  } else if (promptKey === "ornament_lifestyle_adaptive") {
    bgGradient = "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)";
    titleBadge = "ADAPTIVE OCCASION LIFESTYLE";
    sceneDesc = "Environment Adapts to Product Theme & Occasion";
  } else if (promptKey === "ornament_package_adaptive") {
    bgGradient = "linear-gradient(135deg, #450a0a 0%, #881337 100%)";
    titleBadge = "PACKAGE INCLUDED FLAT-LAY";
    sceneDesc = "Gift Box, Lanyard & Ornament Packaging";
  } else if (promptKey === "ornament_sunburst_adaptive") {
    bgGradient = "linear-gradient(135deg, #78350f 0%, #451a03 100%)";
    titleBadge = "ADAPTIVE SUNLIT REFRACTION";
    sceneDesc = "Natural Sunlight Rays & Occasion Complementary Background";
  } else if (promptKey === "bullet_insulation_box") {
    bgGradient = "linear-gradient(135deg, #1c1917 0%, #78350f 100%)";
    titleBadge = "BULLET TUMBLER INSULATION & BOX";
    sceneDesc = "Upgraded Vacuum Insulation & Marble Box";
  } else if (promptKey === "bullet_capacity_size") {
    bgGradient = "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)";
    titleBadge = "17OZ CAPACITY & DIMENSIONS";
    sceneDesc = "Height 11 inches, Width 2.6 inches";
  } else if (promptKey === "bullet_press_lid_pour") {
    bgGradient = "linear-gradient(135deg, #451a03 0%, #0f172a 100%)";
    titleBadge = "PRESS LID & CUP POURING";
    sceneDesc = "Double Wall Insulation & Press To Open Lid";
  } else if (promptKey === "bullet_outdoor_camping") {
    bgGradient = "linear-gradient(135deg, #3f6212 0%, #14532d 100%)";
    titleBadge = "OUTDOOR CAMPING LIFESTYLE";
    sceneDesc = "Pouring Coffee in Autumn Outdoor Setting";
  } else if (promptKey === "bullet_car_cupholder") {
    bgGradient = "linear-gradient(135deg, #18181b 0%, #27272a 100%)";
    titleBadge = "CUP HOLDER FRIENDLY";
    sceneDesc = "Fits Most Vehicle Cup Holders";
  } else if (promptKey === "bullet_men_gifting") {
    bgGradient = "linear-gradient(135deg, #1e3a8a 0%, #0f172a 100%)";
    titleBadge = "COOLEST TUMBLER FOR MEN";
    sceneDesc = "Mountain Vista Lifestyle & Gifting Banner";
  } else if (promptKey === "universal_main_white") {
    bgGradient = "linear-gradient(135deg, #ffffff 0%, #f1f5f9 100%)";
    titleBadge = "AMAZON MAIN HERO IMAGE";
    sceneDesc = "100% Pure White Background (CTR Booster)";
  } else if (promptKey === "universal_lifestyle") {
    bgGradient = "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)";
    titleBadge = "AMAZON LIFESTYLE CONTEXT";
    sceneDesc = "In-Use Product Photography";
  } else if (promptKey === "universal_dimensions") {
    bgGradient = "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)";
    titleBadge = "AMAZON 3D DIMENSION INFOGRAPHIC";
    sceneDesc = `Product Dimensions: ${dimensions.formatted}`;
  } else if (promptKey === "universal_features_zoom") {
    bgGradient = "linear-gradient(135deg, #2e1065 0%, #0f172a 100%)";
    titleBadge = "MATERIAL & FEATURE ZOOM";
    sceneDesc = "Macro Material Texture & Edge Thickness";
  } else if (promptKey === "universal_gifting") {
    bgGradient = "linear-gradient(135deg, #881337 0%, #450a0a 100%)";
    titleBadge = "AMAZON GIFTING & EMOTIONAL SCENE";
    sceneDesc = "Gift Box Presentation & Emotional Handover";
  } else if (promptKey === "universal_packaging") {
    bgGradient = "linear-gradient(135deg, #450a0a 0%, #1c1917 100%)";
    titleBadge = "PACKAGE INCLUDED & PACKAGING";
    sceneDesc = "Gift Box & Accessories Flat-Lay";
  } else if (promptKey === "universal_artwork_macro") {
    bgGradient = "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)";
    titleBadge = "MACRO ARTWORK & PRINT QUALITY";
    sceneDesc = "Ultra Sharp Print Detail Zoom";
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
    <text x="512" y="78" text-anchor="middle" fill="#38bdf8" font-family="'Noto Sans', 'DejaVu Sans', Arial, Roboto, sans-serif" font-size="16" font-weight="700" letter-spacing="2">${escapeXml(titleBadge)}</text>

    <text x="512" y="125" text-anchor="middle" fill="#ffffff" font-family="'Noto Sans', 'DejaVu Sans', Arial, Roboto, sans-serif" font-size="28" font-weight="800">${escapeXml(itemName)}</text>
    <text x="512" y="155" text-anchor="middle" fill="#94a3b8" font-family="'Noto Sans', 'DejaVu Sans', Arial, Roboto, sans-serif" font-size="18" font-weight="500">SKU: ${escapeXml(sku)}</text>

    <!-- Product Rim Accent -->
    <circle cx="512" cy="480" r="290" fill="none" stroke="#ffffff" stroke-width="8" opacity="0.8" filter="url(#shadow)"/>
    <circle cx="512" cy="480" r="286" fill="none" stroke="#cbd5e1" stroke-width="3" opacity="0.9"/>
    
    <!-- Hanging Ribbon Loop -->
    <rect x="496" y="160" width="32" height="50" rx="4" fill="#f8fafc" opacity="0.9"/>
    <circle cx="512" cy="205" r="8" fill="#cbd5e1"/>

    <!-- Embedded Artwork -->
    <g clip-path="url(#circleClip)">
      <image href="data:${base64MimeType};base64,${base64Design}" x="232" y="200" width="560" height="560" preserveAspectRatio="xMidYMid slice"/>
    </g>

    <!-- Subtle Material-Neutral Edge Accent -->
    <circle cx="512" cy="480" r="280" fill="none" stroke="url(#glow)" stroke-width="20" opacity="0.6"/>

    <!-- PRODUCT SIZE Title at Bottom -->
    <text x="512" y="940" text-anchor="middle" fill="#ffffff" font-family="'Noto Sans', 'DejaVu Sans', Arial, Roboto, sans-serif" font-size="44" font-weight="900" letter-spacing="4">PRODUCT SIZE</text>

    ${promptKey === "dimensions_3d"
      ? `
      <!-- Horizontal Width Dimension Line (Bottom) -->
      <line x1="210" y1="810" x2="814" y2="810" stroke="#ffffff" stroke-width="3" stroke-dasharray="8 6"/>
      <line x1="210" y1="795" x2="210" y2="825" stroke="#ffffff" stroke-width="4"/>
      <line x1="814" y1="795" x2="814" y2="825" stroke="#ffffff" stroke-width="4"/>
      <rect x="100" y="786" width="100" height="48" rx="8" fill="#0f172a" opacity="0.8" stroke="#ffffff" stroke-width="1.5"/>
      <text x="150" y="818" text-anchor="middle" fill="#ffffff" font-family="'Noto Sans', 'DejaVu Sans', Arial, Roboto, sans-serif" font-size="24" font-weight="800">${escapeXml(dimensions.width)}</text>

      <!-- Vertical Height Dimension Line (Right) -->
      <line x1="850" y1="210" x2="850" y2="760" stroke="#ffffff" stroke-width="3" stroke-dasharray="8 6"/>
      <line x1="835" y1="210" x2="865" y2="210" stroke="#ffffff" stroke-width="4"/>
      <line x1="835" y1="760" x2="865" y2="760" stroke="#ffffff" stroke-width="4"/>
      <rect x="872" y="320" width="100" height="48" rx="8" fill="#0f172a" opacity="0.8" stroke="#ffffff" stroke-width="1.5"/>
      <text x="922" y="352" text-anchor="middle" fill="#ffffff" font-family="'Noto Sans', 'DejaVu Sans', Arial, Roboto, sans-serif" font-size="24" font-weight="800">${escapeXml(dimensions.length)}</text>

      <!-- Top Right Corner Thickness Callout Box -->
      <line x1="770" y1="230" x2="710" y2="280" stroke="#ef4444" stroke-width="3"/>
      <circle cx="710" cy="280" r="6" fill="#ef4444"/>
      <rect x="755" y="170" width="200" height="65" rx="12" fill="#0f172a" stroke="#ef4444" stroke-width="2.5" filter="url(#shadow)"/>
      <text x="855" y="196" text-anchor="middle" fill="#94a3b8" font-family="'Noto Sans', 'DejaVu Sans', Arial, Roboto, sans-serif" font-size="16" font-weight="700">Thickness</text>
      <text x="855" y="224" text-anchor="middle" fill="#ef4444" font-family="'Noto Sans', 'DejaVu Sans', Arial, Roboto, sans-serif" font-size="20" font-weight="800">${escapeXml(dimensions.thickness)}</text>
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
