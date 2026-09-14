import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { resetPpcToMockData } from "@/lib/ppc/service";
import { createMockAmazonSearchTermExcel } from "@/lib/ppc/mock-data-generator";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const scope = dataScope(authorize(request, "manage_storage"));
    if (process.env.NODE_ENV === "production") {
      throw new ApiError("Không được phép nạp dữ liệu mẫu trong production.", 403);
    }
    await resetPpcToMockData(scope);
    return Response.json({
      success: true,
      message: "Đã nạp lại dữ liệu mẫu PPC chuẩn Amazon Ads thành công!",
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi nạp dữ liệu mẫu.", 500);
  }
}

// GET để tải về file Excel mẫu đúng định dạng Amazon Ads của Bozspacer
export async function GET(request: Request) {
  try {
    authorize(request, "read");
    const { searchParams } = new URL(request.url);
    const storeName = (searchParams.get("storeName") || "Bozspacer").trim();
    if (!storeName || storeName.length > 80) throw new ApiError("Tên store không hợp lệ.", 400);
    const excelBuffer = await createMockAmazonSearchTermExcel(storeName);

    return new Response(new Uint8Array(excelBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="ppc-search-term-sample.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi tạo file Excel mẫu.", 500);
  }
}
