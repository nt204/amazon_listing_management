"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  FolderSimple,
  DownloadSimple,
  ArrowsClockwise,
  MagnifyingGlass,
  CalendarBlank,
  Storefront,
  HardDrives,
  FileText,
  FileCsv,
  CircleNotch,
  CaretDown,
  CaretRight,
} from "@phosphor-icons/react";
import type { ManagedAccountingFile, AccountingFileStats } from "@/lib/accounting/accounting-file-service";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatLastUpdated(isoString?: string): { date: string; time: string; full: string } | null {
  if (!isoString) return null;
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return null;
    const pad = (n: number) => String(n).padStart(2, "0");
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    return { date: dateStr, time: timeStr, full: `${dateStr} ${timeStr}` };
  } catch {
    return null;
  }
}


interface StoreGroup {
  storeName: string;
  files: ManagedAccountingFile[];
  totalBytes: number;
}

interface DateGroup {
  date: string;
  stores: StoreGroup[];
  filesCount: number;
  totalBytes: number;
}

export function AccountingFileManager() {
  const [files, setFiles] = useState<ManagedAccountingFile[]>([]);
  const [stats, setStats] = useState<AccountingFileStats | null>(null);
  const [availableStores, setAvailableStores] = useState<string[]>([]);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [selectedStore, setSelectedStore] = useState<string>("ALL");
  const [selectedDate, setSelectedDate] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Expanded state: mặc định THU GỌN TẤT CẢ (rỗng)
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  // Store là tầng accordion thứ hai: mở ngày chỉ hiện danh sách store, không bung file hàng loạt.
  const [expandedStores, setExpandedStores] = useState<Set<string>>(new Set());


  const fetchFiles = useCallback(async () => {
    try {
      setRefreshing(true);
      const params = new URLSearchParams();
      if (selectedStore !== "ALL") params.append("storeName", selectedStore);
      if (selectedDate !== "ALL") params.append("date", selectedDate);

      const res = await fetch(`/api/accounting/files?${params.toString()}`);
      const json = await res.json();
      if (json.success && json.data) {
        setFiles(json.data.files || []);
        setStats(json.data.stats || null);
        setAvailableStores(json.data.availableStores || []);
        setAvailableDates(json.data.availableDates || []);
      }
    } catch (err) {
      console.error("Lỗi khi tải danh sách file:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedStore, selectedDate]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const filteredFiles = useMemo(() => {
    return files.filter((f) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = f.fileName.toLowerCase().includes(q);
        const matchStore = f.storeName.toLowerCase().includes(q);
        const matchType = f.fileTypeLabel.toLowerCase().includes(q);
        if (!matchName && !matchStore && !matchType) return false;
      }
      return true;
    });
  }, [files, searchQuery]);

  // Tự động mở khi user chọn ngày cụ thể hoặc tìm kiếm
  useEffect(() => {
    if (selectedDate !== "ALL") {
      setExpandedDates(new Set([selectedDate]));
    } else if (searchQuery.trim()) {
      const matchDates = Array.from(new Set(filteredFiles.map((f) => f.reportDate)));
      setExpandedDates(new Set(matchDates));
    }
  }, [selectedDate, searchQuery, filteredFiles]);

  // Gom theo Ngày -> theo Store
  const dateGroups = useMemo<DateGroup[]>(() => {
    const dateMap = new Map<string, Map<string, ManagedAccountingFile[]>>();

    for (const file of filteredFiles) {
      if (!dateMap.has(file.reportDate)) {
        dateMap.set(file.reportDate, new Map());
      }
      const storeMap = dateMap.get(file.reportDate)!;
      if (!storeMap.has(file.storeName)) {
        storeMap.set(file.storeName, []);
      }
      storeMap.get(file.storeName)!.push(file);
    }

    const result: DateGroup[] = [];
    const sortedDates = Array.from(dateMap.keys()).sort().reverse();

    for (const date of sortedDates) {
      const storeMap = dateMap.get(date)!;
      const sortedStores = Array.from(storeMap.keys()).sort();
      const stores: StoreGroup[] = [];
      let dateTotalBytes = 0;
      let dateFilesCount = 0;

      for (const storeName of sortedStores) {
        const storeFiles = storeMap.get(storeName)!;
        storeFiles.sort((a, b) => a.fileTypeCode.localeCompare(b.fileTypeCode));
        const storeBytes = storeFiles.reduce((acc, f) => acc + f.sizeBytes, 0);

        stores.push({
          storeName,
          files: storeFiles,
          totalBytes: storeBytes,
        });

        dateTotalBytes += storeBytes;
        dateFilesCount += storeFiles.length;
      }

      result.push({
        date,
        stores,
        filesCount: dateFilesCount,
        totalBytes: dateTotalBytes,
      });
    }

    return result;
  }, [filteredFiles]);

  const toggleDate = (date: string) => {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
        setExpandedStores((current) =>
          new Set(Array.from(current).filter((key) => !key.startsWith(`${date}::`))),
        );
      } else {
        next.add(date);
      }
      return next;
    });
  };

  const toggleStore = (date: string, storeName: string) => {
    const key = `${date}::${storeName}`;
    setExpandedStores((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const isAllExpanded = dateGroups.length > 0 && dateGroups.every((d) => expandedDates.has(d.date));

  const toggleAllDates = () => {
    if (isAllExpanded) {
      setExpandedDates(new Set());
    } else {
      setExpandedDates(new Set(dateGroups.map((d) => d.date)));
    }
  };

  const handleDownload = async (file: ManagedAccountingFile) => {
    try {
      const res = await fetch(
        `/api/accounting/files/download?r2Key=${encodeURIComponent(file.r2Key)}&fileName=${encodeURIComponent(file.fileName)}`
      );
      const json = await res.json();
      if (json.downloadUrl) {
        window.open(json.downloadUrl, "_blank");
      } else {
        alert("Không thể tải file: " + (json.error || "Lỗi không xác định"));
      }
    } catch (err: any) {
      alert("Lỗi tải file: " + err.message);
    }
  };


  return (
    <div className="w-full max-w-7xl mx-auto space-y-5 animate-in fade-in duration-200">
      {/* Top Header & Stat Cards */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <FolderSimple size={22} weight="duotone" className="text-indigo-600" />
            System Admin — Quản lý File Kế toán
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Quản lý báo cáo tải tự động từ Amazon Seller Central theo từng ngày và từng Store
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleAllDates}
            disabled={dateGroups.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition cursor-pointer"
          >
            {isAllExpanded ? "Thu gọn tất cả" : "Mở rộng tất cả"}
          </button>

          <button
            type="button"
            onClick={fetchFiles}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition cursor-pointer"
          >
            <ArrowsClockwise size={14} className={refreshing ? "animate-spin text-indigo-600" : ""} />
            Làm mới
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white rounded-xl border border-slate-200/80 p-3.5 shadow-2xs flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
              <FileText size={18} weight="duotone" />
            </div>
            <div>
              <div className="text-[11px] font-medium text-slate-500">Tổng file</div>
              <div className="text-base font-bold text-slate-900">{stats.totalFiles}</div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200/80 p-3.5 shadow-2xs flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
              <HardDrives size={18} weight="duotone" />
            </div>
            <div>
              <div className="text-[11px] font-medium text-slate-500">Dung lượng</div>
              <div className="text-base font-bold text-slate-900">{formatBytes(stats.totalBytes)}</div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200/80 p-3.5 shadow-2xs flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-sky-50 border border-sky-100 flex items-center justify-center text-sky-600">
              <Storefront size={18} weight="duotone" />
            </div>
            <div>
              <div className="text-[11px] font-medium text-slate-500">Store có file</div>
              <div className="text-base font-bold text-slate-900">{stats.storesCount}</div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200/80 p-3.5 shadow-2xs flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600">
              <CalendarBlank size={18} weight="duotone" />
            </div>
            <div>
              <div className="text-[11px] font-medium text-slate-500">File mới nhất</div>
              <div className="flex flex-wrap items-baseline gap-1.5">
                <span className="text-base font-bold text-slate-900">{stats.latestDate || "--"}</span>
                {formatLastUpdated(stats.latestModified)?.time && (
                  <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200/80 font-mono">
                    {formatLastUpdated(stats.latestModified)?.time}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}


      {/* Filter Toolbar */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-2xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Store Filter */}
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="font-semibold text-slate-500">Store:</span>
            <select
              value={selectedStore}
              onChange={(e) => setSelectedStore(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="ALL">Tất cả Store</option>
              {availableStores.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Date Filter */}
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="font-semibold text-slate-500">Ngày:</span>
            <select
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="ALL">Tất cả các ngày</option>
              {availableDates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <MagnifyingGlass size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm tên file hoặc store..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>

      {/* Danh sách File gom nhóm theo Ngày -> theo Store */}
      {loading ? (
        <div className="py-16 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-2 bg-white rounded-xl border border-slate-200 shadow-2xs">
          <CircleNotch size={20} className="animate-spin text-indigo-600" />
          Đang tải danh sách file kế toán...
        </div>
      ) : dateGroups.length === 0 ? (
        <div className="py-16 text-center text-xs text-slate-400 bg-white rounded-xl border border-slate-200 shadow-2xs">
          Không tìm thấy file nào phù hợp với bộ lọc.
        </div>
      ) : (
        <div className="space-y-4">
          {dateGroups.map((dateGroup) => {
            const isExpanded = expandedDates.has(dateGroup.date);

            return (
              <div
                key={dateGroup.date}
                className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden transition-all"
              >
                {/* 1. Header Ngày (Date Group Header) */}
                <button
                  type="button"
                  onClick={() => toggleDate(dateGroup.date)}
                  className={`w-full flex items-center justify-between px-5 py-3.5 bg-slate-50/80 hover:bg-slate-100/80 transition text-left cursor-pointer select-none ${
                    isExpanded ? "border-b border-slate-200/90" : ""
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="h-7 w-7 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                      <CalendarBlank size={16} weight="bold" />
                    </div>
                    <div>
                      <span className="text-sm font-bold text-slate-900 tracking-tight">
                        Ngày {dateGroup.date}
                      </span>
                      <span className="ml-2.5 text-[11px] font-semibold text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-full">
                        {dateGroup.filesCount} file
                      </span>
                      <span className="ml-1.5 text-[11px] font-medium text-slate-400">
                        ({formatBytes(dateGroup.totalBytes)})
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                    <span className="bg-slate-100 border border-slate-200/80 px-2 py-0.5 rounded text-[11px]">
                      {dateGroup.stores.length} Store
                    </span>
                    {isExpanded ? (
                      <CaretDown size={14} weight="bold" className="text-slate-600" />
                    ) : (
                      <CaretRight size={14} weight="bold" className="text-slate-400" />
                    )}
                  </div>
                </button>

                {/* 2. Danh sách Store trong Ngày (Chỉ hiển thị khi MỞ RỘNG) */}
                {isExpanded && (
                  <div className="p-4 space-y-4 divide-y divide-slate-100 animate-in fade-in duration-150">
                    {dateGroup.stores.map((storeGroup) => {
                      const storeKey = `${dateGroup.date}::${storeGroup.storeName}`;
                      const isStoreExpanded = expandedStores.has(storeKey);

                      return (
                      <div key={storeGroup.storeName} className="pt-3 first:pt-0 space-y-2">
                        {/* Store Sub-header */}
                        <button
                          type="button"
                          onClick={() => toggleStore(dateGroup.date, storeGroup.storeName)}
                          aria-expanded={isStoreExpanded}
                          className="w-full flex items-center justify-between rounded-md px-1.5 py-1 hover:bg-slate-50 transition text-left cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <Storefront size={15} weight="bold" className="text-slate-500" />
                            <span className="font-bold text-xs text-slate-900 bg-slate-100 border border-slate-200/70 px-2.5 py-0.5 rounded-md">
                              {storeGroup.storeName}
                            </span>
                            <span className="text-[11px] font-medium text-slate-400">
                              {storeGroup.files.length} file • {formatBytes(storeGroup.totalBytes)}
                            </span>
                          </div>
                          {isStoreExpanded ? (
                            <CaretDown size={14} weight="bold" className="text-slate-600" />
                          ) : (
                            <CaretRight size={14} weight="bold" className="text-slate-400" />
                          )}
                        </button>

                        {/* Files Table của Store - Tối giản gọn gàng */}
                        {isStoreExpanded && (
                        <div className="overflow-x-auto rounded-lg border border-slate-200/80 animate-in fade-in duration-150">
                          <table className="w-full text-left text-xs text-slate-700">
                            <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                              <tr>
                                <th className="px-3.5 py-2">Tên file</th>
                                <th className="px-3.5 py-2 text-right w-36">Cập nhật lúc</th>
                                <th className="px-3.5 py-2 text-right w-24">Dung lượng</th>
                                <th className="px-3.5 py-2 text-right w-20">Thao tác</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 bg-white">
                              {storeGroup.files.map((file) => {
                                const fileTime = formatLastUpdated(file.lastModified);
                                return (
                                  <tr key={file.id} className="hover:bg-slate-50/70 transition-colors">
                                    {/* Tên file */}
                                    <td className="px-3.5 py-2 font-mono text-[11.5px] text-slate-800 break-all">
                                      <div className="flex items-center gap-2">
                                        <FileCsv size={15} weight="duotone" className="text-slate-400 shrink-0" />
                                        <span>{file.fileName}</span>
                                      </div>
                                    </td>

                                    {/* Cập nhật lúc */}
                                    <td className="px-3.5 py-2 whitespace-nowrap text-right font-mono text-slate-500 text-[11px]">
                                      {fileTime ? (
                                        <span>
                                          <strong className="text-slate-700 font-semibold">{fileTime.time}</strong>{" "}
                                          <span className="text-slate-400">{fileTime.date}</span>
                                        </span>
                                      ) : (
                                        "--"
                                      )}
                                    </td>

                                    {/* Dung lượng */}
                                    <td className="px-3.5 py-2 whitespace-nowrap text-right font-medium text-slate-500 text-xs">
                                      {formatBytes(file.sizeBytes)}
                                    </td>

                                    {/* Thao tác: Nút Tải về */}
                                    <td className="px-3.5 py-2 whitespace-nowrap text-right">
                                      <button
                                        type="button"
                                        onClick={() => handleDownload(file)}
                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-[11px] transition cursor-pointer"
                                        title="Tải file về máy"
                                      >
                                        <DownloadSimple size={12} weight="bold" />
                                        Tải về
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
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
      )}
    </div>
  );
}
