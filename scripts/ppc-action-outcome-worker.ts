import { evaluatePendingActionOutcomes } from "../lib/ppc/action-outcome-evaluator";
import { getDatabaseClient } from "../lib/db";

async function main() {
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const parsedLimit = limitArg ? Number(limitArg.slice("--limit=".length)) : 500;
  const summary = await evaluatePendingActionOutcomes({
    limit: Number.isFinite(parsedLimit) ? parsedLimit : 500,
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
}).finally(async () => {
  const sql = await getDatabaseClient().catch(() => null);
  if (sql) await sql.end();
});
