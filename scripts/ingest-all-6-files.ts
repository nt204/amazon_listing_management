import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

loadEnvFile(path.join(process.cwd(), ".env.local"));
loadEnvFile(path.join(process.cwd(), ".env"));
import { ingestPpcFilePath } from "../lib/ppc/service";

const BULK_DIR = path.join(os.homedir(), "Downloads", "Bulk file");
const STORE_NAME = "HSOSTORE";

const all6Files = [
  { name: "HSOSTORE_Bulk_SP_30Days_20260817-20260917.xlsx", days: 30, type: "Bulk SP 30d" },
  { name: "HSOSTORE_Bulk_SB_30Days_20260817-20260917.xlsx", days: 30, type: "Bulk SB 30d" },
  { name: "HSOSTORE_Bulk_SP_7Days_20260910-20260917.xlsx", days: 7, type: "Bulk SP 7d" },
  { name: "HSOSTORE_Bulk_SB_7Days_20260910-20260917.xlsx", days: 7, type: "Bulk SB 7d" },
  { name: "HSOSTORE_Search_Term_SP_30Days_20260917.xlsx", days: 30, type: "Search Term SP 30d (Daily)" },
  { name: "HSOSTORE_Search_Term_SB_30Days_20260917.xlsx", days: 30, type: "Search Term SB 30d (Daily)" },
];

async function main() {
  console.log("=== KIỂM TRA 6 FILE TRONG THƯ MỤC BULK FILE ===");
  for (let i = 0; i < all6Files.length; i++) {
    const f = all6Files[i];
    const full = path.join(BULK_DIR, f.name);
    if (!fs.existsSync(full)) {
      throw new Error(`THIẾU FILE: ${f.name}`);
    }
    const stat = fs.statSync(full);
    const size = Math.round(stat.size / 1024);
    const sizeStr = size >= 1024 ? (size / 1024).toFixed(1) + " MB" : size + " KB";
    console.log(`${i + 1}. [${f.type}] ${f.name} - ${sizeStr}`);
  }

  console.log("\n=== BẮT ĐẦU NẠP LẦN LƯỢT CẢ 6 FILE VÀO DATABASE ===");
  const scope = { teamId: "default", actorId: "system" };

  for (let i = 0; i < all6Files.length; i++) {
    const f = all6Files[i];
    const fullPath = path.join(BULK_DIR, f.name);
    console.log(`\n[${i + 1}/6] Nạp file: ${f.name} (${f.type}, phạm vi ${f.days} ngày)...`);
    const startTime = Date.now();
    const res = await ingestPpcFilePath(scope, fullPath, f.name, STORE_NAME, {
      days: f.days,
    });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  -> Thành công sau ${elapsed}s: Tổng parsed ${res.totalParsed} dòng (Mới: ${res.newInserted}, Update: ${res.updated})`);
  }

  console.log("\n=== TẤT CẢ 6 FILE ĐÃ NẠP XONG HOÀN HẢO! ===");
}

main().catch((err) => {
  console.error("Lỗi khi nạp file:", err);
  process.exit(1);
});
