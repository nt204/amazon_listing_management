"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";

export function PpcFilterDropdown<T extends string>({ label, icon, options, value, onChange }: {
  label: string;
  icon?: ReactNode;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionsId = useId();
  const selectedLabel = options.find((option) => option.value === value)?.label ?? label;

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  return (
    <div
      ref={containerRef}
      className="relative w-36 shrink-0"
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${label}: ${selectedLabel}`}
        aria-expanded={open}
        aria-controls={optionsId}
        onClick={() => setOpen((previous) => !previous)}
        className="flex h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-indigo-500"
      >
        {icon}
        <span className="min-w-0 flex-1 truncate text-left">{selectedLabel}</span>
        <CaretDown size={12} className="shrink-0 text-slate-400" aria-hidden />
      </button>
      <div
        id={optionsId}
        role="group"
        aria-label={label}
        hidden={!open}
        className="absolute left-0 top-full z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg"
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.value === value}
            onClick={() => {
              onChange(option.value);
              setOpen(false);
              triggerRef.current?.focus();
            }}
            className="flex min-h-7 w-full cursor-pointer items-center justify-between gap-2 rounded px-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 focus-visible:bg-slate-100 aria-pressed:bg-indigo-50 aria-pressed:text-indigo-700"
          >
            <span className="min-w-0 [overflow-wrap:anywhere]">{option.label}</span>
            {option.value === value && <Check size={12} className="shrink-0" aria-hidden />}
          </button>
        ))}
      </div>
    </div>
  );
}
