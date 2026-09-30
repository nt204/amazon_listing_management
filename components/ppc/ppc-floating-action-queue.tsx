"use client";

import React, { useState, useEffect, useRef } from "react";
import { Lightning } from "@phosphor-icons/react";

interface PpcFloatingActionQueueProps {
  onOpen: () => void;
  pendingActionCount: number;
  selectedStore?: string;
}

const STORAGE_KEY = "ppc_floating_action_queue_pos";

export function PpcFloatingActionQueue({
  onOpen,
  pendingActionCount,
  selectedStore,
}: PpcFloatingActionQueueProps) {
  // Default position: bottom: 96px, right: 24px (tránh đè lên thanh phân trang pagination và scrollbar)
  const [position, setPosition] = useState<{ right: number; bottom: number }>({
    right: 24,
    bottom: 96,
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
    startBottom: 96,
    hasMoved: false,
  });

  // Load saved position
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
      // Ignore storage errors
    }

    return () => {
      if (animationFrame !== undefined) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    // Only left click
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
          // Ignore storage errors
        }
      } else {
        // If not dragged, trigger click open
        onOpen();
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const storeLabel =
    selectedStore && selectedStore !== "ALL" ? selectedStore : "LIMIMA";

  return (
    <div
      style={{
        position: "fixed",
        right: `${position.right}px`,
        bottom: `${position.bottom}px`,
        zIndex: 40,
        touchAction: "none",
      }}
      className="select-none"
    >
      <button
        type="button"
        onPointerDown={handlePointerDown}
        onClick={(event) => {
          // Keyboard-triggered clicks do not emit a pointer sequence.
          if (event.detail === 0) onOpen();
        }}
        className={`group flex h-12 items-center gap-2 overflow-hidden rounded-full border border-emerald-500/80 bg-emerald-600 px-3 text-white shadow-xl shadow-emerald-950/25 transition-[background-color,box-shadow,transform] duration-200 hover:bg-emerald-700 focus-visible:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 active:scale-[0.98] active:bg-emerald-800 cursor-grab active:cursor-grabbing motion-reduce:transition-none ${
          isDragging ? "opacity-90 ring-2 ring-emerald-300 ring-offset-2" : ""
        }`}
        aria-label={`Mở Action Queue cho shop ${storeLabel}. ${pendingActionCount} task đang chờ.`}
        title={`Mở Action Queue${selectedStore && selectedStore !== "ALL" ? ` - Shop: ${selectedStore}` : ""} (Kéo thả để di chuyển vị trí)`}
      >
        {/* Lightning Icon */}
        <span className="relative flex shrink-0 items-center justify-center">
          <Lightning
            size={19}
            weight="fill"
            className="text-white group-hover:rotate-12 transition-transform duration-200"
          />
        </span>

        {/* Revealed action label */}
        <span className="flex max-w-0 -translate-x-2 items-center gap-2 overflow-hidden whitespace-nowrap opacity-0 transition-[max-width,opacity,transform] duration-300 ease-out group-hover:max-w-32 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:max-w-32 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 motion-reduce:transition-none">
          <span className="text-sm font-bold tracking-wide">Action Queue</span>
          <span aria-hidden="true" className="h-5 w-px shrink-0 bg-emerald-300/50" />
        </span>

        {/* Store Name */}
        <span className="max-w-[100px] truncate whitespace-nowrap text-sm font-semibold tracking-wide text-emerald-50">
          {storeLabel}
        </span>

        {/* Badge Count */}
        <span
          className={`flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-black transition-colors ${
            pendingActionCount > 0
              ? "bg-white text-emerald-700 shadow-xs"
              : "bg-emerald-800/80 text-emerald-200 border border-emerald-600/50"
          }`}
        >
          {pendingActionCount}
        </span>
      </button>
    </div>
  );
}
