import { createHmac, timingSafeEqual } from "node:crypto";

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

export interface RequestActor {
  teamId: string;
  userId: string;
  displayName: string;
  role: TeamRole;
  ruleProfile: string;
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
      !credential.token || credential.token.length < 24 ||
      !["editor", "reviewer", "admin"].includes(credential.role)
    ) {
      throw new Error("Each team credential needs team_id, user_id, role, and a token of at least 24 characters.");
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
  } satisfies RequestActor;
}

function cookieValue(header: string | null, name: string) {
  return (header || "").split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function developmentActor(): RequestActor {
  return {
    teamId: "default",
    userId: "local-development",
    displayName: "Local development",
    role: "admin",
    ruleProfile: process.env.LISTING_RULE_PROFILE || "",
  };
}

export function actorFromCookieHeader(cookieHeader: string | null) {
  if (!isAuthenticationRequired()) return developmentActor();
  return verifySessionToken(cookieValue(cookieHeader, cookieName));
}

export function authenticateRequest(request: Request, permission: Permission): RequestActor {
  let actor: RequestActor | null;
  let bearer = "";
  if (!isAuthenticationRequired()) {
    actor = developmentActor();
  } else {
    const authorization = request.headers.get("authorization") || "";
    bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
    actor = bearer
      ? authenticateTeamToken(bearer)
      : actorFromCookieHeader(request.headers.get("cookie"));
  }
  if (!actor) throw new AuthError("Authentication required.", 401);
  if (!rolePermissions[actor.role].has(permission)) throw new AuthError("Insufficient permission.", 403);
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
