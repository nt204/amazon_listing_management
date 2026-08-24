import { readObjectStorageConfig } from "../lib/object-storage-core";
import {
  checkObjectStorageHealth,
  runObjectStorageProbe,
} from "../lib/object-storage";

async function main() {
  const config = readObjectStorageConfig();
  if (config.driver !== "r2") {
    throw new Error(
      "OBJECT_STORAGE_DRIVER is currently 'database'. Configure the R2 variables and set it to 'r2' before running this check.",
    );
  }

  const health = await checkObjectStorageHealth();
  process.stdout.write(
    `R2 credentials accepted: bucket=${health.driver === "r2" ? health.bucket : "n/a"}, prefix=${
      health.driver === "r2" ? health.prefix : "n/a"
    }\n`,
  );
  const probe = await runObjectStorageProbe();
  process.stdout.write(
    `R2 read/write/delete probe passed: ${probe.bytes} bytes, sha256=${probe.sha256}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `Object storage check failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});

