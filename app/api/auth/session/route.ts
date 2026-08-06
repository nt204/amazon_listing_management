import { NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "node:crypto";
import {
  actorFromCookieHeader,
  authenticateTeamToken,
  createSessionToken,
  sessionCookie,
} from "@/lib/auth";
import { consumeRateLimit } from "@/lib/db";
import { readJsonBody } from "@/lib/api-guard";

export const runtime = "nodejs";

const loginSchema = z.object({ token: z.string().min(24).max(512) });

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
    const { token } = loginSchema.parse(await readJsonBody(request, 2_000));
    const actor = authenticateTeamToken(token);
    if (!actor) return NextResponse.json({ error: "Invalid team access token." }, { status: 401 });
    const response = NextResponse.json({ actor });
    response.cookies.set(sessionCookie.name, createSessionToken(actor), sessionCookie.options);
    return response;
  } catch {
    return NextResponse.json({ error: "Invalid team access token." }, { status: 401 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookie.name, "", { ...sessionCookie.options, maxAge: 0 });
  return response;
}
