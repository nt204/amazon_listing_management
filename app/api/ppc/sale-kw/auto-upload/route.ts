import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { objectStorageDriver, putStoredObject, r2KeyPrefix } from "@/lib/object-storage";
import { exportSaleKwBulksheetExcel, type SaleKwCampaignPayload } from "@/lib/ppc/service";
import {
  isAsinProductTarget,
  formatDDMMYY,
  generateSaleKwCampaignTriad,
  resolveSkuForSearchTerm,
} from "@/lib/ppc/sku-extractor";
import crypto from "node:crypto";

export const runtime = "nodejs";

export interface SaleKwItemInput {
  customerSearchTerm: string;
  campaignName?: string;
  adGroupName?: string;
  campaignId?: string;
  adGroupId?: string;
  targetKeyword?: string;
  matchType?: string;
  clicks: number;
  orders: number;
  spend: number;
  sales: number;
  cpc?: number;
  sku?: string;
  bid?: number;
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
    const rawItems: SaleKwItemInput[] = Array.isArray(body?.items) ? body.items : [];
    const directCampaigns = Array.isArray(body?.campaigns) ? body.campaigns : null;
    const requestedStoreName = String(body?.storeName || "").trim();
    const requestedStoreId = String(body?.storeId || "").trim();
    const defaultDailyBudget = Number(body?.dailyBudget) || 5.0;
    const defaultBidVal = Number(body?.defaultBid) || 1.0;
    const globalNegateInSource = Boolean(body?.negateInSource);

    if (rawItems.length === 0 && (!directCampaigns || directCampaigns.length === 0)) {
      throw new ApiError("Không có Search Term nào được chọn để Auto Upload lên Camp Sale KW.", 400);
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

    // 2. Chuẩn bị payload danh sách campaigns
    let campaignsPayload: SaleKwCampaignPayload[] = [];

    if (directCampaigns && directCampaigns.length > 0) {
      campaignsPayload = directCampaigns;
    } else {
      // 1. Chỉ lấy Keyword thôi, ASIN bỏ qua hoàn toàn
      const filteredItems = rawItems.filter((it) => !isAsinProductTarget(it.customerSearchTerm));
      if (filteredItems.length === 0) {
        throw new ApiError("Không có Search Term (từ khóa chữ) nào hợp lệ. Đã lọc bỏ ASIN.", 400);
      }

      // 2. Nhóm theo SKU
      const skuMap = new Map<string, SaleKwItemInput[]>();
      for (const item of filteredItems) {
        const sku = resolveSkuForSearchTerm(item);
        if (!skuMap.has(sku)) skuMap.set(sku, []);
        skuMap.get(sku)!.push(item);
      }

      const activeDateStr = String(body?.dateStr || "").trim() || formatDDMMYY();
      const activeUser = String(body?.userName || "").trim() || (actor.displayName ? actor.displayName.split(/\s+/)[0] : "Loan");
      const activeAdType = String(body?.adTypeCode || "").trim() || "SP03";

      for (const [sku, items] of skuMap.entries()) {
        const triad = generateSaleKwCampaignTriad({
          sku,
          adTypeCode: activeAdType,
          userName: activeUser,
          dateStr: activeDateStr,
        });

        const totalSkuSpend = items.reduce((s, it) => s + (it.spend || 0), 0);
        const totalSkuClicks = items.reduce((s, it) => s + (it.clicks || 0), 0);
        const skuAvgCpc = totalSkuClicks > 0 ? Math.round((totalSkuSpend / totalSkuClicks) * 100) / 100 : defaultBidVal;

        const configs: Array<{ matchTypeLower: "exact" | "phrase" | "broad"; campName: string }> = [
          { matchTypeLower: "exact", campName: triad.exact },
          { matchTypeLower: "phrase", campName: triad.phrase },
          { matchTypeLower: "broad", campName: triad.broad },
        ];

        for (const cfg of configs) {
          const keywords = items.map((it) => {
            const kwBid = it.bid && it.bid > 0
              ? it.bid
              : it.cpc && it.cpc > 0
                ? Math.max(0.1, Math.round(it.cpc * 100) / 100)
                : it.clicks > 0
                  ? Math.max(0.1, Math.round(((it.spend || 0) / it.clicks) * 100) / 100)
                  : defaultBidVal;

            return {
              customerSearchTerm: it.customerSearchTerm.trim(),
              keyword: it.customerSearchTerm.trim(),
              matchType: cfg.matchTypeLower,
              bid: kwBid,
              orders: it.orders || 0,
              sales: it.sales || 0,
              clicks: it.clicks || 0,
              spend: it.spend || 0,
            };
          });

          campaignsPayload.push({
            sourceCampaignName: items[0]?.campaignName || sku,
            sourceCampaignId: items[0]?.campaignId || "",
            sourceAdGroupId: items[0]?.adGroupId || "",
            sourceAdGroupName: items[0]?.adGroupName || items[0]?.campaignName || sku,
            targetCampaignName: cfg.campName,
            adGroupName: cfg.campName,
            sku,
            dailyBudget: defaultDailyBudget,
            defaultBid: skuAvgCpc > 0 ? skuAvgCpc : defaultBidVal,
            biddingStrategy: "Dynamic bids - down only",
            negateInSource: globalNegateInSource,
            keywords,
          });
        }
      }
    }

    const totalKeywords = campaignsPayload.reduce((sum, c) => sum + c.keywords.length, 0);

    // 3. Xuất file Excel chuẩn Amazon Bulksheet
    const buffer = await exportSaleKwBulksheetExcel(campaignsPayload);

    const cleanStore = storeName
      .replace(/[/\\?%*:|"<>]/g, "_")
      .trim()
      .replace(/\s+/g, "_");
    const fileName = `Upload_${cleanStore}_Sale_KW_${campaignsPayload.length}Camps_${totalKeywords}Terms_${exportTimestamp(new Date())}.xlsx`;

    const jobId = crypto.randomUUID();
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const safeStore = storeName.replace(/[^A-Za-z0-9._-]+/g, "-");
    const r2Key = `${r2KeyPrefix()}/ppc-bulk-upload/${safeStore}/${jobId}/${fileName}`;

    if (objectStorageDriver() !== "r2") {
      throw new Error("Auto Upload remote yêu cầu OBJECT_STORAGE_DRIVER=r2.");
    }

    // 4. Upload file lên Cloudflare R2 để Mac mini worker tải về
    await putStoredObject({
      key: r2Key,
      bytes: buffer,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sha256,
      metadata: { purpose: "amazon-ads-bulk-upload", store: safeStore, job: jobId },
    });

    const distinctCamps = Array.from(new Set(campaignsPayload.map((c) => c.targetCampaignName))).slice(0, 50);

    const actionsPayload = campaignsPayload.flatMap((camp) =>
      camp.keywords.map((kw, idx) => ({
        id: `sale-kw-${jobId.slice(0, 8)}-${idx}`,
        sku: camp.sku || "SALE_KW",
        campaignName: camp.targetCampaignName,
        sourceCampaignName: camp.sourceCampaignName,
        adGroupName: camp.adGroupName || camp.targetCampaignName,
        targetKeyword: kw.customerSearchTerm,
        matchType: kw.matchType || "exact",
        actionType: "CREATE_CAMPAIGN_KW",
        bid: kw.bid,
        dailyBudget: camp.dailyBudget,
        orders: kw.orders,
        sales: kw.sales,
        status: "PENDING",
      }))
    );

    // 5. Ghi nhận tác vụ vào ppc_auto_upload_logs ở trạng thái PENDING để Mac mini worker pick up
    await sql`
      INSERT INTO ppc_auto_upload_logs (
        id, team_id, store_id, file_name, action_count, skus, status, stage,
        file_status, progress_pct, action_ids, actions_payload, r2_key, sha256, updated_at, created_by
      ) VALUES (
        ${jobId}, ${actor.teamId}, ${storeId}, ${fileName}, ${totalKeywords},
        ${sql.json(distinctCamps)}, 'PENDING', 'FILE_READY',
        'SUCCESS', 25, ${sql.json([])}, ${sql.json(actionsPayload)}, ${r2Key}, ${sha256}, NOW(), ${actor.displayName || actor.userId || null}
      )
    `;

    // 6. Đăng ký các từ khóa vào bảng ppc_sale_kw_registry
    try {
      for (const camp of campaignsPayload) {
        for (const kw of camp.keywords) {
          const isProd =
            kw.customerSearchTerm.toLowerCase().startsWith("b0") ||
            kw.customerSearchTerm.toLowerCase().startsWith("asin=") ||
            kw.customerSearchTerm.toLowerCase().startsWith("category=");

          await sql`
            INSERT INTO ppc_sale_kw_registry (
              team_id, store_id, store_name, source_campaign_id, source_campaign_name,
              target_campaign_name, ad_group_name, keyword_text, match_type,
              target_type, sku, bid, daily_budget, orders, sales, clicks, spend, cpc,
              state, source, source_job_id, created_at, updated_at
            ) VALUES (
              ${actor.teamId}, ${storeId}, ${storeName},
              ${camp.sourceCampaignId || null}, ${camp.sourceCampaignName},
              ${camp.targetCampaignName}, ${camp.adGroupName || camp.targetCampaignName},
              ${kw.customerSearchTerm}, ${kw.matchType || "exact"},
              ${isProd ? "PRODUCT" : "KEYWORD"}, ${camp.sku || null},
              ${kw.bid || camp.defaultBid || defaultBidVal},
              ${camp.dailyBudget || defaultDailyBudget},
              ${kw.orders || 0}, ${kw.sales || 0}, ${kw.clicks || 0}, ${kw.spend || 0},
              ${(kw.clicks || 0) > 0 ? Math.round(((kw.spend || 0) / (kw.clicks || 1)) * 100) / 100 : 0},
              'enabled', 'AUTO_UPLOAD', ${jobId}, NOW(), NOW()
            )
            ON CONFLICT (store_id, target_campaign_name, keyword_text, match_type) DO UPDATE SET
              updated_at = NOW(),
              source_job_id = EXCLUDED.source_job_id,
              orders = EXCLUDED.orders,
              sales = EXCLUDED.sales,
              clicks = EXCLUDED.clicks,
              spend = EXCLUDED.spend,
              bid = EXCLUDED.bid
          `;
        }
      }
    } catch (registryErr) {
      console.error("Lỗi khi ghi nhận vào ppc_sale_kw_registry từ auto-upload:", registryErr);
    }

    return Response.json(
      {
        success: true,
        jobId,
        fileName,
        campaignCount: campaignsPayload.length,
        actionCount: totalKeywords,
        storeName,
        message: `Đã tạo file Bulk và xếp hàng upload trên Mac mini (${campaignsPayload.length} Camp Sale KW mới, ${totalKeywords} Search Terms tiềm năng).`,
      },
      { status: 202 }
    );
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi xếp hàng Auto Upload Sale KW.", 500);
  }
}
