import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { requireStoreAccess } from "@/lib/accounting/access";
import { importFbmTargetsFromSheet } from "@/lib/accounting/kpi-fbm-targets";

export const runtime = "nodejs";

// Nạp KPI tháng kênh FBM từ file "FBM - <STORE> - KẾ HOẠCH KINH DOANH" (Google Sheet chia sẻ cho bot).
// POST { store_id, url, dry_run? } — chỉ admin / kế toán.
export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    if (actor.role !== "admin" && actor.role !== "accountant") {
      return Response.json({ error: "Chỉ admin hoặc kế toán được nạp KPI FBM." }, { status: 403 });
    }
    const body = (await readJsonBody(request, 4_000)) as { store_id?: string; url?: string; dry_run?: boolean };
    const storeId = body?.store_id?.trim();
    const url = body?.url?.trim();
    if (!storeId || !url) return Response.json({ error: "Cần store_id và url." }, { status: 400 });
    await requireStoreAccess(actor, storeId, "FBM", "write");
    const result = await importFbmTargetsFromSheet(storeId, url, actor.displayName || actor.userId, { dryRun: Boolean(body.dry_run) });
    return Response.json(result);
  } catch (error) {
    return routeErrorResponse(error, "Không nạp được KPI FBM.", 500);
  }
}
