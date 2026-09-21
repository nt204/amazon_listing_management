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

test("downloaded bulk files in ~/Downloads/Bulk file are unique, have distinct hashes, and correct sheets", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");
  const crypto = await import("node:crypto");
  const ExcelJS = await import("exceljs");

  const dir = path.join(os.homedir(), "Downloads", "Bulk file");
  if (!fs.existsSync(dir)) return;

  const targetFiles = [
    { name: "HSOSTORE_Bulk_SP_30Days_bulk-a1qiqhomjzfqb8-20260821-20260920-1789865514178.xlsx", expectedType: "SP" },
    { name: "HSOSTORE_Bulk_SB_30Days_bulk-a1qiqhomjzfqb8-20260821-20260920-1789865299580.xlsx", expectedType: "SB" },
    { name: "HSOSTORE_Bulk_SP_7Days_bulk-a1qiqhomjzfqb8-20260913-20260920-1789865588103.xlsx", expectedType: "SP" },
    { name: "HSOSTORE_Bulk_SB_7Days_bulk-a1qiqhomjzfqb8-20260913-20260920-1789865375618.xlsx", expectedType: "SB" },
  ];

  const hashes = new Set<string>();

  function findFile(base: string, targetName: string): string | null {
    if (!fs.existsSync(base)) return null;
    const direct = path.join(base, targetName);
    if (fs.existsSync(direct)) return direct;
    try {
      const entries = fs.readdirSync(base, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith(".")) {
          const sub = findFile(path.join(base, e.name), targetName);
          if (sub) return sub;
        }
      }
    } catch {}
    return null;
  }

  for (const item of targetFiles) {
    const fullPath = findFile(dir, item.name);
    if (!fullPath || !fs.existsSync(fullPath)) continue;

    // Hash must be unique
    const fileBytes = fs.readFileSync(fullPath);
    const hash = crypto.createHash("sha256").update(fileBytes).digest("hex");
    assert.ok(!hashes.has(hash), `Duplicate hash found for file: ${item.name}`);
    hashes.add(hash);

    // Verify sheet names
    const wb = new ExcelJS.default.stream.xlsx.WorkbookReader(fullPath, {});
    let foundExpectedSheet = false;
    for await (const worksheetReader of wb) {
      const sheetName = (((worksheetReader as any).name as string) || "").toLowerCase();
      if (item.expectedType === "SP" && (sheetName.includes("sponsored products") || sheetName.includes("sp campaigns"))) {
        foundExpectedSheet = true;
      }
      if (item.expectedType === "SB" && (sheetName.includes("sponsored brands") || sheetName.includes("sb campaigns") || sheetName.includes("hsa campaigns"))) {
        foundExpectedSheet = true;
      }
    }
    assert.ok(foundExpectedSheet, `File ${item.name} does not contain expected sheet for ${item.expectedType}`);
  }
});

