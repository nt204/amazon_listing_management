"use client";

import React, { useState, useEffect, useRef } from "react";
import { Lightning } from "@phosphor-icons/react";

interface PpcFloatingActionQueueProps {
  onOpen: () => void;
  pendingActionCount: number;
  selectedStore?: string;
}

const STORAGE_KEY = "ppc_floating_action_queue_pos_v3";
const DEFAULT_RIGHT = 24;
const DEFAULT_BOTTOM = 84;
const DOCK_HANDLE_WIDTH = 44;

type FloatingQueuePosition = {
  right: number;
  bottom: number;
  docked: boolean;
};

export function PpcFloatingActionQueue({
  onOpen,
  pendingActionCount,
  selectedStore,
}: PpcFloatingActionQueueProps) {
  // Default position: góc dưới bên phải cách mép dưới 84px để không che các nút trong bảng
  const [position, setPosition] = useState<FloatingQueuePosition>({
    right: DEFAULT_RIGHT,
    bottom: DEFAULT_BOTTOM,
    docked: false,
  });
  const [isDragging, setIsDragging] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startRight: number;
    startBottom: number;
    currentRight: number;
    currentBottom: number;
    hasMoved: boolean;
    startedDocked: boolean;
    lastX: number;
    lastMoveTime: number;
    velocityX: number;
  }>({
    startX: 0,
    startY: 0,
    startRight: 24,
    startBottom: 84,
    currentRight: 24,
    currentBottom: 84,
    hasMoved: false,
    startedDocked: false,
    lastX: 0,
    lastMoveTime: 0,
    velocityX: 0,
  });

  const getDockedRight = () =>
    -(Math.max(buttonRef.current?.offsetWidth ?? 180, DOCK_HANDLE_WIDTH) -
      DOCK_HANDLE_WIDTH);

  const savePosition = (nextPosition: FloatingQueuePosition) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextPosition));
    } catch {
      // Ignore storage errors
    }
  };

  const revealFromDock = () => {
    const nextPosition = {
      right: DEFAULT_RIGHT,
      bottom: position.bottom,
      docked: false,
    };
    setPosition(nextPosition);
    savePosition(nextPosition);
  };

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
            const docked = parsed.docked === true;
            setPosition({
              right: docked
                ? getDockedRight()
                : Math.min(Math.max(12, parsed.right), maxRight),
              bottom: Math.min(Math.max(12, parsed.bottom), maxBottom),
              docked,
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

  // Keep the handle reachable when the viewport changes size or orientation.
  useEffect(() => {
    const keepInsideViewport = () => {
      setPosition((current) => {
        const maxBottom = Math.max(12, window.innerHeight - 60);
        const bottom = Math.min(Math.max(12, current.bottom), maxBottom);

        if (current.docked) {
          return bottom === current.bottom ? current : { ...current, bottom };
        }

        const maxRight = Math.max(12, window.innerWidth - DOCK_HANDLE_WIDTH);
        const right = Math.min(Math.max(12, current.right), maxRight);

        return right === current.right && bottom === current.bottom
          ? current
          : { ...current, right, bottom };
      });
    };

    window.addEventListener("resize", keepInsideViewport);
    return () => window.removeEventListener("resize", keepInsideViewport);
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    // Only left click
    if (e.button !== 0) return;

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startRight: position.right,
      startBottom: position.bottom,
      currentRight: position.right,
      currentBottom: position.bottom,
      hasMoved: false,
      startedDocked: position.docked,
      lastX: e.clientX,
      lastMoveTime: e.timeStamp,
      velocityX: 0,
    };

    setIsDragging(true);

    const onPointerMove = (ev: PointerEvent) => {
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      const elapsed = ev.timeStamp - dragRef.current.lastMoveTime;

      if (elapsed > 0) {
        dragRef.current.velocityX =
          (ev.clientX - dragRef.current.lastX) / elapsed;
        dragRef.current.lastX = ev.clientX;
        dragRef.current.lastMoveTime = ev.timeStamp;
      }

      if (!dragRef.current.hasMoved && Math.hypot(dx, dy) > 4) {
        dragRef.current.hasMoved = true;
      }

      if (dragRef.current.hasMoved) {
        const newRight = dragRef.current.startRight - dx;
        const newBottom = dragRef.current.startBottom - dy;

        const minRight = getDockedRight();
        const maxRight = Math.max(12, window.innerWidth - DOCK_HANDLE_WIDTH);
        const maxBottom = Math.max(12, window.innerHeight - 60);

        const clampedRight = Math.min(Math.max(minRight, newRight), maxRight);
        const clampedBottom = Math.min(Math.max(12, newBottom), maxBottom);

        dragRef.current.currentRight = clampedRight;
        dragRef.current.currentBottom = clampedBottom;
        setPosition({ right: clampedRight, bottom: clampedBottom, docked: false });
      }
    };

    const onPointerUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      setIsDragging(false);

      if (dragRef.current.hasMoved) {
        const dockedRight = getDockedRight();
        const dockThreshold = dockedRight / 2;
        const recentRightwardFlick =
          ev.type === "pointerup" &&
          ev.timeStamp - dragRef.current.lastMoveTime < 140 &&
          dragRef.current.velocityX > 0.45;
        const shouldDock =
          dragRef.current.currentRight < dockThreshold || recentRightwardFlick;
        const nextPosition = {
          right: shouldDock ? dockedRight : Math.max(12, dragRef.current.currentRight),
          bottom: dragRef.current.currentBottom,
          docked: shouldDock,
        };

        setPosition(nextPosition);
        savePosition(nextPosition);
      } else if (dragRef.current.startedDocked) {
        const nextPosition = {
          right: DEFAULT_RIGHT,
          bottom: dragRef.current.currentBottom,
          docked: false,
        };
        setPosition(nextPosition);
        savePosition(nextPosition);
      } else {
        // If not dragged, trigger click open
        onOpen();
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  const storeLabel =
    selectedStore && selectedStore !== "ALL" ? selectedStore : "LIMIMA";

  return (
    <div
      style={{
        position: "fixed",
        right: position.docked ? 0 : `${position.right}px`,
        bottom: `${position.bottom}px`,
        transform: position.docked
          ? `translateX(calc(100% - ${DOCK_HANDLE_WIDTH}px))`
          : "translateX(0)",
        zIndex: 40,
        touchAction: "none",
      }}
      className={`select-none motion-reduce:transition-none ${
        isDragging
          ? ""
          : "transition-[right,bottom,transform] duration-200 ease-out"
      }`}
    >
      <button
        ref={buttonRef}
        type="button"
        onPointerDown={handlePointerDown}
        onClick={(event) => {
          // Keyboard-triggered clicks do not emit a pointer sequence.
          if (event.detail === 0) {
            if (position.docked) revealFromDock();
            else onOpen();
          }
        }}
        className={`group flex h-12 items-center gap-2 overflow-hidden rounded-full border border-emerald-500/80 bg-emerald-600 px-3 text-white shadow-xl shadow-emerald-950/25 transition-[background-color,box-shadow,transform] duration-200 hover:bg-emerald-700 focus-visible:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 active:scale-[0.98] active:bg-emerald-800 cursor-grab active:cursor-grabbing motion-reduce:transition-none ${
          isDragging ? "opacity-90 ring-2 ring-emerald-300 ring-offset-2" : ""
        }`}
        aria-label={
          position.docked
            ? `Hiện Action Queue cho shop ${storeLabel}`
            : `Mở Action Queue cho shop ${storeLabel}. ${pendingActionCount} task đang chờ.`
        }
        aria-expanded={!position.docked}
        title={
          position.docked
            ? "Kéo sang trái hoặc bấm để hiện Action Queue"
            : `Mở Action Queue${selectedStore && selectedStore !== "ALL" ? ` - Shop: ${selectedStore}` : ""} (Kéo sang phải để ẩn)`
        }
      >
        {/* Lightning Icon */}
        <span className="relative flex w-[19px] shrink-0 items-center justify-center">
          <Lightning
            size={19}
            weight="fill"
            className="text-white transition-transform duration-200 group-hover:rotate-12"
          />
        </span>

        {/* Revealed action label */}
        <span
          className={`flex max-w-0 -translate-x-2 items-center gap-2 overflow-hidden whitespace-nowrap opacity-0 transition-[max-width,opacity,transform] duration-300 ease-out motion-reduce:transition-none ${
            position.docked
              ? ""
              : "group-hover:max-w-32 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:max-w-32 group-focus-visible:translate-x-0 group-focus-visible:opacity-100"
          }`}
        >
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
