import ExcelJS from "exceljs";
import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { getStoreById } from "@/lib/accounting/accounting-db";
import { LEDGER_EVENT_COLUMNS, getInventoryStockSnapshot } from "@/lib/accounting/inventory-ledger-db";

export const runtime = "nodejs";

/** Xuất Excel tab TỒN KHO: cột giống file Inventory Ledger + Product Type + Tồn kho. */
export async function GET(request: Request) {
  try {
    await authorize(request, "read", "accounting");
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id");
    if (!storeId) return Response.json({ error: "store_id is required" }, { status: 400 });

    const store = await getStoreById(storeId);
    const storeName = store?.name || "STORE";
    const { snapshotDate, items } = await getInventoryStockSnapshot(storeId, searchParams.get("snapshot_date"));

    const { starting_warehouse_balance, unknown_events, ...events } = LEDGER_EVENT_COLUMNS;
    const columns: { key: string; header: string; width: number; yellow?: boolean }[] = [
      { key: "report_date", header: "Date", width: 12 },
      { key: "product_type", header: "Product Type", width: 20 },
      { key: "fnsku", header: "FNSKU", width: 14 },
      { key: "asin", header: "ASIN", width: 14 },
      { key: "sku", header: "MSKU", width: 22 },
      { key: "title", header: "Title", width: 50 },
      { key: "disposition", header: "Disposition", width: 18 },
      { key: "starting_warehouse_balance", header: starting_warehouse_balance, width: 14 },
      { key: "in_transit_between_warehouses", header: "In Transit Between Warehouses", width: 16, yellow: true },
      ...Object.entries(events).map(([key, header]) => ({ key, header, width: 12 })),
      { key: "ending_warehouse_balance", header: "Ending Warehouse Balance", width: 16, yellow: true },
      { key: "unknown_events", header: unknown_events, width: 12 },
      { key: "location", header: "Location", width: 10 },
      { key: "ton_kho", header: "Tồn kho", width: 12, yellow: true },
    ];

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("TỒN KHO");
    ws.columns = columns.map(({ key, header, width }) => ({ key, header, width }));
    for (const item of items) ws.addRow(item);
    const header = ws.getRow(1);
    header.font = { bold: true };
    header.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    columns.forEach((col, idx) => {
      header.getCell(idx + 1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: col.yellow ? "FFFFFF00" : "FFFF9900" },
      };
    });
    ws.views = [{ state: "frozen", ySplit: 1 }];

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const filename = `${storeName.replace(/\s+/g, "_")}_TON_KHO_${snapshotDate ?? new Date().toISOString().slice(0, 10)}.xlsx`;
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi xuất file Excel tồn kho.");
  }
}
