// app/api/ppc/search-volume/route.ts
import { after } from "next/server";
import { authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { getSearchVolumeStatus, startSearchVolumeSync, stopSearchVolumeSync } from "@/lib/ppc/search-volume";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const scope = dataScope(await authorize(request, "read", "ppc"));
    const storeName = new URL(request.url).searchParams.get("storeName") || "ALL";
    const data = await getSearchVolumeStatus(scope.teamId, storeName);
    return Response.json({ success: true, data });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy trạng thái Search Volume.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const scope = dataScope(await authorize(request, "write", "ppc"));
    const body = await request.json().catch(() => ({}));
    const storeName = String(body?.storeName || "ALL");

    const { runId, execute } = await startSearchVolumeSync({
      teamId: scope.teamId,
      storeName,
      actorId: scope.actorId,
    });
    // Mỗi lượt Helium 10 mất 5–20s → chạy nền, client poll GET để xem tiến độ
    after(execute);

    return Response.json({
      success: true,
      message: "Đã bắt đầu đồng bộ Search Volume từ Helium 10.",
      data: { runId },
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi đồng bộ Search Volume.", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const scope = dataScope(await authorize(request, "write", "ppc"));
    const url = new URL(request.url);
    const runId = url.searchParams.get("runId") || undefined;
    const result = await stopSearchVolumeSync({
      teamId: scope.teamId,
      runId,
    });
    return Response.json({
      success: true,
      message: "Đã yêu cầu dừng tiến trình đồng bộ Search Volume.",
      data: result,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi dừng đồng bộ Search Volume.", 500);
  }
}
