import { statfs } from "node:fs/promises";

export type DiskHealthLevel = "healthy" | "warning" | "critical";

export interface DiskHealth {
  level: DiskHealthLevel;
  usedPercent: number;
  usedBytes: number;
  freeBytes: number;
  totalBytes: number;
  warningPercent: number;
  criticalPercent: number;
}

function configuredPercent(name: string, fallback: number) {
  const parsed = Number(process.env[name] || fallback);
  return Number.isFinite(parsed)
    ? Math.min(99, Math.max(1, Math.round(parsed)))
    : fallback;
}

export function diskThresholds() {
  const warningPercent = configuredPercent("DISK_WARNING_PERCENT", 70);
  const configuredCritical = configuredPercent("DISK_CRITICAL_PERCENT", 80);
  return {
    warningPercent,
    criticalPercent: Math.min(
      99,
      Math.max(warningPercent + 1, configuredCritical),
    ),
  };
}

export function calculateDiskHealth(
  stats: { blocks: number; bavail: number; bsize: number },
  thresholds = diskThresholds(),
): DiskHealth {
  const totalBytes = stats.blocks * stats.bsize;
  const freeBytes = stats.bavail * stats.bsize;
  const usedBytes = totalBytes > freeBytes ? totalBytes - freeBytes : 0;
  const usedPercent =
    totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1_000) / 10 : 0;
  const level: DiskHealthLevel =
    usedPercent >= thresholds.criticalPercent
      ? "critical"
      : usedPercent >= thresholds.warningPercent
        ? "warning"
        : "healthy";

  return {
    level,
    usedPercent,
    usedBytes,
    freeBytes,
    totalBytes,
    warningPercent: thresholds.warningPercent,
    criticalPercent: thresholds.criticalPercent,
  };
}

export async function checkDiskHealth() {
  const path = process.env.DISK_MONITOR_PATH?.trim() || process.cwd();
  const stats = await statfs(path);
  return calculateDiskHealth(stats);
}
