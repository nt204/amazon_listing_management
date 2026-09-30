import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { exportSaleKwBulksheetExcel, type SaleKwCampaignPayload } from "@/lib/ppc/service";
import {
  isAsinProductTarget,
  generateSaleKwCampaignTriad,
  normalizeSaleKwDate,
  resolveSkuForSearchTerm,
} from "@/lib/ppc/sku-extractor";

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
    const actor = authorize(request, "export");
    enforceRequestSize(request);
    const sql = await getDatabaseClient();

    const body = await request.json().catch(() => ({}));
    const storeName = String(body?.storeName || "STORE").trim();
    const rawItems: SaleKwItemInput[] = Array.isArray(body?.items) ? body.items : [];
    const directCampaigns = Array.isArray(body?.campaigns) ? body.campaigns : null;
    const defaultDailyBudget = Number(body?.dailyBudget) || 5.0;
    const defaultBidVal = Number(body?.defaultBid) || 1.0;
    const globalNegateInSource = Boolean(body?.negateInSource);
    const activeDateStr = normalizeSaleKwDate(String(body?.dateStr || "").trim());
    const activeUser = String(body?.userName || "").trim() || (actor.displayName ? actor.displayName.split(/\s+/)[0] : "Loan");
    const activeAdType = String(body?.adTypeCode || "").trim() || "SP03";

    if (rawItems.length === 0 && (!directCampaigns || directCampaigns.length === 0)) {
      throw new ApiError("Không có Search Term nào được chọn để lên Camp Sale KW.", 400);
    }

    const requestedStoreId = String(body?.storeId || "").trim();

    // Resolve store id with full fallbacks
    let resolvedStoreId = "";
    let finalStoreName = storeName;
    if (requestedStoreId) {
      const storeRes = await sql<{ id: string; name: string }[]>`
        SELECT id, name FROM ppc_stores
        WHERE id = ${requestedStoreId} AND team_id = ${actor.teamId}
        LIMIT 1
      `;
      if (storeRes.length > 0) {
        resolvedStoreId = storeRes[0].id;
        finalStoreName = storeRes[0].name;
      }
    }
    if (!resolvedStoreId && storeName && storeName !== "STORE" && storeName !== "ALL") {
      const storeRes = await sql<{ id: string; name: string }[]>`
        SELECT id, name FROM ppc_stores
        WHERE LOWER(name) = LOWER(${storeName}) AND team_id = ${actor.teamId}
        LIMIT 1
      `;
      if (storeRes.length > 0) {
        resolvedStoreId = storeRes[0].id;
        finalStoreName = storeRes[0].name;
      }
    }
    if (!resolvedStoreId) {
      const fallbackRows = await sql<{ id: string; name: string }[]>`
        SELECT id, name FROM ppc_stores
        WHERE team_id = ${actor.teamId}
        ORDER BY created_at ASC
        LIMIT 1
      `;
      if (fallbackRows.length > 0) {
        resolvedStoreId = fallbackRows[0].id;
        finalStoreName = fallbackRows[0].name;
      }
    }

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

    // Xuất file Excel chuẩn Amazon Bulksheet
    const buffer = await exportSaleKwBulksheetExcel(campaignsPayload);

    // Ghi nhận vào ppc_sale_kw_registry
    try {
      if (resolvedStoreId) {
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
                state, source, created_at, updated_at
              ) VALUES (
                ${actor.teamId}, ${resolvedStoreId}, ${storeName},
                ${camp.sourceCampaignId || null}, ${camp.sourceCampaignName},
                ${camp.targetCampaignName}, ${camp.adGroupName || camp.targetCampaignName},
                ${kw.customerSearchTerm}, ${kw.matchType || "exact"},
                ${isProd ? "PRODUCT" : "KEYWORD"}, ${camp.sku || null},
                ${kw.bid || camp.defaultBid || defaultBidVal},
                ${camp.dailyBudget || defaultDailyBudget},
                ${kw.orders || 0}, ${kw.sales || 0}, ${kw.clicks || 0}, ${kw.spend || 0},
                ${(kw.clicks || 0) > 0 ? Math.round(((kw.spend || 0) / (kw.clicks || 1)) * 100) / 100 : 0},
                'enabled', 'MANUAL_EXPORT', NOW(), NOW()
              )
              ON CONFLICT (store_id, target_campaign_name, keyword_text, match_type) DO UPDATE SET
                updated_at = NOW(),
                orders = EXCLUDED.orders,
                sales = EXCLUDED.sales,
                clicks = EXCLUDED.clicks,
                spend = EXCLUDED.spend,
                bid = EXCLUDED.bid
            `;
          }
        }
      }
    } catch (registryErr) {
      console.error("Lỗi khi ghi nhận vào ppc_sale_kw_registry từ export:", registryErr);
    }

    const cleanStore = storeName
      .replace(/[/\\?%*:|"<>]/g, "_")
      .trim()
      .replace(/\s+/g, "_");
    const totalKeywords = campaignsPayload.reduce((sum, campaign) => sum + campaign.keywords.length, 0);
    const fileName = `Upload_${cleanStore}_Sale_KW_${campaignsPayload.length}Camps_${totalKeywords}Terms_${exportTimestamp(new Date())}.xlsx`;

    const asciiFileName = fileName
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9 ._+()-]+/g, "")
      .replace(/\s+/g, " ")
      .trim() || "Sale_KW_Campaigns.xlsx";

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi xuất file Bulksheet Sale KW.", 500);
  }
}
