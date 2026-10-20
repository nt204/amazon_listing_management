import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { importUnifiedAccountingExcel } from "@/lib/accounting/excel-unified-importer";

export const maxDuration = 300; // Cho phép chạy tối đa 5 phút cho file lớn 50,000 dòng
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let tempFilePath: string | null = null;
  try {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json({ error: "Yêu cầu định dạng multipart/form-data" }, { status: 400 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const storeId = formData.get("store_id") as string | null;

    if (!storeId) {
      return NextResponse.json({ error: "Thiếu store_id" }, { status: 400 });
    }

    if (!file) {
      return NextResponse.json({ error: "Không tìm thấy file tải lên" }, { status: 400 });
    }

    // Ghi file upload ra thư mục tạm trên đĩa để stream, không giữ buffer trong RAM
    const tempFileName = `acc_unified_${Date.now()}_${Math.random().toString(36).slice(2)}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    tempFilePath = path.join(os.tmpdir(), tempFileName);

    const fileStream = fs.createWriteStream(tempFilePath);
    const nodeReadable = Readable.fromWeb(file.stream() as any);
    await pipeline(nodeReadable, fileStream);

    console.log(`[UnifiedImportAPI] Đã lưu file tạm lên đĩa: ${tempFilePath} (${(fs.statSync(tempFilePath).size / 1024 / 1024).toFixed(2)} MB)`);

    // Thực hiện import stream từng sheet và flush từng chunk vào PostgreSQL
    const result = await importUnifiedAccountingExcel(tempFilePath, storeId, {
      removeAfterDone: true,
      chunkSize: 1000,
    });

    tempFilePath = null; // Đã được xóa bởi importer

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[UnifiedImportAPI] Lỗi khi nạp file kế toán:", error);
    // Dọn dẹp file tạm nếu còn sót do exception trước khi importer dọn
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
        console.log(`[UnifiedImportAPI] Đã dọn dẹp file tạm sau lỗi: ${tempFilePath}`);
      } catch {}
    }
    return NextResponse.json(
      { error: error.message || "Lỗi khi xử lý file Excel kế toán" },
      { status: 500 }
    );
  }
}
