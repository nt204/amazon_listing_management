"use client";

import React, { useState, useEffect, useRef } from "react";
import { Lightning, DotsSixVertical } from "@phosphor-icons/react";

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
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.right === "number" && typeof parsed.bottom === "number") {
          const maxRight = Math.max(12, window.innerWidth - 200);
          const maxBottom = Math.max(12, window.innerHeight - 60);
          setPosition({
            right: Math.min(Math.max(12, parsed.right), maxRight),
            bottom: Math.min(Math.max(12, parsed.bottom), maxBottom),
          });
        }
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
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
      <div
        onPointerDown={handlePointerDown}
        className={`group flex items-center gap-1.5 pl-2 pr-3.5 py-2 rounded-full bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white shadow-xl shadow-emerald-950/25 border border-emerald-500/80 backdrop-blur-md transition-shadow duration-200 cursor-grab active:cursor-grabbing hover:scale-[1.02] ${
          isDragging ? "opacity-90 ring-2 ring-emerald-300 ring-offset-2" : ""
        }`}
        title={`Mở Action Queue${selectedStore && selectedStore !== "ALL" ? ` - Shop: ${selectedStore}` : ""} (Kéo thả để di chuyển vị trí)`}
      >
        {/* Drag Handle Grip */}
        <span
          className="text-emerald-300/80 hover:text-white transition-colors cursor-grab active:cursor-grabbing"
          title="Kéo thả vị trí"
        >
          <DotsSixVertical size={16} weight="bold" />
        </span>

        {/* Lightning Icon */}
        <div className="relative flex items-center justify-center">
          <Lightning
            size={16}
            weight="fill"
            className="text-white group-hover:rotate-12 transition-transform duration-200"
          />
          {pendingActionCount > 0 && (
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-300 animate-ping" />
          )}
        </div>

        {/* Text */}
        <span className="text-xs font-bold tracking-wide">Action Queue</span>

        {/* Store Name */}
        {selectedStore && selectedStore !== "ALL" && (
          <span className="text-[10px] text-emerald-100/90 font-medium max-w-[100px] truncate border-l border-emerald-400/40 pl-2">
            {selectedStore}
          </span>
        )}

        {/* Badge Count */}
        <span
          className={`px-1.5 py-0.2 min-w-[20px] text-center rounded-full text-[11px] font-black transition-all ${
            pendingActionCount > 0
              ? "bg-white text-emerald-700 shadow-xs"
              : "bg-emerald-800/80 text-emerald-200 border border-emerald-600/50"
          }`}
        >
          {pendingActionCount}
        </span>
      </div>
    </div>
  );
}
