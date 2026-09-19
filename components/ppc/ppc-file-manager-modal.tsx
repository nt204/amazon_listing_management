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
  FileText,
  CheckCircle,
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
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterLocation, setFilterLocation] = useState<"ALL" | "R2" | "SERVER" | "DB">("ALL");
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [purgeDb, setPurgeDb] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

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

  const filteredFiles = useMemo(() => {
    return files.filter((f) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = f.fileName.toLowerCase().includes(q);
        const matchesStore = f.storeName.toLowerCase().includes(q);
        if (!matchesName && !matchesStore) return false;
      }
      if (filterLocation === "R2" && !f.locations.r2) return false;
      if (filterLocation === "SERVER" && !f.locations.server) return false;
      if (filterLocation === "DB" && !f.locations.database) return false;
      return true;
    });
  }, [files, searchQuery, filterLocation]);

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
      <div className="relative w-full max-w-5xl rounded-2xl bg-white shadow-2xl border border-slate-200 flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
              <FolderSimple size={24} weight="duotone" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Quản Lý File Báo Cáo PPC</h2>
              <p className="text-xs text-slate-500">
                Xóa triệt để file trên Server cục bộ, Cloudflare R2 và làm sạch Database snapshots
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

        {/* Toolbar & Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2 flex-1 max-w-md">
            <div className="relative w-full">
              <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Tìm tên file hoặc tên Store..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Location Filter Tabs */}
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
              onClick={() => setFilterLocation("R2")}
              className={`px-2.5 py-1 rounded-md transition ${filterLocation === "R2" ? "bg-white shadow-2xs text-sky-700" : "hover:text-slate-900"}`}
            >
              Trên R2
            </button>
            <button
              type="button"
              onClick={() => setFilterLocation("SERVER")}
              className={`px-2.5 py-1 rounded-md transition ${filterLocation === "SERVER" ? "bg-white shadow-2xs text-amber-700" : "hover:text-slate-900"}`}
            >
              Trên Server
            </button>
            <button
              type="button"
              onClick={() => setFilterLocation("DB")}
              className={`px-2.5 py-1 rounded-md transition ${filterLocation === "DB" ? "bg-white shadow-2xs text-indigo-700" : "hover:text-slate-900"}`}
            >
              Đã nạp DB
            </button>
          </div>

          <button
            type="button"
            onClick={loadFiles}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-600 transition disabled:opacity-50"
          >
            <ArrowsClockwise size={14} className={loading ? "animate-spin" : ""} />
            <span>Làm mới</span>
          </button>
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
              Đang quét các file trên Server và Cloudflare R2...
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-xs">
              Không tìm thấy file nào phù hợp với bộ lọc.
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-slate-100/90 backdrop-blur-xs text-slate-600 font-bold border-b border-slate-200 z-10">
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
                  <th className="p-3 w-24">Dung Lượng</th>
                  <th className="p-3 w-40">Lưu Trữ Tại</th>
                  <th className="p-3 w-36">Ngày Cập Nhật</th>
                  <th className="p-3 w-20 text-center">Thao Tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredFiles.map((file) => {
                  const isSelected = selectedFileIds.has(file.id);
                  const isCsv = file.fileName.toLowerCase().endsWith(".csv");

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
                        <div className="flex items-center gap-2">
                          {isCsv ? (
                            <FileCsv size={18} className="text-emerald-600 shrink-0" weight="duotone" />
                          ) : (
                            <FileXls size={18} className="text-green-600 shrink-0" weight="duotone" />
                          )}
                          <span className="break-all font-mono text-[11px]">{file.fileName}</span>
                        </div>
                      </td>
                      <td className="p-3 text-slate-600 font-semibold">{file.storeName}</td>
                      <td className="p-3 text-slate-600">{file.sizeBytes > 0 ? formatBytes(file.sizeBytes) : "--"}</td>
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
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold" title={`Đã nạp ${file.locations.dbRecordsCount || 0} dòng`}>
                              <Database size={12} weight="bold" /> DB ({file.locations.dbRecordsCount || 0})
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-slate-500 text-[11px]">
                        {file.lastModified ? new Date(file.lastModified).toLocaleString("vi-VN") : "--"}
                      </td>
                      <td className="p-3 text-center">
                        <button
                          type="button"
                          onClick={() => void handleDelete([file])}
                          disabled={deleting}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                          title="Xóa triệt để file này"
                        >
                          <Trash size={15} />
                        </button>
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
          <div className="text-slate-500">
            Hiển thị <strong className="text-slate-700">{filteredFiles.length}</strong> / {files.length} file
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
