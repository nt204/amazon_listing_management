import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

// ============================================================================
// WORKER NHẬN LỆNH CRAWLER KẾ TOÁN TỪ WEB (System Admin → Crawler)
// Hỏi server mỗi 10 giây; có lệnh thì chạy đúng script của lịch tự động (run_*.sh) với
// --store / --date đã chọn, gửi log về web mỗi 15 giây và dừng khi người dùng bấm Hủy.
// Mỗi lần chỉ chạy 1 lệnh. Tách riêng khỏi remote_worker.ts (PPC) để không ảnh hưởng nhau.
// ============================================================================

const SCRIPT_DIR = __dirname;

function loadEnv() {
  const envPath = path.join(SCRIPT_DIR, "config.env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    if (!process.env[key]) process.env[key] = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
  }
}

loadEnv();

const WEB_APP_URL = (process.env.WEB_APP_URL || "https://ncehub.net").replace(/\/+$/, "");
const AUTH_TOKEN = process.env.WEB_APP_AUTH_TOKEN?.trim() || "";
const WORKER_ID = (process.env.WORKER_ID || os.hostname()).trim();
const POLL_MS = 10_000;
const HEARTBEAT_MS = 15_000;
const KILL_GRACE_MS = 20_000;
const LOG_TAIL_CHARS = 8_000;

const CRAWLER_SCRIPTS: Record<string, string> = {
  accounting_daily: "run_accounting_daily.sh",
  accounting_monthly: "run_accounting_monthly.sh",
  inventory_ledger: "run_inventory_weekly.sh",
  awd_ledger: "run_awd_weekly.sh",
};

interface CrawlerJob {
  id: string;
  crawler: string;
  store_name: string | null;
  target_date: string | null;
}

function log(message: string) {
  console.log(`[${new Date().toISOString()}] [AccountingJobWorker] ${message}`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getStoreNames(): string[] {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, "stores.json"), "utf8")) as {
      store_name?: string;
      enabled?: boolean;
    }[];
    return list.filter((s) => s.enabled !== false && s.store_name).map((s) => s.store_name!);
  } catch {
    return [];
  }
}

async function callServer<T>(body: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${WEB_APP_URL}/api/accounting/crawler/worker`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${AUTH_TOKEN}` },
      body: JSON.stringify({ worker_id: WORKER_ID, ...body }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timeout);
  }
}

/** Giữ phần cuối log (bỏ mã màu ANSI) để gửi lên web. */
class LogTail {
  private text = "";
  push(chunk: string) {
    this.text = (this.text + chunk.replace(/\x1b\[[0-9;]*m/g, "")).slice(-LOG_TAIL_CHARS);
  }
  get value() {
    return this.text;
  }
  get lastLine() {
    const lines = this.text.split("\n").map((l) => l.trim()).filter(Boolean);
    return lines.length ? lines[lines.length - 1].slice(0, 300) : null;
  }
}

async function runJob(job: CrawlerJob) {
  const scriptName = CRAWLER_SCRIPTS[job.crawler];
  const scriptPath = scriptName ? path.join(SCRIPT_DIR, scriptName) : "";
  if (!scriptPath || !fs.existsSync(scriptPath)) {
    await callServer({
      action: "finish",
      job_id: job.id,
      exit_code: null,
      log_tail: null,
      error: `Máy Mac chưa có script cho crawler "${job.crawler}" (${scriptName || "không rõ"}). Cập nhật code mac-crawler rồi thử lại.`,
    });
    return;
  }

  const args = [scriptPath];
  if (job.store_name) args.push(`--store=${job.store_name}`);
  if (job.target_date) args.push(`--date=${job.target_date}`);
  log(`Chạy lệnh ${job.id}: bash ${args.map((a) => path.basename(a)).join(" ")}`);

  const tail = new LogTail();
  // detached: tạo process group riêng để khi Hủy thì dừng được cả tiến trình con (tsx, Playwright)
  const child = spawn("/bin/bash", args, {
    cwd: SCRIPT_DIR,
    detached: true,
    env: { ...process.env, CRAWLER_JOB_ID: job.id },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk: Buffer) => {
    process.stdout.write(chunk);
    tail.push(chunk.toString("utf8"));
  });
  child.stderr.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
    tail.push(chunk.toString("utf8"));
  });

  let killing = false;
  const stopChild = () => {
    if (killing || child.pid == null) return;
    killing = true;
    log(`Dừng lệnh ${job.id} theo yêu cầu...`);
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
    setTimeout(() => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {}
    }, KILL_GRACE_MS).unref();
  };

  const heartbeat = setInterval(async () => {
    try {
      const res = await callServer<{ cancelRequested: boolean }>({
        action: "heartbeat",
        job_id: job.id,
        current_step: tail.lastLine,
        log_tail: tail.value,
      });
      if (res.cancelRequested) stopChild();
    } catch (error) {
      log(`Heartbeat lỗi: ${(error as Error).message}`);
    }
  }, HEARTBEAT_MS);

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on("error", (error) => {
      tail.push(`\n[Worker] Không chạy được script: ${error.message}\n`);
      resolve(null);
    });
    child.on("close", (code, signal) => resolve(code ?? (signal ? -1 : null)));
  });
  clearInterval(heartbeat);

  log(`Lệnh ${job.id} kết thúc, exit code ${exitCode}.`);
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await callServer({
        action: "finish",
        job_id: job.id,
        exit_code: exitCode,
        log_tail: tail.value,
        error: exitCode === 0 ? null : tail.lastLine || `Script kết thúc với exit code ${exitCode}.`,
      });
      return;
    } catch (error) {
      log(`Gửi kết quả lỗi (lần ${attempt}/5): ${(error as Error).message}`);
      await sleep(5_000 * attempt);
    }
  }
}

async function main() {
  if (!AUTH_TOKEN) {
    console.error("[AccountingJobWorker] Thiếu WEB_APP_AUTH_TOKEN trong config.env.");
    process.exit(1);
  }
  log(`Khởi động worker ${WORKER_ID} → ${WEB_APP_URL}`);
  const info = {
    hostname: os.hostname(),
    node: process.version,
    scripts: Object.fromEntries(
      Object.entries(CRAWLER_SCRIPTS).map(([crawler, script]) => [crawler, fs.existsSync(path.join(SCRIPT_DIR, script))]),
    ),
  };
  for (;;) {
    try {
      const { job } = await callServer<{ job: CrawlerJob | null }>({ action: "poll", stores: getStoreNames(), info });
      if (job) await runJob(job);
    } catch (error) {
      log(`Không kết nối được server: ${(error as Error).message}`);
    }
    await sleep(POLL_MS);
  }
}

main();
