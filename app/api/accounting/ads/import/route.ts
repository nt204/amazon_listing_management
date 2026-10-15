import { NextRequest, NextResponse } from "next/server";
import { parseAdsBuffer, batchUpsertAds } from "@/lib/accounting/ads-db";

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
      const parsedRows = await parseAdsBuffer(buffer, file.name, storeId);

      if (parsedRows.length === 0) {
        return NextResponse.json(
          {
            error:
              "Không tìm thấy dòng dữ liệu chi phí Ads hợp lệ trong file tải lên. Hãy kiểm tra định dạng file (file 05 Portfolios hoặc Excel có sheet ADS).",
          },
          { status: 400 }
        );
      }

      const result = await batchUpsertAds(storeId, parsedRows);

      return NextResponse.json({
        success: true,
        totalParsed: parsedRows.length,
        processed: result.count,
        message: `Đã nạp thành công ${result.count} dòng chi phí Ads vào hệ thống!`,
      });
    }

    // 2. Direct JSON payload
    const body = await request.json();
    const { store_id, rows } = body;

    if (!store_id || !Array.isArray(rows)) {
      return NextResponse.json(
        { error: "Invalid payload: store_id and rows array required" },
        { status: 400 }
      );
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Không có dòng dữ liệu hợp lệ để xử lý" },
        { status: 400 }
      );
    }

    const result = await batchUpsertAds(store_id, rows);

    return NextResponse.json({
      success: true,
      totalParsed: rows.length,
      processed: result.count,
      message: `Đã nạp thành công ${result.count} dòng chi phí Ads vào hệ thống!`,
    });
  } catch (error: any) {
    console.error("POST /api/accounting/ads/import error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to import ads file" },
      { status: 500 }
    );
  }
}
