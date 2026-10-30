import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardDay } from "../lib/accounting/dashboard-totals";
import {
  analyzeDailyReport,
  shiftIsoDate,
  type ChannelSeriesInput,
} from "../lib/accounting/daily-report-analysis";
import { buildDailyReportCard, buildDailyReportText } from "../lib/accounting/daily-report-card";

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

test("kênh ổn định thì đèn xanh, không có việc cần làm", () => {
  const a = analyzeDailyReport(DATE, [channel("A", "FBA 1", normal, normal)]);
  assert.equal(a.teams[0].channels[0].light, "green");
  assert.equal(a.company.light, "green");
  assert.deepEqual(a.actions, []);
});

test("lỗ thì đèn đỏ và có việc cần làm", () => {
  const a = analyzeDailyReport(DATE, [channel("A", "FBA 1", normal, { revenue: 400, adsFee: 300, revenueAds: 200, profit: -120 })]);
  assert.equal(a.teams[0].channels[0].light, "red");
  assert.match(a.actions[0].text, /lỗ \$120/);
});

test("Ads = 0 bất thường: cảnh báo thiếu số Ads thay vì khen profit tăng", () => {
  const a = analyzeDailyReport(DATE, [channel("A", "FBA 1", normal, { ...normal, adsFee: 0, revenueAds: 0, profit: 400 })]);
  const ch = a.teams[0].channels[0];
  assert.equal(ch.adsMissing, true);
  assert.equal(ch.light, "yellow");
  assert.equal(a.actions.length, 1);
  assert.match(a.actions[0].text, /chưa có chi phí Ads/);
});

test("TACoS tăng mạnh thì báo số tiền Ads tốn thêm", () => {
  const a = analyzeDailyReport(DATE, [channel("A", "FBA 1", normal, { ...normal, adsFee: 250, profit: 150 })]);
  assert.ok(a.actions.some((x) => /Ads tốn thêm ~\$100/.test(x.text)));
});

test("kênh mới không chấm vào việc cần làm, gom vào mục kênh mới", () => {
  const a = analyzeDailyReport(DATE, [
    channel("A", "FBA 1", normal, normal),
    channel("B", "FBA 1", { revenue: 50, adsFee: 40, profit: -10 }, { revenue: 20, adsFee: 40, profit: -30 }, { isNew: true }),
  ]);
  assert.equal(a.newChannels.length, 1);
  assert.deepEqual(a.actions, []);
});

test("phân rã profit theo kênh và gộp team", () => {
  const a = analyzeDailyReport(DATE, [
    channel("A", "FBA 1", normal, { ...normal, profit: 400 }),
    channel("B", "FBA 2", normal, { ...normal, profit: 100 }),
  ]);
  assert.deepEqual(a.drivers.up.map((d) => [d.label, d.delta]), [["A", 150]]);
  assert.deepEqual(a.drivers.down.map((d) => [d.label, d.delta]), [["B", -150]]);
  assert.deepEqual(a.teams.map((t) => t.team), ["FBA 1", "FBA 2"]);
});

test("card và text dựng được, có tên trưởng team và nhận xét AI", () => {
  const a = analyzeDailyReport(DATE, [channel("A", "FBA 1", normal, normal)]);
  const options = { teamLeads: { "FBA 1": "Quỳnh" }, teamComments: { "FBA 1": "Ổn định." } };
  const card = JSON.stringify(buildDailyReportCard(a, options));
  assert.match(card, /FBA 1 · Quỳnh/);
  assert.match(card, /Ổn định\./);
  assert.match(buildDailyReportText(a, options), /Thứ 4, 28\/10\/2026/);
});
