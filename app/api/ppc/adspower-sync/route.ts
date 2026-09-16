import { authorize, dataScope, enforceRateLimit, routeErrorResponse } from "@/lib/api-guard";
import { syncPpcFromAdsPower } from "@/lib/ppc/adspower-service";
import { canonicalStoreName } from "@/lib/ppc/service";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const actor = authorize(request, "write");
    await enforceRateLimit(actor, "ppc-adspower-sync", 5, 60);
    
    let storeName = "HSOSTORE";
    let profileId: string | undefined = undefined;
    try {
      const body = await request.json().catch(() => ({}));
      if (body && typeof body === "object") {
        if ("storeName" in body && typeof body.storeName === "string") {
          storeName = canonicalStoreName(body.storeName);
        }
        if ("profileId" in body && typeof body.profileId === "string") {
          profileId = body.profileId.trim() || undefined;
        }
      }
    } catch {
      // Dùng default
    }

    const result = await syncPpcFromAdsPower(dataScope(actor), { storeName, profileId });

    return Response.json({
      success: result.success,
      message: result.message,
      result,
    });
  } catch (error) {
    console.error("[AdsPower Sync API Error]:", error);
    return routeErrorResponse(
      error,
      error instanceof Error ? error.message : "Lỗi khi đồng bộ từ AdsPower.",
      500,
    );
  }
}
