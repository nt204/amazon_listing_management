import { z } from "zod";
import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { SHEET_TYPES, isSheetType, syncStoreSheet } from "@/lib/accounting/inventory-sheet-sync";

export const maxDuration = 300;

const syncSchema = z.object({
  store_id: z.string().uuid("Invalid Store ID"),
  sheet_type: z.enum(SHEET_TYPES as [string, ...string[]]),
  trigger: z.enum(["manual", "reload"]).default("manual"),
});

/** Đồng bộ ngay 1 store + 1 loại sheet từ link đã lưu (nút tải lại của tab / nút Đồng bộ). */
export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const actorName = actor.email || actor.displayName || actor.userId || "system";
    const input = syncSchema.parse(await readJsonBody(request, 2_000));
    if (!isSheetType(input.sheet_type)) return Response.json({ error: "sheet_type không hợp lệ" }, { status: 400 });
    const outcome = await syncStoreSheet(input.store_id, input.sheet_type, input.trigger, actorName);
    return Response.json(outcome, { status: outcome.ok || ("skipped" in outcome && outcome.skipped) ? 200 : 422 });
  } catch (error) {
    return routeErrorResponse(error, "Không đồng bộ được Google Sheet.");
  }
}
