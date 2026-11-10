import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { requireStoreAccess } from "@/lib/accounting/access";
import { importKpiTargetsFromSheet } from "@/lib/accounting/kpi-db";

// Nạp mục tiêu (từng SKU + tổng team) từ file Google Sheet "<STORE> - KẾ HOẠCH KINH DOANH <năm>".
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const body = (await readJsonBody(request, 5_000)) as { store_id?: string; url?: string; dry_run?: boolean };
    const storeId = body?.store_id?.trim();
    const url = body?.url?.trim();
    if (!storeId || !url) return Response.json({ error: "Cần store_id và link Google Sheet." }, { status: 400 });
    await requireStoreAccess(actor, storeId, "FBA", "write");
    const result = await importKpiTargetsFromSheet(storeId, url, actor.displayName || actor.userId, { dryRun: Boolean(body.dry_run) });
    return Response.json(result);
  } catch (error) {
    return routeErrorResponse(error, "Không nạp được mục tiêu.", 500);
  }
}
