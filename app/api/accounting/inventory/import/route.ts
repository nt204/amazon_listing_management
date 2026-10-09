import ExcelJS from "exceljs";
import { authorize, routeErrorResponse } from "@/lib/api-guard";
import {
  importSkuMasterFromWorkbook,
  importInboundShipmentsFromWorkbook,
  processAndSaveImportTemplate,
} from "@/lib/accounting/inventory-db";
import { getStoreById } from "@/lib/accounting/accounting-db";

export const maxDuration = 120; // Cho phép đủ thời gian cho file Excel lớn

export async function POST(request: Request) {
  try {
    await authorize(request, "write", "accounting");

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return Response.json(
        { error: "Vui lòng gửi file dưới định dạng multipart/form-data." },
        { status: 400 },
      );
    }

    const formData = await request.formData();
    const storeId = formData.get("store_id") as string | null;
    const type = (formData.get("type") as string | null) || "sku";
    const file = formData.get("file") as File | null;

    if (!storeId) {
      return Response.json({ error: "Thiếu store_id" }, { status: 400 });
    }

    if (!file) {
      return Response.json({ error: "Vui lòng chọn file Excel" }, { status: 400 });
    }

    const store = await getStoreById(storeId);
    if (!store) {
      return Response.json({ error: "Không tìm thấy Store" }, { status: 404 });
    }

    const workbook = new ExcelJS.Workbook();
    const buffer = Buffer.from(await file.arrayBuffer());
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

    // Cách 1: Tự động lưu bộ khung template của file gốc cho Store
    await processAndSaveImportTemplate(
      storeId,
      type === "inbound" ? "inbound" : "sku",
      file.name,
      buffer,
      workbook,
    );

    if (type === "inbound") {
      const result = await importInboundShipmentsFromWorkbook(storeId, workbook);
      return Response.json({
        success: true,
        type: "inbound",
        store_name: store.name,
        count: result.count,
        errors: result.errors.slice(0, 20),
        total_errors: result.errors.length,
      });
    }

    // Mặc định type === "sku"
    const result = await importSkuMasterFromWorkbook(storeId, workbook);
    return Response.json({
      success: true,
      type: "sku",
      store_name: store.name,
      count: result.count,
      errors: result.errors.slice(0, 20),
      total_errors: result.errors.length,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi import file Excel.");
  }
}
