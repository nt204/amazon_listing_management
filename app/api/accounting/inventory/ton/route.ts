// Tab TỒN của Inventory — xem lib/accounting/inventory-ton-db.ts. ?format=xlsx để tải file Excel.
import ExcelJS from "exceljs";
import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { requireStoreAccess } from "@/lib/accounting/access";
import { queryInventoryTon } from "@/lib/accounting/inventory-ton-db";
import { queryInventoryRange } from "@/lib/accounting/inventory-range-db";
import { getDatabaseClient } from "@/lib/db";

function vnYear(): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric" }).format(new Date()));
}

export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "accounting");
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id");
    if (!storeId) return Response.json({ error: "store_id is required" }, { status: 400 });
    await requireStoreAccess(actor, storeId, "FBA");

    // Theo ngày / khoảng ngày: ?mode=range&start=YYYY-MM-DD&end=YYYY-MM-DD
    if (searchParams.get("mode") === "range") {
      const start = searchParams.get("start") || "";
      const end = searchParams.get("end") || start;
      try {
        return Response.json(await queryInventoryRange(storeId, start, end));
      } catch (error) {
        return Response.json({ error: (error as Error).message }, { status: 400 });
      }
    }

    const yearParam = Number(searchParams.get("year"));
    const year = Number.isInteger(yearParam) && yearParam >= 2024 && yearParam <= 2100 ? yearParam : vnYear();
    const result = await queryInventoryTon(storeId, year);

    if (searchParams.get("format") !== "xlsx") return Response.json(result);

    const sql = await getDatabaseClient();
    const [store] = await sql<{ name: string }[]>`SELECT name FROM stores WHERE id = ${storeId}`;
    const buffer = await buildWorkbook(result.rows, year, result.hasFbaStock ? result.stockDate : null);
    const fileName = `TON_${(store?.name || "store").replace(/[^\w-]+/g, "_")}_${year}.xlsx`;
    return new Response(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Không tải được tab TỒN.", 500);
  }
}

type Row = Awaited<ReturnType<typeof queryInventoryTon>>["rows"][number];

async function buildWorkbook(rows: Row[], year: number, stockDate: string | null): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("TỒN", { views: [{ state: "frozen", xSplit: 4, ySplit: 1 }] });
  const money = '"$"#,##0.00';
  const cols: { header: string; key: keyof Row; width: number; fmt?: string; fill: string }[] = [
    { header: "Product Type", key: "product_type", width: 18, fill: "FFFF9900" },
    { header: "Mockup", key: "mockup_url", width: 12, fill: "FFFF9900" },
    { header: "SKU", key: "sku", width: 22, fill: "FFFF9900" },
    { header: "ASIN", key: "asin", width: 15, fill: "FFFF9900" },
    { header: `Hàng tồn 1/1/${year}`, key: "ton_dau_nam", width: 12, fmt: "#,##0", fill: "FFFF9900" },
    { header: "Tổng giá trị tồn đầu năm", key: "gtri_dau_nam", width: 14, fmt: money, fill: "FFFF9900" },
    { header: "SL ĐI HÀNG /NĂM", key: "sl_di_hang", width: 12, fmt: "#,##0", fill: "FFFF9900" },
    { header: "TIỀN HÀNG/NĂM", key: "tien_hang", width: 15, fmt: money, fill: "FFFF9900" },
    { header: "BASECOST", key: "basecost", width: 12, fmt: money, fill: "FFFF9900" },
    { header: "LƯỢNG BÁN /NĂM", key: "luong_ban", width: 11, fmt: "#,##0", fill: "FFFF9900" },
    { header: "TỒN", key: "ton", width: 10, fmt: "#,##0", fill: "FFFF9900" },
    { header: "Inventory (FBA)", key: "fba_total", width: 12, fmt: "#,##0", fill: "FFFFFF00" },
    { header: "AWD", key: "awd_total", width: 10, fmt: "#,##0", fill: "FFFFFF00" },
    { header: "Total (AMAZON)", key: "total_amazon", width: 13, fmt: "#,##0", fill: "FFFFFF00" },
    { header: "Tổng giá trị tồn", key: "gtri_ton", width: 14, fmt: money, fill: "FFFFFF00" },
  ];
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key as string, width: c.width }));
  for (const r of rows) ws.addRow(r);
  const header = ws.getRow(1);
  header.height = 60;
  cols.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.fill } };
    cell.font = { bold: true };
    cell.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
    if (c.fmt) ws.getColumn(i + 1).numFmt = c.fmt;
  });
  if (stockDate) ws.getCell(1, cols.length + 1).value = `Tồn Amazon chốt ngày ${stockDate.split("-").reverse().join("/")}`;
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
