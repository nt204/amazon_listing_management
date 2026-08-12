import "server-only";

import { AuthError, authenticateRequest, type Permission, type RequestActor } from "@/lib/auth";
import { consumeRateLimit, type DataScope } from "@/lib/db";
import { logEvent } from "@/lib/logger";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly headers: HeadersInit = {},
  ) {
    super(message);
  }
}

export function dataScope(actor: RequestActor): DataScope {
  return { teamId: actor.teamId, actorId: actor.userId };
}

export function authorize(request: Request, permission: Permission) {
  return authenticateRequest(request, permission);
}

export function enforceRequestSize(request: Request, maxBytes = Number(process.env.MAX_REQUEST_BYTES || 75_000_000)) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new ApiError(`Request body exceeds ${maxBytes} bytes.`, 413);
  }
}

export async function readJsonBody(request: Request, maxBytes = Number(process.env.MAX_REQUEST_BYTES || 75_000_000)) {
  enforceRequestSize(request, maxBytes);
  if (!request.body) throw new ApiError("Request body is required.", 400);
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let body = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ApiError(`Request body exceeds ${maxBytes} bytes.`, 413);
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new ApiError("Request body must contain valid JSON.", 400);
  }
}

export async function enforceRateLimit(
  actor: RequestActor,
  scopeName: string,
  limit = Number(process.env.AI_RATE_LIMIT_PER_MINUTE || 10),
  windowSeconds = 60,
) {
  const result = await consumeRateLimit(dataScope(actor), scopeName, limit, windowSeconds);
  if (!result.allowed) {
    throw new ApiError("Rate limit exceeded. Try again later.", 429, {
      "Retry-After": String(result.retryAfterSeconds),
    });
  }
  return result;
}

export function idempotencyKey(request: Request) {
  const key = request.headers.get("idempotency-key")?.trim() || "";
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(key)) {
    throw new ApiError("A valid Idempotency-Key header is required.", 400);
  }
  return key;
}

export function routeErrorResponse(error: unknown, fallback: string, fallbackStatus = 400) {
  if (error instanceof ApiError || error instanceof AuthError) {
    return Response.json({ error: error.message }, { status: error.status, headers: error instanceof ApiError ? error.headers : undefined });
  }
  logEvent("error", "api.request_failed", { fallback, status: fallbackStatus }, error);
  return Response.json(
    { error: process.env.NODE_ENV === "production" ? fallback : error instanceof Error ? error.message : fallback },
    { status: fallbackStatus },
  );
}
