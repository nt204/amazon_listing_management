"use client";

import { useState, useEffect, useCallback, useTransition, useRef } from "react";
import {
  Bell,
  CheckCircle,
  WarningCircle,
  DownloadSimple,
  Database,
  CloudCheck,
  UploadSimple,
  ArrowsClockwise,
  Trash,
  X,
  CaretRight,
  Info,
} from "@phosphor-icons/react";
import type { PpcSyncLog, PpcSyncSource, PpcSyncStatus } from "@/lib/ppc/repository";

interface PpcNotificationPopoverProps {
  onRefreshParent?: () => void;
}

interface LogStats {
  total: number;
  success: number;
  failed: number;
  running: number;
  lastSyncTime: string | null;
}

function timeAgo(isoString: string | null): string {
  if (!isoString) return "";
  try {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 45) return "Vừa xong";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} phút trước`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour} giờ trước`;
    const diffDays = Math.floor(diffHour / 24);
    if (diffDays < 7) return `${diffDays} ngày trước`;
    return new Date(isoString).toLocaleDateString("vi-VN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function getSourceMeta(source: PpcSyncSource) {
  switch (source) {
    case "ADSPOWER_DOWNLOAD":
      return {
        label: "Amazon Download",
        icon: DownloadSimple,
        color: "text-blue-600 bg-blue-50 border-blue-200",
      };
    case "DATA_INGEST":
      return {
        label: "Nạp Database",
        icon: Database,
        color: "text-purple-600 bg-purple-50 border-purple-200",
      };
    case "CLOUDFLARE_R2":
      return {
        label: "Lưu trữ R2",
        icon: CloudCheck,
        color: "text-sky-600 bg-sky-50 border-sky-200",
      };
    case "MANUAL_UPLOAD":
      return {
        label: "Nạp thủ công",
        icon: UploadSimple,
        color: "text-amber-600 bg-amber-50 border-amber-200",
      };
    default:
      return {
        label: "Hệ thống",
        icon: Info,
        color: "text-slate-600 bg-slate-50 border-slate-200",
      };
  }
}

export function PpcNotificationPopover({ onRefreshParent }: PpcNotificationPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [logs, setLogs] = useState<PpcSyncLog[]>([]);
  const [stats, setStats] = useState<LogStats>({
    total: 0,
    success: 0,
    failed: 0,
    running: 0,
    lastSyncTime: null,
  });
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState<"ALL" | "DOWNLOAD" | "INGEST" | "FAILED">("ALL");
  const [hasUnreadAlert, setHasUnreadAlert] = useState(false);
  const [isPending, startTransition] = useTransition();
  const popoverRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const res = await fetch("/api/ppc/logs?limit=50", { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        const incomingLogs: PpcSyncLog[] = json.data || [];
        setLogs(incomingLogs);
        if (json.stats) {
          setStats(json.stats);
          if (json.stats.failed > 0) {
            setHasUnreadAlert(true);
          }
        }
      }
    } catch (err) {
      console.error("Lỗi lấy nhật ký PPC:", err);
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs(true);
    const interval = setInterval(() => {
      fetchLogs(true);
    }, 15000); // Polling mỗi 15s để bắt trạng thái download/ingest mới nhất
    return () => clearInterval(interval);
  }, [fetchLogs]);

  // Đóng khi click ra ngoài
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handleClearLogs = async () => {
    if (!confirm("Bạn có chắc muốn làm sạch toàn bộ nhật ký đồng bộ & nạp file này?")) return;
    try {
      const res = await fetch("/api/ppc/logs", { method: "DELETE" });
      if (res.ok) {
        setLogs([]);
        setStats({ total: 0, success: 0, failed: 0, running: 0, lastSyncTime: null });
        setHasUnreadAlert(false);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const filteredLogs = logs.filter((log) => {
    if (filterType === "FAILED") return log.status === "FAILED";
    if (filterType === "DOWNLOAD") return log.source === "ADSPOWER_DOWNLOAD";
    if (filterType === "INGEST") return log.source === "DATA_INGEST";
    return true;
  });

  return (
    <div className="relative inline-block" ref={popoverRef}>
      {/* Nút Chuông Kích hoạt */}
      <button
        type="button"
        onClick={() => {
          setIsOpen((prev) => !prev);
          setHasUnreadAlert(false);
          if (!isOpen) fetchLogs();
        }}
        className={`relative flex items-center justify-center rounded-lg border p-2 transition cursor-pointer ${
          isOpen
            ? "border-indigo-400 bg-indigo-50 text-indigo-700 shadow-xs"
            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 shadow-2xs"
        }`}
        title="Nhật ký & Thông báo trạng thái PPC (Download, Upload, Nạp dữ liệu)"
      >
        <Bell size={16} weight={stats.failed > 0 || hasUnreadAlert ? "fill" : "bold"} />

        {/* Badge trạng thái */}
        {stats.failed > 0 ? (
          <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-600 text-[9px] font-bold text-white shadow-xs animate-bounce">
            {stats.failed}
          </span>
        ) : stats.running > 0 ? (
          <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
          </span>
        ) : stats.total > 0 ? (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-emerald-600 text-[9px] font-bold text-white shadow-xs">
            {stats.total > 99 ? "99+" : stats.total}
          </span>
        ) : null}
      </button>

      {/* Popover Danh sách Thông báo & Nhật ký */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 z-50 w-[380px] sm:w-[440px] rounded-2xl border border-slate-200 bg-white p-0 shadow-2xl animate-in fade-in zoom-in-95 duration-150 text-slate-800">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 bg-slate-50/60 rounded-t-2xl">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                <Bell size={16} weight="bold" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-900 leading-tight">Nhật ký & Thông báo PPC</h4>
                <p className="text-[10px] text-slate-500 font-medium">
                  Trạng thái tải file, nạp database và đồng bộ hệ thống
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => fetchLogs()}
                disabled={loading}
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-200/70 hover:text-slate-800 transition cursor-pointer"
                title="Làm mới danh sách log"
              >
                <ArrowsClockwise size={13} className={loading ? "animate-spin" : ""} weight="bold" />
              </button>
              {logs.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearLogs}
                  className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
                  title="Xóa toàn bộ lịch sử log"
                >
                  <Trash size={13} weight="bold" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-200/70 hover:text-slate-800 transition cursor-pointer"
              >
                <X size={13} weight="bold" />
              </button>
            </div>
          </div>

          {/* Quick Stats Bar */}
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2 text-[11px] bg-white">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-500">
                Tổng: <b className="text-slate-900">{stats.total}</b>
              </span>
              <span className="text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">
                ✓ {stats.success}
              </span>
              {stats.failed > 0 && (
                <span className="text-rose-700 font-bold bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100">
                  ✕ {stats.failed} lỗi
                </span>
              )}
              {stats.running > 0 && (
                <span className="text-amber-700 font-bold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100 animate-pulse">
                  ⏳ {stats.running} đang chạy
                </span>
              )}
            </div>
            {stats.lastSyncTime && (
              <span className="text-[10px] text-slate-400 font-medium">
                Gần nhất: {timeAgo(stats.lastSyncTime)}
              </span>
            )}
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-1 border-b border-slate-100 px-4 py-1.5 bg-slate-50/40 text-[11px]">
            <button
              type="button"
              onClick={() => setFilterType("ALL")}
              className={`px-2 py-0.5 rounded-md font-bold transition cursor-pointer ${
                filterType === "ALL" ? "bg-white text-indigo-700 shadow-2xs border border-slate-200" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Tất cả ({logs.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterType("DOWNLOAD")}
              className={`px-2 py-0.5 rounded-md font-bold transition cursor-pointer ${
                filterType === "DOWNLOAD" ? "bg-white text-blue-700 shadow-2xs border border-slate-200" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Tải về ({logs.filter((l) => l.source === "ADSPOWER_DOWNLOAD").length})
            </button>
            <button
              type="button"
              onClick={() => setFilterType("INGEST")}
              className={`px-2 py-0.5 rounded-md font-bold transition cursor-pointer ${
                filterType === "INGEST" ? "bg-white text-purple-700 shadow-2xs border border-slate-200" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Nạp DB ({logs.filter((l) => l.source === "DATA_INGEST").length})
            </button>
            {stats.failed > 0 && (
              <button
                type="button"
                onClick={() => setFilterType("FAILED")}
                className={`px-2 py-0.5 rounded-md font-bold transition cursor-pointer ${
                  filterType === "FAILED" ? "bg-rose-100 text-rose-800 shadow-2xs border border-rose-200" : "text-rose-600 hover:text-rose-800"
                }`}
              >
                Lỗi ({stats.failed})
              </button>
            )}
          </div>

          {/* Danh sách Logs */}
          <div className="max-h-[380px] overflow-y-auto divide-y divide-slate-100 p-2 space-y-1">
            {loading && logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-2">
                <ArrowsClockwise size={20} className="animate-spin text-indigo-600" />
                <span className="text-xs">Đang tải nhật ký...</span>
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400 mb-2">
                  <CheckCircle size={24} weight="duotone" />
                </div>
                <p className="text-xs font-bold text-slate-700">Chưa có thông báo nào</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Các tiến trình tải file Amazon, lưu R2 và nạp dữ liệu Database sẽ được lưu tại đây.
                </p>
              </div>
            ) : (
              filteredLogs.map((log) => {
                const meta = getSourceMeta(log.source);
                const IconComponent = meta.icon;
                const isFailed = log.status === "FAILED";
                const isRunning = log.status === "RUNNING";

                return (
                  <div
                    key={log.id}
                    className={`rounded-xl p-2.5 transition border ${
                      isFailed
                        ? "bg-rose-50/50 border-rose-200 hover:bg-rose-50"
                        : isRunning
                          ? "bg-amber-50/50 border-amber-200 hover:bg-amber-50"
                          : "bg-white border-slate-100 hover:bg-slate-50/80 hover:border-slate-200"
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      {/* Icon */}
                      <div
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-xs mt-0.5 ${
                          isFailed
                            ? "bg-rose-100 text-rose-700 border-rose-200"
                            : isRunning
                              ? "bg-amber-100 text-amber-700 border-amber-200 animate-pulse"
                              : meta.color
                        }`}
                      >
                        {isFailed ? (
                          <WarningCircle size={15} weight="bold" />
                        ) : isRunning ? (
                          <ArrowsClockwise size={14} className="animate-spin" weight="bold" />
                        ) : (
                          <IconComponent size={14} weight="bold" />
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <span
                            className={`text-[10px] font-extrabold uppercase tracking-wider px-1.5 py-0.2 rounded border ${
                              isFailed
                                ? "bg-rose-100 text-rose-800 border-rose-200"
                                : isRunning
                                  ? "bg-amber-100 text-amber-800 border-amber-200"
                                  : "bg-slate-100 text-slate-600 border-slate-200"
                            }`}
                          >
                            {meta.label}
                          </span>
                          <span className="text-[10px] text-slate-400 shrink-0 font-medium">
                            {timeAgo(log.time)}
                          </span>
                        </div>

                        {/* File name nếu có */}
                        {log.fileName && (
                          <p className="text-xs font-bold text-slate-800 truncate" title={log.fileName}>
                            {log.fileName}
                          </p>
                        )}

                        {/* Message chi tiết */}
                        <p
                          className={`text-[11px] leading-relaxed line-clamp-2 mt-0.5 ${
                            isFailed ? "text-rose-700 font-medium" : "text-slate-600"
                          }`}
                        >
                          {log.message || (isFailed ? "Tác vụ thất bại" : "Hoàn tất thành công")}
                        </p>

                        {/* Count badge nếu có */}
                        {log.count > 0 && (
                          <div className="mt-1 flex items-center gap-1 text-[10px] font-bold text-emerald-700">
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            <span>{log.count.toLocaleString()} bản ghi</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 bg-slate-50/50 rounded-b-2xl text-[11px]">
            <span className="text-slate-400">Tự động cập nhật mỗi 15s</span>
            {onRefreshParent && (
              <button
                type="button"
                onClick={() => {
                  onRefreshParent();
                  setIsOpen(false);
                }}
                className="font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
              >
                <span>Tải lại Dashboard</span>
                <CaretRight size={11} weight="bold" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
