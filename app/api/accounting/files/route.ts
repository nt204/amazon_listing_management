import { authorize, routeErrorResponse } from "@/lib/api-guard";
import {
  listManagedAccountingFiles,
  ingestAccountingFile,
  uploadAccountingFileToR2,
  detectFileType,
} from "@/lib/accounting/accounting-file-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await authorize(request, "read", "accounting");
    const url = new URL(request.url);
    const storeName = url.searchParams.get("storeName") || undefined;
    const reportDate = url.searchParams.get("date") || undefined;

    const data = await listManagedAccountingFiles({ storeName, reportDate });

    return Response.json({
      success: true,
      data,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy danh sách file báo cáo kế toán.", 500);
  }
}

export async function POST(request: Request) {
  try {
    await authorize(request, "write", "accounting");
    const contentType = request.headers.get("content-type") || "";

    // 1. Upload file mới từ giao diện người dùng
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      const storeName = (formData.get("storeName") as string | null)?.trim().toUpperCase();
      let reportDate = (formData.get("reportDate") as string | null)?.trim();
      const fileTypeCode = (formData.get("fileTypeCode") as string | null)?.trim();

      if (!file || !storeName) {
        return Response.json({ error: "Thiếu file hoặc tên Store." }, { status: 400 });
      }

      if (!reportDate) {
        reportDate = new Date().toISOString().slice(0, 10);
      }

      const originalName = file.name;
      const detected = detectFileType(originalName);
      let standardFileName = originalName;

      // Nếu là Inventory Ledger hoặc mã số tải về từ Amazon
      if (
        fileTypeCode === "09_INVENTORY_LEDGER" ||
        detected.code === "09_INVENTORY_LEDGER" ||
        /^\d{8,}\.(csv|tsv|txt)$/i.test(originalName) ||
        originalName.toLowerCase().includes("ledger")
      ) {
        standardFileName = `09_InventoryLedger_${reportDate}.csv`;
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const { r2Key } = await uploadAccountingFileToR2(
        buffer,
        storeName,
        reportDate,
        standardFileName
      );

      // Tự động nạp dữ liệu vào Database nếu là loại file có thể nạp
      let ingestResult = null;
      try {
        ingestResult = await ingestAccountingFile(r2Key, storeName);
      } catch (ingestErr: any) {
        console.warn(`[File Upload] Nạp dữ liệu tự động gặp cảnh báo:`, ingestErr?.message);
      }

      return Response.json({
        success: true,
        message: `Đã lưu file '${standardFileName}' vào Quản lý file trên R2!${
          ingestResult?.message ? ` ${ingestResult.message}` : ""
        }`,
        data: {
          r2Key,
          fileName: standardFileName,
          storeName,
          reportDate,
          ingestResult,
        },
      });
    }

    // 2. Nạp lại file có sẵn
    const body = await request.json().catch(() => ({}));
    const action = body.action || "ingest";

    if (action === "ingest") {
      const { r2Key, storeName } = body;
      if (!r2Key || !storeName) {
        return Response.json({ error: "Thiếu r2Key hoặc storeName." }, { status: 400 });
      }

      const result = await ingestAccountingFile(r2Key, storeName);
      return Response.json({
        success: true,
        data: result,
      });
    }

    return Response.json({ error: "Hành động không hợp lệ." }, { status: 400 });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi xử lý file kế toán.", 500);
  }
}
