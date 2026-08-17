import OpenAI, { toFile } from "openai";
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import type { Dimensions3D } from "./trello";
import { detectRasterImageMimeType } from "./image-processing";
import { generateChatGPTWebImage } from "./chatgpt-web-automation";

import {
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
  customMockups?: readonly { id: number; label: string; promptKey?: string }[];
  /** Optional custom user refinement prompt notes per mockup index. */
  customRefinementNotes?: Record<number, string>;
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
      return {
        index: defaultType.index,
        name: custom.label.startsWith("Mockup")
          ? custom.label
          : `Mockup ${defaultType.index} - ${custom.label.replace(/^Content\s*\d+:\s*/i, "")}`,
        fileName: `Mockup${defaultType.index}_${safeFileStem(custom.label)}.png`,
        promptKey: custom.promptKey || defaultType.promptKey,
        description: `Ảnh mockup: ${custom.label}`,
      };
    }
    return defaultType;
  });

  (options.customMockups || []).forEach((custom) => {
    if (!effectiveMockupTypes.some((t) => t.index === custom.id)) {
      effectiveMockupTypes.push({
        index: custom.id,
        name: custom.label.startsWith("Mockup")
          ? custom.label
          : `Mockup ${custom.id} - ${custom.label.replace(/^Content\s*\d+:\s*/i, "")}`,
        fileName: `Mockup${custom.id}_${safeFileStem(custom.label)}.png`,
        promptKey: custom.promptKey || `custom:${custom.label}`,
        description: `Ảnh mockup tùy chỉnh: ${custom.label}`,
      });
    }
  });

  const normalizedDesignBuffer = await normalizeDesignImage(inputDesignBuffer);
  const base64Design = normalizedDesignBuffer.toString("base64");

  const selectedIndexesSet = options.selectedIndexes
    ? new Set(options.selectedIndexes)
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
      type: MOCKUP_TYPES[0].fileName,
      buffer: normalizedDesignBuffer,
      mimeType: "image/png",
      description: MOCKUP_TYPES[0].description,
    };
    progressCallback?.(1, MOCKUP_TYPES[0].name, "success");
    await options.onMockupReady?.(mockup1);
  }

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

  const targetMockups = effectiveMockupTypes.slice(1).filter((meta) => {
    if (skippedIndexes.has(meta.index)) return false;
    if (selectedIndexesSet) return selectedIndexesSet.has(meta.index);
    return meta.index <= 7;
  });

  const generatedResults = await mapWithConcurrency(
    targetMockups,
    configuredConcurrency(model),
    async (meta) => {
      progressCallback?.(meta.index, meta.name, "processing");

      let mockupBuffer: Buffer;
      let providerTrace: MockupResult["providerTrace"];

      const refinementNote = options.customRefinementNotes?.[meta.index];

      if (isImageApiModel(model) && openaiClient && openaiInput) {
        const prompt = buildMockupPrompt(
          meta.promptKey,
          itemName,
          dimensions,
          productContext,
          refinementNote,
        );
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
          ? process.env.CHEAPKEYAI_UPSTREAM_MODEL?.trim() ||
            (model === "gpt-image-2-cheapkey" ? "gpt-image-2" : model)
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
        const prompt = buildMockupPrompt(
          meta.promptKey,
          itemName,
          dimensions,
          productContext,
          refinementNote,
        );
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

  const allResults = mockup1 ? [mockup1, ...generatedResults] : generatedResults;
  return allResults.sort((a, b) => a.index - b.index);
}



export function buildMockupPrompt(
  promptKey: string,
  itemName: string,
  dimensions: Dimensions3D,
  productContext?: string,
  refinementNote?: string,
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
- Shallow depth of field with soft blurred background to keep the product as the main sharp focus.
- Preserve 100% exact product material, silhouette, and printed design from Image 1.`;
      break;

    case "universal_dimensions":
      concept = `PRODUCT SIZE & INFOGRAPHIC DIMENSIONS (AMAZON DIMENSIONS - IMAGE 3):
- CAMERA ANGLE & PERSPECTIVE: Front isometric view of the product displayed on an aesthetic lifestyle background surface (such as light marble, elegant wooden desk, or soft blurred holiday bokeh background - DO NOT use a plain white void background).
- STRICT DYNAMIC MATERIAL FIDELITY (DO NOT DEFAULT TO GLASS):
  1) IF IMAGE 1 IS A CLEAR GLASS / ACRYLIC ORNAMENT: Render ultra crystal clear 100% luminous transparent glass with sparkling diamond-cut bevel highlights along the outer rim edge.
  2) IF IMAGE 1 IS AN OPAQUE PRODUCT (WOOD, CERAMIC, METAL, RESIN, PLYWOOD): PRESERVE 100% SOLID AND OPAQUE BASE MATERIAL, WOOD GRAIN TEXTURE, AND ORIGINAL SURFACE COLOR FROM IMAGE 1. DO NOT DEFAULT TO GLASS OR TRANSPARENT ACRYLIC! DO NOT ADD GLASS BEVELS TO WOOD/CERAMIC!
- BOLD "PRODUCT SIZE" TITLE: Render clear, bold typography text reading "PRODUCT SIZE" at the bottom center (or top banner area) of the image.
- DIMENSION CALLOUTS: Display clear, elegant height dimension line labeled "${dimensions.length}" and width dimension line labeled "${dimensions.width}".
- EXCLUDE SIDE THICKNESS: Do NOT display side edge thickness callouts or side thickness bars in Image 3 (thickness details are reserved exclusively for Image 4).
- Clean, highly legible white/navy typography and professional measurement callout indicators.
- Maintain accurate real-life proportions, material texture, and printed artwork from Image 1.`;
      break;

    case "universal_features_zoom":
      concept = `EXTREME LOW-ANGLE 3D PERSPECTIVE THICKNESS & MATERIAL CALLOUT (AMAZON FEATURES - IMAGE 4):
- CAMERA ANGLE & PERSPECTIVE (COMPULSORY EXTREME LOW ANGLE): Shot from an extreme low camera angle (close to surface level, looking slightly down at a 20-30 degree low-perspective angle). The product lies flat on an aesthetic background surface (such as soft plush fabric, white faux fur, luxury silk, natural wood, or marble) but is strongly foreshortened in perspective, showing its shape tilted into a dramatic 3D oval perspective.
- THICK SIDE EDGE PROMINENCE: The thick outer edge profile of the product MUST face directly toward the front/lower camera view. Show the visible side edge thickness (e.g. 6mm thick wood layers, cut acrylic edge, ceramic edge, or metallic rim) clearly extending along the entire lower edge curve with distinct 3D depth, material texture, and shadow.
- MULTI-LAYERED 3D DEPTH & RELIEF: Tightly capture the 3D raised multi-layer construction, showing printed elements, lettering, and figures popping up above the base layer with visible cast shadows.
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
- RETAIL GIFT BOX: Displays a sturdy, elegant retail gift box with soft interior cushioning tray on the tabletop beside the handover scene.
- SKIN TONES & LIGHTING: Natural warm skin tones, soft luminous high-contrast lighting highlighting the printed design artwork, lettering, and product material vividly.
- Preserve 100% exact printed design artwork, text, outer silhouette contour shape, and material details from Image 1.`;
      break;

    case "universal_packaging":
      concept = `PACKAGE INCLUDED & RETAIL GIFT BOX FLAT-LAY (AMAZON PACKAGING - IMAGE 6):
- CAMERA ANGLE: 90-degree top-down 1:1 flat-lay photograph looking straight down at a clean studio background.
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
        ? `Tạo bối cảnh mockup tùy chỉnh theo yêu cầu: ${promptKey.slice("custom:".length).trim()}. Bố cục phải tự nhiên, hợp lý và giữ sản phẩm làm chủ thể chính.`
        : "Ảnh mockup sản phẩm.";
  }

  const dimensionsLine =
    promptKey === "dimensions_3d"
      ? `\n\nKích thước 3 chiều: ${dimensions.formatted}.`
      : "";

  const productContextLine = productContext?.trim()
    ? `\nThông tin bổ sung từ thẻ sản phẩm:\n${productContext.trim()}\n`
    : "";

  const refinementLine = refinementNote?.trim()
    ? `\n\n[CHỈ DẪN TINH CHỈNH TỪ NGƯỜI DÙNG / USER REFINEMENT NOTE]:\n${refinementNote.trim()}\n`
    : "";

  return `Sử dụng Ảnh 1 làm ảnh tham chiếu cho sản phẩm "${itemName}".${productContextLine}

Quan sát Ảnh 1 để nhận diện chính xác:
- hình dáng và tỷ lệ sản phẩm
- chất liệu, độ trong/đục, độ bóng/mờ và cấu tạo cạnh
- thiết kế in
- chữ và typography
- các hình minh họa
- màu sắc của CÁC CHI TIẾT ĐƯỢC IN
- lỗ treo và thiết kế dây treo (loại dây, màu dây, chất liệu dây, số lượng lỗ treo)

CỐ ĐỊNH DÂY TREO VÀ LỖ TREO TỪ ẢNH 1 (EXACT HANGING STRING / RIBBON FIDELITY):
- QUAN SÁT KỸ DÂY TREO TRONG ẢNH 1: Copy chính xác 100% màu sắc dây (ruy-băng đỏ, ruy-băng trắng, dây thừng đay nâu, dây kim loại...), chất liệu dây (satin, đay, xích...) và kiểu xỏ lỗ (1 lỗ, 2 lỗ ở đỉnh...) từ Ảnh 1.
- TUYỆT ĐỐI KHÔNG TỰ Ý ĐỔI MÀU DÂY TREO HAY THAY THẾ BẰNG XÍCH KIM LOẠI: Ví dụ nếu Ảnh 1 dùng dây ruy-băng đỏ, bắt buộc giữ nguyên dây ruy-băng đỏ, KHÔNG được tự ý chuyển thành dây trắng hay xích kim loại!

CỐ ĐỊNH HÌNH DÁNG SẢN PHẨM & TUYỆT ĐỐI KHÔNG TỰ THÊM ĐĨA KÍNH TRÒN:
- Giữ CHÍNH XÁC hình dạng đường viền ngoài (contour silhouette) của sản phẩm trong Ảnh 1.
- Nếu Ảnh 1 là sản phẩm cắt theo khuôn riêng (die-cut shape như hình ngôi nhà, hình bản đồ bang, hình ngôi sao, hình cây thông, hình áo, hình trái tim...), chỉ tái hiện đúng hình dạng cắt die-cut đó.
- TUYỆT ĐỐI KHÔNG tự động bọc thêm một đĩa kính tròn (circular glass disc), khung kính ngoài, hay vòng kính bao quanh sản phẩm nếu Ảnh 1 không phải là hình đĩa kính tròn.

BẢO TỒN CHẤT LIỆU VẬT LÝ GỐC CỦA SẢN PHẨM (STRICT MATERIAL FIDELITY):
1. NẾU SẢN PHẨM TRONG ẢNH 1 LÀ KÍNH / THỦY TINH / PHA LÊ / ACRYLIC TRONG SUỐT (GLASS ORNAMENT):
   - ĐĨA KÍNH TRẮNG TRONG SUỐT TUYỆT ĐỐI (ULTRA BRIGHT WHITE CRYSTAL GLASS):
     Đĩa kính PHẢI LÀ KÍNH TRẮNG TRONG SUỐT SIÊU SÁNG, TINH KHIẾT NHƯ PHA LÊ CAO CẤP (ultra bright pristine white crystal glass, high-key white studio backlight, 100% luminous transparency).
   - TUYỆT ĐỐI KHÔNG CÓ SƯƠNG MỜ, KHÔNG XÁM ĐỤC, KHÔNG NÂU MỜ (ZERO GREY HAZE, ZERO FOG OPACITY, NO BROWN OR GREY SHADOW INSIDE GLASS BODY). Vùng kính không in phải xuyên sáng tinh khiết với ánh sáng trắng tươi từ bối cảnh.
   - ĐƯỜNG VÁT CẠNH KÍNH LẮP LÁNH SẮC NÉT (SPARKLING PRISMATIC BEVELED EDGE): Viền đĩa kính tròn có các vạt vát kim cương lấp lánh (diamond-cut beveled glass facets, bright white specular edge highlights, crystal rim light) rõ nét, cực kỳ sang trọng y hệt ảnh mẫu chuẩn.
   - MÀU SẮC TƯƠI TẮN & ĐỘ TƯƠNG PHẢN ĐẬM ĐÀ (VIVID RICH COLOR SATURATION - NOT WASHED OUT OR PALE): Màu sắc của thiết kế in (màu hồng, đỏ, bạc...), màu hộp quà đỏ rực và màu xanh cành thông phải đạt độ bão hòa rực rỡ, tương phản tươi tắn sắc nét, TUYỆT ĐỐI KHÔNG bị nhợt nhạt hay cháy sáng mờ nhạt.

2. NẾU SẢN PHẨM TRONG ẢNH 1 LÀ SẢN PHẨM ĐỤC / GỖ / CERAMIC / RESIN / KIM LOẠI / VẢI (NON-GLASS PRODUCT - NHƯ SẢN PHẨM GỖ KHUÔN NEW JERSEY TRONG ẢNH 3):
   - TUYỆT ĐỐI KHÔNG BIẾN SẢN PHẨM THÀNH KÍNH TRONG SUỐT HAY ACRYLIC TRONG SUỐT! KHÔNG TỰ Ý GẮN VIỀN KÍNH VÁT CẠNH!
   - GIỮ NGUYÊN 100% CHẤT LIỆU ĐỤC VỐN CÓ TỪ ẢNH 1: viền gỗ sẫm màu (dark wood edge/border), vân gỗ tự nhiên (wood grain texture), bề mặt đục, texture và finish nguyên bản của Ảnh 1.
   - Bề mặt nền không in giữ đúng màu sắc, độ đục và texture nền đục ban đầu của vật liệu gỗ/ceramic/resin.

QUAN TRỌNG VỀ CHẤT LIỆU & PHÂN TÍCH ẢNH 1:
- Chủ động phân tích trực tiếp Ảnh 1 để nhận biết chất liệu qua texture, độ trong/đục, độ bóng/mờ, phản xạ, cấu tạo bề mặt và kiểu cạnh; không yêu cầu mô tả thẻ phải ghi vật liệu.
- Chỉ dùng tên sản phẩm hoặc thông tin bổ sung để hỗ trợ khi chúng thực sự nêu rõ chất liệu; dòng kích thước không phải là thông tin vật liệu.
- Nếu không thể kết luận chắc chắn chất liệu, giữ nguyên diện mạo vật lý quan sát được trong Ảnh 1 và không tự gán một chất liệu cụ thể.
- Sản phẩm có thể làm từ glass, acrylic, gỗ, kim loại, ceramic, nhựa, vải hoặc chất liệu khác.
- KHÔNG mặc định sản phẩm là glass/acrylic, pha lê hoặc trong suốt nếu dữ liệu tham chiếu không xác nhận điều đó.
- Giữ đúng độ trong suốt hoặc độ đục, màu nền vật liệu, texture, độ bóng/mờ, độ dày và kiểu cạnh của sản phẩm gốc.

LƯU Ý NGUYÊN TẮC QUAN TRỌNG:
- Phân biệt chính xác phần thiết kế in với màu sắc/texture vốn có của vật liệu nền.
- Với vật liệu trong suốt: chỉ vùng thực sự không được in mới nhìn xuyên qua background mới; tái hiện khúc xạ và phản xạ tự nhiên.
- Với vật liệu đục: giữ đúng màu và texture của bề mặt, không biến vùng không in thành trong suốt.
- Với bề mặt gỗ, kim loại, ceramic, nhựa hoặc vải: tái hiện đúng grain, reflection, glaze, texture và finish tương ứng; không biến chúng thành kính.
- Không tự ý xóa nền vật liệu, đổi chất liệu hoặc thêm hiệu ứng trong suốt không có trong dữ liệu tham chiếu.

CẠNH SẢN PHẨM:
Giữ đúng độ dày, hình dạng và kiểu hoàn thiện cạnh của sản phẩm tham chiếu.
Chỉ tạo bevel, refraction, metallic reflection, wood grain hoặc đường may khi phù hợp với chất liệu thực tế.
Highlight và phản xạ phải tự nhiên, không làm thay đổi bản chất vật liệu.

ÁNH SÁNG:
Sử dụng phong cách chụp sản phẩm high-key, sáng và sạch.
Ánh sáng phải làm nổi bật texture và finish thực tế của chất liệu mà không làm đổi màu sản phẩm.
Chỉ dùng backlight xuyên thấu, specular highlight mạnh hoặc hiệu ứng lấp lánh khi phù hợp với chất liệu.
Không phủ màu vàng, amber, orange hoặc muddy lên toàn bộ sản phẩm.

DYNAMIC OCCASION, THEME & ENVIRONMENT ADAPTABILITY (AI QUÉT ẢNH 1 VÀ TỰ ĐÁNH GIÁ CHỦ ĐỀ ĐỂ TẠO BỐI CẢNH):
- AI VISION QUÉT TRỰC TIẾP ẢNH 1 ĐỂ NHẬN DIỆN CHỦ ĐỀ (AUTOMATIC VISUAL THEME EVALUATION FROM IMAGE 1):
  * Bản đồ Bang Mỹ / Thành phố / Du lịch (State Outline / Map / New Jersey / Texas...): Tự nhận diện khuôn bản đồ bang/tên bang như "New Jersey" -> Ưu tiên bối cảnh gương chiếu hậu ô tô nhìn ra cung đường du lịch (scenic highway/road trip view) hoặc bối cảnh phòng khách ấm áp thể hiện niềm tự hào quê hương (Home State pride).
  * Chó / Mèo / Thú cưng (Dog/Pet Lover): Tự nhận diện hình chú chó/mèo/chữ "Dog Mom" -> Tạo bối cảnh phòng khách ấm cúng, sofa, thảm plush sáng hoặc góc thảm thanh lịch.
  * Đám cưới / Kỷ niệm (Wedding/Anniversary): Tự nhận diện cô dâu chú rể/chữ "Mr & Mrs", "Our First Christmas" -> Tạo bối cảnh lãng mạn nhẹ nhàng, thảm lụa champagne, hoa nhàn nhạt, bàn gỗ sáng.
  * Em bé mới sinh (New Baby/Baby's 1st): Tự nhận diện đôi chân em bé/chữ "Baby First" -> Tạo bối cảnh nôi trẻ em, phòng baby tone pastel sáng mịn, nơ lụa mềm mại.
  * Ngành nghề (Y tế/Y tá, Giáo viên, Cảnh sát, Lính hỏa hoạn...): Tự nhận diện biểu tượng ngành nghề -> Tạo bối cảnh góc làm việc thanh lịch, bàn sách gỗ sáng, phụ kiện ngành nghề.
  * Thể thao / Câu cá / Dã ngoại (Fishing, Golf, Camping...): Tự nhận diện cần câu/lều/con cá -> Tạo bối cảnh thiên nhiên mộc mạc ngoài trời, bàn gỗ tự nhiên, không gian dã ngoại.
  * Tưởng niệm / Tình cảm gia đình (Memorial, Angel, Family, Grandma...): Tự nhận diện cánh thiên thần/chữ "In Loving Memory" -> Tạo bối cảnh ấm cúng gần cửa sổ nắng ban mai, nến thơm, hoa khô thanh lịch.
  * Giáng Sinh / Lễ hội (Christmas/Holiday): Tự nhận diện biểu tượng Noel -> Tạo bối cảnh cành thông xanh tươi, đèn bokeh Giáng sinh lung linh, hộp quà rực rỡ.
- CHỈ ĐỊNH NGHIÊM NGẶT: AI PHẢI QUÉT VÀ ĐÁNH GIÁ CHỦ ĐỀ TỪ ẢNH 1. Tuyệt đối KHÔNG gán nền Giáng sinh/cây thông cho các sản phẩm không có yếu tố Giáng sinh hoặc sản phẩm dùng quanh năm!
- Bối cảnh phía sau sản phẩm phải sáng, mềm và có shallow depth of field tự nhiên với soft bokeh hài hòa.
- Không đặt một mảng tối hoặc vật thể tối phủ kín ngay phía sau toàn bộ sản phẩm.

Giữ thiết kế in rõ nét và trung thành với ảnh tham chiếu.
Không tự ý thay đổi nội dung chữ, hình minh họa hoặc bố cục thiết kế.

Mục tiêu hình ảnh:
commercial product photography,
material-accurate rendering,
faithful opacity and surface texture,
physically appropriate highlights and reflections,
clean professional studio rim light.

Concept: ${concept}${dimensionsLine}${refinementLine}`;
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
  const fallback = isGeminiImage ? 1 : 3;
  const parsed = Number(configured || fallback);
  const maxAllowed = isCheapKeyAI ? 3 : 6;
  return Number.isFinite(parsed)
    ? Math.min(maxAllowed, Math.max(1, Math.round(parsed)))
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
