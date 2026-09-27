import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { exportSaleKwBulksheetExcel, type SaleKwCampaignPayload } from "@/lib/ppc/service";

export const runtime = "nodejs";

export interface SaleKwItemInput {
  customerSearchTerm: string;
  campaignName: string;
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
    const defaultDailyBudget = Number(body?.dailyBudget) || 10.0;
    const defaultBidVal = Number(body?.defaultBid) || 1.0;
    const globalNegateInSource = Boolean(body?.negateInSource);

    if (rawItems.length === 0 && (!directCampaigns || directCampaigns.length === 0)) {
      throw new ApiError("Không có Search Term nào được chọn để lên Camp Sale KW.", 400);
    }

    // Resolve store id
    let resolvedStoreId = "";
    if (storeName && storeName !== "STORE" && storeName !== "ALL") {
      const storeRes = await sql<{ id: string }[]>`
        SELECT id FROM ppc_stores
        WHERE LOWER(name) = LOWER(${storeName}) AND team_id = ${actor.teamId}
        LIMIT 1
      `;
      if (storeRes.length > 0) resolvedStoreId = storeRes[0].id;
    }

    let campaignsPayload: SaleKwCampaignPayload[] = [];

    if (directCampaigns && directCampaigns.length > 0) {
      campaignsPayload = directCampaigns;
    } else {
      // Nhóm rawItems theo Campaign Name
      const campaignMap = new Map<string, SaleKwItemInput[]>();
      for (const item of rawItems) {
        const camp = (item.campaignName || "").trim();
        const term = (item.customerSearchTerm || "").trim();
        if (!camp || !term) continue;
        if (!campaignMap.has(camp)) {
          campaignMap.set(camp, []);
        }
        campaignMap.get(camp)!.push(item);
      }

      const campNames = Array.from(campaignMap.keys());
      if (campNames.length === 0) {
        throw new ApiError("Danh sách Search Term không hợp lệ.", 400);
      }

      // Tra cứu Amazon Campaign ID, Ad Group ID, SKU từ ppc_performance_facts
      const facts = await sql<Array<{
        campaign_name: string;
        campaign_id: string;
        ad_group_name: string;
        ad_group_id: string;
        sku: string;
      }>>`
        SELECT DISTINCT campaign_name, campaign_id, ad_group_name, ad_group_id, sku
        FROM ppc_performance_facts
        WHERE campaign_name = ANY(${campNames})
      `;

      const campLookup = new Map<string, { campaignId: string; adGroupId: string; adGroupName: string; skus: Set<string> }>();
      for (const f of facts) {
        const cKey = (f.campaign_name || "").trim().toLowerCase();
        if (!cKey) continue;
        if (!campLookup.has(cKey)) {
          campLookup.set(cKey, {
            campaignId: f.campaign_id || "",
            adGroupId: f.ad_group_id || "",
            adGroupName: f.ad_group_name || f.campaign_name,
            skus: new Set<string>(),
          });
        }
        const entry = campLookup.get(cKey)!;
        if (!entry.campaignId && f.campaign_id) entry.campaignId = f.campaign_id;
        if (!entry.adGroupId && f.ad_group_id) {
          entry.adGroupId = f.ad_group_id;
          entry.adGroupName = f.ad_group_name;
        }
        if (f.sku && f.sku.trim()) entry.skus.add(f.sku.trim());
      }

      for (const [campName, items] of campaignMap.entries()) {
        const cKey = campName.toLowerCase();
        const lookup = campLookup.get(cKey);
        const targetCampName = `${campName} (Sale KW)`;
        const adGroupName = targetCampName;

        // Xác định SKU
        let sku = "";
        const itemWithSku = items.find((it) => it.sku && it.sku.trim());
        if (itemWithSku?.sku) {
          sku = itemWithSku.sku.trim();
        } else if (lookup && lookup.skus.size > 0) {
          sku = Array.from(lookup.skus)[0];
        }

        const keywords = items.map((it) => {
          const kwBid = it.bid && it.bid > 0
            ? it.bid
            : it.cpc && it.cpc > 0
              ? Math.max(0.1, Math.round(it.cpc * 100) / 100)
              : defaultBidVal;

          return {
            customerSearchTerm: it.customerSearchTerm.trim(),
            keyword: it.customerSearchTerm.trim(),
            matchType: it.matchType || "exact",
            bid: kwBid,
            orders: it.orders || 0,
            sales: it.sales || 0,
            clicks: it.clicks || 0,
            spend: it.spend || 0,
          };
        });

        campaignsPayload.push({
          sourceCampaignName: campName,
          sourceCampaignId: lookup?.campaignId || items[0]?.campaignId || "",
          sourceAdGroupId: lookup?.adGroupId || items[0]?.adGroupId || "",
          sourceAdGroupName: lookup?.adGroupName || items[0]?.adGroupName || campName,
          targetCampaignName: targetCampName,
          adGroupName,
          sku,
          dailyBudget: defaultDailyBudget,
          defaultBid: defaultBidVal,
          biddingStrategy: "Dynamic bids - down only",
          negateInSource: globalNegateInSource,
          keywords,
        });
      }
    }

    const totalKeywords = campaignsPayload.reduce((sum, c) => sum + c.keywords.length, 0);

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
