import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { getFulfillPoById } from "@/lib/fulfill/db";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await authorize(req, "read", "accounting");
    const { id } = await params;

    const data = await getFulfillPoById(id);
    if (!data) {
      return NextResponse.json({ error: "Không tìm thấy đợt hàng." }, { status: 404 });
    }

    const { po, lines } = data;

    const wb = new ExcelJS.Workbook();
    wb.creator = "NCE Fulfill System";
    wb.created = new Date();

    const sheetName = po.po_number.slice(0, 31);
    const ws = wb.addWorksheet(sheetName, {
      views: [{ state: "frozen", xSplit: 5, ySplit: 2 }],
    });

    // 1. Group Headers (Row 1)
    ws.mergeCells("A1:N1");
    ws.getCell("A1").value = "BÊN MÌNH ĐIỀN (THÔNG TIN ĐẶT HÀNG)";
    ws.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F1" } };
    ws.getCell("A1").font = { bold: true, color: { argb: "FF1F497D" }, size: 11 };
    ws.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };

    ws.mergeCells("O1:U1");
    ws.getCell("O1").value = "PHẦN ĐÓNG GÓI FBA";
    ws.getCell("O1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE9D9" } };
    ws.getCell("O1").font = { bold: true, color: { argb: "FFC0504D" }, size: 11 };
    ws.getCell("O1").alignment = { horizontal: "center", vertical: "middle" };

    ws.mergeCells("V1:AB1");
    ws.getCell("V1").value = "THEO DÕI ĐƠN & VẬN CHUYỂN";
    ws.getCell("V1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEBF1DE" } };
    ws.getCell("V1").font = { bold: true, color: { argb: "FF4F6228" }, size: 11 };
    ws.getCell("V1").alignment = { horizontal: "center", vertical: "middle" };

    // 2. Column Headers (Row 2)
    const columns = [
      { key: "stt", header: "STT", width: 6 },
      { key: "store", header: "Name (Store)", width: 14 },
      { key: "sup", header: "Sup", width: 10 },
      { key: "date", header: "Date request", width: 13 },
      { key: "type", header: "Type", width: 16 },
      { key: "sku", header: "SKU", width: 18 },
      { key: "qty", header: "Quantity", width: 10 },
      { key: "line_ship", header: "Line ship", width: 12 },
      { key: "dimensions", header: "Dimensions", width: 14 },
      { key: "basecost", header: "Basecost ($)", width: 13 },
      { key: "fee_card", header: "Card ($)", width: 10 },
      { key: "fee_tag", header: "Tag ($)", width: 10 },
      { key: "fee_stand", header: "Stand ($)", width: 10 },
      { key: "fee_box", header: "Box ($)", width: 10 },
      // FBA
      { key: "transparency", header: "Transparency", width: 15 },
      { key: "fnsku", header: "FNSKU", width: 15 },
      { key: "label_fnsku", header: "Label FNSKU", width: 14 },
      { key: "shipment_id", header: "Shipment ID", width: 16 },
      { key: "box_qty", header: "Box Qty", width: 10 },
      { key: "shipping_label", header: "Shipping label", width: 18 },
      { key: "shipping_addr", header: "Shipping address", width: 22 },
      // Tracking
      { key: "ship_out", header: "Ship out date", width: 13 },
      { key: "arrival", header: "Arrival date", width: 13 },
      { key: "replacement", header: "Replacement fee", width: 15 },
      { key: "design", header: "Design Link", width: 20 },
      { key: "sample", header: "Sample Link", width: 20 },
      { key: "check", header: "Check", width: 12 },
      { key: "notes", header: "Notes", width: 20 },
    ];

    ws.getRow(2).values = columns.map((c) => c.header);
    ws.getRow(2).font = { bold: true, size: 10 };
    ws.getRow(2).alignment = { vertical: "middle", horizontal: "center" };
    ws.getRow(2).height = 24;

    columns.forEach((col, idx) => {
      ws.getColumn(idx + 1).width = col.width;
      const cell = ws.getCell(2, idx + 1);
      cell.border = {
        top: { style: "thin" },
        bottom: { style: "medium" },
        left: { style: "thin" },
        right: { style: "thin" },
      };
      // Styling colors for Row 2 headers
      if (idx < 14) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F5F9" } };
      } else if (idx < 21) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8F5" } };
      } else {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FBF7" } };
      }
    });

    // 3. Data Rows
    lines.forEach((line, index) => {
      const row = ws.addRow([
        index + 1,
        po.store_name || "",
        po.supplier_code || po.supplier_name || "",
        po.order_date,
        line.product_type || "",
        line.sku,
        line.quantity,
        line.line_ship || "",
        line.dimensions || "",
        line.basecost,
        line.fee_card,
        line.fee_tag,
        line.fee_stand,
        line.fee_box,
        line.transparency_code || "",
        line.fnsku || "",
        line.label_fnsku || "",
        line.shipment_id || "",
        line.box_quantity || "",
        line.shipping_label || "",
        line.shipping_address || "",
        line.shipping_out_date || "",
        line.arrival_date || "",
        line.replacement_fee,
        line.design_url || "",
        line.sample_url || "",
        line.check_status || "",
        line.notes || "",
      ]);

      row.height = 20;
      row.alignment = { vertical: "middle" };
      row.eachCell((cell, colNum) => {
        cell.border = {
          top: { style: "thin", color: { argb: "FFE0E0E0" } },
          bottom: { style: "thin", color: { argb: "FFE0E0E0" } },
          left: { style: "thin", color: { argb: "FFE0E0E0" } },
          right: { style: "thin", color: { argb: "FFE0E0E0" } },
        };
        // Number format for currency & qty
        if ([7, 10, 11, 12, 13, 14, 24].includes(colNum)) {
          cell.alignment = { vertical: "middle", horizontal: "right" };
          if ([10, 11, 12, 13, 14, 24].includes(colNum)) {
            cell.numFmt = "$#,##0.00";
          }
        }
      });
    });

    const buffer = await wb.xlsx.writeBuffer();
    const fileName = `${po.po_number}_${po.store_name || "STORE"}_${po.supplier_code || "SUP"}.xlsx`;

    return new Response(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi xuất file Excel đợt hàng.");
  }
}
