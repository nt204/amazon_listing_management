// app/api/ppc/search-volume/import/route.ts
import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { importSearchVolumeFromExcel } from "@/lib/ppc/search-volume";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await authorize(request, "write", "ppc");
    enforceRequestSize(request, 25_000_000);

    const formData = await request.formData();
    const file = formData.get("file") || formData.get("excel");
    const marketplace = (formData.get("marketplace") as string) || "US";
    const defaultAsin = (formData.get("asin") as string) || undefined;

    if (!(file instanceof File)) {
      throw new ApiError("Vui lòng tải lên một file Excel (.xlsx).", 400);
    }

    if (file.size > 25_000_000) {
      throw new ApiError("Kích thước file vượt quá giới hạn cho phép (25MB).", 413);
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = await importSearchVolumeFromExcel(buffer, {
      marketplace,
      defaultAsin,
    });

    return Response.json({
      success: true,
      message: `Đã nạp thành công ${result.importedVolumes.toLocaleString()} Search Volume và ${result.importedRankings.toLocaleString()} Ranking!`,
      importedVolumes: result.importedVolumes,
      importedRankings: result.importedRankings,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi nạp file Search Volume.", 500);
  }
}
