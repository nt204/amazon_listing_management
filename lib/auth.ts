import { createHmac, timingSafeEqual } from "node:crypto";
import {
  getUserAccountForLogin,
  getUserAccountForLoginById,
  type AppUserSummary,
} from "@/lib/db";

export type TeamRole = "editor" | "reviewer" | "admin";
export type Permission =
  | "read"
  | "write"
  | "approve"
  | "export"
  | "manage_brands"
  | "manage_templates"
  | "manage_users"
  | "manage_storage";
export type SystemFeature = "listing" | "mockups" | "sellersprite" | "ppc";

export interface RequestActor {
  teamId: string;
  userId: string;
  displayName: string;
  role: TeamRole;
  ruleProfile: string;
  allowedFeatures?: string[];
  email?: string;
}

interface TeamCredential {
  team_id: string;
  user_id: string;
  display_name?: string;
  token: string;
  role: TeamRole;
  rule_profile?: string;
}

interface SessionPayload extends RequestActor {
  exp: number;
}

export class AuthError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

const cookieName = "listing_desk_session";
const memberPermissions: Permission[] = [
  "read",
  "write",
  "approve",
  "export",
  "manage_brands",
  "manage_templates",
];
const rolePermissions: Record<TeamRole, Set<Permission>> = {
  editor: new Set(memberPermissions),
  reviewer: new Set(memberPermissions),
  admin: new Set([
    ...memberPermissions,
    "manage_users",
    "manage_storage",
  ]),
};

function authMode() {
  return process.env.LISTING_DESK_AUTH_MODE?.trim() || "disabled";
}

export function isAuthenticationRequired() {
  return authMode() !== "disabled";
}

export function defaultRegistrationTeamId() {
  const value = process.env.LISTING_DESK_DEFAULT_TEAM_ID?.trim() || "default";
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    throw new Error("LISTING_DESK_DEFAULT_TEAM_ID is invalid.");
  }
  return value;
}

function safeEqual(first: string, second: string) {
  const firstHash = createHmac("sha256", "listing-desk-token-compare").update(first).digest();
  const secondHash = createHmac("sha256", "listing-desk-token-compare").update(second).digest();
  return timingSafeEqual(firstHash, secondHash);
}

function credentials(): TeamCredential[] {
  const configured = process.env.LISTING_DESK_TEAMS_JSON?.trim();
  if (!configured) return [];
  const parsed = JSON.parse(configured) as TeamCredential[];
  if (!Array.isArray(parsed)) throw new Error("LISTING_DESK_TEAMS_JSON must be a JSON array.");
  return parsed.map((credential) => {
    if (
      !credential.team_id?.trim() || !credential.user_id?.trim() ||
      !credential.token || credential.token.length < 12 ||
      !["editor", "reviewer", "admin"].includes(credential.role)
    ) {
      throw new Error("Each team credential needs team_id, user_id, role, and a token of at least 12 characters.");
    }
    return credential;
  });
}

function sessionSecret() {
  const secret = process.env.LISTING_DESK_SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("LISTING_DESK_SESSION_SECRET must contain at least 32 characters when authentication is enabled.");
  }
  return secret;
}

function encode(value: string) {
  return Buffer.from(value).toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signature(payload: string) {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export function createSessionToken(actor: RequestActor) {
  const hours = Math.min(168, Math.max(1, Number(process.env.LISTING_DESK_SESSION_HOURS || 12)));
  const payload = encode(JSON.stringify({ ...actor, exp: Date.now() + hours * 3_600_000 } satisfies SessionPayload));
  return `${payload}.${signature(payload)}`;
}

export function verifySessionToken(token: string | undefined): RequestActor | null {
  if (!token) return null;
  const [payload, suppliedSignature] = token.split(".");
  if (!payload || !suppliedSignature || !safeEqual(signature(payload), suppliedSignature)) return null;
  try {
    const decoded = JSON.parse(decode(payload)) as SessionPayload;
    if (decoded.exp <= Date.now() || !rolePermissions[decoded.role]) return null;
    return {
      teamId: decoded.teamId,
      userId: decoded.userId,
      displayName: decoded.displayName,
      role: decoded.role,
      ruleProfile: decoded.ruleProfile || "",
      allowedFeatures: decoded.allowedFeatures || ["listing", "mockups", "sellersprite", "ppc"],
      ...(decoded.email ? { email: decoded.email } : {}),
    };
  } catch {
    return null;
  }
}

export function authenticateTeamToken(token: string) {
  const match = credentials().find((credential) => safeEqual(credential.token, token));
  if (!match) return null;
  return {
    teamId: match.team_id,
    userId: match.user_id,
    displayName: match.display_name || match.user_id,
    role: match.role,
    ruleProfile: match.rule_profile || "",
    allowedFeatures: ["listing", "mockups", "sellersprite", "ppc"],
  } satisfies RequestActor;
}

function cookieValue(header: string | null, name: string) {
  return (header || "").split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

export function developmentActor(): RequestActor {
  return {
    teamId: "default",
    userId: "admin-ndtrince",
    displayName: "Admin (ndtrince)",
    role: "admin",
    ruleProfile: process.env.LISTING_RULE_PROFILE || "",
    allowedFeatures: ["listing", "mockups", "sellersprite", "ppc"],
    email: "ndtrince@gmail.com",
  };
}

export function isSystemAdminEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  const configured = (process.env.LISTING_DESK_ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const adminSet = new Set(["ndtrince@gmail.com", "nguyendangtri2507@gmail.com", ...configured]);
  return adminSet.has(normalized);
}

export function actorFromCookieHeader(cookieHeader: string | null) {
  if (!isAuthenticationRequired()) return developmentActor();
  return verifySessionToken(cookieValue(cookieHeader, cookieName));
}

function actorFromUser(user: AppUserSummary): RequestActor {
  return {
    teamId: user.teamId,
    userId: user.userId,
    displayName: user.displayName || user.username,
    role: user.role,
    ruleProfile: "",
    allowedFeatures: user.allowedFeatures,
    email: user.username,
  };
}

export async function revalidateSessionActor(actor: RequestActor): Promise<RequestActor | null> {
  const user = await getUserAccountForLoginById(actor.teamId, actor.userId);
  return user?.status === "approved" ? actorFromUser(user) : null;
}

/**
 * Authenticate every request against the current database record.
 * The signed cookie proves the original login, while this lookup makes account
 * disabling, role changes, and feature changes effective immediately.
 */
export async function authenticateRequest(
  request: Request,
  permission: Permission,
  feature?: SystemFeature,
): Promise<RequestActor> {
  let actor: RequestActor | null;
  let bearer = "";
  if (!isAuthenticationRequired()) {
    actor = developmentActor();
  } else {
    const authorization = request.headers.get("authorization") || "";
    bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
    actor = bearer ? authenticateTeamToken(bearer) : null;

    if (!bearer) {
      const cfEmail = (
        request.headers.get("cf-access-authenticated-user-email") ||
        request.headers.get("Cf-Access-Authenticated-User-Email")
      )?.trim().toLowerCase();

      if (cfEmail) {
        const user = await getUserAccountForLogin("default", cfEmail);
        actor = user?.status === "approved" ? actorFromUser(user) : null;
        if (!actor) throw new AuthError("Account is not approved or has been disabled.", 403);
      } else {
        const sessionActor = actorFromCookieHeader(request.headers.get("cookie"));
        if (sessionActor) {
          actor = await revalidateSessionActor(sessionActor);
        }
      }
    }
  }

  // Local development remains convenient, but production must never fall back
  // to an implicit administrator.
  if (!actor) {
    if (process.env.NODE_ENV !== "production") {
      actor = developmentActor();
    }
  }

  if (!actor) throw new AuthError("Authentication required.", 401);
  if (!rolePermissions[actor.role].has(permission)) throw new AuthError("Insufficient permission.", 403);
  if (feature && !(actor.allowedFeatures || []).includes(feature)) {
    throw new AuthError("This feature is not enabled for your account.", 403);
  }
  if (isAuthenticationRequired() && !bearer && permission !== "read") {
    const origin = request.headers.get("origin");
    const requestHost = request.headers.get("x-forwarded-host") || request.headers.get("host");
    const configured = (process.env.LISTING_DESK_ALLOWED_ORIGINS || "")
      .split(",").map((value) => value.trim()).filter(Boolean);
    const allowed = new Set(configured);
    if (requestHost) allowed.add(`https://${requestHost}`);
    if (process.env.NODE_ENV !== "production" && requestHost) allowed.add(`http://${requestHost}`);
    if (!origin || !allowed.has(origin)) throw new AuthError("Request origin is not allowed.", 403);
  }
  return actor;
}

export function authenticateMockupWorker(request: Request): RequestActor | null {
  const supplied = request.headers.get("x-mockup-worker-secret")?.trim();
  if (!supplied) return null;

  const configured = (
    process.env.MOCKUP_WORKER_SECRET || process.env.LISTING_DESK_SESSION_SECRET || ""
  ).trim();
  if (configured.length < 32 || !safeEqual(configured, supplied)) {
    throw new AuthError("Invalid mockup worker credential.", 401);
  }

  const teamId = request.headers.get("x-mockup-team-id")?.trim() || "";
  const actorId = request.headers.get("x-mockup-actor-id")?.trim() || "";
  if (
    !/^[A-Za-z0-9._:-]{1,128}$/.test(teamId) ||
    !/^[A-Za-z0-9._:@+-]{1,128}$/.test(actorId)
  ) {
    throw new AuthError("Invalid mockup worker scope.", 400);
  }

  return {
    teamId,
    userId: actorId,
    displayName: "Mockup worker",
    role: "admin",
    ruleProfile: "",
  };
}

export function authErrorResponse(error: unknown) {
  if (!(error instanceof AuthError)) return null;
  return Response.json({ error: error.message }, { status: error.status });
}

export const sessionCookie = {
  name: cookieName,
  options: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: Math.min(168, Math.max(1, Number(process.env.LISTING_DESK_SESSION_HOURS || 12))) * 3_600,
  },
};
