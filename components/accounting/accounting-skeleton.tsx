"use client";

import React from "react";
import { motion, AnimatePresence } from "motion/react";

interface AccountingTableSkeletonProps {
  rows?: number;
  colSpan?: number;
  columnsCount?: number;
  rowHeightClass?: string;
  theme?: "indigo" | "amber" | "emerald";
}

/**
 * Animated Table Skeleton Rows:
 * Renders realistic skeleton rows with staggered shimmer widths,
 * preventing layout shift and eliminating the blank/empty table lag sensation.
 */
export function AccountingTableSkeletonRows({
  rows = 8,
  colSpan,
  columnsCount = 10,
  rowHeightClass = "h-[36px]",
}: AccountingTableSkeletonProps) {
  const widths = ["w-3/4", "w-1/2", "w-4/5", "w-2/3", "w-3/5", "w-5/6", "w-1/3"];

  if (colSpan) {
    return (
      <>
        {Array.from({ length: rows }).map((_, rIdx) => (
          <tr
            key={`skel-row-${rIdx}`}
            className={`${rowHeightClass} border-b border-slate-100 ${
              rIdx % 2 === 0 ? "bg-white" : "bg-slate-50/50"
            }`}
          >
            <td colSpan={colSpan} className="px-3 py-2">
              <div className="flex items-center gap-3">
                <div className="h-3.5 w-6 shrink-0 rounded bg-slate-200/70 acc-shimmer" />
                <div className="h-3.5 w-16 shrink-0 rounded bg-slate-200/70 acc-shimmer" />
                <div
                  className={`h-3.5 rounded bg-slate-200/70 acc-shimmer ${
                    widths[rIdx % widths.length]
                  }`}
                />
                <div className="ml-auto hidden h-3.5 w-20 shrink-0 rounded bg-slate-200/70 acc-shimmer sm:block" />
                <div className="hidden h-3.5 w-16 shrink-0 rounded bg-slate-200/70 acc-shimmer md:block" />
              </div>
            </td>
          </tr>
        ))}
      </>
    );
  }

  return (
    <>
      {Array.from({ length: rows }).map((_, rIdx) => (
        <tr
          key={`skel-row-${rIdx}`}
          className={`${rowHeightClass} border-b border-slate-100 ${
            rIdx % 2 === 0 ? "bg-white" : "bg-slate-50/50"
          }`}
        >
          {Array.from({ length: columnsCount }).map((_, cIdx) => (
            <td key={`skel-cell-${rIdx}-${cIdx}`} className="px-3 py-2 whitespace-nowrap">
              <div
                className={`h-3 rounded bg-slate-200/70 acc-shimmer ${
                  cIdx === 0
                    ? "w-6"
                    : cIdx === 1
                    ? "w-20"
                    : widths[(rIdx + cIdx) % widths.length]
                }`}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/**
 * Indeterminate Top Loading Progress Bar:
 * Displays a sleek glowing line at the top of tables/views during background refetching.
 * Prevents layout destruction while keeping user instantly informed.
 */
export function AccountingTopProgressBar({
  loading,
  variant = "indigo",
}: {
  loading: boolean;
  variant?: "indigo" | "amber" | "emerald";
}) {
  if (!loading) return null;

  const gradientClass =
    variant === "amber"
      ? "from-amber-400 via-amber-500 to-amber-600"
      : variant === "emerald"
      ? "from-emerald-400 via-teal-500 to-emerald-600"
      : "from-indigo-500 via-sky-400 to-indigo-600";

  return (
    <div
      className="absolute top-0 left-0 right-0 z-30 h-[2.5px] overflow-hidden bg-slate-100"
      role="progressbar"
      aria-label="Đang tải dữ liệu"
    >
      <div
        className={`h-full w-1/3 rounded-full bg-gradient-to-r ${gradientClass} acc-progress shadow-xs`}
      />
    </div>
  );
}

/**
 * Full Module Skeleton:
 * Replaces the stark blank spinner with a rich skeleton layout
 * matching the real Accounting screen architecture.
 */
export function AccountingModuleSkeleton({
  title = "Đang tải dữ liệu...",
  cardsCount = 4,
}: {
  title?: string;
  cardsCount?: number;
}) {
  return (
    <div className="w-full space-y-4 p-4 sm:p-6 font-accounting-system">
      {/* Top Header Placeholder */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          <div className="h-6 w-36 rounded-md bg-slate-200/80 acc-shimmer" />
          <div className="h-5 w-20 rounded-full bg-slate-200/60 acc-shimmer" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-8 w-28 rounded-lg bg-slate-200/70 acc-shimmer" />
          <div className="h-8 w-32 rounded-lg bg-slate-200/70 acc-shimmer" />
          <div className="h-8 w-8 rounded-lg bg-slate-200/70 acc-shimmer" />
        </div>
      </div>

      {/* KPI Cards Placeholder */}
      {cardsCount > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: cardsCount }).map((_, idx) => (
            <div
              key={`skel-card-${idx}`}
              className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-2xs space-y-2"
            >
              <div className="h-3 w-20 rounded bg-slate-200/70 acc-shimmer" />
              <div className="h-6 w-28 rounded bg-slate-200/90 acc-shimmer" />
              <div className="h-2.5 w-16 rounded bg-slate-100 acc-shimmer" />
            </div>
          ))}
        </div>
      )}

      {/* Table Placeholder Card */}
      <div className="rounded-xl border border-slate-200/80 bg-white shadow-2xs overflow-hidden">
        {/* Table Toolbar */}
        <div className="flex items-center justify-between border-b border-slate-200/80 bg-slate-50/70 px-4 py-2.5">
          <div className="h-4 w-40 rounded bg-slate-200/70 acc-shimmer" />
          <div className="flex items-center gap-2">
            <div className="h-7 w-48 rounded-lg bg-slate-200/60 acc-shimmer" />
            <div className="h-7 w-20 rounded-lg bg-slate-200/60 acc-shimmer" />
          </div>
        </div>

        {/* Table Rows Skeleton */}
        <div className="p-1">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100/60">
                {Array.from({ length: 6 }).map((_, i) => (
                  <th key={`skel-th-${i}`} className="p-3">
                    <div className="h-3.5 w-16 rounded bg-slate-200/80 acc-shimmer" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <AccountingTableSkeletonRows rows={7} columnsCount={6} />
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-center text-xs text-slate-400 font-medium">{title}</p>
    </div>
  );
}

/**
 * Animated Sub-tab Indicator Pill:
 * Inspired by Animate UI (https://animate-ui.com/docs).
 * Renders a smooth gliding background indicator between tabs using layoutId.
 */
export function AnimatedTabPill({
  layoutId,
  className = "bg-sky-600 shadow-2xs border border-sky-700",
}: {
  layoutId: string;
  className?: string;
}) {
  return (
    <motion.div
      layoutId={layoutId}
      className={`absolute inset-0 rounded-lg -z-0 ${className}`}
      transition={{
        type: "spring",
        stiffness: 420,
        damping: 34,
      }}
    />
  );
}

/**
 * Smooth View Transition Wrapper:
 * Applies a gentle spring/cubic-bezier enter transition to eliminate jarring pops.
 */
export function AccountingViewTransition({
  children,
  transitionKey,
  className = "w-full h-full",
}: {
  children: React.ReactNode;
  transitionKey?: string;
  className?: string;
}) {
  return (
    <motion.div
      key={transitionKey}
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{
        duration: 0.2,
        ease: [0.16, 1, 0.3, 1],
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * Animated Modal Dialog Wrapper (animate-ui inspired):
 * Back-drop fade + spring scale-in dialog for ultra-smooth popup interaction.
 */
export function AccountingAnimatedModal({
  isOpen,
  onClose,
  children,
  maxWidthClass = "max-w-3xl",
}: {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidthClass?: string;
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 6 }}
            transition={{
              type: "spring",
              damping: 28,
              stiffness: 400,
            }}
            onClick={(e) => e.stopPropagation()}
            className={`relative w-full ${maxWidthClass} max-h-[92vh] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden z-10`}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/**
 * Animated Slide Drawer Wrapper (animate-ui inspired):
 * Smooth spring slide-in from right side for history, inspector and detail views.
 */
export function AccountingAnimatedDrawer({
  isOpen,
  onClose,
  children,
  maxWidthClass = "max-w-xl",
}: {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidthClass?: string;
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs"
            onClick={onClose}
          />
          <div className="fixed inset-y-0 right-0 flex max-w-full pl-10 pointer-events-none">
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{
                type: "spring",
                damping: 32,
                stiffness: 380,
              }}
              onClick={(e) => e.stopPropagation()}
              className={`w-screen ${maxWidthClass} bg-white shadow-2xl flex flex-col border-l border-slate-200 pointer-events-auto`}
            >
              {children}
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>
  );
}
