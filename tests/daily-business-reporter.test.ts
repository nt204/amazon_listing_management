import assert from "node:assert/strict";
import test from "node:test";

import { buildDailyHighlights, type DailyStoreReport } from "../lib/accounting/daily-business-reporter";

function report(
  storeName: string,
  day: Partial<DailyStoreReport["item"]>,
  baseline: Partial<NonNullable<DailyStoreReport["baseline"]>>,
): DailyStoreReport {
  return {
    storeName,
    item: { revenue: 0, quantity: 0, ads_fee: 0, return_cost: 0, profit: 0, ...day } as DailyStoreReport["item"],
    baseline: { days: 7, revenue: 0, quantity: 0, ads_fee: 0, return_cost: 0, profit: 0, ...baseline },
  };
}

test("không có biến động đáng kể thì không có điểm đáng chú ý", () => {
  const lines = buildDailyHighlights([
    report("A", { revenue: 1000, ads_fee: 150, profit: 300 }, { revenue: 950, ads_fee: 140, profit: 280 }),
  ]);
  assert.deepEqual(lines, []);
});

test("Ads = 0 bất thường thì cảnh báo thiếu file Ads, không nhận xét Profit/TACOS", () => {
  const lines = buildDailyHighlights([
    report("A", { revenue: 1000, ads_fee: 0, profit: 700 }, { revenue: 1000, ads_fee: 200, profit: 250 }),
  ]);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /chưa có chi phí Ads/);
});

test("store lỗ triền miên không bị nhắc lại mỗi ngày", () => {
  const steady = buildDailyHighlights([
    report("A", { revenue: 500, ads_fee: 400, profit: -300 }, { revenue: 500, ads_fee: 400, profit: -250 }),
  ]);
  assert.deepEqual(steady, []);
  const turnedLoss = buildDailyHighlights([
    report("A", { revenue: 500, ads_fee: 400, profit: -50 }, { revenue: 500, ads_fee: 300, profit: 100 }),
  ]);
  assert.ok(turnedLoss.some((line) => line.includes("lỗ $50")));
});

test("chỉ so TACOS khi các ngày trước có chạy Ads", () => {
  const lines = buildDailyHighlights([
    report("A", { revenue: 500, ads_fee: 100, profit: 100 }, { revenue: 500, ads_fee: 0, profit: 150 }),
  ]);
  assert.ok(!lines.some((line) => line.includes("TACOS")));
});
