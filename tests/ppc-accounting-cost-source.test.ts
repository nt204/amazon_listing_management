import assert from "node:assert/strict";
import test from "node:test";
import {
  computeBreakEven,
  resolveFallbackPrice,
  resolveSkuCosts,
  type AccountingSkuCost,
} from "../lib/ppc/accounting-cost-source";
import type { ProductCostMaster } from "../lib/ppc/sku-architecture-types";

const master = (values: Partial<ProductCostMaster>): ProductCostMaster => ({
  id: "m",
  productType: "Bullet Tumbler",
  baseCost: 0,
  defaultAmazonFee: 0,
  taxRate: 0.03,
  defaultPrice: 0,
  breakEvenAcos: 0,
  version: 1,
  effectiveFrom: "2026-10-01",
  effectiveTo: null,
  notes: null,
  skuCount: 0,
  createdAt: "",
  updatedAt: "",
  ...values,
});

const acc: AccountingSkuCost = {
  productType: "Bullet Tumbler",
  asin: "B0TEST",
  fbaFee: 4.2,
  referralPct: 0.15,
  baseCost: 4.29,
  baseCostSource: "ACCOUNTING_MONTHLY",
  avgPrice: 28,
};
const fallback = { baseCost: 2, defaultAmazonFee: 6.32 };

test("Cost Master đã khai báo luôn thắng số Accounting", () => {
  const costs = resolveSkuCosts({ declared: master({ baseCost: 3, defaultAmazonFee: 7.5 }), fallback, acc, sellingPrice: 28 });
  assert.deepEqual(costs, { baseCost: 3, baseCostSource: "COST_MASTER", amazonFee: 7.5, amazonFeeSource: "COST_MASTER" });
});

test("Ô Cost Master trống mới lấy Accounting, phí Amazon = FBA + % referral × giá", () => {
  const costs = resolveSkuCosts({ declared: master({ baseCost: 3 }), fallback, acc, sellingPrice: 28 });
  assert.equal(costs.baseCost, 3);
  assert.equal(costs.baseCostSource, "COST_MASTER");
  assert.equal(costs.amazonFee, 8.4); // 4.2 + 0.15 × 28
  assert.equal(costs.amazonFeeSource, "ACCOUNTING_SKU");
});

test("Thiếu cả Cost Master lẫn Accounting thì đánh dấu DEFAULT", () => {
  const costs = resolveSkuCosts({ declared: null, fallback, acc: undefined, sellingPrice: 28 });
  assert.deepEqual(costs, { baseCost: 2, baseCostSource: "DEFAULT", amazonFee: 6.32, amazonFeeSource: "DEFAULT" });
});

test("Giá bán: Cost Master → đơn hàng Accounting → giá đã lưu → mặc định", () => {
  assert.deepEqual(resolveFallbackPrice(master({ defaultPrice: 30 }), acc, 25, 15.99), { price: 30, source: "COST_MASTER" });
  assert.deepEqual(resolveFallbackPrice(master({}), acc, 25, 15.99), { price: 28, source: "ACCOUNTING_ORDERS" });
  assert.deepEqual(resolveFallbackPrice(null, undefined, 25, 15.99), { price: 25, source: "PREVIOUS" });
  assert.deepEqual(resolveFallbackPrice(null, undefined, 0, 15.99), { price: 15.99, source: "DEFAULT" });
});

test("Đủ số thật thì tính BE từ số đó", () => {
  const result = computeBreakEven({
    sellingPrice: 27.99,
    baseCost: 4.29,
    amazonFee: 8.4,
    taxRate: 0.03,
    sources: { sellingPrice: "ACCOUNTING_ORDERS", baseCost: "ACCOUNTING_MONTHLY", amazonFee: "ACCOUNTING_SKU" },
    packageMaster: { defaultPrice: 15.99, defaultAmazonFee: 6.32, baseCost: 2, breakEvenAcos: 48 },
  });
  assert.equal(result.profitBeforeAds, 14.46);
  assert.equal(result.breakEvenAcos, 51.7);
});

test("Thiếu một ô (DEFAULT) thì không ghép giá thật với giá vốn mặc định", () => {
  const result = computeBreakEven({
    sellingPrice: 30,
    baseCost: 2,
    amazonFee: 9.05,
    taxRate: 0.03,
    sources: { sellingPrice: "PREVIOUS", baseCost: "DEFAULT", amazonFee: "ACCOUNTING_SKU" },
    packageMaster: { defaultPrice: 15.99, defaultAmazonFee: 6.32, baseCost: 2, breakEvenAcos: 48 },
  });
  assert.equal(result.breakEvenAcos, 48);
  assert.equal(result.profitBeforeAds, 7.67);
});
