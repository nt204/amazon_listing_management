"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/** Khoá cột khi màn hình đủ rộng — hẹp hơn thì vùng khoá chiếm gần hết bảng, không còn chỗ để lướt. */
const FREEZE_MEDIA = "(min-width: 1024px)";

/** Vạch phân cách sau cột khoá cuối: vẽ bằng box-shadow để đi theo ô sticky. */
const EDGE = "shadow-[inset_-2px_0_0_var(--ff-line-strong),6px_0_8px_-6px_rgba(15,23,42,0.3)]";

export interface FrozenCell {
  className: string;
  style?: CSSProperties;
}

/**
 * Khoá các cột đầu bảng khi lướt ngang (bảng chi tiết lô nội bộ và trang xưởng).
 * Đánh dấu `data-freeze` lên ô tiêu đề của từng cột khoá (theo thứ tự trái → phải, kể cả cột #);
 * hook đo độ rộng các ô đó để tính vị trí `left` của từng cột.
 *
 * Bảng phải dùng `border-separate border-spacing-0` và viền đặt trên ô (border-collapse để hở khe khi sticky),
 * ô khoá phải có nền đặc (bg-inherit từ dòng có nền đặc) để nội dung cột cuộn không lộ qua.
 */
export function useFrozenColumns(columnCount: number, remeasureKey: unknown) {
  const tableRef = useRef<HTMLTableElement>(null);
  const [lefts, setLefts] = useState<number[] | null>(null);

  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table || columnCount <= 0) return;
    const measure = () => {
      if (!window.matchMedia(FREEZE_MEDIA).matches) {
        setLefts(null);
        return;
      }
      let x = 0;
      const next = [...table.querySelectorAll<HTMLElement>("[data-freeze]")].map((cell) => {
        const left = x;
        x += cell.getBoundingClientRect().width;
        return left;
      });
      next.push(x); // tổng độ rộng vùng khoá
      setLefts((prev) => (prev && prev.length === next.length && prev.every((v, i) => Math.abs(v - next[i]) < 0.5) ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(table);
    return () => observer.disconnect();
  }, [columnCount, remeasureKey]);

  /**
   * Ô ở vị trí `index` (0 = cột đầu tiên, thường là #). `layer`: z-index + nền của ô.
   * `fill`: màu nền ô — phủ thêm 2px sang phải để lấp khe dưới 1px giữa 2 ô khoá (trình duyệt làm tròn vị trí sticky
   * khác nhau → lộ chữ cột cuộn bên dưới, thấy rõ ở hàng tiêu đề chữ trắng).
   */
  const freeze = (index: number, layer: string, fill?: string): FrozenCell => {
    if (!lefts || index >= columnCount) return { className: "" };
    const isEdge = index === columnCount - 1;
    const style: CSSProperties = { left: lefts[index] };
    if (fill && !isEdge) style.boxShadow = `2px 0 0 0 ${fill}`;
    return { className: `sticky ${layer}${isEdge ? ` ${EDGE}` : ""} print:static print:shadow-none`, style };
  };

  return { tableRef, frozen: lefts !== null, frozenWidth: lefts?.[lefts.length - 1] ?? 0, freeze };
}

/**
 * Vạch ngăn đậm ở ranh giới 2 nhóm cột: sau "one box quantity" (hết phần Order) — trước "Transparency Code"
 * (bắt đầu Packing & shipping). Dùng chung cho 2 bảng chi tiết lô.
 */
export function sectionEdge(column: { key: string }, part: "head" | "body"): string {
  if (column.key !== "box_quantity") return "";
  return part === "head" ? "border-r-2! border-r-white/70!" : "border-r-2! border-r-(--ff-line-strong)!";
}
