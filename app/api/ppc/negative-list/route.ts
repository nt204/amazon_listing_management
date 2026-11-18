// Negative List: user dán 1 list keyword → phủ định (Campaign Negative Keyword) cho toàn bộ campaign của ASIN đã chọn.
// GET  ?storeName=&q=      → gợi ý ASIN/SKU có campaign trong store (kèm SKU, ảnh mockup)
// GET  ?storeName=&asins=  → danh sách campaign đang quảng cáo các ASIN
// POST { storeName, asins, campaignIds, keywords, matchType, mode? } → tạo bulksheet:
//   mode = "export" → trả file về trình duyệt; mặc định → xếp hàng Auto Upload trên Mac mini
import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { invalidateCachePattern } from "@/lib/redis";
import { objectStorageDriver, putStoredObject, r2KeyPrefix } from "@/lib/object-storage";
import { exportBulksheetUpdateExcel } from "@/lib/ppc/service";
import { assertActorPpcStoreActionAccess } from "@/lib/ppc/store-user-access";
import { loadAsinCampaigns, normalizeAsins, searchAsins } from "@/lib/ppc/asin-campaigns";
import type { PpcRecommendation } from "@/lib/ppc/types";
import crypto from "node:crypto";

export const runtime = "nodejs";

const MAX_KEYWORDS = 1000;
const MAX_ASINS = 50;
// 1 ASIN có thể chạy vài trăm campaign → 300 campaign × 150 keyword ≈ 45k dòng
const MAX_ROWS = 50000;
const HEADER_WORDS = new Set(["negative phrase kw", "negative exact kw", "negative kw", "keyword", "keywords"]);

type Sql = Awaited<ReturnType<typeof getDatabaseClient>>;

async function resolveStore(sql: Sql, teamId: string, storeName: string) {
  if (!storeName || storeName === "ALL") {
    throw new ApiError("Vui lòng chọn 1 Store cụ thể trước khi phủ định.", 400);
  }
  const [row] = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM ppc_stores
    WHERE LOWER(name) = LOWER(${storeName}) AND team_id = ${teamId}
    LIMIT 1
  `;
  if (!row) throw new ApiError(`Không tìm thấy Store "${storeName}".`, 404);
  return row;
}

async function registerNegatives(
  sql: Sql,
  p: {
    teamId: string;
    store: { id: string; name: string };
    recommendations: PpcRecommendation[];
    matchType: string;
    state: "pending" | "enabled";
    jobId: string | null;
  },
) {
  try {
    const rows = p.recommendations.map((rec) => ({
      ad_type: rec.adType || "SP",
      campaign_id: rec.campaignId || null,
      campaign_name: rec.campaignName,
      ad_group_id: rec.adGroupId || null,
      ad_group_name: rec.adGroupName || null,
      keyword_text: rec.keyword,
      reason: rec.reason,
    }));
    for (let i = 0; i < rows.length; i += 1000) {
      const chunk = rows.slice(i, i + 1000);
      await sql`
        INSERT INTO ppc_negative_registry (
          team_id, store_id, store_name, ad_type, campaign_id, campaign_name,
          ad_group_id, ad_group_name, keyword_text, match_type, level,
          state, source, source_job_id, clicks, spend, reason, created_at, updated_at
        )
        SELECT ${p.teamId}, ${p.store.id}, ${p.store.name}, x.ad_type, x.campaign_id, x.campaign_name,
               x.ad_group_id, x.ad_group_name, x.keyword_text, ${p.matchType}, 'CAMPAIGN',
               ${p.state}, 'NEGATIVE_LIST', ${p.jobId}, 0, 0, x.reason, NOW(), NOW()
        FROM jsonb_to_recordset(${JSON.stringify(chunk)}::text::jsonb) AS x(
          ad_type text, campaign_id text, campaign_name text, ad_group_id text,
          ad_group_name text, keyword_text text, reason text
        )
        ON CONFLICT (store_id, campaign_name, keyword_text, match_type) DO UPDATE SET
          updated_at = NOW(),
          source = EXCLUDED.source,
          -- Đã bật trên Amazon thì giữ: job mới lỗi sẽ xoá theo source_job_id, không được xoá mất phủ định đang chạy
          state = CASE WHEN ppc_negative_registry.state = 'enabled' THEN 'enabled' ELSE EXCLUDED.state END,
          source_job_id = CASE WHEN ppc_negative_registry.state = 'enabled' THEN ppc_negative_registry.source_job_id ELSE EXCLUDED.source_job_id END,
          reason = EXCLUDED.reason
      `;
    }
    await invalidateCachePattern(`ppc:query:st-opt:${p.teamId}:*`).catch(() => {});
  } catch (registryErr) {
    console.error("Lỗi khi ghi Negative List vào ppc_negative_registry:", registryErr);
  }
}

function normalizeKeywords(input: unknown): string[] {
  const raw = Array.isArray(input) ? input.map(String) : String(input || "").split(/\r?\n/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw) {
    const kw = line.replace(/\s+/g, " ").trim().toLowerCase();
    if (!kw || kw.length > 80 || HEADER_WORDS.has(kw) || seen.has(kw)) continue;
    seen.add(kw);
    out.push(kw);
  }
  return out;
}

function exportTimestamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value || "00";
  return `${value("year")}${value("month")}${value("day")}_${value("hour")}${value("minute")}${value("second")}`;
}

export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "ppc");
    const { searchParams } = new URL(request.url);
    const storeName = (searchParams.get("storeName") || "").trim();
    const query = searchParams.get("q");
    if (query !== null) {
      if (query.length > 60) throw new ApiError("Từ khoá tìm quá dài.", 400);
      const sql = await getDatabaseClient();
      const store = await resolveStore(sql, actor.teamId, storeName);
      const items = await searchAsins(sql, { storeId: store.id, storeName: store.name, query });
      return Response.json({ success: true, items });
    }
    const asins = normalizeAsins(searchParams.get("asins"));
    if (asins.length === 0) throw new ApiError("Nhập ít nhất 1 ASIN hợp lệ (10 ký tự, VD: B0XXXXXXXX).", 400);
    if (asins.length > MAX_ASINS) throw new ApiError(`Tối đa ${MAX_ASINS} ASIN mỗi lần.`, 400);

    const sql = await getDatabaseClient();
    const store = await resolveStore(sql, actor.teamId, storeName);
    const { campaigns, snapshot } = await loadAsinCampaigns(sql, { storeId: store.id, asins });
    const foundAsins = new Set(campaigns.map((c) => c.asin));
    return Response.json({
      success: true,
      storeName: store.name,
      asins,
      missingAsins: asins.filter((a) => !foundAsins.has(a)),
      snapshot,
      campaigns,
    });
  } catch (error) {
    return routeErrorResponse(error, "Không tải được campaign của ASIN.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "write", "ppc");
    enforceRequestSize(request);
    const body = await request.json().catch(() => ({}));

    const asins = normalizeAsins(body?.asins);
    const keywords = normalizeKeywords(body?.keywords);
    const matchType = body?.matchType === "negativeExact" ? "negativeExact" : "negativePhrase";
    const wantedCampaignIds = new Set<string>(Array.isArray(body?.campaignIds) ? body.campaignIds.map(String) : []);

    if (asins.length === 0) throw new ApiError("Chưa chọn ASIN.", 400);
    if (asins.length > MAX_ASINS) throw new ApiError(`Tối đa ${MAX_ASINS} ASIN mỗi lần.`, 400);
    if (keywords.length === 0) throw new ApiError("Danh sách keyword trống.", 400);
    if (keywords.length > MAX_KEYWORDS) throw new ApiError(`Tối đa ${MAX_KEYWORDS} keyword mỗi lần.`, 400);
    if (wantedCampaignIds.size === 0) throw new ApiError("Chưa chọn campaign nào.", 400);

    const sql = await getDatabaseClient();
    const store = await resolveStore(sql, actor.teamId, String(body?.storeName || "").trim());
    await assertActorPpcStoreActionAccess(actor.teamId, actor.userId, store.id);

    // Chỉ nhận campaign thật sự thuộc ASIN (không tin campaignId từ client)
    const { campaigns: asinCampaigns } = await loadAsinCampaigns(sql, { storeId: store.id, asins });
    // SD không có Negative Keyword → bỏ qua
    const campaigns = asinCampaigns.filter((c) => c.campaignId && c.adType !== "SD" && wantedCampaignIds.has(c.campaignId));
    if (campaigns.length === 0) throw new ApiError("Không có campaign hợp lệ của ASIN đã chọn.", 400);

    // Bỏ cặp (campaign, keyword, match type) đã có trong Negative Hub
    const existing = await sql<{ campaign_name: string; keyword_text: string }[]>`
      SELECT campaign_name, keyword_text FROM ppc_negative_registry
      WHERE store_id = ${store.id}
        AND match_type = ${matchType}
        AND campaign_name = ANY(${campaigns.map((c) => c.campaignName)})
        AND lower(trim(keyword_text)) = ANY(${keywords})
    `;
    const existingKeys = new Set(existing.map((r) => `${r.campaign_name}|||${r.keyword_text.trim().toLowerCase()}`));

    const now = new Date().toISOString();
    const amazonMatch = matchType === "negativePhrase" ? "Negative Phrase" : "Negative Exact";
    const recommendations: Array<PpcRecommendation & { level: string; negativeMatchType: string }> = [];
    let skipped = 0;
    for (const c of campaigns) {
      for (const kw of keywords) {
        if (existingKeys.has(`${c.campaignName}|||${kw}`)) {
          skipped++;
          continue;
        }
        recommendations.push({
          id: `neg-list-${recommendations.length}-${Date.now()}`,
          storeId: store.id,
          storeName: store.name,
          adType: (c.adType as PpcRecommendation["adType"]) || "SP",
          recType: "NEGATIVE_KEYWORD",
          targetType: "EXACT",
          keyword: kw,
          campaignName: c.campaignName,
          adGroupName: c.adGroupName,
          campaignId: c.campaignId,
          adGroupId: c.adGroupId,
          matchType: "Exact",
          priority: "P1",
          reason: `Negative List (${amazonMatch}) cho ASIN ${c.asin}.`,
          estimatedSavings: 0,
          status: "PENDING",
          createdAt: now,
          // Campaign Negative Keyword (SP) → chặn keyword trên toàn bộ campaign
          level: "CAMPAIGN",
          negativeMatchType: matchType,
        });
      }
    }

    if (recommendations.length === 0) {
      throw new ApiError(`Tất cả ${skipped} cặp keyword × campaign đã được phủ định trước đó.`, 400);
    }
    if (recommendations.length > MAX_ROWS) {
      throw new ApiError(
        `Quá nhiều dòng (${recommendations.length}). Tối đa ${MAX_ROWS} dòng / lần — hãy chia nhỏ ASIN hoặc keyword.`,
        400,
      );
    }

    const buffer = await exportBulksheetUpdateExcel(recommendations);
    const cleanStore = store.name.replace(/[/\\?%*:|"<>]/g, "_").trim().replace(/\s+/g, "_");
    const tag = matchType === "negativePhrase" ? "NegativePhrase" : "NegativeExact";
    const fileName = `Upload_${cleanStore}_NegList_${tag}_${keywords.length}KW_${campaigns.length}Camp_${exportTimestamp(new Date())}.xlsx`;

    // Xuất file: tải về để tự upload lên Amazon, ghi Negative Hub luôn (giống Xuất File của Đề Xuất Phủ Định ST)
    if (body?.mode === "export") {
      await registerNegatives(sql, { teamId: actor.teamId, store, recommendations, matchType, state: "enabled", jobId: null });
      const asciiFileName = fileName.replace(/[^A-Za-z0-9 ._+()-]+/g, "").trim() || "Negative_List.xlsx";
      return new Response(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
          "Cache-Control": "no-store",
          "X-Action-Count": String(recommendations.length),
          "X-Skipped-Count": String(skipped),
        },
      });
    }

    if (objectStorageDriver() !== "r2") {
      throw new Error("Auto Upload remote yêu cầu OBJECT_STORAGE_DRIVER=r2.");
    }
    const jobId = crypto.randomUUID();
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const safeStore = store.name.replace(/[^A-Za-z0-9._-]+/g, "-");
    const r2Key = `${r2KeyPrefix()}/ppc-bulk-upload/${safeStore}/${jobId}/${fileName}`;

    await putStoredObject({
      key: r2Key,
      bytes: buffer,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sha256,
      metadata: { purpose: "amazon-ads-bulk-upload", store: safeStore, job: jobId },
    });

    const actionsPayload = recommendations.map((rec) => ({
      id: rec.id,
      sku: "NEGATIVE_LIST",
      campaignName: rec.campaignName,
      adGroupName: rec.adGroupName || "",
      targetKeyword: rec.keyword,
      matchType: amazonMatch,
      actionType: "NEGATIVE_KEYWORD",
      oldValue: null,
      finalValue: null,
      status: "PENDING",
    }));

    await sql`
      INSERT INTO ppc_auto_upload_logs (
        id, team_id, store_id, file_name, action_count, skus, status, stage,
        file_status, progress_pct, action_ids, actions_payload, r2_key, sha256, updated_at, created_by
      ) VALUES (
        ${jobId}, ${actor.teamId}, ${store.id}, ${fileName}, ${recommendations.length},
        ${sql.json(asins)}, 'PENDING', 'FILE_READY',
        'SUCCESS', 25, ${sql.json([])}, ${sql.json(actionsPayload)}, ${r2Key}, ${sha256}, NOW(), ${actor.userId}
      )
    `;

    // Ghi Negative Hub (pending → worker chuyển enabled khi upload xong, xoá nếu lỗi)
    await registerNegatives(sql, { teamId: actor.teamId, store, recommendations, matchType, state: "pending", jobId });

    return Response.json(
      {
        success: true,
        jobId,
        fileName,
        actionCount: recommendations.length,
        skipped,
        keywordCount: keywords.length,
        campaignCount: campaigns.length,
        storeName: store.name,
        message: `Đã tạo file Bulk và xếp hàng upload trên Mac mini (${keywords.length} keyword × ${campaigns.length} campaign = ${recommendations.length} dòng ${amazonMatch}).`,
      },
      { status: 202 },
    );
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi xếp hàng Negative List.", 500);
  }
}
