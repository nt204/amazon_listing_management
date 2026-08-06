import { checkDatabaseHealth } from "@/lib/db";
import { getRuleRegistry } from "@/lib/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await checkDatabaseHealth();
    return Response.json({
      status: "ready",
      rules_version: getRuleRegistry().version,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ status: "unavailable" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
