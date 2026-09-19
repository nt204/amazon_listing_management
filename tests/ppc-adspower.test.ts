import test from "node:test";
import assert from "node:assert/strict";
import { getAdsPowerLocalApiUrl, startAdsPowerProfile, stopAdsPowerProfile } from "../lib/ppc/adspower-service";

test("getAdsPowerLocalApiUrl returns string URL with valid format", () => {
  const url = getAdsPowerLocalApiUrl();
  assert.ok(typeof url === "string");
  assert.ok(url.startsWith("http://") || url.startsWith("https://"));
  assert.ok(!url.endsWith("/"));
});

test("startAdsPowerProfile returns null safely when AdsPower is not running and profile is not found", async () => {
  // Test with non-existent profile and custom unreachable API URL
  const originalApiUrl = process.env.ADSPOWER_API_URL;
  try {
    process.env.ADSPOWER_API_URL = "http://127.0.0.1:59999"; // non-existent port
    const port = await startAdsPowerProfile({
      storeName: "NON_EXISTENT_STORE_XYZ",
    });
    assert.equal(port, null);
  } finally {
    if (originalApiUrl) {
      process.env.ADSPOWER_API_URL = originalApiUrl;
    } else {
      delete process.env.ADSPOWER_API_URL;
    }
  }
});

test("stopAdsPowerProfile does not crash when stopping non-running profile", async () => {
  const originalApiUrl = process.env.ADSPOWER_API_URL;
  try {
    process.env.ADSPOWER_API_URL = "http://127.0.0.1:59999";
    await assert.doesNotReject(async () => {
      await stopAdsPowerProfile("fake_profile_id");
    });
  } finally {
    if (originalApiUrl) {
      process.env.ADSPOWER_API_URL = originalApiUrl;
    } else {
      delete process.env.ADSPOWER_API_URL;
    }
  }
});

test("standardized names for all 6 PPC files are correctly parsed by reportAdType and inferPpcReportCoverage", async () => {
  const { reportAdType } = await import("../lib/ppc/service");
  const { inferPpcReportCoverage } = await import("../lib/ppc/parser");

  const files = [
    { name: "HSOSTORE_Bulk_SP_30Days_20260918_bulk-123.xlsx", expectedType: "SP", expectedDays: 30 },
    { name: "HSOSTORE_Bulk_SB_30Days_20260918_bulk-456.xlsx", expectedType: "SB", expectedDays: 30 },
    { name: "HSOSTORE_Bulk_SP_7Days_20260918_bulk-789.xlsx", expectedType: "SP", expectedDays: 7 },
    { name: "HSOSTORE_Bulk_SB_7Days_20260918_bulk-012.xlsx", expectedType: "SB", expectedDays: 7 },
    { name: "HSOSTORE_Search_Term_SP_30Days_20260918_st-sp.xlsx", expectedType: "SP", expectedDays: 30 },
    { name: "HSOSTORE_Search_Term_SB_30Days_20260918_st-sb.xlsx", expectedType: "SB", expectedDays: 30 },
  ];

  for (const f of files) {
    const detectedType = reportAdType(f.name);
    assert.equal(detectedType, f.expectedType, `Expected ${f.expectedType} for ${f.name}`);
    const coverage = inferPpcReportCoverage(f.name);
    const start = new Date(coverage.reportStartDate);
    const end = new Date(coverage.reportEndDate);
    const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    assert.equal(diffDays, f.expectedDays, `Expected ${f.expectedDays} days for ${f.name}`);
  }
});
