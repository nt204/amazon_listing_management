import { z } from "zod";
import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { listInventoryFieldSettings, saveInventoryFieldSetting } from "@/lib/accounting/inventory-db";

const schema = z.object({
  store_id: z.string().uuid(), entity_type: z.enum(["sku", "inbound"]), field_id: z.string().min(1),
  label: z.string().trim().min(1), input_type: z.enum(["text", "select"]),
  options: z.array(z.string()).max(200), allow_custom_value: z.boolean(),
});

export async function GET(request: Request) {
  try {
    await authorize(request, "read", "accounting");
    const storeId = new URL(request.url).searchParams.get("store_id");
    if (!storeId) return Response.json({ error: "store_id is required" }, { status: 400 });
    return Response.json({ settings: await listInventoryFieldSettings(storeId) });
  } catch (error) { return routeErrorResponse(error, "Failed to load field settings.", 500); }
}

export async function PUT(request: Request) {
  try {
    await authorize(request, "write", "accounting");
    const input = schema.parse(await readJsonBody(request, 30_000));
    await saveInventoryFieldSetting(input.store_id, input);
    return Response.json({ success: true });
  } catch (error) { return routeErrorResponse(error, "Failed to save field settings."); }
}
