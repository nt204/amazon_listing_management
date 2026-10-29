"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ArrowsClockwise,
  CheckCircle,
  CircleNotch,
  Gear,
  Lightning,
  Play,
  WarningCircle,
} from "@phosphor-icons/react";
import { Helium10SettingsModal } from "@/components/helium10-settings-modal";

interface StoreItem {
  id: string;
  name: string;
  marketplace: string;
}

interface SearchVolumeStatusResponse {
  latestRun: {
    id: string;
    status: string;
    cerebro_calls: number;
    magnet_calls: number;
    asins_queried: number;
    keywords_upserted: number;
    message: string | null;
    started_at: string;
    finished_at: string | null;
  } | null;
  coverage: {
    keywords: number;
    withVolume: number;
    missing: number;
  };
  budget: {
    cerebroUsed: number;
    cerebroLimit: number;
    magnetUsed: number;
    magnetLimit: number;
  };
}

export function AdminHelium10SyncPanel() {
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [selectedStore, setSelectedStore] = useState<string>("ALL");
  const [status, setStatus] = useState<SearchVolumeStatusResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [showCookieModal, setShowCookieModal] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    loadStatus(selectedStore);
  }, [selectedStore, loadStatus]);

  // Polling if sync is running
  useEffect(() => {
    if (status?.latestRun?.status === "running") {
      const interval = setInterval(() => {
        loadStatus(selectedStore);
      }, 3000);
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

  const isRunning = status?.latestRun?.status === "running";

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

        {/* 3 Thẻ thiết lập chính: Chọn Store & Crawl | Lịch tự động | Số liệu */}
        <div className="grid gap-3 sm:grid-cols-3">
          {/* Cột 1: Chọn Store & Nút Crawl */}
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
              <button
                type="button"
                onClick={handleStartCrawl}
                disabled={isRunning || triggering}
                className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-sky-700 disabled:opacity-50 shadow-2xs transition cursor-pointer"
              >
                {isRunning ? (
                  <>
                    <CircleNotch size={14} className="animate-spin" />
                    <span>Đang crawl...</span>
                  </>
                ) : (
                  <>
                    <Play size={13} weight="fill" />
                    <span>Chạy Crawl Ngay</span>
                  </>
                )}
              </button>
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
                  <span className="text-slate-500">Đã có Volume:</span>
                  <span className="font-mono font-bold text-emerald-700">
                    {status?.coverage?.withVolume?.toLocaleString() ?? "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Còn thiếu:</span>
                  <span className="font-mono font-bold text-amber-700">
                    {status?.coverage?.missing?.toLocaleString() ?? "—"}
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
