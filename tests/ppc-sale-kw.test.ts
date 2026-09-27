import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { exportSaleKwBulksheetExcel } from "../lib/ppc/service";
import {
  isAsinProductTarget,
  formatDDMMYY,
  buildSaleKwCampaignName,
  generateSaleKwCampaignTriad,
  resolveSkuForSearchTerm,
} from "../lib/ppc/sku-extractor";

test("Sale KW Naming Convention matches user example exactly", () => {
  // Test user example: "FL230622BXN SP03 KW Loan Broad 100124 (sale kw)"
  const name = buildSaleKwCampaignName({
    sku: "FL230622BXN",
    adTypeCode: "SP03",
    userName: "Loan",
    matchType: "Broad",
    dateStr: "100124",
  });
  assert.equal(name, "FL230622BXN SP03 KW Loan Broad 100124 (sale kw)");

  // Test triad generation (Exact, Phrase, Broad)
  const triad = generateSaleKwCampaignTriad({
    sku: "FL230622BXN",
    adTypeCode: "SP03",
    userName: "Loan",
    dateStr: "100124",
  });
  assert.equal(triad.exact, "FL230622BXN SP03 KW Loan Exact 100124 (sale kw)");
  assert.equal(triad.phrase, "FL230622BXN SP03 KW Loan Phrase 100124 (sale kw)");
  assert.equal(triad.broad, "FL230622BXN SP03 KW Loan Broad 100124 (sale kw)");
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

  assert.ok(inspectOutput.includes("FL230622BXN SP03 KW Loan Exact 100124 (sale kw)"), "Exact campaign should be generated");
  assert.ok(inspectOutput.includes("FL230622BXN SP03 KW Loan Phrase 100124 (sale kw)"), "Phrase campaign should be generated");
  assert.ok(inspectOutput.includes("FL230622BXN SP03 KW Loan Broad 100124 (sale kw)"), "Broad campaign should be generated");
  assert.ok(inspectOutput.includes("3d anniversary popup card (exact, bid=0.85)"), "Exact keyword with CPC bid should exist");
  assert.ok(inspectOutput.includes("3d anniversary popup card (phrase, bid=0.85)"), "Phrase keyword with CPC bid should exist");
  assert.ok(inspectOutput.includes("3d anniversary popup card (broad, bid=0.85)"), "Broad keyword with CPC bid should exist");
});
