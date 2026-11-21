import test from "node:test";
import assert from "node:assert/strict";

import { summarizeDays, type DashboardDay } from "../lib/accounting/dashboard-totals";
import { accountingMetrics, type AccountingMetricRow } from "../lib/metrics/accounting/definitions";
import { createMetricRegistry } from "../lib/metrics/registry";
import { breakdownMetric, compareBreakdown, compareMetric, explainMetric } from "../lib/metrics/engine";
import type { MetricDefinition } from "../lib/metrics/types";

function day(date: string, v: Partial<DashboardDay>): DashboardDay {
  const base = { revenue: 0, quantity: 0, orders: 0, adsFee: 0, basecost: 0, amazonFee: 0, tax: 0, promotion: 0, returnCost: 0, revenueAds: 0, clicks: 0, ...v };
  // Profit đúng công thức listFbaDaily; netProfit trừ phí dịch vụ giả lập 10/ngày
  const profit = base.revenue - base.adsFee - base.basecost - base.amazonFee - base.tax - base.promotion - base.returnCost;
  return { date, ...base, profit, netProfit: profit - 10 };
}

const cur: AccountingMetricRow = summarizeDays([
  day("2026-10-01", { revenue: 1000, adsFee: 150, basecost: 300, amazonFee: 200, tax: 30, promotion: 10, returnCost: 20, revenueAds: 500, quantity: 40, orders: 35 }),
  day("2026-10-02", { revenue: 800, adsFee: 120, basecost: 250, amazonFee: 160, tax: 25, promotion: 5, returnCost: 0, revenueAds: 400, quantity: 30, orders: 28 }),
]);
const prev: AccountingMetricRow = summarizeDays([
  day("2026-09-01", { revenue: 900, adsFee: 90, basecost: 260, amazonFee: 180, tax: 25, promotion: 0, returnCost: 40, revenueAds: 450, quantity: 36, orders: 30 }),
  day("2026-09-02", { revenue: 950, adsFee: 95, basecost: 270, amazonFee: 190, tax: 26, promotion: 0, returnCost: 0, revenueAds: 470, quantity: 37, orders: 33 }),
]);

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test("danh mục kế toán: chỉ số dẫn xuất khớp đúng công thức trên dữ liệu thật của Dashboard", () => {
  for (const def of accountingMetrics.list()) {
    if (def.kind === "derived") {
      const recomputed = def.terms.reduce((s, t) => s + t.sign * accountingMetrics.require(t.metric).value(cur), 0);
      close(def.value(cur), recomputed);
    }
    if (def.kind === "ratio") {
      const d = accountingMetrics.require(def.denominator).value(cur);
      const n = accountingMetrics.require(def.numerator).value(cur);
      close(def.value(cur), d > 0 ? n / d : 0);
    }
  }
});

test("danh mục tìm được chỉ số theo tên tiếng Việt không dấu / có dấu", () => {
  assert.equal(accountingMetrics.find("lợi nhuận")?.id, "profit");
  assert.equal(accountingMetrics.find("loi nhuan")?.id, "profit");
  assert.equal(accountingMetrics.find("Giá vốn")?.id, "basecost");
  assert.equal(accountingMetrics.find("TACOS")?.id, "tacos");
  assert.equal(accountingMetrics.find("tiền về")?.id, "payout");
  assert.equal(accountingMetrics.find("không có"), undefined);
});

test("registry chặn tham chiếu sai, vòng lặp và alias trùng", () => {
  const base = (id: string, aliases: string[] = []): MetricDefinition<Record<string, number>> =>
    ({ id, kind: "base", label: id, aliases, unit: "usd", description: "", value: (r) => r[id] });
  assert.throws(() =>
    createMetricRegistry([{ id: "x", kind: "derived", label: "x", aliases: [], unit: "usd", description: "", formula: "", terms: [{ metric: "missing", sign: 1 }], value: () => 0 }]),
  /không tồn tại/);
  assert.throws(() =>
    createMetricRegistry([
      { id: "a", kind: "derived", label: "a", aliases: [], unit: "usd", description: "", formula: "", terms: [{ metric: "b", sign: 1 }], value: () => 0 },
      { id: "b", kind: "derived", label: "b", aliases: [], unit: "usd", description: "", formula: "", terms: [{ metric: "a", sign: 1 }], value: () => 0 },
    ]),
  /vòng lặp/);
  assert.throws(() => createMetricRegistry([base("a", ["doanh thu"]), base("b", ["Doanh Thu"])]), /dùng cho cả/);
});

test("explain: thành phần của Profit cộng lại đúng Profit", () => {
  const out = explainMetric(accountingMetrics, accountingMetrics.require("profit"), cur);
  assert.equal(out.value, Math.round(cur.profit * 100) / 100);
  assert.equal(out.components?.length, 7);
  assert.equal(out.formulaCheck, 0);
});

test("compare: drivers của Profit cộng đúng bằng mức thay đổi, xếp theo độ lớn", () => {
  const out = compareMetric(accountingMetrics, accountingMetrics.require("profit"), cur, prev);
  const drivers = out.drivers ?? [];
  const sum = drivers.reduce((s, d) => s + d.contribution, 0);
  close(sum, out.delta, 0.05);
  for (let i = 1; i < drivers.length; i++) {
    assert.ok(Math.abs(drivers[i - 1].contribution) >= Math.abs(drivers[i].contribution));
  }
});

test("compare: tỷ lệ (Margin, TACOS, ACOS, ROI) — drivers cộng đúng bằng thay đổi tỷ lệ", () => {
  for (const id of ["margin", "tacos", "acos", "roi", "netMargin"]) {
    const def = accountingMetrics.require(id);
    const out = compareMetric(accountingMetrics, def, cur, prev);
    const exact = def.value(cur) - def.value(prev);
    const sum = (out.drivers ?? []).reduce((s, d) => s + d.contribution, 0);
    close(sum, exact, 0.0005);
  }
});

test("compare: mẫu số = 0 thì không bóc tách tỷ lệ mà ghi chú", () => {
  const zero = summarizeDays([]);
  const out = compareMetric(accountingMetrics, accountingMetrics.require("margin"), cur, zero);
  assert.equal(out.drivers, undefined);
  assert.match(out.note ?? "", /bằng 0/);
});

const segs = (rows: [string, AccountingMetricRow][]) => rows.map(([key, row]) => ({ key, label: key, row }));
const storeA = summarizeDays([day("d", { revenue: 1200, adsFee: 100, basecost: 400, amazonFee: 250, revenueAds: 600 })]);
const storeB = summarizeDays([day("d", { revenue: 600, adsFee: 170, basecost: 150, amazonFee: 110, revenueAds: 300 })]);
const total = summarizeDays([
  day("d1", { revenue: 1200, adsFee: 100, basecost: 400, amazonFee: 250, revenueAds: 600 }),
  day("d2", { revenue: 600, adsFee: 170, basecost: 150, amazonFee: 110, revenueAds: 300 }),
]);

test("breakdown cộng được: tỷ trọng các store cộng = 100%, không có phần chưa gán", () => {
  const out = breakdownMetric(accountingMetrics, accountingMetrics.require("revenue"), segs([["A", storeA], ["B", storeB]]), total);
  assert.equal(out.unallocated, 0);
  close(out.segments.reduce((s, x) => s + (x.share ?? 0), 0), 1, 1e-3);
});

test("breakdown tỷ lệ: impact các store cộng = 0 (so với trung bình), store kéo TACOS lên đứng đầu", () => {
  const out = breakdownMetric(accountingMetrics, accountingMetrics.require("tacos"), segs([["A", storeA], ["B", storeB]]), total);
  close(out.segments.reduce((s, x) => s + (x.impact ?? 0), 0), 0, 1e-3);
  const b = out.segments.find((s) => s.key === "B");
  const a = out.segments.find((s) => s.key === "A");
  assert.ok((b?.impact ?? 0) > 0, "B (TACOS 28%) kéo TACOS chung lên");
  assert.ok((a?.impact ?? 0) < 0, "A (TACOS 8%) kéo TACOS chung xuống");
});

test("compareBreakdown: đóng góp theo store cộng đúng thay đổi (cả chỉ số cộng được và tỷ lệ)", () => {
  const prevA = summarizeDays([day("d", { revenue: 1000, adsFee: 90, basecost: 350, amazonFee: 200, revenueAds: 500 })]);
  const prevB = summarizeDays([day("d", { revenue: 700, adsFee: 80, basecost: 180, amazonFee: 120, revenueAds: 350 })]);
  const prevTotal = summarizeDays([
    day("d1", { revenue: 1000, adsFee: 90, basecost: 350, amazonFee: 200, revenueAds: 500 }),
    day("d2", { revenue: 700, adsFee: 80, basecost: 180, amazonFee: 120, revenueAds: 350 }),
  ]);
  for (const id of ["profit", "margin", "tacos"]) {
    const def = accountingMetrics.require(id);
    const out = compareBreakdown(
      accountingMetrics,
      def,
      segs([["A", storeA], ["B", storeB]]),
      segs([["A", prevA], ["B", prevB]]),
      { current: total, previous: prevTotal },
    );
    const sum = out.segments.reduce((s, x) => s + x.contribution, 0);
    close(sum, def.value(total) - def.value(prevTotal), id === "profit" ? 0.05 : 0.0005);
    if (def.kind === "ratio") {
      for (const s of out.segments) close((s.rateEffect ?? 0) + (s.mixEffect ?? 0), s.contribution, 0.0002);
    }
  }
});

test("compareBreakdown tỷ lệ: store mới xuất hiện / biến mất vẫn cộng đúng thay đổi", () => {
  const def = accountingMetrics.require("margin");
  const prevOnly = summarizeDays([day("d", { revenue: 500, adsFee: 50, basecost: 100, amazonFee: 80 })]);
  const prevTotal = summarizeDays([
    day("d1", { revenue: 1200, adsFee: 100, basecost: 400, amazonFee: 250, revenueAds: 600 }),
    day("d2", { revenue: 500, adsFee: 50, basecost: 100, amazonFee: 80 }),
  ]);
  const out = compareBreakdown(
    accountingMetrics,
    def,
    segs([["A", storeA], ["B", storeB]]),
    segs([["A", storeA], ["C", prevOnly]]),
    { current: total, previous: prevTotal },
  );
  const sum = out.segments.reduce((s, x) => s + x.contribution, 0);
  close(sum, def.value(total) - def.value(prevTotal), 0.0005);
});
