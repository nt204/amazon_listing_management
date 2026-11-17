"use client";

import { useEffect, useRef, useState } from "react";
import { SKU_METRICS, parseMetricRanges, type MetricRanges } from "@/lib/ppc/manual-bid";
import { RangeRow } from "./ppc-manual-bid-view";

/**
 * Nút "Lọc": lọc dòng theo khoảng Spend / Sales / ACOS / Click / Order / CPC / CVR (từ – đến).
 * Dùng chung cho tab Đề xuất, Manual Bid và các tab PPC Dashboard.
 */
export function PpcMetricRangeFilter({
  value,
  onChange,
  className = "",
}: {
  value: MetricRanges;
  onChange: (next: MetricRanges) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activeCount = parseMetricRanges(value).length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition cursor-pointer shadow-2xs ${
          open || activeCount > 0
            ? "border-slate-800 bg-white text-slate-900"
            : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
        }`}
      >
        Lọc
        {activeCount > 0 && (
          <span className="rounded-full bg-slate-800 px-1.5 text-[10.5px] font-bold text-white">{activeCount}</span>
        )}
        <span className="text-[9px] text-slate-400">▼</span>
      </button>
      {open && (
        <div className="absolute left-0 top-9 z-40 w-80 space-y-1.5 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
          <div className="grid grid-cols-[1fr_76px_10px_76px] items-center gap-1 text-[10.5px] font-semibold text-slate-400">
            <span />
            <span className="text-center">từ</span>
            <span />
            <span className="text-center">đến</span>
          </div>
          {SKU_METRICS.map((m) => (
            <RangeRow
              key={m.key}
              label={m.label}
              unit={m.unit}
              value={value[m.key] || { min: "", max: "" }}
              onChange={(r) => onChange({ ...value, [m.key]: r })}
            />
          ))}
          {activeCount > 0 && (
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => onChange({})}
                className="cursor-pointer text-[12px] font-semibold text-slate-400 hover:text-slate-700"
              >
                Xoá lọc
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
