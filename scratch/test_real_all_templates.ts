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
  const { GLASS_ORNAMENT_TEMPLATES, renderTemplateMockupWithAi } = await import(
    "../lib/template-mockup"
  );

  console.log("=== BẮT ĐẦU KIỂM THỬ THỰC TẾ TRÊN TOÀN BỘ 6 TEMPLATE MOCKUP ===");
  await mkdir(path.join(process.cwd(), "scratch"), { recursive: true });

  const sampleImages = [
    "construction_vehicles_glass_ornament.jpg",
    "mahjong_happy_hour_glass_ornament.jpg",
    "nail_tech_glass_ornament.jpg",
    "new_home_house_ornament.jpg",
  ];

  let successCount = 0;

  for (let i = 0; i < GLASS_ORNAMENT_TEMPLATES.length; i++) {
    const spec = GLASS_ORNAMENT_TEMPLATES[i];
    const sampleFileName = sampleImages[i % sampleImages.length];
    console.log(`\n[${i + 1}/${GLASS_ORNAMENT_TEMPLATES.length}] Đang tạo mockup cho Template: ${spec.id} (${spec.name})`);
    console.log(` -> Sử dụng ảnh mẫu: ${sampleFileName}`);

    const designBuffer = await readFile(
      path.join(process.cwd(), "public/samples", sampleFileName)
    );

    const startTime = Date.now();
    const result = await renderTemplateMockupWithAi({
      templateId: spec.id,
      designBuffer,
      sourceImageMode: "product-photo",
      quality: "high",
    });
    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

    const outputPath = path.join(process.cwd(), `scratch/real_test_${spec.id}.png`);
    await writeFile(outputPath, result.buffer);

    console.log(` -> THÀNH CÔNG (${durationSec}s)! Ảnh kết quả: ${result.width}x${result.height} px, Provider: ${result.providerUsed}`);
    successCount++;
  }

  console.log(`\n=== TỔNG KẾT KIỂM THỬ THỰC TẾ: HOÀN THÀNH ${successCount}/${GLASS_ORNAMENT_TEMPLATES.length} MẪU TEMPLATE KHÔNG LỖI ===`);
}

main().catch((err) => {
  console.error("\n=== KIỂM THỬ THẤT BẠI ===", err);
  process.exit(1);
});
