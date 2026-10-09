import ExcelJS from "exceljs";
import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { getStoreById } from "@/lib/accounting/accounting-db";
import {
  getInventoryTemplate,
  findWorksheetByName,
  populateSkuWorksheet,
  populateInboundWorksheet,
} from "@/lib/accounting/inventory-db";

export async function GET(request: Request) {
  try {
    await authorize(request, "read", "accounting");
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id");
    const type = (searchParams.get("type") || "all") as "sku" | "inbound" | "all";

    if (!storeId) {
      return Response.json({ error: "store_id is required" }, { status: 400 });
    }

    const store = await getStoreById(storeId);
    const storeName = store?.name || "STORE";
    const sql = await getDatabaseClient();

    // Lấy dữ liệu BẢNG MÃ mới nhất từ DB
    const skus =
      type === "all" || type === "sku"
        ? await sql<any[]>`
            SELECT
              brand, product_type, mockup, sku, asin, fnsku,
              amazon_fee, referral_fee_pct, pic_mkt, loai, niche,
              pic_idea, status, event, tinh_trang, design_pic,
              mockup_url, thang_listing, thang_danh_gia, event_250th,
              ngay_danh_gia_sku_event, amazon_fba_fee_thay_doi,
              basecost_tb, brand_entity_id, creative_asins_video,
              creative_asins_collection, video_media_ids,
              creative_headline, brand_logo_asset_id, landing_page_url,
              custom_fields
            FROM accounting_sku_master
            WHERE store_id = ${storeId} AND deleted_at IS NULL
            ORDER BY created_at DESC, sku ASC
          `
        : [];

    // Lấy dữ liệu CHI TIẾT ĐI HÀNG mới nhất từ DB
    const shipments =
      type === "all" || type === "inbound"
        ? await sql<any[]>`
            SELECT
              s.brand, s.sup, s.ngay_request, s.product_type,
              COALESCE(s.mockup, m.mockup_url, m.mockup) as mockup,
              s.sku, s.quantity, s.line_ship, s.base_cost_per_unit,
              s.card, s.tag, s.shipping_fee, s.hop_tui, s.final_basecost,
              s.total_basecost, s.ngay_thanh_toan, s.ten_lo_hang,
              s.shipment_id, s.ngay_di, s.ngay_den, s.amazon_received,
              s.tinh_trang_hang_den_kho, s.status, s.so_luong_amazon_nhan,
              s.discrepancy, s.note, s.trang_thai, s.custom_fields
            FROM accounting_inbound_shipments s
            LEFT JOIN accounting_sku_master m ON m.store_id = s.store_id AND m.sku = s.sku AND m.deleted_at IS NULL
            WHERE s.store_id = ${storeId} AND s.deleted_at IS NULL
            ORDER BY s.created_at DESC, s.id DESC
          `
        : [];

    // Kiểm tra xem Store đã có file mẫu gốc (Template) được tự động lưu khi Import chưa
    const template = await getInventoryTemplate(storeId, type);

    let buffer: Buffer;

    if (template && template.buffer) {
      // 🌟 CÁCH 1: Nạp workbook từ chính file mẫu gốc đã import
      // Giữ nguyên 100% định dạng, font, màu sắc, độ rộng cột, công thức và sheet cấu trúc
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(template.buffer as unknown as ArrayBuffer);

      if (type === "all" || type === "sku") {
        const wsSku = findWorksheetByName(wb, ["BẢNG MÃ", "BANG MA", "SKU MASTER"]);
        if (wsSku) {
          populateSkuWorksheet(wsSku, skus);
        } else {
          // Nếu file mẫu thiếu sheet BẢNG MÃ, thêm mới
          const newWs = wb.addWorksheet("BẢNG MÃ");
          createDefaultSkuSheet(newWs, skus);
        }
      }

      if (type === "all" || type === "inbound") {
        const wsInbound = findWorksheetByName(wb, ["CHI TIẾT ĐI HÀNG", "CHI TIET DI HANG", "INBOUND SHIPMENTS"]);
        if (wsInbound) {
          populateInboundWorksheet(wsInbound, shipments);
        } else {
          // Nếu file mẫu thiếu sheet CHI TIẾT ĐI HÀNG, thêm mới
          const newWs = wb.addWorksheet("CHI TIẾT ĐI HÀNG");
          createDefaultInboundSheet(newWs, shipments);
        }
      }

      const rawBuffer = await wb.xlsx.writeBuffer();
      buffer = Buffer.from(rawBuffer);
    } else {
      // FALLBACK: Tạo mới workbook nếu Store chưa từng import file mẫu nào
      const wb = new ExcelJS.Workbook();

      if (type === "all" || type === "sku") {
        const wsSku = wb.addWorksheet("BẢNG MÃ");
        createDefaultSkuSheet(wsSku, skus);
      }

      if (type === "all" || type === "inbound") {
        const wsInbound = wb.addWorksheet("CHI TIẾT ĐI HÀNG");
        createDefaultInboundSheet(wsInbound, shipments);
      }

      const rawBuffer = await wb.xlsx.writeBuffer();
      buffer = Buffer.from(rawBuffer);
    }

    const typeSuffix = type === "sku" ? "BANG_MA" : type === "inbound" ? "DI_HANG" : "INVENTORY";
    const filename = `${storeName.replace(/\s+/g, "_")}_${typeSuffix}_${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi xuất file Excel từ server.");
  }
}

function createDefaultSkuSheet(ws: ExcelJS.Worksheet, skus: any[]) {
  const skuHeaders = [
    "Brand", "Product Type", "Mockup", "SKU", "ASIN", "FNSKU",
    "AMAZON FEE (chưa có referal fee)", "% Referal", "PIC MKT", "Loại",
    "Niche", "PIC Idea", "Trạng thái", "Event", "Tình trạng",
    "DESIGN PIC", "Mockup url", "Tháng listing", "Tháng đánh giá",
    "Event 250th", "Ngày đánh giá SKU Event", "Amazon FBA Fee thay đổi",
    "Basecost trung bình", "Brand Entity ID", "Creative ASINs (Video)",
    "Creative ASINs (Collection)", "Video Media IDs", "Creative Headline",
    "Brand Logo Asset ID", "Landing Page URL"
  ];

  const headerRow = ws.addRow(skuHeaders);
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFF9900" },
    };
    cell.font = { bold: true, color: { argb: "FF000000" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });

  for (const row of skus) {
    ws.addRow([
      row.brand, row.product_type, row.mockup, row.sku, row.asin, row.fnsku,
      row.amazon_fee ? Number(row.amazon_fee) : null,
      row.referral_fee_pct ? Number(row.referral_fee_pct) : null,
      row.pic_mkt, row.loai, row.niche, row.pic_idea, row.status,
      row.event, row.tinh_trang, row.design_pic, row.mockup_url,
      row.thang_listing, row.thang_danh_gia, row.event_250th,
      row.ngay_danh_gia_sku_event,
      row.amazon_fba_fee_thay_doi ? Number(row.amazon_fba_fee_thay_doi) : null,
      row.basecost_tb ? Number(row.basecost_tb) : null,
      row.brand_entity_id, row.creative_asins_video, row.creative_asins_collection,
      row.video_media_ids, row.creative_headline, row.brand_logo_asset_id,
      row.landing_page_url
    ]);
  }
}

function createDefaultInboundSheet(ws: ExcelJS.Worksheet, shipments: any[]) {
  const inboundHeaders = [
    "BRAND", "SUP", "Ngày request", "Product Type", "Mockup", "SKU",
    "Quantity", "Line ship", "Base Cost/Unit", "Card", "Tag",
    "Shipping fee", "Hộp/túi", "Final Basecost", "Total Basecost",
    "Ngày thanh toán", "Tên lô hàng", "Shipment ID", "Ngày đi", "Ngày đến",
    "Amazon Received", "Tình trạng hàng đến kho", "Status",
    "Số lượng Amazon nhận", "Discrepancy", "Note", "Trạng thái"
  ];

  const headerRow = ws.addRow(inboundHeaders);
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFF9900" },
    };
    cell.font = { bold: true, color: { argb: "FF000000" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });

  for (const row of shipments) {
    ws.addRow([
      row.brand, row.sup, row.ngay_request, row.product_type, row.mockup, row.sku,
      row.quantity ? Number(row.quantity) : 0,
      row.line_ship,
      row.base_cost_per_unit ? Number(row.base_cost_per_unit) : null,
      row.card ? Number(row.card) : null,
      row.tag ? Number(row.tag) : null,
      row.shipping_fee ? Number(row.shipping_fee) : null,
      row.hop_tui ? Number(row.hop_tui) : null,
      row.final_basecost ? Number(row.final_basecost) : null,
      row.total_basecost ? Number(row.total_basecost) : null,
      row.ngay_thanh_toan, row.ten_lo_hang, row.shipment_id,
      row.ngay_di, row.ngay_den,
      row.amazon_received ? Number(row.amazon_received) : null,
      row.tinh_trang_hang_den_kho, row.status,
      row.so_luong_amazon_nhan ? Number(row.so_luong_amazon_nhan) : null,
      row.discrepancy ? Number(row.discrepancy) : null,
      row.note, row.trang_thai
    ]);
  }
}
