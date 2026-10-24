import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { enqueueAccountingImport, getAccountingImport } from "@/lib/accounting/import-jobs";
import { ApiError, authorize, dataScope, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";

export const maxDuration = 300; // Cho phép chạy tối đa 5 phút cho file lớn 50,000 dòng
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const scope = dataScope(await authorize(request, "read", "accounting"));
    const jobId = request.nextUrl.searchParams.get("jobId")?.trim();
    if (!jobId) throw new ApiError("Thiếu jobId.", 400);
    const job = await getAccountingImport(scope, jobId);
    if (!job) throw new ApiError("Không tìm thấy job nạp dữ liệu.", 404);
    return NextResponse.json({ success: job.status === "COMPLETED", job });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi đọc trạng thái nạp dữ liệu.", 500);
  }
}

export async function POST(request: NextRequest) {
  let tempFilePath: string | null = null;
  try {
    const scope = dataScope(await authorize(request, "write", "accounting"));
    enforceRequestSize(request);
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
    const nodeReadable = Readable.fromWeb(file.stream() as unknown as NodeReadableStream);
    await pipeline(nodeReadable, fileStream);

    console.log(`[UnifiedImportAPI] Đã lưu file tạm lên đĩa: ${tempFilePath} (${(fs.statSync(tempFilePath).size / 1024 / 1024).toFixed(2)} MB)`);

    const job = await enqueueAccountingImport(scope, {
      storeId,
      fileName: file.name,
      filePath: tempFilePath,
      fileSize: file.size,
    });
    tempFilePath = null; // Worker chịu trách nhiệm dọn file sau khi xử lý.

    return NextResponse.json({
      success: true,
      accepted: true,
      message: "File đã tải lên. Hệ thống đang nạp dữ liệu ở chế độ nền.",
      job,
    }, { status: 202 });
  } catch (error: unknown) {
    console.error("[UnifiedImportAPI] Lỗi khi nạp file kế toán:", error);
    // Dọn dẹp file tạm nếu còn sót do exception trước khi importer dọn
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
        console.log(`[UnifiedImportAPI] Đã dọn dẹp file tạm sau lỗi: ${tempFilePath}`);
      } catch {}
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lỗi khi xử lý file Excel kế toán" },
      { status: 500 }
    );
  }
}
