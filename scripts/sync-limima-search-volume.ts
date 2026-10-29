// scripts/sync-limima-search-volume.ts
// Đồng bộ toàn bộ Search Volume cho store LIMIMA từ Helium 10 Diamond
// Hỗ trợ chạy thủ công hoặc lên lịch tự động định kỳ 1 tháng/lần trên Server.

import { getDatabaseClient } from "../lib/db";
import {
  startSearchVolumeSync,
  getSearchVolumeStatus,
  normalizeKeyword,
  isKeywordTarget,
} from "../lib/ppc/search-volume";
import {
  getHelium10PlaywrightConfig,
  validateHelium10Session,
  saveHelium10PlaywrightCookies,
} from "../lib/helium10-playwright";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

const STORE_NAME = "LIMIMA";
const TEAM_ID = "default";

/**
 * Tự động tìm và cập nhật cookie mới nhất từ ~/Downloads nếu cookie hiện tại hết hạn
 */
async function autoDetectAndRefreshCookie(): Promise<boolean> {
  console.log("🔍 Đang kiểm tra cấu hình Cookie Helium 10...");
  const currentConfig = await getHelium10PlaywrightConfig();

  if (currentConfig.cookies) {
    const check = await validateHelium10Session(currentConfig.cookies);
    if (check.valid) {
      console.log(`✅ Phiên làm việc Helium 10 hợp lệ (${check.plan || "Diamond"}).`);
      return true;
    }
    console.warn(`⚠️ Cookie hiện tại đã hết hạn: ${check.error}`);
  } else {
    console.warn("⚠️ Chưa có cấu hình Cookie Helium 10.");
  }

  // Quét tìm các file cookie trong ~/Downloads và thư mục config/
  console.log("🔄 Đang tự động quét file Cookie mới trong Downloads...");
  const downloadDir = join(os.homedir(), "Downloads");
  const candidateFiles: { path: string; mtime: number }[] = [];

  const configPath = join(process.cwd(), "config", "helium10-cookies.json");
  if (existsSync(configPath)) {
    candidateFiles.push({ path: configPath, mtime: statSync(configPath).mtimeMs });
  }

  if (existsSync(downloadDir)) {
    const files = readdirSync(downloadDir);
    for (const f of files) {
      if (f.toLowerCase().includes("helium") && f.endsWith(".json")) {
        const fullPath = join(downloadDir, f);
        try {
          const st = statSync(fullPath);
          candidateFiles.push({ path: fullPath, mtime: st.mtimeMs });
        } catch {}
      }
    }
  }

  // Sắp xếp file mới nhất lên đầu
  candidateFiles.sort((a, b) => b.mtime - a.mtime);

  for (const cand of candidateFiles) {
    try {
      const raw = readFileSync(cand.path, "utf8");
      const check = await validateHelium10Session(raw);
      if (check.valid) {
        console.log(`🎉 Đã tìm thấy Cookie hợp lệ từ: ${cand.path}`);
        await saveHelium10PlaywrightCookies(raw);
        console.log("✅ Đã tự động cập nhật Cookie vào hệ thống.");
        return true;
      }
    } catch {}
  }

  return false;
}

async function main() {
  console.log("=================================================================");
  console.log(`🚀 BẮT ĐẦU ĐỒNG BỘ SEARCH VOLUME HELIUM 10 CHO STORE: ${STORE_NAME}`);
  console.log("=================================================================\n");

  const sql = await getDatabaseClient();

  // 1. Kiểm tra & đảm bảo kết nối Helium 10 ổn định
  const isConnected = await autoDetectAndRefreshCookie();
  if (!isConnected) {
    console.error("\n❌ KHÔNG THỂ KẾT NỐI HELIUM 10:");
    console.error("1. Các file cookie trong máy đã hết hạn phiên làm việc.");
    console.error("2. Giải pháp:");
    console.error("   - Cách 1: Đăng nhập Helium 10 trên trình duyệt Chrome, dùng extension Cookie-Editor xuất JSON và lưu vào ~/Downloads.");
    console.error("   - Cách 2: Chạy lệnh sau để mở Chrome tự động đăng nhập:");
    console.error("     npm run h10:login\n");
    process.exit(1);
  }

  // 2. Thống kê dữ liệu Target & Search Term của store LIMIMA
  const [store] = await sql<Array<{ id: string; name: string; marketplace: string }>>`
    SELECT id, name, marketplace FROM ppc_stores
    WHERE lower(name) = lower(${STORE_NAME}) AND team_id = ${TEAM_ID}
    LIMIT 1
  `;

  if (!store) {
    console.error(`❌ Không tìm thấy store ${STORE_NAME} trong hệ thống.`);
    process.exit(1);
  }

  const [stats] = await sql<Array<{
    distinct_search_terms: number;
    distinct_targets: number;
  }>>`
    SELECT 
      (SELECT COUNT(DISTINCT lower(trim(customer_search_term))) 
       FROM ppc_search_terms WHERE store_id = ${store.id}) as distinct_search_terms,
      (SELECT COUNT(DISTINCT lower(trim(target_expression))) 
       FROM ppc_performance_facts WHERE store_id = ${store.id} AND grain = 'TARGET') as distinct_targets
  `;

  console.log(`📊 Dữ liệu store ${store.name}:`);
  console.log(`   - Search Terms duy nhất: ${Number(stats?.distinct_search_terms || 0).toLocaleString()}`);
  console.log(`   - Target expressions:     ${Number(stats?.distinct_targets || 0).toLocaleString()}`);

  const statusBefore = await getSearchVolumeStatus(TEAM_ID, STORE_NAME);
  console.log(`\n📈 Tỷ lệ phủ Search Volume hiện tại:`);
  console.log(`   - Tổng từ khóa cần tra: ${statusBefore.coverage.keywords.toLocaleString()}`);
  console.log(`   - Đã có Search Volume:  ${statusBefore.coverage.withVolume.toLocaleString()}`);
  console.log(`   - Còn thiếu:            ${statusBefore.coverage.missing.toLocaleString()}`);
  console.log(`   - Hạn mức tháng đã dùng: Cerebro ${statusBefore.budget.cerebroUsed}/${statusBefore.budget.cerebroLimit}, Magnet ${statusBefore.budget.magnetUsed}/${statusBefore.budget.magnetLimit}`);

  if (statusBefore.coverage.missing === 0) {
    console.log("\n✨ Tất cả từ khóa của LIMIMA đều đã có Search Volume còn hạn (dưới 30 ngày).");
    console.log("   Hệ thống không cần gọi thêm API Helium 10.");
    process.exit(0);
  }

  // 3. Kích hoạt Sync Job
  console.log(`\n⚡ Bắt đầu tiến trình lấy Search Volume cho LIMIMA...`);
  const { runId, execute } = await startSearchVolumeSync({
    teamId: TEAM_ID,
    storeName: STORE_NAME,
    actorId: "limima-monthly-cron",
  });

  console.log(`🆔 Run ID: ${runId}`);
  console.log("⏳ Đang cào dữ liệu qua Cerebro (Reverse ASIN hàng loạt) và Magnet (Keyword)... Vui lòng đợi.\n");

  await execute();

  // 4. Kết quả sau khi chạy
  const statusAfter = await getSearchVolumeStatus(TEAM_ID, STORE_NAME);
  console.log("\n=================================================================");
  console.log("🏁 HOÀN TẤT ĐỒNG BỘ SEARCH VOLUME CHO LIMIMA");
  console.log("=================================================================");
  console.log(`   - Đã có Search Volume: ${statusAfter.coverage.withVolume.toLocaleString()} / ${statusAfter.coverage.keywords.toLocaleString()} từ khóa`);
  console.log(`   - Trạng thái Run:      ${statusAfter.latestRun?.status}`);
  console.log(`   - Chi tiết:            ${statusAfter.latestRun?.message || "Không có thông báo"}`);
  console.log("=================================================================\n");

  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Lỗi nghiêm trọng:", err);
  process.exit(1);
});
