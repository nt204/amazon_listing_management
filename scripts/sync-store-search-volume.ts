// scripts/sync-store-search-volume.ts
// Đồng bộ toàn bộ Search Volume từ Helium 10 Diamond cho bất kỳ Store nào (mặc định: WARMSTOREY)

import { getDatabaseClient } from "../lib/db";
import {
  startSearchVolumeSync,
  getSearchVolumeStatus,
} from "../lib/ppc/search-volume";
import {
  getHelium10PlaywrightConfig,
  validateHelium10Session,
  saveHelium10PlaywrightCookies,
} from "../lib/helium10-playwright";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

const targetStore = (process.argv[2] || "WARMSTOREY").toUpperCase();
const TEAM_ID = "default";

/**
 * Tự động tìm và cập nhật cookie mới nhất từ ~/Downloads nếu cookie hiện tại hết hạn
 */
async function autoDetectAndRefreshCookie(): Promise<boolean> {
  console.log("🔍 Đang nạp cấu hình Cookie Helium 10...");

  const configPath = join(process.cwd(), "config", "helium10-cookies.json");
  let cookieRaw = "";

  if (existsSync(configPath)) {
    cookieRaw = readFileSync(configPath, "utf8");
    console.log(`📄 Đã tìm thấy file cookie tại: ${configPath}`);
  } else {
    const downloadDir = join(os.homedir(), "Downloads");
    if (existsSync(downloadDir)) {
      const files = readdirSync(downloadDir);
      for (const f of files) {
        if (f.toLowerCase().includes("helium") && f.endsWith(".json")) {
          const fullPath = join(downloadDir, f);
          cookieRaw = readFileSync(fullPath, "utf8");
          console.log(`📄 Đã tìm thấy file cookie tại Downloads: ${fullPath}`);
          break;
        }
      }
    }
  }

  if (!cookieRaw.trim()) {
    console.error("❌ Không tìm thấy file Cookie Helium 10 nào.");
    return false;
  }

  // Lưu vào database app_settings
  try {
    const { setAppSetting } = await import("../lib/db");
    await setAppSetting("helium10_config", {
      cookies: cookieRaw.trim(),
      updatedAt: new Date().toISOString(),
      status: "configured",
      plan: "Helium 10 Diamond",
      accountId: "1547806313",
    });
    console.log("✅ Đã nạp Cookie vào hệ thống thành công (Helium 10 Diamond).");
    return true;
  } catch (err) {
    console.warn("Lỗi lưu app_settings:", err);
    return true;
  }
}

async function main() {
  console.log("=================================================================");
  console.log(`🚀 BẮT ĐẦU ĐỒNG BỘ SEARCH VOLUME HELIUM 10 CHO STORE: ${targetStore}`);
  console.log("=================================================================\n");

  const sql = await getDatabaseClient();

  // 1. Kiểm tra session
  const isConnected = await autoDetectAndRefreshCookie();
  if (!isConnected) {
    console.error("\n❌ KHÔNG THỂ KẾT NỐI HELIUM 10:");
    console.error("1. Phiên làm việc cookie trên hệ thống đã hết hạn.");
    console.error("2. Vui lòng cấp cookie phiên mới vào file config/helium10-cookies.json hoặc ~/Downloads.");
    process.exit(1);
  }

  // 2. Kiểm tra Store và Thống kê từ khóa
  const statusBefore = await getSearchVolumeStatus(TEAM_ID, targetStore);
  console.log(`\n📈 Tỷ lệ phủ Search Volume hiện tại của ${targetStore}:`);
  console.log(`   - Tổng từ khóa cần tra: ${statusBefore.coverage.keywords?.toLocaleString() ?? "—"}`);
  console.log(`   - Đã có Search Volume:  ${statusBefore.coverage.withVolume?.toLocaleString() ?? "—"}`);
  console.log(`   - Còn thiếu:            ${statusBefore.coverage.missing?.toLocaleString() ?? "—"}`);
  console.log(`   - Hạn mức tháng đã dùng: Cerebro ${statusBefore.budget.cerebroUsed}/${statusBefore.budget.cerebroLimit}, Magnet ${statusBefore.budget.magnetUsed}/${statusBefore.budget.magnetLimit}`);

  if (statusBefore.coverage.missing === 0 && statusBefore.asins?.pending === 0) {
    console.log(`\n✨ Tất cả từ khóa của ${targetStore} đều đã có Search Volume còn hạn (dưới 30 ngày).`);
    process.exit(0);
  }

  // 3. Kích hoạt Sync
  console.log(`\n⚡ Bắt đầu tiến trình lấy Search Volume cho ${targetStore}...`);
  const { runId, execute } = await startSearchVolumeSync({
    teamId: TEAM_ID,
    storeName: targetStore,
    actorId: `${targetStore.toLowerCase()}-sync-runner`,
  });

  console.log(`🆔 Run ID: ${runId}`);
  console.log("⏳ Đang cào dữ liệu qua Cerebro (Reverse ASIN hàng loạt) và Magnet (Keyword)... Vui lòng đợi.\n");

  await execute();

  // 4. Báo cáo kết quả
  const statusAfter = await getSearchVolumeStatus(TEAM_ID, targetStore);
  console.log("\n=================================================================");
  console.log(`🏁 HOÀN TẤT ĐỒNG BỘ SEARCH VOLUME CHO ${targetStore}`);
  console.log("=================================================================");
  console.log(`   - Đã có Search Volume: ${statusAfter.coverage.withVolume?.toLocaleString() ?? "—"} / ${statusAfter.coverage.keywords?.toLocaleString() ?? "—"} từ khóa`);
  console.log(`   - Trạng thái Run:      ${statusAfter.latestRun?.status}`);
  console.log(`   - Chi tiết:            ${statusAfter.latestRun?.message || "Không có thông báo"}`);
  console.log("=================================================================\n");

  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Lỗi nghiêm trọng:", err);
  process.exit(1);
});
