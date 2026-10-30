import ExcelJS from "exceljs";
import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { requireStoreAccess } from "@/lib/accounting/access";
import {
  importSkuMasterFromWorkbook,
  importInboundShipmentsFromWorkbook,
  importCheckShipmentsFromWorkbook,
  importCheckShipmentsFromCsv,
  importMonthlyBaseCostFromWorkbook,
  parseSkuChannel,
  processAndSaveImportTemplate,
} from "@/lib/accounting/inventory-db";
import { getStoreById } from "@/lib/accounting/accounting-db";

export const maxDuration = 300; // Workbook kế toán đầy đủ có thể lớn hàng trăm MB sau giải nén.

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const actorName = actor.email || actor.displayName || actor.userId || "system";

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
    const channel = parseSkuChannel(formData.get("channel"));
    const file = formData.get("file") as File | null;

    if (!storeId) {
      return Response.json({ error: "Thiếu store_id" }, { status: 400 });
    }
    // Chỉ Bảng mã có kênh FBM; đi hàng / check shipment / base cost là FBA
    await requireStoreAccess(actor, storeId, type === "sku" && channel === "fbm" ? "FBM" : "FBA", "write");

    if (!file) {
      return Response.json({ error: "Vui lòng chọn file" }, { status: 400 });
    }

    const store = await getStoreById(storeId);
    if (!store) {
      return Response.json({ error: "Không tìm thấy Store" }, { status: 404 });
    }

    const fileName = (file.name || "").toLowerCase();
    const isCsv =
      fileName.endsWith(".csv") ||
      file.type.includes("csv") ||
      file.type.includes("text/plain");

    if (isCsv) {
      const text = await file.text();
      if (type === "check_shipment") {
        const result = await importCheckShipmentsFromCsv(storeId, text);
        return Response.json({
          success: true,
          type: "check_shipment",
          store_name: store.name,
          count: result.count,
          created_count: result.createdCount,
          updated_count: result.updatedCount,
          cascade_updated_count: result.cascadeUpdatedCount,
          errors: result.errors.slice(0, 20),
          total_errors: result.errors.length,
        });
      }
      return Response.json(
        { error: "Định dạng file CSV hiện tại áp dụng cho bảng CHECK SHIPMENT AMAZON." },
        { status: 400 },
      );
    }

    const workbook = new ExcelJS.Workbook();
    const buffer = Buffer.from(await file.arrayBuffer());
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

    // Lưu template cho store (BẢNG MÃ FBM import riêng, không ghi đè template BẢNG MÃ FBA)
    if (channel === "fba") {
      await processAndSaveImportTemplate(
        storeId,
        type === "inbound" ? "inbound" : type === "check_shipment" ? "check_shipment" : "sku",
        file.name,
        buffer,
        workbook,
      );
    }

    if (type === "check_shipment") {
      const result = await importCheckShipmentsFromWorkbook(storeId, workbook);
      return Response.json({
        success: true,
        type: "check_shipment",
        store_name: store.name,
        count: result.count,
        created_count: result.createdCount,
        updated_count: result.updatedCount,
        cascade_updated_count: result.cascadeUpdatedCount,
        errors: result.errors.slice(0, 20),
        total_errors: result.errors.length,
      });
    }

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

    if (type === "monthly_base_cost") {
      const year = parseInt((formData.get("year") as string) || "2026", 10) || 2026;
      const result = await importMonthlyBaseCostFromWorkbook(storeId, workbook, year, actorName);
      return Response.json({
        success: true,
        type: "monthly_base_cost",
        store_name: store.name,
        count: result.count,
        updated_initial_count: result.updatedInitialCount,
        overridden_month_count: result.overriddenMonthCount,
        errors: result.errors.slice(0, 20),
        total_errors: result.errors.length,
      });
    }

    // Mặc định type === "sku"
    const result = await importSkuMasterFromWorkbook(storeId, workbook, channel, actorName);
    return Response.json({
      success: true,
      type: "sku",
      channel,
      store_name: store.name,
      count: result.count,
      errors: result.errors.slice(0, 20),
      total_errors: result.errors.length,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi import file Excel.");
  }
}
