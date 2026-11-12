#!/usr/bin/env node
/**
 * disbursements_crawler.ts
 * Tiến trình tự động quét đối soát tiền về (Disbursements / Transfers) từ Amazon Seller Central.
 * 
 * - Lấy: Ngày Acknowledged, Payout Amount, Trace ID, Settlement Group, Chu kỳ (Period).
 * - Cột Brand: Tên store (LIMIMA, MALFIRST, FASTPEACE, BOZSPACER, WARMSTOREY).
 * - Chỉ quét những dòng có Payout Status là Done (loại bỏ Started, Failed, No disbursement).
 * - Tránh va chạm job: Kiểm tra lock của Inventory Crawler & Accounting Crawler trước khi chạy.
 * - Tối ưu tốc độ: Chặn toàn bộ ảnh, media, font và tracker quảng cáo khi tải trang (tải trong 2 giây).
 * - Checkpoint / Idempotent: Lưu vào DB thông qua API hoặc SQL, không bao giờ trùng lặp dữ liệu.
 */

import { chromium, type Page } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// 1. Nạp biến môi trường từ config.env
function loadEnv() {
  const envPath = path.join(__dirname, "config.env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}
loadEnv();

const ADSPOWER_API_URL = process.env.ADSPOWER_API_URL || "http://127.0.0.1:50325";
const WEB_APP_URL = (process.env.WEB_APP_URL || "https://ncehub.net").replace(/\/$/, "");
const WEB_APP_AUTH_TOKEN = process.env.WEB_APP_AUTH_TOKEN || "";

// 2. Quản lý khoá (Lock / Mutex) tránh va chạm với Inventory Crawler & Kế toán
const LOCK_DIR = path.join(os.homedir(), "Library", "Application Support", "AmazonAccounting");
const DISBURSEMENTS_LOCK_PATH = path.join(LOCK_DIR, "disbursements_run.lock");
const INVENTORY_LOCK_PATH = path.join(LOCK_DIR, "inventory_run.lock");
const ACCOUNTING_LOCK_PATH = path.join(LOCK_DIR, "accounting_run.lock");

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExternalLocks(maxWaitSeconds = 600) {
  const start = Date.now();
  while (Date.now() - start < maxWaitSeconds * 1000) {
    let busyFile: string | null = null;
    let busyPid: number | null = null;

    for (const lockPath of [INVENTORY_LOCK_PATH, ACCOUNTING_LOCK_PATH]) {
      if (fs.existsSync(lockPath)) {
        try {
          const raw = fs.readFileSync(lockPath, "utf8").trim().split(/\s+/)[0];
          const pid = Number(raw);
          if (pid > 0 && isPidAlive(pid)) {
            busyFile = path.basename(lockPath);
            busyPid = pid;
            break;
          } else {
            // Lock rác không còn tiến trình
            try { fs.unlinkSync(lockPath); } catch {}
          }
        } catch {}
      }
    }

    if (!busyFile) return; // Không có ai đang giữ lock

    console.log(`[Lock Mutex] Đang đợi tiến trình ${busyFile} (PID ${busyPid}) hoàn tất trước khi quét tiền về... (thử lại sau 10s)`);
    await new Promise((r) => setTimeout(r, 10000));
  }
  console.warn("[Lock Mutex] Cảnh báo: Hết thời gian chờ lock khác, tiếp tục chạy.");
}

function acquireDisbursementsLock(): () => void {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
  try {
    const fd = fs.openSync(DISBURSEMENTS_LOCK_PATH, "wx", 0o600);
    fs.writeFileSync(fd, `${process.pid}\n${new Date().toISOString()}\n`);
    fs.closeSync(fd);
  } catch (error: any) {
    if (error?.code !== "EEXIST") throw error;
    const raw = fs.readFileSync(DISBURSEMENTS_LOCK_PATH, "utf8").trim().split(/\s+/)[0];
    const pid = Number(raw);
    if (pid > 0 && isPidAlive(pid)) {
      throw new Error(`Một tiến trình Disbursements Crawler khác đang chạy (PID ${pid}). Dừng lại để tránh xung đột.`);
    }
    // Gỡ lock mồ côi
    try { fs.unlinkSync(DISBURSEMENTS_LOCK_PATH); } catch {}
    return acquireDisbursementsLock();
  }

  return () => {
    try {
      if (fs.existsSync(DISBURSEMENTS_LOCK_PATH)) {
        fs.unlinkSync(DISBURSEMENTS_LOCK_PATH);
      }
    } catch {}
  };
}

// 3. Parser ngày giờ Amazon
function parseAmazonDateTime(rawText: string): { date: Date; dateOnly: string } | null {
  const clean = rawText.replace(/\u00ad/g, "").replace(/\s+/g, " ").trim();
  const m = clean.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return null;

  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  let hour = parseInt(m[4], 10);
  const minute = parseInt(m[5], 10);
  const ampm = (m[6] || "").toUpperCase();

  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;

  const dateOnly = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const d = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return { date: d, dateOnly };
}

function parseAmazonPeriod(periodStr: string): { start: string | null; end: string | null } {
  const m = periodStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*[–-]\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return { start: null, end: null };
  const sY = m[3], sM = m[1].padStart(2, "0"), sD = m[2].padStart(2, "0");
  const eY = m[6], eM = m[4].padStart(2, "0"), eD = m[5].padStart(2, "0");
  return {
    start: `${sY}-${sM}-${sD}`,
    end: `${eY}-${eM}-${eD}`,
  };
}

export interface DisbursementRecord {
  store_name: string;
  currency: string;
  payout_amount: number;
  payout_status: string;
  acknowledged_at: string | null;
  acknowledged_date: string | null;
  trace_id: string | null;
  settlement_group: string | null;
  period_start: string | null;
  period_end: string | null;
  period_raw: string | null;
  raw_metadata: Record<string, unknown>;
}

// 4. Quét từng store qua AdsPower và Playwright
async function scrapeStoreDisbursements(storeName: string, profileId: string): Promise<DisbursementRecord[]> {
  console.log(`\n============================================================`);
  console.log(`🏪 [${storeName}] Bắt đầu mở AdsPower profile: ${profileId}`);
  console.log(`============================================================`);

  // Kiểm tra xem profile có đang bị mở bởi tiến trình khác không
  try {
    const activeRes = await fetch(`${ADSPOWER_API_URL}/api/v1/browser/active?user_id=${profileId}`);
    const activeData = (await activeRes.json()) as any;
    if (activeData.data?.status === "Active") {
      console.log(`[AdsPower] Profile ${profileId} đang mở, đợi 5s...`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  } catch {}

  // Mở profile
  const startRes = await fetch(`${ADSPOWER_API_URL}/api/v1/browser/start?user_id=${profileId}&open_tabs=1`);
  const startData = (await startRes.json()) as any;
  if (startData.code !== 0 || !startData.data?.debug_port) {
    throw new Error(`Không thể mở AdsPower [${storeName}]: ${startData.msg || JSON.stringify(startData)}`);
  }

  const cdpPort = startData.data.debug_port;
  console.log(`[AdsPower] Profile mở thành công! CDP Port: ${cdpPort}`);

  let browser: any = null;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const context = browser.contexts()[0] || (await browser.newContext());
    const page: Page = context.pages()[0] || (await context.newPage());

    // ⚡ TỐI ƯU TỐC ĐỘ: Chặn ảnh, media, font, tracking quảng cáo để tải trang trong 2 giây
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      const url = route.request().url();
      if (
        type === "image" ||
        type === "media" ||
        type === "font" ||
        url.includes("amazon-adsystem.com") ||
        url.includes("fls-na.amazon.com") ||
        url.includes("assoc-amazon.com") ||
        url.includes("advertising.amazon.com")
      ) {
        return route.abort();
      }
      return route.continue();
    });

    const targetUrl = "https://sellercentral.amazon.com/payments/allstatements/index.html?ref_=xx_disbmt_ttab_rrepo";
    console.log(`[${storeName}] Đang điều hướng đến trang Disbursements...`);
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45000 });

    // Đợi container bảng thanh toán xuất hiện (tối đa 15s)
    await page.waitForSelector(".content.settlement-groups-summary, .fund-transfer-box", { timeout: 15000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));

    // ⚡ Đợi bảng tải và CUỘN TỰ ĐỘNG ĐỂ TẢI HẾT TOÀN BỘ LỊCH SỬ TIỀN VỀ (Infinite Scroll)
    await page.waitForSelector(".content.settlement-groups-summary", { timeout: 15000 }).catch(() => {});

    console.log(`[${storeName}] Đang cuộn trang để tải toàn bộ lịch sử các đợt tiền về...`);
    let lastRowCount = 0;
    let unchangedRounds = 0;
    const maxScrolls = 20; // Tối đa 20 lần cuộn (~200 đợt tiền về)

    for (let scroll = 1; scroll <= maxScrolls; scroll++) {
      const currentCount = await page.evaluate(() => document.querySelectorAll(".content.settlement-groups-summary").length);
      if (currentCount > 0 && currentCount === lastRowCount) {
        unchangedRounds++;
        if (unchangedRounds >= 2) {
          console.log(`[${storeName}] Đã chạm đáy danh sách (Tổng cộng ${currentCount} đợt).`);
          break;
        }
      } else {
        unchangedRounds = 0;
        lastRowCount = currentCount;
      }

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise((r) => setTimeout(r, 1200));
    }

    console.log(`[${storeName}] Bắt đầu bóc tách ${lastRowCount} đợt giải ngân...`);

    const extracted = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll(".content.settlement-groups-summary"));
      const list: Array<{
        status: string;
        amountRaw: string;
        ackRaw: string;
        traceId: string;
        settlementGroup: string;
        periodRaw: string;
      }> = [];

      for (const r of rows) {
        // 1. Kiểm tra trạng thái: chỉ lấy 'Done'
        const statusIndicator = r.querySelector("kat-statusindicator");
        const statusLabel = statusIndicator?.getAttribute("label") || "";
        const el = r as HTMLElement;
        const lines: string[] = (el.innerText || el.textContent || "")
          .replace(/\u00ad/g, "")
          .split("\n")
          .map((l: string) => l.trim())
          .filter(Boolean);

        let isDone = statusLabel.toLowerCase() === "done" || lines.includes("Done");
        if (!isDone) continue; // Bỏ qua nếu là Started, Failed, No disbursement...

        // 2. Acknowledged Date
        const ackIdx = lines.findIndex((l: string) => l.includes("Acknowledged by"));
        let ackRaw = "";
        if (ackIdx !== -1 && lines[ackIdx + 1]) {
          ackRaw = `${lines[ackIdx + 1]} ${lines[ackIdx + 2] || ""}`.trim();
        }

        // 3. Trace ID
        const traceIdx = lines.findIndex((l: string) => l.startsWith("Trace Id"));
        let traceId = "";
        if (traceIdx !== -1 && lines[traceIdx + 1] && !lines[traceIdx + 1].includes(":")) {
          traceId = lines[traceIdx + 1];
        }

        // 4. Settlement Group
        const groupIdx = lines.findIndex((l: string) => l.startsWith("Settlement Group"));
        let settlementGroup = "";
        if (groupIdx !== -1 && lines[groupIdx + 1] && !lines[groupIdx + 1].includes(":")) {
          settlementGroup = lines[groupIdx + 1];
        }

        // 5. Payout Amount
        const amountIdx = lines.findIndex((l: string) => l.startsWith("Payout Amount"));
        let amountRaw = "";
        if (amountIdx !== -1 && lines[amountIdx + 1]) {
          amountRaw = lines[amountIdx + 1];
        } else {
          const payoutEl = r.querySelector(".payout");
          amountRaw = payoutEl?.textContent?.replace(/Payout Amount:/i, "").trim() || "";
        }

        // 6. Chu kỳ
        const periodRaw = lines[0] && (lines[0].includes("–") || lines[0].includes("-")) ? lines[0] : "";

        list.push({
          status: "Done",
          amountRaw,
          ackRaw,
          traceId,
          settlementGroup,
          periodRaw,
        });
      }

      return list;
    });

    console.log(`[${storeName}] Tìm thấy ${extracted.length} đợt tiền về có trạng thái 'Done'.`);

    // Parse và chuẩn hoá dữ liệu
    const records: DisbursementRecord[] = [];
    for (const item of extracted) {
      const cleanNum = Number(item.amountRaw.replace(/[$,\s]/g, ""));
      if (isNaN(cleanNum)) continue;

      const ackParsed = item.ackRaw ? parseAmazonDateTime(item.ackRaw) : null;
      const periodParsed = item.periodRaw ? parseAmazonPeriod(item.periodRaw) : { start: null, end: null };

      records.push({
        store_name: storeName,
        currency: "USD",
        payout_amount: cleanNum,
        payout_status: "Done",
        acknowledged_at: ackParsed?.date ? ackParsed.date.toISOString() : null,
        acknowledged_date: ackParsed?.dateOnly || null,
        trace_id: item.traceId || null,
        settlement_group: item.settlementGroup || null,
        period_start: periodParsed.start,
        period_end: periodParsed.end,
        period_raw: item.periodRaw || null,
        raw_metadata: {
          scraped_at: new Date().toISOString(),
          ack_raw: item.ackRaw,
          amount_raw: item.amountRaw,
        },
      });
    }

    return records;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    // Lập tức đóng profile để giải phóng RAM cho Mac mini
    console.log(`[AdsPower] Đang đóng profile ${profileId} để giải phóng RAM...`);
    await fetch(`${ADSPOWER_API_URL}/api/v1/browser/stop?user_id=${profileId}`).catch(() => {});
    console.log(`[AdsPower] Đã đóng profile ${profileId} thành công.`);
  }
}

// 5. Lưu vào Database (Python psycopg2 trực tiếp hoặc Web API)
async function saveDisbursementsToDatabase(records: DisbursementRecord[]) {
  if (records.length === 0) return { inserted: 0, updated: 0 };

  console.log(`[Database] Đang lưu ${records.length} bản ghi tiền về vào PostgreSQL...`);
  try {
    const { execSync } = await import("node:child_process");
    const pyScript = path.join(__dirname, "save_disbursements_db.py");
    const pythonBin = fs.existsSync("/opt/homebrew/bin/python3") ? "/opt/homebrew/bin/python3" : "python3";
    const jsonStr = JSON.stringify({ items: records });
    const output = execSync(`"${pythonBin}" "${pyScript}"`, {
      input: jsonStr,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "inherit"],
      timeout: 60000,
    });
    const parsed = JSON.parse(output.trim());
    console.log(`[Database] ✅ Đã lưu thành công: Mới: ${parsed.inserted || 0}, Cập nhật: ${parsed.updated || 0}`);
    return { inserted: parsed.inserted || 0, updated: parsed.updated || 0 };
  } catch (err: any) {
    console.warn(`[Database] Lưu qua python/psycopg2 thất bại: ${err.message}. Thử qua Web API...`);
    const res = await fetch(`${WEB_APP_URL}/api/accounting/disbursements`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(WEB_APP_AUTH_TOKEN ? { Authorization: `Bearer ${WEB_APP_AUTH_TOKEN}` } : {}),
      },
      body: JSON.stringify({ items: records }),
    });

    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok || !json?.success) {
      throw new Error(`Lỗi API lưu dữ liệu: ${json?.error || res.statusText}`);
    }

    console.log(`[Database] ✅ Đã lưu thành công qua Web API: Mới: ${json.inserted || 0}, Cập nhật: ${json.updated || 0}`);
    return { inserted: json.inserted || 0, updated: json.updated || 0 };
  }
}

// 6. Hàm chạy chính
export async function main() {
  console.log(`\n======================================================================`);
  console.log(`### TIẾN TRÌNH TỰ ĐỘNG QUÉT ĐỐI SOÁT TIỀN VỀ (DISBURSEMENTS) BẮT ĐẦU`);
  console.log(`### Thời gian: ${new Date().toLocaleString("vi-VN")}`);
  console.log(`======================================================================`);

  // Phân tích tham số dòng lệnh
  const args = process.argv.slice(2);
  const isForce = args.includes("--force");
  const storesFilterArg = args.find((a) => a.startsWith("--stores="))?.split("=")[1];
  const targetStores = storesFilterArg ? storesFilterArg.split(",").map((s) => s.trim().toUpperCase()) : null;

  // 1. Kiểm tra lock va chạm
  if (!isForce) {
    await waitForExternalLocks(300);
  }
  const releaseLock = acquireDisbursementsLock();

  try {
    // 2. Đọc danh sách stores
    const storesPath = path.join(__dirname, "stores.json");
    if (!fs.existsSync(storesPath)) {
      throw new Error(`Không tìm thấy file ${storesPath}`);
    }
    const allStores = JSON.parse(fs.readFileSync(storesPath, "utf8")) as Array<{
      store_name: string;
      profile_id: string;
      enabled: boolean;
    }>;

    const storesToRun = allStores.filter((s) => {
      if (!s.enabled) return false;
      if (targetStores && !targetStores.includes(s.store_name.toUpperCase())) return false;
      return true;
    });

    console.log(`[Planner] Sẽ quét tiền về cho ${storesToRun.length} stores: ${storesToRun.map((s) => s.store_name).join(", ")}`);

    const allScraped: DisbursementRecord[] = [];
    let totalInserted = 0;
    let totalUpdated = 0;

    for (const store of storesToRun) {
      try {
        const records = await scrapeStoreDisbursements(store.store_name, store.profile_id);
        allScraped.push(...records);

        // Lưu ngay sau mỗi store để đảm bảo checkpoint
        const saveRes = await saveDisbursementsToDatabase(records);
        totalInserted += saveRes.inserted;
        totalUpdated += saveRes.updated;
      } catch (err: any) {
        console.error(`❌ [LỖI] Store ${store.store_name} gặp lỗi khi quét tiền về: ${err.message}`);
      }

      // Nghỉ 2 giây trước khi sang store tiếp theo
      await new Promise((r) => setTimeout(r, 2000));
    }

    console.log(`\n======================================================================`);
    console.log(`### TỔNG KẾT QUÉT TIỀN VỀ HOÀN TẤT`);
    console.log(`### Tổng số bản ghi tìm thấy: ${allScraped.length}`);
    console.log(`### Số bản ghi mới (Inserted): ${totalInserted}`);
    console.log(`### Số bản ghi cập nhật (Updated): ${totalUpdated}`);
    console.log(`======================================================================\n`);

    if (allScraped.length > 0) {
      console.log("=== BẢNG TỔNG HỢP TIỀN VỀ CÁC STORE ===");
      console.table(
        allScraped.map((r) => ({
          Store: r.store_name,
          "Ngày Acknowledged": r.acknowledged_date,
          "Tiền về": `$${r.payout_amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
          Status: r.payout_status,
          "Trace ID": r.trace_id,
          "Chu kỳ": r.period_raw,
        }))
      );
    }
  } finally {
    releaseLock();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error("[Fatal Error]", e);
    process.exit(1);
  });
}
