import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { portfolioPerformanceFromRows } from "@/lib/ppc/analytics";
import { listPpcPortfolioPage, getActiveSnapshotId, type PpcPortfolioPageFilters } from "@/lib/ppc/repository";
import { getCachedOrFetch } from "@/lib/redis";
import { decodeMetricRanges } from "@/lib/ppc/manual-bid";

export const runtime = "nodejs";

const allowedSorts = new Set<PpcPortfolioPageFilters["sortField"]>([
  "name", "campaigns", "spend", "sales", "orders", "clicks", "impressions", "ctr", "acos", "cvr", "roas"
]);

export async function GET(request: Request) {
  const started = performance.now();
  try {
    const scope = dataScope(await authorize(request, "read", "ppc"));
    const p = new URL(request.url).searchParams;
    const isExport = p.get("export") === "1";
    const page = Math.max(1, Number(p.get("page") || 1));
    const pageSize = Math.min(isExport ? 20_000 : 200, Math.max(1, Number(p.get("pageSize") || 25)));
    const days = Number(p.get("days") || 7);
    const sortField = (p.get("sortField") || "spend") as PpcPortfolioPageFilters["sortField"];
    const sortDirection = p.get("sortDirection") === "asc" ? "asc" : "desc";
    const status = (["ALL", "ACTIVE", "PAUSED"].includes(p.get("status") || "") ? p.get("status") : "ACTIVE") as PpcPortfolioPageFilters["status"];
    const targetAcos = Number(p.get("targetAcos") || 30);
    const channel = p.get("channel") || null;

    if (!Number.isInteger(page) || !Number.isInteger(pageSize) || !Number.isInteger(days) || !allowedSorts.has(sortField)) {
      throw new ApiError("Tham số phân trang hoặc sắp xếp Portfolio không hợp lệ.", 400);
    }
    const filters: PpcPortfolioPageFilters = {
      storeName: p.get("storeName") || "ALL",
      days,
      query: (p.get("query") || "").slice(0, 200),
      status,
      sortField,
      sortDirection,
      page,
      pageSize,
      channel,
      ranges: decodeMetricRanges(p.get("ranges")),
    };
    const snapshotId = await getActiveSnapshotId(scope, filters.storeName, filters.days);
    const cacheKey = `ppc:portfolio-page:${scope.teamId}:${snapshotId}:${Buffer.from(JSON.stringify(filters)).toString("base64url")}`;
    const data = await getCachedOrFetch(cacheKey, 60, async () => {
      const result = await listPpcPortfolioPage(scope, filters);
      return {
        ...result,
        portfolios: portfolioPerformanceFromRows(result.rows, targetAcos),
      };
    });
    const body = JSON.stringify(data);
    return new Response(body, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
        "Server-Timing": `portfolio-db;dur=${(performance.now() - started).toFixed(1)}`,
        "X-Response-Bytes": String(Buffer.byteLength(body)),
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải trang Portfolio.", 500);
  }
}

