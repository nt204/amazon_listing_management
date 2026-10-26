import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";

import { cleanupOrphanedPpcBulkTempDirs } from "../lib/ppc/parser";

test("orphaned ppc-bulk temp cleanup keeps directories that may belong to a running parse", async () => {
  const fresh = mkdtempSync(`${tmpdir()}/ppc-bulk-`);
  const orphan = mkdtempSync(`${tmpdir()}/ppc-bulk-`);
  const unrelated = mkdtempSync(`${tmpdir()}/not-ppc-`);
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1_000);
  utimesSync(orphan, threeHoursAgo, threeHoursAgo);
  utimesSync(unrelated, threeHoursAgo, threeHoursAgo);
  try {
    const removed = await cleanupOrphanedPpcBulkTempDirs();
    assert.ok(removed >= 1);
    assert.equal(existsSync(orphan), false);
    assert.equal(existsSync(fresh), true);
    assert.equal(existsSync(unrelated), true);
  } finally {
    for (const dir of [fresh, orphan, unrelated]) rmSync(dir, { recursive: true, force: true });
  }
});
