import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  createDefaultSkuSheet,
  createDefaultInboundSheet,
  createDefaultCheckShipmentSheet,
  findWorksheetByName,
  SKU_HEADER_MAP,
  INBOUND_HEADER_MAP,
  CHECK_SHIPMENT_HEADER_MAP,
  getExcelCellValue,
  cleanMonthOnly,
} from "../lib/accounting/inventory-db";

test("Accounting Inventory Excel: createDefaultSkuSheet matches import specifications", async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("BẢNG MÃ");

  const sampleSkus = [
    {
      brand: "FASTPEACE",
      product_type: "Glass Ornament",
      mockup: "https://example.com/mockup.png",
      sku: "TEST-SKU-001",
      asin: "B091234567",
      fnsku: "X001234567",
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
      mockup_url: "https://example.com/mockup.png",
      thang_listing: "2026-06",
      thang_danh_gia: "2026-07",
      event_250th: null,
      ngay_danh_gia_sku_event: "2026-07-15",
      amazon_fba_fee_thay_doi: 3.5,
      basecost_tb: 6.34,
      brand_entity_id: "ENT-01",
      creative_asins_video: "B091234567",
      creative_asins_collection: null,
      video_media_ids: "MED-01",
      creative_headline: "Great Gift",
      brand_logo_asset_id: "LOGO-01",
      landing_page_url: "https://amazon.com/dp/B091234567",
    },
  ];

  createDefaultSkuSheet(ws, sampleSkus);

  // 1. Check sheet name
  assert.equal(ws.name, "BẢNG MÃ");

  // 2. Check header columns count
  assert.equal(ws.columnCount, 32);

  // 3. Verify every header cell maps into SKU_HEADER_MAP
  for (let c = 1; c <= 32; c++) {
    const headerVal = getExcelCellValue(ws.getRow(1).getCell(c));
    assert.ok(headerVal, `Header at column ${c} must not be empty`);
    const headerLower = String(headerVal).trim().toLowerCase();
    const mapped = SKU_HEADER_MAP[headerLower];
    assert.ok(mapped, `Header "${headerVal}" at column ${c} must be recognized by SKU_HEADER_MAP`);
  }

  // 4. Verify data row
  const row2 = ws.getRow(2);
  assert.equal(getExcelCellValue(row2.getCell(4)), "TEST-SKU-001");
  assert.equal(getExcelCellValue(row2.getCell(1)), "FASTPEACE");
  assert.equal(getExcelCellValue(row2.getCell(7)), 3.42);
  assert.equal(getExcelCellValue(row2.getCell(8)), 0.15);
});

test("Accounting Inventory Excel: createDefaultInboundSheet has working formulas and matches import specifications", async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("CHI TIẾT ĐI HÀNG");

  const sampleShipments = [
    {
      brand: "FASTPEACE",
      sup: "Ella",
      ngay_request: "2026-05-01",
      product_type: "Glass Ornament",
      mockup: "https://example.com/mockup.png",
      sku: "TEST-SKU-001",
      quantity: 500,
      line_ship: "Air Express",
      base_cost_per_unit: 6.25,
      card: 0.06,
      tag: 0.03,
      shipping_fee: 1.20,
      hop_tui: 0.10,
      final_basecost: 7.64,
      total_basecost: 3820.0,
      ngay_thanh_toan: "2026-05-02",
      ten_lo_hang: "Lô Đi Tháng 5",
      shipment_id: "FBA198H2RVVP",
      ngay_di: "2026-05-05",
      ngay_den: "2026-05-20",
      amazon_received: 500,
      tinh_trang_hang_den_kho: "Đủ hàng",
      status: "Closed",
      so_luong_amazon_nhan: 500,
      discrepancy: 0,
      note: "Hàng chuẩn đẹp",
      trang_thai: "Active",
    },
  ];

  createDefaultInboundSheet(ws, sampleShipments);

  // 1. Check sheet name
  assert.equal(ws.name, "CHI TIẾT ĐI HÀNG");

  // 2. Check header columns count
  assert.equal(ws.columnCount, 27);

  // 3. Verify every header cell maps into INBOUND_HEADER_MAP
  for (let c = 1; c <= 27; c++) {
    const headerVal = getExcelCellValue(ws.getRow(1).getCell(c));
    assert.ok(headerVal, `Header at column ${c} must not be empty`);
    const headerLower = String(headerVal).trim().toLowerCase();
    const mapped = INBOUND_HEADER_MAP[headerLower];
    assert.ok(mapped, `Header "${headerVal}" at column ${c} must be recognized by INBOUND_HEADER_MAP`);
  }

  // 4. Verify formulas on data row
  const row2 = ws.getRow(2);
  const cellFinalBaseCost = row2.getCell(14); // Column N
  assert.ok(cellFinalBaseCost.formula, "Final Basecost cell must contain an Excel formula");
  assert.equal(cellFinalBaseCost.formula, "SUM(I2:M2)");
  assert.equal(cellFinalBaseCost.result, 7.64);

  const cellTotalBaseCost = row2.getCell(15); // Column O
  assert.ok(cellTotalBaseCost.formula, "Total Basecost cell must contain an Excel formula");
  assert.equal(cellTotalBaseCost.formula, "G2*N2");
  assert.equal(cellTotalBaseCost.result, 3820);

  const cellDiscrepancy = row2.getCell(25); // Column Y
  assert.ok(cellDiscrepancy.formula, "Discrepancy cell must contain an Excel formula");
  assert.equal(cellDiscrepancy.formula, 'IF(ISBLANK(U2),"",U2-G2)');
  assert.equal(cellDiscrepancy.result, 0);

  // 5. Test findWorksheetByName
  const foundSheet = findWorksheetByName(wb, ["CHI TIẾT ĐI HÀNG", "CHI TIET DI HANG"]);
  assert.ok(foundSheet, "Must find worksheet by alias");
  assert.equal(foundSheet?.name, "CHI TIẾT ĐI HÀNG");
});

test("Accounting Inventory Excel: cleanMonthOnly only extracts Year and Month (no Day)", () => {
  // YYYY-MM-DD -> YYYY-MM
  assert.equal(cleanMonthOnly("2026-10-15"), "2026-10");
  assert.equal(cleanMonthOnly("2026-06-01"), "2026-06");
  assert.equal(cleanMonthOnly("2025-1-5"), "2025-01");

  // YYYY-MM -> YYYY-MM
  assert.equal(cleanMonthOnly("2026-10"), "2026-10");
  assert.equal(cleanMonthOnly("2026-6"), "2026-06");

  // YYYY/MM/DD and YYYY/MM
  assert.equal(cleanMonthOnly("2026/10/05"), "2026-10");
  assert.equal(cleanMonthOnly("2026/10"), "2026-10");

  // DD/MM/YYYY
  assert.equal(cleanMonthOnly("15/10/2026"), "2026-10");
  assert.equal(cleanMonthOnly("01/06/2026"), "2026-06");

  // MM/YYYY
  assert.equal(cleanMonthOnly("10/2026"), "2026-10");
  assert.equal(cleanMonthOnly("6/2026"), "2026-06");

  // Vietnamese text like Tháng 10/2026
  assert.equal(cleanMonthOnly("Tháng 10/2026"), "2026-10");
  assert.equal(cleanMonthOnly("Thang 5/2026"), "2026-05");

  // Date object or ISO string
  assert.equal(cleanMonthOnly(new Date("2026-10-15T00:00:00.000Z")), "2026-10");
  assert.equal(cleanMonthOnly("2026-10-15T08:30:00.000Z"), "2026-10");

  // Empty / null cases
  assert.equal(cleanMonthOnly(null), null);
  assert.equal(cleanMonthOnly(""), null);
  assert.equal(cleanMonthOnly("—"), null);
});

test("Accounting Inventory Excel: createDefaultCheckShipmentSheet matches LIMIMA specifications", async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("CHECK SHIPMENT AMAZON");

  const sampleShipments = [
    {
      ngay_update: "2026-10-09",
      brand: "LIMIMA",
      shipment_name: "FBA (10/08/2026 14:30)-1",
      shipment_id: "FBA18V8NXYZ",
      created_date: "2026-10-08",
      last_updated_date: "2026-10-09",
      ship_to: "ABE8",
      skus_count: 1,
      units_expected: 100,
      units_located: 100,
      discrepancy: 0,
      status: "Closed",
    },
  ];

  createDefaultCheckShipmentSheet(ws, sampleShipments);

  // 1. Check sheet name
  assert.equal(ws.name, "CHECK SHIPMENT AMAZON");

  // 2. Check header columns count (exact 11 columns matching LIMIMA Excel sheet)
  assert.equal(ws.columnCount, 11);

  // 3. Check column headers
  const headerRow = ws.getRow(1);
  assert.equal(headerRow.getCell(1).value, "Ngày update");
  assert.equal(headerRow.getCell(2).value, "Brand");
  assert.equal(headerRow.getCell(3).value, "Shipment name");
  assert.equal(headerRow.getCell(4).value, "Shipment ID");
  assert.equal(headerRow.getCell(5).value, "Created");
  assert.equal(headerRow.getCell(6).value, "Last updated");
  assert.equal(headerRow.getCell(7).value, "Ship to");
  assert.equal(headerRow.getCell(8).value, "SKUs");
  assert.equal(headerRow.getCell(9).value, "Units expected");
  assert.equal(headerRow.getCell(10).value, "Units located");
  assert.equal(headerRow.getCell(11).value, "Status");

  // 4. Check data row
  const row2 = ws.getRow(2);
  assert.equal(row2.getCell(2).value, "LIMIMA");
  assert.equal(row2.getCell(3).value, "FBA (10/08/2026 14:30)-1");
  assert.equal(row2.getCell(4).value, "FBA18V8NXYZ");
  assert.equal(row2.getCell(8).value, 1);
  assert.equal(row2.getCell(9).value, 100);
  assert.equal(row2.getCell(10).value, 100);
  assert.equal(row2.getCell(11).value, "Closed");

  // 5. Test findWorksheetByName
  const foundSheet = findWorksheetByName(wb, ["CHECK SHIPMENT AMAZON", "CHECK SHIPMENT"]);
  assert.ok(foundSheet, "Must find worksheet by alias");
  assert.equal(foundSheet?.name, "CHECK SHIPMENT AMAZON");

  // 6. Test CHECK_SHIPMENT_HEADER_MAP
  assert.equal(CHECK_SHIPMENT_HEADER_MAP["ngay update"], "ngay_update");
  assert.equal(CHECK_SHIPMENT_HEADER_MAP["shipment name"], "shipment_name");
  assert.equal(CHECK_SHIPMENT_HEADER_MAP["shipment id"], "shipment_id");
  assert.equal(CHECK_SHIPMENT_HEADER_MAP["units expected"], "units_expected");
  assert.equal(CHECK_SHIPMENT_HEADER_MAP["units located"], "units_located");
  assert.equal(CHECK_SHIPMENT_HEADER_MAP["discrepancy"], "discrepancy");
  assert.equal(CHECK_SHIPMENT_HEADER_MAP["status"], "status");
});

