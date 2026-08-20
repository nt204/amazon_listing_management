import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { generateAllMockups } from "../lib/mockup-generator";

const SOURCE_PATH = "public/samples/nail_tech_glass_ornament.jpg";

async function main() {
  const args = process.argv.slice(2);
  let userCount = 8;
  for (const arg of args) {
    if (arg.startsWith("--users=")) {
      userCount = parseInt(arg.split("=")[1], 10) || 8;
    }
  }

  console.log(`🚀 Đang khởi chạy giả lập ${userCount} người dùng cùng bấm tạo Mockup đồng thời...`);

  const nextEnvModule = await import("@next/env");
  const nextEnv = (nextEnvModule.default || nextEnvModule) as typeof import("@next/env");
  nextEnv.loadEnvConfig(process.cwd(), true);

  const inputDesignBuffer = await readFile(SOURCE_PATH);
  const startTime = Date.now();
  const initialMemory = process.memoryUsage().heapUsed / 1024 / 1024;

  let maxMemoryUsed = initialMemory;
  const memoryInterval = setInterval(() => {
    const currentMemory = process.memoryUsage().heapUsed / 1024 / 1024;
    if (currentMemory > maxMemoryUsed) {
      maxMemoryUsed = currentMemory;
    }
  }, 100);

  const tasks = Array.from({ length: userCount }, async (_, index) => {
    const userStartedAt = Date.now();
    try {
      const results = await generateAllMockups({
        sku: `USER-SIM-${index + 1}`,
        itemName: `Glass Ornament User ${index + 1}`,
        dimensions: {
          length: '3.1"',
          width: '3.1"',
          thickness: '0.15"',
          formatted: '3.1" x 3.1" x 0.15"',
        },
        inputDesignBuffer,
        inputMimeType: "image/jpeg",
        model: "fast-graphic",
        quality: "low",
        selectedIndexes: [1, 2],
      });

      const elapsed = ((Date.now() - userStartedAt) / 1000).toFixed(2);
      console.log(`  ✅ [User ${index + 1}] Hoàn tất ${results.length} mockup trong ${elapsed} giây.`);
      return { success: true, elapsed: Number(elapsed), resultCount: results.length };
    } catch (err) {
      const elapsed = ((Date.now() - userStartedAt) / 1000).toFixed(2);
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`  ❌ [User ${index + 1}] Lỗi trong ${elapsed}s: ${errorMsg}`);
      return { success: false, elapsed: Number(elapsed), error: errorMsg };
    }
  });

  const results = await Promise.all(tasks);
  clearInterval(memoryInterval);

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;
  const avgTime = (
    results.reduce((sum, r) => sum + r.elapsed, 0) / results.length
  ).toFixed(2);

  console.log("\n================================================");
  console.log("📊 KẾT QUẢ GIẢ LẬP TẢI (LOAD TEST RESULTS):");
  console.log("================================================");
  console.log(`• Tổng số người dùng giả lập: ${userCount} users`);
  console.log(`• Thành công: ${successCount} / ${userCount}`);
  console.log(`• Thất bại/Lỗi: ${failCount}`);
  console.log(`• Tổng thời gian xử lý: ${totalElapsed} giây`);
  console.log(`• Thời gian trung bình mỗi user: ${avgTime} giây`);
  console.log(`• Đỉnh RAM sử dụng (Peak Memory): ~${maxMemoryUsed.toFixed(1)} MB`);
  console.log("================================\n");
}

main().catch((err) => {
  console.error("Lỗi script load test:", err);
  process.exit(1);
});
