import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { createTemplateMockupPostHandler } from "../lib/template-mockup-route";
import {
  GLASS_ORNAMENT_TEMPLATES,
  renderTemplateMockupWithAi,
} from "../lib/template-mockup";

const TEMPLATE_ID = "glass_perfect_gift";

interface UploadedFileLike {
  name?: string;
  type?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function getTemplate2() {
  const template = GLASS_ORNAMENT_TEMPLATES.find(
    (candidate) => candidate.id === TEMPLATE_ID,
  );
  assert.ok(template, "Template glass_perfect_gift must be defined");
  return template;
}

async function createSolidPng(
  width = 24,
  height = 24,
  color = { r: 80, g: 120, b: 180, alpha: 1 },
) {
  return sharp({
    create: { width, height, channels: 4, background: color },
  })
    .png()
    .toBuffer();
}

function dataUrl(buffer: Buffer, mimeType = "image/png") {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function jsonRequest(body: unknown, headers?: HeadersInit) {
  return new Request("http://localhost/api/template-mockup/generate", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function asRecord(value: unknown) {
  assert.ok(value && typeof value === "object");
  return value as Record<string, unknown>;
}

function asUploadedFiles(value: unknown) {
  assert.ok(Array.isArray(value));
  assert.equal(value.length, 2);
  return value as UploadedFileLike[];
}

test("all Glass Ornament templates point to real AI base-scene assets", () => {
  const template = getTemplate2();
  assert.equal(template.name, "Template 2 - Perfect Gift Idea (Thông Điệp Trao Quà)");
  assert.equal(GLASS_ORNAMENT_TEMPLATES.length, 6);
  for (const candidate of GLASS_ORNAMENT_TEMPLATES) {
    assert.ok(
      fs.existsSync(path.join(process.cwd(), candidate.templateAssetPath)),
      `The AI base template must exist: ${candidate.id}`,
    );
  }
});

test("CheapKeyAI autonomously extracts the source artwork and fits it onto the template surface", async () => {
  const sourceBuffer = await createSolidPng(31, 29, {
    r: 210,
    g: 40,
    b: 20,
    alpha: 1,
  });
  const templateBuffer = await createSolidPng(27, 33, {
    r: 10,
    g: 60,
    b: 190,
    alpha: 1,
  });
  const aiOutput = await createSolidPng(17, 19, {
    r: 20,
    g: 180,
    b: 70,
    alpha: 1,
  });
  const calls: Array<{ body: unknown; requestOptions: unknown }> = [];
  const imageEditClient = {
    images: {
      edit: async (body: unknown, requestOptions?: unknown) => {
        calls.push({ body, requestOptions });
        return { data: [{ b64_json: aiOutput.toString("base64") }] };
      },
    },
  };

  const previousConfiguredModel = process.env.TEMPLATE_MOCKUP_IMAGE_MODEL;
  process.env.TEMPLATE_MOCKUP_IMAGE_MODEL = "gpt-image-1";

  let rendered: Awaited<ReturnType<typeof renderTemplateMockupWithAi>>;
  try {
    rendered = await renderTemplateMockupWithAi({
      templateId: TEMPLATE_ID,
      designBuffer: sourceBuffer,
      templateBuffer,
      quality: "high",
      targetWidth: 2000,
      targetHeight: 2000,
      sourceImageMode: "product-photo",
      imageEditClient,
    });
  } finally {
    if (previousConfiguredModel === undefined) {
      delete process.env.TEMPLATE_MOCKUP_IMAGE_MODEL;
    } else {
      process.env.TEMPLATE_MOCKUP_IMAGE_MODEL = previousConfiguredModel;
    }
  }

  assert.equal(calls.length, 1, "exactly one AI edit request is expected");
  const body = asRecord(calls[0].body);
  const images = asUploadedFiles(body.image);
  assert.deepEqual(
    Buffer.from(await images[0].arrayBuffer()),
    templateBuffer,
    "image #1 must be the untouched base template",
  );
  assert.deepEqual(
    Buffer.from(await images[1].arrayBuffer()),
    sourceBuffer,
    "image #2 must be the selected source product",
  );
  assert.match(images[0].name || "", /template/i);
  assert.match(images[1].name || "", /source|product|design/i);

  assert.equal(body.model, "gpt-image-2");
  assert.equal(body.n, 1);
  assert.equal(body.size, "2000x2000");
  assert.equal(body.quality, "high");
  assert.equal(body.output_format, "png");
  assert.equal(body.background, "opaque");
  assert.equal("mask" in body, false, "AI-only mode must not send a hand-built mask");
  assert.equal(
    "input_fidelity" in body,
    false,
    "GPT Image 2 handles image inputs at high fidelity without this parameter",
  );

  const prompt = String(body.prompt || "");
  assert.match(prompt, /(?:image|ảnh)\s*(?:#|số)?\s*1/i);
  assert.match(prompt, /(?:image|ảnh)\s*(?:#|số)?\s*2/i);
  assert.match(prompt, /template|base scene|cảnh nền/i);
  assert.match(prompt, /design|artwork|thiết kế/i);
  assert.match(
    prompt,
    /analy[sz]e|inspect|visually identify|recognize|tự.*(?:phân tích|nhận diện)/i,
    "AI must be instructed to analyze the source photo itself",
  );
  assert.match(
    prompt,
    /(?:distinguish|separate|isolate|identify|detect|phân biệt|tách).*(?:artwork|design|graphic|thiết kế)/i,
    "AI must distinguish the transferable artwork",
  );
  assert.match(
    prompt,
    /background|product|photo elements|scene elements|nền|sản phẩm/i,
    "the source background and product-photo elements must be treated separately from the artwork",
  );
  assert.match(
    prompt,
    /(?:locate|find|detect|identify|infer|nhận diện|xác định).*(?:printable|print area|decorated surface|design surface|ornament face|bề mặt|vùng in)/i,
    "AI must find the appropriate decorated/printable surface in Image 1",
  );
  assert.match(
    prompt,
    /extract only|transfer only|only.*(?:artwork|design|graphic)|chỉ.*(?:artwork|thiết kế|họa tiết)/i,
    "only the identified artwork may be transferred",
  );
  assert.match(
    prompt,
    /(?:fit|map|place|apply|warp|áp|lắp|ghép).*(?:natural|realistic|appropriate|perspective|curvature|orientation|scale|shape|surface|tự nhiên|phù hợp|phối cảnh|bề mặt)/i,
    "AI must fit the artwork naturally to the target surface",
  );
  assert.match(
    prompt,
    /(?:preserve|keep|retain|giữ nguyên).*(?:artwork|design|graphic|thiết kế)/i,
    "the source artwork itself must remain faithful",
  );
  assert.match(
    prompt,
    /text|typography|spelling|layout|composition|color|character|chữ|bố cục|màu sắc/i,
    "important source-artwork details must not be redesigned",
  );
  assert.match(
    prompt,
    /(?:preserve|keep|retain|unchanged|giữ nguyên).*(?:image\s*1|template|base scene|background|cảnh nền)/i,
    "the base template outside the target surface must remain unchanged",
  );
  assert.match(
    prompt,
    /do not copy|must not transfer|exclude|không.*(?:sao chép|chuyển|lấy)/i,
    "source product and background elements must not be copied",
  );

  assert.deepEqual(rendered.buffer, aiOutput);
  assert.equal(rendered.width, 17);
  assert.equal(rendered.height, 19);
  assert.equal(rendered.mimeType, "image/png");
  assert.match(rendered.providerUsed, /CheapKeyAI/i);
  assert.doesNotMatch(rendered.providerUsed, /OpenAI Image Edit|Injected/i);
  assert.match(rendered.providerUsed, /gpt-image-2/i);

  const requestOptions = asRecord(calls[0].requestOptions);
  assert.equal(requestOptions.maxRetries, 3);
  assert.equal(typeof requestOptions.timeout, "number");
});

test("AI renderer requires CheapKeyAI credentials and never falls back to OPENAI_API_KEY", async () => {
  const previousOpenAIKey = process.env.OPENAI_API_KEY;
  const previousCheapKey = process.env.CHEAPKEYAI_API_KEY;
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;

  process.env.OPENAI_API_KEY = "openai-key-must-not-be-used";
  delete process.env.CHEAPKEYAI_API_KEY;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("Unit tests must never call a live provider");
  }) as typeof fetch;

  try {
    await assert.rejects(
      renderTemplateMockupWithAi({
        templateId: TEMPLATE_ID,
        designBuffer: await createSolidPng(),
        templateBuffer: await createSolidPng(),
      }),
      /CHEAPKEYAI_API_KEY|CheapKeyAI.*(?:API.?key|cấu hình)/i,
    );
    assert.equal(
      fetchCalls,
      0,
      "OPENAI_API_KEY must not trigger an OpenAI request or any provider fallback",
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAIKey;
    if (previousCheapKey === undefined) delete process.env.CHEAPKEYAI_API_KEY;
    else process.env.CHEAPKEYAI_API_KEY = previousCheapKey;
  }
});

test("AI provider failures propagate and never fall back to a local compositor", async () => {
  let editCalls = 0;
  const imageEditClient = {
    images: {
      edit: async () => {
        editCalls += 1;
        throw new Error("provider unavailable");
      },
    },
  };

  await assert.rejects(
    renderTemplateMockupWithAi({
      templateId: TEMPLATE_ID,
      designBuffer: await createSolidPng(),
      templateBuffer: await createSolidPng(),
      imageEditClient,
    }),
    /provider unavailable/i,
  );
  assert.equal(editCalls, 1);
});

test("AI renderer rejects an empty provider response instead of synthesizing locally", async () => {
  const imageEditClient = {
    images: {
      edit: async () => ({ data: [{}] }),
    },
  };

  await assert.rejects(
    renderTemplateMockupWithAi({
      templateId: TEMPLATE_ID,
      designBuffer: await createSolidPng(),
      templateBuffer: await createSolidPng(),
      imageEditClient,
    }),
    /không.*(?:ảnh|dữ liệu)|b64|empty|output/i,
  );
});

test("route validates JSON, image data, AI mode, and exactly one template", async (t) => {
  const validPng = await createSolidPng();
  const validBody = {
    designDataUrl: dataUrl(validPng),
    selectedTemplateIds: [TEMPLATE_ID],
    mode: "ai",
  };
  let renderCalls = 0;
  const handler = createTemplateMockupPostHandler({
    renderWithAi: async () => {
      renderCalls += 1;
      throw new Error("validation must run before AI");
    },
  });

  await t.test("content type", async () => {
    const response = await handler(
      new Request("http://localhost/api/template-mockup/generate", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify(validBody),
      }),
    );
    assert.equal(response.status, 415);
  });

  await t.test("malformed JSON", async () => {
    const response = await handler(
      new Request("http://localhost/api/template-mockup/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json",
      }),
    );
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /JSON/i);
  });

  await t.test("template count 0", async () => {
    const response = await handler(
      jsonRequest({ ...validBody, selectedTemplateIds: [] }),
    );
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /ít nhất 1/i);
  });

  await t.test("non-AI mode", async () => {
    const response = await handler(jsonRequest({ ...validBody, mode: "canvas" }));
    assert.equal(response.status, 400);
  });

  await t.test("unsupported MIME", async () => {
    const response = await handler(
      jsonRequest({
        ...validBody,
        designDataUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==",
      }),
    );
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /PNG|JPG|WebP/i);
  });

  await t.test("declared MIME does not match bytes", async () => {
    const response = await handler(
      jsonRequest({ ...validBody, designDataUrl: dataUrl(validPng, "image/jpeg") }),
    );
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /không khớp/i);
  });

  await t.test("unknown template", async () => {
    const response = await handler(
      jsonRequest({ ...validBody, selectedTemplateIds: ["glass_not_registered"] }),
    );
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /glass_not_registered/);
  });

  assert.equal(renderCalls, 0, "invalid requests must never reach the AI provider");
});

test("route returns AI metadata and actual rendered dimensions", async () => {
  const source = await createSolidPng();
  const output = await createSolidPng(18, 21);
  const calls: unknown[] = [];
  const previousConfiguredModel = process.env.TEMPLATE_MOCKUP_IMAGE_MODEL;
  process.env.TEMPLATE_MOCKUP_IMAGE_MODEL = "gpt-image-1";

  let response: Response;
  try {
    const handler = createTemplateMockupPostHandler({
      renderWithAi: async (options) => {
        calls.push(options);
        return {
          buffer: output,
          width: 18,
          height: 21,
          mimeType: "image/png",
          providerUsed: "CheapKeyAI AI Image Edit (gpt-image-2)",
        };
      },
    });

    response = await handler(
      jsonRequest({
        designDataUrl: dataUrl(source),
        selectedTemplateIds: [TEMPLATE_ID],
        sourceImageMode: "product-photo",
        mode: "ai",
      }),
    );
  } finally {
    if (previousConfiguredModel === undefined) {
      delete process.env.TEMPLATE_MOCKUP_IMAGE_MODEL;
    } else {
      process.env.TEMPLATE_MOCKUP_IMAGE_MODEL = previousConfiguredModel;
    }
  }
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  const options = asRecord(calls[0]);
  assert.equal(options.templateId, TEMPLATE_ID);
  assert.deepEqual(options.designBuffer, source);
  assert.equal("sourceCrop" in options, false);
  assert.equal("targetWidth" in options, false);
  assert.equal("targetHeight" in options, false);
  assert.equal(
    "model" in options,
    false,
    "the route must not expose a caller- or environment-controlled model override",
  );

  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.count, 1);
  assert.equal(payload.mode, "ai");
  assert.equal(payload.model, "gpt-image-2");
  assert.equal(payload.mockups[0].mode, "ai");
  assert.equal(
    payload.mockups[0].providerUsed,
    "CheapKeyAI AI Image Edit (gpt-image-2)",
  );
  assert.equal(payload.mockups[0].width, 18);
  assert.equal(payload.mockups[0].height, 21);
  assert.equal(payload.mockups[0].dataUrl, dataUrl(output));
});

test("route supports batch rendering of multiple selected templates", async () => {
  const source = await createSolidPng();
  const output = await createSolidPng(20, 20);
  const calledTemplateIds: string[] = [];

  const handler = createTemplateMockupPostHandler({
    renderWithAi: async (options) => {
      calledTemplateIds.push(options.templateId);
      return {
        buffer: output,
        width: 20,
        height: 20,
        mimeType: "image/png",
        providerUsed: "CheapKeyAI AI Image Edit (gpt-image-2)",
      };
    },
  });

  const response = await handler(
    jsonRequest({
      designDataUrl: dataUrl(source),
      selectedTemplateIds: ["glass_perfect_gift", "glass_package_included"],
      mode: "ai",
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calledTemplateIds, [
    "glass_perfect_gift",
    "glass_package_included",
  ]);

  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.count, 2);
  assert.equal(payload.mockups.length, 2);
  assert.equal(payload.mockups[0].templateId, "glass_perfect_gift");
  assert.equal(payload.mockups[1].templateId, "glass_package_included");
});

test("route reports missing configuration and provider failures without fallback", async (t) => {
  const source = await createSolidPng();
  const body = {
    designDataUrl: dataUrl(source),
    selectedTemplateIds: [TEMPLATE_ID],
    mode: "ai",
  };

  await t.test("missing API key", async () => {
    const previousOpenAIKey = process.env.OPENAI_API_KEY;
    const previousCheapKey = process.env.CHEAPKEYAI_API_KEY;
    process.env.OPENAI_API_KEY = "openai-key-must-not-be-used";
    delete process.env.CHEAPKEYAI_API_KEY;
    let calls = 0;
    const handler = createTemplateMockupPostHandler({
      renderWithAi: async () => {
        calls += 1;
        throw new Error("Chưa cấu hình CHEAPKEYAI_API_KEY cho CheapKeyAI");
      },
    });
    try {
      const response = await handler(jsonRequest(body));
      assert.equal(response.status, 503);
      const payload = await response.json();
      assert.match(payload.error, /AI.*CHEAPKEYAI_API_KEY/i);
      assert.doesNotMatch(payload.error, /OPENAI_API_KEY/i);
      assert.equal(calls, 1);
    } finally {
      if (previousOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAIKey;
      if (previousCheapKey === undefined) delete process.env.CHEAPKEYAI_API_KEY;
      else process.env.CHEAPKEYAI_API_KEY = previousCheapKey;
    }
  });

  await t.test("upstream failure", async () => {
    let calls = 0;
    const handler = createTemplateMockupPostHandler({
      renderWithAi: async () => {
        calls += 1;
        throw new Error("upstream timed out");
      },
    });
    const response = await handler(jsonRequest(body));
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /AI.*upstream timed out/i);
    assert.equal(calls, 1);
  });
});
