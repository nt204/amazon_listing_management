"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  X,
  ArrowsClockwise,
  CheckCircle,
  WarningCircle,
  Desktop,
  Lightning,
  CloudArrowUp,
  StopCircle,
  PlayCircle,
  FileText,
  Trash,
} from "@phosphor-icons/react";

interface ReportTaskItem {
  id: string;
  store: string;
  type: string;
  days: number;
  status: string;
  sizeBytes?: number;
  sha256?: string | null;
  amazonRequestId?: string | null;
  lastError?: string | null;
}

interface ActiveJobData {
  id: string;
  store_name: string;
  batch_id?: string;
  status: "PENDING" | "RUNNING" | "INGESTING" | "COMPLETED" | "FAILED" | "RETRY_WAIT" | "CANCELLED";
  stage?: string;
  progress_pct: number;
  current_step: string;
  total_files: number;
  processed_files: number;
  worker_id?: string;
  heartbeat_at?: string;
  lease_expires_at?: string;
  task_states?: ReportTaskItem[];
  enqueue_key?: string | null;
  created_at: string;
  updated_at: string;
}

interface PpcRemoteCrawlerModalProps {
  isOpen: boolean;
  onClose: () => void;
  stores: string[];
  onSyncComplete?: () => void;
}

export function PpcRemoteCrawlerModal({
  isOpen,
  onClose,
  stores,
  onSyncComplete,
}: PpcRemoteCrawlerModalProps) {
  const [selectedStore, setSelectedStore] = useState<string>("ALL");
  const [isLoading, setIsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [activeJob, setActiveJob] = useState<ActiveJobData | null>(null);
  const [historyJobs, setHistoryJobs] = useState<ActiveJobData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const trackedJobId = useRef<string | null>(null);

  // Fetch trạng thái job hiện tại hoặc lịch sử
  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/ppc/crawler/job?action=list");
      if (res.ok) {
        const data = await res.json();
        const jobs: ActiveJobData[] = data.jobs || [];
        setHistoryJobs(jobs);

        const running = jobs.find(
          (j) => j.status === "RUNNING" || j.status === "PENDING" || j.status === "INGESTING" || j.status === "RETRY_WAIT",
        );
        if (running) {
          trackedJobId.current = running.id;
          setActiveJob(running);
        } else if (trackedJobId.current) {
          const updated = jobs.find((j) => j.id === trackedJobId.current);
          setActiveJob(updated || null);
          if (updated?.status === "COMPLETED" && onSyncComplete) {
            trackedJobId.current = null;
            onSyncComplete();
          }
        }
      }
    } catch {}
  }, [onSyncComplete]);

  useEffect(() => {
    if (!isOpen) return;
    const initial = setTimeout(() => void fetchJobs(), 0);
    const timer = setInterval(() => {
      setClockNow(Date.now());
      void fetchJobs();
    }, 5000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [isOpen, fetchJobs]);

  const handleStartCrawl = async (forceNew: boolean = false) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ppc/crawler/job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeName: selectedStore, forceNew }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Không thể tạo lệnh crawl.");
      }
      trackedJobId.current = data.job.id;
      setActiveJob(data.job);
      await fetchJobs();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Không thể tạo lệnh crawl.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelJob = async () => {
    if (!activeJob) return;
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ppc/crawler/job?action=cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: activeJob.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không thể hủy job.");
      await fetchJobs();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Không thể hủy job.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetAllJobs = async () => {
    if (!confirm("Bạn có chắc chắn muốn xóa toàn bộ job đang chạy/kẹt và làm mới từ đầu?")) return;
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ppc/crawler/job?action=reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không thể xóa job.");
      setActiveJob(null);
      trackedJobId.current = null;
      await fetchJobs();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Không thể xóa job.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleClearHistory = async () => {
    if (!confirm("Bạn có chắc chắn muốn dọn sạch toàn bộ lịch sử các lệnh cũ không?")) return;
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ppc/crawler/job?action=clear_history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không thể dọn dẹp lịch sử.");
      await fetchJobs();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Không thể dọn dẹp lịch sử.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleResumeJob = async (jobId: string) => {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ppc/crawler/job?action=resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không thể resume job.");
      await fetchJobs();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Không thể resume job.");
    } finally {
      setActionLoading(false);
    }
  };

  if (!isOpen) return null;

  const isJobBusy =
    activeJob && (activeJob.status === "RUNNING" || activeJob.status === "PENDING" || activeJob.status === "INGESTING" || activeJob.status === "RETRY_WAIT");
  const isJobCancellable = activeJob && activeJob.status !== "INGESTING" && isJobBusy;

  // Tính toán thời gian Heartbeat
  let heartbeatBadge = null;
  if (activeJob && activeJob.status === "RUNNING") {
    if (activeJob.heartbeat_at) {
      const secondsAgo = Math.max(0, Math.round((clockNow - new Date(activeJob.heartbeat_at).getTime()) / 1000));
      if (secondsAgo <= 30) {
        heartbeatBadge = (
          <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
            Mac: Online ({secondsAgo}s trước)
          </span>
        );
      } else if (secondsAgo <= 90) {
        heartbeatBadge = (
          <span className="flex items-center gap-1 text-[11px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Mac: Đang bận ({secondsAgo}s trước)
          </span>
        );
      } else {
        heartbeatBadge = (
          <span className="flex items-center gap-1 text-[11px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
            Mac: Mất tín hiệu (&gt;90s)
          </span>
        );
      }
    } else {
      heartbeatBadge = (
        <span className="text-[11px] text-slate-400">Đang chờ tín hiệu Mac...</span>
      );
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150 max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 bg-slate-50/70 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-xs">
              <Desktop size={20} weight="bold" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Điều Khiển Crawl Từ Xa (Mac mini)</h3>
              <p className="text-[11px] text-slate-500">Mô hình Checkpoint 6 Tasks, Lease 90s, Heartbeat 15s</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {heartbeatBadge}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 transition cursor-pointer"
            >
              <X size={18} weight="bold" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {error && (
            <div className="flex flex-col gap-2 rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700">
              <div className="flex items-start gap-2">
                <WarningCircle size={16} className="shrink-0 mt-0.5" weight="fill" />
                <span className="font-medium">{error}</span>
              </div>
              <div className="flex items-center gap-2 pt-1 border-t border-rose-200/60">
                <button
                  type="button"
                  onClick={() => handleStartCrawl(true)}
                  disabled={actionLoading || isLoading}
                  className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] cursor-pointer shadow-xs transition"
                >
                  Hủy Job cũ & Tạo Lượt Crawl Mới Ngay
                </button>
                <button
                  type="button"
                  onClick={handleResetAllJobs}
                  disabled={actionLoading || isLoading}
                  className="px-2.5 py-1 rounded-lg bg-white border border-rose-300 text-rose-700 hover:bg-rose-100 font-bold text-[11px] cursor-pointer transition"
                >
                  Xóa Hết Job Dở Dang
                </button>
              </div>
            </div>
          )}

          {/* Chọn Shop và Nút kích hoạt */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <label className="text-xs font-bold text-slate-700">Chọn Shop cần tải báo cáo:</label>
              <select
                value={selectedStore}
                onChange={(e) => setSelectedStore(e.target.value)}
                disabled={isJobBusy || isLoading}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-800 shadow-2xs focus:border-indigo-500 focus:outline-hidden"
              >
                <option value="ALL">-- Tất cả các Shop --</option>
                {stores.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => handleStartCrawl(false)}
              disabled={isJobBusy || isLoading}
              className={`w-full flex items-center justify-center gap-2 rounded-xl py-2.5 px-4 text-xs font-bold shadow-xs transition cursor-pointer ${
                isJobBusy
                  ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                  : "bg-indigo-600 hover:bg-indigo-700 text-white active:scale-98"
              }`}
            >
              {isJobBusy ? (
                <>
                  <ArrowsClockwise size={16} className="animate-spin" weight="bold" />
                  <span>Tiến trình đang chạy...</span>
                </>
              ) : (
                <>
                  <Lightning size={16} weight="fill" className="text-amber-300" />
                  <span>Kích Hoạt Crawl Mới Ngay Bây Giờ</span>
                </>
              )}
            </button>

            <div className="flex items-center justify-between pt-1 border-t border-slate-200/60 text-xs">
              <button
                type="button"
                onClick={handleResetAllJobs}
                disabled={actionLoading || isLoading}
                className="text-[11px] font-bold text-rose-600 hover:text-rose-700 hover:underline flex items-center gap-1 cursor-pointer transition disabled:opacity-50"
              >
                <Trash size={13} weight="bold" />
                <span>Xóa hết job dở dang</span>
              </button>

              <button
                type="button"
                onClick={() => handleStartCrawl(true)}
                disabled={actionLoading || isLoading}
                className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 hover:underline flex items-center gap-1 cursor-pointer transition disabled:opacity-50"
              >
                <Lightning size={13} weight="fill" />
                <span>Cưỡng chế tạo lượt mới (Force)</span>
              </button>
            </div>
          </div>

          {/* Tiến độ Job đang chạy */}
          {activeJob && (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-800 flex items-center gap-1.5">
                  <CloudArrowUp size={16} className="text-indigo-600" weight="bold" />
                  <span>Tiến trình [{activeJob.store_name}]</span>
                  {activeJob.batch_id && (
                    <span className="text-[10px] font-mono text-slate-400 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                      {activeJob.batch_id}
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                      activeJob.status === "COMPLETED"
                        ? "bg-emerald-100 text-emerald-800"
                        : activeJob.status === "FAILED"
                        ? "bg-rose-100 text-rose-800"
                        : activeJob.status === "RETRY_WAIT"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-indigo-100 text-indigo-800 animate-pulse"
                    }`}
                  >
                    {activeJob.status === "PENDING"
                      ? "Chờ Mac nhận"
                      : activeJob.status === "RUNNING"
                      ? "Đang chạy"
                      : activeJob.status === "INGESTING"
                      ? "Server đang nạp DB"
                      : activeJob.status === "RETRY_WAIT"
                      ? "Chờ Resume"
                      : activeJob.status === "COMPLETED"
                      ? "Hoàn tất"
                      : activeJob.status === "CANCELLED"
                      ? "Đã hủy"
                      : "Lỗi"}
                  </span>
                  {isJobCancellable && (
                    <button
                      type="button"
                      onClick={handleCancelJob}
                      disabled={actionLoading}
                      className="text-rose-600 hover:text-rose-800 text-[11px] font-bold flex items-center gap-1 hover:underline cursor-pointer"
                    >
                      <StopCircle size={14} weight="bold" />
                      <span>Hủy</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 rounded-full ${
                    activeJob.status === "COMPLETED"
                      ? "bg-emerald-500"
                      : activeJob.status === "FAILED"
                      ? "bg-rose-500"
                      : activeJob.status === "RETRY_WAIT"
                      ? "bg-amber-500"
                      : "bg-indigo-600"
                  }`}
                  style={{ width: `${activeJob.progress_pct || 0}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-600">
                <span className="truncate pr-2 font-medium">
                  {activeJob.current_step || "Đang xử lý..."}
                </span>
                <span className="font-mono font-bold shrink-0">{activeJob.progress_pct || 0}%</span>
              </div>

              {/* Bảng Chi Tiết 6 Report Tasks (Checkpoint State) */}
              {activeJob.task_states && activeJob.task_states.length > 0 && (
                <div className="pt-2 border-t border-indigo-100/80">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block mb-1.5">
                    Chi tiết trạng thái từng file (Checkpoint):
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {activeJob.task_states.map((t) => {
                      const isDone =
                        t.status === "VALIDATED" || t.status === "DOWNLOADED" || t.status === "UPLOADED";
                      const isProcessing =
                        t.status === "AMAZON_PROCESSING" || t.status === "REQUESTED" || t.status === "DOWNLOADING";
                      const isFailed = t.status === "FAILED";

                      return (
                        <div
                          key={t.id}
                          className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white border border-slate-200/80 text-[11px]"
                        >
                          <div className="flex items-center gap-1.5 truncate">
                            <FileText
                              size={14}
                              className={
                                isDone
                                  ? "text-emerald-500"
                                  : isProcessing
                                  ? "text-amber-500 animate-pulse"
                                  : isFailed
                                  ? "text-rose-500"
                                  : "text-slate-400"
                              }
                              weight="bold"
                            />
                            <span className="font-bold text-slate-700 truncate">
                              {activeJob.store_name === "ALL" ? `[${t.store}] ` : ""}
                              {t.id.replace(`${t.store}_`, "")}
                            </span>
                          </div>
                          <div className="shrink-0 flex items-center gap-1 ml-2">
                            {isDone ? (
                              <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                                {t.sizeBytes ? `${(t.sizeBytes / (1024 * 1024)).toFixed(1)} MB` : "Đã tải"}
                              </span>
                            ) : isProcessing ? (
                              <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded flex items-center gap-1">
                                <ArrowsClockwise size={10} className="animate-spin" />
                                Đang xử lý
                              </span>
                            ) : isFailed ? (
                              <span className="text-[10px] font-semibold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded">
                                Lỗi
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400">Chờ</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Lịch sử lệnh gần đây */}
          {historyJobs.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 block">
                  Lịch sử lệnh gần đây
                </span>
                <button
                  type="button"
                  onClick={handleClearHistory}
                  disabled={actionLoading || isLoading}
                  className="text-[11px] font-bold text-slate-400 hover:text-rose-600 hover:underline flex items-center gap-1 cursor-pointer transition disabled:opacity-50"
                  title="Dọn sạch danh sách lịch sử lệnh"
                >
                  <Trash size={12} weight="bold" />
                  <span>Xóa lịch sử</span>
                </button>
              </div>
              <div className="max-h-36 overflow-y-auto space-y-1.5 divide-y divide-slate-100 border border-slate-100 rounded-xl p-2 bg-slate-50/30">
                {historyJobs.slice(0, 4).map((job) => (
                  <div key={job.id} className="pt-1.5 first:pt-0 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 truncate">
                      {job.status === "COMPLETED" ? (
                        <CheckCircle size={14} className="text-emerald-500 shrink-0" weight="fill" />
                      ) : job.status === "FAILED" ? (
                        <WarningCircle size={14} className="text-rose-500 shrink-0" weight="fill" />
                      ) : job.status === "RETRY_WAIT" ? (
                        <ArrowsClockwise size={14} className="text-amber-500 shrink-0" weight="bold" />
                      ) : (
                        <ArrowsClockwise size={14} className="text-indigo-500 animate-spin shrink-0" weight="bold" />
                      )}
                      <span className="font-bold text-slate-700 truncate">[{job.store_name}]</span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                        job.enqueue_key?.startsWith("daily:")
                          ? "bg-sky-50 text-sky-700"
                          : "bg-violet-50 text-violet-700"
                      }`} title={job.enqueue_key || "Job được tạo từ giao diện web"}>
                        {job.enqueue_key?.startsWith("daily:")
                          ? job.enqueue_key.split(":").length > 3 ? "Lịch Force" : "Lịch Mac"
                          : "Thao tác web"}
                      </span>
                      <span className="text-[11px] text-slate-400 truncate">{job.current_step}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      {(job.status === "FAILED" || job.status === "RETRY_WAIT" || job.status === "CANCELLED") && (
                        <button
                          type="button"
                          onClick={() => handleResumeJob(job.id)}
                          disabled={actionLoading}
                          className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-1.5 py-0.5 rounded cursor-pointer flex items-center gap-1"
                        >
                          <PlayCircle size={12} weight="bold" />
                          <span>Resume</span>
                        </button>
                      )}
                      <span className="text-[10px] text-slate-400 font-mono">
                        {new Date(job.created_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 px-5 py-3 bg-slate-50 flex items-center justify-between shrink-0">
          <span className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />
            <span>Đóng popup không hủy tiến trình. Mac mini tự động lưu checkpoint.</span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200 transition cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
