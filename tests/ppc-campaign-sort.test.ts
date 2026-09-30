import test from "node:test";
import assert from "node:assert/strict";
import { campaignPerformanceFromFacts } from "../lib/ppc/analytics";
import type { PpcPerformanceRow } from "../lib/ppc/types";

function campaignRow(
  campaignName: string,
  spend: number,
  sales: number,
): PpcPerformanceRow {
  return {
    snapshotDate: "2026-09-29",
    reportStartDate: "2026-09-01",
    reportEndDate: "2026-09-29",
    reportGranularity: "RANGE",
    adType: "SP",
    grain: "CAMPAIGN",
    entityId: campaignName,
    campaignId: campaignName,
    campaignName,
    adGroupId: "",
    adGroupName: "",
    targetId: "",
    targetExpression: "",
    matchType: "Unknown",
    portfolioName: "",
    sku: "",
    asin: "",
    state: "enabled",
    campaignState: "enabled",
    adGroupState: "",
    targetingType: "manual",
    biddingStrategy: "",
    placement: "",
    dailyBudget: 10,
    bid: 0,
    placementAdjustment: 0,
    isNegative: false,
    impressions: 1_000,
    clicks: 10,
    spend,
    sales,
    orders: 1,
    units: 1,
  };
}

test("Campaign API transformation preserves the server sort order", () => {
  const rows = [
    campaignRow("Highest sales", 10, 300),
    campaignRow("Middle sales", 100, 200),
    campaignRow("Lowest sales", 50, 100),
  ];

  const campaigns = campaignPerformanceFromFacts(rows, 30, {
    preserveOrder: true,
  });

  assert.deepEqual(
    campaigns.map((campaign) => campaign.campaignName),
    ["Highest sales", "Middle sales", "Lowest sales"],
  );
});

test("Campaign analytics keeps its legacy spend-descending default", () => {
  const rows = [
    campaignRow("Low spend", 10, 300),
    campaignRow("High spend", 100, 200),
  ];

  const campaigns = campaignPerformanceFromFacts(rows);

  assert.deepEqual(
    campaigns.map((campaign) => campaign.campaignName),
    ["High spend", "Low spend"],
  );
});
