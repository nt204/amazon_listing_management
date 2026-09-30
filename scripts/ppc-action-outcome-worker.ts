import { evaluatePendingActionOutcomes } from "../lib/ppc/action-outcome-evaluator";
import { getDatabaseClient } from "../lib/db";

const watchMode = process.argv.includes("--watch");
const defaultIntervalMs = 6 * 60 * 60 * 1_000;
const configuredIntervalMs = Number(process.env.PPC_OUTCOME_INTERVAL_MS || defaultIntervalMs);
const intervalMs = Number.isFinite(configuredIntervalMs) && configuredIntervalMs >= 60_000
  ? configuredIntervalMs
  : defaultIntervalMs;
let stopping = false;

function stop() {
  stopping = true;
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

async function waitForNextRun(milliseconds: number) {
  const step = 1_000;
  let remaining = milliseconds;
  while (!stopping && remaining > 0) {
    const wait = Math.min(step, remaining);
    await new Promise((resolve) => setTimeout(resolve, wait));
    remaining -= wait;
  }
}

async function main() {
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const parsedLimit = limitArg ? Number(limitArg.slice("--limit=".length)) : 500;
  const limit = Number.isFinite(parsedLimit) ? parsedLimit : 500;

  do {
    const startedAt = new Date().toISOString();
    try {
      const summary = await evaluatePendingActionOutcomes({ limit });
      process.stdout.write(`${JSON.stringify({ startedAt, ...summary })}\n`);
    } catch (error) {
      process.stderr.write(
        `[PPC outcome worker] ${error instanceof Error ? error.stack || error.message : String(error)}\n`,
      );
      if (!watchMode) throw error;
    }

    if (!watchMode || stopping) break;
    await waitForNextRun(intervalMs);
  } while (!stopping);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
}).finally(async () => {
  const sql = await getDatabaseClient().catch(() => null);
  if (sql) await sql.end();
});
