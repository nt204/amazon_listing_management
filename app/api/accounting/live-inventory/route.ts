// Nạp tồn kho real time (FBA / AWD) do crawler kế toán 16h10 gửi lên — xem lib/accounting/live-inventory.ts.
// multipart: file, store_id, source = FBA | AWD
import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { requireStoreAccess } from "@/lib/accounting/access";
import {
  parseAwdInventoryReport,
  parseFbaInventoryReport,
  replaceLiveInventory,
  type LiveInventorySource,
} from "@/lib/accounting/live-inventory";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const storeId = String(formData.get("store_id") || "").trim();
    const source = String(formData.get("source") || "").trim().toUpperCase() as LiveInventorySource;
    if (!file || !storeId) return Response.json({ error: "Thiếu file hoặc store_id." }, { status: 400 });
    if (source !== "FBA" && source !== "AWD") return Response.json({ error: "source phải là FBA hoặc AWD." }, { status: 400 });

    await requireStoreAccess(actor, storeId, "FBA", "write");
    const text = await file.text();
    let parsed;
    try {
      parsed = source === "FBA" ? parseFbaInventoryReport(text) : parseAwdInventoryReport(text);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
    const result = await replaceLiveInventory(storeId, source, parsed, file.name);
    return Response.json({
      success: true,
      message: `Đã nạp tồn ${source}: ${result.rows} SKU, ${result.totalUnits} units.`,
      data: { ...result, reportLabel: parsed.reportLabel },
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi nạp tồn kho real time.", 500);
  }
}
