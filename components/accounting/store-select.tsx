"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CaretDownIcon, CheckIcon, MagnifyingGlassIcon, StorefrontIcon } from "@phosphor-icons/react";

// Ô chọn store dùng chung cho các tab Accounting (thay <select> mặc định của trình duyệt):
// nút có icon store + tên store, bấm mở danh sách nổi chữ to, store đang chọn tô nền + dấu ✓.
// Bàn phím: ↑ ↓ di chuyển, Enter chọn, Esc đóng. Nhiều store (> 8) thì có ô tìm.

export interface StoreSelectOption {
  id: string;
  name: string;
}

interface StoreSelectProps {
  stores: StoreSelectOption[];
  value: string;
  onChange: (id: string) => void;
  loading?: boolean;
  disabled?: boolean;
  /** Dòng đặc biệt ở đầu danh sách, vd { id: "__all__", name: "Tất cả store" } */
  allOption?: StoreSelectOption;
  id?: string;
  /** sm: thanh công cụ gọn (h-8, chữ 12px) · md: h-9, chữ 14px */
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
}

export function StoreSelect({
  stores,
  value,
  onChange,
  loading = false,
  disabled = false,
  allOption,
  id,
  size = "md",
  className = "",
  "aria-label": ariaLabel = "Chọn store",
}: StoreSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const options = useMemo(() => (allOption && stores.length > 1 ? [allOption, ...stores] : stores), [allOption, stores]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;
  }, [options, query]);
  // Chỉ 1 store thì dòng "Tất cả" ẩn khỏi danh sách nhưng nút vẫn hiện đúng tên khi đang chọn nó
  const current = options.find((o) => o.id === value) ?? (allOption?.id === value ? allOption : undefined);
  const label = loading ? "Đang tải store..." : stores.length === 0 ? "Không có store" : current?.name || "Chọn store";
  const isDisabled = disabled || loading || stores.length === 0;
  const showSearch = options.length > 8;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  // Giữ dòng đang trỏ trong khung nhìn khi đi bằng phím
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const openList = () => {
    if (isDisabled) return;
    setQuery("");
    setActive(Math.max(0, options.findIndex((o) => o.id === value)));
    setOpen(true);
  };

  const choose = (o: StoreSelectOption) => {
    setOpen(false);
    if (o.id !== value) onChange(o.id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(filtered.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[active]) choose(filtered[active]);
    }
  };

  const sm = size === "sm";

  return (
    <div ref={ref} className={`relative inline-block ${open ? "z-[100]" : ""} ${className}`} onKeyDown={onKeyDown}>
      <button
        id={id}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={isDisabled}
        onClick={() => (open ? setOpen(false) : openList())}
        className={`flex w-full items-center gap-2 rounded-lg border bg-white font-bold text-slate-900 shadow-2xs transition cursor-pointer disabled:cursor-not-allowed disabled:text-slate-400 ${
          open ? "border-amber-500 ring-2 ring-amber-500/20" : "border-slate-300 hover:border-slate-400"
        } ${sm ? "h-8 min-w-[150px] px-2.5 text-xs" : "h-9 min-w-[180px] px-3 text-sm"}`}
      >
        <StorefrontIcon size={sm ? 15 : 17} weight="bold" className="shrink-0 text-amber-600" />
        <span className="flex-1 truncate text-left">{label}</span>
        <CaretDownIcon size={12} weight="bold" className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-[100] w-full min-w-[220px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-150">
          {showSearch && (
            <div className="border-b border-slate-100 p-2">
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5">
                <MagnifyingGlassIcon size={14} weight="bold" className="text-slate-400" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  placeholder="Tìm store..."
                  className="h-8 w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
                />
              </div>
            </div>
          )}
          <ul ref={listRef} role="listbox" aria-label={ariaLabel} className="max-h-80 overflow-y-auto p-1.5">
            {filtered.length === 0 && <li className="px-3 py-2.5 text-sm text-slate-400">Không tìm thấy store</li>}
            {filtered.map((o, i) => {
              const selected = o.id === value;
              return (
                <li
                  key={o.id}
                  data-idx={i}
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o)}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                    selected
                      ? "bg-amber-50 font-bold text-amber-900"
                      : i === active
                      ? "bg-slate-100 font-semibold text-slate-900"
                      : "font-semibold text-slate-700"
                  } ${o.id === allOption?.id ? "border-b border-slate-100 mb-1" : ""}`}
                >
                  <span className="truncate">{o.name}</span>
                  {selected && <CheckIcon size={15} weight="bold" className="shrink-0 text-amber-600" />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
