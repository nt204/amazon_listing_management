import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { LaunchPlan } from "./campaign-launch";

export async function exportCampaignLaunchBulksheet(plan: LaunchPlan): Promise<Buffer> {
  const pythonScript = path.join(process.cwd(), "scripts", "export_campaign_launch_bulksheet.py");
  const templatePath = path.join(process.cwd(), "templates", "ppc", "AdvertisingBulksheetTemplate-seller.xlsx");
  if (!fs.existsSync(pythonScript) || !fs.existsSync(templatePath)) {
    throw new Error("Không tìm thấy python script hoặc template AdvertisingBulksheetTemplate-seller.xlsx.");
  }

  return new Promise((resolve, reject) => {
    const proc = spawn("python3", [pythonScript], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    proc.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    proc.stderr.on("data", (chunk) => errChunks.push(Buffer.from(chunk)));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`Lỗi khi tạo Bulksheet lên camp: ${Buffer.concat(errChunks).toString("utf-8")}`));
      }
      resolve(Buffer.concat(chunks));
    });
    proc.stdin.write(JSON.stringify(plan));
    proc.stdin.end();
  });
}
