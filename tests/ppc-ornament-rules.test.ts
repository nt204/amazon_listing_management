import test from "node:test";
import assert from "node:assert/strict";
import {
  isGlassOrnamentTarget,
  detectOrnamentCampaignType,
  evaluateOrnamentTargetBid,
  ORNAMENT_BID_LIMITS,
  ORNAMENT_ECONOMICS,
} from "../lib/ppc/rules-ornament";
import type { PpcPerformanceRow } from "../lib/ppc/types";

function mockTarget(overrides: Partial<PpcPerformanceRow> = {}): PpcPerformanceRow {
  return {
    grain: "TARGET",
    isNegative: false,
    state: "ENABLED",
    campaignState: "ENABLED",
    adGroupState: "ENABLED",
    storeId: "store-hsostore",
    storeName: "HSOSTORE",
    adType: "SP",
    sku: "GODL1905M01",
    campaignName: "GODL1905M01 SP03 KW Exact Glass Ornament FBA Test Quynh 20260805 P01",
    adGroupName: "AdGroup 1",
    targetId: "target-123",
    targetExpression: "glass ornament",
    bid: 1.0,
    clicks: 10,
    spend: 10.0,
    sales: 50.0,
    orders: 3,
    units: 3,
    cpc: 1.0,
    ctr: 0.01,
    cvr: 0.3,
    acos: 20.0,
    roas: 5.0,
    entityId: "ent-1",
    campaignId: "camp-1",
    adGroupId: "ag-1",
    matchType: "Exact",
    portfolioName: "Ornament",
    asin: "B012345678",
    targetingType: "MANUAL",
    biddingStrategy: "LEGACY_FOR_SALES",
    placement: "Top of search",
    dailyBudget: 50,
    placementAdjustment: 0,
    impressions: 1000,
    snapshotDate: "2026-09-16",
    reportStartDate: "2026-08-16",
    reportEndDate: "2026-09-16",
    reportGranularity: "RANGE",
    ...overrides,
  };
}

test("1. Identification: isGlassOrnamentTarget detects GO prefix, campaign name, and portfolio", () => {
  assert.equal(isGlassOrnamentTarget({ sku: "GODL1905M01" }), true);
  assert.equal(isGlassOrnamentTarget({ sku: "GOL0306RT01" }), true);
  assert.equal(isGlassOrnamentTarget({ sku: "BC010123BH" }), false);
  assert.equal(isGlassOrnamentTarget({ campaignName: "GODL1805BR04 SP03 KW Broad Glass Ornament" }), true);
  assert.equal(isGlassOrnamentTarget({ portfolioName: "Quynh test Glass Ornament" }), true);
  assert.equal(isGlassOrnamentTarget({ sku: "BD140126I", campaignName: "BD140126I Blanket" }), false);
});

test("2. Format detection: detectOrnamentCampaignType identifies SP03, SB01, SB05", () => {
  assert.equal(detectOrnamentCampaignType("GODL1905M01 SP03 KW Exact"), "SP03");
  assert.equal(detectOrnamentCampaignType("GODL1905M01 SB01 Video Collection"), "SB01");
  assert.equal(detectOrnamentCampaignType("GODL1905M01 SB05 VIDEO Manh"), "SB05");
  assert.equal(detectOrnamentCampaignType("GODL1905M01 (others)", "SB"), "SB01");
  assert.equal(detectOrnamentCampaignType("GODL1905M01 (others)", "SP"), "SP03");
});

test("3. SP03 when Order > 0: Increases bid when ACOS < 25% or 25-35%, decreases when > 48%", () => {
  // ACOS < 25% -> +8% on current bid (1.00 -> 1.08)
  const rec1 = evaluateOrnamentTargetBid(mockTarget({
    campaignName: "GODL1905M01 SP03 Exact",
    bid: 1.00,
    spend: 20.0,
    sales: 100.0, // ACOS = 20%
    orders: 3,
  }));
  assert.ok(rec1);
  assert.equal(rec1.recType, "BID_INCREASE");
  assert.equal(rec1.matchType, "Exact");
  assert.equal(rec1.recommendedBid, 1.08);

  const phraseRec = evaluateOrnamentTargetBid(mockTarget({
    campaignName: "GODL1905M01 SP03 Phrase",
    matchType: "Phrase",
    bid: 1.00,
    spend: 20.0,
    sales: 100.0,
    orders: 3,
  }));
  assert.ok(phraseRec);
  assert.equal(phraseRec.matchType, "Phrase");

  // 25% <= ACOS < 35% -> +5% on current bid (1.00 -> 1.05)
  const rec2 = evaluateOrnamentTargetBid(mockTarget({
    campaignName: "GODL1905M01 SP03 Exact",
    bid: 1.00,
    spend: 30.0,
    sales: 100.0, // ACOS = 30%
    orders: 2,
  }));
  assert.ok(rec2);
  assert.equal(rec2.recType, "BID_INCREASE");
  assert.equal(rec2.recommendedBid, 1.05);

  // 35% <= ACOS <= 48% (Target zone) -> Keep (no recommendation)
  const rec3 = evaluateOrnamentTargetBid(mockTarget({
    campaignName: "GODL1905M01 SP03 Exact",
    bid: 1.00,
    spend: 40.0,
    sales: 100.0, // ACOS = 40%
    orders: 2,
  }));
  assert.equal(rec3, null);

  // 48% < ACOS <= 55% -> -8% from avg CPC (avg CPC = 10 / 10 = 1.00 -> 0.92)
  const rec4 = evaluateOrnamentTargetBid(mockTarget({
    campaignName: "GODL1905M01 SP03 Exact",
    bid: 1.20,
    clicks: 10,
    spend: 10.0, // CPC = 1.00
    sales: 19.0, // ACOS = 52.6%
    orders: 1,
  }));
  assert.ok(rec4);
  assert.equal(rec4.recType, "BID_DECREASE");
  assert.equal(rec4.recommendedBid, 0.92);

  // ACOS > 55% -> -15% from avg CPC (avg CPC = 1.00 -> 0.85)
  const rec5 = evaluateOrnamentTargetBid(mockTarget({
    campaignName: "GODL1905M01 SP03 Exact",
    bid: 1.20,
    clicks: 10,
    spend: 10.0, // CPC = 1.00
    sales: 15.0, // ACOS = 66.7%
    orders: 1,
  }));
  assert.ok(rec5);
  assert.equal(rec5.recType, "BID_DECREASE");
  assert.equal(rec5.priority, "P0");
  assert.equal(rec5.recommendedBid, 0.85);
});

test("4. SP03 when Order = 0: 0 click +5%, >7 clicks -10%, >10 clicks PAUSE", () => {
  // Clicks < 1 -> +5% current bid (1.00 -> 1.05)
  const rec1 = evaluateOrnamentTargetBid(mockTarget({
    campaignName: "GODL1905M01 SP03 Exact",
    bid: 1.00,
    clicks: 0,
    spend: 0,
    orders: 0,
    sales: 0,
  }));
  assert.ok(rec1);
  assert.equal(rec1.recType, "BID_INCREASE");
  assert.equal(rec1.recommendedBid, 1.05);

  // 1 <= Clicks <= 7 -> Safe zone, no action
  const rec2 = evaluateOrnamentTargetBid(mockTarget({
    campaignName: "GODL1905M01 SP03 Exact",
    bid: 1.00,
    clicks: 6,
    spend: 6.0,
    orders: 0,
    sales: 0,
  }));
  assert.equal(rec2, null);

  // Clicks = 8 (> 7) -> -10% from avg CPC (CPC = 8/8 = 1.00 -> 0.90)
  const rec3 = evaluateOrnamentTargetBid(mockTarget({
    campaignName: "GODL1905M01 SP03 Exact",
    bid: 1.20,
    clicks: 8,
    spend: 8.0,
    orders: 0,
    sales: 0,
  }));
  assert.ok(rec3);
  assert.equal(rec3.recType, "BID_DECREASE");
  assert.equal(rec3.recommendedBid, 0.90);

  // Clicks = 11 (> 10) -> PAUSE target
  const rec4 = evaluateOrnamentTargetBid(mockTarget({
    campaignName: "GODL1905M01 SP03 Exact",
    bid: 1.20,
    clicks: 11,
    spend: 11.0,
    orders: 0,
    sales: 0,
  }));
  assert.ok(rec4);
  assert.equal(rec4.recType, "PAUSE_TARGET");
  assert.equal(rec4.priority, "P0");
  assert.equal(rec4.actionState, "PAUSED");
});

test("5. SB01 & SB05 Rules: SB01 pauses at >13 clicks, SB05 pauses at >11 clicks", () => {
  // SB01 with 12 clicks (not paused yet, decreases bid)
  const sb01_1 = evaluateOrnamentTargetBid(mockTarget({
    adType: "SB",
    campaignName: "GODL1905M01 SB01 Collection",
    bid: 1.00,
    clicks: 12,
    spend: 6.0, // CPC = 0.50
    orders: 0,
  }));
  assert.ok(sb01_1);
  assert.equal(sb01_1.recType, "BID_DECREASE");
  assert.equal(sb01_1.recommendedBid, 0.45); // 0.50 * 0.90 = 0.45

  // SB01 with 14 clicks (> 13) -> PAUSE
  const sb01_2 = evaluateOrnamentTargetBid(mockTarget({
    adType: "SB",
    campaignName: "GODL1905M01 SB01 Collection",
    bid: 1.00,
    clicks: 14,
    spend: 7.0,
    orders: 0,
  }));
  assert.ok(sb01_2);
  assert.equal(sb01_2.recType, "PAUSE_TARGET");

  // SB05 with 12 clicks (> 11) -> PAUSE
  const sb05 = evaluateOrnamentTargetBid(mockTarget({
    adType: "SB",
    campaignName: "GODL1905M01 SB05 Video",
    bid: 1.00,
    clicks: 12,
    spend: 6.0,
    orders: 0,
  }));
  assert.ok(sb05);
  assert.equal(sb05.recType, "PAUSE_TARGET");
});

test("6. Min/Max Bid Limits: Enforces bounds on SP03 (0.60 - 1.81) and SB (0.10 - 1.51)", () => {
  // SP03 lower bound clamp: proposed 0.40 -> clamped to 0.60
  const recMin = evaluateOrnamentTargetBid(mockTarget({
    campaignName: "GODL1905M01 SP03 Exact",
    bid: 0.70,
    clicks: 8,
    spend: 3.20, // CPC = 0.40 -> -10% = 0.36 -> clamped to 0.60
    orders: 0,
  }));
  assert.ok(recMin);
  assert.equal(recMin.recommendedBid, ORNAMENT_BID_LIMITS.SP03.minBid); // 0.60

  // SP03 upper bound clamp: proposed 2.00 -> clamped to 1.81
  const recMax = evaluateOrnamentTargetBid(mockTarget({
    campaignName: "GODL1905M01 SP03 Exact",
    bid: 1.80,
    spend: 10.0,
    sales: 100.0, // ACOS = 10% -> +8% = 1.94 -> clamped to 1.81
    orders: 3,
  }));
  assert.ok(recMax);
  assert.equal(recMax.recommendedBid, ORNAMENT_BID_LIMITS.SP03.maxBid); // 1.81
});
