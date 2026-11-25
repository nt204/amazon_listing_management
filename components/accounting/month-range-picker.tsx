"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarBlankIcon, CaretDownIcon, CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";

// Chọn tháng / khoảng tháng trong 1 năm (Báo cáo tháng SKU): lưới 12 tháng, bấm tháng đầu rồi tháng cuối, Apply.

export interface MonthRangeValue {
  year: number;
  /** "all" = cả năm (YTD) — giá trị cũ còn lưu ở trình duyệt */
  from: number | "all";
  /** null = chỉ 1 tháng */
  to: number | null;
}

interface MonthRangePickerProps {
  value: MonthRangeValue;
  onChange: (value: MonthRangeValue) => void;
}

const monthLabel = (v: MonthRangeValue) =>
  v.from === "all"
    ? `Cả năm ${v.year}`
    : v.to != null && v.to > v.from
    ? `Tháng ${v.from} — Tháng ${v.to}/${v.year}`
    : `Tháng ${v.from}/${v.year}`;

function lastSelectableMonth(year: number) {
  const now = new Date();
  return year < now.getFullYear() ? 12 : year === now.getFullYear() ? now.getMonth() + 1 : 0;
}

export function MonthRangePicker({ value, onChange }: MonthRangePickerProps) {
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

  const changeYear = (year: number) => {
    setDraft({ year, from: Math.min(lastSelectableMonth(year), 12) || 1, to: null });
    setPicking(false);
  };

  const maxMonth = lastSelectableMonth(draft.year);
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
        <div className="absolute left-0 top-full mt-1.5 z-[100] w-[380px] bg-white border border-slate-300 rounded-xl shadow-2xl p-5 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between mb-4">
            <button
              type="button"
              aria-label="Năm trước"
              onClick={() => changeYear(draft.year - 1)}
              className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition cursor-pointer"
            >
              <CaretLeftIcon size={18} weight="bold" />
            </button>
            <div className="text-base font-bold text-slate-900">{draft.year}</div>
            <button
              type="button"
              aria-label="Năm sau"
              disabled={lastSelectableMonth(draft.year + 1) === 0}
              onClick={() => changeYear(draft.year + 1)}
              className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition cursor-pointer disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
            >
              <CaretRightIcon size={18} weight="bold" />
            </button>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
              const disabled = m > maxMonth;
              const selected = !disabled && inDraft(m);
              return (
                <button
                  key={m}
                  type="button"
                  disabled={disabled}
                  onClick={() => pick(m)}
                  className={`h-12 rounded-lg text-sm font-bold transition cursor-pointer disabled:cursor-not-allowed ${
                    disabled
                      ? "text-slate-300"
                      : isEdge(m)
                      ? "bg-[#007185] text-white"
                      : selected
                      ? "bg-[#e6f2f4] text-[#00505e]"
                      : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  Tháng {m}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-100 mt-5 pt-4">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(draft);
                setOpen(false);
              }}
              className="px-5 py-2 rounded-lg bg-[#007185] hover:bg-[#005a6a] text-white text-sm font-extrabold shadow-2xs transition cursor-pointer"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
