import test from "node:test";
import assert from "node:assert/strict";
import { dedupeFbmSkuRows } from "../lib/accounting/inventory-db";

// Dòng thật trong BẢNG MÃ FBM của FASTPEACE (29/10/2026)
test("dòng OFF đứng sau không thay dòng đang chạy cùng SKU + ASIN", () => {
  const rows = dedupeFbmSkuRows([
    { sku: "FBTQ1022CM02C\n", asin: "B0FX9LC739", status: "Test", total: 15.11 },
    { sku: "FBTQ1022CM02C", asin: "B0FX9LC739", status: "OFF", total: 11.74 },
  ]);
  assert.deepEqual(rows.map((r) => r.total), [15.11]);
});

test("dòng đang chạy đứng sau vẫn thay dòng OFF đứng trước", () => {
  const rows = dedupeFbmSkuRows([
    { sku: "HOTQ1014GP04C", asin: "B0FX9YWSF6", status: "OFF", total: 8.7, row: 4 },
    { sku: "HOTQ1014GP04C", asin: "B0FX9YWSF6", status: "Test", total: 8.7, row: 881 },
  ]);
  assert.deepEqual(rows.map((r) => r.row), [881]);
});

test("SKU chỉ có dòng OFF thì vẫn giữ; khác ASIN là 2 dòng riêng", () => {
  const rows = dedupeFbmSkuRows([
    { sku: "AOTT1015TV15C", asin: "B0FX9YWSF6", status: "OFF", total: 8.7 },
    { sku: "AOTT1015TV15C", asin: "B0HN7WZF8Q", status: "Chưa lên Camp", total: 7.59 },
    { sku: "OLD01", asin: "B000", status: "off", total: 5 },
  ]);
  assert.deepEqual(rows.map((r) => r.total), [8.7, 7.59, 5]);
});

test("trùng mà không có dòng OFF thì dòng sau thắng như trước", () => {
  const rows = dedupeFbmSkuRows([
    { sku: "A1", asin: "B1", status: "Test", total: 1 },
    { sku: "a1", asin: "b1", status: "Phát triển", total: 2 },
  ]);
  assert.deepEqual(rows.map((r) => r.total), [2]);
});
