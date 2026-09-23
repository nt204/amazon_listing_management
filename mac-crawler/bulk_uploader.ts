import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { chromium } from "playwright-core";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { startAdsPowerProfile, stopAdsPowerProfile, type StoreTarget } from "./crawler";

export interface RemoteBulkUploadJob {
  id: string;
  store_name: string;
  file_name: string;
  r2_key: string;
  sha256: string;
  lease_token: string;
}

function uploadRoot() {
  return (process.env.BULK_UPLOAD_DIR || path.join(os.homedir(), "AmazonPpcCrawler", "bulk-upload"))
    .replace("$HOME", os.homedir()).replace(/^~/, os.homedir());
}

function r2Client() {
  const endpoint = process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID
    ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : "");
  if (!endpoint || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY || !process.env.R2_BUCKET_NAME) {
    throw new Error("Thiếu cấu hình R2 để tải file Bulk remote.");
  }
  return new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

async function downloadWorkbook(job: RemoteBulkUploadJob) {
  const safeName = path.basename(job.file_name);
  if (!safeName.toLowerCase().endsWith(".xlsx")) throw new Error("Remote job không phải file .xlsx.");
  const dir = path.join(uploadRoot(), "inbox", job.id);
  fs.mkdirSync(dir, { recursive: true });
  const finalPath = path.join(dir, safeName);
  const tempPath = `${finalPath}.part`;
  const response = await r2Client().send(new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!, Key: job.r2_key,
  }));
  if (!response.Body) throw new Error("R2 trả về file Bulk rỗng.");
  const bytes = Buffer.from(await response.Body.transformToByteArray());
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("File tải từ R2 không phải workbook XLSX hợp lệ.");
  }
  const actualHash = crypto.createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== job.sha256) throw new Error(`SHA-256 file Bulk không khớp (${actualHash}).`);
  fs.writeFileSync(tempPath, bytes, { mode: 0o600 });
  fs.renameSync(tempPath, finalPath);
  return finalPath;
}

async function uploadThroughAdsPower(filePath: string, store: StoreTarget) {
  const endpoint = await startAdsPowerProfile(store.profile_id);
  const browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  if (!context) throw new Error("Không tìm thấy browser context của AdsPower.");
  const page = await context.newPage();
  try {
    await page.goto("https://advertising.amazon.com/bulk-operations", { waitUntil: "domcontentloaded" });
    const currentUrl = page.url();
    if (!currentUrl.includes("advertising.amazon.com") || /signin|login/i.test(currentUrl)) {
      throw new Error(`Profile ${store.store_name} chưa đăng nhập Amazon Ads (${currentUrl}).`);
    }
    let input = await page.$("input[type='file']");
    if (!input) {
      const openButton = await page.waitForSelector(
        "button[data-takt-id='Bulksheet_home_upload_campaigns_button'], button:has-text('Upload campaigns')",
        { timeout: 30_000 },
      ).catch(() => null);
      if (!openButton) throw new Error("Không tìm thấy nút Upload campaigns trên Amazon Ads.");
      await openButton.click();
      input = await page.waitForSelector("input[type='file']", { state: "attached", timeout: 15_000 }).catch(() => null);
    }
    if (!input) throw new Error("Không tìm thấy input chọn file Bulk.");
    await input.setInputFiles(filePath);
    const confirm = await page.waitForSelector(
      "button[data-takt-id='adz_bulkSheets_unifiedUploadModal_upload_button']:not([disabled]), button:has-text('Upload'):not([disabled]):not([data-takt-id*='home'])",
      { timeout: 30_000 },
    ).catch(() => null);
    if (!confirm) throw new Error("Amazon không bật nút xác nhận Upload; file có thể không hợp lệ.");
    await confirm.click();

    const failure = await page.waitForSelector("[role='alert']", { timeout: 8_000 }).catch(() => null);
    const alertText = failure ? await failure.innerText().catch(() => "") : "";
    if (/error|failed|invalid|không hợp lệ/i.test(alertText)) {
      throw new Error(`Amazon từ chối file Bulk: ${alertText.slice(0, 500)}`);
    }
    await page.waitForTimeout(2_000);
    return { amazonUploadId: null as string | null };
  } finally {
    await page.close({ runBeforeUnload: false }).catch(() => {});
    await browser.close().catch(() => {});
    await stopAdsPowerProfile(store.profile_id);
  }
}

export async function executeRemoteBulkUpload(job: RemoteBulkUploadJob, store: StoreTarget) {
  const filePath = await downloadWorkbook(job);
  try {
    const result = await uploadThroughAdsPower(filePath, store);
    const completedDir = path.join(uploadRoot(), "completed", job.id);
    fs.mkdirSync(completedDir, { recursive: true });
    fs.renameSync(filePath, path.join(completedDir, path.basename(filePath)));
    fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
    return result;
  } catch (error) {
    const failedDir = path.join(uploadRoot(), "failed", job.id);
    fs.mkdirSync(failedDir, { recursive: true });
    if (fs.existsSync(filePath)) fs.renameSync(filePath, path.join(failedDir, path.basename(filePath)));
    fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
    throw error;
  }
}
