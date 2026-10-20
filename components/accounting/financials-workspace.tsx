"use client";

import { useCallback, useEffect, useState, startTransition } from "react";
import dynamic from "next/dynamic";
import {
  CalendarBlankIcon,
  PackageIcon,
} from "@phosphor-icons/react";

function TabLoading() {
  return (
    <div className="grid h-full min-h-[420px] place-items-center bg-slate-50" role="status">
      <div className="text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-amber-100 border-t-amber-500" />
        <p className="mt-3 text-xs font-bold text-slate-500">Đang tải dữ liệu…</p>
      </div>
    </div>
  );
}

const SkuWinView = dynamic(
  () => import("./sku-win-view").then((m) => m.SkuWinView),
  { loading: TabLoading }
);

const FbaDailyView = dynamic(
  () => import("./fba-daily-view").then((m) => m.FbaDailyView),
  { loading: TabLoading }
);

export type FinancialsSubTab = "sku_win" | "fba";

export function FinancialsWorkspace() {
  const [activeTab, setActiveTab] = useState<FinancialsSubTab>(() => {
    if (typeof window !== "undefined") {
      const saved = window.sessionStorage.getItem("accounting_financials_sub_tab") as FinancialsSubTab;
      if (saved === "sku_win" || saved === "fba") {
        return saved;
      }
    }
    return "sku_win";
  });

  const [visitedTabs, setVisitedTabs] = useState<Record<FinancialsSubTab, boolean>>(() => ({
    sku_win: true,
    fba: activeTab === "fba",
  }));

  const handleTabChange = useCallback((tab: FinancialsSubTab) => {
    setVisitedTabs((prev) => (prev[tab] ? prev : { ...prev, [tab]: true }));
    startTransition(() => {
      setActiveTab(tab);
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem("accounting_financials_sub_tab", tab);
      }
    });
  }, []);

  return (
    <div className="flex h-full w-full flex-col bg-slate-50 overflow-hidden font-accounting-system">
      {/* SUB-TABS BAR (Đồng bộ phong cách với tab Import) */}
      <div className="bg-slate-200/80 px-3 pt-2 pb-1.5 border-b border-slate-300 shrink-0">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {/* Tab 1: LỌC SKU WIN */}
          <button
            type="button"
            onClick={() => handleTabChange("sku_win")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wide border transition-all cursor-pointer select-none whitespace-nowrap ${
              activeTab === "sku_win"
                ? "bg-amber-600 text-white shadow-2xs border-amber-700"
                : "border-transparent text-slate-700 hover:bg-slate-300/70 hover:text-slate-900"
            }`}
          >
            <PackageIcon size={14} weight="bold" />
            <span>Lọc SKU Win</span>
          </button>

          {/* Tab 2: FBA (Theo Ngày) */}
          <button
            type="button"
            onClick={() => handleTabChange("fba")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wide border transition-all cursor-pointer select-none whitespace-nowrap ${
              activeTab === "fba"
                ? "bg-amber-600 text-white shadow-2xs border-amber-700"
                : "border-transparent text-slate-700 hover:bg-slate-300/70 hover:text-slate-900"
            }`}
          >
            <CalendarBlankIcon size={14} weight="bold" />
            <span>FBA</span>
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                activeTab === "fba" ? "bg-amber-700 text-white" : "bg-slate-300/80 text-slate-700"
              }`}
            >
              Theo Ngày
            </span>
          </button>
        </div>
      </div>

      {/* CONTENT PANELS (Instant switching via CSS hidden) */}
      <div className="flex-1 overflow-hidden relative">
        {visitedTabs.sku_win && (
          <div className={activeTab === "sku_win" ? "h-full w-full flex flex-col" : "hidden"}>
            <SkuWinView />
          </div>
        )}
        {visitedTabs.fba && (
          <div className={activeTab === "fba" ? "h-full w-full flex flex-col" : "hidden"}>
            <FbaDailyView />
          </div>
        )}
      </div>
    </div>
  );
}
