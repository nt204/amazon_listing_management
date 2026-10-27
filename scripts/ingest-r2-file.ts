import { ingestAccountingFile } from "../lib/accounting/accounting-file-service";

async function main() {
  const r2Key = process.argv[2] || "accounting-reports/2026-10-25/LIMIMA/09_InventoryLedger_2026-10-25.csv";
  const storeName = process.argv[3] || "LIMIMA";

  console.log(`[Ingest Script] Bắt đầu nạp file từ R2: ${r2Key} cho store: ${storeName}...`);
  const result = await ingestAccountingFile(r2Key, storeName);
  console.log(`[Ingest Script] ✅ Kết quả:`, result);
}

main().catch((err) => {
  console.error(`[Ingest Script] ❌ Lỗi:`, err);
  process.exit(1);
});
