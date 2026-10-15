import fs from "fs";
import { parseAndIngestShipmentFile } from "./accounting_crawler";

async function main() {
  const stores = ["WARMSTOREY", "LIMIMA", "FASTPEACE", "BOZSPACER", "MALFIRST"];
  for (const s of stores) {
    const folderName = s === "WARMSTOREY" ? "WARMSTOREY" : s;
    const fallbackFolder = s === "WARMSTOREY" ? "HSOSTORE" : s;
    
    let f07 = `/Users/ad/AmazonAccounting/downloads/2026-10-12/${folderName}/07_Shipments_2026-10-12.csv`;
    if (!fs.existsSync(f07)) {
      f07 = `/Users/ad/AmazonAccounting/downloads/2026-10-12/${fallbackFolder}/07_Shipments_2026-10-12.csv`;
    }

    let f08 = `/Users/ad/AmazonAccounting/downloads/2026-10-12/${folderName}/08_DcShipments_2026-10-12.csv`;
    if (!fs.existsSync(f08)) {
      f08 = `/Users/ad/AmazonAccounting/downloads/2026-10-12/${fallbackFolder}/08_DcShipments_2026-10-12.csv`;
    }

    console.log(`\n=== Đang nạp Shipment cho store ${s} ===`);
    if (fs.existsSync(f07)) {
      try {
        const c7 = await parseAndIngestShipmentFile(f07, { store_name: s, profile_id: "" });
        console.log(`  [FBA 07] ${s}: Nạp thành công ${c7} rows`);
      } catch (e: any) {
        console.error(`  [FBA 07 LỖI] ${s}: ${e.message}`);
      }
    } else {
      console.log(`  [FBA 07] Không tìm thấy file 07 cho ${s}`);
    }

    if (fs.existsSync(f08)) {
      try {
        const c8 = await parseAndIngestShipmentFile(f08, { store_name: s, profile_id: "" });
        console.log(`  [AWD 08] ${s}: Nạp thành công ${c8} rows`);
      } catch (e: any) {
        console.error(`  [AWD 08 LỖI] ${s}: ${e.message}`);
      }
    } else {
      console.log(`  [AWD 08] Không tìm thấy file 08 cho ${s}`);
    }
  }
}

main().catch(console.error);
