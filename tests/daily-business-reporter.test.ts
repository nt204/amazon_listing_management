import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardDay } from "../lib/accounting/dashboard-totals";
import {
  analyzeDailyReport,
  shiftIsoDate,
  type ChannelSeriesInput,
} from "../lib/accounting/daily-report-analysis";
import {
  buildDailyReportCard,
  buildDailyReportDetailText,
  buildDailyReportText,
} from "../lib/accounting/daily-report-card";
import { parseDailyReportDetailRequest } from "../lib/accounting/daily-business-reporter";

const DATE = "2026-10-28";

function day(date: string, values: Partial<DashboardDay>): DashboardDay {
  return {
    date, revenue: 0, quantity: 0, orders: 0, adsFee: 0, basecost: 0, amazonFee: 0, tax: 0,
    promotion: 0, returnCost: 0, profit: 0, netProfit: 0, revenueAds: 0, clicks: 0, ...values,
  };
}

/** 7 ngày lịch sử giống nhau + ngày báo cáo. */
function channel(
  label: string,
  team: string,
  history: Partial<DashboardDay>,
  today: Partial<DashboardDay>,
  extra: Partial<ChannelSeriesInput> = {},
): ChannelSeriesInput {
  const days = Array.from({ length: 7 }, (_, i) => day(shiftIsoDate(DATE, -(7 - i)), history));
  days.push(day(DATE, today));
  return { label, storeName: label.toUpperCase(), channel: "FBA", team, isNew: false, days, ...extra };
}

const normal = { revenue: 1000, quantity: 40, adsFee: 150, revenueAds: 500, profit: 250 };

test("kênh ổn định: không có vấn đề, không có ưu tiên", () => {
  const a = analyzeDailyReport(DATE, [channel("A", "FBA 1", normal, normal)]);
  assert.equal(a.teams[0].channels[0].review, null);
  assert.deepEqual(a.priorities, []);
  assert.deepEqual(a.warnings, []);
});

test("mọi Δ Profit cùng một mốc TB 7 ngày: kênh, team, công ty và card khớp nhau", () => {
  const a = analyzeDailyReport(DATE, [
    channel("A", "FBA 2", normal, { ...normal, profit: 170 }),
    channel("B", "FBA 2", normal, { ...normal, profit: 296 }),
  ]);
  const [chA, chB] = a.teams[0].channels;
  assert.equal(chA.profitDelta! + chB.profitDelta!, a.teams[0].today.profit - a.teams[0].avg7!.profit);
  assert.equal(a.teams[0].today.profit - a.teams[0].avg7!.profit, a.company.today.profit - a.company.avg7!.profit);
  // Team -$34 hiện đúng 1 con số ở cả bảng team và KPI tổng
  assert.match(buildDailyReportText(a), /FBA 2: \$466 -\$34/);
  assert.match(buildDailyReportText(a), /Profit \$466 -\$34/);
});

test("số ưu tiên ở tiêu đề khớp đúng số vấn đề được liệt kê", () => {
  const a = analyzeDailyReport(DATE, [
    channel("A", "FBA 1", normal, { ...normal, profit: -100 }),
    channel("B", "FBA 1", normal, { ...normal, profit: 100 }),
    channel("C", "FBA 2", normal, { ...normal, profit: 150 }),
    channel("D", "FBA 3", normal, { ...normal, profit: 170 }),
  ]);
  const card = buildDailyReportCard(a) as { header: { subtitle: { content: string } } };
  const listed = (buildDailyReportText(a).match(/^[🔴🟡] /gmu) ?? []).length;
  assert.equal(listed, a.priorities.length);
  assert.match(card.header.subtitle.content, new RegExp(`${a.priorities.length} ưu tiên`));
  // Xếp theo $ ảnh hưởng: lỗ nặng nhất lên đầu
  assert.equal(a.priorities[0].label, "A");
});

test("dữ kiện có số tách khỏi việc cần kiểm tra (giả thuyết)", () => {
  const drill = { skus: [{ sku: "NSA6012062421", today: 0, avg7: 3.6 }], portfolios: [] };
  const a = analyzeDailyReport(DATE, [
    channel("Bozspacer", "FBA 1", normal, { ...normal, revenue: 552, revenueAds: 500, quantity: 22, profit: 41 }, { drill }),
  ]);
  const review = a.priorities[0].review!;
  assert.ok(review.facts.includes("Organic -$448"));
  assert.ok(review.facts.includes("SKU NSA6012062421 3.6 → 0 units/ngày"));
  assert.deepEqual(review.checks.slice(0, 2), ["tồn kho", "listing"]);
  assert.match(buildDailyReportText(a), /→ Kiểm tra tồn kho, listing, rank keyword chính\./);
});

test("portfolio tiêu tiền 0 đơn thành hành động cụ thể", () => {
  const drill = {
    skus: [],
    portfolios: [
      { name: "SKU-BURN", todaySpend: 60, todaySales: 0, todayOrders: 0, avg7Spend: 20 },
      { name: "SKU-OK", todaySpend: 190, todaySales: 600, todayOrders: 10, avg7Spend: 130 },
    ],
  };
  const a = analyzeDailyReport(DATE, [channel("A", "FBA 1", normal, { ...normal, adsFee: 250, profit: 150 }, { drill })]);
  const review = a.priorities[0].review!;
  assert.ok(review.facts.includes("Ads $150 → $250/ngày"));
  assert.deepEqual(review.actions, ["Giảm bid / tắt SKU-BURN ($60, 0 đơn)"]);
});

test("thiếu số Ads: cảnh báo trước, không so Profit, không đưa vào ưu tiên", () => {
  const a = analyzeDailyReport(DATE, [
    channel("A", "FBA 1", normal, { ...normal, adsFee: 0, revenueAds: 0, profit: 400 }),
    channel("B", "FBA 1", normal, normal),
  ]);
  assert.equal(a.warnings.length, 1);
  assert.match(a.warnings[0], /^A: chưa có số Ads/);
  assert.equal(a.teams[0].channels.find((c) => c.label === "A")?.profitDelta, null);
  assert.equal(a.company.comparable, false);
  assert.deepEqual(a.priorities, []);
  assert.match(buildDailyReportText(a), /Profit \$650 n\/a/);
});

test("doanh thu $0 nhưng vẫn tiêu Ads: ưu tiên cao, nghi thiếu file đơn hàng", () => {
  const a = analyzeDailyReport(DATE, [channel("Limima", "FBA 2", normal, { adsFee: 383, profit: -422 })]);
  const review = a.priorities[0].review!;
  assert.equal(review.severity, "high");
  assert.deepEqual(review.facts, ["Revenue $0 (TB $1,000/ngày)", "Ads vẫn tiêu $383"]);
  assert.equal(review.checks[0], "file đơn hàng đã nạp chưa");
});

test("kênh mới không vào ưu tiên; tăng trưởng tốt vào mục nổi bật", () => {
  const a = analyzeDailyReport(DATE, [
    channel("Up", "FBA 1", normal, { ...normal, profit: 616 }),
    channel("New", "FBM", { revenue: 50, adsFee: 40, profit: -10 }, { revenue: 20, adsFee: 40, profit: -30 }, { isNew: true }),
  ]);
  assert.deepEqual(a.priorities, []);
  assert.deepEqual(a.highlights, [{ label: "Up", delta: 366 }]);
  assert.match(buildDailyReportDetailText(a), /New 🌱/);
});

test("nhận diện lệnh xin bản chi tiết", () => {
  const now = new Date("2026-10-31T03:00:00Z");
  assert.deepEqual(parseDailyReportDetailRequest("báo cáo chi tiết", now), {});
  assert.deepEqual(parseDailyReportDetailRequest("Gửi chi tiết báo cáo 28/10", now), { date: "2026-10-28" });
  assert.equal(parseDailyReportDetailRequest("store nào cần chú ý", now), null);
});
