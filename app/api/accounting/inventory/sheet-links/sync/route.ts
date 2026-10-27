import { z } from "zod";
import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import {
  LINK_TYPES,
  SHEET_TYPES,
  isLinkType,
  isSheetType,
  linkTypeOfPart,
  syncStoreLink,
} from "@/lib/accounting/inventory-sheet-sync";

export const maxDuration = 300;

const syncSchema = z
  .object({
    store_id: z.string().uuid("Invalid Store ID"),
    // Nút tải lại của tab: chỉ đồng bộ đúng tab đó (sku | inbound | sku_fbm)
    sheet_type: z.enum(SHEET_TYPES as [string, ...string[]]).optional(),
    // Nút Đồng bộ ở System Admin: đồng bộ cả file (inventory | fbm)
    link_type: z.enum(LINK_TYPES as [string, ...string[]]).optional(),
    trigger: z.enum(["manual", "reload"]).default("manual"),
  })
  .refine((data) => Boolean(data.sheet_type || data.link_type), { message: "Cần sheet_type hoặc link_type" });

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const actorName = actor.email || actor.displayName || actor.userId || "system";
    const input = syncSchema.parse(await readJsonBody(request, 2_000));
    const part = isSheetType(input.sheet_type) ? input.sheet_type : undefined;
    const linkType = part ? linkTypeOfPart(part) : isLinkType(input.link_type) ? input.link_type : null;
    if (!linkType) return Response.json({ error: "Tham số không hợp lệ" }, { status: 400 });
    const outcome = await syncStoreLink(input.store_id, { linkType, part }, input.trigger, actorName);
    return Response.json(outcome, { status: outcome.ok || outcome.skipped ? 200 : 422 });
  } catch (error) {
    return routeErrorResponse(error, "Không đồng bộ được Google Sheet.");
  }
}
