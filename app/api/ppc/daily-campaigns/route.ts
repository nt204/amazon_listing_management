import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { listPpcDailyCampaignsFromDb } from "@/lib/ppc/repository";
import { getCachedOrFetch } from "@/lib/redis";

export const runtime = "nodejs";

const REDIS_TTL_SEC = 900; // 15 phút

export async function GET(request: Request) {
  try {
    const scope = dataScope(authorize(request, "read"));
    const { searchParams } = new URL(request.url);
    const storeName = searchParams.get("storeName") || "ALL";
    const days = Math.min(Math.max(Number(searchParams.get("days") || 7), 1), 30);

    const redisKey = `ppc:daily-campaigns:${scope.teamId}:${storeName}:${days}`;

    const data = await getCachedOrFetch(redisKey, REDIS_TTL_SEC, async () => {
      return await listPpcDailyCampaignsFromDb(scope, { storeName, days });
    });

    return Response.json({
      success: true,
      storeName,
      days,
      data,
    }, {
      headers: {
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi máy chủ khi tải thống kê chiến dịch theo ngày.", 500);
  }
}
