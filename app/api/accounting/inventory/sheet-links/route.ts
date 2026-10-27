import { z } from "zod";
import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import {
  SHEET_TYPES,
  deleteSheetLink,
  getServiceAccountEmail,
  isSheetType,
  listSheetLinks,
  saveSheetLink,
} from "@/lib/accounting/inventory-sheet-sync";
import {
  getInventorySheetSchedulerStatus,
  startInventorySheetSyncScheduler,
} from "@/lib/accounting/inventory-sheet-scheduler";

export const maxDuration = 300;

const saveSchema = z.object({
  store_id: z.string().uuid("Invalid Store ID"),
  sheet_type: z.enum(SHEET_TYPES as [string, ...string[]]),
  sheet_url: z.string().trim().url("Link Google Sheet không hợp lệ"),
});

/** Danh sách link Google Sheet của mọi store + email service account để chia sẻ sheet. */
export async function GET(request: Request) {
  try {
    await authorize(request, "read", "accounting");
    startInventorySheetSyncScheduler();
    const links = await listSheetLinks();
    return Response.json({
      links,
      service_account_email: getServiceAccountEmail(),
      schedule: getInventorySheetSchedulerStatus(),
    });
  } catch (error) {
    return routeErrorResponse(error, "Không tải được danh sách link Google Sheet.", 500);
  }
}

/** Lưu link (kiểm tra truy cập, tab, cột) rồi đồng bộ ngay. */
export async function PUT(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const actorName = actor.email || actor.displayName || actor.userId || "system";
    startInventorySheetSyncScheduler();
    const input = saveSchema.parse(await readJsonBody(request, 5_000));
    if (!isSheetType(input.sheet_type)) return Response.json({ error: "sheet_type không hợp lệ" }, { status: 400 });
    const outcome = await saveSheetLink(input.store_id, input.sheet_type, input.sheet_url, actorName);
    return Response.json(outcome, { status: outcome.ok ? 200 : 422 });
  } catch (error) {
    return routeErrorResponse(error, "Không lưu được link Google Sheet.");
  }
}

export async function DELETE(request: Request) {
  try {
    await authorize(request, "write", "accounting");
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id");
    const sheetType = searchParams.get("sheet_type");
    if (!storeId || !isSheetType(sheetType)) {
      return Response.json({ error: "store_id và sheet_type là bắt buộc" }, { status: 400 });
    }
    return Response.json({ success: await deleteSheetLink(storeId, sheetType) });
  } catch (error) {
    return routeErrorResponse(error, "Không xóa được link Google Sheet.");
  }
}
