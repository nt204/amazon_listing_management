import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { createMockAmazonSearchTermExcel, generateMockSearchTerms } from "../lib/ppc/mock-data-generator";
import { inferPpcReportCoverage, parseBulkWorkbook, parseSearchTermCsv, parseSearchTermWorkbook } from "../lib/ppc/parser";
import {
  calculatePerformanceSummary,
  calculatePpcSummary,
  generatePpcAlerts,
  generatePpcRecommendations,
  generateTargetBidRecommendations,
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

test("PPC Recommendation engine never fabricates bids from observed CPC", () => {
  const mockTerms = generateMockSearchTerms();
  const recs = generatePpcRecommendations(mockTerms, 25.0);

  const negRecs = recs.filter((r) => r.recType === "NEGATIVE_KEYWORD");
  assert.ok(negRecs.length >= 2);

  const bidRecs = recs.filter((r) => r.recType === "BID_DECREASE" || r.recType === "BID_INCREASE");
  assert.equal(bidRecs.length, 0);

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

test("PPC Excel parser does not invent today's date when report date is absent", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Report");
  sheet.addRow(["Campaign Name", "Customer Search Term", "Clicks", "Spend"]);
  sheet.addRow(["Campaign A", "real term", 2, 1.5]);
  const parsed = await parseSearchTermWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), "Store A");
  assert.equal(parsed.length, 0);
});

test("PPC match type breakdown keeps product targeting separate from auto", () => {
  const row = { ...generateMockSearchTerms()[0], matchType: "Targeting" as const };
  const breakdown = groupPpcByMatchType([row]);
  assert.equal(breakdown.find((item) => item.matchType === "Targeting")?.spend, row.spend);
  assert.equal(breakdown.find((item) => item.matchType === "Auto")?.spend, 0);
});

test("PPC CSV parser reads real Amazon Search Term columns without trusting percentage fields", () => {
  const csv = [
    "Budget currency,Date range,Advertiser account name,Portfolio name,Campaign ID,Campaign name,Ad group ID,Ad group name,Search term,Impressions,Clicks,CTR,Total cost,Purchases,Sales,Units sold,ROAS",
    'USD,"Aug 15, 2026 - Sep 13, 2026",HSOSTORE,SKU-1,"=""123""",Campaign A,"=""456""",Group A,real customer query,423,1,99.99%,1.33,0,0.00,0,0',
  ].join("\n");
  const parsed = parseSearchTermCsv(Buffer.from(csv), "HSOSTORE");
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].reportStartDate, "2026-08-15");
  assert.equal(parsed[0].reportEndDate, "2026-09-13");
  assert.equal(parsed[0].reportGranularity, "RANGE");
  assert.equal(parsed[0].reportDate, "2026-09-13");
  assert.equal(parsed[0].customerSearchTerm, "real customer query");
  assert.equal(parsed[0].targetKeyword, "");
  assert.equal(parsed[0].matchType, "Unknown");
  assert.equal(parsed[0].ctr, Math.round((1 / 423) * 1_000_000) / 1_000_000);
  assert.equal(parsed[0].acos, 999);
  assert.equal(parsed[0].campaignId, "123");
});

test("Bulk parser preserves entity grains and current executable state", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sponsored Products Campaigns");
  sheet.addRow([
    "Product", "Entity", "Campaign ID", "Ad Group ID", "Keyword ID",
    "Campaign Name (Informational only)", "Ad Group Name (Informational only)",
    "Targeting Type", "State", "Daily Budget", "Bid", "Keyword Text", "Match Type",
    "Impressions", "Clicks", "Spend", "Sales", "Orders", "Units",
  ]);
  sheet.addRow(["Sponsored Products", "Campaign", "100", "", "", "Campaign A", "", "Manual", "enabled", 25, "", "", "", 1000, 20, 20, 100, 4, 4]);
  sheet.addRow(["Sponsored Products", "Keyword", "100", "200", "300", "Campaign A", "Group A", "", "enabled", "", 0.75, "yoga ornament", "exact", 800, 16, 15, 90, 3, 3]);
  sheet.addRow(["Sponsored Products", "Negative Keyword", "100", "200", "301", "Campaign A", "Group A", "", "enabled", "", "", "free yoga", "negativeExact", 0, 0, 0, 0, 0, 0]);

  const rows = await parseBulkWorkbook(
    Buffer.from(await workbook.xlsx.writeBuffer()),
    "Store A",
    { ...inferPpcReportCoverage("Bulk SP 30 Day 2026-09-14.xlsx"), adType: "SP" },
  );
  assert.equal(rows.length, 3);
  assert.equal(rows.find((row) => row.grain === "CAMPAIGN")?.dailyBudget, 25);
  const target = rows.find((row) => row.grain === "TARGET");
  assert.equal(target?.targetId, "300");
  assert.equal(target?.bid, 0.75);
  assert.equal(target?.targetExpression, "yoga ornament");
  assert.equal(target?.adType, "SP");
  assert.equal(rows.find((row) => row.targetId === "301")?.isNegative, true);
});

test("Bid recommendations use Bulk current bid and enforce a bounded delta", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sponsored Products Campaigns");
  sheet.addRow(["Product", "Entity", "Campaign ID", "Ad Group ID", "Keyword ID", "Campaign Name", "Ad Group Name", "State", "Bid", "Keyword Text", "Match Type", "Impressions", "Clicks", "Spend", "Sales", "Orders", "Units"]);
  sheet.addRow(["Sponsored Products", "Keyword", "100", "200", "300", "Campaign A", "Group A", "enabled", 1, "winner", "exact", 1000, 25, 15, 100, 4, 4]);
  const rows = await parseBulkWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), "Store A", { ...inferPpcReportCoverage("30 Day 2026-09-14"), adType: "SP" });
  const recs = generateTargetBidRecommendations(rows, 30);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].recType, "BID_INCREASE");
  assert.equal(recs[0].currentBid, 1);
  assert.equal(recs[0].recommendedBid, 1.15);
});

test("Executive totals only use campaign grain and never sum target rows", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sponsored Products Campaigns");
  sheet.addRow(["Product", "Entity", "Campaign ID", "Keyword ID", "Campaign Name", "Keyword Text", "Impressions", "Clicks", "Spend", "Sales", "Orders", "Units"]);
  sheet.addRow(["Sponsored Products", "Campaign", "100", "", "Campaign A", "", 1000, 20, 20, 100, 4, 4]);
  sheet.addRow(["Sponsored Products", "Keyword", "100", "300", "Campaign A", "term", 1000, 20, 20, 100, 4, 4]);
  const rows = await parseBulkWorkbook(
    Buffer.from(await workbook.xlsx.writeBuffer()),
    "Store A",
    { ...inferPpcReportCoverage("30 Day 2026-09-14"), adType: "SP" },
  );
  const summary = calculatePerformanceSummary(rows.filter((row) => row.grain === "CAMPAIGN"));
  assert.equal(summary.totalSpend, 20);
  assert.equal(summary.totalSales, 100);
  assert.equal(summary.blendedAcos, 20);
});
