import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { objectStorageDriver, putStoredObject, r2KeyPrefix } from "@/lib/object-storage";
import { exportBulksheetUpdateExcel } from "@/lib/ppc/service";
import type { PpcRecommendation } from "@/lib/ppc/types";
import crypto from "node:crypto";

export const runtime = "nodejs";

interface StCandidateInput {
  customerSearchTerm: string;
  campaignName: string;
  adGroupName?: string;
  campaignId?: string;
  adGroupId?: string;
  adType?: string;
  targetKeyword?: string;
  matchType?: string;
  clicks: number;
  orders: number;
  spend: number;
  storeId?: string;
  storeName?: string;
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
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "00";
  return `${value("year")}${value("month")}${value("day")}_${value("hour")}${value("minute")}${value("second")}`;
}

export async function POST(request: Request) {
  try {
    const actor = authorize(request, "write");
    enforceRequestSize(request);

    const body = await request.json().catch(() => ({}));
    const rawItems: StCandidateInput[] = Array.isArray(body?.items) ? body.items : [];
    const requestedStoreName = String(body?.storeName || "").trim();
    const requestedStoreId = String(body?.storeId || "").trim();

    if (rawItems.length === 0) {
      throw new ApiError("Không có Search Term nào được chọn để Auto Upload phủ định.", 400);
    }

    const sql = await getDatabaseClient();

    // 1. Resolve store
    let storeRow: { id: string; name: string } | null = null;
    if (requestedStoreId) {
      const rows = await sql<{ id: string; name: string }[]>`
        SELECT id, name FROM ppc_stores
        WHERE id = ${requestedStoreId} AND team_id = ${actor.teamId}
        LIMIT 1
      `;
      if (rows.length > 0) storeRow = rows[0];
    }

    if (!storeRow && requestedStoreName) {
      const rows = await sql<{ id: string; name: string }[]>`
        SELECT id, name FROM ppc_stores
        WHERE LOWER(name) = LOWER(${requestedStoreName}) AND team_id = ${actor.teamId}
        LIMIT 1
      `;
      if (rows.length > 0) storeRow = rows[0];
    }

    if (!storeRow) {
      const fallbackRows = await sql<{ id: string; name: string }[]>`
        SELECT id, name FROM ppc_stores
        WHERE team_id = ${actor.teamId}
        ORDER BY created_at ASC
        LIMIT 1
      `;
      if (fallbackRows.length > 0) storeRow = fallbackRows[0];
    }

    if (!storeRow) {
      throw new ApiError("Không tìm thấy store hợp lệ để thực hiện Auto Upload.", 400);
    }

    const storeId = storeRow.id;
    const storeName = storeRow.name;

    // 2. Deduplicate by (campaignName, customerSearchTerm)
    const dedupMap = new Map<string, StCandidateInput>();
    for (const item of rawItems) {
      const term = (item.customerSearchTerm || "").trim();
      const camp = (item.campaignName || "").trim();
      if (!term || !camp) continue;
      const key = `${camp.toLowerCase()}|||${term.toLowerCase()}`;
      if (!dedupMap.has(key)) {
        dedupMap.set(key, item);
      }
    }
    const uniqueItems = Array.from(dedupMap.values());

    if (uniqueItems.length === 0) {
      throw new ApiError("Danh sách Search Term không hợp lệ.", 400);
    }

    // 3. Tra cứu Amazon campaign_id và ad_group_id từ ppc_performance_facts nếu thiếu
    const missingCampaignNames = [
      ...new Set(
        uniqueItems
          .filter((it) => !it.campaignId || !it.adGroupId)
          .map((it) => it.campaignName?.trim())
          .filter((name): name is string => Boolean(name)),
      ),
    ];
    const campaignIdLookup = new Map<string, string>();
    const campaignAdTypeLookup = new Map<string, string>();
    const campaignDefaultAgId = new Map<string, string>();
    const adGroupIdLookup = new Map<string, string>();

    if (missingCampaignNames.length > 0) {
      const facts = await sql<Array<{
        campaign_name: string;
        campaign_id: string;
        ad_type: string;
        ad_group_name: string;
        ad_group_id: string;
      }>>`
        SELECT DISTINCT campaign_name, campaign_id, ad_type, ad_group_name, ad_group_id
        FROM ppc_performance_facts
        WHERE store_id = ${storeId}
          AND campaign_name = ANY(${missingCampaignNames})
          AND campaign_id IS NOT NULL
          AND length(campaign_id) > 0
      `;

      for (const f of facts) {
        const campKey = (f.campaign_name || "").trim().toLowerCase();
        if (campKey && f.campaign_id && !campaignIdLookup.has(campKey)) {
          campaignIdLookup.set(campKey, f.campaign_id);
        }
        if (campKey && f.ad_type && !campaignAdTypeLookup.has(campKey)) {
          campaignAdTypeLookup.set(campKey, f.ad_type);
        }
        if (campKey && f.ad_group_id && !campaignDefaultAgId.has(campKey)) {
          campaignDefaultAgId.set(campKey, f.ad_group_id);
        }
        const agKey = `${campKey}|||${(f.ad_group_name || "").trim().toLowerCase()}`;
        if (campKey && f.ad_group_id && !adGroupIdLookup.has(agKey)) {
          adGroupIdLookup.set(agKey, f.ad_group_id);
        }
      }
    }

    // 4. Chuẩn hóa thành PpcRecommendation với recType = NEGATIVE_KEYWORD
    const recommendations: PpcRecommendation[] = uniqueItems.map((it, idx) => {
      const campName = (it.campaignName || "").trim();
      const agName = (it.adGroupName || campName).trim();
      const campKey = campName.toLowerCase();
      const agKey = `${campKey}|||${agName.toLowerCase()}`;

      const resolvedCampId = it.campaignId || campaignIdLookup.get(campKey) || "";
      const resolvedAgId = it.adGroupId || adGroupIdLookup.get(agKey) || campaignDefaultAgId.get(campKey) || "";
      const resolvedAdType = it.adType || campaignAdTypeLookup.get(campKey) || "SP";

      const term = it.customerSearchTerm.trim();
      const isProduct =
        term.toLowerCase().startsWith("b0") ||
        term.toLowerCase().startsWith("asin=") ||
        term.toLowerCase().startsWith("category=");

      return {
        id: `st-auto-neg-${idx}-${Date.now()}`,
        storeId,
        storeName,
        adType: (resolvedAdType as any) || "SP",
        recType: "NEGATIVE_KEYWORD",
        targetType: isProduct ? "PRODUCT" : "EXACT",
        keyword: term,
        campaignName: campName,
        adGroupName: agName,
        campaignId: resolvedCampId,
        adGroupId: resolvedAgId,
        matchType: "Exact",
        priority: "P0",
        reason: `ST Auto Negative: ${it.clicks} clicks, 0 orders, lãng phí $${Number(it.spend || 0).toFixed(2)}. Phủ định Negative Exact chỉ trong source campaign.`,
        estimatedSavings: Number(it.spend || 0),
        status: "PENDING",
        createdAt: new Date().toISOString(),
      };
    });

    // 5. Kiểm tra tính toàn vẹn: Campaign ID bắt buộc để Amazon Ads không báo lỗi Input Error
    const missingCampId = recommendations.filter((r) => !r.campaignId);
    if (missingCampId.length > 0) {
      const campNames = [...new Set(missingCampId.map((r) => r.campaignName))].slice(0, 5).join(", ");
      throw new ApiError(
        `Không thể Auto Upload vì thiếu Campaign ID trên Amazon cho các chiến dịch: ${campNames}. Vui lòng đồng bộ dữ liệu PPC trước.`,
        400,
      );
    }

    // Với Sponsored Brands (SB), Amazon chỉ hỗ trợ phủ định ở cấp Ad Group
    const missingSbAgId = recommendations.filter((r) => r.adType === "SB" && !r.adGroupId);
    if (missingSbAgId.length > 0) {
      const campNames = [...new Set(missingSbAgId.map((r) => r.campaignName))].slice(0, 5).join(", ");
      throw new ApiError(
        `Chiến dịch Sponsored Brands (SB) bắt buộc phải có Ad Group ID để phủ định từ khóa: ${campNames}.`,
        400,
      );
    }

    // 6. Xuất file Excel chuẩn Amazon Bulksheet
    const buffer = await exportBulksheetUpdateExcel(recommendations);

    const cleanStore = storeName
      .replace(/[/\\?%*:|"<>]/g, "_")
      .trim()
      .replace(/\s+/g, "_");
    const fileName = `Upload_${cleanStore}_ST_NegativeExact_${recommendations.length}Terms_${exportTimestamp(new Date())}.xlsx`;

    const jobId = crypto.randomUUID();
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const safeStore = storeName.replace(/[^A-Za-z0-9._-]+/g, "-");
    const r2Key = `${r2KeyPrefix()}/ppc-bulk-upload/${safeStore}/${jobId}/${fileName}`;

    if (objectStorageDriver() !== "r2") {
      throw new Error("Auto Upload remote yêu cầu OBJECT_STORAGE_DRIVER=r2.");
    }

    // 6. Upload file lên Cloudflare R2 để Mac mini worker tải về
    await putStoredObject({
      key: r2Key,
      bytes: buffer,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sha256,
      metadata: { purpose: "amazon-ads-bulk-upload", store: safeStore, job: jobId },
    });

    const distinctCamps = Array.from(new Set(uniqueItems.map((c) => c.campaignName))).slice(0, 50);

    const actionsPayload = recommendations.map((rec) => ({
      id: rec.id,
      sku: "ST_NEGATIVE",
      campaignName: rec.campaignName,
      adGroupName: rec.adGroupName || "",
      targetKeyword: rec.keyword,
      matchType: rec.matchType || "Negative Exact",
      actionType: "NEGATIVE_KEYWORD",
      oldValue: null,
      finalValue: null,
      status: "PENDING",
      reason: rec.reason,
      estimatedSavings: rec.estimatedSavings,
    }));

    // 7. Ghi nhận tác vụ vào ppc_auto_upload_logs ở trạng thái PENDING để Mac mini worker pick up
    await sql`
      INSERT INTO ppc_auto_upload_logs (
        id, team_id, store_id, file_name, action_count, skus, status, stage,
        file_status, progress_pct, action_ids, actions_payload, r2_key, sha256, updated_at
      ) VALUES (
        ${jobId}, ${actor.teamId}, ${storeId}, ${fileName}, ${recommendations.length},
        ${sql.json(distinctCamps)}, 'PENDING', 'FILE_READY',
        'SUCCESS', 25, ${sql.json([])}, ${sql.json(actionsPayload)}, ${r2Key}, ${sha256}, NOW()
      )
    `;

    return Response.json(
      {
        success: true,
        jobId,
        fileName,
        actionCount: recommendations.length,
        storeName,
        message: `Đã tạo file Bulk và xếp hàng upload trên Mac mini (${recommendations.length} search term phủ định Negative Exact).`,
      },
      { status: 202 }
    );
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi xếp hàng Auto Upload ST Optimization.", 500);
  }
}
