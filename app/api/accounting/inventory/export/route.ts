import ExcelJS from "exceljs";
import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { requireStoreAccess } from "@/lib/accounting/access";
import { getDatabaseClient } from "@/lib/db";
import { getStoreById } from "@/lib/accounting/accounting-db";
import {
  getInventoryTemplate,
  findWorksheetByName,
  populateSkuWorksheet,
  populateInboundWorksheet,
  populateCheckShipmentWorksheet,
  createDefaultSkuSheet,
  createDefaultInboundSheet,
  createDefaultCheckShipmentSheet,
  createFbmSkuSheet,
  getYearlyBaseCostMatrix,
  parseSkuChannel,
  skuMasterTable,
  type YearlyBaseCostRow,
} from "@/lib/accounting/inventory-db";

export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "accounting");
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id");
    const type = (searchParams.get("type") || "all") as "sku" | "inbound" | "check_shipment" | "monthly_base_cost" | "all";
    const period = searchParams.get("period");
    // BẢNG MÃ FBM: xuất từ bảng riêng, không dùng template của BẢNG MÃ FBA
    const isFbm = type === "sku" && parseSkuChannel(searchParams.get("channel")) === "fbm";
    const isTemplateMode =
      searchParams.get("mode") === "template" ||
      searchParams.get("template") === "true";

    if (!storeId) {
      return Response.json({ error: "store_id is required" }, { status: 400 });
    }
    await requireStoreAccess(actor, storeId, isFbm ? "FBM" : "FBA");

    const store = await getStoreById(storeId);
    const storeName = store?.name || "STORE";
    const sql = await getDatabaseClient();

    // Lấy dữ liệu BẢNG MÃ mới nhất từ DB
    let skus: any[] = [];
    if (!isTemplateMode && (type === "all" || type === "sku")) {
      skus = await sql<any[]>`
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
          ${isFbm
            ? sql`, sup, size, basecost::float, shipping_fee::float, add_shipping_fee::float,
              total_cost::float, ngay_len_camp, phan_loai_kich_thuoc`
            : sql`, asm.kich_thuoc, asm.phan_loai_kich_thuoc, asm.file_design, asm.ton_kho::float,
                CASE
                  WHEN asm.ton_kho IS NOT NULL AND asm.ton_kho > 0 THEN
                    ROUND((asm.ton_kho * COALESCE(
                      CASE WHEN ib.inbound_qty > 0 THEN (ib.inbound_cost / ib.inbound_qty) END,
                      CASE WHEN asm.basecost_tb IS NOT NULL AND asm.basecost_tb > 0 THEN asm.basecost_tb::float END,
                      pt.avg_cost
                    ))::numeric, 2)::float
                  WHEN asm.ton_kho IS NOT NULL AND asm.ton_kho = 0 THEN 0
                  ELSE NULL
                END AS gia_tri_ton`}
        FROM ${sql(skuMasterTable(isFbm ? "fbm" : "fba"))} asm
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(SUM(quantity), 0)::float AS inbound_qty,
            COALESCE(SUM(COALESCE(total_basecost, final_basecost * quantity, base_cost_per_unit * quantity, 0)), 0)::float AS inbound_cost
          FROM accounting_inbound_shipments s
          WHERE s.store_id = asm.store_id
            AND (
              REPLACE(UPPER(TRIM(s.sku)), ' ', '') = REPLACE(UPPER(TRIM(asm.sku)), ' ', '')
              OR (asm.asin IS NOT NULL AND s.sku = asm.asin)
            )
            AND s.deleted_at IS NULL
        ) ib ON true
        LEFT JOIN LATERAL (
          SELECT
            CASE WHEN SUM(quantity) > 0 THEN
              ROUND((SUM(COALESCE(total_basecost, final_basecost * quantity, base_cost_per_unit * quantity, 0)) / SUM(quantity))::numeric, 4)::float
            END AS avg_cost
          FROM accounting_inbound_shipments s2
          WHERE s2.store_id = asm.store_id
            AND LOWER(TRIM(COALESCE(s2.product_type, ''))) = LOWER(TRIM(COALESCE(asm.product_type, '')))
            AND s2.deleted_at IS NULL
        ) pt ON true
        WHERE asm.store_id = ${storeId} AND asm.deleted_at IS NULL
        ORDER BY asm.thang_listing DESC NULLS LAST, asm.created_at DESC, asm.sku ASC
      `;
    }

    // Lấy dữ liệu CHI TIẾT ĐI HÀNG mới nhất từ DB
    let shipments: any[] = [];
    if (!isTemplateMode && (type === "all" || type === "inbound")) {
      shipments = await sql<any[]>`
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
        ORDER BY s.ngay_di DESC NULLS LAST, s.created_at DESC, s.id DESC
      `;
    }

    // Lấy dữ liệu CHECK SHIPMENT AMAZON mới nhất từ DB
    let checkShipments: any[] = [];
    if (!isTemplateMode && (type === "all" || type === "check_shipment")) {
      checkShipments = await sql<any[]>`
        SELECT
          ngay_update, brand, shipment_name, shipment_id,
          created_date, last_updated_date, ship_to, skus_count,
          units_expected, units_located, discrepancy, status, custom_fields
        FROM accounting_amazon_check_shipments
        WHERE store_id = ${storeId} AND deleted_at IS NULL
        ORDER BY created_date DESC NULLS LAST, created_at DESC, id DESC
      `;
    }

    // Lấy dữ liệu BASE COST THÁNG mới nhất từ DB
    let monthlyBaseCosts: any[] = [];
    if (!isTemplateMode && (type === "all" || type === "monthly_base_cost")) {
      monthlyBaseCosts = await sql<any[]>`
        SELECT
          period, sku, brand, product_type,
          sl_ton_dau_ky::float, basecost_dau_ky::float, gtri_ton_dau_ky::float,
          sl_nhap::float, gtri_nhap::float, don_gia_nhap_tb::float,
          tong_sl_kha_dung::float, tong_gtri_kha_dung::float, basecost_thang::float,
          calculation_rule, is_overridden, note
        FROM accounting_monthly_base_cost
        WHERE store_id = ${storeId}
          AND (${period ?? null}::text IS NULL OR period = ${period ?? null})
          AND deleted_at IS NULL
        ORDER BY period DESC, sku ASC
      `;
    }

    // Nếu ở chế độ tải file mẫu (Template Mode) và chưa có dòng nào, tạo dòng ví dụ
    if (isTemplateMode) {
      if ((type === "all" || type === "sku") && skus.length === 0) {
        skus = [
          {
            brand: storeName !== "STORE" ? storeName : "FASTPEACE",
            product_type: "Glass Ornament",
            mockup: "",
            sku: "FCM02081",
            asin: "B09XXXXXXX",
            fnsku: "X00XXXXXXX",
            amazon_fee: 3.42,
            referral_fee_pct: 0.15,
            pic_mkt: "John",
            loai: "Standard",
            niche: "Family",
            pic_idea: "Sarah",
            status: "Active",
            event: "Christmas",
            tinh_trang: "In Stock",
            design_pic: "Alex",
            mockup_url: "",
            thang_listing: new Date().toISOString().slice(0, 7),
            thang_danh_gia: null,
            event_250th: null,
            ngay_danh_gia_sku_event: null,
            amazon_fba_fee_thay_doi: null,
            basecost_tb: 6.34,
            brand_entity_id: null,
            creative_asins_video: null,
            creative_asins_collection: null,
            video_media_ids: null,
            creative_headline: null,
            brand_logo_asset_id: null,
            landing_page_url: null,
          },
        ];
      }

      if ((type === "all" || type === "inbound") && shipments.length === 0) {
        shipments = [
          {
            brand: storeName !== "STORE" ? storeName : "FASTPEACE",
            sup: "Ella",
            ngay_request: new Date().toISOString().slice(0, 10),
            product_type: "Glass Ornament",
            mockup: "",
            sku: "FCM02081",
            quantity: 500,
            line_ship: "Air Express",
            base_cost_per_unit: 6.25,
            card: 0.06,
            tag: 0.03,
            shipping_fee: 1.20,
            hop_tui: 0.10,
            final_basecost: 7.64,
            total_basecost: 3820.00,
            ngay_thanh_toan: new Date().toISOString().slice(0, 10),
            ten_lo_hang: "Lô Đi Tháng " + (new Date().getMonth() + 1),
            shipment_id: "FBA198H2RVVP",
            ngay_di: new Date().toISOString().slice(0, 10),
            ngay_den: null,
            amazon_received: 500,
            tinh_trang_hang_den_kho: "Đủ hàng",
            status: "Closed",
            so_luong_amazon_nhan: 500,
            discrepancy: 0,
            note: "Hàng chuẩn đẹp",
            trang_thai: "Active",
          },
        ];
      }

      if ((type === "all" || type === "check_shipment") && checkShipments.length === 0) {
        checkShipments = [
          {
            ngay_update: new Date().toISOString().slice(0, 10),
            brand: storeName !== "STORE" ? storeName : "WARMSTOREY",
            shipment_name: "FBA STA (07/27/2025 15:59)-PPO4",
            shipment_id: "FBA18ZJQQLSN",
            created_date: new Date().toISOString().slice(0, 10),
            last_updated_date: new Date().toISOString().slice(0, 10),
            ship_to: "PPO4",
            skus_count: 1,
            units_expected: 200,
            units_located: 182,
            discrepancy: -18,
            status: "Closed",
          },
        ];
      }
    }

    // Kiểm tra xem Store đã có file mẫu gốc (Template) được tự động lưu khi Import chưa
    const template =
      type !== "monthly_base_cost" && !isFbm
        ? await getInventoryTemplate(storeId, type as "sku" | "inbound" | "check_shipment" | "all")
        : null;

    let buffer: Buffer;

    if (template && template.buffer) {
      // 🌟 CÁCH 1: Nạp workbook từ chính file mẫu gốc đã import
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(template.buffer as unknown as ArrayBuffer);

      if (type === "sku") {
        const wsSku = findWorksheetByName(wb, ["BẢNG MÃ", "BANG MA", "SKU MASTER"]);
        if (wsSku) {
          populateSkuWorksheet(wsSku, skus);
        } else {
          const newWs = wb.addWorksheet("BẢNG MÃ");
          createDefaultSkuSheet(newWs, skus);
        }
        const wsInbound = findWorksheetByName(wb, ["CHI TIẾT ĐI HÀNG", "CHI TIET DI HANG", "INBOUND SHIPMENTS"]);
        if (wsInbound) wb.removeWorksheet(wsInbound.id);
        const wsCheck = findWorksheetByName(wb, ["CHECK SHIPMENT AMAZON", "CHECK SHIPMENT"]);
        if (wsCheck) wb.removeWorksheet(wsCheck.id);
      } else if (type === "inbound") {
        const wsInbound = findWorksheetByName(wb, ["CHI TIẾT ĐI HÀNG", "CHI TIET DI HANG", "INBOUND SHIPMENTS"]);
        if (wsInbound) {
          populateInboundWorksheet(wsInbound, shipments);
        } else {
          const newWs = wb.addWorksheet("CHI TIẾT ĐI HÀNG");
          createDefaultInboundSheet(newWs, shipments);
        }
        const wsSku = findWorksheetByName(wb, ["BẢNG MÃ", "BANG MA", "SKU MASTER"]);
        if (wsSku) wb.removeWorksheet(wsSku.id);
        const wsCheck = findWorksheetByName(wb, ["CHECK SHIPMENT AMAZON", "CHECK SHIPMENT"]);
        if (wsCheck) wb.removeWorksheet(wsCheck.id);
      } else if (type === "check_shipment") {
        const wsCheck = findWorksheetByName(wb, ["CHECK SHIPMENT AMAZON", "CHECK SHIPMENT", "CHECK_SHIPMENT"]);
        if (wsCheck) {
          populateCheckShipmentWorksheet(wsCheck, checkShipments);
        } else {
          const newWs = wb.addWorksheet("CHECK SHIPMENT AMAZON");
          createDefaultCheckShipmentSheet(newWs, checkShipments);
        }
        const wsSku = findWorksheetByName(wb, ["BẢNG MÃ", "BANG MA", "SKU MASTER"]);
        if (wsSku) wb.removeWorksheet(wsSku.id);
        const wsInbound = findWorksheetByName(wb, ["CHI TIẾT ĐI HÀNG", "CHI TIET DI HANG", "INBOUND SHIPMENTS"]);
        if (wsInbound) wb.removeWorksheet(wsInbound.id);
      } else {
        // type === "all"
        const wsSku = findWorksheetByName(wb, ["BẢNG MÃ", "BANG MA", "SKU MASTER"]);
        if (wsSku) {
          populateSkuWorksheet(wsSku, skus);
        } else {
          const newWs = wb.addWorksheet("BẢNG MÃ");
          createDefaultSkuSheet(newWs, skus);
        }

        const wsInbound = findWorksheetByName(wb, ["CHI TIẾT ĐI HÀNG", "CHI TIET DI HANG", "INBOUND SHIPMENTS"]);
        if (wsInbound) {
          populateInboundWorksheet(wsInbound, shipments);
        } else {
          const newWs = wb.addWorksheet("CHI TIẾT ĐI HÀNG");
          createDefaultInboundSheet(newWs, shipments);
        }

        const wsCheck = findWorksheetByName(wb, ["CHECK SHIPMENT AMAZON", "CHECK SHIPMENT", "CHECK_SHIPMENT"]);
        if (wsCheck) {
          populateCheckShipmentWorksheet(wsCheck, checkShipments);
        } else {
          const newWs = wb.addWorksheet("CHECK SHIPMENT AMAZON");
          createDefaultCheckShipmentSheet(newWs, checkShipments);
        }
      }

      const rawBuffer = await wb.xlsx.writeBuffer();
      buffer = Buffer.from(rawBuffer);
    } else {
      // 🌟 CÁCH 2: Tạo mới workbook theo đúng chuẩn 100% định dạng, công thức, độ rộng cột, frozen panes
      const wb = new ExcelJS.Workbook();

      if (isFbm) {
        // Giữ đúng mẫu sheet "FBM_<Store>" để file xuất ra import lại được
        createFbmSkuSheet(wb.addWorksheet(`FBM_${storeName}`), skus);
      } else if (type === "all" || type === "sku") {
        const wsSku = wb.addWorksheet("BẢNG MÃ");
        createDefaultSkuSheet(wsSku, skus);
      }

      if (type === "all" || type === "inbound") {
        const wsInbound = wb.addWorksheet("CHI TIẾT ĐI HÀNG");
        createDefaultInboundSheet(wsInbound, shipments);
      }

      if (type === "all" || type === "check_shipment") {
        const wsCheck = wb.addWorksheet("CHECK SHIPMENT AMAZON");
        createDefaultCheckShipmentSheet(wsCheck, checkShipments);
      }

      if (type === "monthly_base_cost") {
        const yearParam = searchParams.get("year");
        const year = yearParam ? Number(yearParam) : (period ? parseInt(period.split("-")[0], 10) : new Date().getFullYear());
        const yearlyMatrix = await getYearlyBaseCostMatrix(storeId, year);
        const wsBaseCost = wb.addWorksheet(`BASE COST ${year}`);
        createYearlyBaseCostSheet(wsBaseCost, yearlyMatrix.rows, year);
      }

      const rawBuffer = await wb.xlsx.writeBuffer();
      buffer = Buffer.from(rawBuffer);
    }

    const typeSuffix =
      type === "sku"
        ? isFbm ? "BANG_MA_FBM" : "BANG_MA"
        : type === "inbound"
        ? "DI_HANG"
        : type === "check_shipment"
        ? "CHECK_SHIPMENT"
        : type === "monthly_base_cost"
        ? "BASE_COST_12_THANG"
        : "INVENTORY";
    const prefix = isTemplateMode ? "MAU_IMPORT_" : "";
    const filename = `${storeName.replace(/\s+/g, "_")}_${prefix}${typeSuffix}_${new Date().toISOString().slice(0, 10)}.xlsx`;

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

function createYearlyBaseCostSheet(ws: ExcelJS.Worksheet, rows: YearlyBaseCostRow[], year: number) {
  ws.columns = [
    { key: "product_type", header: "Product Type", width: 18 },
    { key: "mockup", header: "Mockup", width: 16 },
    { key: "sku", header: "SKU", width: 22 },
    { key: "asin", header: "ASIN", width: 16 },
    { key: "hang_ton", header: `Hàng tồn 1/1/${year}`, width: 16 },
    { key: "gia_von", header: `Trung bình giá 1/1/${year}`, width: 18 },
    { key: "bien_dong", header: "Biến động basecost", width: 20 },
    ...Array.from({ length: 12 }, (_, i) => ({
      key: `m_${i + 1}`,
      header: `Basecost tháng ${i + 1}`,
      width: 15,
    })),
  ];

  const headerRow = ws.getRow(1);
  headerRow.height = 30;

  // Cols 1 to 4: Orange #FF9900
  for (let c = 1; c <= 4; c++) {
    const cell = headerRow.getCell(c);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF9900" } };
    cell.font = { bold: true, color: { argb: "FF000000" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  }
  // Cols 5 to 7: Soft Yellow #FEF3C7
  for (let c = 5; c <= 7; c++) {
    const cell = headerRow.getCell(c);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
    cell.font = { bold: true, color: { argb: "FF92400E" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  }
  // Cols 8 to 19: Clean Slate/White
  for (let c = 8; c <= 19; c++) {
    const cell = headerRow.getCell(c);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
    cell.font = { bold: true, color: { argb: "FF1E293B" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  }

  rows.forEach((r) => {
    const rowObj: any = {
      product_type: r.product_type || "",
      mockup: r.mockup_url || r.mockup || "",
      sku: r.sku,
      asin: r.asin || "",
      hang_ton: r.hang_ton_dau_nam,
      gia_von: r.gia_von_dau_nam,
      bien_dong: r.sparkline_points && r.sparkline_points.length > 0 ? `${Math.min(...r.sparkline_points)} ~ ${Math.max(...r.sparkline_points)}` : "",
    };
    for (let m = 1; m <= 12; m++) {
      rowObj[`m_${m}`] = r.months[m]?.basecost ?? 0;
    }
    const addedRow = ws.addRow(rowObj);
    addedRow.height = 24;

    for (let c = 5; c <= 7; c++) {
      addedRow.getCell(c).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFFDF0" },
      };
    }
    addedRow.getCell(5).alignment = { vertical: "middle", horizontal: "center" };
    addedRow.getCell(6).numFmt = "$#,##0.00";
    addedRow.getCell(6).alignment = { vertical: "middle", horizontal: "right" };
    addedRow.getCell(7).alignment = { vertical: "middle", horizontal: "center" };

    for (let c = 8; c <= 19; c++) {
      const cell = addedRow.getCell(c);
      cell.numFmt = "0.00";
      cell.alignment = { vertical: "middle", horizontal: "center" };
    }
  });
}


