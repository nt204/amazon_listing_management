import { authorize, routeErrorResponse } from "@/lib/api-guard";
import {
  listManagedAccountingFiles,
  ingestAccountingFile,
} from "@/lib/accounting/accounting-file-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await authorize(request, "read", "accounting");
    const url = new URL(request.url);
    const storeName = url.searchParams.get("storeName") || undefined;
    const reportDate = url.searchParams.get("date") || undefined;

    const data = await listManagedAccountingFiles({ storeName, reportDate });

    return Response.json({
      success: true,
      data,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy danh sách file báo cáo kế toán.", 500);
  }
}

export async function POST(request: Request) {
  try {
    await authorize(request, "write", "accounting");
    const body = await request.json().catch(() => ({}));
    const action = body.action || "ingest";

    if (action === "ingest") {
      const { r2Key, storeName } = body;
      if (!r2Key || !storeName) {
        return Response.json({ error: "Thiếu r2Key hoặc storeName." }, { status: 400 });
      }

      const result = await ingestAccountingFile(r2Key, storeName);
      return Response.json({
        success: true,
        data: result,
      });
    }

    return Response.json({ error: "Hành động không hợp lệ." }, { status: 400 });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi xử lý file kế toán.", 500);
  }
}
