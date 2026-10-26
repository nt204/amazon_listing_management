import { z } from "zod";
import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { getUiPreferences, saveUiPreferences } from "@/lib/ui-preferences";

export const runtime = "nodejs";

const patchSchema = z.object({
  sidebarDark: z.boolean().optional(),
});

export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read");
    return Response.json({ preferences: await getUiPreferences(actor) });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải tùy chỉnh giao diện.", 500);
  }
}

// Tùy chỉnh cá nhân: tài khoản chỉ có quyền đọc vẫn được lưu giao diện của chính mình.
export async function PUT(request: Request) {
  try {
    const actor = await authorize(request, "read");
    const patch = patchSchema.parse(await readJsonBody(request, 2_000));
    return Response.json({ preferences: await saveUiPreferences(actor, patch) });
  } catch (error) {
    return routeErrorResponse(error, "Không thể lưu tùy chỉnh giao diện.", 400);
  }
}
