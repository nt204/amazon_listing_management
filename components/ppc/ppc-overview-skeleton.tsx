import React from "react";

export function PpcOverviewSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* 1. EXECUTIVE KPI CARDS SKELETON */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs space-y-2.5"
          >
            <div className="h-2.5 w-12 bg-slate-200 rounded" />
            <div className="h-6 w-20 bg-slate-300 rounded" />
            <div className="h-2 w-16 bg-slate-100 rounded" />
          </div>
        ))}
      </div>

      {/* 2. TREND CHART SKELETON */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs space-y-4">
        {/* Chart Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="space-y-1.5">
            <div className="h-4 w-48 bg-slate-300 rounded" />
            <div className="h-2.5 w-72 bg-slate-200 rounded" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-7 w-20 bg-slate-100 rounded-lg" />
            <div className="h-7 w-20 bg-slate-100 rounded-lg" />
            <div className="h-7 w-20 bg-slate-100 rounded-lg" />
          </div>
        </div>

        {/* Chart Canvas Area */}
        <div className="h-72 w-full bg-slate-50 rounded-lg relative overflow-hidden flex flex-col justify-end p-4 gap-4">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent -translate-x-full animate-[shimmer_1.8s_infinite]" />
          {/* Simulated grid lines */}
          <div className="border-b border-slate-200/60 w-full" />
          <div className="border-b border-slate-200/60 w-full" />
          <div className="border-b border-slate-200/60 w-full" />
          {/* Simulated chart bars/waveform */}
          <div className="flex items-end justify-between gap-2 h-44 pt-4">
            {Array.from({ length: 24 }).map((_, idx) => (
              <div
                key={idx}
                className="w-full bg-slate-200/70 rounded-t"
                style={{
                  height: `${25 + ((idx * 17) % 65)}%`,
                }}
              />
            ))}
          </div>
          <div className="border-b border-slate-300 w-full" />
        </div>
      </div>

      {/* 3. TOP CAMPAIGNS & TOP SKUS TABLES SKELETON */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Left: Top Campaigns Skeleton */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <div className="h-3.5 w-36 bg-slate-300 rounded" />
            <div className="h-3 w-16 bg-slate-100 rounded" />
          </div>
          <div className="space-y-2.5">
            {Array.from({ length: 5 }).map((_, idx) => (
              <div key={idx} className="flex items-center justify-between gap-4 py-1.5 border-b border-slate-50">
                <div className="h-3 w-40 bg-slate-200 rounded" />
                <div className="h-3 w-12 bg-slate-200 rounded" />
                <div className="h-3 w-14 bg-slate-200 rounded" />
                <div className="h-3 w-10 bg-slate-200 rounded" />
              </div>
            ))}
          </div>
        </div>

        {/* Right: Top SKUs Skeleton */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <div className="h-3.5 w-32 bg-slate-300 rounded" />
            <div className="h-3 w-16 bg-slate-100 rounded" />
          </div>
          <div className="space-y-2.5">
            {Array.from({ length: 5 }).map((_, idx) => (
              <div key={idx} className="flex items-center justify-between gap-4 py-1.5 border-b border-slate-50">
                <div className="h-3 w-36 bg-slate-200 rounded" />
                <div className="h-3 w-12 bg-slate-200 rounded" />
                <div className="h-3 w-14 bg-slate-200 rounded" />
                <div className="h-3 w-10 bg-slate-200 rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
