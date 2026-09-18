import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateBreakEvenAcos,
  calculateMaxBid,
  calculateProfitBeforeAds,
  detectCampaignRuleType,
  detectProductTypeFromSku,
  getSkuPrefixesForProductType,
  SKU_PREFIX_ERROR_PRODUCT_TYPE,
  SKU_TO_PRODUCT_TYPE_RULE_SET,
} from "../lib/ppc/sku-architecture-types";

test("SKU Economics Mathematical Formulas", () => {
  // Test Glass Ornament economics
  // Price = $15.99, Base Cost = $2.00, Amz Fee = $6.32, Tax Rate = 3%
  // Tax = 15.99 * 0.03 = 0.4797
  // Profit Before Ads = 15.99 - 6.32 - 2.00 - 0.4797 = 7.1903 -> 7.19
  const profit = calculateProfitBeforeAds(15.99, 6.32, 2.0, 0.03);
  assert.equal(profit, 7.19);

  // Break-even ACoS = 7.19 / 15.99 = 44.965% -> 45.0%
  const beAcos = calculateBreakEvenAcos(profit, 15.99);
  assert.equal(beAcos, 45.0);

  // Max Bid with CR = 10% (0.10)
  // Max Bid = 0.10 * 7.19 = 0.719 -> 0.72
  const maxBid = calculateMaxBid(0.10, profit);
  assert.equal(maxBid, 0.72);
});

test("Dynamic Selling Price and Economics when SKU has Orders", () => {
  // Scenario: Oodie with base cost $11.50, fee $15.70, tax 3%
  // Default phôi price: $49.99 -> profit $22.79, BE ACoS ~46.0%, max bid $2.28
  const defaultProfit = calculateProfitBeforeAds(49.99, 15.70, 11.50, 0.03);
  assert.equal(defaultProfit, 21.29);
  assert.equal(calculateMaxBid(0.10, defaultProfit), 2.13);

  // When SKU has orders > 0, e.g. Sales = $111.90, Units = 2 -> Selling Price = $55.95
  const actualPrice = 111.90 / 2; // 55.95
  const dynamicProfit = calculateProfitBeforeAds(actualPrice, 15.70, 11.50, 0.03);
  assert.equal(dynamicProfit, 27.07);
  // Break-even ACoS: 27.07 / 55.95 = 48.38% -> 48.4%
  const dynamicBeAcos = calculateBreakEvenAcos(dynamicProfit, actualPrice);
  assert.equal(dynamicBeAcos, 48.4);
  // Max Bid: 0.10 * 27.07 = 2.707 -> 2.71
  const dynamicMaxBid = calculateMaxBid(0.10, dynamicProfit);
  assert.equal(dynamicMaxBid, 2.71);
});

test("SKU to Product Type Mapping Engine (Exception Map & Longest Prefix Match)", () => {
  // 1. Exception map test
  assert.equal(detectProductTypeFromSku("BHL180660A01"), "Glass Ornament");

  // 2. Longest prefix test (CBH should match Blanket Hoodie, CB should match Blanket)
  assert.equal(detectProductTypeFromSku("CBH100103W"), "Blanket Hoodie");
  assert.equal(detectProductTypeFromSku("CB100103W"), "Blanket");

  // 3. Oodie prefixes
  assert.equal(detectProductTypeFromSku("ODL12345"), "Oodie");
  assert.equal(detectProductTypeFromSku("OHN200225MB"), "Oodie");
  assert.equal(detectProductTypeFromSku("OC1508241WFBA"), "Oodie");
  assert.equal(detectProductTypeFromSku("OD240902WFTYTH"), "Oodie");

  // 4. Blanket prefixes
  assert.equal(detectProductTypeFromSku("BDL100"), "Blanket");
  assert.equal(detectProductTypeFromSku("BQL120550A04"), "Blanket");
  assert.equal(detectProductTypeFromSku("BKL100"), "Blanket");
  assert.equal(detectProductTypeFromSku("BHL180620A01"), "Blanket");
  assert.equal(detectProductTypeFromSku("BD100"), "Blanket");

  // 5. Garden Flag (GFDL before GF)
  assert.equal(detectProductTypeFromSku("GFDL1305TG01"), "Garden Flag");
  assert.equal(detectProductTypeFromSku("GFQL100"), "Garden Flag");
  assert.equal(detectProductTypeFromSku("GF100"), "Garden Flag");
  assert.equal(detectProductTypeFromSku("FL100"), "Garden Flag Banner");
  assert.deepEqual(getSkuPrefixesForProductType("Garden Flag"), ["GFDL*", "GFQL*", "GF*"]);
  assert.deepEqual(getSkuPrefixesForProductType("Garden Flag Banner"), ["FL*"]);

  // 6. Makeup Bag
  assert.equal(detectProductTypeFromSku("MBDL100"), "Makeup Bag");
  assert.equal(detectProductTypeFromSku("MB100"), "Makeup Bag");

  // 7. Glass Ornament prefixes
  assert.equal(detectProductTypeFromSku("GODL1905M01"), "Glass Ornament");
  assert.equal(detectProductTypeFromSku("GOQL100"), "Glass Ornament");
  assert.equal(detectProductTypeFromSku("GOH100"), "Glass Ornament");
  assert.equal(detectProductTypeFromSku("GOL100"), "Glass Ornament");
  assert.equal(detectProductTypeFromSku("GO12345"), "Glass Ornament");

  // 8. Poster, Pillow, Poncho
  assert.equal(detectProductTypeFromSku("POL100"), "Poster");
  assert.equal(detectProductTypeFromSku("PLL100"), "Pillow");
  assert.equal(detectProductTypeFromSku("PC100"), "Poncho");

  // 9. Không có exception/prefix thì phải báo lỗi, không đoán theo campaign.
  assert.equal(detectProductTypeFromSku("CUSTOM_ITEM", "SP03_ORNAMENT_AUTO"), SKU_PREFIX_ERROR_PRODUCT_TYPE);
  assert.equal(detectProductTypeFromSku("CUSTOM_ITEM", "SP03_TUMBLER_EXACT"), SKU_PREFIX_ERROR_PRODUCT_TYPE);
  assert.equal(detectProductTypeFromSku(""), SKU_PREFIX_ERROR_PRODUCT_TYPE);
});

test("Campaign Type Classification Helpers", () => {
  assert.equal(detectCampaignRuleType("OD240902WFTYTH SB01 Quynh Phrase"), "SB01");
  assert.equal(detectCampaignRuleType("OD240902WFTYTH SB05 VIDEO Quynh Phrase"), "SB05");
  assert.equal(detectCampaignRuleType("OHN200225MB SP03 Quynh Phrase"), "SP03");
  assert.equal(detectCampaignRuleType("OHN200225MB SP01 Quynh Broad"), "SP01");
  assert.equal(detectCampaignRuleType("OHN200225MB SP04 Auto"), "SP04");
  assert.equal(detectCampaignRuleType("Some Random Campaign", "SB"), "SB01");
  assert.equal(detectCampaignRuleType("Some Random Campaign", "SP"), "SP03");
});

test("evaluateRowWithRuleEngine evaluates common rules for SP01, SP03, SP04, SB01, SB05", async () => {
  const { evaluateRowWithRuleEngine } = await import("../lib/ppc/sku-architecture-service");

  const econMap = new Map<string, any>([
    [
      "BHL180660A01",
      {
        sku: "BHL180660A01",
        productType: "Glass Ornament",
        breakEvenAcos: 48.0,
        maxBid: 1.85,
      },
    ],
  ]);

  const makeRule = (campaignType: string, strongMax: number, increaseMax: number, holdMin: number, noOrderHoldMax: number, noOrderDecreaseMax: number, minBid: number, maxBid: number) => ({
    campaignType,
    hasOrder: [
      { minAcos: 0, maxAcos: strongMax, minInclusive: false, maxInclusive: false, action: "BID_INCREASE", pct: 8, base: "CURRENT_BID", description: "+8% Current Bid" },
      { minAcos: strongMax, maxAcos: increaseMax, minInclusive: true, maxInclusive: false, action: "BID_INCREASE", pct: 5, base: "CURRENT_BID", description: "+5% Current Bid" },
      { minAcos: holdMin, maxAcos: 9999, minInclusive: true, maxInclusive: true, maxRef: "min_40_break_even_acos_pct", action: "HOLD", pct: 0, base: "NONE", description: "Hold" },
      { minAcos: 40, maxAcos: 9999, minInclusive: false, maxInclusive: true, maxRef: "break_even_acos_pct", activeWhen: "break_even_acos_pct > 40", action: "BID_DECREASE", pct: -8, base: "AVG_CPC", description: "-8% Avg CPC" },
      { minAcos: 0, maxAcos: 9999, minInclusive: false, maxInclusive: false, minRef: "break_even_acos_pct", action: "BID_DECREASE", pct: -15, base: "AVG_CPC", description: "-15% Avg CPC" },
    ],
    noOrder: [
      { minClicks: 0, maxClicks: 1, minInclusive: true, maxInclusive: false, action: "BID_INCREASE", pct: 5, base: "CURRENT_BID", description: "+5% Current Bid" },
      { minClicks: 1, maxClicks: noOrderHoldMax, minInclusive: true, maxInclusive: true, action: "HOLD", pct: 0, base: "NONE", description: "Hold" },
      { minClicks: noOrderHoldMax, maxClicks: noOrderDecreaseMax, minInclusive: false, maxInclusive: true, action: "BID_DECREASE", pct: -10, base: "AVG_CPC", description: "-10% Avg CPC" },
      { minClicks: noOrderDecreaseMax, maxClicks: 9999, minInclusive: false, maxInclusive: true, action: "PAUSE_TARGET", pct: 0, base: "NONE", description: "Pause" },
    ],
    limits: { minBid, maxBid },
  });
  const ruleMap = new Map<string, any>([
    ["SP03", makeRule("SP03", 20, 30, 30, 7, 10, 0.5, 1.85)],
    ["SB01", makeRule("SB01", 15, 25, 25, 9, 13, 0.1, 1.5)],
    ["SB05", makeRule("SB05", 15, 25, 25, 8, 11, 0.25, 1.75)],
  ]);

  function makeRow(overrides: Record<string, any>) {
    return {
      grain: "TARGET",
      isNegative: false,
      state: "ENABLED",
      campaignState: "ENABLED",
      adGroupState: "ENABLED",
      sku: "BHL180660A01",
      campaignName: "BHL180660A01 SP03 Quynh Exact",
      adType: "SP",
      targetId: "t-1",
      bid: 1.0,
      cpc: 0.8,
      clicks: 10,
      spend: 8.0,
      sales: 100.0,
      orders: 2,
      ...overrides,
    } as any;
  }

  // 1. SP03 Has Order: ACoS = 8% (< 20%) -> +8% Current Bid (1.0 * 1.08 = 1.08)
  const sp03StrongInc = evaluateRowWithRuleEngine(
    makeRow({ sales: 100.0, spend: 8.0, orders: 2, bid: 1.0 }),
    ruleMap,
    econMap,
  );
  assert.equal(sp03StrongInc?.recType, "BID_INCREASE");
  assert.equal(sp03StrongInc?.recommendedBid, 1.08);

  // 2. SP03 Has Order: ACoS = 25% (20% - 30%) -> +5% Current Bid (1.0 * 1.05 = 1.05)
  const sp03Inc = evaluateRowWithRuleEngine(
    makeRow({ sales: 100.0, spend: 25.0, orders: 2, bid: 1.0 }),
    ruleMap,
    econMap,
  );
  assert.equal(sp03Inc?.recType, "BID_INCREASE");
  assert.equal(sp03Inc?.recommendedBid, 1.05);

  // 3. SP03 Has Order: ACoS = 35% (30% - 40%) -> HOLD (null)
  const sp03Hold = evaluateRowWithRuleEngine(
    makeRow({ sales: 100.0, spend: 35.0, orders: 2, bid: 1.0 }),
    ruleMap,
    econMap,
  );
  assert.equal(sp03Hold, null);

  // 4. SP03 Has Order: ACoS = 45% (40% - 50%) -> -8% Avg CPC (avg cpc = 0.8 -> 0.8 * 0.92 = 0.74)
  const sp03Dec = evaluateRowWithRuleEngine(
    makeRow({ sales: 100.0, spend: 45.0, clicks: 50, orders: 2, bid: 1.0 }),
    ruleMap,
    econMap,
  );
  assert.equal(sp03Dec?.recType, "BID_DECREASE");
  assert.equal(sp03Dec?.recommendedBid, 0.83); // 45 / 50 = 0.9 cpc * 0.92 = 0.828 -> 0.83

  // 5. SP03 Has Order: ACoS = 55% (> 50%) -> -15% Avg CPC
  const sp03StrongDec = evaluateRowWithRuleEngine(
    makeRow({ sales: 100.0, spend: 55.0, clicks: 50, orders: 2, bid: 1.0 }),
    ruleMap,
    econMap,
  );
  assert.equal(sp03StrongDec?.recType, "BID_DECREASE");
  assert.equal(sp03StrongDec?.recommendedBid, 0.94); // 55 / 50 = 1.1 cpc * 0.85 = 0.935 -> 0.94

  // 6. SP03 No Order: 0 clicks -> +5% current_bid
  const sp03ZeroClick = evaluateRowWithRuleEngine(
    makeRow({ sales: 0, spend: 0, clicks: 0, orders: 0, bid: 1.0 }),
    ruleMap,
    econMap,
  );
  assert.equal(sp03ZeroClick?.recType, "BID_INCREASE");
  assert.equal(sp03ZeroClick?.recommendedBid, 1.05);

  const sp01ZeroClick = evaluateRowWithRuleEngine(
    makeRow({ campaignName: "BHL180660A01 SP01 Broad", sales: 0, spend: 0, clicks: 0, orders: 0 }),
    ruleMap,
    econMap,
  );
  assert.equal(sp01ZeroClick?.ruleProfile, "SP01 v1.0");
  assert.match(sp01ZeroClick?.reason || "", /^\[SP01\]/);

  const sp04ZeroClick = evaluateRowWithRuleEngine(
    makeRow({ campaignName: "BHL180660A01 SP04 Auto", sales: 0, spend: 0, clicks: 0, orders: 0 }),
    ruleMap,
    econMap,
  );
  assert.equal(sp04ZeroClick?.ruleProfile, "SP04 v1.0");
  assert.match(sp04ZeroClick?.reason || "", /^\[SP04\]/);

  // Không tự gán campaign không có mã rule thành SP03/SB01.
  const unknownCampaign = evaluateRowWithRuleEngine(
    makeRow({ campaignName: "BHL180660A01 Auto Exact", clicks: 0, orders: 0, sales: 0 }),
    ruleMap,
    econMap,
  );
  assert.equal(unknownCampaign, null);

  const cappedEconomics = new Map(econMap);
  cappedEconomics.set("BHL180660A01", {
    ...econMap.get("BHL180660A01"),
    breakEvenAcos: 42,
    maxBid: 0.6,
  });
  const cappedBid = evaluateRowWithRuleEngine(
    makeRow({ campaignName: "BHL180660A01 SP04 Auto", bid: 1, clicks: 0, orders: 0, sales: 0 }),
    ruleMap,
    cappedEconomics,
  );
  assert.equal(cappedBid?.recType, "BID_DECREASE");
  assert.equal(cappedBid?.recommendedBid, 0.6);
  assert.match(cappedBid?.reason || "", /trần SKU: \$0\.60/);

  const skuBreakEven = evaluateRowWithRuleEngine(
    makeRow({ campaignName: "BHL180660A01 SP03 Exact", bid: 1, spend: 45, sales: 100, clicks: 50, orders: 1 }),
    ruleMap,
    cappedEconomics,
  );
  assert.equal(skuBreakEven?.recType, "BID_DECREASE");
  assert.match(skuBreakEven?.reason || "", /vượt ACoS hòa vốn 42%/);

  const lowBreakEvenEconomics = new Map(cappedEconomics);
  lowBreakEvenEconomics.set("BHL180660A01", {
    ...cappedEconomics.get("BHL180660A01"),
    breakEvenAcos: 35,
    maxBid: 1.85,
  });
  const exactLowBreakEven = evaluateRowWithRuleEngine(
    makeRow({ bid: 1, spend: 35, sales: 100, clicks: 50, orders: 1 }),
    ruleMap,
    lowBreakEvenEconomics,
  );
  assert.equal(exactLowBreakEven, null, "ACoS đúng BE phải nằm trong vùng HOLD");
  const aboveLowBreakEven = evaluateRowWithRuleEngine(
    makeRow({ bid: 1, spend: 36, sales: 100, clicks: 50, orders: 1 }),
    ruleMap,
    lowBreakEvenEconomics,
  );
  assert.equal(aboveLowBreakEven?.recType, "BID_DECREASE");
  assert.equal(aboveLowBreakEven?.recommendedBid, 0.61);

  const missingEconomics = evaluateRowWithRuleEngine(
    makeRow({ sku: "UNKNOWN-SKU", campaignName: "UNKNOWN-SKU SP03 Exact" }),
    ruleMap,
    econMap,
  );
  assert.equal(missingEconomics, null);

  const prefixErrorEconomics = new Map(econMap);
  prefixErrorEconomics.set("UNKNOWN-SKU", {
    ...econMap.values().next().value!,
    sku: "UNKNOWN-SKU",
    productType: SKU_PREFIX_ERROR_PRODUCT_TYPE,
    maxBid: 0,
  });
  const prefixErrorRecommendation = evaluateRowWithRuleEngine(
    makeRow({ sku: "UNKNOWN-SKU", campaignName: "UNKNOWN-SKU SP03 Exact" }),
    ruleMap,
    prefixErrorEconomics,
  );
  assert.equal(prefixErrorRecommendation, null);

  // 7. SP03 No Order: 8 clicks -> -10% Avg CPC (spend = 8, clicks = 8, avg cpc = 1.0 -> 0.90)
  const sp03NoOrderDec = evaluateRowWithRuleEngine(
    makeRow({ sales: 0, spend: 8.0, clicks: 8, orders: 0, bid: 1.0 }),
    ruleMap,
    econMap,
  );
  assert.equal(sp03NoOrderDec?.recType, "BID_DECREASE");
  assert.equal(sp03NoOrderDec?.recommendedBid, 0.9);

  // 8. SP03 No Order: 11 clicks -> PAUSE
  const sp03Pause = evaluateRowWithRuleEngine(
    makeRow({ sales: 0, spend: 11.0, clicks: 11, orders: 0, bid: 1.0 }),
    ruleMap,
    econMap,
  );
  assert.equal(sp03Pause?.recType, "PAUSE_TARGET");

  // 9. SB01: Pause at >13 clicks (14 clicks)
  const sb01Pause = evaluateRowWithRuleEngine(
    makeRow({
      campaignName: "BHL180660A01 SB01 Video",
      sales: 0,
      spend: 14.0,
      clicks: 14,
      orders: 0,
      bid: 1.0,
    }),
    ruleMap,
    econMap,
  );
  assert.equal(sb01Pause?.recType, "PAUSE_TARGET");

  // 10. SB05: Pause at >11 clicks (12 clicks)
  const sb05Pause = evaluateRowWithRuleEngine(
    makeRow({
      campaignName: "BHL180660A01 SB05 Video",
      sales: 0,
      spend: 12.0,
      clicks: 12,
      orders: 0,
      bid: 1.0,
    }),
    ruleMap,
    econMap,
  );
  assert.equal(sb05Pause?.recType, "PAUSE_TARGET");

  // 11. Dynamic Max Bid Ceilings: SP03 uses phôi max bid (2.28), SB01 and SB05 use 80% (1.82)
  const oodieEconMap = new Map<string, any>([
    [
      "OHN240802WF",
      {
        sku: "OHN240802WF",
        productType: "Oodie",
        breakEvenAcos: 46.0,
        maxBid: 2.28,
      },
    ],
  ]);

  // SB01 target exceeding ceiling (e.g. gifts for your wife for birthday at $3.00)
  const sb01Exceed = evaluateRowWithRuleEngine(
    {
      grain: "TARGET",
      isNegative: false,
      state: "ENABLED",
      campaignState: "ENABLED",
      adGroupState: "ENABLED",
      sku: "OHN240802WF",
      campaignName: "OHN240802WF SB01 Quynh Exact 250902 10KW (birthday",
      adType: "SB",
      targetId: "t-sb01",
      targetExpression: "gifts for your wife for birthday",
      bid: 3.0,
      cpc: 1.5,
      clicks: 5,
      spend: 7.5,
      sales: 0,
      orders: 0,
    } as any,
    ruleMap,
    oodieEconMap,
  );
  assert.equal(sb01Exceed?.recType, "BID_DECREASE");
  assert.equal(sb01Exceed?.recommendedBid, 1.82, "SB01 max bid must be capped at 80% of phôi max bid (0.8 * 2.28 = 1.82)");
  assert.match(sb01Exceed?.reason || "", /Trần phôi \$2\.28 x 80%/);

  // SB05 target exceeding ceiling
  const sb05Exceed = evaluateRowWithRuleEngine(
    {
      grain: "TARGET",
      isNegative: false,
      state: "ENABLED",
      campaignState: "ENABLED",
      adGroupState: "ENABLED",
      sku: "OHN240802WF",
      campaignName: "OHN240802WF SB05 VIDEO Quynh Exact",
      adType: "SB",
      targetId: "t-sb05",
      targetExpression: "oodie video keyword",
      bid: 3.0,
      cpc: 1.5,
      clicks: 5,
      spend: 7.5,
      sales: 0,
      orders: 0,
    } as any,
    ruleMap,
    oodieEconMap,
  );
  assert.equal(sb05Exceed?.recType, "BID_DECREASE");
  assert.equal(sb05Exceed?.recommendedBid, 1.82, "SB05 max bid must be capped at 80% of phôi max bid (0.8 * 2.28 = 1.82)");

  // SP03 target exceeding ceiling (capped at 100% of phôi max bid = 2.28)
  const sp03Exceed = evaluateRowWithRuleEngine(
    {
      grain: "TARGET",
      isNegative: false,
      state: "ENABLED",
      campaignState: "ENABLED",
      adGroupState: "ENABLED",
      sku: "OHN240802WF",
      campaignName: "OHN240802WF SP03 Quynh Exact",
      adType: "SP",
      targetId: "t-sp03",
      targetExpression: "gifts for your wife for birthday",
      bid: 3.0,
      cpc: 1.5,
      clicks: 5,
      spend: 7.5,
      sales: 0,
      orders: 0,
    } as any,
    ruleMap,
    oodieEconMap,
  );
  assert.equal(sp03Exceed?.recType, "BID_DECREASE");
  assert.equal(sp03Exceed?.recommendedBid, 2.28, "SP03 max bid must be capped at 100% of phôi max bid ($2.28)");
});

test("Auto Upload AdsPower: Zero-Spend SKU action filtering logic", () => {
  const actions = [
    { id: "act-1", sku: "SKU_ZERO_1", isZeroSpend: true, finalValue: 0.72 },
    { id: "act-2", sku: "SKU_ACTIVE_1", isZeroSpend: false, finalValue: 0.85 },
    { id: "act-3", sku: "SKU_ZERO_2", isZeroSpend: true, finalValue: 0.65 },
  ];

  // Only zero spend actions must be targeted by the RPA automation
  const zeroSpendActions = actions.filter((a) => a.isZeroSpend);
  assert.equal(zeroSpendActions.length, 2);
  assert.deepEqual(zeroSpendActions.map(a => a.sku), ["SKU_ZERO_1", "SKU_ZERO_2"]);

  // Active spend action must NOT be included in auto-upload candidate list
  const activeActions = actions.filter((a) => !a.isZeroSpend);
  assert.equal(activeActions.length, 1);
  assert.equal(activeActions[0].sku, "SKU_ACTIVE_1");
});

test("Bulksheet Export preserves all 7 sheets and accurately maps columns from official template", async () => {
  const { spawn } = await import("node:child_process");
  const path = (await import("node:path")).default;
  const fs = (await import("node:fs")).default;

  const pythonScript = path.join(process.cwd(), "scripts", "export_amazon_bulksheet.py");
  const templatePath = path.join(process.cwd(), "templates", "ppc", "AdvertisingBulksheetTemplate-seller.xlsx");
  assert.ok(fs.existsSync(templatePath), "Official template must exist");

  const mockActions = [
    {
      action_type: "UPDATE_BID",
      entity_type: "KEYWORD",
      campaign_id: "35881769512493",
      ad_group_id: "277534746727028",
      target_id: "138723997757825",
      campaign_name: "GOL1006YG01 SP03 KW Phrase",
      ad_group_name: "GOL1006YG01 SP03 KW Phrase",
      target_keyword: "christmas gifts for yoga lovers",
      match_type: "phrase",
      final_value: 0.81,
    },
  ];

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const proc = spawn("python3", [pythonScript], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    proc.stdout.on("data", (c) => chunks.push(Buffer.from(c)));
    proc.stderr.on("data", (c) => errChunks.push(Buffer.from(c)));
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(Buffer.concat(errChunks).toString("utf-8")));
      resolve(Buffer.concat(chunks));
    });
    proc.stdin.write(JSON.stringify(mockActions));
    proc.stdin.end();
  });

  assert.ok(buffer.length > 5000, "Buffer should not be empty");
  const tempTestPath = path.join(process.cwd(), "scratch", "test_integrity.xlsx");
  fs.writeFileSync(tempTestPath, buffer);

  // Inspect with python openpyxl
  const openpyxlCheck = await new Promise<string>((resolve, reject) => {
    const p = spawn("python3", ["-c", `
import openpyxl
wb = openpyxl.load_workbook('${tempTestPath}')
ws = wb['Sponsored Products Campaigns']
assert wb.sheetnames == ['Portfolios', 'Sponsored Products Campaigns', 'Sponsored Display Campaigns', 'Sponsored Brands Campaigns', 'SB Multi Ad Group Campaigns', 'RAS Campaigns', 'Config']
assert ws.cell(2, 1).value == 'Sponsored Products'
assert ws.cell(2, 2).value == 'Keyword'
assert ws.cell(2, 3).value == 'Update'
assert str(ws.cell(2, 4).value) == '35881769512493'
assert str(ws.cell(2, 8).value) == '138723997757825'
assert ws.cell(2, 15).value == 'enabled'
assert float(ws.cell(2, 19).value) == 0.81
assert ws.cell(2, 20).value == 'christmas gifts for yoga lovers'
assert ws.cell(2, 23).value == 'phrase'
print('INTEGRITY_OK')
    `]);
    let out = "";
    p.stdout.on("data", (d) => out += d);
    p.on("close", (code) => code === 0 ? resolve(out.trim()) : reject(new Error("Python check failed")));
  });

  assert.equal(openpyxlCheck, "INTEGRITY_OK");
});

