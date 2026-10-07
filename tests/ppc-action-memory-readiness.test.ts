import assert from "node:assert/strict";
import test from "node:test";

import { parseReadinessCliOptions } from "../scripts/ppc-action-memory-readiness";

test("readiness CLI is read-only by default", () => {
  assert.deepEqual(parseReadinessCliOptions([]), {
    apply: false,
    storeId: null,
    limit: 100,
  });
});

test("readiness CLI requires an explicit apply flag", () => {
  assert.deepEqual(parseReadinessCliOptions([
    "--apply",
    "--store-id=00000000-0000-0000-0000-000000000001",
    "--limit=25",
  ]), {
    apply: true,
    storeId: "00000000-0000-0000-0000-000000000001",
    limit: 25,
  });
});

test("readiness CLI rejects an invalid limit", () => {
  assert.throws(() => parseReadinessCliOptions(["--limit=0"]), /số nguyên dương/);
});
