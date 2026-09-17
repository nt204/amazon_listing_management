import "server-only";

import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import type { DataScope } from "@/lib/db";
import {
  adTypeBreakdownFromFacts,
  adGroupPerformanceFromFacts,
  calculatePerformanceSummary,
  calculatePpcDailyTrends,
  calculateSearchTermFallbackSummary,
  calculatePpcSearchTermSummary,
  campaignPerformanceFromFacts,
  generatePpcAlerts,
  generatePpcRecommendations,
  generateTargetBidRecommendations,
  groupPpcByKeywordMatchType,
  groupPpcByMatchType,
  groupPpcByTargetType,
  performanceDataHealth,
  skuPerformanceFromFacts,
  targetPerformanceFromFacts,
} from "./analytics";
import { generateMockSearchTerms, MOCK_STORES } from "./mock-data-generator";
import {
  inferPpcReportCoverage,
  parseBulkWorkbook,
  parseLargeBulkWorkbook,
  streamLargeBulkWorkbookFile,
  parseSearchTermCsv,
  parseSearchTermWorkbook,
} from "./parser";
import {
  listPpcPerformance,
  listPpcSearchTerms,
  listPpcStores,
  listPpcSyncLogs,
  recordPpcSyncLog,
  replacePpcDataWithMock,
  upsertPpcSearchTerms,
  upsertPpcPerformance,
} from "./repository";
import {
  evaluateOrnamentTargetBid,
  isGlassOrnamentTarget,
} from "./rules-ornament";
import type {
  PpcAdType,
  PpcAlert,
  PpcPerformanceGrain,
  PpcPerformanceRow,
  PpcRecommendation,
  PpcSearchTermRow,
} from "./types";

const MAX_R2_FILE_BYTES = 150_000_000;
const DEFAULT_TARGET_ACOS = 30;

export class PpcInputError extends Error { }

function cleanStoreName(value: string): string {
  const name = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!name) throw new PpcInputError("Tên store không được để trống.");
  if (name.length > 80) throw new PpcInputError("Tên store không được vượt quá 80 ký tự.");
  return name;
}

export function canonicalStoreName(value?: string | null): string {
  if (!value) return "HSOSTORE";
  const cleaned = cleanStoreName(value);
  const lower = cleaned.toLowerCase();
  if (
    lower === "warmstorey" ||
    lower === "dev03_warmstorey" ||
    lower === "hsostore" ||
    (lower.includes("warmstorey") && lower.includes("hsostore"))
  ) {
    return "HSOSTORE";
  }
  return cleaned;
}

function resolveStoreName(objectKey: string, knownStoreNames: string[]): string | null {
  const segments = objectKey.split("/").map((segment) => decodeURIComponent(segment).trim());
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  const known = knownStoreNames.find((name) =>
    lowerSegments.some((segment) => segment === name.toLowerCase()) ||
    objectKey.toLowerCase().includes(name.toLowerCase()),
  );
  if (known) return known;

  const areaIndex = lowerSegments.findIndex((segment) => segment === "input" || segment === "output");
  if (areaIndex >= 0) {
    const afterArea = segments.slice(areaIndex + 1);
    const candidate = /^\d{8}$/.test(afterArea[0] || "") ? afterArea[1] : afterArea[0];
    if (candidate && !/\.(xlsx|csv)$/i.test(candidate)) {
      return cleanStoreName(candidate);
    }
  }
  return null;
}

function r2Version(input: { ETag?: string; Size?: number; LastModified?: Date }): string {
  return [input.ETag || "", input.Size || 0, input.LastModified?.toISOString() || ""].join(":");
}

export function reportAdType(reference: string): PpcAdType {
  if (/(?:^|[\s_\-/])SP(?:[\s_\-.]|$)/i.test(reference) || /sponsored products/i.test(reference)) return "SP";
  if (/(?:^|[\s_\-/])SB(?:[\s_\-.]|$)/i.test(reference) || /sponsored brands/i.test(reference)) return "SB";
  if (/(?:^|[\s_\-/])SD(?:[\s_\-.]|$)/i.test(reference) || /sponsored display/i.test(reference)) return "SD";
  return "UNKNOWN";
}

export async function parseBulkFile(
  buffer: Buffer,
  storeName: string,
  reference: string,
  coverageOptions: { days?: number; endDate?: string } = {},
) {
  const options = {
    ...inferPpcReportCoverage(reference, coverageOptions),
    adType: reportAdType(reference),
  };
  try {
    return await parseLargeBulkWorkbook(buffer, storeName, options);
  } catch (error) {
    console.warn("[Bulk Parser] Streaming parser error, falling back to ExcelJS:", error);
    return parseBulkWorkbook(buffer, storeName, options);
  }
}

export async function getPpcAnalyticsData(
  scope: DataScope,
  filters: { storeName?: string; sku?: string; days?: number } = {},
  options: { grains?: PpcPerformanceGrain[] } = {},
) {
  const storeName = filters.storeName && filters.storeName !== "ALL"
    ? canonicalStoreName(filters.storeName)
    : "ALL";
  const sku = filters.sku || "ALL";
  const days = filters.days || 30;
  const requestedGrains = new Set<PpcPerformanceGrain>(options.grains ?? [
    "CAMPAIGN",
    "AD_GROUP",
    "TARGET",
    "PRODUCT",
    "PLACEMENT",
  ]);
  const performanceQuery = (grain: PpcPerformanceGrain, limit: number) => requestedGrains.has(grain)
    ? listPpcPerformance(scope, { storeName, sku, days }, { grain, limit })
    : Promise.resolve([] as PpcPerformanceRow[]);
  const [stores, storeRows, campaignRowsRaw, adGroupRows, targetRowsRaw, productRows, placementRows, syncLogs] = await Promise.all([
    listPpcStores(scope),
    listPpcSearchTerms(scope, { storeName, sku, days }),
    performanceQuery("CAMPAIGN", 15_000),
    performanceQuery("AD_GROUP", 10_000),
    performanceQuery("TARGET", 25_000),
    performanceQuery("PRODUCT", 10_000),
    performanceQuery("PLACEMENT", 5_000),
    listPpcSyncLogs(scope),
  ]);
  const performanceRows = [
    ...campaignRowsRaw,
    ...adGroupRows,
    ...targetRowsRaw,
    ...productRows,
    ...placementRows,
  ];

  const rows = storeRows;

  const currentStore = stores.find((store) => store.name.toLowerCase() === storeName.toLowerCase());
  const targetAcos = currentStore?.targetAcos ?? DEFAULT_TARGET_ACOS;
  const alerts: PpcAlert[] = generatePpcAlerts(rows, targetAcos);
  const normalizedTarget = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  const targetState = performanceRows.filter((row) => row.grain === "TARGET");
  const targetKey = (adType: PpcAdType | undefined, value: string) => `${adType || "UNKNOWN"}\u0000${normalizedTarget(value)}`;
  const existingTargets = new Set(targetState.filter((row) => !row.isNegative).map((row) => targetKey(row.adType, row.targetExpression)));
  const existingNegatives = new Set(targetState.filter((row) => row.isNegative).map((row) => targetKey(row.adType, row.targetExpression)));
  const queryRecommendations = generatePpcRecommendations(rows, targetAcos).filter((recommendation) => {
    if (!recommendation.adType || recommendation.adType === "UNKNOWN") return false;
    const hasActiveDestination = targetState.some((target) =>
      target.adType === recommendation.adType &&
      (!recommendation.campaignId || target.campaignId === recommendation.campaignId) &&
      (!recommendation.adGroupId || target.adGroupId === recommendation.adGroupId) &&
      !/paused|archived/i.test(target.state || target.campaignState || target.adGroupState),
    );
    if (!hasActiveDestination) return false;
    const key = targetKey(recommendation.adType, recommendation.keyword);
    if (recommendation.recType === "HARVEST_KEYWORD") return !existingTargets.has(key);
    if (recommendation.recType === "NEGATIVE_KEYWORD") return !existingNegatives.has(key);
    return true;
  });
  const ornamentRows: PpcPerformanceRow[] = [];
  const standardRows: PpcPerformanceRow[] = [];
  for (const row of performanceRows) {
    if (row.grain === "TARGET") {
      if (isGlassOrnamentTarget(row)) {
        ornamentRows.push(row);
      } else {
        standardRows.push(row);
      }
    }
  }

  const ornamentRecs: PpcRecommendation[] = [];
  for (const row of ornamentRows) {
    const rec = evaluateOrnamentTargetBid(row);
    if (rec) ornamentRecs.push(rec);
  }

  const standardRecs = generateTargetBidRecommendations(standardRows, targetAcos);

  const recommendations: PpcRecommendation[] = [
    ...ornamentRecs,
    ...standardRecs,
    ...queryRecommendations,
  ];
  const searchTermSummary = calculatePpcSearchTermSummary(rows);
  const campaignRows = performanceRows.filter((row) => row.grain === "CAMPAIGN");
  const summary = campaignRows.length > 0
    ? calculatePerformanceSummary(campaignRows, {
        alerts: alerts.length,
        recommendations: recommendations.length,
        wastedSpend: searchTermSummary.wastedSpend,
      })
    : calculateSearchTermFallbackSummary(rows, {
        alerts: alerts.length,
        recommendations: recommendations.length,
        wastedSpend: searchTermSummary.wastedSpend,
      });
  const allSkuPerformance = skuPerformanceFromFacts(performanceRows, targetAcos);
  const skuPerformance = sku === "ALL"
    ? allSkuPerformance
    : allSkuPerformance.filter((row) => row.sku.toLowerCase() === sku.toLowerCase());
  const campaignPerformance = campaignPerformanceFromFacts(performanceRows, targetAcos);
  const adGroups = adGroupPerformanceFromFacts(performanceRows);
  const targets = targetPerformanceFromFacts(performanceRows).slice(0, 20000);
  const targetRows = performanceRows.filter((row) => row.grain === "TARGET" && !row.isNegative);
  const matchTypeBreakdown = targetRows.length ? groupPpcByMatchType(targetRows) : [];
  const targetTypeBreakdown = targetRows.length ? groupPpcByTargetType(targetRows) : [];
  const keywordMatchTypeBreakdown = targetRows.length ? groupPpcByKeywordMatchType(targetRows) : [];
  const adTypeBreakdown = adTypeBreakdownFromFacts(performanceRows);
  const dataHealth = performanceDataHealth(performanceRows, rows);
  const availableSkus = Array.from(new Set(performanceRows.map((row) => row.sku).filter(Boolean))).sort();
  const dailyTrends = calculatePpcDailyTrends(rows);
  const bulkSample = performanceRows.find((r) => r.reportStartDate && r.reportEndDate);
  let dateRangeStart: string;
  let dateRangeEnd: string;
  if (bulkSample && bulkSample.reportStartDate && bulkSample.reportEndDate) {
    dateRangeStart = bulkSample.reportStartDate;
    dateRangeEnd = bulkSample.reportEndDate;
  } else {
    let maxDate: string | null = null;
    if (dailyTrends.length > 0) {
      maxDate = dailyTrends[dailyTrends.length - 1].date;
    } else {
      for (const r of performanceRows) {
        const d = r.reportEndDate || r.snapshotDate;
        if (d && (!maxDate || d > maxDate)) maxDate = d;
      }
      for (const r of rows) {
        const d = r.reportEndDate || r.reportDate;
        if (d && (!maxDate || d > maxDate)) maxDate = d;
      }
    }
    dateRangeEnd = maxDate || new Date().toISOString().slice(0, 10);
    const startObj = new Date(dateRangeEnd);
    startObj.setDate(startObj.getDate() - (days - 1));
    dateRangeStart = startObj.toISOString().slice(0, 10);
  }

  return {
    stores,
    summary,
    skuPerformance,
    campaignPerformance,
    adGroups,
    targets,
    adTypeBreakdown,
    dataHealth,
    searchTermSummary,
    targetTypeBreakdown,
    keywordMatchTypeBreakdown,
    matchTypeBreakdown,
    dailyTrends,
    alerts,
    recommendations,
    searchTerms: rows,
    availableSkus,
    days,
    targetAcos,
    dateRangeStart,
    dateRangeEnd,
    lastSyncedAt: syncLogs[0]?.time ?? null,
    syncLogs,
  };
}

export async function ingestPpcExcelFile(
  scope: DataScope,
  fileBuffer: Buffer,
  fileName: string,
  storeName: string,
  coverageOptions: { days?: number; endDate?: string } = {},
) {
  const normalizedStore = canonicalStoreName(storeName);
  const adType = reportAdType(fileName);
  const isCsv = fileName.toLowerCase().endsWith(".csv");
  const prefersBulk = /bulk|campaign/i.test(fileName);
  const prefersSearchTerm = /search|term|str/i.test(fileName);

  try {
    // 1. If CSV or filename clearly indicates search term, try Search Term first
    if (isCsv || prefersSearchTerm) {
      try {
        const parsedRows = isCsv
          ? parseSearchTermCsv(fileBuffer, normalizedStore, adType)
          : await parseSearchTermWorkbook(fileBuffer, normalizedStore, adType);
        if (parsedRows.length) {
          const effectiveStore = parsedRows[0]?.storeName || normalizedStore;
          const saved = await upsertPpcSearchTerms(scope, effectiveStore, parsedRows, { replaceExisting: true });
          await recordPpcSyncLog(scope, {
            source: "MANUAL_UPLOAD",
            fileName,
            status: "SUCCESS",
            count: saved.inserted + saved.updated,
            message: `Search Term ${adType}: ${saved.inserted} dòng mới, ${saved.updated} dòng cập nhật, ${saved.deduplicated} dòng trùng.`,
          });
          return { reportType: "SEARCH_TERM", totalParsed: parsedRows.length, newInserted: saved.inserted, updated: saved.updated, deduplicated: saved.deduplicated, fileName, storeName: effectiveStore };
        }
      } catch (err) {
        if (isCsv) throw err;
      }
    }

    // 2. Try Bulk
    if (!isCsv) {
      try {
        const rows = await parseBulkFile(fileBuffer, normalizedStore, fileName, coverageOptions);
        if (rows.length) {
          const saved = await upsertPpcPerformance(scope, normalizedStore, rows, { replaceExisting: true });
          await recordPpcSyncLog(scope, {
            source: "MANUAL_UPLOAD",
            fileName,
            status: "SUCCESS",
            count: saved.inserted + saved.updated,
            message: `Bulk ${adType}: ${saved.inserted} dòng mới, ${saved.updated} dòng cập nhật, ${saved.deduplicated} dòng trùng.`,
          });
          return { reportType: "BULK", totalParsed: rows.length, newInserted: saved.inserted, updated: saved.updated, deduplicated: saved.deduplicated, fileName, storeName: normalizedStore };
        }
      } catch (err) {
        if (prefersBulk) throw err;
      }
    }

    // 3. Fallback to Search Term for .xlsx if not already tried
    if (!isCsv && !prefersSearchTerm) {
      const parsedRows = await parseSearchTermWorkbook(fileBuffer, normalizedStore, adType);
      if (parsedRows.length) {
        const effectiveStore = parsedRows[0]?.storeName || normalizedStore;
        const saved = await upsertPpcSearchTerms(scope, effectiveStore, parsedRows, { replaceExisting: true });
        await recordPpcSyncLog(scope, {
          source: "MANUAL_UPLOAD",
          fileName,
          status: "SUCCESS",
          count: saved.inserted + saved.updated,
          message: `Search Term ${adType}: ${saved.inserted} dòng mới, ${saved.updated} dòng cập nhật, ${saved.deduplicated} dòng trùng.`,
        });
        return { reportType: "SEARCH_TERM", totalParsed: parsedRows.length, newInserted: saved.inserted, updated: saved.updated, deduplicated: saved.deduplicated, fileName, storeName: effectiveStore };
      }
    }

    throw new PpcInputError("File không chứa dữ liệu hợp lệ của Bulk Operations hoặc Search Term Report.");
  } catch (error) {
    console.error("[PPC Ingest Error]", error);
    if (error instanceof PpcInputError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new PpcInputError(`Lỗi xử lý file PPC: ${detail}`);
  }
}

export async function ingestPpcFilePath(
  scope: DataScope,
  filePath: string,
  fileName: string,
  storeName: string,
  coverageOptions: { days?: number; endDate?: string } = {},
) {
  if (!fileName.toLowerCase().endsWith(".xlsx") || /search|term|str/i.test(fileName)) {
    const { readFile } = await import("node:fs/promises");
    return ingestPpcExcelFile(scope, await readFile(filePath), fileName, storeName, coverageOptions);
  }

  const normalizedStore = canonicalStoreName(storeName);
  const options = {
    ...inferPpcReportCoverage(fileName, coverageOptions),
    adType: reportAdType(fileName),
  };
  try {
    let firstBatch = true;
    let inserted = 0;
    let updated = 0;
    let deduplicated = 0;
    const totalParsed = await streamLargeBulkWorkbookFile(
      filePath,
      normalizedStore,
      options,
      async (rows) => {
        const saved = await upsertPpcPerformance(scope, normalizedStore, rows, {
          replaceExisting: firstBatch,
        });
        firstBatch = false;
        inserted += saved.inserted;
        updated += saved.updated;
        deduplicated += saved.deduplicated;
      },
    );
    if (!totalParsed) throw new PpcInputError("File không chứa dữ liệu Bulk Operations hợp lệ.");
    await recordPpcSyncLog(scope, {
      source: "MANUAL_UPLOAD",
      fileName,
      status: "SUCCESS",
      count: inserted + updated,
      message: `Bulk ${options.adType}: ${inserted} dòng mới, ${updated} dòng cập nhật, ${deduplicated} dòng trùng.`,
    });
    return {
      reportType: "BULK",
      totalParsed,
      newInserted: inserted,
      updated,
      deduplicated,
      fileName,
      storeName: normalizedStore,
    };
  } catch (error) {
    if (error instanceof PpcInputError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new PpcInputError(`Lỗi xử lý file PPC: ${detail}`);
  }
}

export async function resetPpcToMockData(scope: DataScope) {
  const rows = generateMockSearchTerms();
  await replacePpcDataWithMock(scope, MOCK_STORES, rows);
  await recordPpcSyncLog(scope, {
    source: "MOCK_DATA",
    status: "SUCCESS",
    count: rows.length,
    message: "Dữ liệu mẫu được nạp lại theo yêu cầu quản trị.",
  });
}

export async function syncPpcReportsFromR2(scope: DataScope) {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME || "amazon-listing-production";
  const prefix = `${(process.env.PPC_R2_PREFIX || "ppc-reports").replace(/^\/+|\/+$/g, "")}/`;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("Chưa cấu hình đầy đủ thông tin Cloudflare R2.");
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  const objects: Array<{ Key?: string; ETag?: string; Size?: number; LastModified?: Date }> = [];
  let continuationToken: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: 1_000,
    }));
    objects.push(...(page.Contents || []));
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  const reportFiles = objects.filter((object) => /\.(xlsx|csv)$/i.test(object.Key || ""));
  const recognizedFiles = reportFiles.filter((object) => {
    const key = object.Key || "";
    return /search[\s_-]*term/i.test(key) || /(?:^|\/|[\s_-])bulk/i.test(key);
  });
  const searchTermFiles = recognizedFiles.filter((object) => /search[\s_-]*term/i.test(object.Key || ""));
  const bulkFiles = recognizedFiles.filter((object) => /(?:^|\/|[\s_-])bulk/i.test(object.Key || "") && !/search[\s_-]*term/i.test(object.Key || ""));
  const ignored = reportFiles.length - recognizedFiles.length;
  const knownStores = (await listPpcStores(scope)).map((store) => store.name);
  const grouped = new Map<string, typeof recognizedFiles>();
  for (const object of recognizedFiles) {
    const key = object.Key || "";
    const storeName = resolveStoreName(key, knownStores);
    if (!storeName) continue;
    const existing = grouped.get(storeName) || [];
    existing.push(object);
    grouped.set(storeName, existing);
  }

  let totalParsed = 0;
  let totalNew = 0;
  let totalUpdated = 0;
  let filesProcessed = 0;
  const failures: Array<{ fileName: string; error: string }> = [];

  for (const [storeName, storeFiles] of grouped.entries()) {
    const latestBatch = storeFiles.reduce((latest, object) => {
      const dates = (object.Key || "").split("/").filter((part) => /^\d{8}$/.test(part));
      const batch = dates.at(-1) || "00000000";
      return batch > latest ? batch : latest;
    }, "00000000");
    let candidates = storeFiles.filter((object) => (object.Key || "").split("/").includes(latestBatch));
    const inputCandidates = candidates.filter((object) => (object.Key || "").toLowerCase().includes("/input/"));
    if (inputCandidates.length) candidates = inputCandidates;

    const selectedFiles = candidates;
    const parsedSearchTerms: Array<{ object: (typeof selectedFiles)[number]; rows: PpcSearchTermRow[] }> = [];
    const parsedPerformance: Array<{ object: (typeof selectedFiles)[number]; rows: Awaited<ReturnType<typeof parseBulkWorkbook>> }> = [];

    for (const object of selectedFiles) {
      const fileName = object.Key || "";
      try {
        if ((object.Size || 0) > MAX_R2_FILE_BYTES) {
          throw new Error(`File vượt quá giới hạn ${Math.round(MAX_R2_FILE_BYTES / 1_000_000)} MB.`);
        }
        const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: fileName }));
        if (!response.Body) throw new Error("R2 trả về file rỗng.");
        const buffer = Buffer.from(await response.Body.transformToByteArray());
        const adType = reportAdType(fileName);
        if (/search[\s_-]*term/i.test(fileName)) {
          const rows = fileName.toLowerCase().endsWith(".csv")
            ? parseSearchTermCsv(buffer, storeName, adType)
            : await parseSearchTermWorkbook(buffer, storeName, adType);
          if (!rows.length) throw new Error("Không có dữ liệu Search Term hợp lệ.");
          parsedSearchTerms.push({ object, rows });
        } else {
          if (fileName.toLowerCase().endsWith(".csv")) throw new Error("Bulk Operations cần định dạng .xlsx.");
          const rows = await parseBulkFile(buffer, storeName, fileName);
          if (!rows.length) throw new Error("Không có entity Bulk hợp lệ.");
          parsedPerformance.push({ object, rows });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Lỗi không xác định";
        failures.push({ fileName, error: message });
        await recordPpcSyncLog(scope, {
          source: "CLOUDFLARE_R2",
          fileName,
          sourceVersion: r2Version(object),
          status: "FAILED",
          message: `Giữ nguyên snapshot cũ của ${storeName}: ${message}`,
        });
      }
    }

    if (parsedSearchTerms.length) {
      const mergedRows = parsedSearchTerms.flatMap((item) => item.rows);
      const saved = await upsertPpcSearchTerms(scope, storeName, mergedRows, { replaceExisting: true });
      totalParsed += mergedRows.length;
      totalNew += saved.inserted;
      totalUpdated += saved.updated;
    }
    if (parsedPerformance.length) {
      const mergedRows = parsedPerformance.flatMap((item) => item.rows);
      const saved = await upsertPpcPerformance(scope, storeName, mergedRows, { replaceExisting: true });
      totalParsed += mergedRows.length;
      totalNew += saved.inserted;
      totalUpdated += saved.updated;
    }
    const processed = [...parsedSearchTerms, ...parsedPerformance];
    filesProcessed += processed.length;
    for (const item of processed) {
      await recordPpcSyncLog(scope, {
        source: "CLOUDFLARE_R2",
        fileName: item.object.Key || "",
        sourceVersion: r2Version(item.object),
        status: "SUCCESS",
        count: item.rows.length,
        message: `Snapshot PPC ${latestBatch} của ${storeName}; ${item.rows.length} dòng nguồn.`,
      });
    }
  }

  return {
    filesFound: reportFiles.length,
    searchTermFiles: searchTermFiles.length,
    bulkFiles: bulkFiles.length,
    filesProcessed,
    ignored,
    skipped: ignored,
    failed: failures.length,
    failures: failures.slice(0, 20),
    totalParsed,
    totalNew,
    totalUpdated,
  };
}

export const AMAZON_BULKSHEET_SP_COLUMNS = [
  "Product",                                                    // 1 (A)
  "Entity",                                                     // 2 (B)
  "Operation",                                                  // 3 (C)
  "Campaign ID",                                                // 4 (D)
  "Ad Group ID",                                                // 5 (E)
  "Portfolio ID",                                               // 6 (F)
  "Ad ID",                                                      // 7 (G)
  "Keyword ID",                                                 // 8 (H)
  "Product Targeting ID",                                       // 9 (I)
  "Campaign Name",                                              // 10 (J)
  "Ad Group Name",                                              // 11 (K)
  "Campaign Name (Informational only)",                         // 12 (L)
  "Ad Group Name (Informational only)",                         // 13 (M)
  "Portfolio Name (Informational only)",                        // 14 (N)
  "Start Date",                                                 // 15 (O)
  "End Date",                                                   // 16 (P)
  "Targeting Type",                                             // 17 (Q)
  "State",                                                      // 18 (R)
  "Campaign State (Informational only)",                        // 19 (S)
  "Ad Group State (Informational only)",                        // 20 (T)
  "Daily Budget",                                               // 21 (U)
  "SKU",                                                        // 22 (V)
  "ASIN (Informational only)",                                  // 23 (W)
  "Eligibility Status (Informational only)",                    // 24 (X)
  "Reason for Ineligibility (Informational only)",              // 25 (Y)
  "Ad Group Default Bid",                                       // 26 (Z)
  "Ad Group Default Bid (Informational only)",                  // 27 (AA)
  "Bid",                                                        // 28 (AB)
  "Keyword Text",                                               // 29 (AC)
  "Native Language Keyword",                                    // 30 (AD)
  "Native Language Locale",                                     // 31 (AE)
  "Match Type",                                                 // 32 (AF)
  "Bidding Strategy",                                           // 33 (AG)
  "Placement",                                                  // 34 (AH)
  "Percentage",                                                 // 35 (AI)
  "Product Targeting Expression",                               // 36 (AJ)
  "Resolved Product Targeting Expression (Informational only)", // 37 (AK)
  "Audience ID",                                                // 38 (AL)
  "Shopper Cohort Percentage",                                  // 39 (AM)
  "Shopper Cohort Type",                                        // 40 (AN)
  "Segment Name (Informational only)",                          // 41 (AO)
  "Sites",                                                      // 42 (AP)
  "Off-Amazon ad serving",                                      // 43 (AQ)
  "Impressions",                                                // 44 (AR)
  "Clicks",                                                     // 45 (AS)
  "Click-through Rate",                                         // 46 (AT)
  "Spend",                                                      // 47 (AU)
  "Sales",                                                      // 48 (AV)
  "Orders",                                                     // 49 (AW)
  "Units",                                                      // 50 (AX)
  "Conversion Rate",                                            // 51 (AY)
  "ACOS",                                                       // 52 (AZ)
  "CPC",                                                        // 53 (BA)
  "ROAS",                                                       // 54 (BB)
];

/**
 * Xuất file Excel Bulksheet format chuẩn 100% từ chính file mẫu gốc Amazon
 * (AdvertisingBulksheetTemplate-seller.xlsx) để đảm bảo tương thích tuyệt đối
 * khi nạp lên Amazon Seller Central (Bulk Operations).
 */
export async function exportBulksheetUpdateExcel(recommendations: PpcRecommendation[]): Promise<Buffer> {
  const { spawn } = await import("node:child_process");
  const path = (await import("node:path")).default;
  const fs = (await import("node:fs")).default;

  const pythonScript = path.join(process.cwd(), "scripts", "export_amazon_bulksheet.py");
  const templatePath = path.join(process.cwd(), "templates", "ppc", "AdvertisingBulksheetTemplate-seller.xlsx");

  if (fs.existsSync(pythonScript) && fs.existsSync(templatePath)) {
    return new Promise((resolve, reject) => {
      const proc = spawn("python3", [pythonScript], { stdio: ["pipe", "pipe", "pipe"] });
      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];

      proc.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      proc.stderr.on("data", (chunk) => errChunks.push(Buffer.from(chunk)));

      proc.on("close", (code) => {
        if (code !== 0) {
          const errText = Buffer.concat(errChunks).toString("utf-8");
          return reject(new Error(`Lỗi khi tạo Bulksheet từ mẫu Amazon: ${errText}`));
        }
        resolve(Buffer.concat(chunks));
      });

      proc.stdin.write(JSON.stringify(recommendations));
      proc.stdin.end();
    });
  }

  // Fallback: Tạo bằng ExcelJS nếu không tìm thấy template gốc
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Amazon Advertising";
  workbook.created = new Date();

  const portfolioSheet = workbook.addWorksheet("Portfolios");
  portfolioSheet.addRow(["Portfolio ID", "Portfolio Name", "Currency"]);

  const spSheet = workbook.addWorksheet("Sponsored Products Campaigns");
  const headerRow = spSheet.addRow(AMAZON_BULKSHEET_SP_COLUMNS);
  headerRow.font = { name: "Arial", size: 10, bold: true };

  for (const rec of recommendations) {
    let entity = "Keyword";
    let operation = "Update";
    let matchType = "";
    let state = "enabled";
    let bidVal: number | string = "";

    if (rec.recType === "NEGATIVE_KEYWORD") {
      entity = "Negative Keyword";
      operation = "Create";
      matchType = "Negative Exact";
      state = "enabled";
      bidVal = "";
    } else if (rec.recType === "BID_DECREASE" || rec.recType === "BID_INCREASE") {
      entity = "Keyword";
      operation = "Update";
      matchType = rec.matchType === "Exact" || rec.matchType === "Phrase" || rec.matchType === "Broad"
        ? rec.matchType
        : "";
      state = "enabled";
      bidVal = rec.recommendedBid ? Number(rec.recommendedBid.toFixed(2)) : "";
    } else if (rec.recType === "PAUSE_TARGET") {
      entity = "Keyword";
      operation = "Update";
      matchType = rec.matchType === "Exact" || rec.matchType === "Phrase" || rec.matchType === "Broad"
        ? rec.matchType
        : "";
      state = "paused";
      bidVal = rec.recommendedBid ? Number(rec.recommendedBid.toFixed(2)) : "";
    } else if (rec.recType === "HARVEST_KEYWORD") {
      entity = "Keyword";
      operation = "Create";
      matchType = "Exact";
      state = "enabled";
      bidVal = rec.recommendedBid ? Number(rec.recommendedBid.toFixed(2)) : 1.0;
    }

    const row = new Array(AMAZON_BULKSHEET_SP_COLUMNS.length).fill("");
    row[0] = "Sponsored Products";
    row[1] = entity;
    row[2] = operation;
    row[3] = rec.campaignId || "";
    row[4] = rec.adGroupId || "";
    row[7] = entity === "Keyword" ? (rec.keywordId || "") : "";
    row[9] = rec.campaignName || "";
    row[10] = rec.adGroupName || "";
    row[11] = rec.campaignName || "";
    row[12] = rec.adGroupName || "";
    row[17] = state;
    row[27] = bidVal;
    row[28] = rec.keyword;
    row[31] = matchType;

    spSheet.addRow(row);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
