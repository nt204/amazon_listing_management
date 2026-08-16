import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

async function loadEnv() {
  try {
    const content = await readFile(path.join(process.cwd(), ".env.local"), "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
      }
    }
  } catch {}
}

async function main() {
  await loadEnv();
  const { renderTemplateMockupWithAi } = await import("../lib/template-mockup");
  console.log("Starting test mockup generation with cheapkey key:", process.env.CHEAPKEYAI_API_KEY ? "EXISTS" : "MISSING");
  
  const designBuffer = await readFile(
    path.join(process.cwd(), "public/samples/construction_vehicles_glass_ornament.jpg")
  );

  const result = await renderTemplateMockupWithAi({
    templateId: "glass_package_included",
    designBuffer,
    sourceImageMode: "product-photo",
    quality: "high",
  });

  await mkdir(path.join(process.cwd(), "scratch"), { recursive: true });
  await writeFile(
    path.join(process.cwd(), "scratch/output_test_package_included.png"),
    result.buffer
  );
  console.log("Mockup generated successfully! Size:", result.width, "x", result.height);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
