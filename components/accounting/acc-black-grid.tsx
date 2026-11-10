"use client";

import { useEffect, useRef, type ReactNode } from "react";

// Khung bọc bảng của Accounting + PPC: lưới kẻ đen, tiêu đề tô màu (CSS .acc-black-grid trong globals.css)
// và ô chỉ có dấu gạch giữ chỗ ("—", "–", "-") thì để trống.
// Không sửa text React đang quản lý: chỉ gắn data-acc-blank lên <td>, CSS làm chữ trong ô trong suốt.
const PLACEHOLDERS = new Set(["—", "–", "-"]);

// enabled=false: giữ kiểu bảng gốc (vd. Overview của Accounting) — không lưới đen, không ẩn dấu "—".
export function AccBlackGrid({
  className = "",
  enabled = true,
  children,
}: {
  className?: string;
  enabled?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root || !enabled) return;
    let raf = 0;
    const scan = () => {
      raf = 0;
      for (const td of root.querySelectorAll("table td")) {
        const blank = PLACEHOLDERS.has((td.textContent || "").trim()) && !td.querySelector("input, select, textarea, button");
        if (blank !== td.hasAttribute("data-acc-blank")) td.toggleAttribute("data-acc-blank", blank);
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(scan);
    };
    scan();
    // Chỉ theo dõi thêm/bớt nút và đổi chữ (không theo dõi thuộc tính → không tự kích hoạt lại khi gắn data-acc-blank)
    const mo = new MutationObserver(schedule);
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [enabled]);

  return (
    <div ref={ref} className={`${enabled ? "acc-black-grid " : ""}${className}`}>
      {children}
    </div>
  );
}
