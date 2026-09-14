import postgres from "postgres";
import { MOCK_STORES, generateMockSearchTerms } from "../lib/ppc/mock-data-generator";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");

  const sql = postgres(connectionString, { max: 1 });
  const teamId = "default";

  console.log("🚀 Đang bắt đầu nạp bộ dữ liệu PPC giả lập đa dạng và phong phú vào Database...");

  try {
    const stores = MOCK_STORES;
    const searchTerms = generateMockSearchTerms();

    // 1. Ghi Store vào Database
    console.log(`\n📦 1. Nạp ${stores.length} Store bán hàng vào ppc_stores...`);
    for (const store of stores) {
      await sql`
        INSERT INTO ppc_stores (team_id, name, marketplace, target_acos, daily_budget, status)
        VALUES (
          ${teamId}, ${store.name}, ${store.marketplace}, ${store.targetAcos},
          ${store.dailyBudget}, ${store.status}
        )
        ON CONFLICT (team_id, name) DO UPDATE SET
          target_acos = EXCLUDED.target_acos,
          daily_budget = EXCLUDED.daily_budget,
          status = EXCLUDED.status,
          updated_at = NOW()
      `;
      console.log(`   ✓ Store: ${store.name} (${store.marketplace}) - Target ACOS: ${store.targetAcos}%`);
    }

    // 2. Lấy Map Store Name -> Store ID
    const dbStores = await sql<Array<{ id: string; name: string }>>`
      SELECT id, name FROM ppc_stores WHERE team_id = ${teamId}
    `;
    const storeMap = new Map<string, string>();
    for (const s of dbStores) {
      storeMap.set(s.name.toLowerCase(), s.id);
    }

    // 3. Ghi Campaigns vào ppc_campaigns
    console.log(`\n🎯 2. Tạo danh sách Campaigns trong ppc_campaigns...`);
    const uniqueCampaigns = Array.from(
      new Set(searchTerms.map((t) => `${t.storeName}_${t.campaignName}`))
    );

    let campaignCount = 0;
    for (const key of uniqueCampaigns) {
      const sample = searchTerms.find((t) => `${t.storeName}_${t.campaignName}` === key)!;
      const sName = (sample.storeName || "Bozspacer").toLowerCase();
      const storeId = storeMap.get(sName);
      if (!storeId) continue;

      const isAuto =
        sample.matchType === "Auto" || sample.campaignName.toLowerCase().includes("auto");

      await sql`
        INSERT INTO ppc_campaigns (store_id, campaign_name, campaign_type, targeting_type, daily_budget, status)
        VALUES (${storeId}, ${sample.campaignName}, 'SP', ${isAuto ? "AUTO" : "MANUAL"}, 50.0, 'ENABLED')
        ON CONFLICT (store_id, campaign_name) DO UPDATE SET
          targeting_type = EXCLUDED.targeting_type,
          updated_at = NOW()
      `;
      campaignCount++;
    }
    console.log(`   ✓ Đã tạo thành công ${campaignCount} chiến dịch Amazon Ads.`);

    // 4. Ghi Search Terms vào ppc_search_terms
    console.log(`\n📊 3. Nạp ${searchTerms.length} dòng Search Terms chi tiết vào ppc_search_terms...`);

    let insertedCount = 0;
    // Batching inserts in chunks of 50
    const chunkSize = 50;
    for (let i = 0; i < searchTerms.length; i += chunkSize) {
      const chunk = searchTerms.slice(i, i + chunkSize);

      for (const row of chunk) {
        const rName = (row.storeName || "Bozspacer").toLowerCase();
        const storeId = storeMap.get(rName);
        if (!storeId) continue;

        await sql`
          INSERT INTO ppc_search_terms (
            store_id, report_date, portfolio_name, campaign_name, ad_group_name,
            target_keyword, customer_search_term, match_type, impressions, clicks,
            spend, sales, orders, units, cpc, ctr, cvr, acos, roas, updated_at
          ) VALUES (
            ${storeId}, ${row.reportDate}, ${row.portfolioName}, ${row.campaignName}, ${row.adGroupName},
            ${row.targetKeyword}, ${row.customerSearchTerm}, ${row.matchType}, ${row.impressions}, ${row.clicks},
            ${row.spend}, ${row.sales}, ${row.orders}, ${row.units}, ${row.cpc}, ${row.ctr}, ${row.cvr}, ${row.acos}, ${row.roas}, NOW()
          )
          ON CONFLICT (
            store_id, report_date, portfolio_name, campaign_name, ad_group_name,
            target_keyword, customer_search_term, match_type
          ) DO UPDATE SET
            impressions = EXCLUDED.impressions,
            clicks = EXCLUDED.clicks,
            spend = EXCLUDED.spend,
            sales = EXCLUDED.sales,
            orders = EXCLUDED.orders,
            units = EXCLUDED.units,
            cpc = EXCLUDED.cpc,
            ctr = EXCLUDED.ctr,
            cvr = EXCLUDED.cvr,
            acos = EXCLUDED.acos,
            roas = EXCLUDED.roas,
            updated_at = NOW()
        `;
        insertedCount++;
      }
      process.stdout.write(`   ... đã nạp ${insertedCount}/${searchTerms.length} dòng\r`);
    }

    // 5. Ghi log đồng bộ
    await sql`
      INSERT INTO ppc_sync_logs (team_id, source, file_name, status, records_count, message)
      VALUES (
        ${teamId}, 'MOCK_DATA', 'comprehensive-mock-seed.xlsx', 'SUCCESS',
        ${insertedCount}, 'Đã nạp bộ dữ liệu giả lập phong phú đa store trải dài 30 ngày.'
      )
    `;

    console.log(`\n\n🎉 HOÀN THÀNH NẠP DỮ LIỆU PPC VÀO DATABASE!`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`• Tổng số Stores:        ${stores.length}`);
    console.log(`• Tổng số Campaigns:     ${campaignCount}`);
    console.log(`• Tổng số Search Terms:  ${insertedCount} dòng`);

    const stats = await sql<Array<{ total_spend: number; total_sales: number; total_orders: number; total_clicks: number }>>`
      SELECT
        COALESCE(SUM(spend), 0) as total_spend,
        COALESCE(SUM(sales), 0) as total_sales,
        COALESCE(SUM(orders), 0) as total_orders,
        COALESCE(SUM(clicks), 0) as total_clicks
      FROM ppc_search_terms
    `;

    if (stats.length > 0) {
      console.log(`• Tổng Spend:            $${Number(stats[0].total_spend).toFixed(2)}`);
      console.log(`• Tổng Sales:            $${Number(stats[0].total_sales).toFixed(2)}`);
      console.log(`• Tổng Orders:           ${stats[0].total_orders}`);
      console.log(`• Tổng Clicks:           ${stats[0].total_clicks}`);
    }
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("Lỗi khi seed PPC DB:", err);
  process.exit(1);
});
