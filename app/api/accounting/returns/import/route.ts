import { NextRequest, NextResponse } from "next/server";
import { parseReturnBuffer, batchUpsertReturns } from "@/lib/accounting/returns-db";
import { assertRowsInsideCoverage, normalizeImportCoverage } from "@/lib/accounting/import-coverage";

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
      const coverage = normalizeImportCoverage(formData.get("coverage_start"), formData.get("coverage_end"));

      if (!storeId) {
        return NextResponse.json({ error: "Missing store_id" }, { status: 400 });
      }

      if (!file) {
        return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const parsedRows = await parseReturnBuffer(buffer, file.name, storeId);

      if (parsedRows.length === 0 && !coverage) {
        return NextResponse.json(
          {
            error:
              "Không tìm thấy dòng dữ liệu Return hợp lệ trong file tải lên. Hãy kiểm tra định dạng file (file 03 Returns hoặc Excel có sheet RETURN).",
          },
          { status: 400 }
        );
      }

      assertRowsInsideCoverage(parsedRows, coverage);
      const result = await batchUpsertReturns(storeId, parsedRows, { snapshot: "dates", coverage });

      return NextResponse.json({
        success: true,
        totalParsed: parsedRows.length,
        processed: result.count,
        message: `Đã nạp thành công ${result.count} dòng Return & Hoàn tiền vào hệ thống!`,
      });
    }

    // 2. Direct JSON payload
    const body = await request.json();
    const { store_id, rows, coverage_start, coverage_end } = body;
    const coverage = normalizeImportCoverage(coverage_start, coverage_end);

    if (!store_id || !Array.isArray(rows)) {
      return NextResponse.json(
        { error: "Invalid payload: store_id and rows array required" },
        { status: 400 }
      );
    }

    if (rows.length === 0 && !coverage) {
      return NextResponse.json(
        { error: "Không có dòng dữ liệu hợp lệ để xử lý" },
        { status: 400 }
      );
    }

    assertRowsInsideCoverage(rows, coverage);
    const result = await batchUpsertReturns(store_id, rows, { snapshot: "dates", coverage });

    return NextResponse.json({
      success: true,
      totalParsed: rows.length,
      processed: result.count,
      message: `Đã nạp thành công ${result.count} dòng Return & Hoàn tiền vào hệ thống!`,
    });
  } catch (error: any) {
    console.error("POST /api/accounting/returns/import error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to import return file" },
      { status: 500 }
    );
  }
}
