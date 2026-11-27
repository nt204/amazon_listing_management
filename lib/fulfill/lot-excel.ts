import "server-only";

import ExcelJS from "exceljs";
import { LOT_COLUMNS } from "./lot-columns";
import type { FulfillLot, FulfillLotLine } from "./types";

// Màu tiêu đề giống sheet gửi xưởng: phần bên mình điền nền xám nhạt, phần xưởng / vận chuyển nền cam.
const HEADER_FILL = { order: "FFEFEFEF", ship: "FFFF9900", amazon: "FFFFE599" } as const;

/** File Excel 1 lô đúng cột sheet gửi xưởng, dòng cuối "Total" như sheet. Dùng cho trang nội bộ và trang xưởng. */
export async function lotExcelResponse(lot: FulfillLot, lines: FulfillLotLine[]) {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const ws = wb.addWorksheet(lot.lot_name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31), {
    views: [{ state: "frozen", xSplit: 6, ySplit: 1 }],
  });

  ws.columns = LOT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  const header = ws.getRow(1);
  header.height = 22;
  LOT_COLUMNS.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.font = { bold: true, size: 10 };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL[c.group] } };
  });

  const active = lines.filter((l) => l.stage !== "cancelled");
  for (const line of lines) {
    const row = ws.addRow(
      Object.fromEntries(
        LOT_COLUMNS.map((c) => {
          const value = line[c.key];
          if (c.kind === "link" || c.kind === "image") return [c.key, value ? { text: String(value), hyperlink: String(value) } : ""];
          return [c.key, value ?? ""];
        }),
      ),
    );
    if (line.stage === "cancelled") row.font = { strike: true, color: { argb: "FF999999" } };
  }
  const total = ws.addRow({
    final_basecost: "Total",
    quantity: active.reduce((a, l) => a + l.quantity, 0),
    real_total: Math.round(active.reduce((a, l) => a + l.real_total, 0) * 100) / 100,
  });
  total.font = { bold: true };

  LOT_COLUMNS.forEach((c, i) => {
    if (c.kind === "money") ws.getColumn(i + 1).numFmt = "$#,##0.00";
  });

  const buffer = await wb.xlsx.writeBuffer();
  const fileName = `${lot.lot_name}.xlsx`.replace(/[^\w.\- ]+/g, "_");
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(`${lot.lot_name}.xlsx`)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
