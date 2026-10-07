import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveTargetScenario,
  calculateNumericStateDistance,
  performHierarchicalRetrieval,
  type HistoricalScenarioContext,
} from "../lib/ppc/scenario-classifier";

test("deriveTargetScenario classifies ZERO_ORDER_BLEED when clicks >= 7 and orders = 0", () => {
  const result = deriveTargetScenario({
    clicks: 18,
    orders: 0,
    spend: 15.3,
    sales: 0,
    breakEvenAcos: 45,
    reason: "[SP03] SP03_BLEED_7_CLICKS: 18 clicks, không có đơn -> Giảm -10% Avg CPC.",
  });

  assert.equal(result.scenario, "ZERO_ORDER_BLEED");
  assert.equal(result.ordersAtAction, 0);
  assert.equal(result.clicksAtAction, 18);
  assert.equal(result.acosBeRatio, null);
});

test("deriveTargetScenario classifies STARVED_TRAFFIC when clicks < 7 and orders = 0", () => {
  const result = deriveTargetScenario({
    clicks: 3,
    orders: 0,
    spend: 2.1,
    sales: 0,
    breakEvenAcos: 45,
    reason: "[SP03] Low traffic target",
  });

  assert.equal(result.scenario, "STARVED_TRAFFIC");
  assert.equal(result.ordersAtAction, 0);
});

test("deriveTargetScenario classifies HIGH_ACOS_TRIM when relative ACOS/BE ratio > 1.0", () => {
  const result = deriveTargetScenario({
    clicks: 45,
    orders: 3,
    spend: 40,
    sales: 60, // ACOS = 66.67%, BE = 45% -> ratio = 1.48
    breakEvenAcos: 45,
    reason: "[SP03] SP03_ORDER_HIGH_ACOS: ACoS 66.7% vượt ACoS hòa vốn 45%",
  });

  assert.equal(result.scenario, "HIGH_ACOS_TRIM");
  assert.ok(result.acosBeRatio !== null && result.acosBeRatio > 1.0);
});

test("deriveTargetScenario classifies MARGINAL_ACOS when relative ratio is between 0.75 and 1.0", () => {
  const result = deriveTargetScenario({
    clicks: 50,
    orders: 5,
    spend: 38,
    sales: 100, // ACOS = 38%, BE = 45% -> ratio = 0.84
    breakEvenAcos: 45,
    reason: "[SP03] SP03_ORDER_MARGINAL",
  });

  assert.equal(result.scenario, "MARGINAL_ACOS");
  assert.ok(result.acosBeRatio !== null && result.acosBeRatio <= 1.0 && result.acosBeRatio > 0.75);
});

test("deriveTargetScenario classifies PROFITABLE_SCALE when relative ratio <= 0.75", () => {
  const result = deriveTargetScenario({
    clicks: 80,
    orders: 12,
    spend: 40,
    sales: 200, // ACOS = 20%, BE = 45% -> ratio = 0.44
    breakEvenAcos: 45,
    reason: "[SP03] SP03_ORDER_PROFITABLE",
  });

  assert.equal(result.scenario, "PROFITABLE_SCALE");
  assert.ok(result.acosBeRatio !== null && result.acosBeRatio <= 0.75);
});

test("performHierarchicalRetrieval selects Level A when exact matches >= 20", () => {
  const target = deriveTargetScenario({
    clicks: 25,
    orders: 0,
    reason: "25 clicks, không có đơn",
  });

  const mockCases: HistoricalScenarioContext[] = Array.from({ length: 25 }, (_, i) => ({
    scenarioAtAction: "ZERO_ORDER_BLEED",
    acosBeRatio: null,
    clicks: 20 + i,
    orders: 0,
    cvr: 0,
    avgCpc: 0.65,
    productType: "ornament",
    campaignType: "SP03",
    matchType: "EXACT",
    direction: "DECREASE",
    candidateId: "DECREASE_AVG_CPC_MINUS_10",
    outcomeLabel: "POSITIVE",
    rewardUsd: 12.5,
    rawRow: {},
  }));

  const res = performHierarchicalRetrieval({
    targetScenario: target,
    campaignType: "SP03",
    matchType: "EXACT",
    productType: "ornament",
    direction: "DECREASE",
    allHistoricalCases: mockCases,
    minSamplesPerLevel: 20,
  });

  assert.equal(res.level, "LEVEL_A");
  assert.equal(res.specificity, "HIGH");
  assert.equal(res.sampleCount, 25);
});

test("performHierarchicalRetrieval fallbacks to Level B when Level A is sparse", () => {
  const target = deriveTargetScenario({
    clicks: 25,
    orders: 0,
    reason: "25 clicks, không có đơn",
  });

  // Only 5 EXACT, but 20 BROAD for same product type
  const mockCases: HistoricalScenarioContext[] = [
    ...Array.from({ length: 5 }, () => ({
      scenarioAtAction: "ZERO_ORDER_BLEED" as const,
      acosBeRatio: null,
      clicks: 22,
      orders: 0,
      cvr: 0,
      avgCpc: 0.65,
      productType: "ornament",
      campaignType: "SP03",
      matchType: "EXACT",
      direction: "DECREASE" as const,
      candidateId: "DECREASE_AVG_CPC_MINUS_10",
      outcomeLabel: "POSITIVE" as const,
      rewardUsd: 10,
      rawRow: {},
    })),
    ...Array.from({ length: 20 }, () => ({
      scenarioAtAction: "ZERO_ORDER_BLEED" as const,
      acosBeRatio: null,
      clicks: 22,
      orders: 0,
      cvr: 0,
      avgCpc: 0.65,
      productType: "ornament",
      campaignType: "SP03",
      matchType: "BROAD",
      direction: "DECREASE" as const,
      candidateId: "DECREASE_AVG_CPC_MINUS_10",
      outcomeLabel: "POSITIVE" as const,
      rewardUsd: 10,
      rawRow: {},
    })),
  ];

  const res = performHierarchicalRetrieval({
    targetScenario: target,
    campaignType: "SP03",
    matchType: "EXACT",
    productType: "ornament",
    direction: "DECREASE",
    allHistoricalCases: mockCases,
    minSamplesPerLevel: 20,
  });

  assert.equal(res.level, "LEVEL_B");
  assert.equal(res.specificity, "MEDIUM");
  assert.equal(res.sampleCount, 25);
});

test("performHierarchicalRetrieval fallbacks to Level C when Product Type is sparse", () => {
  const target = deriveTargetScenario({
    clicks: 25,
    orders: 0,
    reason: "25 clicks, không có đơn",
  });

  // Different product types within SP03
  const mockCases: HistoricalScenarioContext[] = Array.from({ length: 22 }, () => ({
    scenarioAtAction: "ZERO_ORDER_BLEED" as const,
    acosBeRatio: null,
    clicks: 25,
    orders: 0,
    cvr: 0,
    avgCpc: 0.65,
    productType: "tumbler",
    campaignType: "SP03",
    matchType: "BROAD",
    direction: "DECREASE" as const,
    candidateId: "DECREASE_AVG_CPC_MINUS_10",
    outcomeLabel: "POSITIVE" as const,
    rewardUsd: 10,
    rawRow: {},
  }));

  const res = performHierarchicalRetrieval({
    targetScenario: target,
    campaignType: "SP03",
    matchType: "EXACT",
    productType: "ornament",
    direction: "DECREASE",
    allHistoricalCases: mockCases,
    minSamplesPerLevel: 20,
  });

  assert.equal(res.level, "LEVEL_C");
  assert.equal(res.specificity, "BROAD");
  assert.equal(res.sampleCount, 22);
});
