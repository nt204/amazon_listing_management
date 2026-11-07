import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardDay } from "../lib/accounting/dashboard-totals";
import type { ChannelSeriesInput } from "../lib/accounting/daily-report-analysis";
import { buildTeamReport, buildTeamReportCard, buildTeamReportText, sameDayLastMonth } from "../lib/accounting/daily-team-report";

function day(date: string, values: Partial<DashboardDay>): DashboardDay {
  return {
    date, revenue: 0, quantity: 0, orders: 0, adsFee: 0, basecost: 0, amazonFee: 0, tax: 0,
    promotion: 0, returnCost: 0, profit: 0, netProfit: 0, revenueAds: 0, clicks: 0, ...values,
  };
}

function channel(label: string, team: string, days: DashboardDay[]): ChannelSeriesInput {
  return { label, storeName: label, channel: team === "FBM" ? "FBM" : "FBA", team, isNew: false, days };
}

test("cùng ngày tháng trước: giữ ngày, tháng ngắn hơn thì lấy cuối tháng, qua năm", () => {
  assert.equal(sameDayLastMonth("2026-11-06"), "2026-10-06");
  assert.equal(sameDayLastMonth("2026-03-31"), "2026-02-28");
  assert.equal(sameDayLastMonth("2026-01-15"), "2025-12-15");
});

test("số theo team và tổng, so với hôm qua và cùng ngày tháng trước", () => {
  const r = buildTeamReport("2026-11-06", [
    channel("A", "FBA 1", [
      day("2026-11-06", { revenue: 1200, orders: 30, profit: 300 }),
      day("2026-11-05", { revenue: 1000, orders: 25, profit: 250 }),
      day("2026-10-06", { revenue: 800, orders: 20, profit: 100 }),
    ]),
    channel("B", "FBM", [day("2026-11-06", { revenue: 500, orders: 10, profit: -50 })]),
  ]);
  assert.deepEqual(r.teams.map((t) => t.name), ["FBA 1", "FBM"]);
  assert.equal(r.company.today.revenue, 1700);
  assert.equal(r.company.yesterday.revenue, 1000);
  assert.equal(r.company.lastMonth.revenue, 800);

  const text = buildTeamReportText(r, { teamLeads: { "FBA 1": "Quỳnh" } });
  assert.match(text, /FBA 1 · Quỳnh · 1 store/);
  assert.match(text, /FBA 1 · Quỳnh · 1 store\n\n▸ A\nRevenue \$1,200 — hôm qua ▲20% · tháng trước ▲50%\nProfit \$300 — hôm qua ▲\$50 · tháng trước ▲\$200/);
  assert.match(text, /Margin 25\.0% — hôm qua 0\.0% · tháng trước ▲12\.5%/);
  // FBM không có số hôm qua → không bịa Δ
  assert.match(text, /Revenue \$500 — hôm qua không có dữ liệu · tháng trước không có dữ liệu/);
  // Điểm cần chú ý: tổng công ty và team tăng Profit
  assert.match(text, /ĐIỂM CẦN CHÚ Ý[\s\S]*Tổng công ty: Profit tăng \$0 so với hôm qua/);
  // Điểm cần chú ý nói về store, không nói về team
  assert.match(text, /A \(FBA 1\): Profit tăng \$50 so với hôm qua/);

  const card = buildTeamReportCard(r) as { body: { elements: Array<{ tag: string }> } };
  // Bảng tổng công ty + mỗi team 1 bảng (hàng = store)
  assert.equal(card.body.elements.filter((e) => e.tag === "table").length, 1 + r.teams.length);
});

test("store không có số: báo thiếu ở đầu, không có chỉ số cố định", () => {
  const r = buildTeamReport("2026-11-05", [channel("A", "FBA 1", [day("2026-11-05", { revenue: 100 })])]);
  const opts = { missingStores: [{ name: "Everphant", team: "FBA 2 / FBM", lastDate: "2026-10-28" }] };
  const text = buildTeamReportText(r, opts);
  assert.match(text, /Thiếu dữ liệu 1 store: Everphant \(dữ liệu cuối 28\/10\)\. Không tính vào tổng\./);
  assert.match(text, /Everphant: Thiếu dữ liệu từ 29\/10 → Cần cập nhật/);
  assert.doesNotMatch(text, /Basecost|Amazon Fee/);
  const card = buildTeamReportCard(r, opts) as { body: { elements: Array<{ content?: string }> } };
  assert.match(card.body.elements[0].content!, /Thiếu dữ liệu 1 store/);
});

test("gom theo team: store theo trang Stores, store không có số ghi không có dữ liệu", () => {
  const r = buildTeamReport(
    "2026-11-05",
    [{ ...channel("FASTPEACE", "FBA 2", [day("2026-11-05", { revenue: 300, profit: 60 })]), label: "Fastpeace-FBA" }],
    [
      { name: "FASTPEACE", team: "FBA 2 / FBM" },
      { name: "EVERPHANT", team: "FBA 2 / FBM" },
    ],
  );
  assert.deepEqual(r.teams.map((t) => t.name), ["FBA 2", "FBM"]);
  assert.deepEqual(r.teams[0].stores.map((s) => [s.name, s.data !== null]), [["Fastpeace", true], ["Everphant", false]]);
  const text = buildTeamReportText(r);
  assert.match(text, /FBA 2 · 2 store\n\n▸ Fastpeace\nRevenue \$300[\s\S]*\n\n▸ Everphant: không có dữ liệu/);
  // FBM: cả 2 store đều không có số; không có số liệu cấp team
  assert.match(text, /FBM · 2 store\n\n▸ Everphant: không có dữ liệu\n\n▸ Fastpeace: không có dữ liệu/);
});
