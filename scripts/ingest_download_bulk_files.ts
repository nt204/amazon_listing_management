import fs from "node:fs";
import path from "node:path";
import { ingestPpcExcelFile } from "@/lib/ppc/service";
import { inferPpcReportCoverage } from "@/lib/ppc/parser";
import { getDatabaseClient } from "@/lib/db";
import type { DataScope } from "@/lib/db";

async function main() {
  const dirCandidates = [
    "/Users/macbook/Downloads/Bulk file ",
    "/Users/macbook/Downloads/Bulk file",
  ];
  const targetDir = dirCandidates.find((d) => fs.existsSync(d));
  if (!targetDir) {
    console.error("Directory not found in Downloads:", dirCandidates);
    process.exit(1);
  }

  console.log(`Found directory: ${targetDir}`);
  const allFiles = fs.readdirSync(targetDir).filter((f) => !f.startsWith("~") && !f.startsWith("."));
  console.log(`Found ${allFiles.length} files:`, allFiles);

  const scope: DataScope = { teamId: "default", actorId: "system" };
  const storeName = "HSOSTORE";
  const sql = await getDatabaseClient();

  // 1. Process CSV Search Term files first
  const csvFiles = allFiles.filter((f) => f.toLowerCase().endsWith(".csv"));
  for (const file of csvFiles) {
    console.log(`\n========================================`);
    console.log(`Ingesting Search Term file: ${file}`);
    const filePath = path.join(targetDir, file);
    const buffer = fs.readFileSync(filePath);
    const res = await ingestPpcExcelFile(scope, buffer, file, storeName, { days: 30, endDate: "2026-09-13" });
    console.log(`Success:`, res);
  }

  // 2. Process Bulk files
  const bulkFiles = allFiles.filter((f) => f.toLowerCase().endsWith(".xlsx"));
  bulkFiles.sort((a, b) => a.localeCompare(b));

  for (const file of bulkFiles) {
    const coverage = inferPpcReportCoverage(file);
    // Check if this specific file's adType and dates are already in DB
    const isSB = file.includes("17893408") || file.includes("SB");
    const checkAdType = isSB ? "SB" : "SP";
    const existing = await sql`
      SELECT count(*) FROM ppc_performance_facts pf
      JOIN ppc_stores s ON s.id = pf.store_id
      WHERE s.name = ${storeName}
        AND pf.report_start_date = ${coverage.reportStartDate}
        AND pf.report_end_date = ${coverage.reportEndDate}
        AND pf.ad_type = ${checkAdType}
    `;
    if (Number(existing[0]?.count || 0) > 10000) {
      console.log(`Skipping already ingested bulk file: ${file} (${existing[0].count} records exist for ${checkAdType})`);
      continue;
    }
    console.log(`\n========================================`);
    console.log(`Ingesting Bulk file: ${file}`);
    const filePath = path.join(targetDir, file);
    const buffer = fs.readFileSync(filePath);
    const res = await ingestPpcExcelFile(scope, buffer, file, storeName);
    console.log(`Success:`, res);
  }

  console.log(`\n========================================`);
  console.log(`All files ingested successfully!`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Ingest failed:", err);
  process.exit(1);
});
