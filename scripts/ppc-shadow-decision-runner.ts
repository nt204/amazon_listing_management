import { closeDatabaseConnection } from "../lib/db";
import { runShadowDecisions } from "../lib/ppc/shadow-decision-service";

const apply = process.argv.includes("--apply");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const storeArg = process.argv.find((arg) => arg.startsWith("--store-id="));
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : 100;
const storeId = storeArg?.slice("--store-id=".length).trim() || null;

runShadowDecisions({ apply, limit, storeId })
  .then((summary) => process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`))
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => closeDatabaseConnection());
