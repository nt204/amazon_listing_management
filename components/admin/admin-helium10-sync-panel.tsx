"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ArrowsClockwise,
  CheckCircle,
  CircleNotch,
  ClockCounterClockwise,
  Gear,
  Lightning,
  Play,
  SlidersHorizontal,
  Stop,
  UploadSimple,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import { useRef } from "react";
import { Helium10SettingsModal } from "@/components/helium10-settings-modal";
import type { SearchVolumeStatus as SearchVolumeStatusResponse } from "@/lib/ppc/search-volume";

interface StoreItem {
  id: string;
  name: string;
  marketplace: string;
}

const formatCount = (value: number | null | undefined) => (typeof value === "number" ? value.toLocaleString() : "—");

const formatElapsed = (fromIso: string, toMs: number) => {
  const total = Math.max(0, Math.floor((toMs - new Date(fromIso).getTime()) / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
};

export function AdminHelium10SyncPanel() {
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [selectedStore, setSelectedStore] = useState<string>("ALL");
  const [status, setStatus] = useState<SearchVolumeStatusResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [showCookieModal, setShowCookieModal] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadingExcel, setUploadingExcel] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "history">("overview");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingExcel(true);
    setError(null);
    setNotice(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("marketplace", "US");

    try {
      const res = await fetch("/api/ppc/search-volume/import", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Không thể nạp file Excel Search Volume.");
      }
      setNotice(data.message || "Đã nạp file Search Volume thành công!");
      await loadStatus(selectedStore);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi tải file Excel lên.");
    } finally {
      setUploadingExcel(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Load stores list
  const loadStores = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/ppc-store-access");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.stores)) {
          setStores(data.stores);
        }
      }
    } catch {}
  }, []);

  // Load sync status
  const loadStatus = useCallback(async (storeName: string) => {
    setLoadingStatus(true);
    try {
      const res = await fetch(`/api/ppc/search-volume?storeName=${encodeURIComponent(storeName)}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setStatus(json.data);
        }
      }
    } catch {
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    loadStores();
  }, [loadStores]);

  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    loadStatus(selectedStore);
  }, [selectedStore, loadStatus]);

  // Job ghi tiến độ mỗi lượt Helium 10 (5–20s/lượt) nên hỏi lại 15s/lần là đủ
  useEffect(() => {
    if (status?.latestRun?.status === "running") {
      const interval = setInterval(() => {
        loadStatus(selectedStore);
      }, 15_000);
      return () => clearInterval(interval);
    }
  }, [status?.latestRun?.status, selectedStore, loadStatus]);

  const handleStartCrawl = async () => {
    if (!window.confirm(`Xác nhận bắt đầu quét Search Volume, Organic Rank & Sponsored Rank từ Helium 10 cho ${selectedStore}?`)) {
      return;
    }
    setTriggering(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/ppc/search-volume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeName: selectedStore }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Không thể bắt đầu crawl.");
      }
      setNotice(`Đang chạy crawl ngầm cho ${selectedStore}! Hệ thống sẽ tự động cập nhật kết quả.`);
      await loadStatus(selectedStore);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi khởi chạy crawl.");
    } finally {
      setTriggering(false);
    }
  };

  const handleStopCrawl = async () => {
    if (!window.confirm("Bạn có chắc chắn muốn dừng tiến trình quét Search Volume hiện tại? Dữ liệu đã cào được sẽ vẫn được bảo lưu.")) {
      return;
    }
    setStopping(true);
    setError(null);
    try {
      const runId = status?.latestRun?.id;
      const res = await fetch(`/api/ppc/search-volume?runId=${encodeURIComponent(runId || "")}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Không thể dừng tiến trình.");
      }
      setNotice("Đã gửi lệnh dừng quét. Hệ thống sẽ kết thúc lượt hiện tại và ngắt an toàn.");
      await loadStatus(selectedStore);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi dừng tiến trình.");
    } finally {
      setStopping(false);
    }
  };

  const isRunning = status?.latestRun?.status === "running";
  const latestRun = status?.latestRun ?? null;
  const asins = status?.asins ?? null;
  const canResume = !!asins && asins.done > 0 && asins.pending > 0;
  const runProblem = !isRunning && (latestRun?.status === "interrupted" || latestRun?.status === "failed") ? latestRun : null;

  // Lượt chạy vừa kết thúc → bỏ thông báo xanh "Đang chạy crawl ngầm" để không che kết quả / lỗi thật
  const prevRunStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (prevRunStatus.current === "running" && latestRun?.status !== "running") setNotice(null);
    prevRunStatus.current = latestRun?.status;
  }, [latestRun?.status]);

  // Đồng hồ chạy thật (tính từ started_at), chỉ tick khi đang chạy
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isRunning]);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
      {/* Header gọn gàng */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-sky-50 text-sky-700 border border-sky-100">
            <Lightning size={18} weight="fill" />
          </div>
          <div>
            <h2 className="text-sm font-extrabold text-slate-900">Helium 10 Auto Crawl (Search Volume & Rank)</h2>
            <p className="text-[11px] text-slate-500 font-medium">
              Quét Search Volume, Organic Rank (#) và Sponsored Rank (#) cho Target & Search Term
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            type="button"
            disabled={uploadingExcel}
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 shadow-2xs transition cursor-pointer disabled:opacity-50"
            title="Nạp trực tiếp file Excel xuất từ Helium 10 Cerebro/Magnet hoặc DataDive"
          >
            {uploadingExcel ? (
              <CircleNotch size={14} className="animate-spin text-emerald-700" />
            ) : (
              <UploadSimple size={14} weight="bold" className="text-emerald-700" />
            )}
            <span>{uploadingExcel ? "Đang nạp..." : "Nạp Excel SV"}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowCookieModal(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-2xs transition cursor-pointer"
          >
            <Gear size={14} weight="bold" /> Cookie H10
          </button>
          <button
            type="button"
            onClick={() => loadStatus(selectedStore)}
            disabled={loadingStatus}
            title="Làm mới trạng thái"
            className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
          >
            <ArrowsClockwise size={14} className={loadingStatus ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Tab Navigation: Điều khiển & Lịch sử */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-2 sm:px-5">
        <button
          type="button"
          onClick={() => setActiveTab("overview")}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
            activeTab === "overview"
              ? "bg-white text-sky-700 shadow-2xs border border-slate-200"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
          }`}
        >
          <SlidersHorizontal size={14} weight={activeTab === "overview" ? "fill" : "regular"} />
          <span>Điều khiển & Tiến độ</span>
          {isRunning && (
            <span className="flex h-2 w-2 rounded-full bg-sky-500 animate-ping" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("history")}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
            activeTab === "history"
              ? "bg-white text-sky-700 shadow-2xs border border-slate-200"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
          }`}
        >
          <ClockCounterClockwise size={14} weight={activeTab === "history" ? "fill" : "regular"} />
          <span>Lịch sử lượt quét</span>
          {Array.isArray(status?.recentRuns) && status.recentRuns.length > 0 && (
            <span className="rounded-full bg-slate-200 px-1.5 py-0.2 text-[10px] font-mono font-bold text-slate-700">
              {status.recentRuns.length}
            </span>
          )}
        </button>
      </div>

      <div className="p-4 sm:p-5 space-y-4">
        {/* Thông báo kết quả */}
        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-rose-800 text-xs font-semibold">
            <WarningCircle size={15} weight="fill" className="shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-emerald-800 text-xs font-semibold">
            <CheckCircle size={15} weight="fill" className="shrink-0" />
            <span>{notice}</span>
          </div>
        )}
        {runProblem && (
          <div
            className={`flex flex-wrap items-start justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-xs ${
              runProblem.status === "failed"
                ? "border-rose-200 bg-rose-50 text-rose-800"
                : "border-amber-200 bg-amber-50 text-amber-900"
            }`}
          >
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <WarningCircle size={15} weight="fill" className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="font-bold">
                  {runProblem.status === "failed" ? "Lượt quét gần nhất bị lỗi" : "Lượt quét gần nhất đang tạm dừng"}
                  {runProblem.finished_at && (
                    <span className="font-medium opacity-75">
                      {" "}· {new Date(runProblem.finished_at).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })}
                      {" "}· {runProblem.store_name || "ALL"}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 break-words font-medium">{runProblem.message || "Không có thông tin lỗi."}</p>
              </div>
            </div>
            {asins && asins.pending > 0 && (
              <button
                type="button"
                onClick={handleStartCrawl}
                disabled={triggering}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-700 disabled:opacity-50 cursor-pointer"
              >
                <Play size={12} weight="fill" /> Chạy tiếp ({formatCount(asins.pending)} ASIN)
              </button>
            )}
          </div>
        )}

        {/* Bảng Tiến Trình Đang Chạy Trực Tiếp (Realtime Live Progress & Stop) */}
        {isRunning && (
          <div className="overflow-hidden rounded-xl border border-sky-200 bg-sky-50/70 p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75"></span>
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-sky-600"></span>
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black uppercase tracking-wider text-sky-900">
                      Đang Quét Dữ Liệu Thực Tế
                    </span>
                    <span className="rounded bg-sky-200 px-1.5 py-0.5 text-[10px] font-bold text-sky-800">
                      Live
                    </span>
                  </div>
                  <p className="text-xs font-medium text-sky-800 mt-0.5">
                    {status?.latestRun?.message || "Đang xử lý kết nối Helium 10 Cerebro..."}
                  </p>
                </div>
              </div>

              {/* Nút Dừng màu đỏ nổi bật */}
              <button
                type="button"
                onClick={handleStopCrawl}
                disabled={stopping}
                className="flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-rose-700 shadow-xs transition cursor-pointer disabled:opacity-50"
              >
                {stopping ? (
                  <CircleNotch size={14} className="animate-spin" />
                ) : (
                  <Stop size={14} weight="fill" />
                )}
                <span>{stopping ? "Đang dừng..." : "Dừng Quét"}</span>
              </button>
            </div>

            {/* Tiến độ thật: ASIN đã xong (gồm checkpoint các lượt trước) / tổng ASIN đang chạy ads */}
            {(() => {
              const total = latestRun?.asins_total ?? null;
              const done = latestRun?.asins_done ?? null;
              const percent = total && done !== null ? Math.min(100, Math.round((done / total) * 100)) : null;
              return (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[11px] font-semibold text-sky-900">
                    <span>
                      {total === null ? (
                        "Đang gom keyword & ASIN cần quét..."
                      ) : (
                        <>
                          Tiến độ ASIN: <span className="font-mono font-bold">{formatCount(done)}</span> / {formatCount(total)}
                        </>
                      )}
                    </span>
                    <span className="font-mono font-bold text-sky-700">{percent === null ? "—" : `${percent}%`}</span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-sky-200/80">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r from-sky-500 to-indigo-600 transition-all duration-500 ease-out ${percent === null ? "animate-pulse" : ""}`}
                      style={{ width: `${percent ?? 100}%`, opacity: percent === null ? 0.35 : 1 }}
                    />
                  </div>
                </div>
              );
            })()}

            {/* Thống kê trực tiếp của lượt này */}
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-lg bg-white/80 p-2.5 border border-sky-100 text-xs text-slate-700">
              <div className="text-center">
                <span className="block text-[10px] text-slate-500 font-medium">ASIN quét lượt này</span>
                <span className="font-mono text-sm font-extrabold text-slate-900">
                  {formatCount(latestRun?.asins_queried)}
                </span>
              </div>
              <div className="text-center sm:border-l border-slate-200">
                <span className="block text-[10px] text-slate-500 font-medium">Từ Khóa Thu Được</span>
                <span className="font-mono text-sm font-extrabold text-emerald-700">
                  +{formatCount(latestRun?.keywords_upserted)}
                </span>
              </div>
              <div className="text-center sm:border-l border-slate-200">
                <span className="block text-[10px] text-slate-500 font-medium">Lượt Cerebro (tháng)</span>
                <span className="font-mono text-sm font-bold text-slate-900">
                  {latestRun?.cerebro_calls ?? 0}
                  <span className="text-[10px] font-semibold text-slate-500">
                    {" "}· {formatCount(status?.budget.cerebroUsed)}/{formatCount(status?.budget.cerebroLimit)}
                  </span>
                </span>
              </div>
              <div className="text-center sm:border-l border-slate-200">
                <span className="block text-[10px] text-slate-500 font-medium">Thời Gian Chạy</span>
                <span className="font-mono text-sm font-bold text-sky-800">
                  {latestRun?.started_at ? formatElapsed(latestRun.started_at, nowMs) : "—"}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* NỘI DUNG TAB 1: ĐIỀU KHIỂN & TIẾN ĐỘ */}
        {activeTab === "overview" && (
          <div className="grid gap-3 sm:grid-cols-3">
            {/* Cột 1: Chọn Store & Nút Crawl / Dừng */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 flex flex-col justify-between">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1.5">
                  Chọn Store quét
                </label>
                <select
                  value={selectedStore}
                  onChange={(e) => setSelectedStore(e.target.value)}
                  disabled={isRunning}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-800 focus:border-sky-500 focus:outline-hidden"
                >
                  <option value="ALL">🌟 Tất cả các Store</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name} ({s.marketplace || "US"})
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-3 mt-3 border-t border-slate-200">
                {isRunning ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-sky-100 px-3 py-2 text-xs font-bold text-sky-800 border border-sky-300 cursor-not-allowed"
                    >
                      <CircleNotch size={14} className="animate-spin text-sky-600" />
                      <span>Đang crawl...</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleStopCrawl}
                      disabled={stopping}
                      className="flex items-center justify-center gap-1 rounded-lg bg-rose-600 hover:bg-rose-700 px-3 py-2 text-xs font-bold text-white shadow-xs transition cursor-pointer disabled:opacity-50"
                      title="Dừng tiến trình quét ngay lập tức"
                    >
                      {stopping ? <CircleNotch size={13} className="animate-spin" /> : <Stop size={13} weight="fill" />}
                      <span>Dừng</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleStartCrawl}
                    disabled={triggering}
                    className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-sky-700 disabled:opacity-50 shadow-2xs transition cursor-pointer"
                  >
                    <Play size={13} weight="fill" />
                    <span>{canResume ? `Chạy tiếp (còn ${formatCount(asins?.pending)} ASIN)` : "Chạy Crawl Ngay"}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Cột 2: Lịch tự động định kỳ */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-bold text-slate-700">Lịch tự động</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                    <CheckCircle size={10} weight="fill" /> Bật
                  </span>
                </div>
                <p className="text-xs font-black text-slate-900 mt-1">
                  03:00 Sáng • Ngày 03 hàng tháng
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Tự động chạy định kỳ 1 tháng / lần lúc vắng người, bảo toàn quota.
                </p>
              </div>

              <div className="pt-2 text-[10.5px] font-mono font-semibold text-slate-500">
                Cron: <span className="bg-white px-1.5 py-0.5 rounded border border-slate-200 text-slate-700">0 3 3 * *</span>
              </div>
            </div>

            {/* Cột 3: Trạng thái dữ liệu */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 flex flex-col justify-between">
              <div>
                <span className="text-[11px] font-bold text-slate-700 mb-1.5 block">
                  Trạng thái ({selectedStore})
                </span>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Keyword đã tra / tổng:</span>
                    <span className="font-mono font-bold text-emerald-700">
                      {formatCount(status?.coverage?.withVolume)} / {formatCount(status?.coverage?.keywords)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Keyword còn thiếu:</span>
                    <span className="font-mono font-bold text-amber-700">
                      {formatCount(status?.coverage?.missing)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">ASIN đã quét / tổng:</span>
                    <span className="font-mono font-bold text-emerald-700">
                      {formatCount(asins?.done)} / {formatCount(asins?.total)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">ASIN có Rank · lỗi bỏ qua:</span>
                    <span className="font-mono font-bold text-slate-700">
                      {formatCount(asins?.withRank)} · {formatCount(asins?.failed)}
                    </span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-slate-200 text-[11px]">
                    <span className="text-slate-500">Gần nhất:</span>
                    <span className="font-mono text-slate-700">
                      {status?.latestRun?.finished_at
                        ? new Date(status.latestRun.finished_at).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })
                        : (status?.latestRun?.status === "running" ? "Đang chạy..." : "Chưa có")}
                    </span>
                  </div>
                </div>
              </div>

              {status?.latestRun?.message && isRunning && (
                <div className="mt-2 p-1.5 rounded bg-sky-100 text-[10.5px] text-sky-800 font-semibold truncate animate-pulse">
                  {status.latestRun.message}
                </div>
              )}
            </div>
          </div>
        )}

        {/* NỘI DUNG TAB 2: LỊCH SỬ CÁC LƯỢT QUÉT */}
        {activeTab === "history" && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
            <div className="border-b border-slate-200 bg-slate-50/80 px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700">
                Lịch sử các lượt chạy gần nhất ({status?.recentRuns?.length || 0})
              </span>
              <span className="text-[11px] text-slate-500 font-medium">
                Tự động lưu lại số ASIN, từ khóa thu được và thông báo
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[11px] font-bold text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-3.5 py-2">Thời gian</th>
                    <th className="px-3 py-2">Store</th>
                    <th className="px-3 py-2">Trạng thái</th>
                    <th className="px-3 py-2 text-right">Lượt Cerebro</th>
                    <th className="px-3 py-2 text-right">ASIN đã quét</th>
                    <th className="px-3 py-2 text-right">Từ khóa thu được</th>
                    <th className="px-3.5 py-2">Ghi chú / Thông báo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(!status?.recentRuns || status.recentRuns.length === 0) ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-xs text-slate-400">
                        Chưa có lượt chạy nào được ghi nhận.
                      </td>
                    </tr>
                  ) : (
                    status.recentRuns.map((run) => {
                      const isRunRunning = run.status === "running";
                      const isSuccess = run.status === "completed";
                      const isFailed = run.status === "failed";
                      const isInterrupted = run.status === "interrupted";
                      return (
                        <tr key={run.id} className={isRunRunning ? "bg-sky-50/50" : "hover:bg-slate-50/70"}>
                          <td className="px-3.5 py-2.5 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                            <div>{new Date(run.started_at).toLocaleTimeString("vi-VN")}</div>
                            <div className="text-[10px] text-slate-400">{new Date(run.started_at).toLocaleDateString("vi-VN")}</div>
                          </td>
                          <td className="px-3 py-2.5 font-bold text-slate-800 whitespace-nowrap">
                            {run.store_name || "🌟 ALL Stores"}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            {isRunRunning && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10.5px] font-bold text-sky-800 animate-pulse">
                                <CircleNotch size={11} className="animate-spin" /> Đang chạy
                              </span>
                            )}
                            {isSuccess && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10.5px] font-bold text-emerald-800">
                                <CheckCircle size={11} weight="fill" /> Hoàn thành
                              </span>
                            )}
                            {isFailed && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10.5px] font-bold text-rose-800">
                                <XCircle size={11} weight="fill" /> Lỗi
                              </span>
                            )}
                            {isInterrupted && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-bold text-amber-800">
                                <Stop size={11} weight="fill" /> Tạm dừng (chạy tiếp được)
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono font-semibold text-slate-700">
                            {run.cerebro_calls}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono font-semibold text-slate-700">
                            {formatCount(run.asins_queried)}
                            {run.asins_total !== null && (
                              <div className="text-[10px] font-normal text-slate-400">
                                tổng {formatCount(run.asins_done)}/{formatCount(run.asins_total)}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono font-bold text-emerald-700">
                            +{run.keywords_upserted?.toLocaleString() ?? 0}
                          </td>
                          <td className="px-3.5 py-2.5 text-slate-600 text-[11px] max-w-[280px] truncate" title={run.message || ""}>
                            {run.message || "—"}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Modal Cấu hình Cookie */}
      <Helium10SettingsModal
        isOpen={showCookieModal}
        onClose={() => setShowCookieModal(false)}
        onSaved={() => {
          setNotice("Đã cập nhật Cookie Helium 10 thành công!");
          loadStatus(selectedStore);
        }}
      />
    </section>
  );
}
