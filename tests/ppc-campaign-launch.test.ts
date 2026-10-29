import test from "node:test";
import assert from "node:assert/strict";
import { buildLaunchPlan, type LaunchOptions, type LaunchTerm } from "../lib/ppc/campaign-launch";

const base: LaunchOptions = {
  runType: "SP03",
  matchTypes: ["exact", "phrase", "broad"],
  dailyBudget: 5,
  biddingStrategy: "Dynamic bids - down only",
  userName: "Tri",
  dateStr: "20261028",
  suffix: "",
};

const terms: LaunchTerm[] = [
  { term: "dog flag", sku: "GF123", bid: 0.8 },
  { term: "cat flag", sku: "GF123", bid: 0.6 },
  { term: "B0ABCDEFGH", sku: "GF123", bid: 0.5 },
];

test("campaign launch: SP03 mỗi match type 1 camp, chỉ lấy keyword chữ", () => {
  const plan = buildLaunchPlan(terms, base);
  assert.deepEqual(plan.campaigns.map((c) => c.name), [
    "GF123 SP03 KW Exact FBA Tri 20261028",
    "GF123 SP03 KW Phrase FBA Tri 20261028",
    "GF123 SP03 KW Broad FBA Tri 20261028",
  ]);
  assert.deepEqual(plan.campaigns[0].adGroups[0].keywords.map((k) => k.text), ["dog flag", "cat flag"]);
  assert.equal(plan.campaigns[0].targetingType, "MANUAL");
});

test("campaign launch: SP02 PAT chỉ lấy ASIN thành product targeting", () => {
  const plan = buildLaunchPlan(terms, { ...base, runType: "SP02", suffix: "test" });
  assert.equal(plan.campaigns.length, 1);
  assert.equal(plan.campaigns[0].name, "GF123 SP02 PAT FBA Tri 20261028 test");
  assert.deepEqual(plan.campaigns[0].adGroups[0].productTargets, [{ expression: 'asin="B0ABCDEFGH"', bid: 0.5 }]);
  assert.equal(plan.campaigns[0].adGroups[0].keywords.length, 0);
});

test("campaign launch: SP04 Auto 1 camp AUTO / SKU, không có target", () => {
  const plan = buildLaunchPlan(terms, { ...base, runType: "SP04" });
  assert.equal(plan.campaigns.length, 1);
  assert.equal(plan.campaigns[0].targetingType, "AUTO");
  assert.equal(plan.campaigns[0].name, "GF123 SP04 Auto FBA Tri 20261028");
  assert.equal(plan.campaigns[0].adGroups[0].keywords.length + plan.campaigns[0].adGroups[0].productTargets.length, 0);
});

test("campaign launch: SD01 đi sheet Sponsored Display với target ASIN", () => {
  const plan = buildLaunchPlan(terms, { ...base, runType: "SD01" });
  assert.equal(plan.campaigns.length, 1);
  assert.equal(plan.campaigns[0].adProduct, "SD");
  assert.equal(plan.campaigns[0].adGroups[0].productTargets.length, 1);
});

test("campaign launch: Ad Group Default Bid = CPC trung bình có trọng số như Sale KW", () => {
  const plan = buildLaunchPlan([
    { term: "dog flag", sku: "GF123", bid: 0.8, clicks: 10, spend: 8 },
    { term: "cat flag", sku: "GF123", bid: 1.5, clicks: 2, spend: 3 },
  ], base);
  assert.equal(plan.campaigns[0].adGroups[0].defaultBid, 0.92);
});

test("campaign launch: target từ tab Target — bỏ target auto, giữ nguyên biểu thức sản phẩm", () => {
  const targetTerms: LaunchTerm[] = [
    { term: "close-match", sku: "GF123", bid: 0.5 },
    { term: 'asin="B0ABCDEFGH"', sku: "GF123", bid: 0.6 },
    { term: 'asin-expanded="B0ZZZZZZZZ"', sku: "GF123", bid: 0.6 },
    { term: "dog flag", sku: "GF123", bid: 0.7 },
  ];
  const sp03 = buildLaunchPlan(targetTerms, { ...base, matchTypes: ["exact"] });
  assert.deepEqual(sp03.campaigns[0].adGroups[0].keywords.map((k) => k.text), ["dog flag"]);
  const sp02 = buildLaunchPlan(targetTerms, { ...base, runType: "SP02" });
  assert.deepEqual(sp02.campaigns[0].adGroups[0].productTargets.map((t) => t.expression), ['asin="B0ABCDEFGH"', 'asin-expanded="B0ZZZZZZZZ"']);
});

test("campaign launch: bid chung thành Ad Group Default Bid (SP04 Auto)", () => {
  const plan = buildLaunchPlan([{ term: "dog flag", sku: "GF123", bid: 0.45, clicks: 10, spend: 8 }], { ...base, runType: "SP04", commonBid: 0.45 });
  assert.equal(plan.campaigns[0].adGroups[0].defaultBid, 0.45);
});
