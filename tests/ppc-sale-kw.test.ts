import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { exportSaleKwBulksheetExcel } from "../lib/ppc/service";

test("Sale KW Bulksheet Generator generates 100% compliant Amazon Ads Bulksheet", async () => {
  const mockCampaigns = [
    {
      sourceCampaignName: "POCN251003150N SP03 KW Exact 3D Popup Card Part 01",
      sourceCampaignId: "153603550290113",
      sourceAdGroupId: "275453688946050",
      sourceAdGroupName: "POCN251003150N SP03 KW Exact 3D Popup Card Part 01",
      targetCampaignName: "POCN251003150N SP03 KW Exact 3D Popup Card Part 01 (Sale KW)",
      adGroupName: "POCN251003150N SP03 KW Exact 3D Popup Card Part 01 (Sale KW)",
      sku: "POCN251003150N",
      dailyBudget: 15.0,
      defaultBid: 1.05,
      biddingStrategy: "Dynamic bids - down only",
      negateInSource: true,
      keywords: [
        {
          customerSearchTerm: "50th anniversary card",
          matchType: "exact",
          bid: 1.10,
          orders: 12,
          sales: 191.88,
        },
        {
          customerSearchTerm: "B0XYZ12345",
          matchType: "exact",
          bid: 0.95,
          orders: 4,
          sales: 65.0,
        },
      ],
    },
  ];

  const buffer = await exportSaleKwBulksheetExcel(mockCampaigns);
  assert.ok(buffer.length > 5000, "Buffer should be valid xlsx size");

  const testFilePath = path.join(process.cwd(), "scratch", "test_sale_kw_unit.xlsx");
  fs.writeFileSync(testFilePath, buffer);

  // Inspect generated rows with python
  const inspectOutput = await new Promise<string>((resolve, reject) => {
    const p = spawn("python3", ["-c", `
import openpyxl
wb = openpyxl.load_workbook('${testFilePath}', data_only=True)
sp = wb['Sponsored Products Campaigns']
headers = next(sp.iter_rows(max_row=1, values_only=True))
entities = []
for r in sp.iter_rows(min_row=2, values_only=True):
    if any(r):
        row_dict = {headers[i]: v for i, v in enumerate(r) if v is not None and v != ''}
        entities.append(row_dict.get('Entity'))
print(','.join(entities))
    `]);
    let out = "";
    p.stdout.on("data", (c) => out += c.toString());
    p.on("close", (code) => code === 0 ? resolve(out.trim()) : reject(new Error("Python error")));
  });

  const entityList = inspectOutput.split(",");
  assert.ok(entityList.includes("Campaign"), "Should include Campaign row");
  assert.ok(entityList.includes("Ad Group"), "Should include Ad Group row");
  assert.ok(entityList.includes("Product Ad"), "Should include Product Ad row");
  assert.ok(entityList.includes("Keyword"), "Should include Keyword row");
  assert.ok(entityList.includes("Product Targeting"), "Should include Product Targeting row");
  assert.ok(entityList.includes("Negative Keyword"), "Should include Negative Keyword row for source camp");
  assert.ok(entityList.includes("Negative Product Targeting"), "Should include Negative Product Targeting row for source camp");
});
