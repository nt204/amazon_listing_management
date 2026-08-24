import { checkDatabaseHealth } from "@/lib/db";
import { getRuleRegistry } from "@/lib/rules";
import { checkDiskHealth } from "@/lib/system-health";
import { getReadyRedisClient } from "@/lib/redis";
import { getMockupQueueMetrics } from "@/lib/mockup-jobs";
import { checkObjectStorageHealth } from "@/lib/object-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [, disk, objectStorage, redis, mockupQueue] = await Promise.all([
      checkDatabaseHealth(),
      checkDiskHealth(),
      checkObjectStorageHealth(),
      getReadyRedisClient(),
      getMockupQueueMetrics(),
    ]);
    const redisReady = Boolean(redis);
    const status =
      disk.level === "critical"
        ? "critical"
        : disk.level === "warning" || !redisReady
          ? "warning"
          : "ready";
    return Response.json(
      {
        status,
        rules_version: getRuleRegistry().version,
        redis: redisReady ? "ready" : "unavailable",
        object_storage: objectStorage,
        mockup_queue: mockupQueue,
        storage: {
          level: disk.level,
          used_percent: disk.usedPercent,
          used_bytes: disk.usedBytes,
          free_bytes: disk.freeBytes,
          total_bytes: disk.totalBytes,
          warning_percent: disk.warningPercent,
          critical_percent: disk.criticalPercent,
        },
      },
      {
        status: disk.level === "critical" ? 503 : 200,
        headers: {
          "Cache-Control": "no-store",
          ...(disk.level === "healthy"
            ? {}
            : { "X-Storage-Warning": disk.level }),
        },
      },
    );
  } catch {
    return Response.json(
      { status: "unavailable" },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
