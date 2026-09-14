import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { createMockAmazonSearchTermExcel, generateMockSearchTerms } from "../lib/ppc/mock-data-generator";
import { parseSearchTermWorkbook } from "../lib/ppc/parser";
import {
  calculatePpcSummary,
  generatePpcAlerts,
  generatePpcRecommendations,
  groupPpcByMatchType,
} from "../lib/ppc/analytics";

test("PPC analytics correctly calculates CTR and CVR without confusion", () => {
  const mockTerms = generateMockSearchTerms();
  const summary = calculatePpcSummary(mockTerms, 25.0);

  // Impressions > clicks
  assert.ok(summary.totalImpressions > summary.totalClicks);
  // Clicks > orders
  assert.ok(summary.totalClicks > summary.totalOrders);
  // CTR = clicks / impressions
  const expectedCtr = Math.round((summary.totalClicks / summary.totalImpressions) * 10000) / 10000;
  assert.equal(summary.overallCtr, expectedCtr);
  // CVR = orders / clicks
  const expectedCvr = Math.round((summary.totalOrders / summary.totalClicks) * 10000) / 10000;
  assert.equal(summary.overallCvr, expectedCvr);
  // Blended ACOS = (spend / sales) * 100
  const expectedAcos = Math.round((summary.totalSpend / summary.totalSales) * 1000) / 10;
  assert.equal(summary.blendedAcos, expectedAcos);
});

test("PPC Alert engine detects bleeding keywords and high ACOS", () => {
  const mockTerms = generateMockSearchTerms();
  const alerts = generatePpcAlerts(mockTerms, 25.0);

  // Must detect bleeding keywords (clicks >= 9 and orders == 0)
  const bleedingAlerts = alerts.filter((a) => a.alertType === "BLEEDING_KEYWORD");
  assert.ok(bleedingAlerts.length >= 2);

  // Must detect high ACOS
  const highAcosAlerts = alerts.filter((a) => a.alertType === "HIGH_ACOS");
  assert.ok(highAcosAlerts.length >= 1);
});

test("PPC Recommendation engine suggests negative keywords and bid decreases", () => {
  const mockTerms = generateMockSearchTerms();
  const recs = generatePpcRecommendations(mockTerms, 25.0);

  const negRecs = recs.filter((r) => r.recType === "NEGATIVE_KEYWORD");
  assert.ok(negRecs.length >= 2);

  const bidRecs = recs.filter((r) => r.recType === "BID_DECREASE");
  assert.ok(bidRecs.length >= 1);
  for (const b of bidRecs) {
    assert.ok(b.recommendedBid! < b.currentBid!);
  }

  const harvestRecs = recs.filter((r) => r.recType === "HARVEST_KEYWORD");
  assert.ok(harvestRecs.length >= 1);
});

test("PPC Excel Parser accurately parses generated Amazon Excel format", async () => {
  const buffer = await createMockAmazonSearchTermExcel("Bozspacer");
  const parsed = await parseSearchTermWorkbook(buffer, "Bozspacer");

  assert.ok(parsed.length >= 6);
  for (const row of parsed) {
    assert.equal(row.storeName, "Bozspacer");
    assert.ok(row.impressions >= row.clicks);
    if (row.orders === 0 && row.clicks >= 9) {
      assert.equal(row.acos, 999.0);
    }
  }
});

test("PPC parser finds a delayed header, parses formatted numbers, and prefers 14-day attribution", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Report");
  sheet.addRow(["Amazon Ads Search Term report"]);
  sheet.addRow([]);
  sheet.addRow([
    "Date", "Portfolio name", "Campaign Name", "Ad Group Name", "Targeting",
    "Match Type", "Customer Search Term", "Impressions", "Clicks", "Spend",
    "7 Day Total Sales", "14 Day Total Sales", "14 Day Total Orders", "14 Day Total Units",
  ]);
  sheet.addRow([
    "09/14/2026", "SKU-1", "Campaign A", "Group A", "keyword", "Exact", "customer term",
    "1,234", "12", "$10.50", "$20.00", "$30.00", "3", "4",
  ]);
  const parsed = await parseSearchTermWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), "Store A");
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].reportDate, "2026-09-14");
  assert.equal(parsed[0].impressions, 1234);
  assert.equal(parsed[0].sales, 30);
  assert.equal(parsed[0].orders, 3);
});

test("PPC parser removes repeated rows copied into breakdown sheets", async () => {
  const workbook = new ExcelJS.Workbook();
  for (const name of ["Tong Hop", "Exact"]) {
    const sheet = workbook.addWorksheet(name);
    sheet.addRow(["Date", "Portfolio", "Campaign Name", "Customer Search Term", "Match Type", "Clicks", "Spend"]);
    sheet.addRow(["2026-09-14", "SKU-1", "Campaign A", "same term", "Exact", 2, 1.5]);
  }
  const parsed = await parseSearchTermWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), "Store A");
  assert.equal(parsed.length, 1);
});

test("PPC match type breakdown keeps product targeting separate from auto", () => {
  const row = { ...generateMockSearchTerms()[0], matchType: "Targeting" as const };
  const breakdown = groupPpcByMatchType([row]);
  assert.equal(breakdown.find((item) => item.matchType === "Targeting")?.spend, row.spend);
  assert.equal(breakdown.find((item) => item.matchType === "Auto")?.spend, 0);
});
