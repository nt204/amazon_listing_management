import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { exportSaleKwBulksheetExcel } from "../lib/ppc/service";
import {
  isAsinProductTarget,
  formatSaleKwRunType,
  buildSaleKwCampaignName,
  generateSaleKwCampaignTriad,
  normalizeSaleKwDate,
  resolveSkuForSearchTerm,
  sanitizeSaleKwUserName,
} from "../lib/ppc/sku-extractor";

test("Sale KW campaign naming convention matches the requested format", () => {
  const name = buildSaleKwCampaignName({
    sku: "BTV260203MR",
    adTypeCode: "SP03",
    userName: "Truong",
    matchType: "Phrase",
    dateStr: "20260430",
  });
  assert.equal(name, "BTV260203MR SP03 KW Phrase FBA Truong 20260430 (sale kw)");

  // Test triad generation (Exact, Phrase, Broad)
  const triad = generateSaleKwCampaignTriad({
    sku: "FL230622BXN",
    adTypeCode: "SP03",
    userName: "Loan",
    dateStr: "100124",
  });
  assert.equal(triad.exact, "FL230622BXN SP03 KW Exact FBA Loan 20240110 (sale kw)");
  assert.equal(triad.phrase, "FL230622BXN SP03 KW Phrase FBA Loan 20240110 (sale kw)");
  assert.equal(triad.broad, "FL230622BXN SP03 KW Broad FBA Loan 20240110 (sale kw)");
});

test("Sale KW run types and dates use the new campaign convention", () => {
  assert.equal(formatSaleKwRunType("SP03"), "SP03 KW");
  assert.equal(formatSaleKwRunType("SP03 KW"), "SP03 KW");
  assert.equal(formatSaleKwRunType("SB05"), "SB05 Video");
  assert.equal(formatSaleKwRunType("SB05 Video"), "SB05 Video");
  assert.equal(formatSaleKwRunType("SP04"), "SP04 Auto");
  assert.equal(formatSaleKwRunType("SP04 Auto"), "SP04 Auto");
  assert.equal(formatSaleKwRunType("SB01"), "SB01");
  assert.equal(normalizeSaleKwDate("300426"), "20260430");

  // Verify all 4 campaign types
  assert.equal(
    buildSaleKwCampaignName({ sku: "BTV260203MR", adTypeCode: "SP03", userName: "Truong", matchType: "Phrase", dateStr: "20260430" }),
    "BTV260203MR SP03 KW Phrase FBA Truong 20260430 (sale kw)"
  );
  assert.equal(
    buildSaleKwCampaignName({ sku: "BTV260203MR", adTypeCode: "SB05 Video", userName: "Truong", matchType: "Phrase", dateStr: "20260430" }),
    "BTV260203MR SB05 Video Phrase FBA Truong 20260430 (sale kw)"
  );
  assert.equal(
    buildSaleKwCampaignName({ sku: "BTV260203MR", adTypeCode: "SP04", userName: "Truong", matchType: "Exact", dateStr: "20260430" }),
    "BTV260203MR SP04 Auto Exact FBA Truong 20260430 (sale kw)"
  );
  assert.equal(
    buildSaleKwCampaignName({ sku: "BTV260203MR", adTypeCode: "SB01", userName: "Truong", matchType: "Broad", dateStr: "20260430" }),
    "BTV260203MR SB01 Broad FBA Truong 20260430 (sale kw)"
  );
});

test("Sale KW user names stay dynamic and safe inside campaign names", () => {
  assert.equal(sanitizeSaleKwUserName("  Trường Nguyễn / PPC 🚀  "), "Truong Nguyen PPC");
  assert.equal(sanitizeSaleKwUserName("***"), "Loan");
  assert.equal(buildSaleKwCampaignName({
    sku: "BTV260203MR",
    adTypeCode: "SP03",
    userName: "Trường / 🚀",
    matchType: "Phrase",
    dateStr: "300426",
  }), "BTV260203MR SP03 KW Phrase FBA Truong 20260430 (sale kw)");
});

test("ASIN detection filters out ASINs and keeps real keywords", () => {
  // Real keywords (should NOT be detected as ASIN)
  assert.equal(isAsinProductTarget("popup card 3d"), false);
  assert.equal(isAsinProductTarget("50th anniversary gift"), false);
  assert.equal(isAsinProductTarget("blanket hoodie"), false);

  // ASINs and product targets (should be detected and skipped)
  assert.equal(isAsinProductTarget("B0XYZ12345"), true);
  assert.equal(isAsinProductTarget("b08xyz7890"), true);
  assert.equal(isAsinProductTarget("asin=B0XYZ12345"), true);
  assert.equal(isAsinProductTarget("category=\"12345\""), true);
});

test("SKU resolution correctly extracts seller SKU from search term context", () => {
  const term1 = {
    customerSearchTerm: "anniversary card",
    campaignName: "FL230622BXN SP03 KW Exact Part 01",
  };
  assert.equal(resolveSkuForSearchTerm(term1), "FL230622BXN");

  const term2 = {
    customerSearchTerm: "gift for her",
    sku: "BHL180620A01",
  };
  assert.equal(resolveSkuForSearchTerm(term2), "BHL180620A01");
});

test("Sale KW Triad Bulksheet Generator creates 3 separate campaigns (Exact, Phrase, Broad)", async () => {
  const triad = generateSaleKwCampaignTriad({
    sku: "FL230622BXN",
    adTypeCode: "SP03",
    userName: "Loan",
    dateStr: "100124",
  });

  const avgCpc = 0.85;

  const mockTriadCampaigns = [
    {
      sourceCampaignName: "FL230622BXN SP04 Auto",
      targetCampaignName: triad.exact,
      adGroupName: triad.exact,
      sku: "FL230622BXN",
      dailyBudget: 10.0,
      defaultBid: avgCpc,
      biddingStrategy: "Dynamic bids - down only",
      negateInSource: false,
      keywords: [
        {
          customerSearchTerm: "3d anniversary popup card",
          matchType: "exact",
          bid: avgCpc,
          orders: 5,
          sales: 75.0,
        },
      ],
    },
    {
      sourceCampaignName: "FL230622BXN SP04 Auto",
      targetCampaignName: triad.phrase,
      adGroupName: triad.phrase,
      sku: "FL230622BXN",
      dailyBudget: 10.0,
      defaultBid: avgCpc,
      biddingStrategy: "Dynamic bids - down only",
      negateInSource: false,
      keywords: [
        {
          customerSearchTerm: "3d anniversary popup card",
          matchType: "phrase",
          bid: avgCpc,
          orders: 5,
          sales: 75.0,
        },
      ],
    },
    {
      sourceCampaignName: "FL230622BXN SP04 Auto",
      targetCampaignName: triad.broad,
      adGroupName: triad.broad,
      sku: "FL230622BXN",
      dailyBudget: 10.0,
      defaultBid: avgCpc,
      biddingStrategy: "Dynamic bids - down only",
      negateInSource: false,
      keywords: [
        {
          customerSearchTerm: "3d anniversary popup card",
          matchType: "broad",
          bid: avgCpc,
          orders: 5,
          sales: 75.0,
        },
      ],
    },
  ];

  const buffer = await exportSaleKwBulksheetExcel(mockTriadCampaigns);
  assert.ok(buffer.length > 5000, "Buffer should be valid xlsx size");

  const testFilePath = path.join(process.cwd(), "scratch", "test_sale_kw_triad.xlsx");
  fs.writeFileSync(testFilePath, buffer);

  // Inspect generated rows with python
  const inspectOutput = await new Promise<string>((resolve, reject) => {
    const p = spawn("python3", ["-c", `
import openpyxl
wb = openpyxl.load_workbook('${testFilePath}', data_only=True)
sp = wb['Sponsored Products Campaigns']
headers = next(sp.iter_rows(max_row=1, values_only=True))
campaign_names = []
keywords = []
for r in sp.iter_rows(min_row=2, values_only=True):
    if any(r):
        row_dict = {headers[i]: v for i, v in enumerate(r) if v is not None and v != ''}
        entity = row_dict.get('Entity')
        if entity == 'Campaign':
            campaign_names.append(row_dict.get('Campaign Name'))
        elif entity == 'Keyword':
            keywords.append(f"{row_dict.get('Keyword Text')} ({row_dict.get('Match Type')}, bid={row_dict.get('Bid')})")
print('CAMPAIGNS:' + '|'.join(campaign_names))
print('KEYWORDS:' + '|'.join(keywords))
    `]);
    let out = "";
    p.stdout.on("data", (c) => out += c.toString());
    p.on("close", (code) => code === 0 ? resolve(out.trim()) : reject(new Error("Python error")));
  });

  assert.ok(inspectOutput.includes("FL230622BXN SP03 KW Exact FBA Loan 20240110 (sale kw)"), "Exact campaign should be generated");
  assert.ok(inspectOutput.includes("FL230622BXN SP03 KW Phrase FBA Loan 20240110 (sale kw)"), "Phrase campaign should be generated");
  assert.ok(inspectOutput.includes("FL230622BXN SP03 KW Broad FBA Loan 20240110 (sale kw)"), "Broad campaign should be generated");
  assert.ok(inspectOutput.includes("3d anniversary popup card (exact, bid=0.85)"), "Exact keyword with CPC bid should exist");
  assert.ok(inspectOutput.includes("3d anniversary popup card (phrase, bid=0.85)"), "Phrase keyword with CPC bid should exist");
  assert.ok(inspectOutput.includes("3d anniversary popup card (broad, bid=0.85)"), "Broad keyword with CPC bid should exist");
});
