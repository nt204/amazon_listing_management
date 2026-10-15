import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { getAccountingDownloadUrl } from "@/lib/accounting/accounting-file-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await authorize(request, "read", "accounting");
    const url = new URL(request.url);
    const r2Key = url.searchParams.get("r2Key");
    const fileName = url.searchParams.get("fileName") || undefined;

    if (!r2Key) {
      return Response.json({ error: "Thiếu r2Key." }, { status: 400 });
    }

    const downloadUrl = await getAccountingDownloadUrl(r2Key, fileName);
    if (!downloadUrl) {
      return Response.json({ error: "Không thể tạo liên kết tải file." }, { status: 404 });
    }

    return Response.json({
      success: true,
      downloadUrl,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy đường dẫn tải file.", 500);
  }
}
