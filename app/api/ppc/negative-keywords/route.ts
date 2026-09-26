// app/api/ppc/negative-keywords/route.ts
import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const actor = authorize(request, "read");
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("storeId")?.trim() || "";
    const storeName = searchParams.get("storeName")?.trim() || "";
    const adType = searchParams.get("adType")?.trim().toUpperCase() || "";
    const search = searchParams.get("search")?.trim().toLowerCase() || "";

    const sql = await getDatabaseClient();

    // Query negative keywords
    const rows = await sql<Array<{
      id: string;
      store_id: string;
      store_name: string;
      ad_type: string;
      campaign_id: string | null;
      campaign_name: string;
      ad_group_id: string | null;
      ad_group_name: string | null;
      keyword_text: string;
      match_type: string;
      level: string;
      state: string;
      source: string;
      source_job_id: string | null;
      clicks: number;
      spend: number;
      reason: string | null;
      created_at: string;
      updated_at: string;
    }>>`
      SELECT 
        nr.id, nr.store_id, COALESCE(s.name, nr.store_name) as store_name,
        nr.ad_type, nr.campaign_id, nr.campaign_name,
        nr.ad_group_id, nr.ad_group_name, nr.keyword_text,
        nr.match_type, nr.level, nr.state, nr.source,
        nr.source_job_id, nr.clicks, nr.spend, nr.reason,
        nr.created_at, nr.updated_at
      FROM ppc_negative_registry nr
      LEFT JOIN ppc_stores s ON s.id = nr.store_id
      WHERE nr.team_id = ${actor.teamId}
        ${storeId && storeId !== "ALL" ? sql`AND nr.store_id = ${storeId}` : sql``}
        ${!storeId && storeName && storeName !== "ALL" ? sql`AND LOWER(s.name) = LOWER(${storeName})` : sql``}
        ${adType && adType !== "ALL" ? sql`AND nr.ad_type = ${adType}` : sql``}
        ${search ? sql`AND (LOWER(nr.keyword_text) LIKE ${"%" + search + "%"} OR LOWER(nr.campaign_name) LIKE ${"%" + search + "%"})` : sql``}
      ORDER BY nr.created_at DESC
      LIMIT 2000
    `;

    // Fast lookup keys: `${campaign_name.toLowerCase()}|||${keyword_text.toLowerCase()}`
    const lookupKeys = rows.map((r) => `${(r.campaign_name || "").trim().toLowerCase()}|||${(r.keyword_text || "").trim().toLowerCase()}`);

    const totalNegatives = rows.length;
    const totalCampaigns = new Set(rows.map((r) => r.campaign_name)).size;
    const totalSpendPrevented = rows.reduce((sum, r) => sum + Number(r.spend || 0), 0);

    return Response.json({
      success: true,
      data: {
        items: rows,
        lookupKeys,
        summary: {
          totalNegatives,
          totalCampaigns,
          totalSpendPrevented: Math.round(totalSpendPrevented * 100) / 100,
        },
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy danh sách Negative Keywords.", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = authorize(request, "write");
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id")?.trim() || "";

    if (!id) {
      throw new ApiError("Vui lòng cung cấp ID của từ khóa cần xóa.", 400);
    }

    const sql = await getDatabaseClient();
    const result = await sql`
      DELETE FROM ppc_negative_registry
      WHERE id = ${id} AND team_id = ${actor.teamId}
      RETURNING id
    `;

    if (result.length === 0) {
      throw new ApiError("Không tìm thấy từ khóa hoặc không có quyền thao tác.", 404);
    }

    return Response.json({ success: true, message: "Đã xóa từ khóa khỏi danh sách Negative Hub." });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi xóa từ khóa Negative.", 500);
  }
}
