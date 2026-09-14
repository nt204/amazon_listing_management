import "server-only";

import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import type { DataScope } from "@/lib/db";
import {
  calculatePpcSummary,
  generatePpcAlerts,
  generatePpcRecommendations,
  groupPpcByCampaign,
  groupPpcByMatchType,
  groupPpcBySku,
} from "./analytics";
import { MOCK_STORES, generateMockSearchTerms } from "./mock-data-generator";
import { parseSearchTermWorkbook } from "./parser";
import {
  hasSuccessfulPpcSync,
  listPpcSearchTerms,
  listPpcStores,
  listPpcSyncLogs,
  recordPpcSyncLog,
  replacePpcDataWithMock,
  upsertPpcSearchTerms,
} from "./repository";
import type { PpcAlert, PpcRecommendation, PpcSearchTermRow, PpcSkuPerformance, PpcSummaryMetrics } from "./types";

const MAX_R2_FILE_BYTES = 25_000_000;
const DEFAULT_TARGET_ACOS = 30;

export class PpcInputError extends Error {}

function cleanStoreName(value: string): string {
  const name = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!name) throw new PpcInputError("Tên store không được để trống.");
  if (name.length > 80) throw new PpcInputError("Tên store không được vượt quá 80 ký tự.");
  return name;
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
    if (candidate && !candidate.toLowerCase().endsWith(".xlsx")) {
      return cleanStoreName(candidate);
    }
  }
  return null;
}

function r2Version(input: { ETag?: string; Size?: number; LastModified?: Date }): string {
  return [input.ETag || "", input.Size || 0, input.LastModified?.toISOString() || ""].join(":");
}

export async function getPpcAnalyticsData(
  scope: DataScope,
  filters: { storeName?: string; sku?: string; days?: number } = {},
) {
  const storeName = filters.storeName || "ALL";
  const sku = filters.sku || "ALL";
  const days = filters.days || 30;
  let [stores, storeRows, syncLogs] = await Promise.all([
    listPpcStores(scope),
    listPpcSearchTerms(scope, { storeName, sku: "ALL", days }),
    listPpcSyncLogs(scope),
  ]);

  if (stores.length === 0 && storeRows.length === 0) {
    await resetPpcToMockData(scope);
    [stores, storeRows, syncLogs] = await Promise.all([
      listPpcStores(scope),
      listPpcSearchTerms(scope, { storeName, sku: "ALL", days }),
      listPpcSyncLogs(scope),
    ]);
  }

  const rows = sku === "ALL"
    ? storeRows
    : storeRows.filter((row) => row.portfolioName.toLowerCase() === sku.toLowerCase());

  const currentStore = stores.find((store) => store.name.toLowerCase() === storeName.toLowerCase());
  const targetAcos = currentStore?.targetAcos ?? DEFAULT_TARGET_ACOS;
  const summary: PpcSummaryMetrics = calculatePpcSummary(rows, targetAcos);
  const skuPerformance: PpcSkuPerformance[] = groupPpcBySku(rows, targetAcos);
  const campaignPerformance = groupPpcByCampaign(rows, targetAcos);
  const matchTypeBreakdown = groupPpcByMatchType(rows);
  const alerts: PpcAlert[] = generatePpcAlerts(rows, targetAcos);
  const recommendations: PpcRecommendation[] = generatePpcRecommendations(rows, targetAcos);
  const availableSkus = Array.from(new Set(storeRows.map((row) => row.portfolioName))).filter(Boolean).sort();

  return {
    stores,
    summary,
    skuPerformance,
    campaignPerformance,
    matchTypeBreakdown,
    alerts,
    recommendations,
    searchTerms: rows,
    availableSkus,
    days,
    targetAcos,
    lastSyncedAt: syncLogs[0]?.time ?? null,
    syncLogs,
  };
}

export async function ingestPpcExcelFile(
  scope: DataScope,
  fileBuffer: Buffer,
  fileName: string,
  storeName: string,
) {
  const normalizedStore = cleanStoreName(storeName);
  let parsedRows: PpcSearchTermRow[];
  try {
    parsedRows = await parseSearchTermWorkbook(fileBuffer, normalizedStore);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    const safeDetail = /^(Sheet|Ngày báo cáo)/.test(detail) ? ` ${detail}` : "";
    throw new PpcInputError(`File Excel bị hỏng hoặc không đúng cấu trúc .xlsx.${safeDetail}`);
  }
  if (!parsedRows.length) {
    throw new PpcInputError("Không tìm thấy dữ liệu Search Term hợp lệ trong file Excel.");
  }
  const saved = await upsertPpcSearchTerms(scope, normalizedStore, parsedRows);
  await recordPpcSyncLog(scope, {
    source: "MANUAL_UPLOAD",
    fileName,
    status: "SUCCESS",
    count: saved.inserted + saved.updated,
    message: `${saved.inserted} dòng mới, ${saved.updated} dòng cập nhật, ${saved.deduplicated} dòng trùng trong file.`,
  });
  return {
    totalParsed: parsedRows.length,
    newInserted: saved.inserted,
    updated: saved.updated,
    deduplicated: saved.deduplicated,
    fileName,
  };
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

  const excelFiles = objects
    .filter((object) => object.Key?.toLowerCase().endsWith(".xlsx"))
    .sort((first, second) => (first.LastModified?.getTime() || 0) - (second.LastModified?.getTime() || 0));
  const knownStores = (await listPpcStores(scope)).map((store) => store.name);
  let totalParsed = 0;
  let totalNew = 0;
  let totalUpdated = 0;
  let skipped = 0;
  const failures: Array<{ fileName: string; error: string }> = [];

  for (const object of excelFiles) {
    const fileName = object.Key || "";
    const version = r2Version(object);
    if (await hasSuccessfulPpcSync(scope, "CLOUDFLARE_R2", fileName, version)) {
      skipped += 1;
      continue;
    }
    try {
      if ((object.Size || 0) > MAX_R2_FILE_BYTES) {
        throw new Error("File vượt quá giới hạn 25 MB.");
      }
      const storeName = resolveStoreName(fileName, knownStores);
      if (!storeName) throw new Error("Không xác định được store từ đường dẫn R2.");
      const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: fileName }));
      if (!response.Body) throw new Error("R2 trả về file rỗng.");
      const buffer = Buffer.from(await response.Body.transformToByteArray());
      const parsedRows = await parseSearchTermWorkbook(buffer, storeName);
      if (!parsedRows.length) throw new Error("Không có sheet Search Term hợp lệ.");
      const saved = await upsertPpcSearchTerms(scope, storeName, parsedRows);
      totalParsed += parsedRows.length;
      totalNew += saved.inserted;
      totalUpdated += saved.updated;
      await recordPpcSyncLog(scope, {
        source: "CLOUDFLARE_R2",
        fileName,
        sourceVersion: version,
        status: "SUCCESS",
        count: saved.inserted + saved.updated,
        message: `${saved.inserted} mới, ${saved.updated} cập nhật, ${saved.deduplicated} trùng trong file.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Lỗi không xác định";
      failures.push({ fileName, error: message });
      await recordPpcSyncLog(scope, {
        source: "CLOUDFLARE_R2",
        fileName,
        sourceVersion: version,
        status: "FAILED",
        message,
      });
    }
  }

  return {
    filesFound: excelFiles.length,
    filesProcessed: excelFiles.length - skipped - failures.length,
    skipped,
    failed: failures.length,
    failures: failures.slice(0, 20),
    totalParsed,
    totalNew,
    totalUpdated,
  };
}
