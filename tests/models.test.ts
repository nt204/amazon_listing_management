import assert from "node:assert/strict";
import test from "node:test";
import {
  CHEAPKEY_GEMINI_3_5_FLASH_LITE_MODEL,
  CHEAPKEY_GEMINI_3_7_FLASH_MODEL,
  DEFAULT_LISTING_FALLBACK_MODEL,
  DEFAULT_OPENAI_MODEL,
  getGeminiModels,
  getListingFallbackModel,
  getListingModelCandidates,
  getOpenAIModels,
  isCheapKeyTextModel,
  resolveCheapKeyUpstreamTextModel,
} from "../lib/models";

test("listing catalog exposes Gemini 3.7 Flash through CheapKey AI", () => {
  const model = getOpenAIModels().find(
    (option) => option.id === CHEAPKEY_GEMINI_3_7_FLASH_MODEL,
  );

  assert.equal(model?.label, "Gemini 3.7 Flash (CheapKey AI)");
  assert.equal(isCheapKeyTextModel(CHEAPKEY_GEMINI_3_7_FLASH_MODEL), true);
  assert.equal(
    resolveCheapKeyUpstreamTextModel(CHEAPKEY_GEMINI_3_7_FLASH_MODEL),
    "gemini-3.7-flash",
  );
});

test("Gemini 3.5 Flash-Lite shares the model-specific CheapKey route", () => {
  const model = getOpenAIModels().find(
    (option) => option.id === CHEAPKEY_GEMINI_3_5_FLASH_LITE_MODEL,
  );

  assert.equal(model?.label, "Gemini 3.5 Flash-Lite (CheapKey AI)");
  assert.equal(isCheapKeyTextModel(CHEAPKEY_GEMINI_3_5_FLASH_LITE_MODEL), true);
  assert.equal(
    resolveCheapKeyUpstreamTextModel(CHEAPKEY_GEMINI_3_5_FLASH_LITE_MODEL),
    "gemini-3.5-flash-lite",
  );
  assert.equal(getGeminiModels().some((option) => option.id === "gemini-3.5-flash-lite"), false);
});

test("listing catalog hides retired model options", () => {
  assert.equal(getGeminiModels().some((option) => option.id === "gemini-2.5-pro"), false);
  assert.equal(getOpenAIModels().some((option) => option.id === "gpt-4o-mini"), false);
});

test("listing defaults to Luna and falls back to CheapKey Gemini 3.5 Flash-Lite", () => {
  assert.equal(DEFAULT_OPENAI_MODEL, "gpt-5.6-luna");
  assert.equal(DEFAULT_LISTING_FALLBACK_MODEL, CHEAPKEY_GEMINI_3_5_FLASH_LITE_MODEL);
  assert.equal(
    getListingFallbackModel(DEFAULT_OPENAI_MODEL),
    CHEAPKEY_GEMINI_3_5_FLASH_LITE_MODEL,
  );
  assert.deepEqual(
    getListingModelCandidates({
      preference: "auto",
      hasGemini: true,
      hasOpenAI: true,
    }),
    [
      { provider: "openai", model: DEFAULT_OPENAI_MODEL },
      { provider: "openai", model: CHEAPKEY_GEMINI_3_5_FLASH_LITE_MODEL },
      { provider: "gemini", model: "gemini-3.6-flash" },
    ],
  );
});
