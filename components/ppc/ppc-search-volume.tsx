"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowsClockwise, CircleNotch, TrendDown, TrendUp } from "@phosphor-icons/react";
import type { SearchVolumeStatus } from "@/lib/ppc/search-volume";

function formatVolume(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}K`;
  return value.toLocaleString("en-US");
}

/** Cột 1: Search Volume (SV) */
export function PpcSearchVolumeCell({
  searchVolume,
  searchVolumeTrend,
  estImpressionShare,
  className = "px-3 py-2.5",
}: {
  searchVolume?: number | null;
  searchVolumeTrend?: number | null;
  estImpressionShare?: number | null;
  className?: string;
}) {
  if (!searchVolume) {
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
      title={`Search Volume tháng (Helium 10): ${searchVolume.toLocaleString("en-US")}${
        trend !== null ? ` · Trend 30 ngày: ${trend > 0 ? "+" : ""}${trend}%` : ""
      }${share !== null ? ` · Impression share ước tính: ${share}%` : ""}`}
    >
      <div className="inline-flex items-center gap-1 text-slate-800">
        {formatVolume(searchVolume)}
        {trend !== null && trend !== 0 && (
          trend > 0
            ? <TrendUp size={11} weight="bold" className="text-emerald-600" />
            : <TrendDown size={11} weight="bold" className="text-rose-500" />
        )}
      </div>
      {share !== null && (
        <div className="text-[10px] text-slate-400">IS ~{share > 100 ? ">100" : share}%</div>
      )}
    </td>
  );
}

/** Cột 2: Organic Rank */
export function PpcOrganicRankCell({
  organicRank,
  className = "px-3 py-2.5",
}: {
  organicRank?: number | null;
  className?: string;
}) {
  if (!organicRank) {
    return (
      <td className={`${className} text-center font-mono text-slate-300 whitespace-nowrap`} title="Không nằm trong top Organic hoặc chưa quét">
        —
      </td>
    );
  }

  return (
    <td className={`${className} text-center whitespace-nowrap`}>
      <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-bold border border-emerald-200 text-[11px] font-mono" title={`Organic Rank: #${organicRank}`}>
        #{organicRank}
      </span>
    </td>
  );
}

/** Cột 3: Sponsored Rank */
export function PpcSponsoredRankCell({
  sponsoredRank,
  className = "px-3 py-2.5",
}: {
  sponsoredRank?: number | null;
  className?: string;
}) {
  if (!sponsoredRank) {
    return (
      <td className={`${className} text-center font-mono text-slate-300 whitespace-nowrap`} title="Không chạy ads hoặc chưa quét">
        —
      </td>
    );
  }

  return (
    <td className={`${className} text-center whitespace-nowrap`}>
      <span className="inline-block px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-bold border border-amber-200 text-[11px] font-mono" title={`Sponsored Rank: #${sponsoredRank}`}>
        #{sponsoredRank}
      </span>
    </td>
  );
}

async function fetchSearchVolumeStatus(storeName: string): Promise<SearchVolumeStatus> {
  const res = await fetch(`/api/ppc/search-volume?storeName=${encodeURIComponent(storeName)}`, { cache: "no-store" });
  const json = await res.json();
  if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
  return json.data;
}

export function PpcSearchVolumeSyncButton({ storeName, canWrite = true }: { storeName: string; canWrite?: boolean }) {
  const [status, setStatus] = useState<SearchVolumeStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetchSearchVolumeStatus(storeName)
      .then(setStatus)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [storeName]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (status?.latestRun?.status === "running") {
      const timer = setInterval(() => {
        fetchSearchVolumeStatus(storeName)
          .then(setStatus)
          .catch(() => {});
      }, 15_000);
      return () => clearInterval(timer);
    }
  }, [status?.latestRun?.status, storeName]);

  const handleStart = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/ppc/search-volume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeName }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const isRunning = status?.latestRun?.status === "running";
  const withVolume = status?.coverage.withVolume || 0;
  const missing = status?.coverage.missing || 0;
  const lastRun = status?.latestRun;
  const runProblem = !isRunning && (lastRun?.status === "interrupted" || lastRun?.status === "failed") ? lastRun.message : null;

  return (
    <div className="relative inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={handleStart}
        disabled={!canWrite || isRunning || submitting}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer shadow-2xs"
        title={
          isRunning
            ? status?.latestRun?.message || "Đang đồng bộ..."
            : `Đã có volume: ${withVolume.toLocaleString()} · Còn thiếu: ${missing.toLocaleString()} · Cerebro ${status?.budget.cerebroUsed || 0}/${status?.budget.cerebroLimit || 0}`
        }
      >
        {isRunning || submitting ? (
          <CircleNotch size={13} className="animate-spin text-indigo-600" />
        ) : (
          <ArrowsClockwise size={13} />
        )}
        <span>{isRunning ? "Đang đồng bộ..." : "Đồng bộ SV"}</span>
      </button>

      {error ? (
        <span className="text-[10px] text-rose-600 max-w-[140px] truncate" title={error}>
          {error}
        </span>
      ) : runProblem ? (
        <span className="text-[10px] text-amber-700 max-w-[160px] truncate" title={runProblem}>
          Tạm dừng: {runProblem}
        </span>
      ) : null}
    </div>
  );
}
