import { closeDatabaseConnection } from "../lib/db";
import { runAiReviewerShadowDecisions } from "../lib/ppc/ai-reviewer-service";

const apply = process.argv.includes("--apply");
const skipLlmIfNoEvidence = process.argv.includes("--skip-llm-if-no-evidence");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const storeArg = process.argv.find((arg) => arg.startsWith("--store-id="));
const modelArg = process.argv.find((arg) => arg.startsWith("--model="));

const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : 3;
const storeId = storeArg?.slice("--store-id=".length).trim() || null;
const model = modelArg?.slice("--model=".length).trim() || undefined;

runAiReviewerShadowDecisions({
  apply,
  limit,
  storeId,
  model,
  skipLlmIfNoEvidence,
})
  .then((summary) => process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`))
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => closeDatabaseConnection());
