"use client";

// Chọn dòng bằng chuột giống tab Manual Bid:
// - Bấm 1 dòng: tích / bỏ tích dòng đó.
// - Nhấn giữ rồi kéo: tô cả vùng từ dòng bắt đầu tới dòng đang trỏ (bắt đầu ở dòng đã tích thì là bỏ tích);
//   kéo ngược lại thì dòng rút khỏi vùng trở về như cũ, quay về đúng dòng bắt đầu là huỷ cả vùng.
// - Shift + bấm: chọn / bỏ cả đoạn từ dòng bấm trước.
// - Bấm vào nút, ô nhập, link hoặc phần tử có data-no-drag thì không chọn.
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

type DragState = { anchor: number; key: string; on: boolean; base: Set<string>; moved: boolean };

const INTERACTIVE = "button, a, input, select, textarea, label, [data-no-drag]";

export function useDragSelect(orderedKeys: string[], selected: Set<string>, onChange: (next: Set<string>) => void) {
  const dragRef = useRef<DragState | null>(null);
  const lastRef = useRef<string | null>(null);
  // Luôn dùng giá trị mới nhất trong listener mouseup gắn 1 lần
  const latest = useRef({ orderedKeys, selected, onChange });
  useLayoutEffect(() => {
    latest.current = { orderedKeys, selected, onChange };
  });

  useEffect(() => {
    const end = () => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      if (!d.moved) {
        const next = new Set(d.base);
        if (next.has(d.key)) next.delete(d.key);
        else next.add(d.key);
        latest.current.onChange(next);
      }
    };
    window.addEventListener("mouseup", end);
    return () => window.removeEventListener("mouseup", end);
  }, []);

  const toggleRange = useCallback((key: string) => {
    const { orderedKeys: keys, selected: sel, onChange: change } = latest.current;
    const last = lastRef.current;
    const a = last ? keys.indexOf(last) : -1;
    const b = keys.indexOf(key);
    const range = a >= 0 && b >= 0 ? keys.slice(Math.min(a, b), Math.max(a, b) + 1) : [key];
    const on = !sel.has(key);
    const next = new Set(sel);
    for (const k of range) {
      if (on) next.add(k);
      else next.delete(k);
    }
    lastRef.current = key;
    change(next);
  }, []);

  const rowProps = useCallback(
    (idx: number, key: string) => ({
      onMouseDown: (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
        e.preventDefault(); // không bôi đen chữ khi kéo
        if (e.shiftKey) {
          toggleRange(key);
          return;
        }
        const sel = latest.current.selected;
        dragRef.current = { anchor: idx, key, on: !sel.has(key), base: new Set(sel), moved: false };
        lastRef.current = key;
      },
      onMouseEnter: () => {
        const d = dragRef.current;
        if (!d || (!d.moved && idx === d.anchor)) return;
        d.moved = true;
        const keys = latest.current.orderedKeys;
        const next = new Set(d.base);
        if (idx !== d.anchor) {
          for (const k of keys.slice(Math.min(d.anchor, idx), Math.max(d.anchor, idx) + 1)) {
            if (d.on) next.add(k);
            else next.delete(k);
          }
        }
        lastRef.current = keys[idx];
        latest.current.onChange(next);
      },
    }),
    [toggleRange],
  );

  return { rowProps };
}
