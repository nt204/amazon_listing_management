import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { decideDraftFromWeb } from "@/lib/accounting/team-targets-service";

// Lưu / huỷ tin nhắn giao mục tiêu đang chờ xác nhận (KPI kinh doanh → Mục tiêu tuần → Chờ xác nhận).
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const { id } = await params;
    const body = (await readJsonBody(request, 2_000)) as { action?: string; team?: string };
    const action = body.action === "cancel" ? "cancel" : "confirm";
    return Response.json(await decideDraftFromWeb(id, action, body.team, actor.displayName || actor.userId));
  } catch (error) {
    return routeErrorResponse(error, "Không xác nhận được.", 500);
  }
}
