"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ColumnsIcon, CheckIcon } from "@phosphor-icons/react";
import type { RequestActor } from "@/lib/auth";

const ORIGINAL_SPAN_ATTR = "data-ppc-colspan";
const APPLIED_SPAN_ATTR = "data-ppc-colspan-applied";

type ColumnOption = { label: string; hidden: boolean };

/** Tên cột lấy từ text tiêu đề (bỏ mũi tên sort). Cột không có chữ (checkbox, ...) thì không cho ẩn. */
function headerLabel(cell: HTMLTableCellElement) {
  return (cell.textContent || "").replace(/[↑↓]/g, "").replace(/\s+/g, " ").trim();
}

function readHeaderLabels(table: HTMLTableElement) {
  const headRow = table.tHead?.rows[0];
  if (!headRow) return [] as string[];
  const labels: string[] = [];
  for (const cell of Array.from(headRow.cells)) {
    const label = headerLabel(cell);
    for (let span = 0; span < cell.colSpan; span++) labels.push(label);
  }
  return labels;
}

function originalSpan(cell: HTMLTableCellElement) {
  const applied = cell.getAttribute(APPLIED_SPAN_ATTR);
  const original = cell.getAttribute(ORIGINAL_SPAN_ATTR);
  // React đã ghi colSpan mới → lấy giá trị đó làm gốc
  if (original != null && applied != null && String(cell.colSpan) === applied) return Number(original);
  return cell.colSpan;
}

/** Ẩn các cột theo tên tiêu đề; ô gộp (colSpan) phủ qua cột bị ẩn sẽ được thu hẹp tương ứng. */
function applyHiddenColumns(table: HTMLTableElement, hidden: Set<string>) {
  const labels = readHeaderLabels(table);
  const hiddenIndexes = new Set<number>();
  labels.forEach((label, index) => {
    if (label && hidden.has(label)) hiddenIndexes.add(index);
  });

  for (const row of Array.from(table.rows)) {
    let col = 0;
    for (const cell of Array.from(row.cells)) {
      const span = originalSpan(cell);
      const start = col;
      col += span;
      if (span === 1) {
        cell.style.display = hiddenIndexes.has(start) ? "none" : "";
        continue;
      }
      let covered = 0;
      for (let i = start; i < start + span; i++) if (hiddenIndexes.has(i)) covered++;
      const next = Math.max(1, span - covered);
      if (covered === 0) {
        if (cell.hasAttribute(ORIGINAL_SPAN_ATTR)) {
          cell.colSpan = span;
          cell.removeAttribute(ORIGINAL_SPAN_ATTR);
          cell.removeAttribute(APPLIED_SPAN_ATTR);
        }
        continue;
      }
      cell.setAttribute(ORIGINAL_SPAN_ATTR, String(span));
      cell.setAttribute(APPLIED_SPAN_ATTR, String(next));
      cell.colSpan = next;
    }
  }
}

function storageKeyFor(tableKey: string, actor?: RequestActor) {
  const id = (actor?.userId || actor?.displayName || "default").trim().replace(/[^a-zA-Z0-9_-]/g, "_");
  return `ppc_hidden_cols_${tableKey}_${id}`;
}

function readHidden(storageKey: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (Array.isArray(saved)) return saved.filter((item): item is string => typeof item === "string");
  } catch {
    // ignore
  }
  return [];
}

/**
 * Nút "Cột" để ẩn/hiện cột của bảng PPC (giống Column display của Seller Central).
 * Lưu theo từng tài khoản đăng nhập.
 */
export function usePpcColumnVisibility(table: HTMLTableElement | null, tableKey: string, actor: RequestActor | undefined) {
  const storageKey = storageKeyFor(tableKey, actor);
  const [hiddenState, setHiddenState] = useState(() => ({ key: storageKey, labels: readHidden(storageKey) }));
  if (hiddenState.key !== storageKey) {
    setHiddenState({ key: storageKey, labels: readHidden(storageKey) });
  }
  const hiddenLabels = hiddenState.labels;
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ColumnOption[]>([]);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const saveHidden = useCallback(
    (labels: string[]) => {
      setHiddenState({ key: storageKey, labels });
      try {
        localStorage.setItem(storageKey, JSON.stringify(labels));
      } catch {
        // ignore
      }
    },
    [storageKey]
  );

  useEffect(() => {
    if (!table) return;
    const hidden = new Set(hiddenLabels);
    let frame = 0;
    const observeOptions: MutationObserverInit = { childList: true, subtree: true, attributes: true, attributeFilter: ["colspan"] };
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(run);
    });
    function run() {
      frame = 0;
      observer.disconnect();
      applyHiddenColumns(table!, hidden);
      observer.observe(table!, observeOptions);
    }
    run();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [table, hiddenLabels]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const hiddenSet = new Set(hiddenLabels);
  const visibleOptions = options.map((option) => ({ ...option, hidden: hiddenSet.has(option.label) }));
  const shownCount = visibleOptions.filter((option) => !option.hidden).length;

  const toggleOpen = () => {
    if (!open && table) {
      const seen = new Set<string>();
      const next: ColumnOption[] = [];
      for (const label of readHeaderLabels(table)) {
        if (!label || seen.has(label)) continue;
        seen.add(label);
        next.push({ label, hidden: false });
      }
      setOptions(next);
    }
    setOpen((value) => !value);
  };

  const toggleColumn = (label: string) => {
    if (hiddenSet.has(label)) {
      saveHidden(hiddenLabels.filter((item) => item !== label));
    } else if (shownCount > 1) {
      saveHidden([...hiddenLabels, label]);
    }
  };

  const hiddenOnTable = table ? readHeaderLabels(table).filter((label) => label && hiddenSet.has(label)).length : hiddenLabels.length;

  const button: ReactNode = (
    <div ref={wrapperRef} className="relative shrink-0">
      <button
        type="button"
        onClick={toggleOpen}
        className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
          hiddenOnTable > 0
            ? "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
            : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
        }`}
        title="Chọn cột hiển thị"
      >
        <ColumnsIcon size={14} weight="bold" /> Cột
        {hiddenOnTable > 0 && <span className="rounded bg-indigo-600 px-1 text-[10px] font-black text-white">-{hiddenOnTable}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-100">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/90 px-3 py-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Hiển thị cột ({shownCount}/{visibleOptions.length})
            </span>
            {hiddenLabels.length > 0 && (
              <button
                type="button"
                onClick={() => saveHidden([])}
                className="cursor-pointer text-[11px] font-bold text-indigo-600 hover:text-indigo-800"
              >
                Hiện tất cả
              </button>
            )}
          </div>
          <div className="grid max-h-80 grid-cols-2 gap-0.5 overflow-y-auto p-1.5">
            {visibleOptions.map((option) => {
              const checked = !option.hidden;
              const locked = checked && shownCount <= 1;
              return (
                <button
                  key={option.label}
                  type="button"
                  disabled={locked}
                  onClick={() => toggleColumn(option.label)}
                  className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  title={option.label}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      checked ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white"
                    }`}
                  >
                    {checked && <CheckIcon size={11} weight="bold" />}
                  </span>
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  return button;
}
