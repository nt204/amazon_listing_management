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
    assert.equal(call.body.output_format, "png");
    assert.ok(
      call.body.image,
      "the source artwork file should be sent to images.edit",
    );
    assert.match(String(call.body.prompt), /Preserve the printed face exactly as shown/i);
    assert.equal(call.options?.maxRetries, 0);
  }
});

test("GPT Image 1.5 is forwarded to the same image edit pipeline", async () => {
  const models: unknown[] = [];
  const fakeClient = {
    images: {
      edit: async (body: Record<string, unknown>) => {
        models.push(body.model);
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
  assert.deepEqual(models, Array(6).fill("gpt-image-1.5"));
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

test("mockup prompts explicitly protect source artwork", () => {
  const prompt = buildMockupPrompt("gift_box", "Test Ornament", {
    length: '3.1"',
    width: '3.1"',
    thickness: '0.15"',
    formatted: '3.1" x 3.1" x 0.15"',
  });

  assert.match(prompt, /already shows the finished circular glass ornament/i);
  assert.match(prompt, /Do not redraw or curve the print/i);
  assert.match(prompt, /gift box/i);
  assert.match(prompt, /40-45% of the frame/i);
  assert.match(prompt, /not CGI or a poster/i);
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
