import test from "node:test";
import assert from "node:assert/strict";
import {
  SYSTEM_PRESETS,
  getAllPresets,
  createNewPreset,
  clonePreset,
  exportPresetsPayload,
  importPresetsPayload,
  parseChatGPTBatchInput,
} from "../lib/mockup-preset-store";

test("getAllPresets starts without the retired built-in product categories", () => {
  const presets = getAllPresets();
  assert.deepEqual(SYSTEM_PRESETS, []);
  assert.deepEqual(presets, []);
});

test("createNewPreset creates a custom category with 7 default contents", () => {
  const custom = createNewPreset("Beer Mug 🍺", "🍺");
  assert.equal(custom.label, "Beer Mug 🍺");
  assert.equal(custom.icon, "🍺");
  assert.equal(custom.isSystem, false);
  assert.equal(custom.contents.length, 7);
  assert.ok(custom.id.startsWith("custom_"));
});

test("clonePreset duplicates an existing category preset", () => {
  const source = createNewPreset("Hanging Ornament", "🎄");
  const cloned = clonePreset(source, "Hanging Ornament Copy");
  assert.equal(cloned.label, "Hanging Ornament Copy");
  assert.equal(cloned.icon, source.icon);
  assert.equal(cloned.contents.length, source.contents.length);
  assert.notEqual(cloned.id, source.id);
});

test("exportPresetsPayload and importPresetsPayload handle JSON roundtrip", () => {
  const custom = createNewPreset("Custom Wood Sign", "🪵");
  const all = [...SYSTEM_PRESETS, custom];

  const payload = exportPresetsPayload(all);
  assert.equal(payload.version, "1.0");
  assert.equal(payload.presets.length, 1);

  const jsonStr = JSON.stringify(payload);
  const imported = importPresetsPayload(jsonStr);

  assert.equal(imported.length, 1);
  assert.equal(imported[0].label, "Custom Wood Sign");
  assert.equal(imported[0].icon, "🪵");
});

test("parseChatGPTBatchInput parses structured text from ChatGPT into items and category meta", () => {
  const sampleInput = `
Loại Sản Phẩm: 🍺 Beer Mug (Cốc Bia)
Content 1 | Ảnh 1: Nền Trắng CTR Gốc | Hero main product on pure white background
Content 2 | Ảnh 2: Quán Pub Gia Đình | Cozy indoor wood pub setting with warm ambient lighting
Content 3 | Ảnh 3: Kích Thước 16oz | Product dimensions 3D callout 16oz capacity
  `;

  const parsed = parseChatGPTBatchInput(sampleInput, 1);
  assert.equal(parsed.categoryMeta?.icon, "🍺");
  assert.equal(parsed.categoryMeta?.label, "Beer Mug (Cốc Bia)");
  assert.equal(parsed.items.length, 3);
  assert.equal(parsed.items[0].label, "Content 1: Ảnh 1: Nền Trắng CTR Gốc");
  assert.equal(parsed.items[0].customPrompt, "Hero main product on pure white background");
  assert.equal(parsed.items[1].label, "Content 2: Ảnh 2: Quán Pub Gia Đình");
  assert.equal(parsed.items[1].customPrompt, "Cozy indoor wood pub setting with warm ambient lighting");
});
