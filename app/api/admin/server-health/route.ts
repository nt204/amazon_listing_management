import { ApiError, authorize, routeErrorResponse } from "@/lib/api-guard";
import { getServerHealthReport } from "@/lib/server-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read");
    if (actor.role !== "admin") throw new ApiError("Bạn không có quyền xem sức khỏe server.", 403);
    return Response.json(await getServerHealthReport(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải sức khỏe server.");
  }
}
