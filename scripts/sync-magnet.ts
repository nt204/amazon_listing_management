// scripts/sync-magnet.ts
// Chạy Magnet độc lập cho top từ khóa PPC đốt spend cao nhất mà chưa có Search Volume.
// Dùng khi Cerebro đã hết quota nhưng tài khoản còn lượt Magnet.
//
// Dùng: node --conditions=react-server --env-file-if-exists=.env --import tsx scripts/sync-magnet.ts [số_lượng_keyword]

import { getDatabaseClient } from "../lib/db";
import { mineHelium10Keywords, type Helium10KeywordItem } from "../lib/helium10-playwright";

const TEAM_ID = "default";
const DEFAULT_LIMIT = 20;
const CALL_DELAY_MS = 3000;

function normalizeKeyword(raw: string | null | undefined): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/\+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function upsertVolumes(
  sql: any,
  marketplace: string,
  source: string,
  items: Helium10KeywordItem[],
) {
  const byKeyword = new Map<string, Helium10KeywordItem>();
  for (const item of items) {
    const keyword = normalizeKeyword(item.keyword);
    if (keyword) byKeyword.set(keyword, item);
  }
  const rows = Array.from(byKeyword, ([keyword_norm, item]) => ({
    marketplace,
    keyword_norm,
    keyword: item.keyword,
    search_volume: typeof item.search_volume === "number" ? Math.round(item.search_volume) : null,
    search_volume_trend: item.search_volume_trend ?? null,
    cpc: item.cpc ?? null,
    competing_products: item.competing_products ?? null,
    source,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    await sql`
      INSERT INTO keyword_search_volumes ${sql(rows.slice(i, i + 500))}
      ON CONFLICT (marketplace, keyword_norm) DO UPDATE SET
        keyword = EXCLUDED.keyword,
        search_volume = EXCLUDED.search_volume,
        search_volume_trend = EXCLUDED.search_volume_trend,
        cpc = EXCLUDED.cpc,
        competing_products = EXCLUDED.competing_products,
        source = EXCLUDED.source,
        fetched_at = NOW()
    `;
  }
  return Array.from(byKeyword.keys());
}

async function main() {
  const limit = Math.max(1, Number(process.argv[2] || DEFAULT_LIMIT));
  const sql = await getDatabaseClient();

  console.log(`[Magnet] Bắt đầu tìm kiếm ${limit} từ khóa đốt spend cao nhất chưa có Search Volume...`);

  const missingKeywords = await sql<Array<{ kw: string; spend: number }>>`
    WITH missing AS (
      SELECT lower(trim(st.customer_search_term)) AS kw, SUM(st.spend) AS total_spend
      FROM ppc_search_terms st
      LEFT JOIN keyword_search_volumes kv ON kv.keyword_norm = lower(trim(st.customer_search_term))
      WHERE kv.search_volume IS NULL
        AND st.customer_search_term ~* '^[a-zA-Z0-9 ]+$'
        AND length(trim(st.customer_search_term)) >= 3
      GROUP BY lower(trim(st.customer_search_term))
    )
    SELECT kw, ROUND(total_spend::numeric, 2)::float AS spend 
    FROM missing 
    ORDER BY total_spend DESC NULLS LAST 
    LIMIT ${limit}
  `;

  if (missingKeywords.length === 0) {
    console.log("[Magnet] Không có từ khóa nào còn thiếu Search Volume. Hoàn tất!");
    process.exit(0);
  }

  console.log(`[Magnet] Tìm thấy ${missingKeywords.length} từ khóa ưu tiên:`);
  missingKeywords.forEach((k, idx) => {
    console.log(`  ${idx + 1}. "${k.kw}" ($${k.spend} spend)`);
  });

  // Ghi nhận run vào DB
  const [run] = await sql<Array<{ id: string }>>`
    INSERT INTO ppc_search_volume_sync_runs (
      team_id, created_by, status, message, started_at, heartbeat_at
    ) VALUES (
      ${TEAM_ID}, 'manual-magnet', 'running',
      ${`Đang chạy Magnet cho ${missingKeywords.length} từ khóa ưu tiên...`},
      NOW(), NOW()
    ) RETURNING id
  `;

  let magnetCalls = 0;
  let totalKeywordsUpserted = 0;
  let hasStoppedEarly = false;
  let stopReason = "";

  for (let i = 0; i < missingKeywords.length; i++) {
    const { kw: keyword, spend } = missingKeywords[i];
    console.log(`\n👉 [${i + 1}/${missingKeywords.length}] Đang chạy Magnet cho: "${keyword}" ($${spend} spend)...`);

    await sql`
      UPDATE ppc_search_volume_sync_runs
      SET heartbeat_at = NOW(),
          magnet_calls = ${magnetCalls},
          keywords_upserted = ${totalKeywordsUpserted},
          message = ${`Magnet [${i + 1}/${missingKeywords.length}]: "${keyword}" ($${spend} spend)`}
      WHERE id = ${run.id}
    `.catch(() => {});

    try {
      const result = await mineHelium10Keywords({
        keyword,
        marketplace: "US",
        limit: 200,
        directApiOnly: true,
      });

      magnetCalls++;
      const saved = await upsertVolumes(sql, "US", "helium10_magnet", result.keywords);
      totalKeywordsUpserted += saved.length;

      console.log(`   ✓ Thành công! Thu được ${result.keywords.length} từ khóa liên quan, nạp mới ${saved.length} từ khóa.`);

      const foundTarget = result.keywords.find(
        (k) => normalizeKeyword(k.keyword) === keyword
      );
      if (foundTarget) {
        console.log(`   🎯 Từ khóa gốc "${keyword}" Search Volume: ${foundTarget.search_volume ?? "N/A"}`);
      } else {
        console.log(`   ⚠️ Helium 10 không trả volume cho chính từ "${keyword}". Đánh dấu miss.`);
        await upsertVolumes(sql, "US", "helium10_magnet_miss", [{
          keyword,
          search_volume: null,
          iq_score: null,
          cpc: null,
          organic_rank: null,
          sponsored_rank: null,
          competing_products: null,
          cpr: null,
          title_density: null,
        }]);
      }
    } catch (err: any) {
      console.error(`   ❌ Lỗi khi gọi Magnet cho "${keyword}":`, err.message || err);
      const errMsg = String(err.message || err);
      if (
        errMsg.includes("Not enough uses") ||
        errMsg.includes("quota") ||
        errMsg.includes("401") ||
        errMsg.includes("rate limit")
      ) {
        hasStoppedEarly = true;
        stopReason = `Hết hạn mức hoặc phiên hết hạn: ${errMsg}`;
        break;
      }
    }

    if (i < missingKeywords.length - 1) {
      await sleep(CALL_DELAY_MS);
    }
  }

  const finalStatus = hasStoppedEarly ? "interrupted" : "completed";
  const finalMessage = hasStoppedEarly
    ? `Tạm dừng Magnet: ${stopReason}. Đã gọi ${magnetCalls} lượt, nạp ${totalKeywordsUpserted} từ khóa.`
    : `Hoàn tất Magnet! Đã gọi ${magnetCalls}/${missingKeywords.length} lượt, nạp thêm ${totalKeywordsUpserted} từ khóa.`;

  await sql`
    UPDATE ppc_search_volume_sync_runs
    SET status = ${finalStatus},
        finished_at = NOW(),
        heartbeat_at = NOW(),
        magnet_calls = ${magnetCalls},
        keywords_upserted = ${totalKeywordsUpserted},
        message = ${finalMessage}
    WHERE id = ${run.id}
  `;

  console.log(`\n🏁 ${finalMessage}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

