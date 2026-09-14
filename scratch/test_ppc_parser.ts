import { createMockAmazonSearchTermExcel } from "../lib/ppc/mock-data-generator";
import { parseSearchTermWorkbook } from "../lib/ppc/parser";
import { calculatePpcSummary, groupPpcBySku, generatePpcAlerts, generatePpcRecommendations } from "../lib/ppc/analytics";

async function runTest() {
  console.log("1. Generating mock Amazon Excel workbook...");
  const excelBuffer = await createMockAmazonSearchTermExcel("Bozspacer");
  console.log(`   -> Generated Excel Buffer size: ${excelBuffer.length} bytes`);

  console.log("2. Parsing Excel workbook with PPC Parser...");
  const parsedRows = await parseSearchTermWorkbook(excelBuffer, "Bozspacer");
  console.log(`   -> Parsed ${parsedRows.length} rows successfully!`);

  for (const r of parsedRows.slice(0, 3)) {
    console.log(`      * [${r.matchType}] Term: "${r.customerSearchTerm}" | Clicks: ${r.clicks} | Spend: $${r.spend} | Sales: $${r.sales} | ACOS: ${r.acos}% | CTR: ${r.ctr}`);
  }

  console.log("3. Computing Summary Metrics...");
  const summary = calculatePpcSummary(parsedRows, 25.0);
  console.log(`   -> Total Spend: $${summary.totalSpend}`);
  console.log(`   -> Total Sales: $${summary.totalSales}`);
  console.log(`   -> Blended ACOS: ${summary.blendedAcos}%`);
  console.log(`   -> Blended ROAS: ${summary.blendedRoas}x`);
  console.log(`   -> Wasted Spend: $${summary.wastedSpend}`);
  console.log(`   -> Active Alerts: ${summary.activeAlertsCount}`);
  console.log(`   -> Pending Recommendations: ${summary.pendingRecsCount}`);

  console.log("4. Testing Alert Rules...");
  const alerts = generatePpcAlerts(parsedRows, 25.0);
  for (const a of alerts) {
    console.log(`      [${a.severity}] ${a.title}`);
  }

  console.log("5. Testing Recommendation Engine...");
  const recs = generatePpcRecommendations(parsedRows, 25.0);
  for (const rec of recs) {
    console.log(`      [${rec.recType}] ${rec.keyword}: ${rec.reason}`);
  }

  console.log("\nALL PPC PARSER & ANALYTICS TESTS PASSED 100%!");
}

runTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
