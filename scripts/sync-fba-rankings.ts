// scripts/sync-fba-rankings.ts
// Đồng bộ SP Rank + Org Rank (Helium 10 Cerebro) cho các ASIN FBA của LIMIMA và FASTPEACE
//
// Dùng:
//   npm run ppc:sync-fba-rankings                    (mặc định chạy cả FASTPEACE và LIMIMA)
//   npm run ppc:sync-fba-rankings -- FASTPEACE       (chỉ chạy FASTPEACE FBA)
//   npm run ppc:sync-fba-rankings -- LIMIMA          (chỉ chạy LIMIMA FBA)
//   npm run ppc:sync-fba-rankings -- FASTPEACE --force (quét lại cả ASIN đã có rank)

import { getDatabaseClient } from "../lib/db";
import { mineHelium10Keywords } from "../lib/helium10-playwright";
import {
  upsertVolumes,
  upsertRankings,
  saveAsinCheckpoint,
} from "../lib/ppc/search-volume";

const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const storeFilter = args.find((a) => !a.startsWith("--"))?.toUpperCase() || "ALL";

  log(`=== BẮT ĐẦU ĐỒNG BỘ RANK FBA (Store: ${storeFilter}, Force: ${force}) ===`);

  const sql = await getDatabaseClient();

  const targetStores = storeFilter === "ALL" ? ["FASTPEACE", "LIMIMA"] : [storeFilter];

  // 1. Lấy danh sách ASIN FBA đang hoạt động ('Phát triển', 'Test')
  const asinRows = await sql<
    Array<{
      store_name: string;
      asin: string;
      sku: string;
      status: string;
    }>
  >`
    SELECT DISTINCT s.name as store_name, upper(trim(m.asin)) as asin, m.sku, m.status
    FROM accounting_sku_master m
    JOIN stores s ON s.id = m.store_id
    WHERE s.name IN ${sql(targetStores)}
      AND m.deleted_at IS NULL
      AND m.asin IS NOT NULL AND m.asin <> ''
      AND m.status IN ('Phát triển', 'Test')
    ORDER BY store_name, status, asin
  `;

  log(`Tìm thấy tổng cộng ${asinRows.length} ASIN FBA hoạt động trong danh mục (${targetStores.join(", ")}).`);

  // 2. Lọc danh sách: nếu không force, ưu tiên quét ASIN chưa có rank trong ppc_asin_keyword_rankings
  let toScan: Array<(typeof asinRows)[number]> = [...asinRows];
  if (!force) {
    const existingRankAsins = await sql<Array<{ asin: string }>>`
      SELECT DISTINCT asin 
      FROM ppc_asin_keyword_rankings 
      WHERE marketplace = 'US' AND asin IN ${sql(asinRows.map((r) => r.asin))}
    `;
    const existingSet = new Set(existingRankAsins.map((r) => r.asin));
    toScan = asinRows.filter((r) => !existingSet.has(r.asin));
    log(`Đã có dữ liệu Rank: ${existingSet.size} ASIN. Cần quét mới: ${toScan.length} ASIN.`);
  }

  if (toScan.length === 0) {
    log("Tất cả ASIN đã có dữ liệu Rank. Dùng cờ --force nếu muốn quét lại toàn bộ.");
    return;
  }

  // 3. Tiến hành quét từng ASIN qua Cerebro
  let successCount = 0;
  let failCount = 0;
  let totalOrgRankFound = 0;
  let totalSpRankFound = 0;

  for (let idx = 0; idx < toScan.length; idx++) {
    const item = toScan[idx];
    const prefix = `[${idx + 1}/${toScan.length}] [${item.store_name}] ASIN ${item.asin} (${item.sku} - ${item.status})`;

    try {
      log(`${prefix}: Đang gọi Cerebro...`);
      const result = await mineHelium10Keywords({
        asins: [item.asin],
        marketplace: "US",
        limit: 30000,
        directApiOnly: true,
      });

      const kws = result.keywords || [];
      const orgCount = kws.filter((k) => k.organic_rank != null).length;
      const spCount = kws.filter((k) => k.sponsored_rank != null).length;

      // Nạp Volume và Ranking vào DB (không lọc keepLoose để lưu trọn vẹn ranking của ASIN)
      if (kws.length > 0) {
        await upsertVolumes(sql, "US", "helium10_cerebro", kws);
        await upsertRankings(sql, "US", [item.asin], kws);
      }

      await saveAsinCheckpoint(sql, "US", [item.asin], { ok: true, keywordCount: kws.length });

      totalOrgRankFound += orgCount;
      totalSpRankFound += spCount;
      successCount++;

      log(`${prefix}: ✅ Xong! ${kws.length} kws | Org Rank: ${orgCount} | SP Rank: ${spCount}`);

      // Delay nhẹ 1.5s giữa các request
      await sleep(1500);
    } catch (err: any) {
      failCount++;
      const errMsg = err?.message || String(err);
      log(`${prefix}: ❌ Lỗi: ${errMsg}`);
      await saveAsinCheckpoint(sql, "US", [item.asin], { ok: false, error: errMsg });

      // Nếu lỗi quota hoặc auth thì dừng hẳn
      if (/rta-7017|not enough uses|unauthorized|cookie/i.test(errMsg)) {
        log(`Dừng quét do lỗi xác thực hoặc hết hạn mức: ${errMsg}`);
        break;
      }
    }
  }

  log(`\n=== TỔNG KẾT HOÀN TẤT ===`);
  log(`Thành công: ${successCount}/${toScan.length} ASIN`);
  log(`Thất bại: ${failCount}/${toScan.length} ASIN`);
  log(`Tổng Org Rank thu thập được: ${totalOrgRankFound.toLocaleString()}`);
  log(`Tổng SP Rank thu thập được: ${totalSpRankFound.toLocaleString()}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
  });
