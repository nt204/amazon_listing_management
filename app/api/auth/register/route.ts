import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { defaultRegistrationTeamId } from "@/lib/auth";
import { ApiError, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { consumeRateLimit, createPendingUserAccount } from "@/lib/db";
import { hashPassword } from "@/lib/password";

export const runtime = "nodejs";

const registerSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,31}$/),
  password: z.string().min(10).max(128),
}).strict();

export async function POST(request: Request) {
  try {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const clientKey = createHash("sha256").update(forwarded).digest("hex").slice(0, 24);
    const rate = await consumeRateLimit(
      { teamId: `auth:${clientKey}`, actorId: "anonymous" },
      "account-register",
      Number(process.env.AUTH_REGISTER_RATE_LIMIT_PER_HOUR || 5),
      3_600,
    );
    if (!rate.allowed) {
      throw new ApiError("Bạn đã gửi quá nhiều yêu cầu đăng ký. Vui lòng thử lại sau.", 429, {
        "Retry-After": String(rate.retryAfterSeconds),
      });
    }
    const input = registerSchema.parse(await readJsonBody(request, 4_000));
    const account = await createPendingUserAccount({
      teamId: defaultRegistrationTeamId(),
      username: input.username,
      displayName: input.displayName,
      passwordHash: hashPassword(input.password),
    });
    if (!account) throw new ApiError("Tên đăng nhập này đã được sử dụng.", 409);
    return NextResponse.json(
      { success: true, message: "Đã gửi đăng ký. Vui lòng chờ admin duyệt tài khoản." },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error, "Không thể tạo tài khoản.");
  }
}
