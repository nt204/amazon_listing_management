"use client";

import { useEffect, useRef, useState } from "react";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { ui } from "./fulfill-ui";

// Lịch chọn tháng (kiểu month picker): điều hướng năm, lưới 12 tháng.
// Bấm 1 tháng = chọn tháng đó; bấm tiếp tháng khác = thành khoảng (tự sắp đầu/cuối). Áp dụng bằng nút Apply.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const key = (year: number, month: number) => `${year}-${String(month + 1).padStart(2, "0")}`;

export function MonthRangePicker({
  id,
  from,
  to,
  onApply,
  onClose,
}: {
  id?: string;
  from: string;
  to: string;
  onApply: (from: string, to: string) => void;
  onClose: () => void;
}) {
  const now = new Date();
  const thisMonth = key(now.getFullYear(), now.getMonth());
  const ref = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState(from || to || "");
  const [end, setEnd] = useState(to || from || "");
  const [picking, setPicking] = useState(false);
  const [hover, setHover] = useState("");
  const [year, setYear] = useState(Number((to || from || thisMonth).slice(0, 4)));

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("[data-selected=true], [data-current=true]")?.focus();
    const onDown = (event: MouseEvent) => {
      const anchor = ref.current?.parentElement;
      if (anchor && !anchor.contains(event.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  const pick = (k: string) => {
    if (!picking || !start) {
      setStart(k);
      setEnd(k);
      setPicking(true);
    } else {
      const [a, b] = k < start ? [k, start] : [start, k];
      setStart(a);
      setEnd(b);
      setPicking(false);
    }
  };

  // Khi đang chọn khoảng, rê chuột để xem trước khoảng
  const lo = picking && hover ? (hover < start ? hover : start) : start;
  const hi = picking && hover ? (hover < start ? start : hover) : end;

  const label = (k: string) => `${MONTHS[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`;

  return (
    <div
      ref={ref}
      id={id}
      role="dialog"
      aria-label="Choose request month"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
      className="animate-ff-popover origin-top-left absolute top-full left-0 z-30 mt-2 w-[min(320px,calc(100vw-2rem))] rounded-xl border border-(--ff-line) bg-(--ff-card) p-3 shadow-[0_12px_32px_rgba(15,23,42,0.14)]"
    >
      <div className="flex items-center justify-between">
        <button type="button" className={ui.iconBtn} onClick={() => setYear((y) => y - 1)} aria-label="Previous year">
          <CaretLeftIcon size={16} aria-hidden />
        </button>
        <span className="text-sm font-semibold tabular-nums">{year}</span>
        <button type="button" className={ui.iconBtn} onClick={() => setYear((y) => y + 1)} aria-label="Next year">
          <CaretRightIcon size={16} aria-hidden />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-1" onMouseLeave={() => setHover("")}>
        {MONTHS.map((name, index) => {
          const k = key(year, index);
          const edge = k === lo || k === hi;
          const inside = lo && hi && k > lo && k < hi;
          return (
            <button
              key={k}
              type="button"
              data-selected={edge}
              data-current={k === thisMonth}
              aria-pressed={edge || Boolean(inside)}
              onClick={() => pick(k)}
              onMouseEnter={() => setHover(k)}
              className={`flex h-10 cursor-pointer items-center justify-center rounded-lg text-sm motion-safe:active:scale-95 transition-[background-color,color,scale] duration-150 ease focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--ff-accent) ${
                edge
                  ? "bg-(--ff-accent) font-semibold text-white"
                  : inside
                    ? "bg-(--ff-accent-soft) text-(--ff-accent)"
                    : k === thisMonth
                      ? "font-semibold text-(--ff-accent) ring-1 ring-(--ff-accent)/40 ring-inset hover:bg-(--ff-raised)"
                      : "text-(--ff-text) hover:bg-(--ff-raised)"
              }`}
            >
              {name}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-(--ff-line) pt-3">
        <span className="text-xs text-(--ff-muted)" aria-live="polite">
          {!start ? "Pick a month" : picking ? `${label(start)} – …` : start === end ? label(start) : `${label(start)} – ${label(end)}`}
        </span>
        <div className="flex items-center gap-2">
          <button type="button" className={`${ui.link} whitespace-nowrap`} onClick={() => onApply("", "")}>All months</button>
          <button type="button" className={`${ui.btnPrimary} min-h-8 px-4`} disabled={!start} onClick={() => onApply(start, end || start)}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
