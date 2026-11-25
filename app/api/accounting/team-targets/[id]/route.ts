import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { deleteTeamTarget, updateTeamTarget, type TeamTargetInput } from "@/lib/accounting/team-targets-service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const { id } = await params;
    const body = (await readJsonBody(request, 5_000)) as Partial<TeamTargetInput>;
    return Response.json({ target: await updateTeamTarget(id, body, actor.displayName || actor.userId) });
  } catch (error) {
    return routeErrorResponse(error, "Không sửa được mục tiêu.", 500);
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const { id } = await params;
    const ok = await deleteTeamTarget(id, actor.displayName || actor.userId);
    if (!ok) return Response.json({ error: "Mục tiêu đã bị xoá hoặc thay trước đó." }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, "Không xoá được mục tiêu.", 500);
  }
}
