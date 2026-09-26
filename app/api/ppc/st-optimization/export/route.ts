import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { exportBulksheetUpdateExcel } from "@/lib/ppc/service";
import type { PpcRecommendation } from "@/lib/ppc/types";

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
    authorize(request, "export");
    enforceRequestSize(request);

    const body = await request.json();
    const storeName = String(body?.storeName || "STORE").trim();
    const rawItems: StCandidateInput[] = Array.isArray(body?.items) ? body.items : [];

    if (rawItems.length === 0) {
      throw new ApiError("Không có Search Term nào được chọn để xuất file phủ định.", 400);
    }

    // 1. Deduplicate by (campaignName, customerSearchTerm) - crucial for Amazon Bulksheet
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

    // 2. Tra cứu Amazon campaign_id và ad_group_id từ ppc_performance_facts nếu thiếu
    const needsCampId = uniqueItems.some((it) => !it.campaignId || !it.adGroupId);
    const campaignIdLookup = new Map<string, string>();
    const campaignAdTypeLookup = new Map<string, string>();
    const campaignDefaultAgId = new Map<string, string>();
    const adGroupIdLookup = new Map<string, string>();

    if (needsCampId) {
      const sql = await getDatabaseClient();
      const facts = await sql<Array<{
        campaign_name: string;
        campaign_id: string;
        ad_type: string;
        ad_group_name: string;
        ad_group_id: string;
      }>>`
        SELECT DISTINCT campaign_name, campaign_id, ad_type, ad_group_name, ad_group_id
        FROM ppc_performance_facts
        WHERE campaign_id IS NOT NULL AND length(campaign_id) > 0
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

    // 3. Chuẩn hóa thành PpcRecommendation với recType = NEGATIVE_KEYWORD
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
        id: `st-opt-${idx}-${Date.now()}`,
        storeId: it.storeId || "store-default",
        storeName: storeName || "STORE",
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
        reason: `ST Optimization: ${it.clicks} clicks, 0 orders, lãng phí $${Number(it.spend || 0).toFixed(2)}. Phủ định Negative Exact chỉ trong source campaign.`,
        estimatedSavings: Number(it.spend || 0),
        status: "PENDING",
        createdAt: new Date().toISOString(),
      };
    });

    // 4. Xuất file Excel chuẩn Amazon Bulksheet
    const buffer = await exportBulksheetUpdateExcel(recommendations);

    const cleanStore = storeName
      .replace(/[/\\?%*:|"<>]/g, "_")
      .trim()
      .replace(/\s+/g, "_");
    const fileName = `Upload_${cleanStore}_ST_Optimization_NegativeExact_${recommendations.length}Terms_${exportTimestamp(new Date())}.xlsx`;

    const asciiFileName = fileName
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9 ._+()-]+/g, "")
      .replace(/\s+/g, " ")
      .trim() || "ST_Negative_Exact.xlsx";

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi xuất file Bulksheet ST Optimization.", 500);
  }
}
