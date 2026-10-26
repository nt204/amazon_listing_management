import { z } from "zod";
import { ApiError, authorize, dataScope, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import {
  getPpcStoreAccessAdminSnapshot,
  replacePpcStoreAccess,
} from "@/lib/ppc/store-user-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  grants: z.array(z.object({
    storeId: z.string().uuid(),
    actorId: z.string().trim().min(1).max(128),
    canAskLark: z.boolean(),
    receiveActionNotifications: z.boolean(),
  }).strict()).max(5_000),
}).strict();

export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read");
    if (actor.role !== "admin") throw new ApiError("Bạn không có quyền cấu hình store.", 403);
    return Response.json(await getPpcStoreAccessAdminSnapshot(actor.teamId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải phân quyền store.");
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await authorize(request, "manage_users");
    if (actor.role !== "admin") throw new ApiError("Bạn không có quyền cấu hình store.", 403);
    const input = schema.parse(await readJsonBody(request, 300_000));
    await replacePpcStoreAccess(dataScope(actor), input.grants);
    return Response.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error, "Không thể lưu phân quyền store.");
  }
}
