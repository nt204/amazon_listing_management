import { z } from "zod";
import { ApiError, authorize, dataScope, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { getUserAccountForLoginById, updateUserPassword } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";

export const runtime = "nodejs";

const passwordSchema = z.object({
  currentPassword: z.string().min(10).max(128),
  newPassword: z.string().min(10).max(128),
}).strict().refine((input) => input.currentPassword !== input.newPassword, {
  path: ["newPassword"],
  message: "Mật khẩu mới phải khác mật khẩu hiện tại.",
});

export async function POST(request: Request) {
  try {
    const actor = authorize(request, "write");
    const input = passwordSchema.parse(await readJsonBody(request, 4_000));
    const account = await getUserAccountForLoginById(actor.teamId, actor.userId);
    if (!account || !verifyPassword(input.currentPassword, account.passwordHash)) {
      throw new ApiError("Mật khẩu hiện tại không đúng.", 400);
    }
    const updated = await updateUserPassword(dataScope(actor), hashPassword(input.newPassword));
    if (!updated) throw new ApiError("Không thể đổi mật khẩu cho tài khoản này.", 409);
    return Response.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error, "Không thể đổi mật khẩu.");
  }
}
