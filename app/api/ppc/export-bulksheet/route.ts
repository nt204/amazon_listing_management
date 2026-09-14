import { authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { exportBulksheetUpdateExcel } from "@/lib/ppc/service";
import type { PpcRecommendation } from "@/lib/ppc/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    authorize(request, "export");
    enforceRequestSize(request);

    const body = await request.json();
    const recommendations: PpcRecommendation[] = Array.isArray(body?.recommendations)
      ? body.recommendations
      : [];

    if (recommendations.length === 0) {
      return Response.json({ error: "Không có đề xuất nào được chọn để xuất file." }, { status: 400 });
    }

    const buffer = await exportBulksheetUpdateExcel(recommendations);
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const fileName = `Amazon_Bulksheet_Update_${dateStr}.xlsx`;

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi xuất file Bulksheet Update.", 500);
  }
}
