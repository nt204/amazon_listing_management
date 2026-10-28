"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { LockIcon, LockOpenIcon, ArrowCounterClockwiseIcon } from "@phosphor-icons/react";
import type { RequestActor } from "@/lib/auth";

const FROZEN_CELL_CLASS = "ppc-frozen-cell";
const FROZEN_BOUNDARY_CLASS = "ppc-frozen-boundary";

type MenuState = { colIndex: number; label: string; x: number; y: number } | null;

function parseRgba(color: string): [number, number, number, number] | null {
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
  return [parts[0], parts[1], parts[2], parts.length >= 4 ? parts[3] : 1];
}

/** Màu nền đặc (opaque) của 1 dòng: trộn các lớp nền bán trong suốt của tr → tbody/thead → table lên nền trắng. */
function resolveOpaqueBackground(row: HTMLTableRowElement, table: HTMLTableElement): string {
  const layers: [number, number, number, number][] = [];
  let el: HTMLElement | null = row;
  while (el) {
    const rgba = parseRgba(getComputedStyle(el).backgroundColor);
    if (rgba && rgba[3] > 0) {
      layers.push(rgba);
      if (rgba[3] >= 1) break;
    }
    if (el === table) break;
    el = el.parentElement;
  }
  let [r, g, b] = [255, 255, 255];
  for (let i = layers.length - 1; i >= 0; i--) {
    const [lr, lg, lb, la] = layers[i];
    r = lr * la + r * (1 - la);
    g = lg * la + g * (1 - la);
    b = lb * la + b * (1 - la);
  }
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

function clearFrozenCell(cell: HTMLTableCellElement) {
  if (!cell.classList.contains(FROZEN_CELL_CLASS)) return;
  cell.classList.remove(FROZEN_CELL_CLASS, FROZEN_BOUNDARY_CLASS);
  cell.style.removeProperty("position");
  cell.style.removeProperty("left");
  cell.style.removeProperty("z-index");
  cell.style.removeProperty("background-color");
}

function applyRowBackground(row: HTMLTableRowElement, table: HTMLTableElement) {
  const frozenCells = Array.from(row.cells).filter((cell) => cell.classList.contains(FROZEN_CELL_CLASS));
  if (frozenCells.length === 0) return;
  // Lấy màu theo trạng thái hiện tại của dòng (kể cả :hover / selected)
  const bg = resolveOpaqueBackground(row, table);
  for (const cell of frozenCells) cell.style.backgroundColor = bg;
}

/** Ghim (sticky-left) N cột đầu của bảng: đo độ rộng thực tế từ hàng tiêu đề đầu tiên. */
function applyFrozenColumns(table: HTMLTableElement, count: number) {
  const headRow = table.tHead?.rows[0];
  const lefts: number[] = [];
  if (headRow && count > 0) {
    let acc = 0;
    let col = 0;
    for (const cell of Array.from(headRow.cells)) {
      if (col >= count) break;
      // Không đè lên cột đã sticky sẵn (vd: cột thao tác ghim phải)
      if (cell.classList.contains("sticky") && !cell.classList.contains(FROZEN_CELL_CLASS)) break;
      for (let span = 0; span < cell.colSpan && col < count; span++, col++) {
        lefts.push(acc);
      }
      acc += cell.getBoundingClientRect().width;
    }
  }
  const frozenCount = lefts.length;

  for (const row of Array.from(table.rows)) {
    const inHead = row.parentElement?.tagName === "THEAD";
    let col = 0;
    for (const cell of Array.from(row.cells)) {
      const start = col;
      col += cell.colSpan;
      const shouldFreeze = start < frozenCount && cell.colSpan === 1 && !(cell.classList.contains("sticky") && !cell.classList.contains(FROZEN_CELL_CLASS));
      if (!shouldFreeze) {
        clearFrozenCell(cell);
        continue;
      }
      cell.classList.add(FROZEN_CELL_CLASS);
      cell.classList.toggle(FROZEN_BOUNDARY_CLASS, start === frozenCount - 1);
      cell.style.position = "sticky";
      cell.style.left = `${lefts[start]}px`;
      cell.style.zIndex = inHead ? "31" : "15";
      cell.style.removeProperty("background-color");
    }
    applyRowBackground(row, table);
  }
}

function storageKeyFor(tableKey: string, actor?: RequestActor) {
  const id = (actor?.userId || actor?.displayName || "default").trim().replace(/[^a-zA-Z0-9_-]/g, "_");
  return `ppc_frozen_cols_${tableKey}_${id}`;
}

function readFrozenCount(storageKey: string, fallback: number) {
  if (typeof window === "undefined") return fallback;
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved != null && Number.isFinite(Number(saved))) return Math.max(0, Math.floor(Number(saved)));
  } catch {
    // ignore
  }
  return fallback;
}

/**
 * Khóa cột (freeze) cho các bảng PPC giống bên Accounting. Lưu theo từng tài khoản đăng nhập.
 * Chuột phải vào tiêu đề cột để mở menu "Khóa đến cột này".
 */
export function usePpcFrozenColumns(tableKey: string, actor: RequestActor | undefined, defaultCount: number) {
  const storageKey = storageKeyFor(tableKey, actor);
  const [frozenState, setFrozenState] = useState(() => ({
    key: storageKey,
    count: readFrozenCount(storageKey, defaultCount),
  }));
  // Đổi tài khoản → nạp lại cấu hình khóa cột của tài khoản đó
  if (frozenState.key !== storageKey) {
    setFrozenState({ key: storageKey, count: readFrozenCount(storageKey, defaultCount) });
  }
  const frozenCount = frozenState.key === storageKey ? frozenState.count : defaultCount;
  const [table, setTable] = useState<HTMLTableElement | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const saveFrozenCount = useCallback(
    (count: number) => {
      setFrozenState({ key: storageKey, count });
      try {
        localStorage.setItem(storageKey, String(count));
      } catch {
        // ignore
      }
    },
    [storageKey]
  );

  // Áp dụng sticky + theo dõi thay đổi dòng / kích thước / hover
  useEffect(() => {
    if (!table) return;
    let frame = 0;
    let mutationObserver: MutationObserver | null = null;
    const observeOptions: MutationObserverInit = { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] };

    const run = () => {
      frame = 0;
      mutationObserver?.disconnect();
      applyFrozenColumns(table, frozenCount);
      mutationObserver?.observe(table, observeOptions);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(run);
    };

    mutationObserver = new MutationObserver(schedule);
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(table);
    const headRow = table.tHead?.rows[0];
    if (headRow) Array.from(headRow.cells).forEach((cell) => resizeObserver.observe(cell));
    run();

    // Nền dòng đổi theo :hover → cập nhật lại màu nền của các ô bị khóa
    const timers = new Set<number>();
    const refreshRow = (event: Event) => {
      const row = (event.target as HTMLElement | null)?.closest("tr");
      if (!row || row.closest("table") !== table) return;
      const update = () => applyRowBackground(row, table);
      update();
      // Chờ hiệu ứng transition màu nền kết thúc
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        update();
      }, 220);
      timers.add(timer);
    };
    table.addEventListener("mouseover", refreshRow);
    table.addEventListener("mouseout", refreshRow);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      timers.forEach((t) => clearTimeout(t));
      mutationObserver?.disconnect();
      resizeObserver.disconnect();
      table.removeEventListener("mouseover", refreshRow);
      table.removeEventListener("mouseout", refreshRow);
    };
  }, [table, frozenCount]);

  // Chuột phải vào tiêu đề cột → mở menu khóa cột
  useEffect(() => {
    if (!table) return;
    const handleContextMenu = (event: MouseEvent) => {
      const th = (event.target as HTMLElement | null)?.closest("th");
      const headRow = table.tHead?.rows[0];
      if (!th || !headRow || th.parentElement !== headRow) return;
      event.preventDefault();
      let colIndex = 0;
      for (const cell of Array.from(headRow.cells)) {
        if (cell === th) break;
        colIndex += cell.colSpan;
      }
      const label = (th.textContent || "").replace(/[↑↓]/g, "").trim() || `Cột ${colIndex + 1}`;
      setMenu({ colIndex, label, x: event.clientX, y: event.clientY });
    };
    table.addEventListener("contextmenu", handleContextMenu);
    return () => table.removeEventListener("contextmenu", handleContextMenu);
  }, [table]);

  useEffect(() => {
    if (!menu) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenu(null);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKey);
    const handleScroll = () => setMenu(null);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [menu]);

  let menuNode: ReactNode = null;
  if (menu) {
    const isBoundary = frozenCount === menu.colIndex + 1;
    const itemClass =
      "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-slate-700 transition hover:bg-slate-100";
    menuNode = (
      <div
        ref={menuRef}
        className="fixed z-[100] w-56 overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-100"
        style={{
          left: Math.max(8, Math.min(menu.x, window.innerWidth - 232)),
          top: Math.max(8, Math.min(menu.y, window.innerHeight - 170)),
        }}
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/90 px-3 py-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Tùy chọn cột</span>
          <span className="max-w-[120px] truncate text-xs font-bold text-slate-900">{menu.label}</span>
        </div>
        <div className="space-y-0.5 p-1">
          {!isBoundary ? (
            <button
              type="button"
              onClick={() => {
                saveFrozenCount(menu.colIndex + 1);
                setMenu(null);
              }}
              className="flex w-full cursor-pointer items-center gap-2 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-left text-xs font-bold text-indigo-950 transition hover:bg-indigo-100"
            >
              <LockIcon size={14} weight="bold" className="shrink-0 text-indigo-600" />
              <span>Khóa đến cột này</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                saveFrozenCount(menu.colIndex);
                setMenu(null);
              }}
              className={itemClass}
            >
              <LockOpenIcon size={14} weight="bold" className="shrink-0 text-indigo-600" />
              <span>Mở khóa cột này</span>
            </button>
          )}
          {frozenCount !== defaultCount && (
            <button
              type="button"
              onClick={() => {
                saveFrozenCount(defaultCount);
                setMenu(null);
              }}
              className={itemClass}
            >
              <ArrowCounterClockwiseIcon size={14} weight="bold" className="shrink-0 text-slate-500" />
              <span>Về khóa mặc định</span>
            </button>
          )}
          {frozenCount > 0 && (
            <button
              type="button"
              onClick={() => {
                saveFrozenCount(0);
                setMenu(null);
              }}
              className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
            >
              <LockOpenIcon size={14} className="shrink-0 text-rose-500" />
              <span>Bỏ khóa tất cả cột</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return { tableRef: setTable, frozenCount, menu: menuNode };
}
