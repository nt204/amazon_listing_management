import { checkDatabaseHealth } from "@/lib/db";
import { getRuleRegistry } from "@/lib/rules";
import { checkDiskHealth } from "@/lib/system-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [, storage] = await Promise.all([
      checkDatabaseHealth(),
      checkDiskHealth(),
    ]);
    const status = storage.level === "healthy" ? "ready" : storage.level;
    return Response.json(
      {
        status,
        rules_version: getRuleRegistry().version,
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
