"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  ArrowsClockwise,
  CheckCircle,
  WarningCircle,
  Desktop,
  Lightning,
  CloudArrowUp,
} from "@phosphor-icons/react";

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
  const [activeJob, setActiveJob] = useState<any | null>(null);
  const [historyJobs, setHistoryJobs] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Fetch trạng thái job hiện tại hoặc lịch sử
  const fetchJobs = async () => {
    try {
      const res = await fetch("/api/ppc/crawler/job?action=list");
      if (res.ok) {
        const data = await res.json();
        const jobs: any[] = data.jobs || [];
        setHistoryJobs(jobs);

        // Kiểm tra xem có job nào đang RUNNING hoặc PENDING không
        const running = jobs.find((j) => j.status === "RUNNING" || j.status === "PENDING");
        if (running) {
          setActiveJob(running);
        } else if (activeJob && (activeJob.status === "RUNNING" || activeJob.status === "PENDING")) {
          // Job vừa hoàn tất
          const updated = jobs.find((j) => j.id === activeJob.id);
          setActiveJob(updated || null);
          if (updated?.status === "COMPLETED" && onSyncComplete) {
            onSyncComplete();
          }
        }
      }
    } catch {}
  };

  useEffect(() => {
    if (!isOpen) return;
    fetchJobs();
    const timer = setInterval(fetchJobs, 2500);
    return () => clearInterval(timer);
  }, [isOpen, activeJob?.status]);

  const handleStartCrawl = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ppc/crawler/job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeName: selectedStore }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Không thể tạo lệnh crawl.");
      }
      setActiveJob(data.job);
      await fetchJobs();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const isJobBusy = activeJob && (activeJob.status === "RUNNING" || activeJob.status === "PENDING");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-xs">
              <Desktop size={20} weight="bold" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Điều Khiển Crawl Từ Xa (Mac mini)</h3>
              <p className="text-[11px] text-slate-500">Tự động mở AdsPower, ném file lên R2 và đồng bộ DB</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 transition cursor-pointer"
          >
            <X size={18} weight="bold" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          {error && (
            <div className="flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700">
              <WarningCircle size={16} className="shrink-0 mt-0.5" weight="fill" />
              <span>{error}</span>
            </div>
          )}

          {/* Chọn Shop và Nút kích hoạt */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
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
              onClick={handleStartCrawl}
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
                  <span>Máy Mac đang thực hiện lệnh...</span>
                </>
              ) : (
                <>
                  <Lightning size={16} weight="fill" className="text-amber-300" />
                  <span>Kích Hoạt Crawl Ngay Bây Giờ</span>
                </>
              )}
            </button>
          </div>

          {/* Tiến độ Job đang chạy */}
          {activeJob && (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-800 flex items-center gap-1.5">
                  <CloudArrowUp size={16} className="text-indigo-600" weight="bold" />
                  <span>Tiến trình [Shop: {activeJob.store_name}]</span>
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                    activeJob.status === "COMPLETED"
                      ? "bg-emerald-100 text-emerald-800"
                      : activeJob.status === "FAILED"
                      ? "bg-rose-100 text-rose-800"
                      : "bg-amber-100 text-amber-800 animate-pulse"
                  }`}
                >
                  {activeJob.status === "PENDING"
                    ? "Đang chờ Mac"
                    : activeJob.status === "RUNNING"
                    ? "Đang chạy"
                    : activeJob.status === "COMPLETED"
                    ? "Hoàn tất"
                    : "Lỗi"}
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 rounded-full ${
                    activeJob.status === "COMPLETED"
                      ? "bg-emerald-500"
                      : activeJob.status === "FAILED"
                      ? "bg-rose-500"
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
            </div>
          )}

          {/* Lịch sử 3 lệnh gần nhất */}
          {historyJobs.length > 0 && (
            <div className="space-y-2">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 block">
                Lịch sử lệnh gần đây
              </span>
              <div className="max-h-36 overflow-y-auto space-y-1.5 divide-y divide-slate-100 border border-slate-100 rounded-xl p-2 bg-slate-50/30">
                {historyJobs.slice(0, 4).map((job) => (
                  <div key={job.id} className="pt-1.5 first:pt-0 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 truncate">
                      {job.status === "COMPLETED" ? (
                        <CheckCircle size={14} className="text-emerald-500 shrink-0" weight="fill" />
                      ) : job.status === "FAILED" ? (
                        <WarningCircle size={14} className="text-rose-500 shrink-0" weight="fill" />
                      ) : (
                        <ArrowsClockwise size={14} className="text-indigo-500 animate-spin shrink-0" weight="bold" />
                      )}
                      <span className="font-bold text-slate-700 truncate">[{job.store_name}]</span>
                      <span className="text-[11px] text-slate-400 truncate">{job.current_step}</span>
                    </div>
                    <span className="text-[10px] text-slate-400 shrink-0 font-mono ml-2">
                      {new Date(job.created_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 px-5 py-3 bg-slate-50 flex items-center justify-between">
          <span className="text-[11px] text-slate-500 flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />
            Lịch cố định: 12:00 trưa mỗi ngày
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
