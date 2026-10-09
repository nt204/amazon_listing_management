import { z } from "zod";
import { ApiError, authorize, dataScope, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import {
  ALL_SYSTEM_FEATURES,
  addTeamUserByAdmin,
  deleteTeamUserAccount,
  listTeamUserAccounts,
  updateTeamUserAccount,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  email: z.string().trim().email("Email không hợp lệ").max(256),
  displayName: z.string().trim().max(128).optional(),
  role: z.enum(["editor", "reviewer", "admin"]).default("editor"),
  allowedFeatures: z.array(z.enum(ALL_SYSTEM_FEATURES)).max(ALL_SYSTEM_FEATURES.length)
    .default([...ALL_SYSTEM_FEATURES]),
}).strict();

const updateSchema = z.object({
  userId: z.string().trim().min(1).max(128),
  action: z.enum(["approve", "reject", "disable", "restore"]).optional(),
  role: z.enum(["editor", "reviewer", "admin"]).optional(),
  allowedFeatures: z.array(z.enum(ALL_SYSTEM_FEATURES)).max(ALL_SYSTEM_FEATURES.length).optional(),
}).strict().refine((data) => data.action || data.role || data.allowedFeatures, {
  message: "Cần cung cấp ít nhất một trường để cập nhật (action, role, hoặc allowedFeatures).",
});

const deleteSchema = z.object({
  userId: z.string().trim().min(1).max(128),
}).strict();

export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read");
    if (actor.role !== "admin") throw new ApiError("Bạn không có quyền quản trị tài khoản.", 403);
    return Response.json(
      { users: await listTeamUserAccounts(actor.teamId) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải danh sách tài khoản.");
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "manage_users");
    if (actor.role !== "admin") throw new ApiError("Bạn không có quyền thêm tài khoản.", 403);
    const input = createSchema.parse(await readJsonBody(request, 4_000));
    const user = await addTeamUserByAdmin(dataScope(actor), {
      email: input.email,
      displayName: input.displayName,
      role: input.role,
      allowedFeatures: input.allowedFeatures,
    });
    if (!user) {
      return Response.json(
        { error: "Tài khoản với email này đã tồn tại." },
        { status: 409 },
      );
    }
    return Response.json({ success: true, user }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, "Không thể thêm tài khoản.");
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await authorize(request, "manage_users");
    if (actor.role !== "admin") throw new ApiError("Bạn không có quyền cập nhật tài khoản.", 403);
    const input = updateSchema.parse(await readJsonBody(request, 4_000));
    const user = await updateTeamUserAccount(dataScope(actor), input.userId, {
      action: input.action,
      role: input.role,
      allowedFeatures: input.allowedFeatures,
    });
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

export async function DELETE(request: Request) {
  try {
    const actor = await authorize(request, "manage_users");
    if (actor.role !== "admin") throw new ApiError("Bạn không có quyền xóa tài khoản.", 403);
    const input = deleteSchema.parse(await readJsonBody(request, 2_000));
    if (input.userId === actor.userId) {
      return Response.json({ error: "Không thể tự xóa tài khoản của chính mình." }, { status: 400 });
    }
    const success = await deleteTeamUserAccount(dataScope(actor), input.userId);
    if (!success) {
      return Response.json({ error: "Không tìm thấy tài khoản cần xóa." }, { status: 404 });
    }
    return Response.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error, "Không thể xóa tài khoản.");
  }
}
