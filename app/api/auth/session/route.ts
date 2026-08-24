import { NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "node:crypto";
import {
  actorFromCookieHeader,
  authenticateTeamToken,
  createSessionToken,
  defaultRegistrationTeamId,
  sessionCookie,
} from "@/lib/auth";
import { consumeRateLimit, getUserAccountForLogin, recordUserLogin } from "@/lib/db";
import { readJsonBody } from "@/lib/api-guard";
import { verifyPassword } from "@/lib/password";

export const runtime = "nodejs";

const loginSchema = z.union([
  z.object({
    username: z.string().trim().min(3).max(32),
    password: z.string().min(10).max(128),
  }).strict(),
  z.object({ token: z.string().min(24).max(512) }).strict(),
]);

export async function GET(request: Request) {
  const actor = actorFromCookieHeader(request.headers.get("cookie"));
  return actor
    ? NextResponse.json({ actor })
    : NextResponse.json({ error: "Authentication required." }, { status: 401 });
}

export async function POST(request: Request) {
  try {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const clientKey = createHash("sha256").update(forwarded).digest("hex").slice(0, 24);
    const rate = await consumeRateLimit(
      { teamId: `auth:${clientKey}`, actorId: "anonymous" },
      "team-login",
      Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE || 10),
      60,
    );
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many login attempts." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
      );
    }
    const input = loginSchema.parse(await readJsonBody(request, 2_000));
    let actor;
    if ("token" in input) {
      actor = authenticateTeamToken(input.token);
      if (!actor) {
        return NextResponse.json({ error: "Access token không hợp lệ." }, { status: 401 });
      }
    } else {
      const username = input.username.toLowerCase();
      const account = await getUserAccountForLogin(defaultRegistrationTeamId(), username);
      if (!account || !verifyPassword(input.password, account.passwordHash)) {
        return NextResponse.json({ error: "Tên đăng nhập hoặc mật khẩu không đúng." }, { status: 401 });
      }
      if (account.status === "pending") {
        return NextResponse.json({ error: "Tài khoản đang chờ admin duyệt." }, { status: 403 });
      }
      if (account.status !== "approved") {
        return NextResponse.json({ error: "Tài khoản chưa được phép đăng nhập." }, { status: 403 });
      }
      actor = {
        teamId: account.teamId,
        userId: account.userId,
        displayName: account.displayName,
        role: account.role,
        ruleProfile: process.env.LISTING_RULE_PROFILE || "",
      };
      await recordUserLogin(account.teamId, account.userId);
    }
    const response = NextResponse.json({ actor });
    response.cookies.set(sessionCookie.name, createSessionToken(actor), sessionCookie.options);
    return response;
  } catch {
    return NextResponse.json({ error: "Thông tin đăng nhập không hợp lệ." }, { status: 401 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookie.name, "", { ...sessionCookie.options, maxAge: 0 });
  return response;
}
