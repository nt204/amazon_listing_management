import "server-only";

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getDatabaseClient, type DataScope } from "@/lib/db";
import { canonicalStoreName, reportAdType } from "./service";
import { listPpcStores } from "./repository";
import { extractCampaignDate } from "./sku-extractor";

export interface ManagedPpcFile {
  id: string;
  fileName: string;
  storeName: string;
  fileType: "BULK_SP" | "BULK_SB" | "SEARCH_TERM_SP" | "SEARCH_TERM_SB" | "BULK_EXPORT" | "OTHER";
  adType?: "SP" | "SB";
  days?: number;
  reportDate?: string;
  batchFolder?: string; // Tên đợt crawl/thư mục batch trên R2 (e.g. CELSORIX_20260924_wblow0)
  relativePath?: string; // e.g. "2026-09-21/HSOSTORE/SP/fileName.xlsx"
  folderPath?: string;   // e.g. "2026-09-21/HSOSTORE/SP"
  sizeBytes: number;
  lastModified: string;
  locations: {
    server: boolean;
    serverPath?: string;
    r2: boolean;
    r2Key?: string;
    database: boolean;
    dbRecordsCount?: number;
  };
  syncLogId?: string;
}

export interface PpcStorageStats {
  serverFilesCount: number;
  serverTotalBytes: number;
  r2FilesCount: number;
  r2TotalBytes: number;
  dbSyncedFilesCount: number;
}

export const LOCAL_BULK_DIR = path.join(os.homedir(), "Downloads", "Bulk file");

function getR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME || "amazon-listing-production";
  const prefix = (process.env.PPC_R2_PREFIX || "ppc-reports").replace(/^\/+|\/+$/g, "");

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

export function detectFileType(fileName: string): ManagedPpcFile["fileType"] {
  const lower = fileName.toLowerCase();
  const isSearchTerm = lower.includes("search") || lower.includes("term") || lower.includes("str");
  const isSb = lower.includes("sb") || lower.includes("brand");
  const isBulkExport = lower.includes("bulk_export") || lower.includes("bulksheet_update") || lower.startsWith("upload_");

  if (isBulkExport) return "BULK_EXPORT";
  if (isSearchTerm) return isSb ? "SEARCH_TERM_SB" : "SEARCH_TERM_SP";
  if (isSb) return "BULK_SB";
  return "BULK_SP";
}

export function detectDays(fileName: string): number | undefined {
  const m = fileName.match(/(\d+)\s*(?:day|days|ngày|d\b)/i);
  if (m) return parseInt(m[1], 10);
  if (/7d/i.test(fileName)) return 7;
  if (/14d/i.test(fileName)) return 14;
  if (/30d/i.test(fileName)) return 30;
  return undefined;
}

/**
 * Trích xuất ngày, store, loại quảng cáo (SP/SB) và loại file từ tên file hoặc đường dẫn phân cấp.
 */
export function parseReportMetadata(
  fileName: string,
  relativeOrFullPath?: string,
  knownStores: string[] = [],
): {
  reportDate: string;
  storeName: string;
  adType: "SP" | "SB";
  fileType: ManagedPpcFile["fileType"];
  days?: number;
  batchFolder?: string;
} {
  const fileType = detectFileType(fileName);
  const days = detectDays(fileName);
  const adType: "SP" | "SB" =
    fileType === "BULK_SB" ||
    fileType === "SEARCH_TERM_SB" ||
    /(?:^|[_\-/])SB(?:[_\-.]|$)/i.test(fileName) ||
    /(?:^|[/\\])SB(?:[/\\]|$)/i.test(relativeOrFullPath || "")
      ? "SB"
      : "SP";

  // 1. Nhận diện store từ tiền tố tên file, knownStores hoặc đường dẫn
  let storeCandidate: string | null = null;

  // 1a. Kiểm tra tiền tố tên file: ví dụ CELSORIX_Search_Term_..., HSOSTORE_Bulk_...
  const prefixMatch = fileName.match(/^([A-Za-z0-9_-]+?)_(?:Bulk|Search_Term|SP|SB)/i);
  if (prefixMatch && prefixMatch[1]) {
    storeCandidate = prefixMatch[1];
  }

  // 1b. Khớp với danh sách store đã biết (knownStores)
  if (!storeCandidate && knownStores.length > 0) {
    const fnLower = fileName.toLowerCase();
    const matchedKnown = knownStores.find(
      (ks) => fnLower.includes(ks.toLowerCase()) || (relativeOrFullPath && relativeOrFullPath.toLowerCase().includes(ks.toLowerCase()))
    );
    if (matchedKnown) {
      storeCandidate = matchedKnown;
    }
  }

  // 1c. Kiểm tra từ đường dẫn phân cấp (R2 hoặc Local path)
  if (!storeCandidate && relativeOrFullPath) {
    const parts = relativeOrFullPath.split(/[/\\]/);
    const inputIdx = parts.findIndex((p) => p.toLowerCase() === "input" || p.toLowerCase() === "output");
    if (inputIdx >= 0 && parts[inputIdx + 2]) {
      // Dạng ppc-reports/input/20260924/CELSORIX/...
      storeCandidate = parts[inputIdx + 2];
    } else {
      for (const p of parts) {
        if (/warmstorey/i.test(p)) { storeCandidate = "Warmstorey"; break; }
        if (/celsorix/i.test(p)) { storeCandidate = "CELSORIX"; break; }
        if (/hsostore/i.test(p)) { storeCandidate = "HSOSTORE"; break; }
      }
    }
  }

  // 1d. Fallback nếu vẫn chưa tìm thấy
  if (!storeCandidate) {
    if (fileName.toUpperCase().includes("WARMSTOREY")) storeCandidate = "Warmstorey";
    else if (fileName.toUpperCase().includes("CELSORIX")) storeCandidate = "CELSORIX";
    else if (fileName.toUpperCase().includes("HSOSTORE")) storeCandidate = "HSOSTORE";
    else storeCandidate = "HSOSTORE";
  }

  // 2. Nhận diện ngày báo cáo (Ưu tiên: thư mục YYYY-MM-DD hoặc YYYYMMDD -> Range cuối -> Ngày đơn lẻ trong tên file -> Hôm nay)
  let reportDate = "";
  if (relativeOrFullPath) {
    const parts = relativeOrFullPath.split(/[/\\]/);
    for (const p of parts) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(p)) {
        reportDate = p;
        break;
      }
      if (/^\d{8}$/.test(p) && p.startsWith("20")) {
        reportDate = `${p.slice(0, 4)}-${p.slice(4, 6)}-${p.slice(6, 8)}`;
        break;
      }
    }
  }

  if (!reportDate) {
    // Tìm range YYYYMMDD-YYYYMMDD (ví dụ: 20260822-20260921)
    const rangeMatch = fileName.match(/(\d{4})(\d{2})(\d{2})-(\d{4})(\d{2})(\d{2})/);
    if (rangeMatch) {
      reportDate = `${rangeMatch[4]}-${rangeMatch[5]}-${rangeMatch[6]}`;
    } else {
      // Tìm ngày đơn lẻ YYYYMMDD (ví dụ: 20260924)
      const singleMatch = fileName.match(/(?:20\d{2})(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])/);
      if (singleMatch) {
        const s = singleMatch[0];
        reportDate = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
      }
    }
  }

  if (!reportDate) {
    reportDate = new Date().toISOString().split("T")[0];
  }

  // 3. Nhận diện thư mục batch (Đợt chạy) từ đường dẫn R2/Local
  let batchFolder: string | undefined = undefined;
  if (relativeOrFullPath) {
    const parts = relativeOrFullPath.split(/[/\\]/);
    const inputIdx = parts.findIndex((p) => p.toLowerCase() === "input" || p.toLowerCase() === "output");
    if (inputIdx >= 0 && parts.length >= inputIdx + 4) {
      const candidate = parts[inputIdx + 3];
      if (candidate && !["sp", "sb"].includes(candidate.toLowerCase()) && !candidate.includes(".")) {
        batchFolder = candidate;
      }
    }
  }

  return {
    reportDate,
    storeName: canonicalStoreName(storeCandidate),
    adType,
    fileType,
    days,
    batchFolder,
  };
}

/**
 * Trả về đường dẫn thư mục phân cấp chuẩn: [baseDir]/[YYYY-MM-DD]/[StoreName]/[SP | SB]
 */
export function getStructuredReportDir(
  dateStr: string,
  storeName: string,
  adType: "SP" | "SB",
  baseDir = LOCAL_BULK_DIR,
): string {
  const safeDate = dateStr.replace(/[^0-9-]/g, "") || new Date().toISOString().split("T")[0];
  const safeStore = canonicalStoreName(storeName);
  const safeType = adType === "SB" ? "SB" : "SP";
  return path.join(baseDir, safeDate, safeStore, safeType);
}

/**
 * Tổ chức/di chuyển một file báo cáo vào đúng cấu trúc phân cấp:
 * ~/Downloads/Bulk file/[Ngày]/[Store]/[SP|SB]/[fileName]
 */
export function organizePpcReportFile(
  currentPath: string,
  options: { storeName?: string; dateStr?: string; adType?: "SP" | "SB" } = {},
): string {
  if (!fs.existsSync(currentPath)) {
    return currentPath;
  }
  const fileName = path.basename(currentPath);
  const meta = parseReportMetadata(fileName, currentPath);

  const dateStr = options.dateStr || meta.reportDate;
  const storeName = options.storeName ? canonicalStoreName(options.storeName) : meta.storeName;
  const adType = options.adType || meta.adType;

  const targetDir = getStructuredReportDir(dateStr, storeName, adType);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const targetPath = path.join(targetDir, fileName);
  if (path.resolve(currentPath) === path.resolve(targetPath)) {
    return targetPath;
  }

  if (fs.existsSync(targetPath)) {
    try {
      fs.unlinkSync(targetPath);
    } catch {}
  }

  fs.renameSync(currentPath, targetPath);
  return targetPath;
}

/**
 * Quét toàn bộ thư mục Bulk file và tự động gom các file chưa phân cấp vào đúng vị trí:
 * [Ngày YYYY-MM-DD]/[Store]/[SP|SB]/[fileName]
 */
export function organizeAllLocalBulkFiles(baseDir = LOCAL_BULK_DIR): {
  movedCount: number;
  files: { oldPath: string; newPath: string }[];
} {
  if (!fs.existsSync(baseDir)) {
    return { movedCount: 0, files: [] };
  }

  const allFiles = findFilesRecursively(baseDir, 5);
  const movedFiles: { oldPath: string; newPath: string }[] = [];

  for (const filePath of allFiles) {
    const fileName = path.basename(filePath);
    if (fileName.startsWith(".") || fileName.endsWith(".crdownload")) continue;

    const relPath = path.relative(baseDir, filePath);
    const parts = relPath.split(path.sep);

    // Kiểm tra xem file đã nằm đúng cấu trúc: [YYYY-MM-DD]/[Store]/[SP|SB]/fileName chưa
    const isAlreadyOrganized =
      parts.length === 4 &&
      /^\d{4}-\d{2}-\d{2}$/.test(parts[0]) &&
      Boolean(parts[1]) &&
      (parts[2] === "SP" || parts[2] === "SB");

    if (!isAlreadyOrganized) {
      const meta = parseReportMetadata(fileName, relPath);
      const targetDir = getStructuredReportDir(meta.reportDate, meta.storeName, meta.adType, baseDir);
      const targetPath = path.join(targetDir, fileName);

      if (path.resolve(filePath) !== path.resolve(targetPath)) {
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        if (fs.existsSync(targetPath)) {
          try { fs.unlinkSync(targetPath); } catch {}
        }
        fs.renameSync(filePath, targetPath);
        cleanEmptyParentDirs(path.dirname(filePath), baseDir);
        movedFiles.push({ oldPath: filePath, newPath: targetPath });
      }
    }
  }

  return {
    movedCount: movedFiles.length,
    files: movedFiles,
  };
}

/**
 * Đệ quy tìm kiếm tất cả các file trong thư mục tối đa maxDepth tầng
 */
export function findFilesRecursively(dir: string, maxDepth = 5, currentDepth = 0): string[] {
  if (!fs.existsSync(dir) || currentDepth > maxDepth) return [];
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name.endsWith(".crdownload")) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findFilesRecursively(fullPath, maxDepth, currentDepth + 1));
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  } catch (e) {
    console.warn("[File Manager] Lỗi đọc thư mục:", dir, e);
  }
  return results;
}

/**
 * Dọn dẹp các thư mục rỗng cha sau khi di chuyển hoặc xóa file
 */
export function cleanEmptyParentDirs(dir: string, stopDir: string) {
  try {
    let curr = path.resolve(dir);
    const stop = path.resolve(stopDir);
    while (curr !== stop && curr.startsWith(stop)) {
      const items = fs.readdirSync(curr);
      if (items.length === 0 || (items.length === 1 && items[0] === ".DS_Store")) {
        if (items.includes(".DS_Store")) {
          try { fs.unlinkSync(path.join(curr, ".DS_Store")); } catch {}
        }
        fs.rmdirSync(curr);
        curr = path.dirname(curr);
      } else {
        break;
      }
    }
  } catch {}
}

export async function listManagedPpcFiles(scope: DataScope): Promise<{
  files: ManagedPpcFile[];
  stats: PpcStorageStats;
}> {
  const sql = await getDatabaseClient();
  const fileMap = new Map<string, ManagedPpcFile>();
  const knownStores = (await listPpcStores(scope).catch(() => [])).map((s: { name: string }) => s.name);

  let serverFilesCount = 0;
  let serverTotalBytes = 0;
  let r2FilesCount = 0;
  let r2TotalBytes = 0;

  // 1. Quét file cục bộ trên máy chủ (Server local) - Quét đệ quy đa tầng
  if (fs.existsSync(LOCAL_BULK_DIR)) {
    try {
      const allFiles = findFilesRecursively(LOCAL_BULK_DIR, 5);
      for (const fullPath of allFiles) {
        try {
          const stat = fs.statSync(fullPath);
          if (!stat.isFile()) continue;

          serverFilesCount++;
          serverTotalBytes += stat.size;

          const fileName = path.basename(fullPath);
          const relativePath = path.relative(LOCAL_BULK_DIR, fullPath);
          const folderPath = path.dirname(relativePath) === "." ? "" : path.dirname(relativePath);
          const meta = parseReportMetadata(fileName, relativePath, knownStores);

          fileMap.set(fileName, {
            id: `server-${fileName}`,
            fileName,
            storeName: meta.storeName,
            fileType: meta.fileType,
            adType: meta.adType,
            days: meta.days,
            reportDate: meta.reportDate,
            relativePath,
            folderPath,
            sizeBytes: stat.size,
            lastModified: stat.mtime.toISOString(),
            locations: {
              server: true,
              serverPath: fullPath,
              r2: false,
              database: false,
            },
          });
        } catch {}
      }
    } catch (err) {
      console.warn("[File Manager] Lỗi đọc thư mục local:", err);
    }
  }

  // 2. Quét file trên Cloudflare R2
  const r2 = getR2Client();
  if (r2) {
    try {
      let continuationToken: string | undefined;
      do {
        const res = await r2.client.send(
          new ListObjectsV2Command({
            Bucket: r2.bucket,
            Prefix: `${r2.prefix}/`,
            ContinuationToken: continuationToken,
            MaxKeys: 1000,
          }),
        );

        for (const obj of res.Contents || []) {
          const key = obj.Key || "";
          if (key.endsWith("/") || key.endsWith("/_COMPLETE.json")) continue;

          r2FilesCount++;
          const size = obj.Size || 0;
          r2TotalBytes += size;

          const baseName = path.basename(key);
          const meta = parseReportMetadata(baseName, key, knownStores);
          const r2FolderDisplay = key.includes("/") ? key.split("/").slice(0, -1).join("/") : "";

          const fileMapKey = `r2:${key}`;
          fileMap.set(fileMapKey, {
            id: `r2-${key}`,
            fileName: baseName,
            storeName: meta.storeName,
            fileType: meta.fileType,
            adType: meta.adType,
            days: meta.days,
            reportDate: meta.reportDate,
            batchFolder: meta.batchFolder,
            folderPath: r2FolderDisplay,
            relativePath: key,
            sizeBytes: size,
            lastModified: obj.LastModified ? obj.LastModified.toISOString() : new Date().toISOString(),
            locations: {
              server: false,
              r2: true,
              r2Key: key,
              database: false,
            },
          });
        }

        continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (continuationToken);
    } catch (err) {
      console.warn("[File Manager] Lỗi đọc Cloudflare R2:", err);
    }
  }

  // 3. Khớp thông tin với Database Sync Logs
  const syncLogs = await sql<any[]>`
    SELECT id, file_name, records_count, created_at, status
    FROM ppc_sync_logs
    WHERE team_id = ${scope.teamId} OR team_id = 'default'
    ORDER BY created_at DESC
  `;

  for (const log of syncLogs) {
    const fn = log.file_name || "";
    if (!fn) continue;

    const baseName = path.basename(fn);
    const count = Number(log.records_count || 0);

    let matched = false;
    for (const file of fileMap.values()) {
      if (file.fileName === baseName || (file.relativePath && file.relativePath.endsWith(baseName))) {
        file.locations.database = true;
        file.locations.dbRecordsCount = Math.max(file.locations.dbRecordsCount || 0, count);
        file.syncLogId = log.id;
        matched = true;
      }
    }

    if (!matched) {
      fileMap.set(`db:${log.id}`, {
        id: `db-${log.id}`,
        fileName: baseName,
        storeName: baseName.toUpperCase().includes("WARMSTOREY") ? "Warmstorey" : "HSOSTORE",
        fileType: detectFileType(baseName),
        days: detectDays(baseName),
        sizeBytes: 0,
        lastModified: log.created_at ? new Date(log.created_at).toISOString() : new Date().toISOString(),
        locations: {
          server: false,
          r2: false,
          database: true,
          dbRecordsCount: count,
        },
        syncLogId: log.id,
      });
    }
  }

  const files = Array.from(fileMap.values()).sort(
    (a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime(),
  );

  return {
    files,
    stats: {
      serverFilesCount,
      serverTotalBytes,
      r2FilesCount,
      r2TotalBytes,
      dbSyncedFilesCount: syncLogs.length,
    },
  };
}

export async function deleteManagedPpcFile(
  scope: DataScope,
  params: {
    fileName: string;
    serverPath?: string;
    r2Key?: string;
    purgeDb?: boolean;
  },
): Promise<{
  deletedServer: boolean;
  deletedR2: boolean;
  purgedDbRows: { facts: number; searchTerms: number; syncLogs: number };
}> {
  const sql = await getDatabaseClient();
  let deletedServer = false;
  let deletedR2 = false;
  const purgedDbRows = { facts: 0, searchTerms: 0, syncLogs: 0 };

  // 1. Xóa file trên Server
  const targetServerPath = params.serverPath || path.join(LOCAL_BULK_DIR, params.fileName);
  if (fs.existsSync(targetServerPath)) {
    try {
      fs.unlinkSync(targetServerPath);
      deletedServer = true;
      cleanEmptyParentDirs(path.dirname(targetServerPath), LOCAL_BULK_DIR);
    } catch (err) {
      console.warn(`[File Manager] Lỗi xóa file server ${targetServerPath}:`, err);
    }
  }

  // 2. Xóa file trên Cloudflare R2
  const r2 = getR2Client();
  if (r2) {
    try {
      let keyToDelete = params.r2Key;
      if (!keyToDelete) {
        // Tìm key theo fileName
        const res = await r2.client.send(
          new ListObjectsV2Command({
            Bucket: r2.bucket,
            Prefix: `${r2.prefix}/`,
          }),
        );
        const match = res.Contents?.find((c) => (c.Key || "").endsWith(params.fileName));
        if (match?.Key) keyToDelete = match.Key;
      }

      if (keyToDelete) {
        await r2.client.send(
          new DeleteObjectCommand({
            Bucket: r2.bucket,
            Key: keyToDelete,
          }),
        );
        deletedR2 = true;
      }
    } catch (err) {
      console.warn(`[File Manager] Lỗi xóa file R2 ${params.fileName}:`, err);
    }
  }

  // 3. Xóa triệt để trong Database (nếu người dùng yêu cầu)
  if (params.purgeDb) {
    try {
      // a. Xóa trong ppc_sync_logs
      const deletedLogs = await sql<{ id: string }[]>`
        DELETE FROM ppc_sync_logs
        WHERE team_id = ${scope.teamId}
          AND (file_name = ${params.fileName} OR file_name LIKE ${`%${params.fileName}%`})
        RETURNING id
      `;
      purgedDbRows.syncLogs = deletedLogs.length;

      // b. Kiểm tra xem tên file có chứa ngày bắt đầu & kết thúc không (ví dụ: 20260819-20260918)
      const dateMatch = params.fileName.match(/(\d{4})(\d{2})(\d{2})-(\d{4})(\d{2})(\d{2})/);
      if (dateMatch) {
        const startIso = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
        const endIso = `${dateMatch[4]}-${dateMatch[5]}-${dateMatch[6]}`;
        const adType = reportAdType(params.fileName);

        const deletedFacts = await sql<{ id: string }[]>`
          DELETE FROM ppc_performance_facts
          WHERE report_start_date = ${startIso}::date
            AND report_end_date = ${endIso}::date
            AND (${adType === "UNKNOWN"} OR ad_type = ${adType})
          RETURNING id
        `;
        purgedDbRows.facts = deletedFacts.length;
      }

      // c. Xóa search terms nếu là file search term có chứa ngày
      const singleDateMatch = params.fileName.match(/(\d{4})(\d{2})(\d{2})/);
      if (singleDateMatch && (params.fileName.toLowerCase().includes("search") || params.fileName.toLowerCase().includes("term"))) {
        const dateIso = `${singleDateMatch[1]}-${singleDateMatch[2]}-${singleDateMatch[3]}`;
        const adType = reportAdType(params.fileName);

        const deletedSt = await sql<{ id: string }[]>`
          DELETE FROM ppc_search_terms
          WHERE (report_date = ${dateIso}::date OR report_end_date = ${dateIso}::date)
            AND (${adType === "UNKNOWN"} OR ad_type = ${adType})
          RETURNING id
        `;
        purgedDbRows.searchTerms = deletedSt.length;
      }
    } catch (err) {
      console.warn(`[File Manager] Lỗi dọn dẹp Database cho file ${params.fileName}:`, err);
    }
  }

  return { deletedServer, deletedR2, purgedDbRows };
}

export interface CleanupR2BatchesResult {
  deletedBatches: string[];
  deletedFilesCount: number;
  freedBytes: number;
}

/**
 * Tự động quét và dọn dẹp các đợt crawl (batch) cũ trên Cloudflare R2
 * Nếu trong cùng 1 ngày, 1 store có đợt crawl mới đã đủ file chuẩn (6/6 file + _COMPLETE.json),
 * các đợt cũ hơn hoặc dở dang của cùng ngày đó sẽ được xóa an toàn khỏi R2.
 */
export async function cleanupDuplicateR2Batches(): Promise<CleanupR2BatchesResult> {
  const r2 = getR2Client();
  if (!r2) throw new Error("Cloudflare R2 chưa được cấu hình.");

  let continuationToken: string | undefined;
  const allObjects: { Key: string; Size: number; LastModified: Date }[] = [];

  do {
    const res = await r2.client.send(
      new ListObjectsV2Command({
        Bucket: r2.bucket,
        Prefix: `${r2.prefix}/input/`,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    );
    for (const obj of res.Contents || []) {
      if (obj.Key) {
        allObjects.push({
          Key: obj.Key,
          Size: obj.Size || 0,
          LastModified: obj.LastModified || new Date(),
        });
      }
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  interface BatchInfo {
    date: string;
    store: string;
    batchId: string;
    keys: { Key: string; Size: number }[];
    hasComplete: boolean;
    reportFilesCount: number;
    lastModified: Date;
  }

  const batchMap = new Map<string, BatchInfo>();
  for (const obj of allObjects) {
    const parts = obj.Key.split("/");
    const inputIdx = parts.findIndex((p) => p.toLowerCase() === "input");
    if (inputIdx >= 0 && parts.length >= inputIdx + 4) {
      const date = parts[inputIdx + 1];
      const store = parts[inputIdx + 2];
      const batchId = parts[inputIdx + 3];
      const groupKey = `${date}::${store.toUpperCase()}::${batchId}`;

      if (!batchMap.has(groupKey)) {
        batchMap.set(groupKey, {
          date,
          store,
          batchId,
          keys: [],
          hasComplete: false,
          reportFilesCount: 0,
          lastModified: obj.LastModified,
        });
      }
      const b = batchMap.get(groupKey)!;
      b.keys.push({ Key: obj.Key, Size: obj.Size });
      if (obj.Key.endsWith("_COMPLETE.json")) {
        b.hasComplete = true;
      } else if (/\.(xlsx|csv)$/i.test(obj.Key)) {
        b.reportFilesCount++;
      }
      if (obj.LastModified > b.lastModified) {
        b.lastModified = obj.LastModified;
      }
    }
  }

  const storeDateGroups = new Map<string, BatchInfo[]>();
  for (const b of batchMap.values()) {
    const key = `${b.date}::${b.store.toUpperCase()}`;
    if (!storeDateGroups.has(key)) storeDateGroups.set(key, []);
    storeDateGroups.get(key)!.push(b);
  }

  const deletedBatches: string[] = [];
  let deletedFilesCount = 0;
  let freedBytes = 0;
  const keysToDelete: { Key: string }[] = [];

  for (const batches of storeDateGroups.values()) {
    batches.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
    const canonicalIndex = batches.findIndex((b) => b.hasComplete && b.reportFilesCount >= 6);

    if (canonicalIndex !== -1) {
      for (let i = 0; i < batches.length; i++) {
        if (i !== canonicalIndex) {
          const obsolete = batches[i];
          deletedBatches.push(`${obsolete.date}/${obsolete.store}/${obsolete.batchId}`);
          for (const item of obsolete.keys) {
            keysToDelete.push({ Key: item.Key });
            deletedFilesCount++;
            freedBytes += item.Size;
          }
        }
      }
    }
  }

  if (keysToDelete.length > 0) {
    for (let i = 0; i < keysToDelete.length; i += 1000) {
      const chunk = keysToDelete.slice(i, i + 1000);
      await r2.client.send(
        new DeleteObjectsCommand({
          Bucket: r2.bucket,
          Delete: {
            Objects: chunk,
            Quiet: true,
          },
        }),
      );
    }
  }

  return {
    deletedBatches,
    deletedFilesCount,
    freedBytes,
  };
}

