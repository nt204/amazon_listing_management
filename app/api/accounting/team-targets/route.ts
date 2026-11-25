import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { createTeamTarget, listTeamTargetsForWeb, type TeamTargetInput } from "@/lib/accounting/team-targets-service";

// Mục tiêu team (sếp giao qua Lark hoặc nhập tay): KPI kinh doanh → tab "Mục tiêu tuần".
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await authorize(request, "read", "accounting");
    return Response.json(await listTeamTargetsForWeb());
  } catch (error) {
    return routeErrorResponse(error, "Không tải được mục tiêu team.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const body = (await readJsonBody(request, 5_000)) as Partial<TeamTargetInput>;
    return Response.json({ target: await createTeamTarget(body, actor.displayName || actor.userId) });
  } catch (error) {
    return routeErrorResponse(error, "Không lưu được mục tiêu.", 500);
  }
}
