import assert from "node:assert/strict";
import test from "node:test";

import { resolveDashboardPeriods } from "../lib/accounting/dashboard-periods";

test("month-to-date compares against the same days of the previous month", () => {
  const p = resolveDashboardPeriods("2026-10-01", "2026-10-25", "2026-10-25");
  assert.deepEqual(p.current, { startDate: "2026-10-01", endDate: "2026-10-25" });
  assert.deepEqual(p.previous, { startDate: "2026-09-01", endDate: "2026-09-25" });
  assert.equal(p.trendStartDate, "2026-05-01");
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
