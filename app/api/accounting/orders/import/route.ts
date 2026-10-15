import { NextRequest, NextResponse } from "next/server";
import { parseOrdersBuffer, batchUpsertOrders, normalizeOrderRow } from "@/lib/accounting/orders-db";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";

    // 1. Multipart Form Data (file upload)
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      const storeId = formData.get("store_id") as string | null;

      if (!storeId) {
        return NextResponse.json({ error: "Missing store_id" }, { status: 400 });
      }

      if (!file) {
        return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const parsedOrders = await parseOrdersBuffer(buffer, file.name, storeId);

      if (parsedOrders.length === 0) {
        return NextResponse.json(
          { error: "Không tìm thấy dòng dữ liệu đơn hàng hợp lệ trong file tải lên. Vui lòng kiểm tra lại định dạng file." },
          { status: 400 }
        );
      }

      const result = await batchUpsertOrders(storeId, parsedOrders);

      return NextResponse.json({
        success: true,
        totalParsed: parsedOrders.length,
        processed: result.count,
        message: `Đã nạp thành công ${result.count} đơn hàng vào hệ thống!`,
      });
    }

    // 2. Direct JSON payload
    const body = await request.json();
    const { store_id, rows } = body;

    if (!store_id || !Array.isArray(rows)) {
      return NextResponse.json({ error: "Invalid payload: store_id and rows required" }, { status: 400 });
    }

    const normalizedRows = rows
      .map((r) => normalizeOrderRow(r, store_id))
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (normalizedRows.length === 0) {
      return NextResponse.json({ error: "Không có dòng dữ liệu hợp lệ để xử lý" }, { status: 400 });
    }

    const result = await batchUpsertOrders(store_id, normalizedRows);

    return NextResponse.json({
      success: true,
      totalParsed: normalizedRows.length,
      processed: result.count,
      message: `Đã cập nhật ${result.count} đơn hàng thành công!`,
    });
  } catch (error: any) {
    console.error("POST /api/accounting/orders/import error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to import orders" },
      { status: 500 }
    );
  }
}
