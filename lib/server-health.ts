import "server-only";

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";
import { getDatabaseClient } from "@/lib/db";
import { checkObjectStorageHealth } from "@/lib/object-storage";
import { getReadyRedisClient } from "@/lib/redis";
import { checkDiskHealth } from "@/lib/system-health";

const execFileAsync = promisify(execFile);

export type HealthLevel = "healthy" | "warning" | "critical";

export interface HealthMetric {
  level: HealthLevel;
  /** Phần trăm sử dụng (0–100+), null nếu không đo được. */
  percent: number | null;
  detail: string;
}

export interface HealthService {
  name: string;
  level: HealthLevel;
  detail: string;
}

export interface HealthProcess {
  name: string;
  online: boolean;
  restarts: number;
  memoryBytes: number;
}

export interface ServerHealthReport {
  checkedAt: string;
  level: HealthLevel;
  hostname: string;
  uptimeSeconds: number;
  disk: HealthMetric;
  memory: HealthMetric;
  cpu: HealthMetric;
  services: HealthService[];
  /** null khi máy không chạy pm2 (vd. local dev). */
  processes: HealthProcess[] | null;
}

const byPercent = (percent: number, warning: number, critical: number): HealthLevel =>
  percent >= critical ? "critical" : percent >= warning ? "warning" : "healthy";

const worst = (levels: HealthLevel[]): HealthLevel =>
  levels.includes("critical") ? "critical" : levels.includes("warning") ? "warning" : "healthy";

const round1 = (value: number) => Math.round(value * 10) / 10;

function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1_024 && unit < units.length - 1) {
    value /= 1_024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

async function readDisk(): Promise<HealthMetric> {
  try {
    const disk = await checkDiskHealth();
    return {
      level: disk.level,
      percent: disk.usedPercent,
      detail: `Còn trống ${formatBytes(disk.freeBytes)} / ${formatBytes(disk.totalBytes)}`,
    };
  } catch {
    return { level: "warning", percent: null, detail: "Không đọc được ổ đĩa" };
  }
}

/** MemAvailable (Linux) phản ánh đúng RAM còn dùng được; os.freemem() bỏ qua page cache. */
async function readMemory(): Promise<HealthMetric> {
  const total = os.totalmem();
  let available = os.freemem();
  try {
    const match = (await readFile("/proc/meminfo", "utf8")).match(/^MemAvailable:\s+(\d+)\s+kB/m);
    if (match) available = Number(match[1]) * 1_024;
  } catch {
    // Không có procfs (macOS): dùng os.freemem().
  }
  const percent = total > 0 ? round1(((total - available) / total) * 100) : 0;
  return {
    level: byPercent(percent, 85, 95),
    percent,
    detail: `Còn trống ${formatBytes(available)} / ${formatBytes(total)}`,
  };
}

function readCpu(): HealthMetric {
  const cores = os.cpus().length || 1;
  const load5 = os.loadavg()[1];
  const percent = round1((load5 / cores) * 100);
  return {
    level: byPercent(percent, 80, 100),
    percent,
    detail: `Tải trung bình 5 phút ${load5.toFixed(2)} · ${cores} nhân`,
  };
}

async function checkDatabase(): Promise<HealthService> {
  try {
    const sql = await getDatabaseClient();
    const started = performance.now();
    await sql`SELECT 1`;
    const latencyMs = Math.round(performance.now() - started);
    const [size] = await sql<{ bytes: string }[]>`SELECT pg_database_size(current_database())::text AS bytes`;
    return {
      name: "Database",
      level: latencyMs > 500 ? "warning" : "healthy",
      detail: `${formatBytes(Number(size?.bytes ?? 0))} · ${latencyMs} ms`,
    };
  } catch {
    return { name: "Database", level: "critical", detail: "Mất kết nối" };
  }
}

async function checkRedis(): Promise<HealthService> {
  try {
    const redis = await getReadyRedisClient();
    if (!redis) return { name: "Redis", level: "warning", detail: "Không sẵn sàng" };
    const started = performance.now();
    await redis.ping();
    return { name: "Redis", level: "healthy", detail: `${Math.round(performance.now() - started)} ms` };
  } catch {
    return { name: "Redis", level: "warning", detail: "Không sẵn sàng" };
  }
}

async function checkStorage(): Promise<HealthService> {
  try {
    const result = await checkObjectStorageHealth();
    return { name: "Lưu trữ ảnh", level: "healthy", detail: result.driver.toUpperCase() };
  } catch {
    return { name: "Lưu trữ ảnh", level: "critical", detail: "Lỗi kết nối" };
  }
}

async function listPm2Processes(): Promise<HealthProcess[] | null> {
  try {
    const { stdout } = await execFileAsync("pm2", ["jlist"], { timeout: 4_000, maxBuffer: 8 * 1_024 * 1_024 });
    const start = stdout.indexOf("[");
    if (start < 0) return null;
    const list = JSON.parse(stdout.slice(start)) as {
      name?: string;
      monit?: { memory?: number };
      pm2_env?: { status?: string; restart_time?: number };
    }[];
    return list.map((item) => ({
      name: item.name ?? "unknown",
      online: item.pm2_env?.status === "online",
      restarts: item.pm2_env?.restart_time ?? 0,
      memoryBytes: item.monit?.memory ?? 0,
    }));
  } catch {
    return null;
  }
}

export async function getServerHealthReport(): Promise<ServerHealthReport> {
  const [disk, memory, database, redis, storage, processes] = await Promise.all([
    readDisk(),
    readMemory(),
    checkDatabase(),
    checkRedis(),
    checkStorage(),
    listPm2Processes(),
  ]);
  const cpu = readCpu();
  const services = [database, redis, storage];
  return {
    checkedAt: new Date().toISOString(),
    level: worst([
      disk.level,
      memory.level,
      cpu.level,
      ...services.map((service) => service.level),
      processes?.some((item) => !item.online) ? "critical" : "healthy",
    ]),
    hostname: os.hostname(),
    uptimeSeconds: Math.round(os.uptime()),
    disk,
    memory,
    cpu,
    services,
    processes,
  };
}
