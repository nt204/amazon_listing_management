import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export type ReportTaskType = "BULK_SP" | "BULK_SB" | "ST_SP" | "ST_SB";

export type ReportTaskStatus =
  | "NOT_STARTED"
  | "REQUESTED"
  | "AMAZON_PROCESSING"
  | "DOWNLOADABLE"
  | "DOWNLOADING"
  | "DOWNLOADED"
  | "VALIDATED"
  | "UPLOADED"
  | "RETRY_WAIT"
  | "FAILED";

export interface ReportTaskState {
  id: string; // e.g. "HSOSTORE_BULK_SP_30D"
  store: string;
  type: ReportTaskType;
  days: number;
  status: ReportTaskStatus;
  attempt: number;
  amazonRequestId?: string | null;
  reportName?: string | null;
  localPath?: string | null;
  sizeBytes?: number;
  sha256?: string | null;
  r2Key?: string | null;
  lastError?: string | null;
  nextRetryAt?: string | null;
}

export interface JobCheckpoint {
  jobId: string;
  batchId: string;
  storeName: string;
  batchDate: string;
  stage: string;
  startedAt: string;
  updatedAt: string;
  runAttempt?: number;
  lastError?: string | null;
  tasks: ReportTaskState[];
}

/**
 * Tính mã băm SHA-256 của file local
 */
export async function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      return reject(new Error(`File không tồn tại để tính SHA-256: ${filePath}`));
    }
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (data) => hash.update(data));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", (err) => reject(err));
  });
}

/**
 * Thư mục lưu trữ checkpoint cục bộ của Mac mini
 */
export function getCheckpointDir(): string {
  const home = os.homedir();
  const dir = path.join(home, "Library", "Application Support", "AmazonPpcCrawler", "jobs");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Đọc checkpoint của một job từ ổ cứng
 */
export function loadJobCheckpoint(jobId: string): JobCheckpoint | null {
  try {
    const dir = getCheckpointDir();
    const filePath = path.join(dir, `${jobId}.json`);
    if (!fs.existsSync(filePath)) return null;

    const raw = fs.readFileSync(filePath, "utf8");
    const checkpoint: JobCheckpoint = JSON.parse(raw);

    // Kiểm tra tính toàn vẹn của các file đã ghi nhận DOWNLOADED hoặc VALIDATED
    for (const task of checkpoint.tasks) {
      if (task.status === "DOWNLOADED" || task.status === "VALIDATED" || task.status === "UPLOADED") {
        if (!task.localPath || !fs.existsSync(task.localPath)) {
          console.warn(`[Checkpoint] File ${task.id} không còn tồn tại trên đĩa, đưa về NOT_STARTED`);
          task.status = "NOT_STARTED";
          task.localPath = null;
        } else {
          const stat = fs.statSync(task.localPath);
          if (stat.size === 0) {
            console.warn(`[Checkpoint] File ${task.id} rỗng (0 bytes), đưa về NOT_STARTED`);
            task.status = "NOT_STARTED";
            task.localPath = null;
          }
        }
      }
    }

    return checkpoint;
  } catch (err) {
    console.error(`[Checkpoint] Lỗi khi đọc checkpoint job ${jobId}:`, err);
    return null;
  }
}

/**
 * Ghi checkpoint nguyên tử (Atomic Write qua file tạm rồi rename để tránh hỏng JSON khi mất điện)
 */
export function saveJobCheckpointAtomic(checkpoint: JobCheckpoint): void {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let tempPath = "";
    try {
    const dir = getCheckpointDir();
    const targetPath = path.join(dir, `${checkpoint.jobId}.json`);
    tempPath = path.join(dir, `${checkpoint.jobId}.tmp.${process.pid}.${Date.now()}.${attempt}`);

    checkpoint.updatedAt = new Date().toISOString();
    const content = JSON.stringify(checkpoint, null, 2);

    const fd = fs.openSync(tempPath, "w", 0o600);
    try {
      fs.writeFileSync(fd, content, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tempPath, targetPath);
    return;
    } catch (err) {
      lastError = err;
      if (tempPath) try { fs.unlinkSync(tempPath); } catch {}
    }
  }
  throw new Error(`[Checkpoint] Không thể lưu checkpoint job ${checkpoint.jobId} sau 3 lần: ${(lastError as Error)?.message || lastError}`);
}

/**
 * Khởi tạo danh sách 6 tasks mặc định cho 1 store
 */
export function createDefaultTasksForStore(storeName: string): ReportTaskState[] {
  const configs: Array<{ type: ReportTaskType; days: number }> = [
    { type: "BULK_SP", days: 30 },
    { type: "BULK_SB", days: 30 },
    { type: "BULK_SP", days: 7 },
    { type: "BULK_SB", days: 7 },
    { type: "ST_SP", days: 30 },
    { type: "ST_SB", days: 30 },
  ];

  return configs.map((cfg) => ({
    id: `${storeName}_${cfg.type}_${cfg.days}D`,
    store: storeName,
    type: cfg.type,
    days: cfg.days,
    status: "NOT_STARTED",
    attempt: 0,
    amazonRequestId: null,
    reportName: null,
    localPath: null,
    sizeBytes: 0,
    sha256: null,
    r2Key: null,
    lastError: null,
    nextRetryAt: null,
  }));
}
