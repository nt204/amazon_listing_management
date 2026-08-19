import test from "node:test";
import assert from "node:assert/strict";
import { calculateDiskHealth } from "../lib/system-health";

const thresholds = { warningPercent: 70, criticalPercent: 80 };

test("disk health reports healthy, warning, and critical thresholds", () => {
  assert.equal(
    calculateDiskHealth(
      { blocks: 100, bavail: 31, bsize: 1_024 },
      thresholds,
    ).level,
    "healthy",
  );
  assert.equal(
    calculateDiskHealth(
      { blocks: 100, bavail: 30, bsize: 1_024 },
      thresholds,
    ).level,
    "warning",
  );
  assert.equal(
    calculateDiskHealth(
      { blocks: 100, bavail: 20, bsize: 1_024 },
      thresholds,
    ).level,
    "critical",
  );
});

test("disk health returns byte totals suitable for monitoring", () => {
  const result = calculateDiskHealth(
    { blocks: 100, bavail: 25, bsize: 1_024 },
    thresholds,
  );

  assert.equal(result.usedPercent, 75);
  assert.equal(result.totalBytes, 102_400);
  assert.equal(result.usedBytes, 76_800);
  assert.equal(result.freeBytes, 25_600);
  assert.equal(result.level, "warning");
});
