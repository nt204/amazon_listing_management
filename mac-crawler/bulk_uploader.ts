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

  // 1. Phân tích chi tiết số lượng bản ghi nếu có (Amazon Upload Processing Summary)
  // Ví dụ: "Number of records processed: 2, Number of records successful: 2, Number of records with errors: 0"
  const successMatch = normalized.match(/(?:records? successful|successful records?|thành công)\s*[:：]?\s*(\d+)/i);
  const errorMatch = normalized.match(/(?:records? with errors?|error records?|failed records?|lỗi)\s*[:：]?\s*(\d+)/i);
  const successCount = successMatch ? Number(successMatch[1]) : null;
  const errorCount = errorMatch ? Number(errorMatch[1]) : null;

  if (errorCount !== null && successCount !== null) {
    if (errorCount > 0 && successCount === 0) return "FAILED";
    if (errorCount > 0 && successCount > 0) return "PARTIAL_SUCCESS";
    if (errorCount === 0 && successCount > 0) return "SUCCESS";
  }

  // 2. Kiểm tra các trạng thái lỗi rõ ràng (FAILED)
  if (
    /finished with errors|completed with errors|processed with errors|hoàn tất.*lỗi/.test(normalized) ||
    /partial success|partially completed/.test(normalized)
  ) {
    if (successCount === 0) return "FAILED";
    return "PARTIAL_SUCCESS";
  }

  if (
    /\bfailed\b|\bfailure\b|\brejected\b|upload error|system error|input error|không thành công|thất bại|bị từ chối/.test(normalized)
  ) {
    return "FAILED";
  }

  // 3. Kiểm tra các trạng thái hoàn tất (Amazon Ads thường dùng "Finished", "Completed", "Processed", "Success")
  if (
    /\bfinished\b|\bfinish\b|\bcompleted\b|\bprocessed\b|\bsuccessful\b|\bsuccess\b|\bhoàn tất\b|\bthành công\b/.test(normalized)
  ) {
    if (errorCount !== null && errorCount > 0) {
      return successCount === 0 ? "FAILED" : "PARTIAL_SUCCESS";
    }
    return "SUCCESS";
  }

  // 4. Kiểm tra trạng thái đang xử lý ngầm (chưa xong)
  if (
    /\bin progress\b|\bprocessing\b|\bpending\b|\buploading\b|đang xử lý|đang tải|chờ xử lý|\bsubmitted\b/.test(normalized)
  ) {
    return "PROCESSING";
  }

  return null;
}

async function findUploadedFileResult(page: import("playwright-core").Page, fileName: string) {
  try {
    const evalResult = await page.evaluate((targetFileName) => {
      const baseName = targetFileName.replace(/\.xlsx$/i, "").toLowerCase();
      const shortPrefix = baseName.slice(0, Math.min(30, baseName.length)).toLowerCase();
      const targetLower = targetFileName.toLowerCase();

      // 1. Quét tất cả các hàng dữ liệu trong bảng Bulk Operations
      const allRowEls = Array.from(
        document.querySelectorAll("div.ag-row, tr[role='row'], div[role='row'], tr")
      );

      for (const r of allRowEls) {
        const text = ((r as HTMLElement).innerText || "").replace(/\s+/g, " ").trim();
        if (!text) continue;
        const lower = text.toLowerCase();

        // Bỏ qua các dòng Download lịch sử tải báo cáo (Download Sponsored Ads Bulk File)
        if (lower.includes("download sponsored ads") || (lower.includes("download") && !lower.includes("upload") && !lower.includes("preview"))) {
          continue;
        }

        // Khớp theo tên file đầy đủ, baseName, hoặc tiền tố 30 ký tự (phòng trường hợp UI Amazon cắt ngắn)
        const matchesFile = lower.includes(targetLower) || lower.includes(baseName) || (shortPrefix.length > 10 && lower.includes(shortPrefix));

        if (matchesFile) {
          const links = Array.from(r.querySelectorAll("a[href]")).map((a) => (a as HTMLAnchorElement).href);
          return { fullText: text, hrefs: links, source: "table-row" };
        }
      }

      // 2. Fallback: Kiểm tra toast / banner thông báo của Amazon
      const alerts = Array.from(document.querySelectorAll("[role='alert'], [class*='toast' i], [class*='notification' i], [class*='banner' i]"));
      for (const a of alerts) {
        const text = ((a as HTMLElement).innerText || "").replace(/\s+/g, " ").trim();
        if (!text) continue;
        const lower = text.toLowerCase();
        if (lower.includes("upload") && (lower.includes("processing") || lower.includes("success") || lower.includes("uploaded") || lower.includes("error"))) {
          return { fullText: text, hrefs: [], source: "alert" };
        }
      }

      return null;
    }, fileName);

    if (!evalResult || !evalResult.fullText) return null;

    const fullText = evalResult.fullText;
    const status = classifyAmazonResult(fullText);
    const uploadId = [...fullText.matchAll(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi)][0]?.[0]
      || evalResult.hrefs.join(" ").match(/[?&/](?:uploadId|id)[=/]([^&/]+)/i)?.[1]
      || null;

    return { status, text: fullText.slice(0, 2_000), uploadId };
  } catch (err) {
    return null;
  }
}

async function waitForAmazonResult(
  page: import("playwright-core").Page,
  fileName: string,
): Promise<AmazonBulkResult> {
  const waitDuration = Math.min(BULK_RESULT_TIMEOUT_MS, 90_000);
  const deadline = Date.now() + waitDuration;
  let lastSummary = "Amazon đã nhận file; đang xử lý ngầm trong hàng đợi tài khoản.";
  let capturedUploadId: string | null = null;
  let pollCount = 0;

  while (Date.now() < deadline) {
    pollCount++;
    const result = await findUploadedFileResult(page, fileName);
    if (result) {
      lastSummary = result.text;
      if (result.uploadId) capturedUploadId = result.uploadId;
      // Nếu có kết quả dứt điểm (SUCCESS, FAILED, PARTIAL_SUCCESS) -> Báo về NGAY LẬP TỨC!
      if (result.status && result.status !== "PROCESSING") {
        console.log(`[Bulk Uploader] 🎯 Bắt được kết quả Amazon Ads: ${result.status} (Upload ID: ${result.uploadId || "N/A"})`);
        return { status: result.status, amazonUploadId: result.uploadId, summary: result.text };
      }
    }

    // Đợi 2.5s giữa các lần kiểm tra (không reload toàn trang để tránh làm mất DOM kết quả)
    await page.waitForTimeout(2_500);

    // Ưu tiên bấm nút Refresh của bảng nếu có
    const refreshBtn = page.locator("button:has-text('Refresh'), button[aria-label*='Refresh' i]").first();
    if (await refreshBtn.count() && await refreshBtn.isVisible().catch(() => false)) {
      await refreshBtn.click().catch(() => {});
      await page.waitForTimeout(1_000);
    } else if (pollCount % 5 === 0) {
      // Chỉ reload trang sau mỗi ~15 giây nếu không có nút refresh
      await page.reload({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => {});
    }
  }

  // Nếu bắt được uploadId nhưng chưa có kết quả cuối cùng: Amazon đang xử lý ngầm
  if (capturedUploadId) {
    return {
      status: "SUCCESS",
      amazonUploadId: capturedUploadId,
      summary: `Amazon đã tiếp nhận file thành công (Upload ID: ${capturedUploadId}). Amazon đang xử lý ngầm trong tài khoản.`,
    };
  }

  // Quá deadline mà bảng Amazon Ads không hề xuất hiện dòng file này:
  // TUYỆT ĐỐI KHÔNG BÁO SUCCESS ẢO để tránh hiển thị sai lệch cho người dùng!
  console.error(`[Bulk Uploader] ❌ Quá thời gian chờ (${Math.round(waitDuration / 1000)}s) nhưng không tìm thấy file ${fileName} trên bảng Amazon Ads.`);
  return {
    status: "FAILED",
    amazonUploadId: null,
    summary: `Quá thời gian chờ (${Math.round(waitDuration / 1000)}s) nhưng không tìm thấy tác vụ upload file ${fileName} trên bảng Amazon Ads. Vui lòng kiểm tra lại.`,
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
    const uploadLocator = page
      .locator("button[data-takt-id='adz_bulkSheets_unifiedUploadModal_upload_button'], section.bulk-sheet__upload-modal-dropzone ~ div button:has-text('Upload')")
      .first();

    console.log("[Bulk Uploader] Đang chờ Amazon Ads xác thực file Bulk và kích hoạt nút Upload...");

    // Chờ nút Upload hiển thị trong modal
    await uploadLocator.waitFor({ state: "visible", timeout: 30_000 });

    // Chờ Amazon Ads validate file xong (nút enabled):
    const deadline = Date.now() + 30_000;
    let isUploadEnabled = false;
    while (Date.now() < deadline) {
      const isDisabled = await uploadLocator.isDisabled().catch(() => true);
      const ariaDisabled = await uploadLocator.getAttribute("aria-disabled").catch(() => null);
      if (!isDisabled && ariaDisabled !== "true") {
        isUploadEnabled = true;
        break;
      }
      await page.waitForTimeout(500);
    }

    if (!isUploadEnabled) {
      throw new Error("Amazon không bật nút xác nhận Upload sau khi nạp file; file có thể không hợp lệ hoặc Amazon phản hồi chậm.");
    }

    console.log("[Bulk Uploader] Nút Upload đã sáng đèn! Bấm xác nhận Upload...");
    await uploadLocator.click({ timeout: 10_000 }).catch(async () => {
      await uploadLocator.click({ force: true, timeout: 5000 }).catch(async () => {
        await page.evaluate(() => {
          const btn = document.querySelector("button[data-takt-id='adz_bulkSheets_unifiedUploadModal_upload_button']") as HTMLButtonElement | null;
          if (btn) btn.click();
        });
      });
    });

    console.log("[Bulk Uploader] Đã click nút Upload thành công! Chờ Amazon tiếp nhận file...");
    // Chờ modal đóng lại xác nhận lệnh upload đã gửi đi
    await uploadLocator.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(3000);

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
