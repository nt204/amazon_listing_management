// app/api/ppc/search-terms/campaign-rollup/route.ts
import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";

export const runtime = "nodejs";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertDateRange(startDate: string, endDate: string, label: string) {
  if (!ISO_DATE_RE.test(startDate) || !ISO_DATE_RE.test(endDate)) {
    throw new ApiError(`${label} không đúng định dạng YYYY-MM-DD.`, 400);
  }
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start.toISOString().slice(0, 10) !== startDate || end.toISOString().slice(0, 10) !== endDate) {
    throw new ApiError(`${label} chứa ngày không hợp lệ.`, 400);
  }
  if (startDate > endDate) throw new ApiError(`${label}: ngày bắt đầu phải trước hoặc bằng ngày kết thúc.`, 400);
}

function inclusiveDays(startDate: string, endDate: string) {
  return Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
}

export async function GET(request: Request) {
  try {
    const scope = dataScope(await authorize(request, "read", "ppc"));
    const { searchParams } = new URL(request.url);

    const storeName = searchParams.get("storeName") || "ALL";
    const sku = searchParams.get("sku") || "ALL";
    const search = searchParams.get("search")?.trim().toLowerCase() || "";
    const detailCampaign = searchParams.get("detailCampaign")?.trim() || "";

    // Dải ngày chính (Kỳ A)
    const startDate = searchParams.get("startDate")?.trim() || "2026-09-01";
    const endDate = searchParams.get("endDate")?.trim() || "2026-09-07";

    // Dải ngày so sánh (Kỳ B - tùy chọn)
    const compareStartDate = searchParams.get("compareStartDate")?.trim() || "";
    const compareEndDate = searchParams.get("compareEndDate")?.trim() || "";
    const hasCompare = Boolean(compareStartDate && compareEndDate);
    const metadataOnly = searchParams.get("metadataOnly") === "true";

    assertDateRange(startDate, endDate, "Kỳ hiện tại");
    if ((compareStartDate && !compareEndDate) || (!compareStartDate && compareEndDate)) {
      throw new ApiError("Kỳ so sánh phải có đủ ngày bắt đầu và kết thúc.", 400);
    }
    if (hasCompare) assertDateRange(compareStartDate, compareEndDate, "Kỳ so sánh");

    const requestedPage = Number(searchParams.get("page") || 1);
    const requestedPageSize = Number(searchParams.get("pageSize") || 50);
    const page = Number.isFinite(requestedPage) ? Math.max(1, Math.floor(requestedPage)) : 1;
    const pageSize = Number.isFinite(requestedPageSize) ? Math.min(200, Math.max(10, Math.floor(requestedPageSize))) : 50;
    const sortBy = searchParams.get("sortBy") || "spend";
    const sortDir = (searchParams.get("sortDir") || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";

    const sql = await getDatabaseClient();

    let storeId: string | null = null;
    if (storeName !== "ALL") {
      const storeRows = await sql<{ id: string }[]>`
        SELECT id FROM ppc_stores
        WHERE team_id = ${scope.teamId} AND lower(name) = lower(${storeName})
        LIMIT 1
      `;
      if (storeRows.length === 0) throw new ApiError("Không tìm thấy store PPC đã chọn.", 404);
      storeId = storeRows[0].id;
    }

    const skuFilter = sku !== "ALL"
      ? sql`AND (
          upper(COALESCE(NULLIF(p.sku, ''), p.portfolio_name)) = upper(${sku})
          OR upper(p.portfolio_name) = upper(${sku})
        )`
      : sql``;

    const availableRows = await sql<Array<{ min_date: string | null; max_date: string | null; available_days: number }>>`
      SELECT MIN(p.report_date)::text AS min_date,
             MAX(p.report_date)::text AS max_date,
             COUNT(DISTINCT p.report_date)::integer AS available_days
      FROM ppc_search_terms p
      JOIN ppc_stores s ON s.id = p.store_id
      WHERE s.team_id = ${scope.teamId}
        ${storeId ? sql`AND p.store_id = ${storeId}` : sql``}
        ${skuFilter}
        AND p.report_granularity = 'DAILY'
    `;
    const availableRange = {
      startDate: availableRows[0]?.min_date || null,
      endDate: availableRows[0]?.max_date || null,
      availableDays: Number(availableRows[0]?.available_days || 0),
    };
    if (metadataOnly) return Response.json({ success: true, data: { availableRange } });

    // 1. NẾU YÊU CẦU CHI TIẾT TỪ KHÓA CỦA 1 CAMPAIGN CỤ THỂ (DRILL-DOWN)
    if (detailCampaign) {
      if (!hasCompare) {
        // Chi tiết Search Terms cho 1 kỳ
        const terms = await sql<Array<{
          customer_search_term: string;
          target_keyword: string;
          match_type: string;
          impressions: string;
          clicks: number;
          spend: string;
          sales: string;
          orders: number;
        }>>`
          SELECT
            p.customer_search_term,
            COALESCE(p.target_keyword, '') as target_keyword,
            p.match_type,
            SUM(p.impressions)::bigint as impressions,
            SUM(p.clicks)::integer as clicks,
            SUM(p.spend)::numeric as spend,
            SUM(p.sales)::numeric as sales,
            SUM(p.orders)::integer as orders
          FROM ppc_search_terms p
          JOIN ppc_stores s ON s.id = p.store_id
          WHERE s.team_id = ${scope.teamId}
            ${storeId ? sql`AND p.store_id = ${storeId}` : sql``}
            ${skuFilter}
            AND p.campaign_name = ${detailCampaign}
            AND p.report_granularity = 'DAILY'
            AND p.report_date >= ${startDate}::date AND p.report_date <= ${endDate}::date
          GROUP BY p.customer_search_term, p.target_keyword, p.match_type
          ORDER BY SUM(p.spend) DESC, SUM(p.orders) DESC
          LIMIT 200
        `;

        return Response.json({
          success: true,
          data: {
            campaignName: detailCampaign,
            items: terms.map((t) => {
              const spend = Number(t.spend || 0);
              const sales = Number(t.sales || 0);
              const clicks = Number(t.clicks || 0);
              const orders = Number(t.orders || 0);
              const impressions = Number(t.impressions || 0);
              const cpc = clicks > 0 ? Number((spend / clicks).toFixed(2)) : 0;
              const acos = sales > 0 ? Number(((spend / sales) * 100).toFixed(2)) : 0;
              const ctr = impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0;
              const cvr = clicks > 0 ? Number(((orders / clicks) * 100).toFixed(2)) : 0;

              let status: "WINNER" | "BLEEDER" | "NORMAL" = "NORMAL";
              if (orders > 0 && acos <= 35) status = "WINNER";
              else if (spend >= 1.5 && orders === 0) status = "BLEEDER";

              return {
                searchTerm: t.customer_search_term,
                targetKeyword: t.target_keyword,
                matchType: t.match_type,
                impressions,
                clicks,
                spend,
                sales,
                orders,
                cpc,
                acos,
                ctr,
                cvr,
                status,
              };
            }),
          },
        });
      }

      // Chi tiết Search Terms khi đang So sánh 2 kỳ
      const compareTerms = await sql<Array<{
        customer_search_term: string;
        match_type: string;
        p1_spend: string;
        p1_sales: string;
        p1_orders: number;
        p1_clicks: number;
        p1_impressions: string;
        p2_spend: string;
        p2_sales: string;
        p2_orders: number;
        p2_clicks: number;
        p2_impressions: string;
      }>>`
        WITH p1 AS (
          SELECT
            p.customer_search_term,
            p.match_type,
            SUM(p.impressions)::bigint as p1_impressions,
            SUM(p.clicks)::integer as p1_clicks,
            SUM(p.spend)::numeric as p1_spend,
            SUM(p.sales)::numeric as p1_sales,
            SUM(p.orders)::integer as p1_orders
          FROM ppc_search_terms p
          JOIN ppc_stores s ON s.id = p.store_id
          WHERE s.team_id = ${scope.teamId}
            ${storeId ? sql`AND p.store_id = ${storeId}` : sql``}
            ${skuFilter}
            AND p.campaign_name = ${detailCampaign}
            AND p.report_granularity = 'DAILY'
            AND p.report_date >= ${startDate}::date AND p.report_date <= ${endDate}::date
          GROUP BY p.customer_search_term, p.match_type
        ),
        p2 AS (
          SELECT
            p.customer_search_term,
            p.match_type,
            SUM(p.impressions)::bigint as p2_impressions,
            SUM(p.clicks)::integer as p2_clicks,
            SUM(p.spend)::numeric as p2_spend,
            SUM(p.sales)::numeric as p2_sales,
            SUM(p.orders)::integer as p2_orders
          FROM ppc_search_terms p
          JOIN ppc_stores s ON s.id = p.store_id
          WHERE s.team_id = ${scope.teamId}
            ${storeId ? sql`AND p.store_id = ${storeId}` : sql``}
            ${skuFilter}
            AND p.campaign_name = ${detailCampaign}
            AND p.report_granularity = 'DAILY'
            AND p.report_date >= ${compareStartDate}::date AND p.report_date <= ${compareEndDate}::date
          GROUP BY p.customer_search_term, p.match_type
        )
        SELECT
          COALESCE(p1.customer_search_term, p2.customer_search_term) as customer_search_term,
          COALESCE(p1.match_type, p2.match_type) as match_type,
          COALESCE(p1.p1_spend, 0)::numeric as p1_spend,
          COALESCE(p1.p1_sales, 0)::numeric as p1_sales,
          COALESCE(p1.p1_orders, 0)::integer as p1_orders,
          COALESCE(p1.p1_clicks, 0)::integer as p1_clicks,
          COALESCE(p1.p1_impressions, 0)::bigint as p1_impressions,
          COALESCE(p2.p2_spend, 0)::numeric as p2_spend,
          COALESCE(p2.p2_sales, 0)::numeric as p2_sales,
          COALESCE(p2.p2_orders, 0)::integer as p2_orders,
          COALESCE(p2.p2_clicks, 0)::integer as p2_clicks,
          COALESCE(p2.p2_impressions, 0)::bigint as p2_impressions
        FROM p1
        FULL OUTER JOIN p2 ON p1.customer_search_term = p2.customer_search_term AND p1.match_type = p2.match_type
        ORDER BY GREATEST(COALESCE(p1.p1_spend, 0), COALESCE(p2.p2_spend, 0)) DESC
        LIMIT 300
      `;

      return Response.json({
        success: true,
        data: {
          campaignName: detailCampaign,
          items: compareTerms.map((t) => {
            const p1Spend = Number(t.p1_spend || 0);
            const p1Sales = Number(t.p1_sales || 0);
            const p1Clicks = Number(t.p1_clicks || 0);
            const p1Orders = Number(t.p1_orders || 0);
            const p1Cpc = p1Clicks > 0 ? Number((p1Spend / p1Clicks).toFixed(2)) : 0;
            const p1Acos = p1Sales > 0 ? Number(((p1Spend / p1Sales) * 100).toFixed(2)) : 0;

            const p2Spend = Number(t.p2_spend || 0);
            const p2Sales = Number(t.p2_sales || 0);
            const p2Clicks = Number(t.p2_clicks || 0);
            const p2Orders = Number(t.p2_orders || 0);
            const p2Cpc = p2Clicks > 0 ? Number((p2Spend / p2Clicks).toFixed(2)) : 0;
            const p2Acos = p2Sales > 0 ? Number(((p2Spend / p2Sales) * 100).toFixed(2)) : 0;

            let classification: "NEW_BLEEDER" | "LOST_WINNER" | "GROWTH" | "STABLE" | "OTHER" = "OTHER";
            if (p1Spend >= 1.5 && p1Orders === 0 && p2Orders === 0) {
              classification = "NEW_BLEEDER";
            } else if (p2Orders > 0 && p1Orders === 0) {
              classification = "LOST_WINNER";
            } else if (p1Orders > p2Orders && p1Orders > 0) {
              classification = "GROWTH";
            } else if (p1Orders > 0 && p2Orders > 0) {
              classification = "STABLE";
            }

            return {
              searchTerm: t.customer_search_term,
              matchType: t.match_type,
              p1: { spend: p1Spend, sales: p1Sales, orders: p1Orders, clicks: p1Clicks, cpc: p1Cpc, acos: p1Acos },
              p2: { spend: p2Spend, sales: p2Sales, orders: p2Orders, clicks: p2Clicks, cpc: p2Cpc, acos: p2Acos },
              deltaSpend: Number((p1Spend - p2Spend).toFixed(2)),
              deltaSales: Number((p1Sales - p2Sales).toFixed(2)),
              deltaOrders: p1Orders - p2Orders,
              deltaAcos: Number((p1Acos - p2Acos).toFixed(2)),
              classification,
            };
          }),
        },
      });
    }

    // 2. QUERY DANH SÁCH CAMPAIGNS ROLL-UP & SUMMARY
    const searchFilter = search
      ? sql`AND lower(p.campaign_name) LIKE ${`%${search}%`}`
      : sql``;

    if (!hasCompare) {
      // --- CHẾ ĐỘ 1: XEM 1 KỲ (SINGLE PERIOD) ---
      // Query Summary
      const summaryRows = await sql<Array<{
        total_campaigns: string;
        total_terms: string;
        total_spend: string;
        total_sales: string;
        total_orders: string;
        total_clicks: string;
        total_impressions: string;
        data_days: number;
      }>>`
        SELECT
          COUNT(DISTINCT p.campaign_name)::integer as total_campaigns,
          COUNT(DISTINCT p.customer_search_term)::integer as total_terms,
          COALESCE(SUM(p.spend), 0)::numeric as total_spend,
          COALESCE(SUM(p.sales), 0)::numeric as total_sales,
          COALESCE(SUM(p.orders), 0)::integer as total_orders,
          COALESCE(SUM(p.clicks), 0)::integer as total_clicks,
          COALESCE(SUM(p.impressions), 0)::bigint as total_impressions
          , COUNT(DISTINCT p.report_date)::integer as data_days
        FROM ppc_search_terms p
        JOIN ppc_stores s ON s.id = p.store_id
        WHERE s.team_id = ${scope.teamId}
          ${storeId ? sql`AND p.store_id = ${storeId}` : sql``}
          ${skuFilter}
          ${searchFilter}
          AND p.report_granularity = 'DAILY'
          AND p.report_date >= ${startDate}::date AND p.report_date <= ${endDate}::date
      `;

      const sum = summaryRows[0] || {
        total_campaigns: "0",
        total_terms: "0",
        total_spend: "0",
        total_sales: "0",
        total_orders: "0",
        total_clicks: "0",
        total_impressions: "0",
        data_days: 0,
      };

      const totalCampaigns = Number(sum.total_campaigns || 0);
      const totalPages = Math.max(1, Math.ceil(totalCampaigns / pageSize));
      const offset = (page - 1) * pageSize;

      // Order clause
      let orderSql = sql`SUM(p.spend) DESC, SUM(p.orders) DESC`;
      if (sortBy === "sales") orderSql = sortDir === "ASC" ? sql`SUM(p.sales) ASC` : sql`SUM(p.sales) DESC`;
      else if (sortBy === "orders") orderSql = sortDir === "ASC" ? sql`SUM(p.orders) ASC` : sql`SUM(p.orders) DESC`;
      else if (sortBy === "clicks") orderSql = sortDir === "ASC" ? sql`SUM(p.clicks) ASC` : sql`SUM(p.clicks) DESC`;
      else if (sortBy === "impressions") orderSql = sortDir === "ASC" ? sql`SUM(p.impressions) ASC` : sql`SUM(p.impressions) DESC`;
      else if (sortBy === "name") orderSql = sortDir === "ASC" ? sql`p.campaign_name ASC` : sql`p.campaign_name DESC`;
      else if (sortBy === "acos") {
        orderSql = sortDir === "ASC"
          ? sql`(CASE WHEN SUM(p.sales) > 0 THEN SUM(p.spend) / SUM(p.sales) ELSE 999 END) ASC`
          : sql`(CASE WHEN SUM(p.sales) > 0 THEN SUM(p.spend) / SUM(p.sales) ELSE 0 END) DESC`;
      } else if (sortBy === "cpc") {
        orderSql = sortDir === "ASC"
          ? sql`(CASE WHEN SUM(p.clicks) > 0 THEN SUM(p.spend) / SUM(p.clicks) ELSE 999 END) ASC`
          : sql`(CASE WHEN SUM(p.clicks) > 0 THEN SUM(p.spend) / SUM(p.clicks) ELSE 0 END) DESC`;
      } else {
        orderSql = sortDir === "ASC" ? sql`SUM(p.spend) ASC` : sql`SUM(p.spend) DESC`;
      }

      // Query Items
      const items = await sql<Array<{
        campaign_name: string;
        total_terms: string;
        impressions: string;
        clicks: number;
        spend: string;
        sales: string;
        orders: number;
      }>>`
        SELECT
          p.campaign_name,
          COUNT(DISTINCT p.customer_search_term)::integer as total_terms,
          SUM(p.impressions)::bigint as impressions,
          SUM(p.clicks)::integer as clicks,
          SUM(p.spend)::numeric as spend,
          SUM(p.sales)::numeric as sales,
          SUM(p.orders)::integer as orders
        FROM ppc_search_terms p
        JOIN ppc_stores s ON s.id = p.store_id
        WHERE s.team_id = ${scope.teamId}
          ${storeId ? sql`AND p.store_id = ${storeId}` : sql``}
          ${skuFilter}
          ${searchFilter}
          AND p.report_granularity = 'DAILY'
          AND p.report_date >= ${startDate}::date AND p.report_date <= ${endDate}::date
        GROUP BY p.campaign_name
        ORDER BY ${orderSql}
        LIMIT ${pageSize} OFFSET ${offset}
      `;

      return Response.json({
        success: true,
        data: {
          mode: "single",
          period: { startDate, endDate },
          availableRange,
          coverage: {
            expectedDays: inclusiveDays(startDate, endDate),
            dataDays: Number(sum.data_days || 0),
            complete: Number(sum.data_days || 0) === inclusiveDays(startDate, endDate),
          },
          summary: {
            totalCampaigns,
            totalTerms: Number(sum.total_terms || 0),
            spend: Number(sum.total_spend || 0),
            sales: Number(sum.total_sales || 0),
            orders: Number(sum.total_orders || 0),
            clicks: Number(sum.total_clicks || 0),
            impressions: Number(sum.total_impressions || 0),
            acos: Number(sum.total_sales) > 0 ? Number(((Number(sum.total_spend) / Number(sum.total_sales)) * 100).toFixed(2)) : 0,
            cpc: Number(sum.total_clicks) > 0 ? Number((Number(sum.total_spend) / Number(sum.total_clicks)).toFixed(2)) : 0,
            ctr: Number(sum.total_impressions) > 0 ? Number(((Number(sum.total_clicks) / Number(sum.total_impressions)) * 100).toFixed(2)) : 0,
            cvr: Number(sum.total_clicks) > 0 ? Number(((Number(sum.total_orders) / Number(sum.total_clicks)) * 100).toFixed(2)) : 0,
          },
          items: items.map((r) => {
            const spend = Number(r.spend || 0);
            const sales = Number(r.sales || 0);
            const clicks = Number(r.clicks || 0);
            const orders = Number(r.orders || 0);
            const impressions = Number(r.impressions || 0);
            const cpc = clicks > 0 ? Number((spend / clicks).toFixed(2)) : 0;
            const acos = sales > 0 ? Number(((spend / sales) * 100).toFixed(2)) : 0;
            const ctr = impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0;
            const cvr = clicks > 0 ? Number(((orders / clicks) * 100).toFixed(2)) : 0;
            const roas = spend > 0 ? Number((sales / spend).toFixed(2)) : 0;

            return {
              campaignName: r.campaign_name,
              totalTerms: Number(r.total_terms || 0),
              impressions,
              clicks,
              spend,
              sales,
              orders,
              cpc,
              acos,
              ctr,
              cvr,
              roas,
            };
          }),
          total: totalCampaigns,
          page,
          pageSize,
          totalPages,
        },
      });
    }

    // --- CHẾ ĐỘ 2: SO SÁNH 2 KỲ (COMPARE PERIODS) ---
    // Summary cho cả 2 kỳ
    const compareSummaryRows = await sql<Array<{
      p1_spend: string;
      p1_sales: string;
      p1_orders: number;
      p1_clicks: number;
      p1_impressions: string;
      p1_terms: string;
      p1_campaigns: string;
      p2_spend: string;
      p2_sales: string;
      p2_orders: number;
      p2_clicks: number;
      p2_impressions: string;
      p2_terms: string;
      p2_campaigns: string;
      p1_days: number;
      p2_days: number;
    }>>`
      SELECT
        COALESCE(SUM(CASE WHEN p.report_date >= ${startDate}::date AND p.report_date <= ${endDate}::date THEN p.spend ELSE 0 END), 0)::numeric as p1_spend,
        COALESCE(SUM(CASE WHEN p.report_date >= ${startDate}::date AND p.report_date <= ${endDate}::date THEN p.sales ELSE 0 END), 0)::numeric as p1_sales,
        COALESCE(SUM(CASE WHEN p.report_date >= ${startDate}::date AND p.report_date <= ${endDate}::date THEN p.orders ELSE 0 END), 0)::integer as p1_orders,
        COALESCE(SUM(CASE WHEN p.report_date >= ${startDate}::date AND p.report_date <= ${endDate}::date THEN p.clicks ELSE 0 END), 0)::integer as p1_clicks,
        COALESCE(SUM(CASE WHEN p.report_date >= ${startDate}::date AND p.report_date <= ${endDate}::date THEN p.impressions ELSE 0 END), 0)::bigint as p1_impressions,
        COUNT(DISTINCT CASE WHEN p.report_date >= ${startDate}::date AND p.report_date <= ${endDate}::date THEN p.customer_search_term END)::integer as p1_terms,
        COUNT(DISTINCT CASE WHEN p.report_date >= ${startDate}::date AND p.report_date <= ${endDate}::date THEN p.campaign_name END)::integer as p1_campaigns,
        COUNT(DISTINCT CASE WHEN p.report_date >= ${startDate}::date AND p.report_date <= ${endDate}::date THEN p.report_date END)::integer as p1_days,

        COALESCE(SUM(CASE WHEN p.report_date >= ${compareStartDate}::date AND p.report_date <= ${compareEndDate}::date THEN p.spend ELSE 0 END), 0)::numeric as p2_spend,
        COALESCE(SUM(CASE WHEN p.report_date >= ${compareStartDate}::date AND p.report_date <= ${compareEndDate}::date THEN p.sales ELSE 0 END), 0)::numeric as p2_sales,
        COALESCE(SUM(CASE WHEN p.report_date >= ${compareStartDate}::date AND p.report_date <= ${compareEndDate}::date THEN p.orders ELSE 0 END), 0)::integer as p2_orders,
        COALESCE(SUM(CASE WHEN p.report_date >= ${compareStartDate}::date AND p.report_date <= ${compareEndDate}::date THEN p.clicks ELSE 0 END), 0)::integer as p2_clicks,
        COALESCE(SUM(CASE WHEN p.report_date >= ${compareStartDate}::date AND p.report_date <= ${compareEndDate}::date THEN p.impressions ELSE 0 END), 0)::bigint as p2_impressions,
        COUNT(DISTINCT CASE WHEN p.report_date >= ${compareStartDate}::date AND p.report_date <= ${compareEndDate}::date THEN p.customer_search_term END)::integer as p2_terms,
        COUNT(DISTINCT CASE WHEN p.report_date >= ${compareStartDate}::date AND p.report_date <= ${compareEndDate}::date THEN p.campaign_name END)::integer as p2_campaigns,
        COUNT(DISTINCT CASE WHEN p.report_date >= ${compareStartDate}::date AND p.report_date <= ${compareEndDate}::date THEN p.report_date END)::integer as p2_days
      FROM ppc_search_terms p
      JOIN ppc_stores s ON s.id = p.store_id
      WHERE s.team_id = ${scope.teamId}
        ${storeId ? sql`AND p.store_id = ${storeId}` : sql``}
        ${skuFilter}
        ${searchFilter}
        AND p.report_granularity = 'DAILY'
        AND (
          (p.report_date >= ${startDate}::date AND p.report_date <= ${endDate}::date)
          OR (p.report_date >= ${compareStartDate}::date AND p.report_date <= ${compareEndDate}::date)
        )
    `;

    const cSum = compareSummaryRows[0];
    const p1SpendSum = Number(cSum?.p1_spend || 0);
    const p1SalesSum = Number(cSum?.p1_sales || 0);
    const p1OrdersSum = Number(cSum?.p1_orders || 0);
    const p1ClicksSum = Number(cSum?.p1_clicks || 0);
    const p1AcosSum = p1SalesSum > 0 ? Number(((p1SpendSum / p1SalesSum) * 100).toFixed(2)) : 0;
    const p1CpcSum = p1ClicksSum > 0 ? Number((p1SpendSum / p1ClicksSum).toFixed(2)) : 0;

    const p2SpendSum = Number(cSum?.p2_spend || 0);
    const p2SalesSum = Number(cSum?.p2_sales || 0);
    const p2OrdersSum = Number(cSum?.p2_orders || 0);
    const p2ClicksSum = Number(cSum?.p2_clicks || 0);
    const p2AcosSum = p2SalesSum > 0 ? Number(((p2SpendSum / p2SalesSum) * 100).toFixed(2)) : 0;
    const p2CpcSum = p2ClicksSum > 0 ? Number((p2SpendSum / p2ClicksSum).toFixed(2)) : 0;

    // Đếm tổng số Campaign gộp của 2 kỳ
    const countTotalRes = await sql<{ total: string }[]>`
      SELECT COUNT(DISTINCT p.campaign_name)::integer as total
      FROM ppc_search_terms p
      JOIN ppc_stores s ON s.id = p.store_id
      WHERE s.team_id = ${scope.teamId}
        ${storeId ? sql`AND p.store_id = ${storeId}` : sql``}
        ${skuFilter}
        ${searchFilter}
        AND p.report_granularity = 'DAILY'
        AND (
          (p.report_date >= ${startDate}::date AND p.report_date <= ${endDate}::date)
          OR (p.report_date >= ${compareStartDate}::date AND p.report_date <= ${compareEndDate}::date)
        )
    `;
    const totalCompareCampaigns = Number(countTotalRes[0]?.total || 0);
    const totalComparePages = Math.max(1, Math.ceil(totalCompareCampaigns / pageSize));
    const compareOffset = (page - 1) * pageSize;

    let compareOrderSql = sql`GREATEST(COALESCE(p1.p1_spend, 0), COALESCE(p2.p2_spend, 0)) DESC`;
    if (sortBy === "sales") {
      compareOrderSql = sortDir === "ASC"
        ? sql`COALESCE(p1.p1_sales, 0) ASC`
        : sql`COALESCE(p1.p1_sales, 0) DESC`;
    } else if (sortBy === "orders") {
      compareOrderSql = sortDir === "ASC"
        ? sql`COALESCE(p1.p1_orders, 0) ASC`
        : sql`COALESCE(p1.p1_orders, 0) DESC`;
    } else if (sortBy === "clicks") {
      compareOrderSql = sortDir === "ASC"
        ? sql`COALESCE(p1.p1_clicks, 0) ASC`
        : sql`COALESCE(p1.p1_clicks, 0) DESC`;
    } else if (sortBy === "name") {
      compareOrderSql = sortDir === "ASC"
        ? sql`COALESCE(p1.campaign_name, p2.campaign_name) ASC`
        : sql`COALESCE(p1.campaign_name, p2.campaign_name) DESC`;
    } else if (sortBy === "spend") {
      compareOrderSql = sortDir === "ASC"
        ? sql`COALESCE(p1.p1_spend, 0) ASC`
        : sql`COALESCE(p1.p1_spend, 0) DESC`;
    } else if (sortBy === "delta_spend" || sortBy === "deltaSpend") {
      compareOrderSql = sortDir === "ASC"
        ? sql`(COALESCE(p1.p1_spend, 0) - COALESCE(p2.p2_spend, 0)) ASC`
        : sql`(COALESCE(p1.p1_spend, 0) - COALESCE(p2.p2_spend, 0)) DESC`;
    } else if (sortBy === "acos") {
      compareOrderSql = sortDir === "ASC"
        ? sql`(CASE WHEN COALESCE(p1.p1_sales, 0) > 0 THEN COALESCE(p1.p1_spend, 0) / p1.p1_sales ELSE 999 END) ASC`
        : sql`(CASE WHEN COALESCE(p1.p1_sales, 0) > 0 THEN COALESCE(p1.p1_spend, 0) / p1.p1_sales ELSE 0 END) DESC`;
    }

    // Query Items so sánh 2 kỳ
    const compareItems = await sql<Array<{
      campaign_name: string;
      p1_spend: string;
      p1_sales: string;
      p1_orders: number;
      p1_clicks: number;
      p1_impressions: string;
      p1_terms: string;
      p2_spend: string;
      p2_sales: string;
      p2_orders: number;
      p2_clicks: number;
      p2_impressions: string;
      p2_terms: string;
    }>>`
      WITH p1 AS (
        SELECT
          p.campaign_name,
          COUNT(DISTINCT p.customer_search_term)::integer as p1_terms,
          SUM(p.impressions)::bigint as p1_impressions,
          SUM(p.clicks)::integer as p1_clicks,
          SUM(p.spend)::numeric as p1_spend,
          SUM(p.sales)::numeric as p1_sales,
          SUM(p.orders)::integer as p1_orders
        FROM ppc_search_terms p
        JOIN ppc_stores s ON s.id = p.store_id
        WHERE s.team_id = ${scope.teamId}
          ${storeId ? sql`AND p.store_id = ${storeId}` : sql``}
          ${skuFilter}
          ${searchFilter}
          AND p.report_granularity = 'DAILY'
          AND p.report_date >= ${startDate}::date AND p.report_date <= ${endDate}::date
        GROUP BY p.campaign_name
      ),
      p2 AS (
        SELECT
          p.campaign_name,
          COUNT(DISTINCT p.customer_search_term)::integer as p2_terms,
          SUM(p.impressions)::bigint as p2_impressions,
          SUM(p.clicks)::integer as p2_clicks,
          SUM(p.spend)::numeric as p2_spend,
          SUM(p.sales)::numeric as p2_sales,
          SUM(p.orders)::integer as p2_orders
        FROM ppc_search_terms p
        JOIN ppc_stores s ON s.id = p.store_id
        WHERE s.team_id = ${scope.teamId}
          ${storeId ? sql`AND p.store_id = ${storeId}` : sql``}
          ${skuFilter}
          ${searchFilter}
          AND p.report_granularity = 'DAILY'
          AND p.report_date >= ${compareStartDate}::date AND p.report_date <= ${compareEndDate}::date
        GROUP BY p.campaign_name
      )
      SELECT
        COALESCE(p1.campaign_name, p2.campaign_name) as campaign_name,
        COALESCE(p1.p1_spend, 0)::numeric as p1_spend,
        COALESCE(p1.p1_sales, 0)::numeric as p1_sales,
        COALESCE(p1.p1_orders, 0)::integer as p1_orders,
        COALESCE(p1.p1_clicks, 0)::integer as p1_clicks,
        COALESCE(p1.p1_impressions, 0)::bigint as p1_impressions,
        COALESCE(p1.p1_terms, 0)::integer as p1_terms,
        COALESCE(p2.p2_spend, 0)::numeric as p2_spend,
        COALESCE(p2.p2_sales, 0)::numeric as p2_sales,
        COALESCE(p2.p2_orders, 0)::integer as p2_orders,
        COALESCE(p2.p2_clicks, 0)::integer as p2_clicks,
        COALESCE(p2.p2_impressions, 0)::bigint as p2_impressions,
        COALESCE(p2.p2_terms, 0)::integer as p2_terms
      FROM p1
      FULL OUTER JOIN p2 ON p1.campaign_name = p2.campaign_name
      ORDER BY ${compareOrderSql}
      LIMIT ${pageSize} OFFSET ${compareOffset}
    `;

    const p1CvrSum = p1ClicksSum > 0 ? Number(((p1OrdersSum / p1ClicksSum) * 100).toFixed(2)) : 0;
    const p2CvrSum = p2ClicksSum > 0 ? Number(((p2OrdersSum / p2ClicksSum) * 100).toFixed(2)) : 0;
    const p1TermsSum = Number(cSum?.p1_terms || 0);
    const p2TermsSum = Number(cSum?.p2_terms || 0);

    return Response.json({
      success: true,
      data: {
        mode: "compare",
        period1: { startDate, endDate },
        period2: { startDate: compareStartDate, endDate: compareEndDate },
        availableRange,
        coverage: {
          p1: {
            expectedDays: inclusiveDays(startDate, endDate),
            dataDays: Number(cSum?.p1_days || 0),
            complete: Number(cSum?.p1_days || 0) === inclusiveDays(startDate, endDate),
          },
          p2: {
            expectedDays: inclusiveDays(compareStartDate, compareEndDate),
            dataDays: Number(cSum?.p2_days || 0),
            complete: Number(cSum?.p2_days || 0) === inclusiveDays(compareStartDate, compareEndDate),
          },
        },
        summary: {
          p1: {
            spend: p1SpendSum,
            sales: p1SalesSum,
            orders: p1OrdersSum,
            clicks: p1ClicksSum,
            impressions: Number(cSum?.p1_impressions || 0),
            terms: p1TermsSum,
            campaigns: Number(cSum?.p1_campaigns || 0),
            acos: p1AcosSum,
            cpc: p1CpcSum,
            cvr: p1CvrSum,
          },
          p2: {
            spend: p2SpendSum,
            sales: p2SalesSum,
            orders: p2OrdersSum,
            clicks: p2ClicksSum,
            impressions: Number(cSum?.p2_impressions || 0),
            terms: p2TermsSum,
            campaigns: Number(cSum?.p2_campaigns || 0),
            acos: p2AcosSum,
            cpc: p2CpcSum,
            cvr: p2CvrSum,
          },
          delta: {
            spend: Number((p1SpendSum - p2SpendSum).toFixed(2)),
            spendPct: p2SpendSum > 0 ? Number((((p1SpendSum - p2SpendSum) / p2SpendSum) * 100).toFixed(1)) : 0,
            sales: Number((p1SalesSum - p2SalesSum).toFixed(2)),
            salesPct: p2SalesSum > 0 ? Number((((p1SalesSum - p2SalesSum) / p2SalesSum) * 100).toFixed(1)) : 0,
            orders: p1OrdersSum - p2OrdersSum,
            ordersPct: p2OrdersSum > 0 ? Number((((p1OrdersSum - p2OrdersSum) / p2OrdersSum) * 100).toFixed(1)) : 0,
            acos: Number((p1AcosSum - p2AcosSum).toFixed(1)),
            cvr: Number((p1CvrSum - p2CvrSum).toFixed(2)),
            cpc: Number((p1CpcSum - p2CpcSum).toFixed(2)),
            cpcPct: p2CpcSum > 0 ? Number((((p1CpcSum - p2CpcSum) / p2CpcSum) * 100).toFixed(1)) : 0,
            terms: p1TermsSum - p2TermsSum,
            termsPct: p2TermsSum > 0 ? Number((((p1TermsSum - p2TermsSum) / p2TermsSum) * 100).toFixed(1)) : 0,
          },
        },
        items: compareItems.map((r) => {
          const p1Spend = Number(r.p1_spend || 0);
          const p1Sales = Number(r.p1_sales || 0);
          const p1Orders = Number(r.p1_orders || 0);
          const p1Clicks = Number(r.p1_clicks || 0);
          const p1Acos = p1Sales > 0 ? Number(((p1Spend / p1Sales) * 100).toFixed(2)) : 0;
          const p1Cpc = p1Clicks > 0 ? Number((p1Spend / p1Clicks).toFixed(2)) : 0;
          const p1Cvr = p1Clicks > 0 ? Number(((p1Orders / p1Clicks) * 100).toFixed(2)) : 0;

          const p2Spend = Number(r.p2_spend || 0);
          const p2Sales = Number(r.p2_sales || 0);
          const p2Orders = Number(r.p2_orders || 0);
          const p2Clicks = Number(r.p2_clicks || 0);
          const p2Acos = p2Sales > 0 ? Number(((p2Spend / p2Sales) * 100).toFixed(2)) : 0;
          const p2Cpc = p2Clicks > 0 ? Number((p2Spend / p2Clicks).toFixed(2)) : 0;
          const p2Cvr = p2Clicks > 0 ? Number(((p2Orders / p2Clicks) * 100).toFixed(2)) : 0;

          return {
            campaignName: r.campaign_name,
            totalTerms: Number(r.p1_terms || 0),
            spend: p1Spend,
            sales: p1Sales,
            orders: p1Orders,
            clicks: p1Clicks,
            cpc: p1Cpc,
            acos: p1Acos,
            cvr: p1Cvr,
            impressions: Number(r.p1_impressions || 0),
            p1: {
              spend: p1Spend,
              sales: p1Sales,
              orders: p1Orders,
              clicks: p1Clicks,
              impressions: Number(r.p1_impressions || 0),
              terms: Number(r.p1_terms || 0),
              acos: p1Acos,
              cpc: p1Cpc,
              cvr: p1Cvr,
            },
            p2: {
              spend: p2Spend,
              sales: p2Sales,
              orders: p2Orders,
              clicks: p2Clicks,
              impressions: Number(r.p2_impressions || 0),
              terms: Number(r.p2_terms || 0),
              acos: p2Acos,
              cpc: p2Cpc,
              cvr: p2Cvr,
            },
            deltaSpend: Number((p1Spend - p2Spend).toFixed(2)),
            deltaSpendPct: p2Spend > 0 ? Number((((p1Spend - p2Spend) / p2Spend) * 100).toFixed(1)) : 0,
            deltaSales: Number((p1Sales - p2Sales).toFixed(2)),
            deltaSalesPct: p2Sales > 0 ? Number((((p1Sales - p2Sales) / p2Sales) * 100).toFixed(1)) : 0,
            deltaOrders: p1Orders - p2Orders,
            deltaClicks: p1Clicks - p2Clicks,
            deltaAcos: Number((p1Acos - p2Acos).toFixed(1)),
            deltaAcosPp: Number((p1Acos - p2Acos).toFixed(1)),
            deltaCvrPp: Number((p1Cvr - p2Cvr).toFixed(2)),
            deltaCpc: Number((p1Cpc - p2Cpc).toFixed(2)),
            deltaCpcPct: p2Cpc > 0 ? Number((((p1Cpc - p2Cpc) / p2Cpc) * 100).toFixed(1)) : 0,
          };
        }),
        total: totalCompareCampaigns,
        page,
        pageSize,
        totalPages: totalComparePages,
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi tổng hợp chiến dịch từ Search Terms");
  }
}
