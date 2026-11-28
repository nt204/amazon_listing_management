import { z } from "zod";
import {
  ApiError,
  authorize,
  dataScope,
  readJsonBody,
  routeErrorResponse,
} from "@/lib/api-guard";
import {
  listSharedMockupPresetVersions,
  restoreSharedMockupPresetVersion,
} from "@/lib/db";

export const runtime = "nodejs";

const presetIdSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{1,160}$/);

const restoreBodySchema = z.object({
  presetId: presetIdSchema,
  versionId: z.string().trim().regex(/^\d{1,18}$/),
});

export async function GET(request: Request) {
  try {
    const scope = dataScope(await authorize(request, "read"));
    const parsed = presetIdSchema.safeParse(
      new URL(request.url).searchParams.get("presetId") || "",
    );
    if (!parsed.success) throw new ApiError("ID phôi mockup không hợp lệ.", 400);
    return Response.json(
      { versions: await listSharedMockupPresetVersions(scope, parsed.data) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải lịch sử phôi mockup.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const scope = dataScope(await authorize(request, "write"));
    const body = restoreBodySchema.parse(await readJsonBody(request, 10_000));
    const versions = await listSharedMockupPresetVersions(scope, body.presetId);
    if (!versions.some((version) => version.id === body.versionId)) {
      throw new ApiError("Không tìm thấy bản lịch sử này.", 404);
    }
    const preset = await restoreSharedMockupPresetVersion(
      scope,
      body.presetId,
      body.versionId,
    );
    return Response.json({ success: true, preset });
  } catch (error) {
    return routeErrorResponse(error, "Không thể khôi phục phôi mockup.");
  }
}
