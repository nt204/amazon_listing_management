import assert from "node:assert/strict";
import test from "node:test";

import {
  dashboardChartGranularity,
  dashboardCompareMode,
  dashboardPresetRange,
  dashboardRangeUnit,
  previousMonthRange,
  resolveDashboardPeriods,
} from "../lib/accounting/dashboard-periods";

test("month-to-date compares against the same days of the previous month", () => {
  const p = resolveDashboardPeriods("2026-10-01", "2026-10-25", "2026-10-25");
  assert.deepEqual(p.current, { startDate: "2026-10-01", endDate: "2026-10-25" });
  assert.deepEqual(p.previous, { startDate: "2026-09-01", endDate: "2026-09-25" });
  // Theo tháng luôn hiện từ tháng 1 của năm
  assert.equal(p.trendStartDate, "2026-01-01");
});

test("current end is clamped to the latest available data date", () => {
  const p = resolveDashboardPeriods("2026-10-01", "2026-10-31", "2026-10-20");
  assert.deepEqual(p.current, { startDate: "2026-10-01", endDate: "2026-10-20" });
  assert.deepEqual(p.previous, { startDate: "2026-09-01", endDate: "2026-09-20" });
});

test("previous month end is clamped to its own length", () => {
  const p = resolveDashboardPeriods("2026-03-01", "2026-03-31", "2026-12-31");
  assert.deepEqual(p.previous, { startDate: "2026-02-01", endDate: "2026-02-28" });
});

test("custom ranges compare against the same number of days right before", () => {
  const p = resolveDashboardPeriods("2026-10-19", "2026-10-25", "2026-10-25");
  assert.deepEqual(p.previous, { startDate: "2026-10-12", endDate: "2026-10-18" });
});

test("long ranges extend the monthly trend back to the range start", () => {
  const p = resolveDashboardPeriods("2025-12-15", "2026-10-25", "2026-10-25");
  assert.equal(p.trendStartDate, "2025-12-01");
});

test("all-time has no previous period", () => {
  const p = resolveDashboardPeriods("", "", "2026-10-25");
  assert.equal(p.previous, null);
  assert.equal(p.trendStartDate, "");
});

test("year-over-year compares the same dates last year", () => {
  const p = resolveDashboardPeriods("2026-10-01", "2026-10-25", "2026-10-25", "yoy");
  assert.deepEqual(p.previous, { startDate: "2025-10-01", endDate: "2025-10-25" });
  const leap = resolveDashboardPeriods("2028-02-01", "2028-02-29", "2028-12-31", "yoy");
  assert.deepEqual(leap.previous, { startDate: "2027-02-01", endDate: "2027-02-28" });
});

test("compare none has no previous period", () => {
  const p = resolveDashboardPeriods("2026-10-01", "2026-10-25", "2026-10-25", "none");
  assert.equal(p.previous, null);
});

test("previous week shifts both ends back seven days", () => {
  const p = resolveDashboardPeriods("2026-10-01", "2026-10-11", "2026-10-25", "week");
  assert.deepEqual(p.previous, { startDate: "2026-09-24", endDate: "2026-10-04" });
});

test("previous month clamps the end to the shorter month", () => {
  const p = resolveDashboardPeriods("2026-10-01", "2026-10-31", "2026-12-31", "month");
  assert.deepEqual(p.previous, { startDate: "2026-09-01", endDate: "2026-09-30" });
});

test("monthly buckets compare a full month with the full previous month", () => {
  assert.deepEqual(previousMonthRange("2026-03-01", "2026-03-31"), { startDate: "2026-02-01", endDate: "2026-02-28" });
  assert.deepEqual(previousMonthRange("2026-02-01", "2026-02-28"), { startDate: "2026-01-01", endDate: "2026-01-31" });
});

test("a partial month compares the same days of the previous month", () => {
  assert.deepEqual(previousMonthRange("2026-10-01", "2026-10-25"), { startDate: "2026-09-01", endDate: "2026-09-25" });
  assert.deepEqual(previousMonthRange("2026-01-01", "2026-01-11"), { startDate: "2025-12-01", endDate: "2025-12-11" });
});

test("same week last year shifts back 52 weeks so weekdays line up", () => {
  const p = resolveDashboardPeriods("2026-10-19", "2026-10-25", "2026-10-25", "yoy_week");
  assert.deepEqual(p.previous, { startDate: "2025-10-20", endDate: "2025-10-26" });
});

test("monthly buckets can compare with the same month last year", () => {
  assert.deepEqual(previousMonthRange("2026-10-01", "2026-10-25", 12), { startDate: "2025-10-01", endDate: "2025-10-25" });
  assert.deepEqual(previousMonthRange("2028-02-01", "2028-02-29", 12), { startDate: "2027-02-01", endDate: "2027-02-28" });
});

test("compare day: so với hôm qua, kể cả ngày mùng 1 (không nhảy về tháng trước)", () => {
  const p = resolveDashboardPeriods("2026-11-01", "2026-11-01", "2026-11-09", "day");
  assert.deepEqual(p.previous, { startDate: "2026-10-31", endDate: "2026-10-31" });
});

test("preset decides the period unit, even when the range is still short", () => {
  // This month ngày 5/11: 5 ngày nhưng vẫn là tháng → so với tháng trước, biểu đồ theo tuần
  assert.equal(dashboardRangeUnit("2026-11-01", "2026-11-05", "this_month"), "month");
  assert.equal(dashboardCompareMode("month", "prev"), "month");
  assert.equal(dashboardChartGranularity("month", "2026-11-01", "2026-11-05"), "week");
  // This week đúng Chủ nhật: 1 ngày nhưng vẫn là tuần
  assert.equal(dashboardRangeUnit("2026-11-08", "2026-11-08", "this_week"), "week");
  assert.equal(dashboardCompareMode("week", "prev"), "week");
  // This year trong tháng 1 → năm, so với năm trước, biểu đồ theo tuần khi chưa quá 31 ngày
  assert.equal(dashboardRangeUnit("2027-01-01", "2027-01-10", "this_year"), "year");
  assert.equal(dashboardCompareMode("year", "prev"), "yoy");
  assert.equal(dashboardChartGranularity("year", "2027-01-01", "2027-01-10"), "week");
  assert.equal(dashboardChartGranularity("year", "2026-01-01", "2026-11-09"), "month");
  // Các preset còn lại
  assert.equal(dashboardRangeUnit("2026-11-09", "2026-11-09", "today"), "day");
  assert.equal(dashboardRangeUnit("2026-11-01", "2026-11-07", "last_week"), "week");
  assert.equal(dashboardRangeUnit("2026-10-01", "2026-10-31", "last_month"), "month");
  assert.equal(dashboardRangeUnit("2025-01-01", "2025-12-31", "last_year"), "year");
  assert.equal(dashboardChartGranularity("week", "2026-11-01", "2026-11-07"), "day");
});

test("custom calendar ranges fall back to the range length", () => {
  assert.equal(dashboardRangeUnit("2026-11-03", "2026-11-03"), "day");
  assert.equal(dashboardRangeUnit("2026-11-03", "2026-11-09"), "week");
  assert.equal(dashboardRangeUnit("2026-10-05", "2026-10-28"), "month");
  assert.equal(dashboardRangeUnit("2026-01-01", "2026-03-31"), "year");
  assert.equal(dashboardRangeUnit("", "", "all"), "month");
  assert.equal(dashboardChartGranularity("month", "2026-09-01", "2026-10-31"), "month");
});

test("compare with last year always uses the same calendar dates", () => {
  for (const unit of ["day", "week", "month", "year"] as const) assert.equal(dashboardCompareMode(unit, "yoy"), "yoy");
  assert.equal(dashboardCompareMode("week", null), "none");
  const p = resolveDashboardPeriods("2026-11-01", "2026-11-07", "2026-11-09", dashboardCompareMode("week", "yoy"));
  assert.deepEqual(p.previous, { startDate: "2025-11-01", endDate: "2025-11-07" });
});

test("preset ranges match the date picker (Sunday-based weeks)", () => {
  // 10/11/2026 là thứ Ba
  assert.deepEqual(dashboardPresetRange("today", "2026-11-10"), { startDate: "2026-11-10", endDate: "2026-11-10" });
  assert.deepEqual(dashboardPresetRange("yesterday", "2026-11-01"), { startDate: "2026-10-31", endDate: "2026-10-31" });
  assert.deepEqual(dashboardPresetRange("this_week", "2026-11-10"), { startDate: "2026-11-08", endDate: "2026-11-10" });
  assert.deepEqual(dashboardPresetRange("last_week", "2026-11-10"), { startDate: "2026-11-01", endDate: "2026-11-07" });
  assert.deepEqual(dashboardPresetRange("this_week", "2026-11-08"), { startDate: "2026-11-08", endDate: "2026-11-08" });
  assert.deepEqual(dashboardPresetRange("this_month", "2026-11-10"), { startDate: "2026-11-01", endDate: "2026-11-10" });
  assert.deepEqual(dashboardPresetRange("last_month", "2026-03-10"), { startDate: "2026-02-01", endDate: "2026-02-28" });
  assert.deepEqual(dashboardPresetRange("this_year", "2026-11-10"), { startDate: "2026-01-01", endDate: "2026-11-10" });
  assert.deepEqual(dashboardPresetRange("last_year", "2026-11-10"), { startDate: "2025-01-01", endDate: "2025-12-31" });
  assert.equal(dashboardPresetRange("all", "2026-11-10"), null);
});
