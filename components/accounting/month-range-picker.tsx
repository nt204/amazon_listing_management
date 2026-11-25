"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarBlankIcon, CaretDownIcon, CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";

// Chọn tháng / khoảng tháng trong 1 năm (Báo cáo tháng SKU). Cùng kiểu với bộ chọn ngày ở bảng ngày
// (components/ppc/ppc-amazon-date-picker.tsx) nhưng là lưới 12 tháng: bấm tháng đầu rồi tháng cuối, Apply.

export interface MonthRangeValue {
  year: number;
  /** "all" = cả năm (YTD) */
  from: number | "all";
  /** null = chỉ 1 tháng */
  to: number | null;
}

interface MonthRangePickerProps {
  value: MonthRangeValue;
  onChange: (value: MonthRangeValue) => void;
  /** Số SKU từng tháng của năm đang xem (tháng không có = chưa có số) */
  monthSkus?: Record<number, number>;
  /** Năm có trong `monthSkus` */
  monthSkusYear?: number;
}

const monthLabel = (v: MonthRangeValue) =>
  v.from === "all"
    ? `Cả năm ${v.year} (YTD)`
    : v.to != null && v.to > v.from
    ? `Tháng ${v.from} — Tháng ${v.to}/${v.year}`
    : `Tháng ${v.from}/${v.year}`;

function lastSelectableMonth(year: number) {
  const now = new Date();
  return year < now.getFullYear() ? 12 : year === now.getFullYear() ? now.getMonth() + 1 : 0;
}

export function MonthRangePicker({ value, onChange, monthSkus, monthSkusYear }: MonthRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<MonthRangeValue>(value);
  // Đã bấm tháng đầu, đang chờ bấm tháng cuối
  const [picking, setPicking] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const toggle = () => {
    if (!open) {
      setDraft(value);
      setPicking(false);
    }
    setOpen(!open);
  };

  const apply = (v: MonthRangeValue) => {
    onChange(v);
    setOpen(false);
  };

  const pick = (m: number) => {
    if (!picking || draft.from === "all") {
      setDraft({ year: draft.year, from: m, to: null });
      setPicking(true);
      return;
    }
    const a = Math.min(draft.from, m);
    const b = Math.max(draft.from, m);
    setDraft({ year: draft.year, from: a, to: b > a ? b : null });
    setPicking(false);
  };

  const maxMonth = lastSelectableMonth(draft.year);
  const skus = monthSkusYear === draft.year ? monthSkus : undefined;
  // Tháng có số gần nhất của năm đang xem (cho lựa chọn nhanh)
  const latest = skus ? Math.max(0, ...Object.keys(skus).map(Number)) || maxMonth : maxMonth;

  const presets: Array<{ label: string; v: MonthRangeValue | null }> = [
    { label: "Tháng gần nhất", v: latest ? { year: draft.year, from: latest, to: null } : null },
    { label: "3 tháng gần nhất", v: latest ? { year: draft.year, from: Math.max(1, latest - 2), to: latest > 1 ? latest : null } : null },
    { label: "6 tháng gần nhất", v: latest ? { year: draft.year, from: Math.max(1, latest - 5), to: latest > 1 ? latest : null } : null },
    { label: "Cả năm (YTD)", v: { year: draft.year, from: "all", to: null } },
  ];

  const inDraft = (m: number) =>
    draft.from === "all" ? m <= maxMonth : draft.to != null ? m >= draft.from && m <= draft.to : m === draft.from;
  const isEdge = (m: number) => draft.from !== "all" && (m === draft.from || m === draft.to);

  return (
    <div ref={ref} className={`relative inline-block ${open ? "z-[100]" : ""}`}>
      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-1.5 bg-white border border-slate-300 hover:border-slate-400 rounded-lg px-2.5 py-1 text-xs font-bold text-slate-800 transition cursor-pointer shadow-2xs"
      >
        <CalendarBlankIcon size={15} weight="bold" className="text-amber-600" />
        <span>{monthLabel(value)}</span>
        <CaretDownIcon size={11} weight="bold" className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-[100] flex bg-white border border-slate-300 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          <div className="w-40 border-r border-slate-200 bg-slate-50/70 p-2 space-y-0.5">
            <div className="px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Khoảng tháng</div>
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                disabled={!p.v}
                onClick={() => p.v && apply(p.v)}
                className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-700 hover:bg-white hover:text-slate-900 transition cursor-pointer disabled:cursor-not-allowed disabled:text-slate-300"
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="p-4 w-[300px]">
            <div className="flex items-center justify-between mb-3">
              <button
                type="button"
                aria-label="Năm trước"
                onClick={() => {
                  setDraft({ year: draft.year - 1, from: "all", to: null });
                  setPicking(false);
                }}
                className="p-1 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition cursor-pointer"
              >
                <CaretLeftIcon size={16} weight="bold" />
              </button>
              <div className="text-center">
                <div className="text-sm font-bold text-slate-800">{draft.year}</div>
                <div className="text-[11px] font-semibold text-slate-500">
                  {picking ? <span className="text-amber-700">Bấm tháng kết thúc</span> : "Bấm tháng bắt đầu & kết thúc"}
                </div>
              </div>
              <button
                type="button"
                aria-label="Năm sau"
                disabled={lastSelectableMonth(draft.year + 1) === 0}
                onClick={() => {
                  setDraft({ year: draft.year + 1, from: "all", to: null });
                  setPicking(false);
                }}
                className="p-1 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition cursor-pointer disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
              >
                <CaretRightIcon size={16} weight="bold" />
              </button>
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                const disabled = m > maxMonth;
                const count = skus?.[m];
                const selected = !disabled && inDraft(m);
                return (
                  <button
                    key={m}
                    type="button"
                    disabled={disabled}
                    onClick={() => pick(m)}
                    title={count != null ? `${count} SKU` : skus ? "Chưa có số" : undefined}
                    className={`flex h-12 flex-col items-center justify-center rounded-lg text-xs font-bold transition cursor-pointer disabled:cursor-not-allowed ${
                      disabled
                        ? "text-slate-300"
                        : isEdge(m)
                        ? "bg-[#007185] text-white"
                        : selected
                        ? "bg-[#e6f2f4] text-[#00505e]"
                        : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <span>Tháng {m}</span>
                    {skus && !disabled && (
                      <span className={`text-[10px] font-semibold ${isEdge(m) ? "text-white/80" : "text-slate-400"}`}>
                        {count != null ? `${count} SKU` : "—"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-100 mt-4 pt-3">
              <div className="text-xs text-slate-600">
                Đang chọn: <span className="font-bold text-slate-900">{monthLabel(draft)}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => apply(draft)}
                  className="px-4 py-1.5 rounded-lg bg-[#007185] hover:bg-[#005a6a] text-white text-xs font-extrabold shadow-2xs transition cursor-pointer"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
