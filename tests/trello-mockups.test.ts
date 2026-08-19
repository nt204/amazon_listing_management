import test from "node:test";
import assert from "node:assert/strict";
import type OpenAI from "openai";
import type { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import { parseCardDimensions } from "../lib/trello";
import {
  buildMockupPrompt,
  classifyMockupGenerationError,
  generateAllMockups,
  mockupIndexFromAttachmentName,
} from "../lib/mockup-generator";

const SAMPLE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("parseCardDimensions should extract 3D dimensions correctly", () => {
  const desc1 = 'Kích thước 3 chiều: 3.1" x 3.1" x 0.15" (Dài x Rộng x Dày)';
  const result1 = parseCardDimensions(desc1);
  assert.equal(result1.length, '3.1"');
  assert.equal(result1.width, '3.1"');
  assert.equal(result1.thickness, '0.15"');
  assert.equal(result1.formatted, '3.1" x 3.1" x 0.15"');

  const desc2 = "Dimensions: 8cm x 8cm x 0.4cm";
  const result2 = parseCardDimensions(desc2);
  assert.equal(result2.length, "8cm");
  assert.equal(result2.width, "8cm");
  assert.equal(result2.thickness, "0.4cm");
  assert.equal(result2.formatted, "8cm x 8cm x 0.4cm");
});

test("parseCardDimensions accepts smart inch quotes and two-dimensional products", () => {
  const result = parseCardDimensions("Kích thước: 5.9” x 5.9”");

  assert.deepEqual(result, {
    length: '5.9"',
    width: '5.9"',
    thickness: "",
    formatted: '5.9" x 5.9"',
  });
});

test("parseCardDimensions accepts smart quotes, multiplication symbols, and mixed units", () => {
  const result = parseCardDimensions("Kích thước: 4” × 4” × 0.4mm");

  assert.deepEqual(result, {
    length: '4"',
    width: '4"',
    thickness: "0.4mm",
    formatted: '4" x 4" x 0.4mm',
  });
});

test("parseCardDimensions separates capacity from physical dimensions", () => {
  const result = parseCardDimensions("Kích thước: 11” x 2.6” x 11 oz");

  assert.deepEqual(result, {
    length: '11"',
    width: '2.6"',
    thickness: "",
    capacity: "11 oz",
    formatted: '11" x 2.6" • 11 oz',
  });
});

test("parseCardDimensions reads labeled measurements and does not invent ornament defaults", () => {
  assert.deepEqual(
    parseCardDimensions("Chiều cao: 12 in; Chiều rộng: 8 in; Độ dày: 6 mm; Dung tích: 20 oz"),
    {
      length: '12"',
      width: '8"',
      thickness: "6mm",
      capacity: "20 oz",
      formatted: '12" x 8" x 6mm • 20 oz',
    },
  );
  assert.deepEqual(parseCardDimensions("Không có thông tin kích thước"), {
    length: "",
    width: "",
    thickness: "",
    formatted: "",
  });
});

test("generateAllMockups should produce 7 mockup results", async () => {
  const mockups = await generateAllMockups({
    sku: "TESTSKU01",
    itemName: "Test Glass Ornament",
    dimensions: {
      length: '3.1"',
      width: '3.1"',
      thickness: '0.15"',
      formatted: '3.1" x 3.1" x 0.15"',
    },
    inputDesignBuffer: SAMPLE_PNG,
    inputMimeType: "image/png",
    model: "fast-graphic",
  });

  assert.equal(mockups.length, 7);
  assert.equal(mockups[0].index, 1);
  assert.equal(mockups[6].index, 7);

  for (const m of mockups) {
    assert.ok(
      m.buffer.length > 0,
      `Buffer for mockup ${m.index} should not be empty`,
    );
    assert.ok(m.name.length > 0, `Name for mockup ${m.index} should exist`);
  }
});

test("GPT Image mockups use the edit API with the source artwork", async () => {
  const calls: Array<{
    body: Record<string, unknown>;
    options?: Record<string, unknown>;
  }> = [];
  const fakeClient = {
    images: {
      edit: async (
        body: Record<string, unknown>,
        options?: Record<string, unknown>,
      ) => {
        calls.push({ body, options });
        return {
          created: 0,
          data: [{ b64_json: SAMPLE_PNG.toString("base64") }],
        };
      },
    },
  } as unknown as OpenAI;

  const mockups = await generateAllMockups({
    sku: "TESTSKU01",
    itemName: "Test Glass Ornament",
    dimensions: {
      length: '3.1"',
      width: '3.1"',
      thickness: '0.15"',
      formatted: '3.1" x 3.1" x 0.15"',
    },
    inputDesignBuffer: SAMPLE_PNG,
    inputMimeType: "image/png",
    model: "gpt-image-2",
    quality: "low",
    openaiClient: fakeClient,
  });

  assert.equal(mockups.length, 7);
  assert.equal(calls.length, 6, "mockups 2-7 should all use GPT Image Edit");
  for (const call of calls) {
    assert.equal(call.body.model, "gpt-image-2");
    assert.equal(call.body.quality, "low");
    assert.equal(call.body.size, "1024x1024");
    assert.equal(call.body.input_fidelity, undefined);
    assert.equal(call.body.output_format, "png");
    assert.equal(call.body.response_format, undefined);
    assert.ok(
      call.body.image,
      "the source artwork file should be sent to images.edit",
    );
    assert.match(String(call.body.prompt), /Sử dụng Ảnh 1 làm ảnh tham chiếu cho sản phẩm "Test Glass Ornament"/i);
    assert.equal(call.options?.maxRetries, 0);
  }
});

test("GPT Image 1.5 is forwarded to the same image edit pipeline", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const fakeClient = {
    images: {
      edit: async (body: Record<string, unknown>) => {
        calls.push(body);
        return { data: [{ b64_json: SAMPLE_PNG.toString("base64") }] };
      },
    },
  } as unknown as OpenAI;

  const mockups = await generateAllMockups({
    sku: "TESTSKU15",
    itemName: "Test Glass Ornament",
    dimensions: {
      length: '3.1"',
      width: '3.1"',
      thickness: '0.15"',
      formatted: '3.1" x 3.1" x 0.15"',
    },
    inputDesignBuffer: SAMPLE_PNG,
    inputMimeType: "image/png",
    model: "gpt-image-1.5",
    quality: "high",
    openaiClient: fakeClient,
  });

  assert.equal(mockups.length, 7);
  assert.equal(calls.length, 6);
  for (const call of calls) {
    assert.equal(call.model, "gpt-image-1.5");
    assert.equal(call.quality, "high");
    assert.equal(call.size, "1024x1024");
    assert.equal(call.input_fidelity, "high");
  }
});

test("gpt-image-2-c is routed through the CheapKeyAI image edit provider", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const fakeClient = {
    images: {
      edit: async (body: Record<string, unknown>) => {
        calls.push(body);
        return {
          _request_id: "req_cheapkeyai_4",
          size: "1024x1024",
          usage: {
            input_tokens: 120,
            input_tokens_details: { image_tokens: 100, text_tokens: 20 },
            output_tokens: 272,
            total_tokens: 392,
          },
          data: [{ b64_json: SAMPLE_PNG.toString("base64") }],
        };
      },
    },
  } as unknown as OpenAI;

  const mockups = await generateAllMockups({
    sku: "TESTCHEAP",
    itemName: "Test Glass Ornament",
    dimensions: {
      length: '3.1"',
      width: '3.1"',
      thickness: '0.15"',
      formatted: '3.1" x 3.1" x 0.15"',
    },
    inputDesignBuffer: SAMPLE_PNG,
    inputMimeType: "image/png",
    model: "gpt-image-2-c",
    quality: "low",
    selectedIndexes: [4],
    openaiClient: fakeClient,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "gpt-image-2-c");
  assert.equal(calls[0].quality, "low");
  assert.equal(calls[0].input_fidelity, "high");
  assert.equal(calls[0].response_format, undefined);
  assert.ok(calls[0].image);
  assert.deepEqual(
    mockups.map((mockup) => mockup.index),
    [4],
  );
  assert.equal(mockups[0].providerTrace?.provider, "cheapkeyai");
  assert.equal(mockups[0].providerTrace?.model, "gpt-image-2-c");
  assert.equal(mockups[0].providerTrace?.inputFidelity, "high");
  assert.equal(mockups[0].providerTrace?.estimatedCostUsd, 0.005);
});

test("CheapKeyAI client uses its own key and the image edits endpoint", async () => {
  const previousFetch = globalThis.fetch;
  const previousCheapKey = process.env.CHEAPKEYAI_API_KEY;
  const previousCheapBaseUrl = process.env.CHEAPKEYAI_BASE_URL;
  const previousOpenAIKey = process.env.OPENAI_API_KEY;
  let requestUrl = "";
  let authorization = "";
  let upstreamModel: FormDataEntryValue | null = null;
  let inputFidelity: FormDataEntryValue | null = null;
  let responseFormat: FormDataEntryValue | null = null;

  process.env.CHEAPKEYAI_API_KEY = "sk-cheapkeyai-test-only";
  process.env.OPENAI_API_KEY = "sk-openai-must-not-be-used";
  delete process.env.CHEAPKEYAI_BASE_URL;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    requestUrl = input instanceof Request ? input.url : String(input);
    const headers = new Headers(
      input instanceof Request ? input.headers : init?.headers,
    );
    authorization = headers.get("authorization") || "";
    const body = input instanceof Request ? input.clone().body : init?.body;
    if (body instanceof FormData) {
      upstreamModel = body.get("model");
      inputFidelity = body.get("input_fidelity");
      responseFormat = body.get("response_format");
    }

    return new Response(
      JSON.stringify({
        created: 0,
        size: "1024x1024",
        data: [{ b64_json: SAMPLE_PNG.toString("base64") }],
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req_cheapkeyai_http",
        },
      },
    );
  }) as typeof fetch;

  try {
    await generateAllMockups({
      sku: "TESTCHEAPHTTP",
      itemName: "Test Glass Ornament",
      dimensions: {
        length: '3.1"',
        width: '3.1"',
        thickness: '0.15"',
        formatted: '3.1" x 3.1" x 0.15"',
      },
      inputDesignBuffer: SAMPLE_PNG,
      inputMimeType: "image/png",
      model: "gpt-image-2-c",
      quality: "low",
      selectedIndexes: [4],
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCheapKey === undefined) delete process.env.CHEAPKEYAI_API_KEY;
    else process.env.CHEAPKEYAI_API_KEY = previousCheapKey;
    if (previousCheapBaseUrl === undefined)
      delete process.env.CHEAPKEYAI_BASE_URL;
    else process.env.CHEAPKEYAI_BASE_URL = previousCheapBaseUrl;
    if (previousOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAIKey;
  }

  assert.equal(requestUrl, "https://cheapkeyai.shop/v1/images/edits");
  assert.equal(authorization, "Bearer sk-cheapkeyai-test-only");
  assert.equal(upstreamModel, "gpt-image-2-c");
  assert.equal(inputFidelity, "high");
  assert.equal(responseFormat, null);
});

test("one selected concept makes exactly one provider request and records its trace", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const fakeClient = {
    images: {
      edit: async (body: Record<string, unknown>) => {
        calls.push(body);
        return {
          _request_id: "req_mockup_2",
          size: "1024x1024",
          usage: {
            input_tokens: 120,
            input_tokens_details: { image_tokens: 100, text_tokens: 20 },
            output_tokens: 272,
            total_tokens: 392,
          },
          data: [{ b64_json: SAMPLE_PNG.toString("base64") }],
        };
      },
    },
  } as unknown as OpenAI;

  const mockups = await generateAllMockups({
    sku: "TESTONE",
    itemName: "Test Glass Ornament",
    dimensions: {
      length: '3.1"',
      width: '3.1"',
      thickness: '0.15"',
      formatted: '3.1" x 3.1" x 0.15"',
    },
    inputDesignBuffer: SAMPLE_PNG,
    inputMimeType: "image/png",
    model: "gpt-image-1.5",
    quality: "low",
    selectedIndexes: [2],
    openaiClient: fakeClient,
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(
    mockups.map((mockup) => mockup.index),
    [2],
  );
  assert.deepEqual(mockups[0].providerTrace, {
    provider: "openai",
    requestId: "req_mockup_2",
    model: "gpt-image-1.5",
    quality: "low",
    size: "1024x1024",
    imageCount: 1,
    inputFidelity: "low",
    estimatedCostUsd: 0.009604,
    usage: {
      inputTokens: 120,
      inputImageTokens: 100,
      inputTextTokens: 20,
      outputTokens: 272,
      totalTokens: 392,
    },
  });
});

test("a provider failure waits for started image edits before releasing generation", async () => {
  let calls = 0;
  let rejectFirstCall: ((reason?: unknown) => void) | undefined;
  let resolveInitialWindow: (() => void) | undefined;
  const initialWindowStarted = new Promise<void>((resolve) => {
    resolveInitialWindow = resolve;
  });
  const pendingResolvers: Array<() => void> = [];
  const fakeClient = {
    images: {
      edit: async () => {
        calls += 1;
        if (calls === 3) resolveInitialWindow?.();
        if (calls === 1) {
          await new Promise<never>((_resolve, reject) => {
            rejectFirstCall = reject;
          });
        }
        await new Promise<void>((resolve) => pendingResolvers.push(resolve));
        return { data: [{ b64_json: SAMPLE_PNG.toString("base64") }] };
      },
    },
  } as unknown as OpenAI;

  const generation = generateAllMockups({
    sku: "TESTLOCK",
    itemName: "Test Glass Ornament",
    dimensions: {
      length: '3.1"',
      width: '3.1"',
      thickness: '0.15"',
      formatted: '3.1" x 3.1" x 0.15"',
    },
    inputDesignBuffer: SAMPLE_PNG,
    inputMimeType: "image/png",
    model: "gpt-image-1.5",
    quality: "low",
    openaiClient: fakeClient,
  });

  let startupTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      initialWindowStarted,
      new Promise<void>((_resolve, reject) => {
        startupTimeout = setTimeout(
          () => reject(new Error("initial concurrency window did not start")),
          1_000,
        );
      }),
    ]);
  } finally {
    if (startupTimeout) clearTimeout(startupTimeout);
  }
  assert.equal(calls, 3, "only the initial concurrency window may start");

  let settled = false;
  void generation.catch(() => {
    settled = true;
  });
  rejectFirstCall?.(new Error("provider failed"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "generation must await in-flight edits");

  for (const resolve of pendingResolvers) resolve();
  await assert.rejects(generation, /provider failed/);
  assert.equal(calls, 3, "no later concept starts after a provider failure");
});

test("mockup generation defaults to GPT Image 2 (CheapKeyAI) with low output and input fidelity", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const fakeClient = {
    images: {
      edit: async (body: Record<string, unknown>) => {
        calls.push(body);
        return { data: [{ b64_json: SAMPLE_PNG.toString("base64") }] };
      },
    },
  } as unknown as OpenAI;

  const previousQuality = process.env.OPENAI_IMAGE_QUALITY;
  delete process.env.OPENAI_IMAGE_QUALITY;
  try {
    await generateAllMockups({
      sku: "TESTDEFAULT",
      itemName: "Test Glass Ornament",
      dimensions: {
        length: '3.1"',
        width: '3.1"',
        thickness: '0.15"',
        formatted: '3.1" x 3.1" x 0.15"',
      },
      inputDesignBuffer: SAMPLE_PNG,
      inputMimeType: "image/png",
      openaiClient: fakeClient,
    });
  } finally {
    if (previousQuality === undefined) delete process.env.OPENAI_IMAGE_QUALITY;
    else process.env.OPENAI_IMAGE_QUALITY = previousQuality;
  }

  assert.equal(calls.length, 6);
  for (const call of calls) {
    assert.equal(call.model, "gpt-image-2");
    assert.equal(call.quality, "low");
    assert.equal(call.size, "1024x1024");
    assert.equal(call.input_fidelity, "high");
  }
});

test("generated JPEG mockups retain provider bytes without another lossy encode", async () => {
  const providerJpeg = await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 3,
      background: { r: 20, g: 80, b: 160 },
    },
  })
    .jpeg({ quality: 91 })
    .toBuffer();
  const fakeClient = {
    models: {
      generateContent: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    data: providerJpeg.toString("base64"),
                    mimeType: "image/jpeg",
                  },
                },
              ],
            },
          },
        ],
      }),
    },
  } as unknown as GoogleGenAI;

  const mockups = await generateAllMockups({
    sku: "TESTSKU01",
    itemName: "Test Glass Ornament",
    dimensions: {
      length: '3.1"',
      width: '3.1"',
      thickness: '0.15"',
      formatted: '3.1" x 3.1" x 0.15"',
    },
    inputDesignBuffer: SAMPLE_PNG,
    inputMimeType: "image/png",
    model: "gemini-3.1-flash-image",
    geminiClient: fakeClient,
  });

  for (const mockup of mockups.slice(1)) {
    assert.equal(mockup.mimeType, "image/jpeg");
    assert.match(mockup.type, /\.jpg$/);
    assert.deepEqual(mockup.buffer, providerJpeg);
  }
});

test("mockup prompts contain only the generation request and scene concept", () => {
  const prompt = buildMockupPrompt("gift_box", "Test Ornament", {
    length: '3.1"',
    width: '3.1"',
    thickness: '0.15"',
    formatted: '3.1" x 3.1" x 0.15"',
  });

  assert.match(prompt, /KHÔNG mặc định sản phẩm là glass\/acrylic/i);
  assert.match(prompt, /phân tích trực tiếp Ảnh 1/i);
  assert.match(prompt, /dòng kích thước không phải là thông tin vật liệu/i);
  assert.match(prompt, /material-accurate rendering/i);
  assert.doesNotMatch(prompt, /100% WATER-CLEAR GLASS/i);
  assert.match(prompt, /Concept: PACKAGE INCLUDED gift-box flat-lay/);
  assert.match(prompt, /one open square red gift-box base/i);
  assert.match(prompt, /"1 - Ornament"/);

  const treePrompt = buildMockupPrompt("tree_view1", "Test Ornament", {
    length: '3.1"',
    width: '3.1"',
    thickness: '0.15"',
    formatted: '3.1" x 3.1" x 0.15"',
  });
  assert.match(treePrompt, /Concept: Sản phẩm treo trên nhánh cây thông/);

  const giftingPrompt = buildMockupPrompt("gifting_hands", "Test Ornament", {
    length: '3.1"',
    width: '3.1"',
    thickness: '0.15"',
    formatted: '3.1" x 3.1" x 0.15"',
  });
  assert.match(giftingPrompt, /Concept: PERFECT GIFT HAND-TO-HAND ORNAMENT PRESENTATION/);
  assert.match(giftingPrompt, /TWO realistic female hands presenting the ornament/i);

  const dimensionPrompt = buildMockupPrompt(
    "dimensions_3d",
    "Test Ornament",
    {
      length: '3.1"',
      width: '3.1"',
      thickness: '0.15"',
      formatted: '3.1" x 3.1" x 0.15"',
    },
  );
  assert.match(dimensionPrompt, /Kích thước 3 chiều: 3\.1" x 3\.1" x 0\.15"\./);
  assert.match(dimensionPrompt, /Concept: Product Size & Thickness Infographic Photography/);
  assert.doesNotMatch(dimensionPrompt, /transparent crystal glass disc/i);
});

test("mockup prompts include product material context from the source card", () => {
  const prompt = buildMockupPrompt(
    "gift_box",
    "Wooden Ornament",
    {
      length: '3.1"',
      width: '3.1"',
      thickness: '0.15"',
      formatted: '3.1" x 3.1" x 0.15"',
    },
    "Material: natural birch wood; Finish: matte",
  );

  assert.match(prompt, /Material: natural birch wood; Finish: matte/);
  assert.match(prompt, /không biến chúng thành kính/i);
});

test("hanging ornament prompts lock material from the Trello title or description", () => {
  const dimensions = {
    length: '3.3"',
    width: '3.1"',
    thickness: '0.15"',
    formatted: '3.3" x 3.1" x 0.15"',
  };
  const glassPrompt = buildMockupPrompt(
    "universal_dimensions",
    "Glass Ornament Heart",
    dimensions,
    'Kích thước: 3.3” x 3.1” x 0.15”',
  );
  assert.match(glassPrompt, /được xác nhận là GLASS ORNAMENT/i);
  assert.match(glassPrompt, /không được ghi đè/i);
  assert.match(glassPrompt, /bất kỳ silhouette nào như trái tim/i);
  assert.match(glassPrompt, /NEVER use blue, navy, cyan, teal/i);

  const woodPrompt = buildMockupPrompt(
    "universal_dimensions",
    "Mr Mrs Wooden Ornament",
    dimensions,
    "generic keywords: anniversary glass ornament keepsake",
  );
  assert.match(woodPrompt, /được xác nhận là GỖ \/ WOOD/i);
  assert.doesNotMatch(woodPrompt, /được xác nhận là GLASS ORNAMENT/i);
});

test("custom mockup prompts use the operator-provided scene", () => {
  const prompt = buildMockupPrompt(
    "custom:Minimalist living room shelf",
    "Test Ornament",
    {
      length: '3.1"',
      width: '3.1"',
      thickness: '0.15"',
      formatted: '3.1" x 3.1" x 0.15"',
    },
  );

  assert.match(prompt, /Minimalist living room shelf/i);
});

test("Square Ceramic Keepsake Plate Mockup 3 custom prompt is built correctly", () => {
  const customPromptText =
    "Front-facing plus slightly elevated isometric 3D view of the exact ceramic plate blank, clearly showing overall width, height, curved corner profile, and plate depth; clean professional dimension callout arrows along horizontal, vertical, and side-depth directions.";

  const prompt = buildMockupPrompt(
    `custom:${customPromptText}`,
    "Square Ceramic Keepsake Plate",
    {
      length: '4.0"',
      width: '4.0"',
      thickness: '0.4"',
      formatted: '4.0" x 4.0"',
    },
  );

  assert.match(prompt, /Front-facing plus slightly elevated isometric 3D view/i);
  assert.match(prompt, /clearly showing overall width, height/i);
  assert.match(prompt, /TUYỆT ĐỐI KHÔNG TỰ Ý THÊM DÂY TREO/i);
});

test("buildMockupPrompt generates detailed prompts for Bullet Tumbler prompt keys", () => {
  const dimensions = {
    length: '11"',
    width: '2.6"',
    thickness: '0.1"',
    formatted: '11" x 2.6"',
  };

  const insulationPrompt = buildMockupPrompt("bullet_insulation_box", "Navy Bullet Tumbler", dimensions);
  assert.match(insulationPrompt, /UPGRADED VACUUM INSULATION & GIFT BOX INFOGRAPHIC/i);
  assert.match(insulationPrompt, /BULLET TUMBLER/i);
  assert.match(insulationPrompt, /11 HRS COLD/i);

  const capacityPrompt = buildMockupPrompt("bullet_capacity_size", "Navy Bullet Tumbler", dimensions);
  assert.match(capacityPrompt, /17OZ CAPACITY & 3D DIMENSION INFOGRAPHIC/i);
  assert.match(capacityPrompt, /Safety Guaranteed/i);
  assert.match(capacityPrompt, /Keep Cold For 12 H/i);

  const pressLidPrompt = buildMockupPrompt("bullet_press_lid_pour", "Navy Bullet Tumbler", dimensions);
  assert.match(pressLidPrompt, /DOUBLE WALL INSULATION & PRESS TO OPEN LID INFOGRAPHIC/i);

  const campingPrompt = buildMockupPrompt("bullet_outdoor_camping", "Navy Bullet Tumbler", dimensions);
  assert.match(campingPrompt, /OUTDOOR CAMPING COFFEE POURING LIFESTYLE/i);

  const carPrompt = buildMockupPrompt("bullet_car_cupholder", "Navy Bullet Tumbler", dimensions);
  assert.match(carPrompt, /CUP HOLDER FRIENDLY CAR TRAVEL LIFESTYLE/i);

  const menGiftingPrompt = buildMockupPrompt("bullet_men_gifting", "Navy Bullet Tumbler", dimensions);
  assert.match(menGiftingPrompt, /HERO LIFESTYLE & GIFTING PRESENTATION/i);

  const fireplacePrompt = buildMockupPrompt("ornament_fireplace_mantle", "Custom Ornament", dimensions);
  assert.match(fireplacePrompt, /COZY FIREPLACE MANTLE & HOLIDAY AMBIENCE/i);

  const windowPrompt = buildMockupPrompt("ornament_sunlit_window", "Custom Ornament", dimensions);
  assert.match(windowPrompt, /SUNLIT WINDOW PANE & SNOWY GARDEN VIEW/i);

  const adaptiveLifePrompt = buildMockupPrompt("ornament_lifestyle_adaptive", "Custom Ornament", dimensions);
  assert.match(adaptiveLifePrompt, /ADAPTIVE OCCASION LIFESTYLE ORNAMENT PHOTOGRAPHY/i);

  const adaptivePkgPrompt = buildMockupPrompt("ornament_package_adaptive", "Custom Ornament", dimensions);
  assert.match(adaptivePkgPrompt, /STANDARD RETAIL GIFT BOX PACKAGING & ACCESSORIES FLAT-LAY/i);

  const slateMainPrompt = buildMockupPrompt("slate_main_white", "Photo Slate Plaque", dimensions);
  assert.match(slateMainPrompt, /HERO MAIN E-COMMERCE PRODUCT PHOTOGRAPHY/i);

  const slateFeaturePrompt = buildMockupPrompt("slate_features_infographic", "Photo Slate Plaque", dimensions);
  assert.match(slateFeaturePrompt, /NATURAL STONE & WATERPROOF INFOGRAPHIC/i);

  const slateDimensionPrompt = buildMockupPrompt("slate_dimensions_size", "Photo Slate Plaque", dimensions);
  assert.match(slateDimensionPrompt, /PRODUCT SIZE & 3D DIMENSIONS INFOGRAPHIC/i);

  const slateStackPrompt = buildMockupPrompt("slate_front_back_stack", "Photo Slate Plaque", dimensions);
  assert.match(slateStackPrompt, /FRONT & BACK SLATE TEXTURE FLAT-LAY/i);
});

test("product prompts use parsed Trello specifications instead of category defaults", () => {
  const tumblerDimensions = parseCardDimensions('Kích thước: 11” x 2.6” x 11 oz');
  const tumblerPrompt = buildMockupPrompt(
    "bullet_capacity_size",
    "Navy Bullet Tumbler",
    tumblerDimensions,
  );
  assert.match(tumblerPrompt, /11 OZ CAPACITY/i);
  assert.match(tumblerPrompt, /labeled "11\""/i);
  assert.match(tumblerPrompt, /labeled "2\.6\""/i);
  assert.doesNotMatch(tumblerPrompt, /17OZ CAPACITY/i);

  const slateDimensions = parseCardDimensions('Kích thước: 5.9” x 5.9”');
  const slatePrompt = buildMockupPrompt(
    "slate_dimensions_size",
    "Photo Slate Plaque",
    slateDimensions,
  );
  assert.match(slatePrompt, /labeled "5\.9\""/i);
  assert.match(slatePrompt, /omit the numeric thickness callout/i);
  assert.doesNotMatch(slatePrompt, /0\.3\"/i);
});

test("buildMockupPrompt generates detailed prompts for Universal Standard 7-Image keys", () => {
  const dimensions = {
    length: '3.5"',
    width: '3.5"',
    thickness: '0.2"',
    formatted: '3.5" x 3.5" x 0.2"',
  };

  const mainPrompt = buildMockupPrompt("universal_main_white", "Custom Mug", dimensions);
  assert.match(mainPrompt, /HERO MAIN E-COMMERCE PRODUCT PHOTOGRAPHY/i);
  assert.match(mainPrompt, /100% PURE SOLID WHITE BACKGROUND/i);
  assert.match(mainPrompt, /80% to 90%/i);

  const lifestylePrompt = buildMockupPrompt("universal_lifestyle", "Custom Mug", dimensions);
  assert.match(lifestylePrompt, /REALISTIC LIFESTYLE & IN-USE PHOTOGRAPHY/i);

  const sizePrompt = buildMockupPrompt("universal_dimensions", "Custom Mug", dimensions);
  assert.match(sizePrompt, /PRODUCT SIZE & INFOGRAPHIC DIMENSIONS/i);

  const featurePrompt = buildMockupPrompt("universal_features_zoom", "Custom Mug", dimensions);
  assert.match(featurePrompt, /EXTREME LOW-ANGLE 3D PERSPECTIVE THICKNESS/i);

  const giftingPrompt = buildMockupPrompt("universal_gifting", "Custom Mug", dimensions);
  assert.match(giftingPrompt, /PERFECT GIFT HAND-TO-HAND PRODUCT PRESENTATION/i);

  const packagingPrompt = buildMockupPrompt("universal_packaging", "Custom Mug", dimensions);
  assert.match(packagingPrompt, /PACKAGE INCLUDED & RETAIL GIFT BOX FLAT-LAY/i);

  const artworkPrompt = buildMockupPrompt("universal_artwork_macro", "Custom Mug", dimensions);
  assert.match(artworkPrompt, /ADAPTIVE THEME GREETING CARD FLAT-LAY/i);
});

test("generateAllMockups generates mockups using Bullet Tumbler custom prompt keys", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const fakeClient = {
    images: {
      edit: async (body: Record<string, unknown>) => {
        calls.push(body);
        return { data: [{ b64_json: SAMPLE_PNG.toString("base64") }] };
      },
    },
  } as unknown as OpenAI;

  const mockups = await generateAllMockups({
    sku: "BULLET-001",
    itemName: "U.S. NAVY Bullet Tumbler",
    dimensions: {
      length: '11"',
      width: '2.6"',
      thickness: '0.1"',
      formatted: '11" x 2.6"',
    },
    inputDesignBuffer: SAMPLE_PNG,
    inputMimeType: "image/png",
    model: "gpt-image-1.5",
    selectedIndexes: [1, 2, 3, 4, 5, 6],
    customMockups: [
      { id: 1, label: "Content 1: Full Design", promptKey: "full_design" },
      { id: 2, label: "Content 2: Upgraded Vacuum Insulation & Box", promptKey: "bullet_insulation_box" },
      { id: 3, label: "Content 3: 17oz Capacity & Size Specs", promptKey: "bullet_capacity_size" },
      { id: 4, label: "Content 4: Press To Open Lid & Cup Pouring", promptKey: "bullet_press_lid_pour" },
      { id: 5, label: "Content 5: Outdoor Camping & Coffee Pouring", promptKey: "bullet_outdoor_camping" },
      { id: 6, label: "Content 6: Car Cup Holder Friendly", promptKey: "bullet_car_cupholder" },
    ],
    openaiClient: fakeClient,
  });

  assert.equal(mockups.length, 6);
  assert.equal(calls.length, 5); // 5 AI calls for mockups 2-6
  assert.match(String(calls[0].prompt), /UPGRADED VACUUM INSULATION & GIFT BOX INFOGRAPHIC/i);
  assert.match(String(calls[1].prompt), /17OZ CAPACITY & 3D DIMENSION INFOGRAPHIC/i);
});

test("custom content is generated and can be recognized for resume", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const fakeClient = {
    images: {
      edit: async (body: Record<string, unknown>) => {
        calls.push(body);
        return { data: [{ b64_json: SAMPLE_PNG.toString("base64") }] };
      },
    },
  } as unknown as OpenAI;

  const mockups = await generateAllMockups({
    sku: "CUSTOM-SKU",
    itemName: "Custom Product",
    dimensions: {
      length: '3.1"',
      width: '3.1"',
      thickness: '0.15"',
      formatted: '3.1" x 3.1" x 0.15"',
    },
    inputDesignBuffer: SAMPLE_PNG,
    inputMimeType: "image/png",
    model: "gpt-image-1.5",
    selectedIndexes: [1, 12],
    customMockups: [{ id: 12, label: "Content 12: Minimalist Shelf" }],
    openaiClient: fakeClient,
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(mockups.map((mockup) => mockup.index), [1, 12]);
  assert.match(mockups[1].type, /^Mockup12_Content-12-Minimalist-Shelf\./);
  assert.match(String(calls[0].prompt), /Minimalist Shelf/i);
  assert.equal(mockupIndexFromAttachmentName(mockups[1].type), 12);
});

test("system mockups are not duplicated when repeated as custom content", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const fakeClient = {
    images: {
      edit: async (body: Record<string, unknown>) => {
        calls.push(body);
        return { data: [{ b64_json: SAMPLE_PNG.toString("base64") }] };
      },
    },
  } as unknown as OpenAI;

  const mockups = await generateAllMockups({
    sku: "NO-DUPLICATES",
    itemName: "Test Ornament",
    dimensions: {
      length: '3.1"',
      width: '3.1"',
      thickness: '0.15"',
      formatted: '3.1" x 3.1" x 0.15"',
    },
    inputDesignBuffer: SAMPLE_PNG,
    inputMimeType: "image/png",
    model: "gpt-image-1.5",
    selectedIndexes: [1, 2, 9],
    customMockups: [{ id: 9, label: "Duplicate Content 9" }],
    openaiClient: fakeClient,
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(mockups.map((mockup) => mockup.index), [1, 2, 9]);
});

test("OpenAI exhausted credit is translated into an actionable error", () => {
  const result = classifyMockupGenerationError({
    status: 429,
    code: "credit_balance_exhausted",
    type: "insufficient_quota",
    message: "You have no credits remaining.",
  });

  assert.deepEqual(result, {
    message:
      "OpenAI API đã hết credit. Hãy nạp credit trong OpenAI Billing hoặc chọn Gemini 3.1 Flash Image để tiếp tục.",
    status: 402,
  });
});

test("gateway insufficient balance is translated into a provider billing error", () => {
  const result = classifyMockupGenerationError({
    status: 402,
    message: "Insufficient balance",
  });

  assert.deepEqual(result, {
    message:
      "Tài khoản API provider đã hết số dư. Hãy nạp thêm credit cho đúng tài khoản/key rồi thử lại.",
    status: 402,
  });
});

test("CheapKeyAI channel routing failures do not suggest a fallback", () => {
  const result = classifyMockupGenerationError({
    status: 500,
    code: "get_channel_failed",
    type: "new_api_error",
    message:
      "分组 default 下模型 gpt-image-2 的可用渠道不存在（retry）",
  });

  assert.deepEqual(result, {
    message:
      "CheapKeyAI chưa có channel khả dụng cho gpt-image-2 trong group của API key này. Hãy đổi/tạo key ở đúng group hoặc gửi request ID trong log cho CheapKeyAI support; hệ thống không fallback sang model khác.",
    status: 503,
  });
});

test("CheapKeyAI channel errors surface the provider request ID", () => {
  const result = classifyMockupGenerationError({
    status: 500,
    code: "get_channel_failed",
    message:
      "分组 default 下模型 gpt-image-2 的可用渠道不存在（retry） (request id: req_image_channel_123)",
  });

  assert.deepEqual(result, {
    message:
      "CheapKeyAI chưa có channel khả dụng cho gpt-image-2 trong group của API key này. Hãy đổi/tạo key ở đúng group hoặc gửi request ID req_image_channel_123 cho CheapKeyAI support; hệ thống không fallback sang model khác.",
    status: 503,
  });
});

test("Gemini depleted prepayment is translated into a billing error", () => {
  const result = classifyMockupGenerationError(
    Object.assign(
      new Error(
        '{"error":{"code":429,"message":"Your prepayment credits are depleted.","status":"RESOURCE_EXHAUSTED"}}',
      ),
      { status: 429 },
    ),
  );

  assert.deepEqual(result, {
    message:
      "Gemini API đã hết credit trả trước. Hãy nạp credit cho đúng project tại https://ai.studio/projects rồi thử lại.",
    status: 402,
  });
});

test("Gemini mockups use bounded retries and report real per-image progress", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const progress: Array<{ step: number; status: string }> = [];
  let activeCalls = 0;
  let maxActiveCalls = 0;
  const fakeClient = {
    models: {
      generateContent: async (body: Record<string, unknown>) => {
        activeCalls += 1;
        maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
        calls.push(body);
        await new Promise((resolve) => setTimeout(resolve, 2));
        activeCalls -= 1;
        return {
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      data: SAMPLE_PNG.toString("base64"),
                      mimeType: "image/png",
                    },
                  },
                ],
              },
            },
          ],
        };
      },
    },
  } as unknown as GoogleGenAI;

  const mockups = await generateAllMockups(
    {
      sku: "TESTSKU01",
      itemName: "Test Glass Ornament",
      dimensions: {
        length: '3.1"',
        width: '3.1"',
        thickness: '0.15"',
        formatted: '3.1" x 3.1" x 0.15"',
      },
      inputDesignBuffer: SAMPLE_PNG,
      inputMimeType: "image/png",
      model: "gemini-3.1-flash-image",
      geminiClient: fakeClient,
    },
    (step, _name, status) => progress.push({ step, status }),
  );

  assert.equal(mockups.length, 7);
  assert.equal(calls.length, 6);
  assert.equal(maxActiveCalls, 1, "Gemini image requests should run sequentially by default");
  for (const call of calls) {
    const config = call.config as {
      responseModalities?: string[];
      httpOptions?: { timeout?: number; retryOptions?: { attempts?: number } };
    };
    assert.deepEqual(config.responseModalities, ["IMAGE"]);
    assert.equal(config.httpOptions?.timeout, 90_000);
    assert.equal(config.httpOptions?.retryOptions?.attempts, 2);
  }

  for (let step = 1; step <= 7; step += 1) {
    assert.deepEqual(
      progress.filter((event) => event.step === step).map((event) => event.status),
      ["processing", "success"],
    );
  }
});

test("transport failures are translated instead of returning a generic 400", () => {
  assert.deepEqual(classifyMockupGenerationError(new TypeError("fetch failed")), {
    message:
      "Kết nối tới API tạo ảnh bị gián đoạn hoặc hết thời gian chờ. Hệ thống đã dừng lần chạy này; hãy thử lại.",
    status: 502,
  });
});

test("Gemini timeout aborts are translated into a connection error", () => {
  assert.deepEqual(
    classifyMockupGenerationError(
      Object.assign(new Error("This operation was aborted"), { code: 20 }),
    ),
    {
      message:
        "Kết nối tới API tạo ảnh bị gián đoạn hoặc hết thời gian chờ. Hệ thống đã dừng lần chạy này; hãy thử lại.",
      status: 502,
    },
  );
});

test("completed Gemini images are handed off immediately before a later image fails", async () => {
  let callNumber = 0;
  const savedIndexes: number[] = [];
  const fakeClient = {
    models: {
      generateContent: async () => {
        callNumber += 1;
        if (callNumber === 4) throw new TypeError("fetch failed");
        return {
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      data: SAMPLE_PNG.toString("base64"),
                      mimeType: "image/png",
                    },
                  },
                ],
              },
            },
          ],
        };
      },
    },
  } as unknown as GoogleGenAI;

  await assert.rejects(
    generateAllMockups({
      sku: "TESTSKU01",
      itemName: "Test Glass Ornament",
      dimensions: {
        length: '3.1"',
        width: '3.1"',
        thickness: '0.15"',
        formatted: '3.1" x 3.1" x 0.15"',
      },
      inputDesignBuffer: SAMPLE_PNG,
      inputMimeType: "image/png",
      model: "gemini-3.1-flash-image",
      geminiClient: fakeClient,
      skipIndexes: [1],
      onMockupReady: (mockup) => {
        savedIndexes.push(mockup.index);
      },
    }),
    /fetch failed/,
  );

  assert.deepEqual(savedIndexes, [2, 3, 4]);
});

test("resume skips mockups already identified on Trello", async () => {
  let calls = 0;
  const savedIndexes: number[] = [];
  const fakeClient = {
    models: {
      generateContent: async () => {
        calls += 1;
        return {
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      data: SAMPLE_PNG.toString("base64"),
                      mimeType: "image/png",
                    },
                  },
                ],
              },
            },
          ],
        };
      },
    },
  } as unknown as GoogleGenAI;

  await generateAllMockups({
    sku: "TESTSKU01",
    itemName: "Test Glass Ornament",
    dimensions: {
      length: '3.1"',
      width: '3.1"',
      thickness: '0.15"',
      formatted: '3.1" x 3.1" x 0.15"',
    },
    inputDesignBuffer: SAMPLE_PNG,
    inputMimeType: "image/png",
    model: "gemini-3.1-flash-image",
    geminiClient: fakeClient,
    skipIndexes: [1, 2, 3, 4],
    onMockupReady: (mockup) => {
      savedIndexes.push(mockup.index);
    },
  });

  assert.equal(calls, 3);
  assert.deepEqual(savedIndexes, [5, 6, 7]);
  assert.equal(mockupIndexFromAttachmentName("Mockup4_ChristmasTree_View1.png"), 4);
  assert.equal(mockupIndexFromAttachmentName("ONVT0607NT01_FullDesign.jpg"), null);
});

test("isChatGPTWebModel and parseChatGPTCookies handle web automation configuration", async () => {
  const { isChatGPTWebModel } = await import("../lib/mockup-generator");
  const { parseChatGPTCookies } = await import("../lib/chatgpt-web-automation");

  assert.equal(isChatGPTWebModel("chatgpt-web-automation"), true);
  assert.equal(isChatGPTWebModel("gpt-image-1.5"), false);

  const headerCookies = parseChatGPTCookies("session_id=12345; cf_clearance=abc", "my-session-token");
  assert.equal(headerCookies.length, 3);
  assert.equal(headerCookies[0].name, "session_id");
  assert.equal(headerCookies[0].value, "12345");
  assert.equal(headerCookies[2].name, "__Secure-next-auth.session-token");
  assert.equal(headerCookies[2].value, "my-session-token");

  const jsonCookies = parseChatGPTCookies(JSON.stringify([{ name: "test_cookie", value: "xyz" }]));
  assert.equal(jsonCookies.length, 1);
  assert.equal(jsonCookies[0].name, "test_cookie");
  assert.equal(jsonCookies[0].value, "xyz");

  const commaCookies = parseChatGPTCookies("val0_abc,val1_xyz");
  assert.equal(commaCookies.length, 2);
  assert.equal(commaCookies[0].name, "__Secure-next-auth.session-token.0");
  assert.equal(commaCookies[0].value, "val0_abc");
  assert.equal(commaCookies[1].name, "__Secure-next-auth.session-token.1");
  assert.equal(commaCookies[1].value, "val1_xyz");
});
