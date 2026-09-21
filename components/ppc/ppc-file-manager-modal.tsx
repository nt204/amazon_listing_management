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
            <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
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

        {/* Storage Stats Bar */}
        {stats && (
          <div className="grid grid-cols-3 gap-4 px-6 py-3 bg-slate-50 border-b border-slate-200/70 text-xs">
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
            <div className="relative min-w-[200px] flex-1">
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
                className={`px-2 py-1 rounded-md transition text-xs ${filterAdType === "SP" ? "bg-white shadow-2xs text-purple-700" : "hover:text-slate-900"}`}
              >
                SP
              </button>
              <button
                type="button"
                onClick={() => setFilterAdType("SB")}
                className={`px-2 py-1 rounded-md transition text-xs ${filterAdType === "SB" ? "bg-white shadow-2xs text-sky-700" : "hover:text-slate-900"}`}
              >
                SB
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Location Tabs */}
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-xs font-semibold text-slate-600">
              <button
                type="button"
                onClick={() => setFilterLocation("ALL")}
                className={`px-2.5 py-1 rounded-md transition ${filterLocation === "ALL" ? "bg-white shadow-2xs text-indigo-700" : "hover:text-slate-900"}`}
              >
                Tất cả ({files.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterLocation("SERVER")}
                className={`px-2.5 py-1 rounded-md transition ${filterLocation === "SERVER" ? "bg-white shadow-2xs text-amber-700" : "hover:text-slate-900"}`}
              >
                Server
              </button>
              <button
                type="button"
                onClick={() => setFilterLocation("R2")}
                className={`px-2.5 py-1 rounded-md transition ${filterLocation === "R2" ? "bg-white shadow-2xs text-sky-700" : "hover:text-slate-900"}`}
              >
                R2
              </button>
              <button
                type="button"
                onClick={() => setFilterLocation("DB")}
                className={`px-2.5 py-1 rounded-md transition ${filterLocation === "DB" ? "bg-white shadow-2xs text-indigo-700" : "hover:text-slate-900"}`}
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
              <span>{organizing ? "Đang sắp xếp..." : "Gom thư mục chuẩn"}</span>
            </button>

            {/* Refresh */}
            <button
              type="button"
              onClick={loadFiles}
              disabled={loading}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-600 transition disabled:opacity-50"
            >
              <ArrowsClockwise size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* Bulk Action Controls */}
        <div className="flex items-center justify-between px-6 py-2 bg-slate-50/70 border-b border-slate-200/60 text-xs">
          <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-700 select-none">
            <input
              type="checkbox"
              checked={purgeDb}
              onChange={(e) => setPurgeDb(e.target.checked)}
              className="rounded-sm border-slate-300 text-rose-600 focus:ring-rose-500"
            />
            <span>Đồng thời dọn dẹp các dòng dữ liệu tương ứng trong Database (Facts & Search Terms)</span>
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
              <span>Xóa triệt để {selectedFileIds.size} file đã chọn</span>
            </button>
          )}
        </div>

        {/* File Table */}
        <div className="flex-1 overflow-y-auto min-h-[300px]">
          {loading && files.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-xs">
              <ArrowsClockwise size={28} className="animate-spin mx-auto mb-2 text-indigo-500" />
              Đang quét các file trong hệ thống phân cấp thư mục...
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-xs">
              Không tìm thấy file nào phù hợp với bộ lọc hiện tại.
            </div>
          ) : (
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
                  <th className="p-3">Tên File & Thư Mục Phân Cấp</th>
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

