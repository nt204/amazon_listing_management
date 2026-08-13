import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import {
  classifyMockupGenerationError,
  generateAllMockups,
} from "../lib/mockup-generator";

const SOURCE_PATH = "public/samples/nail_tech_glass_ornament.jpg";
const UPSTREAM_MODEL = "gpt-image-2";

async function assertModelIsVisible(baseUrl: string, apiKey: string) {
  const response = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const body = (await response.json()) as {
    data?: Array<{ id?: string }>;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(
      `CheapKeyAI /models trả HTTP ${response.status}: ${body.error?.message || "unknown error"}`,
    );
  }
  if (!body.data?.some((model) => model.id === UPSTREAM_MODEL)) {
    throw new Error(
      `API key hiện không nhìn thấy model ${UPSTREAM_MODEL}; hãy tạo key ở đúng group.`,
    );
  }
}

async function main() {
  if (process.env.CHEAPKEYAI_LIVE_TEST !== "1") {
    throw new Error(
      "Đây là test API thật có thể tính $0.005. Chạy lại với CHEAPKEYAI_LIVE_TEST=1.",
    );
  }

  const nextEnvModule = await import("@next/env");
  const nextEnv = (nextEnvModule.default || nextEnvModule) as typeof import("@next/env");
  nextEnv.loadEnvConfig(process.cwd(), true);
  const apiKey = process.env.CHEAPKEYAI_API_KEY?.trim();
  const baseUrl = (
    process.env.CHEAPKEYAI_BASE_URL || "https://cheapkeyai.shop/v1"
  )
    .trim()
    .replace(/\/+$/, "");
  if (!apiKey) throw new Error("CHEAPKEYAI_API_KEY chưa được cấu hình.");

  await assertModelIsVisible(baseUrl, apiKey);
  process.env.IMAGE_GENERATION_CONCURRENCY = "1";
  const inputDesignBuffer = await readFile(SOURCE_PATH);
  const startedAt = Date.now();
  const results = await generateAllMockups({
    sku: "CHEAPKEYAI-LIVE-SMOKE",
    itemName: "Nail Tech Glass Ornament",
    dimensions: {
      length: '3.1"',
      width: '3.1"',
      thickness: '0.15"',
      formatted: '3.1" x 3.1" x 0.15"',
    },
    inputDesignBuffer,
    inputMimeType: "image/jpeg",
    model: "gpt-image-2-c",
    quality: "low",
    selectedIndexes: [4],
  });

  const aiResults = results.filter((result) => result.index >= 2);
  if (aiResults.length !== 1) {
    throw new Error(`Expected exactly one AI image, received ${aiResults.length}.`);
  }
  const generated = aiResults[0];
  if (
    generated.providerTrace?.provider !== "cheapkeyai" ||
    generated.providerTrace.model !== "gpt-image-2-c"
  ) {
    throw new Error(
      `Fallback detected: ${generated.providerTrace?.provider || "no provider trace"}.`,
    );
  }

  const metadata = await sharp(generated.buffer, {
    failOn: "warning",
  }).metadata();
  if (!metadata.width || !metadata.height || !metadata.format) {
    throw new Error("CheapKeyAI response is not a decodable raster image.");
  }
  const extension =
    metadata.format === "jpeg"
      ? "jpg"
      : metadata.format === "webp"
        ? "webp"
        : "png";
  await mkdir("output", { recursive: true });
  const outputPath = `output/cheapkeyai-gpt-image-2-live.${extension}`;
  await writeFile(outputPath, generated.buffer);

  process.stdout.write(
    `${JSON.stringify(
      {
        success: true,
        fallback: false,
        provider: generated.providerTrace.provider,
        localModel: generated.providerTrace.model,
        upstreamModel: UPSTREAM_MODEL,
        requestId: generated.providerTrace.requestId,
        fixedCostUsd: generated.providerTrace.estimatedCostUsd,
        format: metadata.format,
        width: metadata.width,
        height: metadata.height,
        bytes: generated.buffer.byteLength,
        outputPath,
        elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error: unknown) => {
  const classified = classifyMockupGenerationError(error);
  const rawMessage = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${classified?.message || rawMessage}\n`);
  if (classified && classified.message !== rawMessage) {
    process.stderr.write(`Provider detail: ${rawMessage}\n`);
  }
  process.exitCode = 1;
});
