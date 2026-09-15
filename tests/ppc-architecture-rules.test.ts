import test from "node:test";
import assert from "node:assert/strict";
import type { PpcSearchTermRow } from "../lib/ppc/types";
import {
  calculatePpcExecutiveOverview,
  calculatePpcSummary,
  calculatePpcSearchTermSummary,
  calculateHarvestScore,
  groupPpcByCampaign,
  groupPpcByAdGroup,
  groupPpcByTarget,
  adGroupPerformanceFromFacts,
} from "../lib/ppc/analytics";

test("Nguyên tắc 4: Ratios tổng BẮT BUỘC tính từ Raw Totals, không lấy AVG(row ratios)", () => {
  const mockRows: PpcSearchTermRow[] = [
    {
      reportDate: "2026-09-01",
      portfolioName: "SKU-A",
      campaignName: "Camp-1",
      adGroupName: "AG-1",
      targetKeyword: "key 1",
      customerSearchTerm: "term 1",
      matchType: "Exact",
      impressions: 1000,
      clicks: 10,
      spend: 10,
      sales: 100,
      orders: 2,
      units: 2,
      cpc: 1,
      ctr: 0.01,
      cvr: 0.2,
      acos: 10,
      roas: 10,
    },
    {
      reportDate: "2026-09-01",
      portfolioName: "SKU-B",
      campaignName: "Camp-2",
      adGroupName: "AG-2",
      targetKeyword: "key 2",
      customerSearchTerm: "term 2",
      matchType: "Broad",
      impressions: 200,
      clicks: 50,
      spend: 100,
      sales: 150,
      orders: 3,
      units: 3,
      cpc: 2,
      ctr: 0.25,
      cvr: 0.06,
      acos: 66.7,
      roas: 1.5,
    },
  ];

  const summary = calculatePpcSummary(mockRows, 30.0);

  // Raw totals
  const totalSpend = 110;
  const totalSales = 250;
  const totalClicks = 60;
  const totalImpressions = 1200;
  const totalOrders = 5;

  // Tính lại từ raw totals
  const expectedAcos = Number(((totalSpend / totalSales) * 100).toFixed(1)); // 44.0%
  const rowAvgAcos = (10 + 66.7) / 2; // 38.35% (SAI nếu dùng AVG)

  assert.equal(summary.blendedAcos, expectedAcos);
  assert.notEqual(summary.blendedAcos, Number(rowAvgAcos.toFixed(1)));

  // ROAS
  const expectedRoas = Number((totalSales / totalSpend).toFixed(2)); // 2.27
  assert.equal(summary.blendedRoas, expectedRoas);

  // CPC
  const expectedCpc = Number((totalSpend / totalClicks).toFixed(2)); // 1.83
  assert.equal(summary.avgCpc, expectedCpc);

  // CPA (Cost Per Acquisition = Spend / Orders)
  const expectedCpa = Number((totalSpend / totalOrders).toFixed(2)); // 22.00
  assert.equal(summary.cpa, expectedCpa);

  // AOV (Average Order Value = Sales / Orders)
  const expectedAov = Number((totalSales / totalOrders).toFixed(2)); // 50.00
  assert.equal(summary.aov, expectedAov);
});

test("Nguyên tắc 2: Wasted Spend áp dụng ngưỡng kinh tế sản phẩm (không phạt term 1 click $0.40)", () => {
  const testRows: PpcSearchTermRow[] = [
    // Case 1: Search term mới, 1 click, $0.40, 0 order -> KHÔNG phải wasted spend
    {
      reportDate: "2026-09-01",
      portfolioName: "SKU-TEST",
      campaignName: "Camp-1",
      adGroupName: "AG-1",
      targetKeyword: "test",
      customerSearchTerm: "new query 1",
      matchType: "Broad",
      impressions: 50,
      clicks: 1,
      spend: 0.4,
      sales: 0,
      orders: 0,
      units: 0,
      cpc: 0.4,
      ctr: 0.02,
      cvr: 0,
      acos: 0,
      roas: 0,
    },
    // Case 2: Bleeder thực sự, 12 clicks, $10.80, 0 order (clicks >= 10) -> LÀ wasted spend
    {
      reportDate: "2026-09-01",
      portfolioName: "SKU-TEST",
      campaignName: "Camp-1",
      adGroupName: "AG-1",
      targetKeyword: "test",
      customerSearchTerm: "bleeder high clicks",
      matchType: "Broad",
      impressions: 400,
      clicks: 12,
      spend: 10.8,
      sales: 0,
      orders: 0,
      units: 0,
      cpc: 0.9,
      ctr: 0.03,
      cvr: 0,
      acos: 0,
      roas: 0,
    },
    // Case 3: Bleeder chi phí cao, 5 clicks, $16.50, 0 order (spend >= $15) -> LÀ wasted spend
    {
      reportDate: "2026-09-01",
      portfolioName: "SKU-TEST",
      campaignName: "Camp-1",
      adGroupName: "AG-1",
      targetKeyword: "test",
      customerSearchTerm: "bleeder high spend",
      matchType: "Exact",
      impressions: 150,
      clicks: 5,
      spend: 16.5,
      sales: 0,
      orders: 0,
      units: 0,
      cpc: 3.3,
      ctr: 0.03,
      cvr: 0,
      acos: 0,
      roas: 0,
    },
  ];

  const summary = calculatePpcSummary(testRows, 30.0, { minClicksThreshold: 10, maxSpendThreshold: 15.0 });
  const strStats = calculatePpcSearchTermSummary(testRows, { minClicksThreshold: 10, maxSpendThreshold: 15.0 });

  // Tổng spend = 0.4 + 10.8 + 16.5 = 27.7
  assert.equal(summary.totalSpend, 27.7);

  // Wasted spend chỉ tính case 2 và case 3: 10.8 + 16.5 = 27.3 (loại bỏ $0.40 của case 1)
  assert.equal(summary.wastedSpend, 27.3);
  assert.equal(strStats.wastedSpend, 27.3);
  assert.equal(strStats.candidateBleederTerms, 2);
  assert.equal(strStats.termsWithoutOrders, 3);
});

test("Nguyên tắc 3: Harvest Scoring Engine đánh giá đa chiều (HARVEST_SCORE)", () => {
  // Winner: Nhiều đơn hàng, ACOS thấp, volume cao
  const winnerRow: PpcSearchTermRow = {
    reportDate: "2026-09-01",
    portfolioName: "SKU-HERO",
    campaignName: "SP_Auto",
    adGroupName: "Auto Group",
    targetKeyword: "close-match",
    customerSearchTerm: "yoga ornament gift",
    matchType: "Auto",
    impressions: 5000,
    clicks: 120,
    spend: 60,
    sales: 400,
    orders: 16,
    units: 18,
    cpc: 0.5,
    ctr: 0.024,
    cvr: 0.133,
    acos: 15.0,
    roas: 6.67,
  };

  const winnerScore = calculateHarvestScore(winnerRow, 30.0);
  assert.ok(winnerScore >= 75, `Winner score must be high, got: ${winnerScore}`);

  // Low confidence: Term mới có 1 đơn, số click quá ít
  const lowConfidenceRow: PpcSearchTermRow = {
    reportDate: "2026-09-01",
    portfolioName: "SKU-HERO",
    campaignName: "SP_Auto",
    adGroupName: "Auto Group",
    targetKeyword: "close-match",
    customerSearchTerm: "random yoga tag",
    matchType: "Auto",
    impressions: 50,
    clicks: 1,
    spend: 0.5,
    sales: 25,
    orders: 1,
    units: 1,
    cpc: 0.5,
    ctr: 0.02,
    cvr: 1.0,
    acos: 2.0,
    roas: 50.0,
  };

  const lowConfidenceScore = calculateHarvestScore(lowConfidenceRow, 30.0);
  // Điểm số của 1 order không được vượt quá winner có bằng chứng thống kê vững chắc
  assert.ok(
    lowConfidenceScore < winnerScore,
    `Low confidence term (${lowConfidenceScore}) must have lower score than steady winner (${winnerScore})`
  );
});

test("Previous Period Comparison: Tính toán % delta và pts chênh lệch chính xác", () => {
  const curRows: PpcSearchTermRow[] = [
    {
      reportDate: "2026-09-10",
      portfolioName: "SKU-1",
      campaignName: "Camp-1",
      adGroupName: "AG-1",
      targetKeyword: "key",
      customerSearchTerm: "term",
      matchType: "Exact",
      impressions: 1000,
      clicks: 100,
      spend: 120,
      sales: 480,
      orders: 12,
      units: 12,
      cpc: 1.2,
      ctr: 0.1,
      cvr: 0.12,
      acos: 25.0,
      roas: 4.0,
    },
  ];

  const prevRows: PpcSearchTermRow[] = [
    {
      reportDate: "2026-08-25",
      portfolioName: "SKU-1",
      campaignName: "Camp-1",
      adGroupName: "AG-1",
      targetKeyword: "key",
      customerSearchTerm: "term",
      matchType: "Exact",
      impressions: 800,
      clicks: 80,
      spend: 100,
      sales: 350,
      orders: 10,
      units: 10,
      cpc: 1.25,
      ctr: 0.1,
      cvr: 0.125,
      acos: 28.57,
      roas: 3.5,
    },
  ];

  const overview = calculatePpcExecutiveOverview(curRows, prevRows);

  // Spend tăng từ 100 -> 120: +20%
  assert.equal(overview.spend.current, 120);
  assert.equal(overview.spend.previous, 100);
  assert.equal(overview.spend.changePct, 20.0);

  // Sales tăng từ 350 -> 480: +37.1%
  assert.equal(overview.sales.current, 480);
  assert.equal(overview.sales.previous, 350);
  assert.equal(overview.sales.changePct, 37.1);

  // ACOS giảm từ 28.6% -> 25.0%: -3.6 pts
  assert.equal(overview.acos.current, 25.0);
  assert.equal(overview.acos.previous, 28.6);
  assert.equal(overview.acos.changePts, -3.6);
});

test("Grain Separation: Mỗi màn hình có grain riêng, không double-count", () => {
  const rows: PpcSearchTermRow[] = [
    {
      reportDate: "2026-09-01",
      portfolioName: "SKU-A",
      campaignName: "Campaign Alpha",
      adGroupName: "AdGroup 1",
      targetKeyword: "target A",
      customerSearchTerm: "query 1",
      matchType: "Exact",
      impressions: 500,
      clicks: 20,
      spend: 20,
      sales: 100,
      orders: 4,
      units: 4,
      cpc: 1,
      ctr: 0.04,
      cvr: 0.2,
      acos: 20,
      roas: 5,
    },
    {
      reportDate: "2026-09-01",
      portfolioName: "SKU-A",
      campaignName: "Campaign Alpha",
      adGroupName: "AdGroup 1",
      targetKeyword: "target A",
      customerSearchTerm: "query 2",
      matchType: "Exact",
      impressions: 300,
      clicks: 10,
      spend: 10,
      sales: 50,
      orders: 2,
      units: 2,
      cpc: 1,
      ctr: 0.033,
      cvr: 0.2,
      acos: 20,
      roas: 5,
    },
    {
      reportDate: "2026-09-01",
      portfolioName: "SKU-A",
      campaignName: "Campaign Alpha",
      adGroupName: "AdGroup 2",
      targetKeyword: "target B",
      customerSearchTerm: "query 3",
      matchType: "Phrase",
      impressions: 200,
      clicks: 15,
      spend: 15,
      sales: 60,
      orders: 2,
      units: 2,
      cpc: 1,
      ctr: 0.075,
      cvr: 0.133,
      acos: 25,
      roas: 4,
    },
  ];

  // Campaign Grain: 1 row = 1 Campaign
  const campaigns = groupPpcByCampaign(rows);
  assert.equal(campaigns.length, 1);
  assert.equal(campaigns[0].campaignName, "Campaign Alpha");
  assert.equal(campaigns[0].spend, 45);
  assert.equal(campaigns[0].sales, 210);
  assert.equal(campaigns[0].orders, 8);

  // Ad Group Grain: 2 rows = 2 Ad Groups
  const adGroups = groupPpcByAdGroup(rows);
  assert.equal(adGroups.length, 2);

  // Target Grain: 2 rows = 2 Targets
  const targets = groupPpcByTarget(rows);
  assert.equal(targets.length, 2);
});

test("Kiến trúc 5 tầng & Drill-down: adGroupPerformanceFromFacts bóc tách chính xác từ performance facts", () => {
  const mockFacts = [
    {
      storeName: "Warmstorey",
      snapshotDate: "2026-09-15",
      reportGranularity: "RANGE" as const,
      entityId: "ag-1",
      portfolioName: "",
      adType: "SP" as const,
      grain: "AD_GROUP" as const,
      reportStartDate: "2026-09-01",
      reportEndDate: "2026-09-30",
      campaignId: "c-1",
      campaignName: "Yoga Broad",
      adGroupId: "ag-1",
      adGroupName: "Main AdGroup",
      targetId: "",
      targetExpression: "",
      sku: "",
      asin: "",
      matchType: "Broad" as const,
      state: "enabled",
      campaignState: "enabled",
      adGroupState: "enabled",
      targetingType: "Manual",
      biddingStrategy: "dynamic_down",
      placement: "",
      dailyBudget: 10,
      bid: 0.75,
      placementAdjustment: 0,
      isNegative: false,
      impressions: 5000,
      clicks: 100,
      spend: 120,
      sales: 300,
      orders: 10,
      units: 12,
    },
    {
      storeName: "Warmstorey",
      snapshotDate: "2026-09-15",
      reportGranularity: "RANGE" as const,
      entityId: "ag-2",
      portfolioName: "",
      adType: "SP" as const,
      grain: "AD_GROUP" as const,
      reportStartDate: "2026-09-01",
      reportEndDate: "2026-09-30",
      campaignId: "c-2",
      campaignName: "Pilates Exact",
      adGroupId: "ag-2",
      adGroupName: "Exact Group",
      targetId: "",
      targetExpression: "",
      sku: "",
      asin: "",
      matchType: "Exact" as const,
      state: "enabled",
      campaignState: "enabled",
      adGroupState: "enabled",
      targetingType: "Manual",
      biddingStrategy: "dynamic_down",
      placement: "",
      dailyBudget: 20,
      bid: 1.2,
      placementAdjustment: 0,
      isNegative: false,
      impressions: 2000,
      clicks: 50,
      spend: 60,
      sales: 240,
      orders: 8,
      units: 8,
    },
  ];

  const adGroups = adGroupPerformanceFromFacts(mockFacts);
  assert.equal(adGroups.length, 2);
  assert.equal(adGroups[0].adGroupName, "Main AdGroup");
  assert.equal(adGroups[0].spend, 120);
  assert.equal(adGroups[0].sales, 300);
  assert.equal(adGroups[0].acos, 40); // 120 / 300 * 100
  assert.equal(adGroups[0].roas, 2.5); // 300 / 120

  assert.equal(adGroups[1].adGroupName, "Exact Group");
  assert.equal(adGroups[1].spend, 60);
  assert.equal(adGroups[1].sales, 240);
  assert.equal(adGroups[1].acos, 25); // 60 / 240 * 100
  assert.equal(adGroups[1].roas, 4.0); // 240 / 60
});
