// scripts/test-small-h10-sync.ts
// Chạy thử nghiệm nhỏ (5-10 keywords) để kiểm tra kết nối và trích xuất dữ liệu từ Helium 10

import { getDatabaseClient } from "../lib/db";
import { mineHelium10Keywords } from "../lib/helium10-playwright";
import { getHelium10PlaywrightConfig, validateHelium10Session } from "../lib/helium10-playwright";

async function runSmallTest() {
  console.log("==========================================================");
  console.log("🧪 BẮT ĐẦU CHẠY THỬ NGHIỆM NHỎ SEARCH VOLUME HELIUM 10");
  console.log("==========================================================\n");

  const sql = await getDatabaseClient();

  // 1. Kiểm tra session
  const config = await getHelium10PlaywrightConfig();
  if (!config.cookies) {
    console.error("❌ Chưa có cookie Helium 10 trong hệ thống.");
    process.exit(1);
  }

  const check = await validateHelium10Session(config.cookies);
  if (!check.valid) {
    console.error(`❌ Session Helium 10 không hợp lệ: ${check.error}`);
    process.exit(1);
  }

  console.log(`✅ Kết nối Helium 10 thành công! Gói: ${check.plan || "Diamond"}`);

  // 2. Lấy thử 5 search terms chi tiêu cao nhất của LIMIMA
  const [store] = await sql<Array<{ id: string; name: string }>>`
    SELECT id, name FROM ppc_stores WHERE lower(name) = 'limima' LIMIT 1
  `;

  if (!store) {
    console.error("❌ Không tìm thấy store LIMIMA.");
    process.exit(1);
  }

  const sampleKws = await sql<Array<{ keyword: string; spend: number }>>`
    SELECT lower(trim(customer_search_term)) as keyword, SUM(spend) as spend
    FROM ppc_search_terms
    WHERE store_id = ${store.id}
      AND customer_search_term !~* '^(b0|asin=)'
    GROUP BY lower(trim(customer_search_term))
    ORDER BY SUM(spend) DESC
    LIMIT 5
  `;

  console.log(`\n📋 Danh sách 5 từ khóa thử nghiệm của LIMIMA:`);
  for (const k of sampleKws) {
    console.log(`   - "${k.keyword}" (Spend: $${Number(k.spend || 0).toFixed(2)})`);
  }

  // 3. Gọi thử Magnet cho từ khóa đầu tiên
  const testKw = sampleKws[0]?.keyword || "wooden wall shelf";
  console.log(`\n🔍 Đang tra cứu Search Volume thử nghiệm cho: "${testKw}"...`);

  const result = await mineHelium10Keywords({
    keyword: testKw,
    marketplace: "US",
    limit: 10,
  });

  console.log("\n🎉 KẾT QUẢ TRẢ VỀ TỪ HELIUM 10:");
  console.log(`   - Tổng số từ khóa phân tích: ${result.totalResults}`);
  console.log("   - Top kết quả tiêu biểu:");
  for (const item of result.keywords.slice(0, 5)) {
    console.log(`     * Keyword: "${item.keyword}"`);
    console.log(`       Search Volume: ${item.search_volume?.toLocaleString() ?? "N/A"}`);
    console.log(`       CPR:           ${item.cpr ?? "N/A"}`);
    console.log(`       CPC:           $${item.cpc ? item.cpc.toFixed(2) : "N/A"}`);
    console.log("       ----------------------------------");
  }

  console.log("\n✅ Chạy thử nghiệm nhỏ thành công 100%!");
  process.exit(0);
}

runSmallTest().catch((err) => {
  console.error("❌ Lỗi thử nghiệm:", err);
  process.exit(1);
});
