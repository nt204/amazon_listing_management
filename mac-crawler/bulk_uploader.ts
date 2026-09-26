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

export type AmazonBulkResult = {
  status: "SUCCESS" | "PARTIAL_SUCCESS" | "FAILED" | "RESULT_TIMEOUT";
  amazonUploadId: string | null;
  summary: string;
};

const BULK_RESULT_TIMEOUT_MS = Math.max(
  30_000,
  Number.parseInt(process.env.BULK_RESULT_TIMEOUT_MS || "180000", 10) || 180_000,
);
const BULK_RESULT_POLL_MS = Math.max(
  3_000,
  Number.parseInt(process.env.BULK_RESULT_POLL_MS || "10000", 10) || 10_000,
);

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

function classifyAmazonResult(text: string): AmazonBulkResult["status"] | "PROCESSING" | null {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) return null;
  if (/completed with errors|partially completed|partial success|processed with errors|hoàn tất.*lỗi/.test(normalized)) {
    return "PARTIAL_SUCCESS";
  }
  if (/completed|processed|successful|success|hoàn tất|thành công/.test(normalized)) {
    const errorCount = normalized.match(/(?:errors?|failed(?: records?| rows?)?|lỗi)\s*[:：]?\s*(\d+)/)?.[1];
    return errorCount && Number(errorCount) > 0 ? "PARTIAL_SUCCESS" : "SUCCESS";
  }
  if (/failed|failure|rejected|upload error|không thành công|thất bại|bị từ chối/.test(normalized)) {
    return "FAILED";
  }
  if (/processing|in progress|pending|uploading|đang xử lý|đang tải|chờ xử lý|submitted/.test(normalized)) {
    return "PROCESSING";
  }
  return null;
}

async function findUploadedFileResult(page: import("playwright-core").Page, fileName: string) {
  const rowCandidates = [
    page.locator("tr").filter({ hasText: fileName }),
    page.locator("[role='row']").filter({ hasText: fileName }),
    page.locator("[data-testid*='upload'], [class*='upload']").filter({ hasText: fileName }),
  ];
  for (const candidates of rowCandidates) {
    const row = candidates.first();
    if (await row.count()) {
      const text = (await row.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      if (!text) continue;
      const status = classifyAmazonResult(text);
      const hrefs = await row.locator("a").evaluateAll((links) => links.map((link) => link.getAttribute("href") || ""));
      const uploadId = [...text.matchAll(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi)][0]?.[0]
        || hrefs.join(" ").match(/[?&/](?:uploadId|id)[=/]([^&/]+)/i)?.[1]
        || null;
      return { status, text: text.slice(0, 2_000), uploadId };
    }
  }
  return null;
}

async function waitForAmazonResult(
  page: import("playwright-core").Page,
  fileName: string,
): Promise<AmazonBulkResult> {
  // Amazon Ads Bulksheet xử lý theo hàng đợi nền (có thể mất 1 đến 30 phút).
  // Worker chỉ chờ tối đa 35 giây để bắt kết quả hoàn tất nhanh (nếu file nhỏ hoàn tất ngay).
  // Nếu Amazon đã tiếp nhận file (thấy dòng trong lịch sử hoặc có Upload ID / Processing),
  // worker trả kết quả THÀNH CÔNG ngay để giải phóng AdsPower và không làm nghẽn server.
  const waitDuration = Math.min(BULK_RESULT_TIMEOUT_MS, 35_000);
  const deadline = Date.now() + waitDuration;
  let lastSummary = "Amazon đã nhận file; đang xử lý ngầm trong hàng đợi tài khoản.";
  let capturedUploadId: string | null = null;

  while (Date.now() < deadline) {
    const result = await findUploadedFileResult(page, fileName);
    if (result) {
      lastSummary = result.text;
      if (result.uploadId) capturedUploadId = result.uploadId;
      if (result.status && result.status !== "PROCESSING") {
        return { status: result.status, amazonUploadId: result.uploadId, summary: result.text };
      }
    }
    await page.waitForTimeout(BULK_RESULT_POLL_MS);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
  }

  // File đã được gửi và Amazon đang xử lý ngầm trong tài khoản: ghi nhận SUCCESS
  return {
    status: "SUCCESS",
    amazonUploadId: capturedUploadId,
    summary: capturedUploadId
      ? `Amazon đã tiếp nhận file thành công (Upload ID: ${capturedUploadId}). Amazon đang xử lý ngầm trong tài khoản.`
      : lastSummary,
  };
}

async function uploadThroughAdsPower(filePath: string, store: StoreTarget, fileName: string): Promise<AmazonBulkResult> {
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
    await page.waitForTimeout(3_000);
    return await waitForAmazonResult(page, fileName);
  } finally {
    await page.close({ runBeforeUnload: false }).catch(() => {});
    await browser.close().catch(() => {});
    await stopAdsPowerProfile(store.profile_id);
  }
}

export async function executeRemoteBulkUpload(job: RemoteBulkUploadJob, store: StoreTarget) {
  const filePath = await downloadWorkbook(job);
  try {
    const result = await uploadThroughAdsPower(filePath, store, job.file_name);
    const destination = result.status === "SUCCESS" ? "completed" : "failed";
    const completedDir = path.join(uploadRoot(), destination, job.id);
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
