import { NextRequest, NextResponse } from "next/server";
import { syncLatestFilesForAllStores } from "@/lib/accounting/accounting-file-service";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const type = body.type as string;

    const allowedTypes = ["07_SHIPMENTS", "02_ALL_ORDERS", "05_CAMPAIGNS", "01_PORTFOLIOS"];
    if (!allowedTypes.includes(type)) {
      return NextResponse.json(
        { error: `type không hợp lệ. Chỉ chấp nhận: ${allowedTypes.join(", ")}` },
        { status: 400 }
      );
    }

    const result = await syncLatestFilesForAllStores(type as any);

    const typeLabel =
      type === "07_SHIPMENTS"
        ? "Check Shipment"
        : type === "02_ALL_ORDERS"
        ? "Đầu vào Order"
        : "Báo cáo Ads";
    const message = `Đã tự động nạp file ${typeLabel} mới nhất cho ${result.totalStores} Store (tổng ${result.totalIngested} dòng dữ liệu).`;

    return NextResponse.json({
      ...result,
      message,
    });
  } catch (error: any) {
    console.error("POST /api/accounting/files/sync-latest error:", error);
    return NextResponse.json(
      { error: error.message || "Lỗi khi đồng bộ file mới nhất cho các Store" },
      { status: 500 }
    );
  }
}
