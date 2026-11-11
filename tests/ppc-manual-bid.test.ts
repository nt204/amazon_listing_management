import { test } from "node:test";
import assert from "node:assert/strict";
import { applyBidOp, manualBidTier, runTypeFromCampaign } from "../lib/ppc/manual-bid";

const m = (clicks: number, orders: number, spend: number, sales: number) => ({ clicks, orders, spend, sales });

test("nấc ACOS: biên 20/40/60 thuộc nấc dưới", () => {
  assert.equal(manualBidTier(m(10, 1, 0, 50)), "A20");
  assert.equal(manualBidTier(m(10, 1, 10, 50)), "A20");
  assert.equal(manualBidTier(m(10, 1, 10.5, 50)), "A40");
  assert.equal(manualBidTier(m(10, 1, 20, 50)), "A40");
  assert.equal(manualBidTier(m(10, 1, 30, 50)), "A60");
  assert.equal(manualBidTier(m(10, 1, 31, 50)), "A60P");
});

test("0 order: chỉ gom khi click > 7", () => {
  assert.equal(manualBidTier(m(8, 0, 5, 0)), "NO_ORDER");
  assert.equal(manualBidTier(m(7, 0, 5, 0)), "OTHER");
  assert.equal(manualBidTier(m(0, 0, 0, 0)), "OTHER");
});

test("dạng chạy lấy từ tên campaign", () => {
  assert.equal(runTypeFromCampaign("BTV260203MR SP03 KW Exact FBA Tri 20261101", "SP"), "SP03");
  assert.equal(runTypeFromCampaign("FCMD15081 SB05 video", "SB"), "SB05");
  assert.equal(runTypeFromCampaign("FCMD15081 auto", "SP"), "SP");
});

test("thao tác hàng loạt: làm tròn, chặn bid tối thiểu, CPC chưa có thì bỏ qua", () => {
  const row = { bid: 1, cpc: 0.8, adType: "SP" };
  assert.equal(applyBidOp({ kind: "pct", value: -15 }, row), 0.85);
  assert.equal(applyBidOp({ kind: "add", value: 0.1 }, row), 1.1);
  assert.equal(applyBidOp({ kind: "set", value: 0.001 }, row), 0.02);
  assert.equal(applyBidOp({ kind: "set", value: 0.05 }, { ...row, adType: "SB" }), 0.1);
  assert.equal(applyBidOp({ kind: "cpc", value: 1.1 }, row), 0.88);
  assert.equal(applyBidOp({ kind: "cpc", value: 1 }, { ...row, cpc: 0 }), null);
  assert.equal(applyBidOp({ kind: "mul", value: 0.95 }, { ...row, bid: 0.78 }), 0.74);
  assert.equal(applyBidOp({ kind: "mul", value: 1.1 }, row), 1.1);
  assert.equal(applyBidOp({ kind: "mul", value: 0 }, row), null);
});

test("lọc SKU: nhiều SKU trong ô tìm, khoảng chỉ số, phôi/niche phụ thuộc nhau", async () => {
  const { filterSkusExceptTier, facetOptions, EMPTY_SKU_FILTER } = await import("../lib/ppc/manual-bid");
  const g = (sku: string, spend: number, sales: number, clicks: number, productType: string, niche: string) => ({
    sku, clicks, orders: sales > 0 ? 1 : 0, spend, sales, productType, niche,
  });
  const list = [
    g("BTV1", 50, 100, 20, "Tumbler", "Navy"),
    g("BTV2", 10, 100, 5, "Tumbler", "Marine"),
    g("POC3", 5, 0, 8, "Card", "Navy"),
    g("XX4", 0, 0, 0, "Card", "Army"),
  ];
  const ids = (f: Partial<typeof EMPTY_SKU_FILTER>) => filterSkusExceptTier(list, { ...EMPTY_SKU_FILTER, ...f }).map((x) => x.sku);
  assert.deepEqual(ids({}), ["BTV1", "BTV2", "POC3"]);
  assert.deepEqual(ids({ search: "btv1, poc3" }), ["BTV1", "POC3"]);
  assert.deepEqual(ids({ ranges: { spend: { min: "10", max: "" } } }), ["BTV1", "BTV2"]);
  assert.deepEqual(ids({ ranges: { acos: { min: "20", max: "60" } } }), ["BTV1"]);
  assert.deepEqual(ids({ ranges: { clicks: { min: "", max: "8" } } }), ["BTV2", "POC3"]);
  // Chọn phôi trước → niche chỉ còn niche của phôi đó; chọn niche trước → phôi chỉ còn phôi của niche đó.
  assert.deepEqual(facetOptions(list, { ...EMPTY_SKU_FILTER, phoi: "Tumbler" }, "niche"), ["Marine", "Navy"]);
  assert.deepEqual(facetOptions(list, { ...EMPTY_SKU_FILTER, niche: "Navy" }, "phoi"), ["Card", "Tumbler"]);
  assert.deepEqual(facetOptions(list, { ...EMPTY_SKU_FILTER, niche: "Marine" }, "phoi"), ["Tumbler"]);
});
