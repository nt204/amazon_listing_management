"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  DownloadSimpleIcon,
  FileZipIcon,
  LightningIcon,
  PauseIcon,
  PlayIcon,
  StopIcon,
  WarningCircleIcon,
  XIcon,
  CaretDownIcon,
  CaretUpIcon,
  ListDashesIcon,
} from "@phosphor-icons/react";
import type {
  TrelloListingBatchRecord,
  TrelloListingBatchItemRecord,
} from "@/lib/trello-listing-batches";

export function GlobalListingBatchBar() {
  const [activeBatches, setActiveBatches] = useState<TrelloListingBatchRecord[]>([]);
  const [activeItems, setActiveItems] = useState<Record<string, TrelloListingBatchItemRecord[]>>({});
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [controlling, setControlling] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [dismissedBatches, setDismissedBatches] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = sessionStorage.getItem("dismissed_listing_batches");
        return stored ? new Set(JSON.parse(stored)) : new Set();
      } catch {
        return new Set();
      }
    }
    return new Set();
  });

  const handleDismiss = useCallback((batchId: string) => {
    setDismissedBatches((prev) => {
      const next = new Set(prev);
      next.add(batchId);
      try {
        sessionStorage.setItem("dismissed_listing_batches", JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  }, []);

  const fetchActiveBatches = useCallback(async () => {
    try {
      const res = await fetch("/api/trello/batch-jobs/active", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.activeBatches)) {
        setActiveBatches(data.activeBatches);
        if (data.activeItems) {
          setActiveItems(data.activeItems);
        }
        if (data.activeBatches.length > 0 && !selectedBatchId) {
          setSelectedBatchId(data.activeBatches[0].id);
        }
      }
    } catch {
      // Bỏ qua lỗi mạng nền
    }
  }, [selectedBatchId]);

  useEffect(() => {
    void fetchActiveBatches();
    const hasRunning = activeBatches.some((b) => b.status === "running" || b.status === "queued");
    const intervalTime = hasRunning ? 2500 : 8000;
    const timer = setInterval(() => {
      void fetchActiveBatches();
    }, intervalTime);

    const handleUpdate = () => {
      void fetchActiveBatches();
    };
    window.addEventListener("batch-job-updated", handleUpdate);

    return () => {
      clearInterval(timer);
      window.removeEventListener("batch-job-updated", handleUpdate);
    };
  }, [fetchActiveBatches, activeBatches]);

  const visibleBatches = useMemo(() => {
    return activeBatches.filter((b) => !dismissedBatches.has(b.id));
  }, [activeBatches, dismissedBatches]);

  const currentBatch = useMemo(() => {
    if (!selectedBatchId) return visibleBatches[0] || null;
    return visibleBatches.find((b) => b.id === selectedBatchId) || visibleBatches[0] || null;
  }, [visibleBatches, selectedBatchId]);

  // Tự động ẩn thanh thông báo sau 15 giây khi batch đã hoàn tất
  useEffect(() => {
    if (!currentBatch) return;
    if (currentBatch.status === "completed" && !dismissedBatches.has(currentBatch.id)) {
      const timer = setTimeout(() => {
        handleDismiss(currentBatch.id);
      }, 15000);
      return () => clearTimeout(timer);
    }
  }, [currentBatch, dismissedBatches, handleDismiss]);

  const currentBatchItems = useMemo(() => {
    if (!currentBatch) return [];
    return activeItems[currentBatch.id] || [];
  }, [activeItems, currentBatch]);

  if (!currentBatch) return null;

  const total = currentBatch.total_cards || 1;
  const completed = currentBatch.completed_cards || 0;
  const failed = currentBatch.failed_cards || 0;
  const runningItems = currentBatchItems.filter((i) => i.status === "running");
  const queuedItems = currentBatchItems.filter((i) => i.status === "queued");
  const percent = Math.min(100, Math.round(((completed + failed) / total) * 100));

  const handleControl = async (action: "pause" | "resume" | "cancel" | "retry-all-failed") => {
    if (!currentBatch) return;
    try {
      setControlling(true);
      await fetch(`/api/trello/batch-jobs/${currentBatch.id}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await fetchActiveBatches();
    } catch (e) {
      console.error("Batch control error:", e);
    } finally {
      setControlling(false);
    }
  };

  const handleRetryItem = async (itemId: string) => {
    if (!currentBatch) return;
    try {
      await fetch(`/api/trello/batch-jobs/${currentBatch.id}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry-item", itemId }),
      });
      await fetchActiveBatches();
    } catch (e) {
      console.error("Retry item error:", e);
    }
  };

  const handleDownloadZip = async () => {
    if (!currentBatch) return;
    try {
      setDownloadingZip(true);
      const cardIds = currentBatchItems.filter((i) => i.status === "completed").map((i) => i.card_id);
      const res = await fetch("/api/trello/batch-zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardIds,
          shopId: currentBatch.shop_id,
          templateId: currentBatch.template_id,
          batchId: currentBatch.id,
        }),
      });
      if (!res.ok) throw new Error("Không thể tải ZIP batch");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Batch_${currentBatch.shop_name || "Shop"}_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert("Lỗi tải ZIP batch: " + err?.message);
    } finally {
      setDownloadingZip(false);
    }
  };

  // Minimized floating bubble
  if (isMinimized) {
    return (
      <div className="fixed bottom-5 right-5 z-50">
        <button
          type="button"
          onClick={() => setIsMinimized(false)}
          className={`flex items-center gap-2.5 rounded-full px-4 py-2.5 text-xs font-black text-white shadow-2xl transition hover:scale-105 cursor-pointer ${
            currentBatch.status === "completed"
              ? "bg-emerald-600 hover:bg-emerald-700"
              : currentBatch.status === "failed"
              ? "bg-rose-600 hover:bg-rose-700"
              : currentBatch.status === "paused"
              ? "bg-amber-600 hover:bg-amber-700"
              : "bg-indigo-600 hover:bg-indigo-700"
          }`}
          title="Bấm để mở rộng thanh tiến độ Batch Listing"
        >
          <LightningIcon size={16} weight="fill" className={currentBatch.status === "running" ? "animate-pulse" : ""} />
          <span>
            Batch {currentBatch.shop_name}: {completed}/{total} SKU ({percent}%)
          </span>
          <CaretUpIcon size={14} weight="bold" />
        </button>
        <button
          type="button"
          onClick={() => handleDismiss(currentBatch.id)}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900/80 text-white shadow-lg hover:bg-slate-900 transition cursor-pointer"
          title="Đóng thông báo"
        >
          <XIcon size={13} weight="bold" />
        </button>
      </div>
    );
  }

  const isCompleted = currentBatch.status === "completed";
  const isFailed = currentBatch.status === "failed";
  const isPaused = currentBatch.status === "paused";
  const isCancelled = currentBatch.status === "cancelled";

  return (
    <>
      <div className="sticky top-0 z-40 w-full animate-in fade-in slide-in-from-top-2 duration-200">
        <div
          className={`border-b px-4 py-2.5 text-white shadow-md transition-colors ${
            isCompleted
              ? "border-emerald-600 bg-emerald-600"
              : isFailed
              ? "border-rose-600 bg-rose-600"
              : isPaused
              ? "border-amber-600 bg-amber-600"
              : isCancelled
              ? "border-slate-600 bg-slate-700"
              : "border-indigo-700 bg-indigo-600"
          }`}
        >
          <div className="mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-2 max-w-7xl">
            {/* Left: Info & Progress bar */}
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20 text-white font-black text-xs">
                <LightningIcon size={16} weight="fill" />
              </span>

              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="font-extrabold tracking-tight">
                    {isCompleted
                      ? "🎉 Hoàn tất Batch Listing:"
                      : isPaused
                      ? "⏸️ Batch Listing đang tạm dừng:"
                      : isCancelled
                      ? "⛔ Batch Listing đã hủy:"
                      : "⚡ Đang xử lý Batch Listing (Chạy nền trên Server):"}
                  </span>
                  <span className="font-bold underline decoration-white/50">{currentBatch.shop_name}</span>
                  <span className="text-white/80 font-mono text-[11px]">
                    ({completed}/{total} SKU hoàn thành{failed > 0 ? `, ${failed} lỗi` : ""})
                  </span>
                  {runningItems.length > 0 && (
                    <span className="text-[11px] bg-white/20 px-2 py-0.5 rounded font-mono">
                      {runningItems.map((r) => r.sku || r.card_name).join(", ")}
                    </span>
                  )}
                </div>

                {/* Progress bar line */}
                <div className="h-1.5 w-full max-w-xl rounded-full bg-black/20 overflow-hidden">
                  <div
                    className="h-full bg-white transition-all duration-300 rounded-full shadow-sm"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
              {isCompleted && (
                <>
                  <a
                    href={currentBatch.excel_combined_url || `/api/trello/batch-jobs/${currentBatch.id}/excel`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-black text-emerald-800 shadow hover:bg-emerald-50 transition cursor-pointer"
                    title="Tải 1 file Excel tổng hợp tất cả SKU của Batch"
                  >
                    <DownloadSimpleIcon size={14} weight="bold" />
                    <span>Tải Excel Tổng Hợp</span>
                  </a>

                  <button
                    type="button"
                    onClick={handleDownloadZip}
                    disabled={downloadingZip}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white/20 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/30 transition cursor-pointer disabled:opacity-50"
                    title="Tải toàn bộ file Excel của Batch dưới dạng file ZIP"
                  >
                    <FileZipIcon size={14} weight="bold" />
                    <span>{downloadingZip ? "Đang tải ZIP..." : "Tải ZIP Batch"}</span>
                  </button>
                </>
              )}

              {!isCompleted && !isCancelled && (
                <>
                  {isPaused ? (
                    <button
                      type="button"
                      onClick={() => handleControl("resume")}
                      disabled={controlling}
                      className="inline-flex items-center gap-1 rounded-lg bg-white/20 px-2.5 py-1 text-xs font-bold text-white hover:bg-white/30 transition cursor-pointer"
                      title="Tiếp tục chạy batch"
                    >
                      <PlayIcon size={13} weight="fill" />
                      <span>Tiếp tục</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleControl("pause")}
                      disabled={controlling}
                      className="inline-flex items-center gap-1 rounded-lg bg-white/20 px-2.5 py-1 text-xs font-bold text-white hover:bg-white/30 transition cursor-pointer"
                      title="Tạm dừng batch"
                    >
                      <PauseIcon size={13} weight="fill" />
                      <span>Tạm dừng</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      if (confirm("Bạn có chắc muốn hủy các thẻ còn lại trong Batch này?")) {
                        void handleControl("cancel");
                      }
                    }}
                    disabled={controlling}
                    className="inline-flex items-center gap-1 rounded-lg bg-rose-500/80 px-2.5 py-1 text-xs font-bold text-white hover:bg-rose-500 transition cursor-pointer"
                    title="Hủy batch"
                  >
                    <StopIcon size={13} weight="fill" />
                    <span>Hủy</span>
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => setShowDetailModal(true)}
                className="inline-flex items-center gap-1 rounded-lg bg-white/20 px-2.5 py-1 text-xs font-bold text-white hover:bg-white/30 transition cursor-pointer"
                title="Xem danh sách chi tiết các SKU trong Batch"
              >
                <ListDashesIcon size={14} weight="bold" />
                <span>Chi tiết ({currentBatchItems.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setIsMinimized(true)}
                className="rounded-lg p-1 text-white/80 hover:bg-white/20 hover:text-white transition cursor-pointer"
                title="Thu nhỏ thanh tiến độ xuống góc màn hình"
              >
                <CaretDownIcon size={16} weight="bold" />
              </button>

              <button
                type="button"
                onClick={() => handleDismiss(currentBatch.id)}
                className="rounded-lg p-1 text-white/80 hover:bg-white/20 hover:text-white transition cursor-pointer"
                title="Đóng thông báo (Xem lại trong mục Lịch Sử Batch)"
              >
                <XIcon size={16} weight="bold" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* DETAIL MODAL */}
      {showDetailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="flex flex-col h-[85vh] w-full max-w-4xl rounded-2xl bg-white shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white font-black">
                  <LightningIcon size={18} weight="fill" />
                </span>
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    Chi tiết Batch Listing — {currentBatch.shop_name} ({currentBatch.brand_name})
                  </h3>
                  <p className="text-xs text-slate-500">
                    Tiến độ: <b className="text-slate-800">{completed}/{total} SKU</b> • Trạng thái:{" "}
                    <span className="font-bold uppercase text-indigo-700">{currentBatch.status}</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {failed > 0 && (
                  <button
                    type="button"
                    onClick={() => handleControl("retry-all-failed")}
                    disabled={controlling}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-100 transition cursor-pointer"
                  >
                    <ArrowClockwiseIcon size={14} weight="bold" />
                    <span>Thử lại {failed} SKU lỗi</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setShowDetailModal(false)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition cursor-pointer"
                >
                  <XIcon size={18} weight="bold" />
                </button>
              </div>
            </div>

            {/* Modal Body: SKU List Table */}
            <div className="flex-1 overflow-auto p-4">
              <table className="w-full text-left text-xs border border-slate-200 rounded-lg overflow-hidden">
                <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3 w-12 text-center">#</th>
                    <th className="py-2.5 px-3">SKU / Tên Thẻ</th>
                    <th className="py-2.5 px-3 w-32 text-center">Trạng Thái</th>
                    <th className="py-2.5 px-3 w-48">Tiến Độ / Bước Hiện Tại</th>
                    <th className="py-2.5 px-3 w-28 text-center">Thao Tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {currentBatchItems.map((item, idx) => (
                    <tr
                      key={item.id}
                      className={`hover:bg-slate-50 transition-colors ${
                        item.status === "running"
                          ? "bg-indigo-50/50"
                          : item.status === "failed"
                          ? "bg-rose-50/50"
                          : ""
                      }`}
                    >
                      <td className="py-2 px-3 text-center font-mono text-slate-400">{idx + 1}</td>
                      <td className="py-2 px-3">
                        <div className="font-bold text-slate-900">{item.sku || item.card_name}</div>
                        <div className="text-[11px] text-slate-400 truncate max-w-sm">{item.card_name}</div>
                      </td>
                      <td className="py-2 px-3 text-center">
                        {item.status === "completed" ? (
                          <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-bold bg-emerald-100 text-emerald-800">
                            <CheckCircleIcon size={12} weight="bold" />
                            <span>Hoàn tất</span>
                          </span>
                        ) : item.status === "running" ? (
                          <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-bold bg-indigo-100 text-indigo-800">
                            <ArrowClockwiseIcon size={12} weight="bold" className="animate-spin" />
                            <span>Đang xử lý</span>
                          </span>
                        ) : item.status === "failed" ? (
                          <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-bold bg-rose-100 text-rose-800">
                            <WarningCircleIcon size={12} weight="bold" />
                            <span>Lỗi</span>
                          </span>
                        ) : item.status === "cancelled" ? (
                          <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-bold bg-slate-100 text-slate-600">
                            <span>Đã hủy</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-bold bg-slate-100 text-slate-500">
                            <span>Đang chờ</span>
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <div className="text-slate-600 text-[11px] truncate" title={item.stage_message || ""}>
                          {item.stage_message || "—"}
                        </div>
                        {item.status === "running" && (
                          <div className="mt-1 h-1 w-full bg-slate-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-indigo-600 rounded-full transition-all duration-300"
                              style={{ width: `${item.progress}%` }}
                            />
                          </div>
                        )}
                        {item.error_message && (
                          <div className="text-[11px] font-semibold text-rose-600 truncate mt-0.5" title={item.error_message}>
                            {item.error_message}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-3 text-center">
                        {item.status === "failed" && (
                          <button
                            type="button"
                            onClick={() => handleRetryItem(item.id)}
                            className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100 transition cursor-pointer"
                          >
                            <ArrowClockwiseIcon size={12} weight="bold" />
                            <span>Thử lại</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between border-t border-slate-200 px-6 py-3 bg-slate-50 text-xs">
              <span className="text-slate-500">
                Batch chạy nền độc lập trên máy chủ. Bạn có thể chuyển mục hoặc đóng tab bất cứ lúc nào.
              </span>
              <button
                type="button"
                onClick={() => setShowDetailModal(false)}
                className="rounded-lg bg-slate-800 px-4 py-2 font-bold text-white hover:bg-slate-900 transition cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
