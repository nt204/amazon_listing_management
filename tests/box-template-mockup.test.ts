import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { createTemplateMockupPostHandler } from "../lib/template-mockup-route";
import {
  BOX_MOCKUP_TEMPLATES,
  ALL_BUILTIN_TEMPLATES,
  renderTemplateMockupWithAi,
} from "../lib/template-mockup";

async function createSolidPng(
  width = 32,
  height = 32,
  color = { r: 100, g: 150, b: 200, alpha: 1 },
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

test("all Box Mockup templates have valid specs and existing image assets", () => {
  assert.ok(BOX_MOCKUP_TEMPLATES.length >= 4, "Should have at least 4 box templates");
  for (const template of BOX_MOCKUP_TEMPLATES) {
    assert.ok(template.templateAssetPath, `Template ${template.id} must have templateAssetPath`);
    assert.ok(
      fs.existsSync(path.join(process.cwd(), template.templateAssetPath)),
      `The box base template asset must exist on disk: ${template.templateAssetPath}`,
    );
    assert.equal(template.category, "box");
  }
});

test("Box Mockup AI Edit sends multi-image payload and box prompt instructions to CheapKeyAI", async () => {
  const designBuffer = await createSolidPng(40, 40, { r: 255, g: 100, b: 50, alpha: 1 });
  const aiOutput = await createSolidPng(32, 32, { r: 20, g: 200, b: 80, alpha: 1 });
  const calls: Array<{ body: any; requestOptions: any }> = [];

  const imageEditClient = {
    images: {
      edit: async (body: any, requestOptions?: any) => {
        calls.push({ body, requestOptions });
        return { data: [{ b64_json: aiOutput.toString("base64") }] };
      },
    },
  };

  const result = await renderTemplateMockupWithAi({
    templateId: "box_main_pure_white",
    designBuffer,
    imageEditClient,
  });

  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.body.model, "gpt-image-2");
  assert.ok(Array.isArray(call.body.image), "image param must be an array of multi-images");
  assert.equal(call.body.image.length, 2, "Must pass exactly 2 files: template and design");
  assert.ok(call.body.prompt.includes("packaging gift box"), "Prompt must include box instructions");
  assert.equal(result.mimeType, "image/png");
});

test("Box Mockup supports Custom user-uploaded template with custom prompt", async () => {
  const customTemplateBuffer = await createSolidPng(30, 30, { r: 50, g: 50, b: 50, alpha: 1 });
  const designBuffer = await createSolidPng(40, 40, { r: 255, g: 100, b: 50, alpha: 1 });
  const aiOutput = await createSolidPng(32, 32, { r: 20, g: 200, b: 80, alpha: 1 });
  const calls: Array<{ body: any }> = [];

  const imageEditClient = {
    images: {
      edit: async (body: any) => {
        calls.push({ body });
        return { data: [{ b64_json: aiOutput.toString("base64") }] };
      },
    },
  };

  const customTemplateSpec = {
    id: "custom_box_magnetic_123",
    category: "box",
    name: "Custom Magnetic Gift Box",
    badge: "Custom Phôi",
    description: "Khách tự chụp phôi hộp nam châm",
    promptInstruction: "Place artwork on magnetic flap lid",
    templateDataUrl: dataUrl(customTemplateBuffer),
    isCustom: true,
  };

  const result = await renderTemplateMockupWithAi({
    templateId: "custom_box_magnetic_123",
    designBuffer,
    customTemplates: [customTemplateSpec],
    imageEditClient,
  });

  assert.equal(calls.length, 1);
  assert.ok(calls[0].body.prompt.includes("magnetic flap lid"));
  assert.equal(result.mimeType, "image/png");
});

test("createTemplateMockupPostHandler handles batch box generation", async () => {
  const designBuffer = await createSolidPng(32, 32);
  const aiOutput = await createSolidPng(32, 32);

  const mockRenderWithAi = async (options: any) => ({
    buffer: aiOutput,
    width: 2000,
    height: 2000,
    mimeType: "image/png" as const,
    providerUsed: "Mock Test",
  });

  const handler = createTemplateMockupPostHandler({
    renderWithAi: mockRenderWithAi as any,
  });

  const req = jsonRequest({
    designDataUrl: dataUrl(designBuffer),
    selectedTemplateIds: ["box_main_pure_white", "box_open_lid_interior"],
    mode: "ai",
  });

  const res = await handler(req);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.success, true);
  assert.equal(body.count, 2);
  assert.equal(body.mockups[0].templateId, "box_main_pure_white");
  assert.equal(body.mockups[1].templateId, "box_open_lid_interior");
});

test("buildAccessoriesPromptInjection returns empty string when accessories array is empty or undefined", () => {
  const { buildAccessoriesPromptInjection } = require("../lib/template-mockup-types");
  assert.equal(buildAccessoriesPromptInjection(undefined), "");
  assert.equal(buildAccessoriesPromptInjection([]), "");
  assert.equal(buildAccessoriesPromptInjection(["   "]), "");
});

test("buildAccessoriesPromptInjection formats accessories cleanly for AI prompt", () => {
  const { buildAccessoriesPromptInjection } = require("../lib/template-mockup-types");
  const injection = buildAccessoriesPromptInjection([
    "Hộp quà nắp cam Bozspacer",
    "Chân đế đen",
  ]);
  assert.ok(injection.includes("Package accessories genuinely included as shown in the reference: [Hộp quà nắp cam Bozspacer, Chân đế đen]."));
  assert.ok(injection.includes("strictly matching their physical appearance"));
});

test("renderTemplateMockupWithAi strictly isolates accessory prompt when user selects accessories vs when unselected", async () => {
  const designBuffer = await createSolidPng(40, 40);
  const aiOutput = await createSolidPng(32, 32);
  const promptsRecorded: string[] = [];

  const imageEditClient = {
    images: {
      edit: async (body: any) => {
        promptsRecorded.push(body.prompt);
        return { data: [{ b64_json: aiOutput.toString("base64") }] };
      },
    },
  };

  // Case 1: Template with selected accessories
  await renderTemplateMockupWithAi({
    templateId: "slate_plate_package_included",
    designBuffer,
    selectedAccessories: ["Hộp quà nắp cam Bozspacer (16x16x2.7cm)", "Chân đế đen (1 Black foot stand)"],
    imageEditClient,
  });

  assert.equal(promptsRecorded.length, 1);
  assert.ok(
    promptsRecorded[0].includes("Package accessories genuinely included as shown in the reference: [Hộp quà nắp cam Bozspacer (16x16x2.7cm), Chân đế đen (1 Black foot stand)]"),
    "Should include accessories instruction when accessories are selected",
  );

  // Case 2: Template WITHOUT selected accessories (solo image or user unselected)
  promptsRecorded.length = 0;
  await renderTemplateMockupWithAi({
    templateId: "slate_plate_package_included",
    designBuffer,
    selectedAccessories: [], // empty / unselected
    imageEditClient,
  });

  assert.equal(promptsRecorded.length, 1);
  assert.ok(
    !promptsRecorded[0].includes("Package accessories genuinely included"),
    "Should NOT inject accessories instruction when accessories array is empty",
  );
});

test("createTemplateMockupPostHandler forwards selectedAccessories to renderWithAi", async () => {
  const designBuffer = await createSolidPng(32, 32);
  const aiOutput = await createSolidPng(32, 32);
  const renderedOptionsList: any[] = [];

  const mockRenderWithAi = async (options: any) => {
    renderedOptionsList.push(options);
    return {
      buffer: aiOutput,
      width: 2000,
      height: 2000,
      mimeType: "image/png" as const,
      providerUsed: "Mock Test",
    };
  };

  const handler = createTemplateMockupPostHandler({
    renderWithAi: mockRenderWithAi as any,
  });

  const req = jsonRequest({
    designDataUrl: dataUrl(designBuffer),
    selectedTemplateIds: ["slate_plate_package_included"],
    selectedAccessories: ["Hộp quà nắp cam Bozspacer", "Chân đế đen"],
    mode: "ai",
  });

  const res = await handler(req);
  assert.equal(res.status, 200);
  assert.equal(renderedOptionsList.length, 1);
  assert.deepEqual(renderedOptionsList[0].selectedAccessories, [
    "Hộp quà nắp cam Bozspacer",
    "Chân đế đen",
  ]);
});
