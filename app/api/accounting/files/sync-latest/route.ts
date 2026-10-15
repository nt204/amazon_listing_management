import { NextRequest, NextResponse } from "next/server";
import { syncLatestFilesForAllStores } from "@/lib/accounting/accounting-file-service";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const type = body.type as string;

    if (type !== "07_SHIPMENTS" && type !== "02_ALL_ORDERS") {
      return NextResponse.json(
        { error: "type không hợp lệ. Chỉ chấp nhận '07_SHIPMENTS' hoặc '02_ALL_ORDERS'." },
        { status: 400 }
      );
    }

    const result = await syncLatestFilesForAllStores(type);

    const typeLabel = type === "07_SHIPMENTS" ? "Check Shipment" : "Đầu vào Order";
    const message = `Đã tự động nạp file ${typeLabel} mới nhất cho ${result.totalStores} Store (tổng ${result.totalIngested} dòng/đơn).`;

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
