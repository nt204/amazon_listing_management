import "server-only";

import { cookies, headers } from "next/headers";
import {
  developmentActor,
  revalidateSessionActor,
  sessionCookie,
  verifySessionToken,
  type RequestActor,
} from "@/lib/auth";
import { getOrCreateCloudflareUser, type AppUserStatus } from "@/lib/db";

export interface ResolvedAuthResult {
  actor: RequestActor | null;
  status: AppUserStatus | "unauthenticated";
  email: string | null;
  requiresAction?: boolean;
}

/**
 * Trích xuất email được Cloudflare Zero Trust (Access) đính kèm vào header
 */
export function extractCloudflareEmail(headersList: Headers): string | null {
  const email =
    headersList.get("cf-access-authenticated-user-email") ||
    headersList.get("Cf-Access-Authenticated-User-Email");
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 3 && trimmed.includes("@") ? trimmed : null;
}

/**
 * Xác định danh tính người dùng từ Cloudflare Access header hoặc session cookie
 */
export async function resolveActorFromHeaders(
  customHeaders?: Headers,
): Promise<ResolvedAuthResult> {
  const headerStore = customHeaders || (await headers());
  const cfEmail = extractCloudflareEmail(headerStore);

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
        return {
          actor,
          status: "approved",
          email: user.username,
        };
      }
      return {
        actor: null,
        status: user.status,
        email: user.username,
        requiresAction: true,
      };
    } catch (err) {
      console.error("Lỗi khi xác thực Cloudflare user:", err);
    }
  }

  // 2. Kiểm tra session cookie (nếu trước đó đã có session)
  try {
    const cookieStore = await cookies();
    const sessionVal = cookieStore.get(sessionCookie.name)?.value;
    const decodedActor = verifySessionToken(sessionVal);
    const sessionActor = decodedActor ? await revalidateSessionActor(decodedActor) : null;
    if (sessionActor) {
      return {
        actor: sessionActor,
        status: "approved",
        email: sessionActor.email || sessionActor.userId,
      };
    }
  } catch {
    // cookies() có thể không khả dụng trong một số context
  }

  // 3. Chỉ local/dev mới được dùng admin mặc định. Production phải có
  // Cloudflare Access identity hoặc một session hợp lệ.
  if (process.env.NODE_ENV !== "production") {
    const devActor = developmentActor();
    return {
      actor: devActor,
      status: "approved",
      email: devActor.email || "ndtrince@gmail.com",
    };
  }

  return { actor: null, status: "unauthenticated", email: null };
}
