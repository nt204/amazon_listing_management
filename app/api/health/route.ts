import { checkDatabaseHealth } from "@/lib/db";
import { getRuleRegistry } from "@/lib/rules";
import { checkDiskHealth } from "@/lib/system-health";
import { getReadyRedisClient } from "@/lib/redis";
import { getMockupQueueMetrics } from "@/lib/mockup-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [, storage, redis, mockupQueue] = await Promise.all([
      checkDatabaseHealth(),
      checkDiskHealth(),
      getReadyRedisClient(),
      getMockupQueueMetrics(),
    ]);
    const redisReady = Boolean(redis);
    const status =
      storage.level === "critical"
        ? "critical"
        : storage.level === "warning" || !redisReady
          ? "warning"
          : "ready";
    return Response.json(
      {
        status,
        rules_version: getRuleRegistry().version,
        redis: redisReady ? "ready" : "unavailable",
        mockup_queue: mockupQueue,
        storage: {
          level: storage.level,
          used_percent: storage.usedPercent,
          used_bytes: storage.usedBytes,
          free_bytes: storage.freeBytes,
          total_bytes: storage.totalBytes,
          warning_percent: storage.warningPercent,
          critical_percent: storage.criticalPercent,
        },
      },
      {
        status: storage.level === "critical" ? 503 : 200,
        headers: {
          "Cache-Control": "no-store",
          ...(storage.level === "healthy"
            ? {}
            : { "X-Storage-Warning": storage.level }),
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
