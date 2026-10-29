"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowsClockwise, CircleNotch, TrendDown, TrendUp } from "@phosphor-icons/react";
import type { SearchVolumeStatus } from "@/lib/ppc/search-volume";

function formatVolume(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}K`;
  return value.toLocaleString("en-US");
}

/** Ô Search Volume (Helium 10): volume tháng + trend, dòng phụ là impression share ước tính kèm Organic/Sponsored Rank. */
export function PpcSearchVolumeCell({
  searchVolume,
  searchVolumeTrend,
  estImpressionShare,
  organicRank,
  sponsoredRank,
  className = "px-3 py-2.5",
}: {
  searchVolume?: number | null;
  searchVolumeTrend?: number | null;
  estImpressionShare?: number | null;
  organicRank?: number | null;
  sponsoredRank?: number | null;
  className?: string;
}) {
  const hasRank = organicRank !== null && organicRank !== undefined || sponsoredRank !== null && sponsoredRank !== undefined;

  if (!searchVolume && !hasRank) {
    return (
      <td className={`${className} text-right font-mono text-slate-300 whitespace-nowrap`} title="Chưa có Search Volume từ Helium 10">
        —
      </td>
    );
  }

  const trend = searchVolumeTrend ?? null;
  const share = estImpressionShare ?? null;
  return (
    <td
      className={`${className} text-right font-mono whitespace-nowrap`}
      title={`Search Volume tháng (Helium 10): ${searchVolume ? searchVolume.toLocaleString("en-US") : "—"}${
        trend !== null ? ` · Trend 30 ngày: ${trend > 0 ? "+" : ""}${trend}%` : ""
      }${share !== null ? ` · Impression share ước tính: ${share}% (impressions ÷ volume theo số ngày của kỳ)` : ""}${
        organicRank ? ` · Organic Rank: #${organicRank}` : ""
      }${sponsoredRank ? ` · Sponsored Rank: #${sponsoredRank}` : ""}`}
    >
      <div className="inline-flex items-center gap-1 text-slate-800">
        {searchVolume ? formatVolume(searchVolume) : "—"}
        {trend !== null && trend !== 0 && (
          trend > 0
            ? <TrendUp size={11} weight="bold" className="text-emerald-600" />
            : <TrendDown size={11} weight="bold" className="text-rose-500" />
        )}
      </div>

      {hasRank && (
        <div className="flex items-center justify-end gap-1 mt-0.5 text-[9.5px]">
          {organicRank && (
            <span className="px-1 py-0.2 rounded bg-emerald-50 text-emerald-700 font-bold border border-emerald-200" title={`Organic Rank #${organicRank}`}>
              Org #{organicRank}
            </span>
          )}
          {sponsoredRank && (
            <span className="px-1 py-0.2 rounded bg-amber-50 text-amber-700 font-bold border border-amber-200" title={`Sponsored Rank #${sponsoredRank}`}>
              Sp #{sponsoredRank}
            </span>
          )}
        </div>
      )}

      {share !== null && !hasRank && (
        <div className="text-[10px] text-slate-400">IS ~{share > 100 ? ">100" : share}%</div>
      )}
    </td>
  );
}

async function fetchSearchVolumeStatus(storeName: string): Promise<SearchVolumeStatus> {
  const res = await fetch(`/api/ppc/search-volume?storeName=${encodeURIComponent(storeName)}`, { cache: "no-store" });
  const json = await res.json();
  if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
  return json.data;
}

/** Nút đồng bộ Search Volume từ Helium 10 + trạng thái lượt chạy gần nhất / hạn mức tháng. */
export function PpcSearchVolumeSyncButton({ storeName, canWrite = true }: { storeName: string; canWrite?: boolean }) {
  const [status, setStatus] = useState<SearchVolumeStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(() => {
    fetchSearchVolumeStatus(storeName)
      .then((data) => {
        setStatus(data);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [storeName]);

  const isRunning = status?.latestRun?.status === "running";

  useEffect(() => {
    let cancelled = false;
    fetchSearchVolumeStatus(storeName)
      .then((data) => {
        if (!cancelled) setStatus(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [storeName]);

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(loadStatus, 5000);
    return () => window.clearInterval(timer);
  }, [isRunning, loadStatus]);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/ppc/search-volume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeName }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
      loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const run = status?.latestRun;
  const coverage = status?.coverage;
  const budget = status?.budget;
  const coveragePct = coverage && coverage.keywords > 0 ? Math.round((coverage.withVolume / coverage.keywords) * 100) : null;

  return (
    <div className="flex items-center gap-2 text-[11px]">
      <button
        type="button"
        onClick={start}
        disabled={!canWrite || starting || isRunning}
        className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 font-bold text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
        title={
          budget
            ? `Lấy Search Volume từ Helium 10 (Cerebro theo ASIN + Magnet lấp keyword thiếu). Hạn mức tháng: Cerebro ${budget.cerebroUsed}/${budget.cerebroLimit}, Magnet ${budget.magnetUsed}/${budget.magnetLimit}`
            : "Lấy Search Volume từ Helium 10"
        }
      >
        {starting || isRunning ? <CircleNotch size={13} className="animate-spin" /> : <ArrowsClockwise size={13} weight="bold" />}
        {isRunning ? "Đang lấy Search Volume..." : "Đồng bộ Search Volume"}
      </button>
      <span
        className={`max-w-[360px] truncate ${error || run?.status === "failed" ? "text-rose-600" : "text-slate-500"}`}
        title={error || run?.message || undefined}
      >
        {error
          ? error
          : isRunning
            ? run?.message
            : coveragePct !== null
              ? `Có volume ${coveragePct}% (${coverage!.withVolume.toLocaleString("vi-VN")}/${coverage!.keywords.toLocaleString("vi-VN")} keyword)${
                  run?.status === "failed" ? " · Lượt gần nhất lỗi" : ""
                }`
              : null}
      </span>
    </div>
  );
}
