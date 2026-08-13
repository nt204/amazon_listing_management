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
    assert.ok(
      call.body.image,
      "the source artwork file should be sent to images.edit",
    );
    assert.match(String(call.body.prompt), /Sinh ảnh mockup sản phẩm "Test Glass Ornament" này/i);
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
    [1, 2],
  );
  assert.deepEqual(mockups[1].providerTrace, {
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

test("mockup generation defaults to GPT Image 1.5 with low output and input fidelity", async () => {
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
    assert.equal(call.model, "gpt-image-1.5");
    assert.equal(call.quality, "low");
    assert.equal(call.size, "1024x1024");
    assert.equal(call.input_fidelity, "low");
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

  assert.equal(
    prompt,
    'Sinh ảnh mockup sản phẩm "Test Ornament" này. Giữ đúng vật liệu; tách màu nền khỏi sản phẩm. Sử dụng tông màu tươi sáng.\n\nConcept: Sản phẩm nằm trong hộp quà Giáng Sinh cao cấp đang mở.',
  );

  const treePrompt = buildMockupPrompt("tree_view1", "Test Ornament", {
    length: '3.1"',
    width: '3.1"',
    thickness: '0.15"',
    formatted: '3.1" x 3.1" x 0.15"',
  });
  assert.equal(
    treePrompt,
    'Sinh ảnh mockup sản phẩm "Test Ornament" này. Giữ đúng vật liệu; tách màu nền khỏi sản phẩm. Sử dụng tông màu tươi sáng.\n\nConcept: Sản phẩm treo trên nhánh cây thông Noel.',
  );

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
  assert.equal(
    dimensionPrompt,
    'Sinh ảnh mockup sản phẩm "Test Ornament" này. Giữ đúng vật liệu; tách màu nền khỏi sản phẩm. Sử dụng tông màu tươi sáng.\n\nKích thước 3 chiều: 3.1" x 3.1" x 0.15".\n\nConcept: Ảnh infographic kích thước sản phẩm.',
  );
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
    skipIndexes: [2, 3, 4],
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
