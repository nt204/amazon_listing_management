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
  console.log("Starting real AI test for Template 1 (glass_product_size) & Template 3 (glass_package_included)...");

  await mkdir(path.join(process.cwd(), "scratch"), { recursive: true });

  // Test 1: Template 1 (glass_product_size) with nail_tech_glass_ornament.jpg
  console.log("Running Test 1: Template 1 (glass_product_size)...");
  const sample1Buffer = await readFile(
    path.join(process.cwd(), "public/samples/nail_tech_glass_ornament.jpg")
  );
  const result1 = await renderTemplateMockupWithAi({
    templateId: "glass_product_size",
    designBuffer: sample1Buffer,
    sourceImageMode: "product-photo",
    quality: "high",
  });
  await writeFile(
    path.join(process.cwd(), "scratch/output_template1_real.png"),
    result1.buffer
  );
  console.log("-> Test 1 SUCCESS: scratch/output_template1_real.png (" + result1.width + "x" + result1.height + ")");

  // Test 2: Template 3 (glass_package_included) with construction_vehicles_glass_ornament.jpg
  console.log("Running Test 2: Template 3 (glass_package_included)...");
  const sample2Buffer = await readFile(
    path.join(process.cwd(), "public/samples/construction_vehicles_glass_ornament.jpg")
  );
  const result2 = await renderTemplateMockupWithAi({
    templateId: "glass_package_included",
    designBuffer: sample2Buffer,
    sourceImageMode: "product-photo",
    quality: "high",
  });
  await writeFile(
    path.join(process.cwd(), "scratch/output_template3_real.png"),
    result2.buffer
  );
  console.log("-> Test 2 SUCCESS: scratch/output_template3_real.png (" + result2.width + "x" + result2.height + ")");
}

main().catch((err) => {
  console.error("Real AI test failed:", err);
  process.exit(1);
});
