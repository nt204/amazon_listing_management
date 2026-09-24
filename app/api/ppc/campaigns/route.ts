import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { campaignPerformanceFromFacts } from "@/lib/ppc/analytics";
import { listPpcCampaignPage, type PpcCampaignPageFilters } from "@/lib/ppc/repository";
import { getCachedOrFetch } from "@/lib/redis";

export const runtime = "nodejs";

const allowedSorts = new Set<PpcCampaignPageFilters["sortField"]>(["date", "spend", "sales", "orders", "clicks", "impressions", "ctr", "acos", "cvr", "roas"]);

export async function GET(request: Request) {
  const started = performance.now();
  try {
    const scope = dataScope(authorize(request, "read"));
    const p = new URL(request.url).searchParams;
    const isExport = p.get("export") === "1";
    const page = Math.max(1, Number(p.get("page") || 1));
    const pageSize = Math.min(isExport ? 20_000 : 200, Math.max(1, Number(p.get("pageSize") || 25)));
    const days = Number(p.get("days") || 7);
    const sortField = p.get("sortField") as PpcCampaignPageFilters["sortField"];
    const sortDirection = p.get("sortDirection") === "asc" ? "asc" : "desc";
    if (!Number.isInteger(page) || !Number.isInteger(pageSize) || !Number.isInteger(days) || !allowedSorts.has(sortField)) {
      throw new ApiError("Tham số phân trang hoặc sắp xếp Campaign không hợp lệ.", 400);
    }
    const filters: PpcCampaignPageFilters = {
      storeName: p.get("storeName") || "ALL", sku: p.get("sku") || "ALL", days,
      query: (p.get("query") || "").slice(0, 200),
      status: (["ALL", "ACTIVE", "PAUSED"].includes(p.get("status") || "") ? p.get("status") : "ACTIVE") as PpcCampaignPageFilters["status"],
      adType: p.get("adType") || "ALL",
      spendFilter: (["ALL", "HAS_SPEND", "ZERO_SPEND", "SPEND_GT_50", "SPEND_GT_100"].includes(p.get("spendFilter") || "") ? p.get("spendFilter") : "ALL") as PpcCampaignPageFilters["spendFilter"],
      groupFilter: (["ALL", "BLEEDING", "HIGH_ACOS", "GOOD"].includes(p.get("groupFilter") || "") ? p.get("groupFilter") : "ALL") as PpcCampaignPageFilters["groupFilter"],
      targetAcos: Number(p.get("targetAcos") || 30), sortField, sortDirection, page, pageSize,
    };
    const cacheKey = `ppc:campaign-page:${scope.teamId}:${Buffer.from(JSON.stringify(filters)).toString("base64url")}`;
    const data = await getCachedOrFetch(cacheKey, 60, async () => {
      const result = await listPpcCampaignPage(scope, filters);
      return { ...result, campaigns: campaignPerformanceFromFacts(result.rows, filters.targetAcos) };
    });
    const body = JSON.stringify(data);
    return new Response(body, { headers: {
      "Content-Type": "application/json", "Cache-Control": "private, no-store",
      "Server-Timing": `campaign-db;dur=${(performance.now() - started).toFixed(1)}`,
      "X-Response-Bytes": String(Buffer.byteLength(body)),
    }});
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải trang Campaign.", 500);
  }
}
