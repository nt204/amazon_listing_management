// scripts/sync-asin-rankings.ts
// Đồng bộ SP Rank + Org Rank (Helium 10 Cerebro) cho các ASIN của LIMIMA, MALFIRST, FASTPEACE
// Ưu tiên ASIN có spend PPC >= $10 trước
//
// Dùng:
//   node --conditions=react-server --env-file-if-exists=.env --import tsx scripts/sync-asin-rankings.ts
//   node --conditions=react-server --env-file-if-exists=.env --import tsx scripts/sync-asin-rankings.ts --stores=LIMIMA,MALFIRST
//   node --conditions=react-server --env-file-if-exists=.env --import tsx scripts/sync-asin-rankings.ts --force

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
  
  let targetStores = ["LIMIMA", "MALFIRST", "FASTPEACE"];
  const storesArg = args.find((a) => a.startsWith("--stores="));
  if (storesArg) {
    targetStores = storesArg.replace("--stores=", "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  } else {
    const singleStore = args.find((a) => !a.startsWith("--"))?.toUpperCase();
    if (singleStore && singleStore !== "ALL") {
      targetStores = [singleStore];
    }
  }

  log(`=== ĐỒNG BỘ HELIUM 10 RANK THEO MỨC SPEND ===`);
  log(`Stores: ${targetStores.join(", ")} | Force: ${force}`);

  const sql = await getDatabaseClient();

  // 1. Lấy snapshot 30D active của từng store mục tiêu
  const activeSnaps = await sql<
    Array<{
      store_id: string;
      store_name: string;
      report_start_date: string;
      report_end_date: string;
    }>
  >`
    SELECT s.id AS store_id, s.name AS store_name, a.report_start_date, a.report_end_date
    FROM ppc_active_snapshots a
    JOIN ppc_stores s ON s.id = a.store_id
    WHERE a.coverage_days = 30 AND s.name IN ${sql(targetStores)}
  `;

  // 2. Thu thập ASIN từ PPC Performance Facts theo từng store (dùng index ppc_performance_scope_idx cực nhanh < 100ms)
  const ppcAsinRows: Array<{
    store_name: string;
    asin: string;
    sku: string;
    spend: number;
  }> = [];

  for (const snap of activeSnaps) {
    const rows = await sql<
      Array<{
        asin: string;
        sku: string;
        spend: number;
      }>
    >`
      SELECT 
        f.asin, 
        MAX(f.sku) AS sku, 
        COALESCE(SUM(f.spend), 0)::numeric AS spend
      FROM ppc_performance_facts f
      WHERE f.store_id = ${snap.store_id}
        AND f.report_start_date = ${snap.report_start_date}
        AND f.report_end_date = ${snap.report_end_date}
        AND f.snapshot_date = ${snap.report_end_date}
        AND f.ad_type = 'SP'
        AND f.grain = 'PRODUCT'
        AND f.asin ~* '^[A-Z0-9]{10}$'
      GROUP BY f.asin
    `;
    for (const r of rows) {
      ppcAsinRows.push({
        store_name: snap.store_name,
        asin: r.asin,
        sku: r.sku || "",
        spend: Number(r.spend || 0),
      });
    }
  }

  // 2. Thu thập thêm ASIN từ accounting_sku_master nếu chưa có trong PPC
  const masterAsinRows = await sql<
    Array<{
      store_name: string;
      asin: string;
      sku: string;
    }>
  >`
    SELECT DISTINCT s.name AS store_name, upper(trim(m.asin)) AS asin, m.sku
    FROM accounting_sku_master m
    JOIN stores s ON s.id = m.store_id
    WHERE s.name IN ${sql(targetStores)}
      AND m.deleted_at IS NULL
      AND m.asin IS NOT NULL AND m.asin ~* '^[A-Z0-9]{10}$'
  `;

  // Gộp danh sách ASIN theo key: store:asin
  const asinMap = new Map<string, { store_name: string; asin: string; sku: string; spend: number }>();
  for (const r of ppcAsinRows) {
    asinMap.set(`${r.store_name}:${r.asin}`, {
      store_name: r.store_name,
      asin: r.asin,
      sku: r.sku || "",
      spend: Number(r.spend || 0),
    });
  }
  for (const r of masterAsinRows) {
    const key = `${r.store_name}:${r.asin}`;
    if (!asinMap.has(key)) {
      asinMap.set(key, {
        store_name: r.store_name,
        asin: r.asin,
        sku: r.sku || "",
        spend: 0,
      });
    }
  }

  const allAsins = Array.from(asinMap.values());
  log(`Tổng hợp được ${allAsins.length} ASIN trên các store (${targetStores.join(", ")}).`);

  // Phân loại: ASIN spend >= $10 vs ASIN spend < $10
  // Sắp xếp: spend >= 10 lên đầu (spend giảm dần), sau đó đến các ASIN còn lại
  allAsins.sort((a, b) => {
    if (a.spend >= 10 && b.spend < 10) return -1;
    if (a.spend < 10 && b.spend >= 10) return 1;
    return b.spend - a.spend;
  });

  const spendGte10Count = allAsins.filter((a) => a.spend >= 10).length;
  log(`Số ASIN có Spend >= $10 (ƯU TIÊN HÀNG ĐẦU): ${spendGte10Count} ASIN.`);

  // 3. Lọc bỏ ASIN đã có dữ liệu Rank gần đây (trong 7 ngày qua) nếu không bật --force
  let toScan = [...allAsins];
  if (!force) {
    const existingRankAsins = await sql<Array<{ asin: string }>>`
      SELECT DISTINCT asin 
      FROM ppc_asin_keyword_rankings 
      WHERE marketplace = 'US' 
        AND asin IN ${sql(allAsins.map((r) => r.asin))}
        AND fetched_at >= NOW() - INTERVAL '7 days'
    `;
    const existingSet = new Set(existingRankAsins.map((r) => r.asin));
    toScan = allAsins.filter((r) => !existingSet.has(r.asin));
    log(`Đã có Rank trong 7 ngày: ${existingSet.size} ASIN. Còn lại cần quét: ${toScan.length} ASIN.`);
  }

  const priorityScanCount = toScan.filter((a) => a.spend >= 10).length;
  log(`Trong danh sách cần quét: ${priorityScanCount} ASIN có Spend >= $10.`);

  if (toScan.length === 0) {
    log("Tất cả ASIN đã có dữ liệu Rank mới trong 7 ngày qua! (Dùng --force nếu muốn quét lại toàn bộ)");
    return;
  }

  // 4. Tiến hành quét từng ASIN qua Helium 10 Cerebro
  let successCount = 0;
  let failCount = 0;
  let totalOrgRankFound = 0;
  let totalSpRankFound = 0;

  for (let idx = 0; idx < toScan.length; idx++) {
    const item = toScan[idx];
    const isPriority = item.spend >= 10;
    const tag = isPriority ? `🔥 [SPEND: $${item.spend.toFixed(2)}]` : `[SPEND: $${item.spend.toFixed(2)}]`;
    const prefix = `[${idx + 1}/${toScan.length}] ${tag} [${item.store_name}] ASIN ${item.asin} (${item.sku})`;

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

      if (kws.length > 0) {
        await upsertVolumes(sql, "US", "helium10_cerebro", kws);
        await upsertRankings(sql, "US", [item.asin], kws);
      }

      await saveAsinCheckpoint(sql, "US", [item.asin], { ok: true, keywordCount: kws.length });

      totalOrgRankFound += orgCount;
      totalSpRankFound += spCount;
      successCount++;

      log(`${prefix}: ✅ Xong! ${kws.length} kws | Org: ${orgCount} | SP: ${spCount}`);

      // Delay 1.5s giữa các request để an toàn hạn mức
      await sleep(1500);
    } catch (err: any) {
      failCount++;
      const errMsg = err?.message || String(err);
      log(`${prefix}: ❌ Lỗi: ${errMsg}`);
      await saveAsinCheckpoint(sql, "US", [item.asin], { ok: false, error: errMsg });

      if (/rta-7017|not enough uses|unauthorized|cookie|hết hạn|không có quyền|status 401|status 403/i.test(errMsg)) {
        log(`\n⛔ Dừng quét: Lỗi xác thực hoặc hết hạn mức Helium 10 (${errMsg})`);
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
    console.error("Fatal error:", e);
    process.exit(1);
  });
