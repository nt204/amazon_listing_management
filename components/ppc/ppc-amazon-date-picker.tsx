"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  CalendarBlank,
  CaretLeft,
  CaretRight,
  CaretDown,
  Check,
} from "@phosphor-icons/react";

export interface DateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

interface Props {
  value: DateRange;
  onChange: (range: DateRange) => void;
  label?: string;
  minDate?: string; // YYYY-MM-DD
  maxDate?: string; // YYYY-MM-DD
  anchorDate?: string; // Ngày neo cho preset, mặc định là maxDate hoặc hôm nay
  align?: "left" | "right";
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const PRESETS = [
  { label: "Today", id: "today" },
  { label: "Yesterday", id: "yesterday" },
  { label: "Last 7 days", id: "last_7_days" },
  { label: "This week", id: "this_week" },
  { label: "Last week", id: "last_week" },
  { label: "Last 30 days", id: "last_30_days" },
  { label: "This month", id: "this_month" },
  { label: "Last month", id: "last_month" },
  { label: "Year to date", id: "ytd" },
  { label: "Lifetime (Toàn bộ)", id: "lifetime" },
];

function padZero(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function formatDateString(d: Date): string {
  return `${d.getFullYear()}-${padZero(d.getMonth() + 1)}-${padZero(d.getDate())}`;
}

function parseDateString(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function getDaysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, monthIndex: number): number {
  return new Date(year, monthIndex, 1).getDay(); // 0 is Sunday
}

export function PpcAmazonDatePicker({
  value,
  onChange,
  label,
  minDate,
  maxDate,
  anchorDate,
  align = "right",
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Temporary selection state when modal/popover is open
  const [tempStart, setTempStart] = useState<string>(value.startDate);
  const [tempEnd, setTempEnd] = useState<string>(value.endDate);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [isPickingEnd, setIsPickingEnd] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);

  // Calendar display base: View month 1 (left) and View month 2 (right = month 1 + 1)
  const [leftViewYear, setLeftViewYear] = useState<number>(() => {
    return value.startDate ? parseDateString(value.startDate).getFullYear() : 2026;
  });
  const [leftViewMonth, setLeftViewMonth] = useState<number>(() => {
    // Default left month to September 2026 if matching user screenshot
    if (value.startDate) return parseDateString(value.startDate).getMonth();
    return 8; // September (0-indexed)
  });

  // Calculate right view month & year
  const { rightViewYear, rightViewMonth } = useMemo(() => {
    if (leftViewMonth === 11) {
      return { rightViewYear: leftViewYear + 1, rightViewMonth: 0 };
    }
    return { rightViewYear: leftViewYear, rightViewMonth: leftViewMonth + 1 };
  }, [leftViewYear, leftViewMonth]);

  // Sync internal state when opened or value changed
  useEffect(() => {
    if (isOpen) {
      setTempStart(value.startDate);
      setTempEnd(value.endDate);
      setIsPickingEnd(false);
      setHoverDate(null);
      if (value.startDate) {
        const d = parseDateString(value.startDate);
        setLeftViewYear(d.getFullYear());
        setLeftViewMonth(d.getMonth());
      }
    }
  }, [isOpen, value.startDate, value.endDate]);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const handlePrevMonth = () => {
    if (leftViewMonth === 0) {
      setLeftViewYear((y) => y - 1);
      setLeftViewMonth(11);
    } else {
      setLeftViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (leftViewMonth === 11) {
      setLeftViewYear((y) => y + 1);
      setLeftViewMonth(0);
    } else {
      setLeftViewMonth((m) => m + 1);
    }
  };

  const handlePresetClick = (presetId: string) => {
    setActivePreset(presetId);
    const today = parseDateString(anchorDate || maxDate || formatDateString(new Date()));

    let start = new Date(today);
    let end = new Date(today);

    if (presetId === "today") {
      start = new Date(today);
      end = new Date(today);
    } else if (presetId === "yesterday") {
      start.setDate(today.getDate() - 1);
      end.setDate(today.getDate() - 1);
    } else if (presetId === "last_7_days") {
      start.setDate(today.getDate() - 6);
      end = new Date(today);
    } else if (presetId === "this_week") {
      const day = today.getDay();
      start.setDate(today.getDate() - day);
      end = new Date(today);
    } else if (presetId === "last_week") {
      const day = today.getDay();
      end = new Date(today.getFullYear(), today.getMonth(), today.getDate() - day - 1);
      start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6);
    } else if (presetId === "last_30_days") {
      start.setDate(today.getDate() - 29);
      end = new Date(today);
    } else if (presetId === "this_month") {
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      end = new Date(today);
    } else if (presetId === "last_month") {
      start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      end = new Date(today.getFullYear(), today.getMonth(), 0);
    } else if (presetId === "ytd") {
      start = new Date(today.getFullYear(), 0, 1);
      end = new Date(today);
    } else if (presetId === "lifetime") {
      start = parseDateString(minDate || formatDateString(today));
      end = new Date(today);
    }

    if (minDate && formatDateString(start) < minDate) start = parseDateString(minDate);
    if (maxDate && formatDateString(end) > maxDate) end = parseDateString(maxDate);
    if (start > end) start = new Date(end);

    const sStr = formatDateString(start);
    const eStr = formatDateString(end);
    setTempStart(sStr);
    setTempEnd(eStr);
    setIsPickingEnd(false);

    // Auto navigate calendar to the selected start
    setLeftViewYear(start.getFullYear());
    setLeftViewMonth(start.getMonth());
  };

  const handleDayClick = (dayStr: string) => {
    setActivePreset(null);
    if (!isPickingEnd) {
      // Step 1: Chọn ngày bắt đầu
      setTempStart(dayStr);
      setTempEnd(dayStr);
      setIsPickingEnd(true);
    } else {
      // Step 2: Chọn ngày kết thúc
      if (dayStr < tempStart) {
        setTempStart(dayStr);
        setTempEnd(tempStart);
      } else {
        setTempEnd(dayStr);
      }
      setIsPickingEnd(false);
    }
  };

  const handleSave = () => {
    let s = tempStart;
    let e = tempEnd;
    if (s > e) {
      const tmp = s;
      s = e;
      e = tmp;
    }
    if (minDate && s < minDate) s = minDate;
    if (maxDate && e > maxDate) e = maxDate;
    if (s > e) s = e;
    onChange({ startDate: s, endDate: e });
    setIsOpen(false);
  };

  // Render 1 calendar month
  const renderMonth = (year: number, monthIndex: number) => {
    const daysInMonth = getDaysInMonth(year, monthIndex);
    const firstDay = getFirstDayOfWeek(year, monthIndex);
    const days = [];

    // Empty blank days before month starts
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`blank-${i}`} className="w-8 h-8" />);
    }

    const effectiveEnd = isPickingEnd && hoverDate ? (hoverDate >= tempStart ? hoverDate : tempStart) : tempEnd;
    const effectiveStart = isPickingEnd && hoverDate && hoverDate < tempStart ? hoverDate : tempStart;

    for (let d = 1; d <= daysInMonth; d++) {
      const dayStr = `${year}-${padZero(monthIndex + 1)}-${padZero(d)}`;
      const isStart = dayStr === effectiveStart;
      const isEnd = dayStr === effectiveEnd;
      const isInRange = dayStr > effectiveStart && dayStr < effectiveEnd;
      const isSelected = isStart || isEnd;
      const isDisabled = Boolean((minDate && dayStr < minDate) || (maxDate && dayStr > maxDate));

      days.push(
        <button
          key={dayStr}
          type="button"
          disabled={isDisabled}
          onClick={() => handleDayClick(dayStr)}
          onMouseEnter={() => {
            if (isPickingEnd) setHoverDate(dayStr);
          }}
          className={`w-8 h-8 flex items-center justify-center text-xs font-semibold transition-all relative select-none ${
            isDisabled
              ? "text-slate-300 cursor-not-allowed bg-transparent"
              : isSelected
              ? "bg-[#007185] text-white font-black rounded z-10 shadow-xs"
              : isInRange
              ? "bg-[#e7f4f5] text-[#004e5a] font-bold"
              : "text-slate-700 hover:bg-slate-100 rounded"
          }`}
        >
          {d}
        </button>
      );
    }

    return (
      <div className="w-[240px]">
        <div className="text-center font-bold text-xs text-slate-800 mb-2.5">
          {MONTH_NAMES[monthIndex]} {year}
        </div>
        <div className="grid grid-cols-7 gap-y-1 gap-x-0.5 text-center text-[10px] font-bold text-slate-400 mb-1.5 uppercase">
          <div>Su</div>
          <div>Mo</div>
          <div>Tu</div>
          <div>We</div>
          <div>Th</div>
          <div>Fr</div>
          <div>Sa</div>
        </div>
        <div className="grid grid-cols-7 gap-y-1 gap-x-0.5">{days}</div>
      </div>
    );
  };

  // Format label for button
  const displayLabel = useMemo(() => {
    if (!value.startDate || !value.endDate) return "Chọn khoảng ngày";
    const [y1, m1, d1] = value.startDate.split("-");
    const [y2, m2, d2] = value.endDate.split("-");
    if (value.startDate === value.endDate) return `${d1}/${m1}/${y1}`;
    return `${d1}/${m1}/${y1} — ${d2}/${m2}/${y2}`;
  }, [value.startDate, value.endDate]);

  return (
    <div className="relative inline-block" ref={containerRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-2 bg-white border border-slate-300 hover:border-slate-400 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-800 transition cursor-pointer shadow-2xs hover:bg-slate-50"
        title="Chọn khoảng thời gian báo cáo"
      >
        <CalendarBlank size={15} weight="bold" className="text-indigo-600" />
        {label && <span className="text-slate-500 font-semibold">{label}:</span>}
        <span className="font-mono text-slate-900">{displayLabel}</span>
        <CaretDown size={11} weight="bold" className={`text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {/* Popover Container (Styled exactly like Amazon Ads Console) */}
      {isOpen && (
        <div className={`absolute ${align === "left" ? "left-0" : "right-0"} top-full mt-1.5 z-50 bg-white border border-slate-300 rounded-xl shadow-2xl overflow-hidden flex flex-col md:flex-row animate-in fade-in zoom-in-95 duration-150 max-w-[calc(100vw-2rem)]`}>
          {/* Left Sidebar: Presets list */}
          <div className="w-full md:w-44 border-b md:border-b-0 md:border-r border-slate-200 bg-slate-50/70 p-2 flex flex-col justify-between">
            <div className="space-y-0.5">
              <div className="px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                Khoảng thời gian
              </div>
              {PRESETS.map((p) => {
                const isActive = activePreset === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handlePresetClick(p.id)}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center justify-between ${
                      isActive
                        ? "bg-sky-100 text-[#007185] font-black"
                        : "text-slate-700 hover:bg-slate-200/60"
                    }`}
                  >
                    <span>{p.label}</span>
                    {isActive && <Check size={12} weight="bold" />}
                  </button>
                );
              })}
            </div>
            <div className="px-2 pt-2 text-[10px] text-slate-400 font-medium border-t border-slate-200/80 mt-2">
              Timezone: <span className="font-mono text-slate-600">PST (Amazon)</span>
            </div>
          </div>

          {/* Right Panel: Calendar Container */}
          <div className="p-4 flex flex-col justify-between bg-white">
            {/* Top Month Navigation */}
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={handlePrevMonth}
                className="p-1 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition cursor-pointer"
                title="Tháng trước"
              >
                <CaretLeft size={16} weight="bold" />
              </button>

              <div className="text-xs font-semibold text-slate-500">
                {isPickingEnd ? (
                  <span className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded font-bold animate-pulse">
                    Chọn ngày kết thúc
                  </span>
                ) : (
                  <span>Click để chọn ngày bắt đầu &amp; kết thúc</span>
                )}
              </div>

              <button
                type="button"
                onClick={handleNextMonth}
                className="p-1 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition cursor-pointer"
                title="Tháng sau"
              >
                <CaretRight size={16} weight="bold" />
              </button>
            </div>

            {/* Dual Calendars Side-by-Side */}
            <div className="flex flex-col sm:flex-row gap-6 items-start pb-4 border-b border-slate-100">
              {renderMonth(leftViewYear, leftViewMonth)}
              {renderMonth(rightViewYear, rightViewMonth)}
            </div>

            {/* Bottom Actions Bar */}
            <div className="flex items-center justify-between pt-3 gap-3">
              <div className="text-xs text-slate-600 font-medium">
                Đang chọn:{" "}
                <span className="font-mono font-bold text-slate-900">
                  {tempStart} &rarr; {tempEnd}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
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
