import { ApiError, authorize, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { assertActorPpcStoreActionAccess } from "@/lib/ppc/store-user-access";
import { ppcChannelWhere, resolvePpcChannelScope, type PpcChannelScope } from "@/lib/ppc/channel-filter";
import { getActiveCampaignNames, parseCampaignStatus, ppcActiveCampaignWhere, type PpcCampaignStatusFilter } from "@/lib/ppc/campaign-status-filter";

type Db = Awaited<ReturnType<typeof getDatabaseClient>>;

/** ACTIVE: negative đang bật VÀ campaign của nó đang chạy. ALL (không gửi tham số): như cũ. */
function activeNegativeWhere(
  sql: Db,
  status: PpcCampaignStatusFilter,
  storeId?: string | null,
  activeCampaignNames?: string[] | null,
) {
  if (status !== "ACTIVE") return sql``;
  return sql`AND lower(COALESCE(nr.state, '')) = 'enabled'
    AND ${ppcActiveCampaignWhere(sql, status, { storeIdCol: "nr.store_id", campaignCol: "nr.campaign_name", storeId, activeCampaignNames })}`;
}

export const runtime = "nodejs";

/** Khoá lô: dòng có job (Auto Upload / lô Xuất File) gom theo job; dòng cũ không có job gom theo nguồn + phút tạo. */
function batchKeyExpr(sql: Db) {
  return sql`(CASE WHEN nr.source_job_id IS NOT NULL THEN 'job:' || nr.source_job_id
    ELSE 'legacy:' || nr.source || ':' || to_char(date_trunc('minute', nr.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI') END)`;
}

/** Negative Hub chỉ gồm phủ định đã lên Amazon. 'pending' (đang Auto Upload) và 'exported' (mới xuất file) ở tab Negative List. */
const HUB_STATE = "enabled";

async function resolveStoreId(sql: Db, teamId: string, storeId: string, storeName: string): Promise<string | null> {
  if (storeId && storeId !== "ALL") return storeId;
  if (storeName && storeName !== "ALL") {
    const [row] = await sql<{ id: string }[]>`SELECT id FROM ppc_stores WHERE team_id = ${teamId} AND lower(name) = lower(${storeName}) LIMIT 1`;
    return row?.id || "00000000-0000-0000-0000-000000000000";
  }
  return null;
}

function channelWhere(sql: Db, scope: PpcChannelScope | null) {
  return ppcChannelWhere(sql, scope, { campaignCol: "nr.campaign_name" });
}

async function hubSummary(sql: Db, teamId: string, storeId: string | null, scope: PpcChannelScope | null = null) {
  const [row] = await sql<{ total: number; campaigns: number; spend: number; batches: number }[]>`
    SELECT count(*)::int AS total,
           count(DISTINCT nr.campaign_name)::int AS campaigns,
           COALESCE(sum(nr.spend), 0)::float AS spend,
           count(DISTINCT ${batchKeyExpr(sql)})::int AS batches
    FROM ppc_negative_registry nr
    WHERE nr.team_id = ${teamId} AND nr.state = ${HUB_STATE}
      ${storeId ? sql`AND nr.store_id = ${storeId}` : sql``}
      AND ${channelWhere(sql, scope)}
  `;
  return {
    totalNegatives: Number(row?.total || 0),
    totalCampaigns: Number(row?.campaigns || 0),
    totalSpendPrevented: Math.round(Number(row?.spend || 0) * 100) / 100,
    totalBatches: Number(row?.batches || 0),
  };
}

async function listBatches(
  sql: Db,
  p: { teamId: string; storeId: string | null; adType: string; search: string; scope: PpcChannelScope | null },
) {
  const like = p.search ? `%${p.search}%` : "";
  const rows = await sql<Array<{
    batch_key: string;
    job_id: string | null;
    store_name: string;
    source: string;
    match_types: string[];
    ad_types: string[];
    levels: string[];
    row_count: number;
    keyword_count: number;
    campaign_count: number;
    spend: number;
    keywords: string[];
    created_at: string;
    updated_at: string;
    file_name: string | null;
    created_by: string | null;
    confirmed_at: string | null;
    confirmed_by: string | null;
  }>>`
    WITH g AS (
      SELECT ${batchKeyExpr(sql)} AS batch_key,
             min(nr.source_job_id) AS job_id,
             min(COALESCE(s.name, nr.store_name)) AS store_name,
             min(nr.source) AS source,
             array_agg(DISTINCT nr.match_type) AS match_types,
             array_agg(DISTINCT nr.ad_type) AS ad_types,
             array_agg(DISTINCT nr.level) AS levels,
             count(*)::int AS row_count,
             count(DISTINCT lower(nr.keyword_text))::int AS keyword_count,
             count(DISTINCT nr.campaign_name)::int AS campaign_count,
             COALESCE(sum(nr.spend), 0)::float AS spend,
             (array_agg(DISTINCT lower(nr.keyword_text)))[1:60] AS keywords,
             min(nr.created_at) AS created_at,
             max(nr.updated_at) AS updated_at
      FROM ppc_negative_registry nr
      LEFT JOIN ppc_stores s ON s.id = nr.store_id
      WHERE nr.team_id = ${p.teamId} AND nr.state = ${HUB_STATE}
        ${p.storeId ? sql`AND nr.store_id = ${p.storeId}` : sql``}
        ${p.adType && p.adType !== "ALL" ? sql`AND nr.ad_type = ${p.adType}` : sql``}
        AND ${channelWhere(sql, p.scope)}
      GROUP BY 1
      ${like ? sql`HAVING bool_or(lower(nr.keyword_text) LIKE ${like} OR lower(nr.campaign_name) LIKE ${like})` : sql``}
    )
    SELECT g.*,
           COALESCE(b.file_name, l.file_name) AS file_name,
           COALESCE(u.display_name, b.created_by, l.created_by) AS created_by,
           b.confirmed_at,
           COALESCE(cu.display_name, b.confirmed_by) AS confirmed_by
    FROM g
    LEFT JOIN ppc_negative_batches b ON b.id = g.job_id
    LEFT JOIN ppc_auto_upload_logs l ON b.id IS NULL AND l.id::text = g.job_id
    LEFT JOIN app_users u ON u.team_id = ${p.teamId} AND u.user_id = COALESCE(b.created_by, l.created_by)
    LEFT JOIN app_users cu ON cu.team_id = ${p.teamId} AND cu.user_id = b.confirmed_by
    ORDER BY g.created_at DESC
    LIMIT 500
  `;
  return rows.map((r) => ({
    batchKey: r.batch_key,
    jobId: r.job_id,
    storeName: r.store_name,
    source: r.source,
    // Lô Xuất File đã tick "Đã upload" → hiện là Xuất File thay vì Auto Upload
    method: r.confirmed_at ? "EXPORT_CONFIRMED" : r.source === "MANUAL_EXPORT" ? "EXPORT" : r.job_id ? "AUTO_UPLOAD" : "OTHER",
    matchTypes: r.match_types || [],
    adTypes: r.ad_types || [],
    levels: r.levels || [],
    rowCount: Number(r.row_count),
    keywordCount: Number(r.keyword_count),
    campaignCount: Number(r.campaign_count),
    spend: Number(r.spend || 0),
    keywords: r.keywords || [],
    createdAt: r.created_at,
    fileName: r.file_name,
    createdBy: r.created_by,
    confirmedAt: r.confirmed_at,
    confirmedBy: r.confirmed_by,
  }));
}

async function batchDetail(sql: Db, p: { teamId: string; storeId: string | null; batchKey: string; scope: PpcChannelScope | null }) {
  const rows = await sql<Array<{ keyword_text: string; campaign_name: string; ad_group_name: string | null; match_type: string; ad_type: string; clicks: number; spend: number }>>`
    SELECT lower(nr.keyword_text) AS keyword_text, nr.campaign_name, nr.ad_group_name, nr.match_type, nr.ad_type, nr.clicks, nr.spend
    FROM ppc_negative_registry nr
    WHERE nr.team_id = ${p.teamId} AND nr.state = ${HUB_STATE}
      ${p.storeId ? sql`AND nr.store_id = ${p.storeId}` : sql``}
      AND ${batchKeyExpr(sql)} = ${p.batchKey}
      AND ${channelWhere(sql, p.scope)}
    LIMIT 100000
  `;
  const kwMap = new Map<string, { keyword: string; campaigns: number; clicks: number; spend: number }>();
  const campMap = new Map<string, { campaignName: string; adGroupName: string | null; adType: string; keywords: number }>();
  for (const r of rows) {
    const k = kwMap.get(r.keyword_text) || { keyword: r.keyword_text, campaigns: 0, clicks: 0, spend: 0 };
    k.campaigns += 1;
    k.clicks += Number(r.clicks || 0);
    k.spend += Number(r.spend || 0);
    kwMap.set(r.keyword_text, k);
    const c = campMap.get(r.campaign_name) || { campaignName: r.campaign_name, adGroupName: r.ad_group_name, adType: r.ad_type, keywords: 0 };
    c.keywords += 1;
    campMap.set(r.campaign_name, c);
  }
  return {
    keywords: Array.from(kwMap.values()).sort((a, b) => b.spend - a.spend || a.keyword.localeCompare(b.keyword)),
    campaigns: Array.from(campMap.values()).sort((a, b) => a.campaignName.localeCompare(b.campaignName)),
  };
}

export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "ppc");
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("storeId")?.trim() || "";
    const storeName = searchParams.get("storeName")?.trim() || "";
    const adType = searchParams.get("adType")?.trim().toUpperCase() || "";
    const search = searchParams.get("search")?.trim().toLowerCase() || "";
    const campaignStatus = parseCampaignStatus(searchParams.get("campaignStatus"));

    const sql = await getDatabaseClient();

    const view = searchParams.get("view") || "";
    if (view === "batches" || view === "batch") {
      const hubStoreId = await resolveStoreId(sql, actor.teamId, storeId, storeName);
      // Store chia kênh (FASTPEACE · FBA / FBM) → chỉ lấy campaign thuộc kênh đang chọn
      const scope = await resolvePpcChannelScope(sql, storeName, searchParams.get("channel"));
      if (view === "batch") {
        const batchKey = searchParams.get("batchKey")?.trim() || "";
        if (!batchKey) throw new ApiError("Thiếu mã lô.", 400);
        const detail = await batchDetail(sql, { teamId: actor.teamId, storeId: hubStoreId, batchKey, scope });
        return Response.json({ success: true, data: detail });
      }
      const [batches, summary] = await Promise.all([
        listBatches(sql, { teamId: actor.teamId, storeId: hubStoreId, adType, search, scope }),
        hubSummary(sql, actor.teamId, hubStoreId, scope),
      ]);
      return Response.json({ success: true, data: { batches, summary } });
    }

    let resolvedStoreId: string | null = storeId && storeId !== "ALL" ? storeId : null;
    if (!resolvedStoreId && storeName && storeName !== "ALL") {
      const sRow = await sql<{ id: string }[]>`SELECT id FROM ppc_stores WHERE team_id = ${actor.teamId} AND lower(name) = lower(${storeName}) LIMIT 1`;
      if (sRow[0]) resolvedStoreId = sRow[0].id;
    }

    const activeCampaigns = campaignStatus === "ACTIVE"
      ? await getActiveCampaignNames(sql, resolvedStoreId)
      : null;

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
        -- 'exported' = file mới tải về, chưa chắc đã lên Amazon → chưa tính là đã phủ định
        AND nr.state IN ('enabled', 'pending')
        ${storeId && storeId !== "ALL" ? sql`AND nr.store_id = ${storeId}` : sql``}
        ${!storeId && storeName && storeName !== "ALL" ? sql`AND LOWER(s.name) = LOWER(${storeName})` : sql``}
        ${adType && adType !== "ALL" ? sql`AND nr.ad_type = ${adType}` : sql``}
        ${search ? sql`AND (LOWER(nr.keyword_text) LIKE ${"%" + search + "%"} OR LOWER(nr.campaign_name) LIKE ${"%" + search + "%"})` : sql``}
        ${activeNegativeWhere(sql, campaignStatus, resolvedStoreId, activeCampaigns)}
      ORDER BY nr.created_at DESC
      LIMIT 2000
    `;

    // Fast lookup keys: `${campaign_name.toLowerCase()}|||${keyword_text.toLowerCase()}` và kw
    const lookupKeysSet = new Set<string>();
    for (const r of rows) {
      const kw = (r.keyword_text || "").trim().toLowerCase();
      if (!kw) continue;
      lookupKeysSet.add(kw);
      if (r.campaign_name) {
        lookupKeysSet.add(`${r.campaign_name.trim().toLowerCase()}|||${kw}`);
      }
    }
    const lookupKeys = Array.from(lookupKeysSet);

    // items chỉ lấy 2000 dòng mới nhất (tra nhanh phía client); số tổng đếm thật trên toàn bộ Negative Hub
    const summary = await hubSummary(
      sql,
      actor.teamId,
      await resolveStoreId(sql, actor.teamId, storeId, storeName),
      await resolvePpcChannelScope(sql, storeName, searchParams.get("channel")),
    );

    return Response.json({
      success: true,
      data: {
        items: rows,
        lookupKeys,
        summary,
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy danh sách Negative Keywords.", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await authorize(request, "write", "ppc");
    const { searchParams } = new URL(request.url);

    // Support single id or ids from query or body
    let ids: string[] = [];
    let isAllFiltered = false;
    let filters: { storeId?: string; storeName?: string; adType?: string; search?: string; campaignStatus?: string } = {};
    let excludedIds: string[] = [];

    const queryId = searchParams.get("id")?.trim();
    const queryIds = searchParams.get("ids")?.trim();
    const batchKey = searchParams.get("batchKey")?.trim();

    // Xoá cả 1 lô khỏi Negative Hub (chỉ xoá bản ghi lưu vết, không gỡ phủ định trên Amazon)
    if (batchKey) {
      const sql = await getDatabaseClient();
      const delStoreName = searchParams.get("storeName")?.trim() || "";
      const hubStoreId = await resolveStoreId(sql, actor.teamId, "", delStoreName);
      if (!hubStoreId) throw new ApiError("Vui lòng chọn 1 Store cụ thể.", 400);
      await assertActorPpcStoreActionAccess(actor.teamId, actor.userId, hubStoreId);
      const delScope = await resolvePpcChannelScope(sql, delStoreName, searchParams.get("channel"));
      const result = await sql`
        DELETE FROM ppc_negative_registry nr
        WHERE nr.team_id = ${actor.teamId} AND nr.store_id = ${hubStoreId} AND nr.state = ${HUB_STATE}
          AND ${batchKeyExpr(sql)} = ${batchKey}
          AND ${channelWhere(sql, delScope)}
        RETURNING nr.id
      `;
      return Response.json({
        success: true,
        message: `Đã xoá lô (${result.length.toLocaleString("en-US")} dòng) khỏi Negative Hub.`,
        deletedCount: result.length,
      });
    }

    if (queryIds) {
      ids = queryIds.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (queryId) {
      ids = [queryId];
    } else {
      const body = await request.json().catch(() => null);
      if (body?.mode === "ALL_FILTERED") {
        isAllFiltered = true;
        filters = body.filters || {};
        if (Array.isArray(body.excludedIds)) {
          excludedIds = body.excludedIds.map((s: unknown) => String(s).trim()).filter(Boolean);
        }
      } else if (body?.selectedIds && Array.isArray(body.selectedIds)) {
        ids = body.selectedIds.map((s: unknown) => String(s).trim()).filter(Boolean);
      } else if (body?.ids && Array.isArray(body.ids)) {
        ids = body.ids.map((s: unknown) => String(s).trim()).filter(Boolean);
      } else if (body?.id) {
        ids = [String(body.id).trim()];
      }
    }

    const sql = await getDatabaseClient();

    if (isAllFiltered) {
      const storeId = filters.storeId?.trim() || "";
      const storeName = filters.storeName?.trim() || "";
      const adType = filters.adType?.trim().toUpperCase() || "";
      const search = filters.search?.trim().toLowerCase() || "";
      const campaignStatus = parseCampaignStatus(filters.campaignStatus);

      if (storeId && storeId !== "ALL") {
        await assertActorPpcStoreActionAccess(actor.teamId, actor.userId, storeId);
      } else if (storeName && storeName !== "ALL") {
        await assertActorPpcStoreActionAccess(actor.teamId, actor.userId, storeName);
      }

      const result = await sql`
        DELETE FROM ppc_negative_registry
        WHERE id IN (
          SELECT nr.id
          FROM ppc_negative_registry nr
          LEFT JOIN ppc_stores s ON s.id = nr.store_id
          WHERE nr.team_id = ${actor.teamId}
            ${storeId && storeId !== "ALL" ? sql`AND nr.store_id = ${storeId}` : sql``}
            ${!storeId && storeName && storeName !== "ALL" ? sql`AND LOWER(s.name) = LOWER(${storeName})` : sql``}
            ${adType && adType !== "ALL" ? sql`AND nr.ad_type = ${adType}` : sql``}
            ${search ? sql`AND (LOWER(nr.keyword_text) LIKE ${"%" + search + "%"} OR LOWER(nr.campaign_name) LIKE ${"%" + search + "%"})` : sql``}
            ${activeNegativeWhere(sql, campaignStatus, storeId || null)}
            ${excludedIds.length > 0 ? sql`AND nr.id != ALL(${excludedIds}::uuid[])` : sql``}
        ) AND team_id = ${actor.teamId}
        RETURNING id
      `;

      return Response.json({
        success: true,
        message: `Đã xóa ${result.length} từ khóa phù hợp bộ lọc khỏi Negative Hub.`,
        deletedCount: result.length,
      });
    }

    if (ids.length === 0) {
      throw new ApiError("Vui lòng cung cấp ít nhất một ID cần xóa.", 400);
    }

    const storeRows = await sql<{ store_id: string }[]>`
      SELECT DISTINCT store_id FROM ppc_negative_registry
      WHERE id = ANY(${ids}::uuid[]) AND team_id = ${actor.teamId}
    `;
    for (const row of storeRows) {
      if (row.store_id) {
        await assertActorPpcStoreActionAccess(actor.teamId, actor.userId, row.store_id);
      }
    }

    const result = await sql`
      DELETE FROM ppc_negative_registry
      WHERE id = ANY(${ids}::uuid[]) AND team_id = ${actor.teamId}
      RETURNING id
    `;

    return Response.json({
      success: true,
      message: `Đã xóa ${result.length} từ khóa khỏi danh sách Negative Hub.`,
      deletedCount: result.length,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi xóa từ khóa Negative.", 500);
  }
}
