import { z } from "zod";
import { ApiError, authorize, dataScope, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { clearR2BackedImageBytes, getImageStorageStats } from "@/lib/db";
import { objectStorageDriver } from "@/lib/object-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cleanupSchema = z.object({
  action: z.literal("clear-r2-backed-db-image-bytes"),
  confirmation: z.literal("XOA ANH DB"),
}).strict();

export async function GET(request: Request) {
  try {
    const actor = authorize(request, "read");
    if (actor.role !== "admin") throw new ApiError("Bạn không có quyền quản trị lưu trữ.", 403);
    return Response.json({
      driver: objectStorageDriver(),
      stats: await getImageStorageStats(actor.teamId),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải thống kê lưu trữ.");
  }
}

export async function POST(request: Request) {
  try {
    const actor = authorize(request, "manage_storage");
    cleanupSchema.parse(await readJsonBody(request, 4_000));
    if (objectStorageDriver() !== "r2") {
      throw new ApiError("Chỉ được xóa byte ảnh trong DB khi R2 đang là object storage chính.", 409);
    }
    const result = await clearR2BackedImageBytes(dataScope(actor));
    return Response.json({ success: true, ...result });
  } catch (error) {
    return routeErrorResponse(error, "Không thể dọn bản sao ảnh trong database.");
  }
}
