"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  FolderSimple,
  Trash,
  HardDrives,
  CloudCheck,
  Database,
  MagnifyingGlass,
  X,
  ArrowsClockwise,
  Warning,
  FileXls,
  FileCsv,
  CheckCircle,
  Copy,
  Check,
  Storefront,
  CalendarBlank,
  Lightning,
  CaretDown,
  CaretRight,
  TreeStructure,
  Table,
} from "@phosphor-icons/react";
import type { ManagedPpcFile, PpcStorageStats } from "@/lib/ppc/file-manager";

interface PpcFileManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataChanged?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

interface StoreGroup {
  storeName: string;
  spGroup: ManagedPpcFile[];
  sbGroup: ManagedPpcFile[];
  otherGroup: ManagedPpcFile[];
  files: ManagedPpcFile[];
  totalBytes: number;
}

interface DateGroup {
  date: string;
  stores: StoreGroup[];
  files: ManagedPpcFile[];
  totalBytes: number;
}

export function PpcFileManagerModal({ isOpen, onClose, onDataChanged }: PpcFileManagerModalProps) {
  const [files, setFiles] = useState<ManagedPpcFile[]>([]);
  const [stats, setStats] = useState<PpcStorageStats | null>(null);
  const [localBulkDir, setLocalBulkDir] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterLocation, setFilterLocation] = useState<"ALL" | "R2" | "SERVER" | "DB">("ALL");
  const [filterStore, setFilterStore] = useState<string>("ALL");
  const [filterDate, setFilterDate] = useState<string>("ALL");
  const [filterAdType, setFilterAdType] = useState<"ALL" | "SP" | "SB">("ALL");
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [purgeDb, setPurgeDb] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Chế độ hiển thị: Cây phân cấp (tree) hoặc Bảng phẳng (table)
  const [viewMode, setViewMode] = useState<"tree" | "table">("tree");
  // Mặc định thu gọn lại toàn bộ (không mở ra)
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [expandedStores, setExpandedStores] = useState<Set<string>>(new Set());

  const loadFiles = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await fetch("/api/ppc/files", { cache: "no-store" });
      if (!res.ok) throw new Error("Không thể tải danh sách file");
      const json = await res.json();
      if (json?.data) {
        setFiles(json.data.files || []);
        setStats(json.data.stats || null);
        if (json.data.localBulkDir) {
          setLocalBulkDir(json.data.localBulkDir);
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Lỗi khi tải danh sách file.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void loadFiles();
      setSelectedFileIds(new Set());
      setExpandedDates(new Set());
      setExpandedStores(new Set());
      setErrorMsg(null);
      setSuccessMsg(null);
    }
  }, [isOpen, loadFiles]);

  // Danh sách các Store có trong danh sách file
  const availableStores = useMemo(() => {
    const s = new Set<string>();
    files.forEach((f) => {
      if (f.storeName) s.add(f.storeName);
    });
    return Array.from(s).sort();
  }, [files]);

  // Danh sách các Ngày có trong danh sách file (sắp xếp mới nhất trước)
  const availableDates = useMemo(() => {
    const d = new Set<string>();
    files.forEach((f) => {
      if (f.reportDate) d.add(f.reportDate);
    });
    return Array.from(d).sort((a, b) => b.localeCompare(a));
  }, [files]);

  const filteredFiles = useMemo(() => {
    return files.filter((f) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = f.fileName.toLowerCase().includes(q);
        const matchesStore = f.storeName.toLowerCase().includes(q);
        const matchesFolder = (f.folderPath || "").toLowerCase().includes(q);
        if (!matchesName && !matchesStore && !matchesFolder) return false;
      }
      if (filterStore !== "ALL" && f.storeName.toUpperCase() !== filterStore.toUpperCase()) return false;
      if (filterDate !== "ALL" && f.reportDate !== filterDate) return false;
      if (filterAdType !== "ALL" && f.adType !== filterAdType) return false;
      if (filterLocation === "R2" && !f.locations.r2) return false;
      if (filterLocation === "SERVER" && !f.locations.server) return false;
      if (filterLocation === "DB" && !f.locations.database) return false;
      return true;
    });
  }, [files, searchQuery, filterStore, filterDate, filterAdType, filterLocation]);

  // Cấu trúc phân cấp: Ngày -> Store -> [SP | SB] -> Files
  const hierarchicalData = useMemo<DateGroup[]>(() => {
    const dateMap = new Map<string, Map<string, { SP: ManagedPpcFile[]; SB: ManagedPpcFile[]; OTHER: ManagedPpcFile[] }>>();

    for (const file of filteredFiles) {
      const d = file.reportDate || "Khác";
      const s = file.storeName || "HSOSTORE";
      const type = file.adType === "SB" ? "SB" : file.adType === "SP" ? "SP" : "OTHER";

      if (!dateMap.has(d)) dateMap.set(d, new Map());
      const storeMap = dateMap.get(d)!;

      if (!storeMap.has(s)) {
        storeMap.set(s, { SP: [], SB: [], OTHER: [] });
      }
      const typeGroup = storeMap.get(s)!;
      typeGroup[type].push(file);
    }

    const sortedDates = Array.from(dateMap.keys()).sort((a, b) => b.localeCompare(a));

    return sortedDates.map((date) => {
      const storeMap = dateMap.get(date)!;
      const sortedStores = Array.from(storeMap.keys()).sort();

      const storeGroups: StoreGroup[] = sortedStores.map((storeName) => {
        const g = storeMap.get(storeName)!;
        const allStoreFiles = [...g.SP, ...g.SB, ...g.OTHER];
        return {
          storeName,
          spGroup: g.SP,
          sbGroup: g.SB,
          otherGroup: g.OTHER,
          files: allStoreFiles,
          totalBytes: allStoreFiles.reduce((acc, f) => acc + (f.sizeBytes || 0), 0),
        };
      });

      const allDateFiles = storeGroups.flatMap((sg) => sg.files);
      return {
        date,
        stores: storeGroups,
        files: allDateFiles,
        totalBytes: allDateFiles.reduce((acc, f) => acc + (f.sizeBytes || 0), 0),
      };
    });
  }, [filteredFiles]);

  const toggleSelectAll = () => {
    if (selectedFileIds.size === filteredFiles.length) {
      setSelectedFileIds(new Set());
    } else {
      setSelectedFileIds(new Set(filteredFiles.map((f) => f.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectDate = (dateFiles: ManagedPpcFile[]) => {
    const ids = dateFiles.map((f) => f.id);
    const allSelected = ids.length > 0 && ids.every((id) => selectedFileIds.has(id));
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const toggleSelectStore = (storeFiles: ManagedPpcFile[]) => {
    const ids = storeFiles.map((f) => f.id);
    const allSelected = ids.length > 0 && ids.every((id) => selectedFileIds.has(id));
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const toggleDateExpand = (date: string) => {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const toggleStoreExpand = (key: string) => {
    setExpandedStores((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAll = () => {
    setExpandedDates(new Set(hierarchicalData.map((d) => d.date)));
    setExpandedStores(
      new Set(hierarchicalData.flatMap((d) => d.stores.map((s) => `${d.date}-${s.storeName}`)))
    );
  };

  const collapseAll = () => {
    setExpandedDates(new Set());
    setExpandedStores(new Set());
  };

  const handleCopyPath = (file: ManagedPpcFile) => {
    const targetPath = file.locations.serverPath || (localBulkDir ? `${localBulkDir}/${file.relativePath || file.fileName}` : file.fileName);
    navigator.clipboard.writeText(targetPath);
    setCopiedId(file.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleOrganizeFiles = async () => {
    try {
      setOrganizing(true);
      setErrorMsg(null);
      setSuccessMsg(null);
      const res = await fetch("/api/ppc/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "organize" }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "Không thể sắp xếp thư mục.");
      }

      const json = await res.json();
      setSuccessMsg(json.message || "Đã sắp xếp file vào thư mục [Ngày]/[Store]/[SP|SB]/ thành công!");
      await loadFiles();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Lỗi khi sắp xếp thư mục.");
    } finally {
      setOrganizing(false);
    }
  };

  const handleDelete = async (targetFiles: ManagedPpcFile[]) => {
    if (targetFiles.length === 0) return;

    const count = targetFiles.length;
    const confirmMsg = purgeDb
      ? `Xác nhận xóa vĩnh viễn ${count} file khỏi Server & Cloudflare R2, VÀ đồng thời dọn dẹp các dòng dữ liệu tương ứng trong Database?`
      : `Xác nhận xóa ${count} file khỏi Server & Cloudflare R2 (giữ nguyên dữ liệu đã nạp vào Database)?`;

    if (!window.confirm(confirmMsg)) return;

    try {
      setDeleting(true);
      setErrorMsg(null);
      setSuccessMsg(null);

      const items = targetFiles.map((f) => ({
        fileName: f.fileName,
        serverPath: f.locations.serverPath,
        r2Key: f.locations.r2Key,
      }));

      const res = await fetch("/api/ppc/files", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, purgeDb }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "Không thể xóa file.");
      }

      const json = await res.json();
      setSuccessMsg(`Đã xóa thành công ${json.deletedCount} file!`);
      setSelectedFileIds(new Set());
      await loadFiles();
      if (purgeDb && onDataChanged) {
        onDataChanged();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Lỗi khi xóa file.");
    } finally {
      setDeleting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-6xl rounded-2xl bg-white shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 shadow-2xs">
              <FolderSimple size={24} weight="duotone" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">Quản Lý File Báo Cáo PPC</h2>
                <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold">
                  Phân Cấp: [Ngày] / [Store] / [SP | SB]
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Tự động tổ chức theo ngày, store và loại quảng cáo để dễ dàng tìm kiếm, kiểm tra và dọn dẹp
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
          >
            <X size={20} />
          </button>
        </div>

        {/* Stats Strip */}
        {stats && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 px-6 py-3 bg-slate-50/70 border-b border-slate-100 text-xs">
            <div className="flex items-center gap-2.5 p-2 rounded-lg bg-white border border-slate-200/80 shadow-2xs">
              <HardDrives size={20} className="text-amber-500 shrink-0" weight="duotone" />
              <div>
                <span className="text-slate-500 block">Server Cục Bộ</span>
                <span className="font-bold text-slate-800">
                  {stats.serverFilesCount} files ({formatBytes(stats.serverTotalBytes)})
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2.5 p-2 rounded-lg bg-white border border-slate-200/80 shadow-2xs">
              <CloudCheck size={20} className="text-sky-500 shrink-0" weight="duotone" />
              <div>
                <span className="text-slate-500 block">Cloudflare R2</span>
                <span className="font-bold text-slate-800">
                  {stats.r2FilesCount} files ({formatBytes(stats.r2TotalBytes)})
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2.5 p-2 rounded-lg bg-white border border-slate-200/80 shadow-2xs">
              <Database size={20} className="text-indigo-500 shrink-0" weight="duotone" />
              <div>
                <span className="text-slate-500 block">Lịch Sử Nạp Database</span>
                <span className="font-bold text-slate-800">{stats.dbSyncedFilesCount} đợt đồng bộ</span>
              </div>
            </div>
          </div>
        )}

        {/* Feedback Alert Messages */}
        {errorMsg && (
          <div className="mx-6 mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
            <Warning size={16} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
        {successMsg && (
          <div className="mx-6 mt-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-2">
            <CheckCircle size={16} className="shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Filters & Tools Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b border-slate-100 bg-white">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[320px]">
            {/* Search */}
            <div className="relative min-w-[180px] flex-1">
              <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Tìm tên file, ngày, store..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>

            {/* Store Filter */}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-slate-200 bg-slate-50 text-xs">
              <Storefront size={14} className="text-slate-400" />
              <select
                value={filterStore}
                onChange={(e) => setFilterStore(e.target.value)}
                className="bg-transparent text-slate-700 font-semibold focus:outline-hidden text-xs cursor-pointer"
              >
                <option value="ALL">Tất cả Store ({availableStores.length})</option>
                {availableStores.map((st) => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>
            </div>

            {/* Date Filter */}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-slate-200 bg-slate-50 text-xs">
              <CalendarBlank size={14} className="text-slate-400" />
              <select
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="bg-transparent text-slate-700 font-semibold focus:outline-hidden text-xs cursor-pointer"
              >
                <option value="ALL">Tất cả Ngày ({availableDates.length})</option>
                {availableDates.map((dt) => (
                  <option key={dt} value={dt}>{dt}</option>
                ))}
              </select>
            </div>

            {/* Ad Type Filter */}
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-xs font-semibold text-slate-600">
              <button
                type="button"
                onClick={() => setFilterAdType("ALL")}
                className={`px-2 py-1 rounded-md transition text-xs ${filterAdType === "ALL" ? "bg-white shadow-2xs text-indigo-700" : "hover:text-slate-900"}`}
              >
                Tất cả loại
              </button>
              <button
                type="button"
                onClick={() => setFilterAdType("SP")}
                className={`px-2 py-1 rounded-md transition text-xs ${filterAdType === "SP" ? "bg-white shadow-2xs text-purple-700 font-bold" : "hover:text-slate-900"}`}
              >
                SP
              </button>
              <button
                type="button"
                onClick={() => setFilterAdType("SB")}
                className={`px-2 py-1 rounded-md transition text-xs ${filterAdType === "SB" ? "bg-white shadow-2xs text-sky-700 font-bold" : "hover:text-slate-900"}`}
              >
                SB
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Toggle: Tree vs Flat Table */}
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-xs font-semibold text-slate-600">
              <button
                type="button"
                onClick={() => setViewMode("tree")}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition ${
                  viewMode === "tree" ? "bg-white shadow-2xs text-indigo-700 font-bold" : "hover:text-slate-900"
                }`}
                title="Hiển thị theo cây phân cấp [Ngày] / [Store] / [SP | SB]"
              >
                <TreeStructure size={14} weight="bold" />
                <span>Phân cấp</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode("table")}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition ${
                  viewMode === "table" ? "bg-white shadow-2xs text-indigo-700 font-bold" : "hover:text-slate-900"
                }`}
                title="Hiển thị bảng danh sách phẳng"
              >
                <Table size={14} weight="bold" />
                <span>Bảng</span>
              </button>
            </div>

            {/* Location Tabs */}
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-xs font-semibold text-slate-600">
              <button
                type="button"
                onClick={() => setFilterLocation("ALL")}
                className={`px-2 py-1 rounded-md transition ${filterLocation === "ALL" ? "bg-white shadow-2xs text-indigo-700" : "hover:text-slate-900"}`}
              >
                Tất cả ({files.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterLocation("SERVER")}
                className={`px-2 py-1 rounded-md transition ${filterLocation === "SERVER" ? "bg-white shadow-2xs text-amber-700" : "hover:text-slate-900"}`}
              >
                Server
              </button>
              <button
                type="button"
                onClick={() => setFilterLocation("R2")}
                className={`px-2 py-1 rounded-md transition ${filterLocation === "R2" ? "bg-white shadow-2xs text-sky-700" : "hover:text-slate-900"}`}
              >
                R2
              </button>
              <button
                type="button"
                onClick={() => setFilterLocation("DB")}
                className={`px-2 py-1 rounded-md transition ${filterLocation === "DB" ? "bg-white shadow-2xs text-indigo-700" : "hover:text-slate-900"}`}
              >
                DB
              </button>
            </div>

            {/* Organize Button */}
            <button
              type="button"
              onClick={handleOrganizeFiles}
              disabled={organizing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-bold transition disabled:opacity-50"
              title="Tự động sắp xếp lại các file trong thư mục Downloads/Bulk file theo cấu trúc [Ngày]/[Store]/[SP|SB]/"
            >
              <Lightning size={14} className={organizing ? "animate-spin" : "text-amber-500"} weight="fill" />
              <span>{organizing ? "Đang sắp..." : "Gom chuẩn"}</span>
            </button>

            {/* Refresh */}
            <button
              type="button"
              onClick={loadFiles}
              disabled={loading}
              className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition disabled:opacity-50"
              title="Làm mới danh sách"
            >
              <ArrowsClockwise size={15} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* Bulk Action Controls */}
        <div className="flex items-center justify-between px-6 py-2 bg-slate-50/70 border-b border-slate-200/60 text-xs">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-700 select-none">
              <input
                type="checkbox"
                checked={selectedFileIds.size > 0 && selectedFileIds.size === filteredFiles.length}
                onChange={toggleSelectAll}
                className="rounded-sm border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span>
                Chọn tất cả ({selectedFileIds.size}/{filteredFiles.length} file)
              </span>
            </label>

            {viewMode === "tree" && (
              <div className="flex items-center gap-1.5 border-l border-slate-200 pl-3">
                <button
                  type="button"
                  onClick={expandAll}
                  className="px-2 py-0.5 rounded text-[11px] text-slate-600 hover:text-indigo-600 hover:bg-slate-100 font-medium"
                >
                  Mở tất cả
                </button>
                <span className="text-slate-300">•</span>
                <button
                  type="button"
                  onClick={collapseAll}
                  className="px-2 py-0.5 rounded text-[11px] text-slate-600 hover:text-indigo-600 hover:bg-slate-100 font-medium"
                >
                  Thu gọn tất cả
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 cursor-pointer text-slate-600 select-none text-[11px]">
              <input
                type="checkbox"
                checked={purgeDb}
                onChange={(e) => setPurgeDb(e.target.checked)}
                className="rounded-sm border-slate-300 text-rose-600 focus:ring-rose-500"
              />
              <span>Đồng thời dọn dẹp các dòng dữ liệu tương ứng trong Database</span>
            </label>

            {selectedFileIds.size > 0 && (
              <button
                type="button"
                onClick={() => {
                  const selected = files.filter((f) => selectedFileIds.has(f.id));
                  void handleDelete(selected);
                }}
                disabled={deleting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs transition shadow-2xs disabled:opacity-50"
              >
                <Trash size={14} weight="bold" />
                <span>Xóa {selectedFileIds.size} file đã chọn</span>
              </button>
            )}
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto min-h-[300px] p-6 bg-slate-50/30">
          {loading && files.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-xs">
              <ArrowsClockwise size={28} className="animate-spin mx-auto mb-2 text-indigo-500" />
              Đang quét các file trong hệ thống phân cấp thư mục...
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-xs">
              Không tìm thấy file nào phù hợp với bộ lọc hiện tại.
            </div>
          ) : viewMode === "tree" ? (
            /* ============================================================== */
            /* CHẾ ĐỘ HIỂN THỊ CÂY PHÂN CẤP: [NGÀY] -> [STORE] -> [SP | SB]   */
            /* ============================================================== */
            <div className="space-y-4">
              {hierarchicalData.map((dateGroup) => {
                const isDateExpanded = expandedDates.has(dateGroup.date) || Boolean(searchQuery.trim());
                const isDateAllSelected =
                  dateGroup.files.length > 0 &&
                  dateGroup.files.every((f) => selectedFileIds.has(f.id));

                return (
                  <div
                    key={dateGroup.date}
                    className="rounded-xl border border-slate-200/90 bg-white shadow-2xs overflow-hidden transition"
                  >
                    {/* Level 1: Ngày (Date Header) */}
                    <div
                      onClick={() => toggleDateExpand(dateGroup.date)}
                      className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-slate-100/90 to-slate-50 border-b border-slate-200/70 select-none cursor-pointer hover:bg-slate-100 transition"
                    >
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleDateExpand(dateGroup.date);
                          }}
                          className="p-1 rounded-md hover:bg-slate-200/70 text-slate-600 transition"
                        >
                          {isDateExpanded ? (
                            <CaretDown size={16} weight="bold" />
                          ) : (
                            <CaretRight size={16} weight="bold" />
                          )}
                        </button>

                        <input
                          type="checkbox"
                          checked={isDateAllSelected}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleSelectDate(dateGroup.files);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="rounded-sm border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />

                        <div className="flex items-center gap-2">
                          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-200/80 text-indigo-800 font-mono text-xs font-bold shadow-2xs">
                            <CalendarBlank size={14} className="text-indigo-600" weight="bold" />
                            {dateGroup.date}
                          </span>
                          <span className="text-[11px] text-slate-500 font-medium">
                            ({dateGroup.stores.length} store • {dateGroup.files.length} file • {formatBytes(dateGroup.totalBytes)})
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Stores inside Date */}
                    {isDateExpanded && (
                      <div className="p-3.5 space-y-3.5 bg-slate-50/40">
                        {dateGroup.stores.map((storeGroup) => {
                          const storeKey = `${dateGroup.date}-${storeGroup.storeName}`;
                          const isStoreExpanded = expandedStores.has(storeKey) || Boolean(searchQuery.trim());
                          const isStoreAllSelected =
                            storeGroup.files.length > 0 &&
                            storeGroup.files.every((f) => selectedFileIds.has(f.id));

                          return (
                            <div
                              key={storeGroup.storeName}
                              className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden"
                            >
                              {/* Level 2: Store Header */}
                              <div
                                onClick={() => toggleStoreExpand(storeKey)}
                                className="flex items-center justify-between px-3.5 py-2.5 bg-slate-50/80 border-b border-slate-200/60 select-none cursor-pointer hover:bg-slate-100/80 transition"
                              >
                                <div className="flex items-center gap-2.5">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleStoreExpand(storeKey);
                                    }}
                                    className="p-0.5 rounded hover:bg-slate-200/70 text-slate-500 transition"
                                  >
                                    {isStoreExpanded ? (
                                      <CaretDown size={14} weight="bold" />
                                    ) : (
                                      <CaretRight size={14} weight="bold" />
                                    )}
                                  </button>

                                  <input
                                    type="checkbox"
                                    checked={isStoreAllSelected}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      toggleSelectStore(storeGroup.files);
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="rounded-sm border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                  />

                                  <div className="flex items-center gap-2">
                                    <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-slate-800 text-white font-mono text-[11px] font-bold shadow-2xs tracking-wide">
                                      <Storefront size={13} weight="fill" className="text-amber-400" />
                                      {storeGroup.storeName}
                                    </span>
                                    <span className="text-[11px] text-slate-500">
                                      {storeGroup.files.length} file ({formatBytes(storeGroup.totalBytes)})
                                    </span>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2">
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                                    SP: {storeGroup.spGroup.length}
                                  </span>
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200">
                                    SB: {storeGroup.sbGroup.length}
                                  </span>
                                </div>
                              </div>

                              {/* Level 3: Ad Types (SP & SB) */}
                              {isStoreExpanded && (
                                <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3 bg-white">
                                  {/* Cột SP (Sponsored Products) */}
                                  <div className="rounded-lg border border-purple-100 bg-purple-50/20 p-2.5">
                                    <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-purple-100">
                                      <div className="flex items-center gap-1.5">
                                        <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-purple-100 text-purple-800 border border-purple-200">
                                          SP
                                        </span>
                                        <span className="text-xs font-bold text-slate-800">
                                          Sponsored Products
                                        </span>
                                      </div>
                                      <span className="text-[10px] font-semibold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded">
                                        {storeGroup.spGroup.length} file
                                      </span>
                                    </div>

                                    {storeGroup.spGroup.length === 0 ? (
                                      <div className="p-4 text-center text-slate-400 text-[11px]">
                                        Chưa có file SP nào
                                      </div>
                                    ) : (
                                      <div className="space-y-1.5">
                                        {storeGroup.spGroup.map((file) => (
                                          <TreeFileItem
                                            key={file.id}
                                            file={file}
                                            isSelected={selectedFileIds.has(file.id)}
                                            onToggleSelect={() => toggleSelect(file.id)}
                                            onCopyPath={() => handleCopyPath(file)}
                                            isCopied={copiedId === file.id}
                                            onDelete={() => void handleDelete([file])}
                                            deleting={deleting}
                                          />
                                        ))}
                                      </div>
                                    )}
                                  </div>

                                  {/* Cột SB (Sponsored Brands) */}
                                  <div className="rounded-lg border border-sky-100 bg-sky-50/20 p-2.5">
                                    <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-sky-100">
                                      <div className="flex items-center gap-1.5">
                                        <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-sky-100 text-sky-800 border border-sky-200">
                                          SB
                                        </span>
                                        <span className="text-xs font-bold text-slate-800">
                                          Sponsored Brands
                                        </span>
                                      </div>
                                      <span className="text-[10px] font-semibold text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded">
                                        {storeGroup.sbGroup.length} file
                                      </span>
                                    </div>

                                    {storeGroup.sbGroup.length === 0 ? (
                                      <div className="p-4 text-center text-slate-400 text-[11px]">
                                        Chưa có file SB nào
                                      </div>
                                    ) : (
                                      <div className="space-y-1.5">
                                        {storeGroup.sbGroup.map((file) => (
                                          <TreeFileItem
                                            key={file.id}
                                            file={file}
                                            isSelected={selectedFileIds.has(file.id)}
                                            onToggleSelect={() => toggleSelect(file.id)}
                                            onCopyPath={() => handleCopyPath(file)}
                                            isCopied={copiedId === file.id}
                                            onDelete={() => void handleDelete([file])}
                                            deleting={deleting}
                                          />
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            /* ============================================================== */
            /* CHẾ ĐỘ HIỂN THỊ DẠNG BẢNG PHẲNG (FLAT TABLE)                   */
            /* ============================================================== */
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 bg-slate-100/95 backdrop-blur-xs text-slate-600 font-bold border-b border-slate-200 z-10">
                  <tr>
                    <th className="p-3 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={selectedFileIds.size > 0 && selectedFileIds.size === filteredFiles.length}
                        onChange={toggleSelectAll}
                        className="rounded-sm border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </th>
                    <th className="p-3">Tên File</th>
                    <th className="p-3 w-28">Store</th>
                    <th className="p-3 w-20">Loại Ad</th>
                    <th className="p-3 w-24">Dung Lượng</th>
                    <th className="p-3 w-36">Lưu Trữ Tại</th>
                    <th className="p-3 w-32">Ngày Cập Nhật</th>
                    <th className="p-3 w-24 text-center">Thao Tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredFiles.map((file) => {
                    const isSelected = selectedFileIds.has(file.id);
                    const isCsv = file.fileName.toLowerCase().endsWith(".csv");
                    const isCopied = copiedId === file.id;
                    const folderDisplay = file.folderPath || (file.reportDate && file.storeName && file.adType ? `${file.reportDate}/${file.storeName}/${file.adType}` : "");

                    return (
                      <tr
                        key={file.id}
                        className={`hover:bg-slate-50/80 transition ${isSelected ? "bg-indigo-50/40" : ""}`}
                      >
                        <td className="p-3 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(file.id)}
                            className="rounded-sm border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                        </td>
                        <td className="p-3 font-medium text-slate-800">
                          <div className="flex items-start gap-2">
                            {isCsv ? (
                              <FileCsv size={18} className="text-emerald-600 shrink-0 mt-0.5" weight="duotone" />
                            ) : (
                              <FileXls size={18} className="text-green-600 shrink-0 mt-0.5" weight="duotone" />
                            )}
                            <div className="min-w-0">
                              <span className="break-all font-mono text-[11px] font-semibold text-slate-900 block">
                                {file.fileName}
                              </span>
                              {folderDisplay && (
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 font-mono text-[10px] font-medium border border-slate-200">
                                    📁 {folderDisplay}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="p-3">
                          <span className="font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                            {file.storeName}
                          </span>
                        </td>
                        <td className="p-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                              file.adType === "SB"
                                ? "bg-sky-50 text-sky-700 border border-sky-200"
                                : "bg-purple-50 text-purple-700 border border-purple-200"
                            }`}
                          >
                            {file.adType || "SP"}
                          </span>
                        </td>
                        <td className="p-3 text-slate-600 font-mono text-[11px]">
                          {file.sizeBytes > 0 ? formatBytes(file.sizeBytes) : "--"}
                        </td>
                        <td className="p-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {file.locations.r2 && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-sky-50 text-sky-700 border border-sky-200 text-[10px] font-bold">
                                <CloudCheck size={12} weight="bold" /> R2
                              </span>
                            )}
                            {file.locations.server && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold">
                                <HardDrives size={12} weight="bold" /> Server
                              </span>
                            )}
                            {file.locations.database && (
                              <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold"
                                title={`Đã nạp ${file.locations.dbRecordsCount || 0} dòng`}
                              >
                                <Database size={12} weight="bold" /> DB ({file.locations.dbRecordsCount || 0})
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3 text-slate-500 text-[11px]">
                          {file.lastModified ? new Date(file.lastModified).toLocaleString("vi-VN") : "--"}
                        </td>
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleCopyPath(file)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition"
                              title="Sao chép đường dẫn file trên máy"
                            >
                              {isCopied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDelete([file])}
                              disabled={deleting}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                              title="Xóa triệt để file này"
                            >
                              <Trash size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-100 bg-slate-50/50 text-xs">
          <div className="flex items-center gap-2 text-slate-500">
            <span>
              Hiển thị <strong className="text-slate-700">{filteredFiles.length}</strong> / {files.length} file
            </span>
            {localBulkDir && (
              <span className="text-slate-400 hidden sm:inline">
                • Thư mục gốc: <code className="bg-slate-100 px-1 py-0.5 rounded text-[11px] text-slate-600">{localBulkDir}</code>
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 font-bold text-slate-700 transition"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Thành phần hiển thị 1 file trong cây phân cấp
 */
function TreeFileItem({
  file,
  isSelected,
  onToggleSelect,
  onCopyPath,
  isCopied,
  onDelete,
  deleting,
}: {
  file: ManagedPpcFile;
  isSelected: boolean;
  onToggleSelect: () => void;
  onCopyPath: () => void;
  isCopied: boolean;
  onDelete: () => void;
  deleting: boolean;
}) {
  const isCsv = file.fileName.toLowerCase().endsWith(".csv");

  return (
    <div
      className={`group flex items-center justify-between p-2 rounded-lg border transition ${
        isSelected
          ? "bg-indigo-50/70 border-indigo-200 shadow-2xs"
          : "bg-white border-slate-200/80 hover:border-slate-300 hover:shadow-2xs"
      }`}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          className="rounded-sm border-slate-300 text-indigo-600 focus:ring-indigo-500"
        />

        {isCsv ? (
          <FileCsv size={16} className="text-emerald-600 shrink-0" weight="duotone" />
        ) : (
          <FileXls size={16} className="text-green-600 shrink-0" weight="duotone" />
        )}

        <div className="min-w-0 flex-1 pr-2">
          <span className="font-mono text-[11px] font-semibold text-slate-900 block truncate" title={file.fileName}>
            {file.fileName}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <span className="font-mono text-[10px] text-slate-500 font-semibold">
          {file.sizeBytes > 0 ? formatBytes(file.sizeBytes) : "--"}
        </span>

        {/* Location Badges */}
        <div className="flex items-center gap-1">
          {file.locations.r2 && (
            <span
              className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200 text-[9px] font-bold"
              title="Đã lưu trên Cloudflare R2"
            >
              <CloudCheck size={11} weight="bold" /> R2
            </span>
          )}
          {file.locations.server && (
            <span
              className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[9px] font-bold"
              title="Đã lưu trên Server máy chủ"
            >
              <HardDrives size={11} weight="bold" /> Server
            </span>
          )}
          {file.locations.database && (
            <span
              className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 text-[9px] font-bold"
              title={`Đã nạp vào DB (${file.locations.dbRecordsCount || 0} dòng)`}
            >
              <Database size={11} weight="bold" /> DB
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 opacity-80 group-hover:opacity-100 transition">
          <button
            type="button"
            onClick={onCopyPath}
            className="p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition"
            title="Sao chép đường dẫn file"
          >
            {isCopied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
            title="Xóa file này"
          >
            <Trash size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
