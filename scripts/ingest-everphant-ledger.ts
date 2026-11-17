import fs from "fs";
import { parseInventoryLedgerContent, ingestInventoryLedgerRows } from "../lib/accounting/inventory-ledger-db";

async function main() {
  const storeId = "acb49852-4347-476a-bae9-0f8f0e192a09"; // EVERPHANT
  const snapshotDate = "2026-11-14";
  const filePath = "/tmp/09_InventoryLedger_2026-11-14_EVERPHANT.csv";
  
  const content = fs.readFileSync(filePath, "utf8");
  const rows = parseInventoryLedgerContent(content);
  console.log(`Parsed ${rows.length} rows from CSV.`);
  
  const res = await ingestInventoryLedgerRows(storeId, rows, snapshotDate, "09_InventoryLedger_2026-11-14.csv");
  console.log("Ingest result:", res);
}

main().catch(console.error);
