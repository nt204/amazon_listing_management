import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const LOCAL_BULK_DIR = path.join(os.homedir(), "Downloads", "Bulk file");

function detectFileType(fileName: string): "BULK_SP" | "BULK_SB" | "SEARCH_TERM_SP" | "SEARCH_TERM_SB" | "BULK_EXPORT" | "OTHER" {
  const lower = fileName.toLowerCase();
  const isSearchTerm = lower.includes("search") || lower.includes("term") || lower.includes("str");
  const isSb = lower.includes("sb") || lower.includes("brand");
  const isBulkExport = lower.includes("bulk_export") || lower.includes("bulksheet_update");

  if (isBulkExport) return "BULK_EXPORT";
  if (isSearchTerm) return isSb ? "SEARCH_TERM_SB" : "SEARCH_TERM_SP";
  if (isSb) return "BULK_SB";
  return "BULK_SP";
}

function parseReportMetadata(fileName: string, relativeOrFullPath?: string) {
  const fileType = detectFileType(fileName);
  const adType: "SP" | "SB" =
    fileType === "BULK_SB" || fileType === "SEARCH_TERM_SB" || /_SB_|\bSB\b/i.test(fileName)
      ? "SB"
      : "SP";

  let storeName = "HSOSTORE";
  if (relativeOrFullPath) {
    const parts = relativeOrFullPath.split(path.sep);
    for (const p of parts) {
      if (/warmstorey/i.test(p)) {
        storeName = "Warmstorey";
        break;
      }
      if (/hsostore/i.test(p)) {
        storeName = "HSOSTORE";
        break;
      }
    }
  }
  if (fileName.toUpperCase().includes("WARMSTOREY")) {
    storeName = "Warmstorey";
  } else if (fileName.toUpperCase().includes("HSOSTORE")) {
    storeName = "HSOSTORE";
  }

  let reportDate = "";
  if (relativeOrFullPath) {
    const parts = relativeOrFullPath.split(path.sep);
    for (const p of parts) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(p)) {
        reportDate = p;
        break;
      }
    }
  }

  if (!reportDate) {
    const rangeMatch = fileName.match(/(\d{4})(\d{2})(\d{2})-(\d{4})(\d{2})(\d{2})/);
    if (rangeMatch) {
      reportDate = `${rangeMatch[4]}-${rangeMatch[5]}-${rangeMatch[6]}`;
    } else {
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

  return { reportDate, storeName, adType, fileType };
}

function findFilesRecursively(dir: string, maxDepth = 5, currentDepth = 0): string[] {
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
    console.warn("Lỗi đọc thư mục:", dir, e);
  }
  return results;
}

function cleanEmptyParentDirs(dir: string, stopDir: string) {
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

export function organizeAllFiles(baseDir = LOCAL_BULK_DIR) {
  console.log(`[Organize] Bắt đầu quét thư mục: ${baseDir}`);
  if (!fs.existsSync(baseDir)) {
    console.error(`Thư mục không tồn tại: ${baseDir}`);
    return;
  }

  const allFiles = findFilesRecursively(baseDir, 5);
  console.log(`[Organize] Tìm thấy ${allFiles.length} file.`);
  let moved = 0;

  for (const filePath of allFiles) {
    const fileName = path.basename(filePath);
    if (fileName.startsWith(".") || fileName.endsWith(".crdownload")) continue;

    const relPath = path.relative(baseDir, filePath);
    const parts = relPath.split(path.sep);

    // [YYYY-MM-DD]/[Store]/[SP|SB]/[fileName]
    const isAlreadyOrganized =
      parts.length === 4 &&
      /^\d{4}-\d{2}-\d{2}$/.test(parts[0]) &&
      Boolean(parts[1]) &&
      (parts[2] === "SP" || parts[2] === "SB");

    if (isAlreadyOrganized) {
      console.log(`[OK] Đã đúng cấu trúc: ${relPath}`);
      continue;
    }

    const meta = parseReportMetadata(fileName, relPath);
    const targetDir = path.join(baseDir, meta.reportDate, meta.storeName, meta.adType);
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
      console.log(`[DI CHUYỂN] ${fileName} -> ${path.relative(baseDir, targetPath)}`);
      moved++;
    }
  }

  console.log(`\n🎉 Hoàn thành! Đã phân loại ${moved} file vào cấu trúc: [Ngày]/[Store]/[SP|SB]/`);
}

organizeAllFiles();
