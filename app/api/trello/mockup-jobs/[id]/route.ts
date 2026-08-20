import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import {
  getMockupJob,
  listMockupJobEvents,
  requestMockupJobCancellation,
} from "@/lib/mockup-jobs";

export const runtime = "nodejs";

export async function GET(request: Request, context: RouteContext<"/api/trello/mockup-jobs/[id]">) {
  try {
    const scope = dataScope(authorize(request, "read"));
    const { id } = await context.params;
    const job = await getMockupJob(scope, id);
    if (!job) throw new ApiError("Không tìm thấy tác vụ mockup.", 404);
    const afterId = Number(new URL(request.url).searchParams.get("after") || 0);
    const events = await listMockupJobEvents(scope, id, afterId, 200);
    return Response.json({ job, events });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải tác vụ mockup.");
  }
}

export async function DELETE(request: Request, context: RouteContext<"/api/trello/mockup-jobs/[id]">) {
  try {
    const scope = dataScope(authorize(request, "write"));
    const { id } = await context.params;
    const existing = await getMockupJob(scope, id);
    if (!existing) throw new ApiError("Không tìm thấy tác vụ mockup.", 404);
    const job = await requestMockupJobCancellation(scope, id);
    return Response.json({ job });
  } catch (error) {
    return routeErrorResponse(error, "Không thể hủy tác vụ mockup.");
  }
}
