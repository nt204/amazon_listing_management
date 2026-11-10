import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { requireStoreAccess } from "@/lib/accounting/access";
import { importKpiHistoryFromSheet } from "@/lib/accounting/kpi-db";

// Nạp số năm trước (từng SKU, từng tháng) từ file Google Sheet "TỔNG KẾT CUỐI THÁNG_<STORE> <năm>".
// Sheet phải chia sẻ quyền Người xem cho service account.
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const body = (await readJsonBody(request, 5_000)) as { store_id?: string; url?: string; year?: number; dry_run?: boolean };
    const storeId = body?.store_id?.trim();
    const url = body?.url?.trim();
    if (!storeId || !url) return Response.json({ error: "Cần store_id và link Google Sheet." }, { status: 400 });
    const year = body.year == null ? undefined : Number(body.year);
    if (year !== undefined && (!Number.isInteger(year) || year < 2015 || year > 2100)) {
      return Response.json({ error: "Năm không hợp lệ." }, { status: 400 });
    }
    await requireStoreAccess(actor, storeId, "FBA", "write");
    const result = await importKpiHistoryFromSheet(storeId, url, actor.displayName || actor.userId, { year, dryRun: Boolean(body.dry_run) });
    return Response.json(result);
  } catch (error) {
    return routeErrorResponse(error, "Không nạp được số năm trước.", 500);
  }
}
