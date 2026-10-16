import "server-only";

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { listStores } from "./accounting-db";
import { importCheckShipmentsFromCsv } from "./inventory-db";
import { parseOrdersBuffer, batchUpsertOrders } from "./orders-db";
import { parseAdsBuffer, batchUpsertAds } from "./ads-db";
import { parseReturnBuffer, batchUpsertReturns } from "./returns-db";
import { parseServiceFeeBuffer, batchUpsertServiceFees } from "./service-fees-db";

export interface ManagedAccountingFile {
  id: string;
  r2Key: string;
  reportDate: string;
  storeName: string;
  fileName: string;
  fileTypeCode: string;
  fileTypeLabel: string;
  sizeBytes: number;
  lastModified: string;
  isIngestable: boolean;
  downloadUrl?: string;
  localPath?: string;
}

export interface AccountingFileStats {
  totalFiles: number;
  totalBytes: number;
  storesCount: number;
  datesCount: number;
  latestDate: string;
  latestModified?: string;
}

function getR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME || "amazon-listing-production";
  const prefix = (process.env.ACCOUNTING_R2_PREFIX || "accounting-reports").replace(/^\/+|\/+$/g, "");

  if (!accountId || !accessKeyId || !secretAccessKey) {
    return null;
  }

  const client = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  return { client, bucket, prefix };
}

export function detectFileType(fileName: string): { code: string; label: string; isIngestable: boolean } {
  const lower = fileName.toLowerCase();
  if (lower.includes("01_portfolios") || lower.includes("portfolio")) {
    return { code: "01_PORTFOLIOS", label: "01. Danh mục Portfolios", isIngestable: true };
  }
  if (lower.includes("02_allorders") || lower.includes("allorders") || lower.includes("all orders")) {
    return { code: "02_ALL_ORDERS", label: "02. Đơn hàng All Orders", isIngestable: true };
  }
  if (lower.includes("03_returns") || lower.includes("returns")) {
    return { code: "03_RETURNS", label: "03. Trả hàng Returns", isIngestable: true };
  }
  if (lower.includes("04_servicefees") || lower.includes("servicefees") || lower.includes("service fees")) {
    return { code: "04_SERVICE_FEES", label: "04. Phí dịch vụ Service Fees", isIngestable: true };
  }
  if (lower.includes("05_campaigns") || lower.includes("campaign")) {
    return { code: "05_CAMPAIGNS", label: "05. Chi phí Ads (Portfolios)", isIngestable: true };
  }
  if (lower.includes("06_fbainventory") || lower.includes("fbainventory") || lower.includes("fba inventory")) {
    return { code: "06_FBA_INVENTORY", label: "06. Tồn kho FBA Inventory", isIngestable: true };
  }
  if (lower.includes("08_dcshipments") || lower.includes("dcshipments") || lower.includes("dc-shipment") || lower.includes("awd")) {
    return { code: "08_DC_SHIPMENTS", label: "08. Lô hàng Distribution Center (AWD)", isIngestable: false };
  }
  if (lower.includes("07_shipments") || lower.includes("shipment")) {
    return { code: "07_SHIPMENTS", label: "07. Lô hàng Inbound Shipments", isIngestable: true };
  }
  return { code: "OTHER", label: "Khác", isIngestable: false };
}

export async function listManagedAccountingFiles(options?: {
  storeName?: string;
  reportDate?: string;
}): Promise<{
  files: ManagedAccountingFile[];
  stats: AccountingFileStats;
  availableStores: string[];
  availableDates: string[];
}> {
  const r2 = getR2Client();
  const fileMap = new Map<string, ManagedAccountingFile>();

  // 1. Quét từ Cloudflare R2
  if (r2) {
    try {
      let continuationToken: string | undefined = undefined;
      do {
        const command = new ListObjectsV2Command({
          Bucket: r2.bucket,
          Prefix: `${r2.prefix}/`,
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        });
        const res: any = await r2.client.send(command);

        if (res.Contents) {
          for (const item of res.Contents) {
            const key = item.Key || "";
            if (!key || key.endsWith("/") || key.endsWith(".DS_Store") || key.endsWith("manifest.json")) continue;

            // Pattern: prefix/YYYY-MM-DD/STORE_NAME/fileName
            const subPath = key.slice(r2.prefix.length).replace(/^\/+/, "");
            const parts = subPath.split("/");
            if (parts.length >= 3) {
              const dateStr = parts[0];
              const storeStr = parts[1].toUpperCase();
              const fname = parts.slice(2).join("/");

              const typeInfo = detectFileType(fname);
              const fileId = `${dateStr}_${storeStr}_${fname}`;

              fileMap.set(fileId, {
                id: fileId,
                r2Key: key,
                reportDate: dateStr,
                storeName: storeStr,
                fileName: fname,
                fileTypeCode: typeInfo.code,
                fileTypeLabel: typeInfo.label,
                sizeBytes: item.Size || 0,
                lastModified: item.LastModified?.toISOString() || new Date().toISOString(),
                isIngestable: typeInfo.isIngestable,
              });
            }
          }
        }
        continuationToken = res.NextContinuationToken;
      } while (continuationToken);
    } catch (err) {
      console.error("[Accounting File Service] Lỗi khi quét Cloudflare R2:", err);
    }
  }

  // 2. Quét từ thư mục cục bộ (nếu chạy local hoặc trên Mac mini/server)
  const localBase = process.env.ACCOUNTING_DOWNLOAD_DIR || path.join(os.homedir(), "AmazonAccounting", "downloads");
  if (fs.existsSync(localBase)) {
    try {
      const dates = fs.readdirSync(localBase).filter((d) => !d.startsWith(".") && fs.statSync(path.join(localBase, d)).isDirectory());
      for (const d of dates) {
        const dPath = path.join(localBase, d);
        const stores = fs.readdirSync(dPath).filter((s) => !s.startsWith(".") && fs.statSync(path.join(dPath, s)).isDirectory());
        for (const s of stores) {
          const sUpper = s.toUpperCase();
          const sPath = path.join(dPath, s);
          const fnames = fs.readdirSync(sPath).filter((f) => !f.startsWith(".") && f !== "manifest.json" && fs.statSync(path.join(sPath, f)).isFile());
          for (const fname of fnames) {
            const fPath = path.join(sPath, fname);
            const stat = fs.statSync(fPath);
            const fileId = `${d}_${sUpper}_${fname}`;
            const typeInfo = detectFileType(fname);

            const existing = fileMap.get(fileId);
            if (existing) {
              existing.localPath = fPath;
            } else {
              fileMap.set(fileId, {
                id: fileId,
                r2Key: `${r2?.prefix || "accounting-reports"}/${d}/${sUpper}/${fname}`,
                reportDate: d,
                storeName: sUpper,
                fileName: fname,
                fileTypeCode: typeInfo.code,
                fileTypeLabel: typeInfo.label,
                sizeBytes: stat.size,
                lastModified: stat.mtime.toISOString(),
                isIngestable: typeInfo.isIngestable,
                localPath: fPath,
              });
            }
          }
        }
      }
    } catch (localErr) {
      console.warn("[Accounting File Service] Quét file cục bộ gặp lỗi:", localErr);
    }
  }

  let allFiles = Array.from(fileMap.values());

  // Lọc
  if (options?.storeName && options.storeName !== "ALL") {
    allFiles = allFiles.filter((f) => f.storeName.toUpperCase() === options.storeName?.toUpperCase());
  }
  if (options?.reportDate && options.reportDate !== "ALL") {
    allFiles = allFiles.filter((f) => f.reportDate === options.reportDate);
  }

  // Sắp xếp: ngày mới nhất trước, sau đó theo store, sau đó theo mã file
  allFiles.sort((a, b) => {
    if (a.reportDate !== b.reportDate) return b.reportDate.localeCompare(a.reportDate);
    if (a.storeName !== b.storeName) return a.storeName.localeCompare(b.storeName);
    return a.fileTypeCode.localeCompare(b.fileTypeCode);
  });

  const availableStores = Array.from(new Set(Array.from(fileMap.values()).map((f) => f.storeName))).sort();
  const availableDates = Array.from(new Set(Array.from(fileMap.values()).map((f) => f.reportDate))).sort().reverse();

  const totalBytes = allFiles.reduce((acc, f) => acc + f.sizeBytes, 0);

  let latestModified = "";
  for (const f of allFiles) {
    if (f.lastModified && (!latestModified || f.lastModified > latestModified)) {
      latestModified = f.lastModified;
    }
  }

  return {
    files: allFiles,
    stats: {
      totalFiles: allFiles.length,
      totalBytes,
      storesCount: availableStores.length,
      datesCount: availableDates.length,
      latestDate: availableDates[0] || "",
      latestModified,
    },
    availableStores,
    availableDates,
  };
}

export async function getAccountingDownloadUrl(r2Key: string, fileName?: string): Promise<string | null> {
  const r2 = getR2Client();
  if (!r2) return null;

  const cleanName = (fileName || path.basename(r2Key)).replace(/[/\\?%*:|"<>]/g, "_");
  const command = new GetObjectCommand({
    Bucket: r2.bucket,
    Key: r2Key,
    ResponseContentDisposition: `attachment; filename="${cleanName}"`,
  });

  return await getSignedUrl(r2.client, command, { expiresIn: 3600 });
}

export async function getAccountingFileBuffer(r2Key: string): Promise<Buffer | null> {
  const r2 = getR2Client();
  if (r2) {
    try {
      const command = new GetObjectCommand({
        Bucket: r2.bucket,
        Key: r2Key,
      });
      const res = await r2.client.send(command);
      if (res.Body) {
        const byteArray = await res.Body.transformToByteArray();
        return Buffer.from(byteArray);
      }
    } catch (e) {
      console.error("[Accounting File Buffer] Lỗi lấy từ R2:", e);
    }
  }

  // Fallback đọc file local nếu có
  const localBase = process.env.ACCOUNTING_DOWNLOAD_DIR || path.join(os.homedir(), "AmazonAccounting", "downloads");
  const subPath = r2Key.replace(/^[^/]+\//, ""); // Bỏ prefix
  const localCandidate = path.join(localBase, subPath);
  if (fs.existsSync(localCandidate)) {
    return fs.readFileSync(localCandidate);
  }

  return null;
}

export async function ingestAccountingFile(r2Key: string, storeName: string): Promise<{
  success: boolean;
  message: string;
  type: string;
  count?: number;
  createdCount?: number;
  updatedCount?: number;
}> {
  const buffer = await getAccountingFileBuffer(r2Key);
  if (!buffer) {
    throw new Error("Không thể tải nội dung file từ hệ thống lưu trữ.");
  }

  const stores = await listStores();
  const canonicalName = storeName.toUpperCase() === "HSOSTORE" ? "WARMSTOREY" : storeName.toUpperCase();
  const targetStore = stores.find((s) => s.name.toUpperCase() === canonicalName);
  if (!targetStore) {
    throw new Error(`Không tìm thấy Store '${storeName}' trong hệ thống kế toán.`);
  }

  const fileName = path.basename(r2Key);
  const typeInfo = detectFileType(fileName);

  if (typeInfo.code === "07_SHIPMENTS") {
    const text = buffer.toString("utf-8");
    const result = await importCheckShipmentsFromCsv(targetStore.id, text);
    return {
      success: true,
      type: "07_SHIPMENTS",
      message: `Đã nạp đối soát lô hàng (${result.count} dòng: ${result.createdCount} tạo mới, ${result.updatedCount} cập nhật).`,
      count: result.count,
      createdCount: result.createdCount,
      updatedCount: result.updatedCount,
    };
  }

  if (typeInfo.code === "02_ALL_ORDERS") {
    const orders = await parseOrdersBuffer(buffer, fileName, targetStore.id);
    const result = await batchUpsertOrders(targetStore.id, orders);
    return {
      success: true,
      type: "02_ALL_ORDERS",
      message: `Đã nạp thành công ${result.count} đơn hàng vào hệ thống!`,
      count: result.count,
      createdCount: result.count,
      updatedCount: 0,
    };
  }

  if (typeInfo.code === "05_CAMPAIGNS" || typeInfo.code === "01_PORTFOLIOS") {
    const adsRows = await parseAdsBuffer(buffer, fileName, targetStore.id);
    const result = await batchUpsertAds(targetStore.id, adsRows);
    return {
      success: true,
      type: typeInfo.code,
      message: `Đã nạp thành công ${result.count} dòng chi phí Ads vào hệ thống!`,
      count: result.count,
      createdCount: result.createdCount,
      updatedCount: result.updatedCount,
    };
  }

  if (typeInfo.code === "03_RETURNS") {
    const returnRows = await parseReturnBuffer(buffer, fileName, targetStore.id);
    const result = await batchUpsertReturns(targetStore.id, returnRows);
    return {
      success: true,
      type: "03_RETURNS",
      message: `Đã nạp thành công ${result.count} dòng dữ liệu trả hàng (Return) vào hệ thống!`,
      count: result.count,
      createdCount: result.createdCount,
      updatedCount: 0,
    };
  }

  if (typeInfo.code === "04_SERVICE_FEES") {
    const feeRows = await parseServiceFeeBuffer(buffer, fileName, targetStore.id);
    const result = await batchUpsertServiceFees(targetStore.id, feeRows);
    return {
      success: true,
      type: "04_SERVICE_FEES",
      message: `Đã nạp thành công ${result.count} dòng dữ liệu phí dịch vụ (Service Fee) vào hệ thống!`,
      count: result.count,
      createdCount: result.createdCount,
      updatedCount: 0,
    };
  }

  throw new Error(`Loại file '${typeInfo.label}' chưa hỗ trợ tự động nạp dữ liệu.`);
}

/**
 * Tự động tìm file mới nhất của từng Store (theo ngày báo cáo và thời gian tạo)
 * và nạp dữ liệu vào database cho TẤT CẢ các Store trong hệ thống.
 */
export async function syncLatestFilesForAllStores(
  fileTypeCode: "07_SHIPMENTS" | "02_ALL_ORDERS" | "05_CAMPAIGNS" | "01_PORTFOLIOS" | "03_RETURNS" | "04_SERVICE_FEES"
): Promise<{
  success: boolean;
  fileTypeCode: string;
  totalStores: number;
  totalIngested: number;
  results: Array<{
    storeName: string;
    fileName: string;
    reportDate: string;
    count: number;
    createdCount?: number;
    updatedCount?: number;
    error?: string;
  }>;
}> {
  const { files } = await listManagedAccountingFiles();
  const matchingFiles = files.filter((f) => f.fileTypeCode === fileTypeCode);

  const getFileEffectiveDate = (f: { fileName: string; reportDate: string }) => {
    const m = f.fileName.match(/(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : f.reportDate;
  };

  const storeLatestMap = new Map<string, typeof matchingFiles[0]>();
  for (const f of matchingFiles) {
    const existing = storeLatestMap.get(f.storeName);
    if (!existing) {
      storeLatestMap.set(f.storeName, f);
      continue;
    }
    const dateNew = getFileEffectiveDate(f);
    const dateExisting = getFileEffectiveDate(existing);
    if (dateNew > dateExisting) {
      storeLatestMap.set(f.storeName, f);
    } else if (dateNew === dateExisting && f.lastModified > existing.lastModified) {
      storeLatestMap.set(f.storeName, f);
    }
  }

  const results: Array<{
    storeName: string;
    fileName: string;
    reportDate: string;
    count: number;
    createdCount?: number;
    updatedCount?: number;
    error?: string;
  }> = [];

  let totalIngested = 0;

  for (const [storeName, file] of storeLatestMap.entries()) {
    try {
      const res = await ingestAccountingFile(file.r2Key, storeName);
      const count = res.count || 0;
      totalIngested += count;
      results.push({
        storeName,
        fileName: file.fileName,
        reportDate: file.reportDate,
        count,
        createdCount: res.createdCount,
        updatedCount: res.updatedCount,
      });
    } catch (err: any) {
      console.warn(`[syncLatestFilesForAllStores] Lỗi nạp store ${storeName} (${file.fileName}):`, err?.message);
      results.push({
        storeName,
        fileName: file.fileName,
        reportDate: file.reportDate,
        count: 0,
        error: err?.message,
      });
    }
  }

  return {
    success: true,
    fileTypeCode,
    totalStores: results.length,
    totalIngested,
    results,
  };
}

