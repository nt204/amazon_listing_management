import { z } from "zod";
import { ApiError, authorize, dataScope, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { listTeamUserAccounts, updateTeamUserAccount } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  userId: z.string().trim().min(1).max(128),
  action: z.enum(["approve", "reject", "disable", "restore"]),
}).strict();

export async function GET(request: Request) {
  try {
    const actor = authorize(request, "read");
    if (actor.role !== "admin") throw new ApiError("Bạn không có quyền quản trị tài khoản.", 403);
    return Response.json(
      { users: await listTeamUserAccounts(actor.teamId) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải danh sách tài khoản.");
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = authorize(request, "manage_users");
    const input = updateSchema.parse(await readJsonBody(request, 4_000));
    const user = await updateTeamUserAccount(dataScope(actor), input.userId, input.action);
    if (!user) {
      return Response.json(
        { error: "Không tìm thấy tài khoản hoặc không thể thay đổi chính tài khoản admin đang dùng." },
        { status: 404 },
      );
    }
    return Response.json({ success: true, user });
  } catch (error) {
    return routeErrorResponse(error, "Không thể cập nhật tài khoản.");
  }
}
