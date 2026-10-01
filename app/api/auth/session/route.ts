import { NextResponse } from "next/server";
import {
  actorFromCookieHeader,
  authenticateTeamToken,
  createSessionToken,
  developmentActor,
  revalidateSessionActor,
  sessionCookie,
  type RequestActor,
} from "@/lib/auth";
import { getOrCreateCloudflareUser } from "@/lib/db";
import { extractCloudflareEmail } from "@/lib/auth-server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const cfEmail = extractCloudflareEmail(request.headers);

  // 1. Nếu có email từ Cloudflare Access
  if (cfEmail) {
    try {
      const user = await getOrCreateCloudflareUser("default", cfEmail);
      if (user.status === "approved") {
        const actor: RequestActor = {
          teamId: user.teamId,
          userId: user.userId,
          displayName: user.displayName || user.username,
          role: user.role,
          ruleProfile: "",
          allowedFeatures: user.allowedFeatures,
          email: user.username,
        };
        const response = NextResponse.json({ actor, email: user.username, status: "approved" });
        response.cookies.set(sessionCookie.name, createSessionToken(actor), sessionCookie.options);
        return response;
      }
      return NextResponse.json(
        { error: "Tài khoản đang chờ duyệt hoặc bị khóa.", status: user.status, email: user.username },
        { status: 403 },
      );
    } catch {
      // Fallback xuống dưới
    }
  }

  // 2. Cookie session
  const decodedActor = actorFromCookieHeader(request.headers.get("cookie"));
  const cookieActor = decodedActor ? await revalidateSessionActor(decodedActor) : null;
  if (cookieActor) {
    return NextResponse.json({ actor: cookieActor, status: "approved" });
  }

  // 3. Dev actor fallback is never allowed in production.
  if (process.env.NODE_ENV !== "production") {
    const devActor = developmentActor();
    return NextResponse.json({ actor: devActor, status: "approved" });
  }
  return NextResponse.json({ error: "Authentication required.", status: "unauthenticated" }, { status: 401 });
}

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
    if (bearer) {
      const actor = authenticateTeamToken(bearer);
      if (actor) {
        const response = NextResponse.json({ actor });
        response.cookies.set(sessionCookie.name, createSessionToken(actor), sessionCookie.options);
        return response;
      }
    }
    return NextResponse.json({ error: "Access token không hợp lệ." }, { status: 401 });
  } catch {
    return NextResponse.json({ error: "Yêu cầu không hợp lệ." }, { status: 400 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookie.name, "", { ...sessionCookie.options, maxAge: 0 });
  return response;
}
