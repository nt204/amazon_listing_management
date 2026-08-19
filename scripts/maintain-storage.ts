import {
  closeDatabaseConnection,
  pruneExpiredTrelloImageDerivatives,
  vacuumImageStorageTables,
} from "../lib/db";
import { checkDiskHealth } from "../lib/system-health";

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

async function main() {
  let deletedPreviews = 0;
  while (true) {
    const deleted = await pruneExpiredTrelloImageDerivatives({
      batchSize: 5_000,
    });
    deletedPreviews += deleted;
    if (deleted < 5_000) break;
  }

  await vacuumImageStorageTables();
  const disk = await checkDiskHealth();
  process.stdout.write(
    [
      `Storage maintenance complete: deleted ${deletedPreviews} expired Trello preview row(s).`,
      `Disk usage: ${disk.usedPercent.toFixed(1)}% (${formatBytes(disk.freeBytes)} free of ${formatBytes(disk.totalBytes)}).`,
      `Status: ${disk.level}; thresholds: warning ${disk.warningPercent}%, critical ${disk.criticalPercent}%.`,
    ].join("\n") + "\n",
  );

  if (disk.level === "critical") process.exitCode = 2;
  else if (disk.level === "warning") process.exitCode = 1;
}

main()
  .catch((error) => {
    process.stderr.write(
      `Storage maintenance failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 2;
  })
  .finally(async () => {
    await closeDatabaseConnection().catch(() => undefined);
  });
