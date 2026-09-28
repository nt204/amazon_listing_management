import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const actor = authorize(request, "read");
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("storeId")?.trim() || "";
    const storeName = searchParams.get("storeName")?.trim() || "";
    const search = searchParams.get("search")?.trim().toLowerCase() || "";

    const sql = await getDatabaseClient();

    const rows = await sql<Array<{
      id: string;
      store_id: string;
      store_name: string;
      source_campaign_id: string | null;
      source_campaign_name: string;
      target_campaign_name: string;
      ad_group_name: string;
      keyword_text: string;
      match_type: string;
      target_type: string;
      sku: string | null;
      bid: number;
      daily_budget: number;
      orders: number;
      sales: number;
      clicks: number;
      spend: number;
      cpc: number;
      state: string;
      source: string;
      source_job_id: string | null;
      created_at: string;
      updated_at: string;
    }>>`
      SELECT 
        r.id, r.store_id, COALESCE(s.name, r.store_name) as store_name,
        r.source_campaign_id, r.source_campaign_name,
        r.target_campaign_name, r.ad_group_name,
        r.keyword_text, r.match_type, r.target_type, r.sku,
        r.bid, r.daily_budget, r.orders, r.sales, r.clicks, r.spend, r.cpc,
        r.state, r.source, r.source_job_id,
        r.created_at, r.updated_at
      FROM ppc_sale_kw_registry r
      LEFT JOIN ppc_stores s ON s.id = r.store_id
      WHERE r.team_id = ${actor.teamId}
        ${storeId && storeId !== "ALL" ? sql`AND r.store_id = ${storeId}` : sql``}
        ${!storeId && storeName && storeName !== "ALL" ? sql`AND LOWER(s.name) = LOWER(${storeName})` : sql``}
        ${search ? sql`AND (
          LOWER(r.keyword_text) LIKE ${"%" + search + "%"} OR 
          LOWER(r.source_campaign_name) LIKE ${"%" + search + "%"} OR
          LOWER(r.target_campaign_name) LIKE ${"%" + search + "%"} OR
          LOWER(COALESCE(r.sku, '')) LIKE ${"%" + search + "%"}
        )` : sql``}
      ORDER BY r.created_at DESC
      LIMIT 2000
    `;

    // Fast lookup keys:
    // 1) kw (keyword alone)
    // 2) `${sku.toLowerCase()}|||${kw}`
    // 3) `${source_campaign_name.toLowerCase()}|||${kw}`
    // 4) `${target_campaign_name.toLowerCase()}|||${kw}`
    const lookupKeys = new Set<string>();
    for (const r of rows) {
      const kw = (r.keyword_text || "").trim().toLowerCase();
      if (!kw) continue;
      lookupKeys.add(kw);
      if (r.sku) {
        lookupKeys.add(`${r.sku.trim().toLowerCase()}|||${kw}`);
      }
      if (r.source_campaign_name) {
        lookupKeys.add(`${r.source_campaign_name.trim().toLowerCase()}|||${kw}`);
      }
      if (r.target_campaign_name) {
        lookupKeys.add(`${r.target_campaign_name.trim().toLowerCase()}|||${kw}`);
      }
    }

    // Tính summary trên toàn bộ Registry, không phụ thuộc LIMIT của danh sách hiển thị.
    const totals = await sql<Array<{
      total_keywords: number;
      total_campaigns: number;
      total_orders: number;
      total_sales: number;
      total_spend: number;
    }>>`
      SELECT
        COUNT(*)::int AS total_keywords,
        COUNT(DISTINCT r.target_campaign_name)::int AS total_campaigns,
        COALESCE(SUM(r.orders), 0)::float8 AS total_orders,
        COALESCE(SUM(r.sales), 0)::float8 AS total_sales,
        COALESCE(SUM(r.spend), 0)::float8 AS total_spend
      FROM ppc_sale_kw_registry r
      LEFT JOIN ppc_stores s ON s.id = r.store_id
      WHERE r.team_id = ${actor.teamId}
        ${storeId && storeId !== "ALL" ? sql`AND r.store_id = ${storeId}` : sql``}
        ${!storeId && storeName && storeName !== "ALL" ? sql`AND LOWER(s.name) = LOWER(${storeName})` : sql``}
        ${search ? sql`AND (
          LOWER(r.keyword_text) LIKE ${"%" + search + "%"} OR
          LOWER(r.source_campaign_name) LIKE ${"%" + search + "%"} OR
          LOWER(r.target_campaign_name) LIKE ${"%" + search + "%"} OR
          LOWER(COALESCE(r.sku, '')) LIKE ${"%" + search + "%"}
        )` : sql``}
    `;
    const totalKeywords = Number(totals[0]?.total_keywords || 0);
    const totalCampaigns = Number(totals[0]?.total_campaigns || 0);
    const totalOrders = Number(totals[0]?.total_orders || 0);
    const totalSales = Number(totals[0]?.total_sales || 0);
    const totalSpend = Number(totals[0]?.total_spend || 0);

    return Response.json({
      success: true,
      data: {
        items: rows,
        lookupKeys: Array.from(lookupKeys),
        summary: {
          totalCampaigns,
          totalKeywords,
          totalOrders,
          totalSales: Math.round(totalSales * 100) / 100,
          totalSpend: Math.round(totalSpend * 100) / 100,
        },
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy danh sách Sale KW Registry.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = authorize(request, "read");
    enforceRequestSize(request, 5_000_000);
    const body = await request.json().catch(() => ({}));
    const storeId = String(body?.storeId || "").trim();
    const storeName = String(body?.storeName || "").trim();
    const rawCandidates = Array.isArray(body?.candidates) ? body.candidates : [];

    if (rawCandidates.length > 20_000) {
      throw new ApiError("Danh sách kiểm tra Sale KW vượt quá 20.000 từ khóa.", 400);
    }

    const candidates: Array<{ sku: string; keyword: string }> = rawCandidates
      .map((candidate: unknown) => {
        const item = candidate && typeof candidate === "object"
          ? candidate as { sku?: unknown; keyword?: unknown }
          : {};
        return {
          sku: String(item.sku || "").trim().toLowerCase().slice(0, 200),
          keyword: String(item.keyword || "").trim().toLowerCase().slice(0, 500),
        };
      })
      .filter((candidate: { sku: string; keyword: string }) => Boolean(candidate.keyword));

    if (candidates.length === 0) {
      return Response.json({ success: true, lookupKeys: [] });
    }

    const keywords: string[] = Array.from(new Set(candidates.map((candidate) => candidate.keyword)));
    const sql = await getDatabaseClient();
    const matches = await sql<Array<{ sku: string; keyword_text: string }>>`
      SELECT DISTINCT
        LOWER(TRIM(COALESCE(r.sku, ''))) AS sku,
        LOWER(TRIM(r.keyword_text)) AS keyword_text
      FROM ppc_sale_kw_registry r
      LEFT JOIN ppc_stores s ON s.id = r.store_id
      WHERE r.team_id = ${actor.teamId}
        ${storeId && storeId !== "ALL" ? sql`AND r.store_id = ${storeId}` : sql``}
        ${!storeId && storeName && storeName !== "ALL" ? sql`AND LOWER(s.name) = LOWER(${storeName})` : sql``}
        AND LOWER(TRIM(r.keyword_text)) = ANY(${keywords})
    `;

    const lookupKeys = new Set<string>();
    for (const match of matches) {
      const keyword = String(match.keyword_text || "").trim().toLowerCase();
      const sku = String(match.sku || "").trim().toLowerCase();
      if (!keyword) continue;
      // Ưu tiên khóa SKU + keyword để một từ khóa đã chạy cho SKU A
      // không vô tình chặn SKU B. Chỉ fallback theo keyword với dữ liệu cũ thiếu SKU.
      if (sku) lookupKeys.add(`${sku}|||${keyword}`);
      else lookupKeys.add(keyword);
    }

    return Response.json({ success: true, lookupKeys: Array.from(lookupKeys) });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi kiểm tra từ khóa Sale KW đã tạo.", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = authorize(request, "write");
    const { searchParams } = new URL(request.url);

    let ids: string[] = [];
    const queryId = searchParams.get("id")?.trim();
    const queryIds = searchParams.get("ids")?.trim();

    if (queryIds) {
      ids = queryIds.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (queryId) {
      ids = [queryId];
    } else {
      const body = await request.json().catch(() => null);
      if (body?.ids && Array.isArray(body.ids)) {
        ids = body.ids.map((s: any) => String(s).trim()).filter(Boolean);
      } else if (body?.id) {
        ids = [String(body.id).trim()];
      }
    }

    if (ids.length === 0) {
      throw new ApiError("Vui lòng cung cấp ID để xóa khỏi Sale KW Registry.", 400);
    }

    const sql = await getDatabaseClient();
    const deleted = await sql`
      DELETE FROM ppc_sale_kw_registry
      WHERE id = ANY(${ids}) AND team_id = ${actor.teamId}
      RETURNING id
    `;

    return Response.json({
      success: true,
      deletedCount: deleted.length,
      message: `Đã xóa ${deleted.length} từ khóa khỏi Sale KW Registry.`,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi xóa khỏi Sale KW Registry.", 500);
  }
}
