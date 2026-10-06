"use client";

import React, { useState, useEffect, useRef } from "react";
import { Target, Sparkle } from "@phosphor-icons/react";

interface PpcFloatingBidResultsButtonProps {
  onOpen: () => void;
  selectedStore?: string;
}

const STORAGE_KEY = "ppc_floating_bid_results_pos";

export function PpcFloatingBidResultsButton({
  onOpen,
  selectedStore,
}: PpcFloatingBidResultsButtonProps) {
  // Mặc định ban đầu ở góc dưới: ngay phía trên nút Action Queue (bottom: 156px, right: 24px)
  const [position, setPosition] = useState<{ right: number; bottom: number }>({
    right: 24,
    bottom: 156,
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startRight: number;
    startBottom: number;
    hasMoved: boolean;
  }>({
    startX: 0,
    startY: 0,
    startRight: 24,
    startBottom: 156,
    hasMoved: false,
  });

  // Tải vị trí đã lưu từ localStorage
  useEffect(() => {
    let animationFrame: number | undefined;

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.right === "number" && typeof parsed.bottom === "number") {
          const maxRight = Math.max(12, window.innerWidth - 200);
          const maxBottom = Math.max(12, window.innerHeight - 60);
          animationFrame = window.requestAnimationFrame(() => {
            setPosition({
              right: Math.min(Math.max(12, parsed.right), maxRight),
              bottom: Math.min(Math.max(12, parsed.bottom), maxBottom),
            });
          });
        }
      }
    } catch {
      // Bỏ qua lỗi storage
    }

    return () => {
      if (animationFrame !== undefined) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startRight: position.right,
      startBottom: position.bottom,
      hasMoved: false,
    };

    setIsDragging(true);

    const onPointerMove = (ev: PointerEvent) => {
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;

      if (!dragRef.current.hasMoved && Math.hypot(dx, dy) > 4) {
        dragRef.current.hasMoved = true;
      }

      if (dragRef.current.hasMoved) {
        const newRight = dragRef.current.startRight - dx;
        const newBottom = dragRef.current.startBottom - dy;

        const maxRight = Math.max(12, window.innerWidth - 220);
        const maxBottom = Math.max(12, window.innerHeight - 60);

        const clampedRight = Math.min(Math.max(12, newRight), maxRight);
        const clampedBottom = Math.min(Math.max(12, newBottom), maxBottom);

        setPosition({ right: clampedRight, bottom: clampedBottom });
      }
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      setIsDragging(false);

      if (dragRef.current.hasMoved) {
        try {
          localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
              right: position.right,
              bottom: position.bottom,
            })
          );
        } catch {
          // Bỏ qua lỗi storage
        }
      } else {
        onOpen();
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  return (
    <div
      style={{
        position: "fixed",
        right: `${position.right}px`,
        bottom: `${position.bottom}px`,
        zIndex: 41,
        touchAction: "none",
      }}
      className="select-none"
    >
      <button
        type="button"
        onPointerDown={handlePointerDown}
        onClick={(event) => {
          if (event.detail === 0) onOpen();
        }}
        className={`group flex h-11 items-center gap-2 overflow-hidden rounded-full border border-indigo-500/80 bg-gradient-to-r from-indigo-600 to-indigo-700 px-3.5 text-white shadow-xl shadow-indigo-950/25 transition-[background-color,box-shadow,transform] duration-200 hover:from-indigo-700 hover:to-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 active:scale-[0.98] cursor-grab active:cursor-grabbing motion-reduce:transition-none ${
          isDragging ? "opacity-90 ring-2 ring-indigo-300 ring-offset-2" : ""
        }`}
        aria-label="Xem kết quả Auto Bid"
        title="Xem theo dõi kết quả sau mỗi lần chỉnh bid (3D, 7D, 14D, 30D) - Kéo thả để di chuyển vị trí"
      >
        {/* Target Icon */}
        <span className="relative flex shrink-0 items-center justify-center">
          <Target
            size={18}
            weight="bold"
            className="text-white group-hover:scale-110 transition-transform duration-200"
          />
        </span>

        {/* Text Label */}
        <span className="whitespace-nowrap text-xs font-bold tracking-wide text-indigo-50">
          Kết quả Auto Bid
        </span>

        {/* Sparkle badge */}
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500/50 text-indigo-100 group-hover:bg-indigo-500 transition-colors">
          <Sparkle size={11} weight="fill" />
        </span>
      </button>
    </div>
  );
}
