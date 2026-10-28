"use client";

import { useCallback, useEffect, useState, startTransition } from "react";
import dynamic from "next/dynamic";
import {
  CalendarBlankIcon,
  FlaskIcon,
  ListChecksIcon,
  PackageIcon,
  TruckIcon,
} from "@phosphor-icons/react";
import { storeHasTeam } from "@/lib/accounting/store-teams";

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

const SkuTestView = dynamic(
  () => import("./sku-test-view").then((m) => m.SkuTestView),
  { loading: TabLoading }
);

const FbaDailyView = dynamic(
  () => import("./fba-daily-view").then((m) => m.FbaDailyView),
  { loading: TabLoading }
);

export type FinancialsSubTab = "sku_win" | "sku_test" | "fba" | "fbm" | "fbm_fixed";

const SUB_TABS: FinancialsSubTab[] = ["sku_win", "sku_test", "fba", "fbm", "fbm_fixed"];
const FBM_TABS: FinancialsSubTab[] = ["fbm", "fbm_fixed"];

function isSubTab(value: string | null): value is FinancialsSubTab {
  return SUB_TABS.includes(value as FinancialsSubTab);
}

export function FinancialsWorkspace() {
  const [activeTab, setActiveTab] = useState<FinancialsSubTab>(() => {
    if (typeof window !== "undefined") {
      const urlSubTab = new URLSearchParams(window.location.search).get("subtab");
      if (isSubTab(urlSubTab)) return urlSubTab;
      const saved = window.sessionStorage.getItem("accounting_financials_sub_tab");
      if (isSubTab(saved)) return saved;
    }
    return "fba";
  });

  // Tab FBM / FBM cố định chỉ dành cho store có team FBM: theo dõi store đang chọn (dùng chung giữa các tab)
  const [storeTeams, setStoreTeams] = useState<Map<string, string> | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  useEffect(() => {
    let ignore = false;
    fetch("/api/accounting/stores")
      .then((res) => (res.ok ? res.json() : { stores: [] }))
      .then((data: { stores?: { id: string; team?: string }[] }) => {
        if (!ignore) setStoreTeams(new Map((data.stores || []).map((s) => [s.id, s.team || ""])));
      })
      .catch(() => {
        if (!ignore) setStoreTeams(new Map());
      });
    const syncStore = () => setSelectedStoreId(window.localStorage.getItem("acc_selected_store_id") || "");
    syncStore();
    window.addEventListener("acc_store_changed", syncStore);
    window.addEventListener("storage", syncStore);
    return () => {
      ignore = true;
      window.removeEventListener("acc_store_changed", syncStore);
      window.removeEventListener("storage", syncStore);
    };
  }, []);
  const showFbmTabs = storeTeams != null && storeHasTeam(storeTeams.get(selectedStoreId), "FBM");
  // Store không có FBM (hoặc đổi sang store khác) thì quay về tab FBA
  const visibleTab: FinancialsSubTab = storeTeams != null && !showFbmTabs && FBM_TABS.includes(activeTab) ? "fba" : activeTab;

  const handleTabChange = useCallback((tab: FinancialsSubTab) => {
    setActiveTab(tab);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("accounting_financials_sub_tab", tab);
    }
  }, []);

  return (
    <div className="flex h-full w-full flex-col bg-slate-50 overflow-hidden font-accounting-system">
      {/* SUB-TABS BAR (Đồng bộ phong cách với tab Import) */}
      <div className="bg-slate-200/80 px-3 pt-2 pb-1.5 border-b border-slate-300 shrink-0">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {/* Tab 1: FBA (Theo Ngày) */}
          <button
            type="button"
            onClick={() => handleTabChange("fba")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wide border transition-all cursor-pointer select-none whitespace-nowrap ${
              visibleTab === "fba"
                ? "bg-amber-600 text-white shadow-2xs border-amber-700"
                : "border-transparent text-slate-700 hover:bg-slate-300/70 hover:text-slate-900"
            }`}
          >
            <CalendarBlankIcon size={14} weight="bold" />
            <span>FBA</span>
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                visibleTab === "fba" ? "bg-amber-700 text-white" : "bg-slate-300/80 text-slate-700"
              }`}
            >
              Theo Ngày
            </span>
          </button>

          {showFbmTabs && (
            <>
              {/* FBM (Theo Ngày) — sheet "FBM" */}
              <button
                type="button"
                onClick={() => handleTabChange("fbm")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wide border transition-all cursor-pointer select-none whitespace-nowrap ${
                  visibleTab === "fbm"
                    ? "bg-amber-600 text-white shadow-2xs border-amber-700"
                    : "border-transparent text-slate-700 hover:bg-slate-300/70 hover:text-slate-900"
                }`}
              >
                <TruckIcon size={14} weight="bold" />
                <span>FBM</span>
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                    visibleTab === "fbm" ? "bg-amber-700 text-white" : "bg-slate-300/80 text-slate-700"
                  }`}
                >
                  Theo Ngày
                </span>
              </button>

              {/* FBM cố định — sheet "LỌC SKU CỐ ĐỊNH": mọi SKU trong Bảng mã FBM */}
              <button
                type="button"
                onClick={() => handleTabChange("fbm_fixed")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wide border transition-all cursor-pointer select-none whitespace-nowrap ${
                  visibleTab === "fbm_fixed"
                    ? "bg-amber-600 text-white shadow-2xs border-amber-700"
                    : "border-transparent text-slate-700 hover:bg-slate-300/70 hover:text-slate-900"
                }`}
              >
                <ListChecksIcon size={14} weight="bold" />
                <span>FBM Cố định</span>
              </button>
            </>
          )}

          {/* Tab 2: LỌC SKU WIN */}
          <button
            type="button"
            onClick={() => handleTabChange("sku_win")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wide border transition-all cursor-pointer select-none whitespace-nowrap ${
              visibleTab === "sku_win"
                ? "bg-amber-600 text-white shadow-2xs border-amber-700"
                : "border-transparent text-slate-700 hover:bg-slate-300/70 hover:text-slate-900"
            }`}
          >
            <PackageIcon size={14} weight="bold" />
            <span>Lọc SKU Win</span>
          </button>

          {/* Tab 3: LỌC SKU TEST */}
          <button
            type="button"
            onClick={() => handleTabChange("sku_test")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wide border transition-all cursor-pointer select-none whitespace-nowrap ${
              visibleTab === "sku_test"
                ? "bg-amber-600 text-white shadow-2xs border-amber-700"
                : "border-transparent text-slate-700 hover:bg-slate-300/70 hover:text-slate-900"
            }`}
          >
            <FlaskIcon size={14} weight="bold" />
            <span>Lọc SKU Test</span>
          </button>
        </div>
      </div>

      {/* CONTENT PANELS: Mount ONLY active tab to isolate performance and eliminate background lag */}
      <div className="flex-1 overflow-hidden relative">
        {visibleTab === "fba" && <FbaDailyView key="fba" />}
        {visibleTab === "sku_win" && <SkuWinView key="sku_win" />}
        {visibleTab === "sku_test" && <SkuTestView />}
        {visibleTab === "fbm" && <FbaDailyView key="fbm" channel="fbm" />}
        {visibleTab === "fbm_fixed" && <SkuWinView key="fbm_fixed" variant="fbm_fixed" />}
      </div>
    </div>
  );
}
