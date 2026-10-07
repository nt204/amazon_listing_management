import {
  findOutcomeBackfillCandidates,
  getActionMemoryReadinessReport,
  requeueActionOutcomesForBackfill,
} from "../lib/ppc/action-memory-readiness";
import { evaluatePendingActionOutcomes, seedPendingOutcomesFromActions } from "../lib/ppc/action-outcome-evaluator";
import { closeDatabaseConnection } from "../lib/db";

export interface ReadinessCliOptions {
  apply: boolean;
  storeId: string | null;
  limit: number;
}

export function parseReadinessCliOptions(args: string[]): ReadinessCliOptions {
  const apply = args.includes("--apply");
  const storeArg = args.find((arg) => arg.startsWith("--store-id="));
  const limitArg = args.find((arg) => arg.startsWith("--limit="));
  const parsedLimit = limitArg ? Number(limitArg.slice("--limit=".length)) : 100;
  if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
    throw new Error("--limit phải là số nguyên dương.");
  }
  const storeId = storeArg?.slice("--store-id=".length).trim() || null;
  if (storeId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storeId)) {
    throw new Error("--store-id phải là UUID hợp lệ.");
  }
  return {
    apply,
    storeId,
    limit: Math.min(2_000, Math.floor(parsedLimit)),
  };
}

function printReport(label: string, report: Awaited<ReturnType<typeof getActionMemoryReadinessReport>>) {
  process.stdout.write(`${label}\n${JSON.stringify(report, null, 2)}\n`);
}

export async function runActionMemoryReadiness(args: string[]) {
  const options = parseReadinessCliOptions(args);
  const before = await getActionMemoryReadinessReport(options.storeId);
  printReport("PPC_ACTION_MEMORY_READINESS_BEFORE", before);

  if (options.apply) {
    await seedPendingOutcomesFromActions({ limit: options.limit });
  }
  const actionIds = await findOutcomeBackfillCandidates({
    storeId: options.storeId,
    limit: options.limit,
  });

  process.stdout.write(`${JSON.stringify({
    mode: options.apply ? "APPLY" : "DRY_RUN",
    candidateActionCount: actionIds.length,
    candidateActionIdSample: actionIds.slice(0, 20),
  }, null, 2)}\n`);

  if (!options.apply || actionIds.length === 0) {
    process.stdout.write(options.apply
      ? "Không có action legacy cần backfill.\n"
      : "Dry-run hoàn tất. Dùng --apply để requeue và chấm lại riêng các outcome trên.\n");
    return;
  }

  const requeuedOutcomeCount = await requeueActionOutcomesForBackfill(actionIds);
  const evaluation = await evaluatePendingActionOutcomes({
    actionIds,
    autoSeed: false,
    limit: Math.max(options.limit * 4, requeuedOutcomeCount),
  });
  const after = await getActionMemoryReadinessReport(options.storeId);

  process.stdout.write(`${JSON.stringify({ requeuedOutcomeCount, evaluation }, null, 2)}\n`);
  printReport("PPC_ACTION_MEMORY_READINESS_AFTER", after);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runActionMemoryReadiness(process.argv.slice(2))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
      process.exitCode = 1;
    })
    .finally(() => closeDatabaseConnection());
}
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
