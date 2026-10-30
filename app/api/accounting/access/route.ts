import { z } from "zod";
import { authorize, dataScope, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import {
  assertCanManageAccounting,
  getAccountingAccessSnapshot,
  replaceAccountingAccess,
} from "@/lib/accounting/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  grants: z.array(z.object({
    actorId: z.string().trim().min(1).max(128),
    storeTeam: z.string().trim().min(1).max(100),
    canEdit: z.boolean(),
  }).strict()).max(5_000),
}).strict();

export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "accounting");
    assertCanManageAccounting(actor);
    return Response.json(await getAccountingAccessSnapshot(actor.teamId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải phân quyền kế toán.");
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    assertCanManageAccounting(actor);
    const input = schema.parse(await readJsonBody(request, 300_000));
    await replaceAccountingAccess(dataScope(actor), input.grants);
    return Response.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error, "Không thể lưu phân quyền kế toán.");
  }
}
