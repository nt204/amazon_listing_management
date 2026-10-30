import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { requireStoreAccess } from "@/lib/accounting/access";
import {
  parseInventoryLedgerContent,
  ingestInventoryLedgerRows,
  getLatestInventoryBalances,
} from "@/lib/accounting/inventory-ledger-db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "accounting");
    const url = new URL(request.url);
    const storeId = url.searchParams.get("store_id");
    if (!storeId) {
      return Response.json({ error: "Thiếu store_id." }, { status: 400 });
    }

    await requireStoreAccess(actor, storeId, "FBA");
    const balances = await getLatestInventoryBalances(storeId);
    return Response.json({
      success: true,
      data: balances,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy dữ liệu tồn kho.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      const storeId = formData.get("store_id") as string | null;
      if (!file || !storeId) {
        return Response.json({ error: "Thiếu file hoặc store_id." }, { status: 400 });
      }

      const text = await file.text();
      const rows = parseInventoryLedgerContent(text);
      if (rows.length === 0) {
        return Response.json({ error: "File không có dòng Inventory Ledger hợp lệ (cần cột MSKU/ASIN)." }, { status: 400 });
      }
      // Nhập tay không truyền ngày: lấy cột Date trong file (ngày chốt sổ của báo cáo)
      const snapshotDate =
        (formData.get("snapshot_date") as string | null) || rows[0].date || new Date().toISOString().slice(0, 10);
      await requireStoreAccess(actor, storeId, "FBA", "write");
      const result = await ingestInventoryLedgerRows(storeId, rows, snapshotDate, file.name);

      return Response.json({
        success: true,
        message: `Đã nạp tồn kho thành công (${result.insertedCount} dòng, ${result.updatedSkuMasterCount} SKU).`,
        data: result,
      });
    }

    const body = await request.json().catch(() => ({}));
    const { storeId, content, snapshotDate, fileName } = body;
    if (!storeId || !content) {
      return Response.json({ error: "Thiếu storeId hoặc content." }, { status: 400 });
    }

    const effectiveDate = snapshotDate || new Date().toISOString().slice(0, 10);
    const rows = parseInventoryLedgerContent(content);
    await requireStoreAccess(actor, storeId, "FBA", "write");
    const result = await ingestInventoryLedgerRows(storeId, rows, effectiveDate, fileName);

    return Response.json({
      success: true,
      message: `Đã nạp tồn kho thành công (${result.insertedCount} dòng, ${result.updatedSkuMasterCount} SKU).`,
      data: result,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi nạp dữ liệu tồn kho.", 500);
  }
}
