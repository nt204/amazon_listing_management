"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  CalendarBlankIcon,
  CalendarDotsIcon,
  FlaskIcon,
  ListChecksIcon,
  PackageIcon,
  TruckIcon,
  type Icon,
} from "@phosphor-icons/react";
import { storeCanView, storeHasTeam } from "@/lib/accounting/store-teams";
import {
  FINANCIALS_GROUPS,
  GROUP_TABS,
  financialsGroupOf,
  isSubTab,
  type FinancialsGroup,
  type FinancialsSubTab,
} from "./financials-groups";
import type { StoreAccessInfo } from "@/lib/accounting/types";
import { channelTabBadgeActiveClass } from "./channel-tab-colors";
import {
  AccountingModuleSkeleton,
  AnimatedTabPill,
  AccountingViewTransition,
} from "./accounting-skeleton";

function TabLoading() {
  return <AccountingModuleSkeleton title="Đang tải dữ liệu tài chính..." cardsCount={0} />;
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

const WeeklyReportView = dynamic(
  () => import("./weekly-report-view").then((m) => m.WeeklyReportView),
  { loading: TabLoading }
);

const SkuMonthlyView = dynamic(
  () => import("./sku-monthly-view").then((m) => m.SkuMonthlyView),
  { loading: TabLoading }
);

const FBM_TABS: FinancialsSubTab[] = ["fbm", "sku_monthly_fbm", "fbm_fixed"];

type TabItem = { key: FinancialsSubTab; label: string; badge?: string; icon: Icon };

const FBA_TAB_ITEMS: TabItem[] = [
  { key: "fba", label: "FBA", badge: "Theo Ngày", icon: CalendarBlankIcon },
  // Báo cáo tuần tổng hợp mọi store — file "BÁO CÁO TUẦN TỔNG HỢP"
  { key: "weekly", label: "Báo Cáo Tuần", badge: "Tổng hợp", icon: CalendarDotsIcon },
  { key: "sku_monthly", label: "Báo Cáo Tháng", badge: "SKU Monthly", icon: CalendarBlankIcon },
  { key: "sku_win", label: "Lọc SKU Win", icon: PackageIcon },
  { key: "sku_test", label: "Lọc SKU Test", icon: FlaskIcon },
];

const FBM_TAB_ITEMS: TabItem[] = [
  // FBM (Theo Ngày) — sheet "FBM"
  { key: "fbm", label: "FBM", badge: "Theo Ngày", icon: TruckIcon },
  // Báo cáo tháng FBM — tab "SKU FBM-monthly" của file TỔNG KẾT CUỐI THÁNG
  { key: "sku_monthly_fbm", label: "Báo Cáo Tháng", badge: "SKU FBM-monthly", icon: CalendarBlankIcon },
  // FBM cố định — sheet "LỌC SKU CỐ ĐỊNH": mọi SKU trong Bảng mã FBM
  { key: "fbm_fixed", label: "FBM Cố định", icon: ListChecksIcon },
];

export type { FinancialsGroup, FinancialsSubTab };

const tabStorageKey = (group: FinancialsGroup) => `accounting_financials_tab_${group}`;

export function FinancialsWorkspace({ subTab }: { subTab?: string }) {
  const group = financialsGroupOf(subTab);
  // Tab đang mở của từng kỳ (nhớ trong phiên); link cũ ?subtab=<tab> mở đúng tab đó
  const [tabByGroup, setTabByGroup] = useState<Partial<Record<FinancialsGroup, FinancialsSubTab>>>(() => {
    const out: Partial<Record<FinancialsGroup, FinancialsSubTab>> = {};
    if (typeof window !== "undefined") {
      for (const g of FINANCIALS_GROUPS) {
        const saved = window.sessionStorage.getItem(tabStorageKey(g));
        if (isSubTab(saved) && GROUP_TABS[g].includes(saved)) out[g] = saved;
      }
    }
    if (isSubTab(subTab)) out[financialsGroupOf(subTab)] = subTab;
    return out;
  });
  const activeTab: FinancialsSubTab = tabByGroup[group] ?? GROUP_TABS[group][0];

  // Tab FBM / FBM cố định chỉ dành cho store có team FBM: theo dõi store đang chọn (dùng chung giữa các tab)
  const [storeInfo, setStoreInfo] = useState<Map<string, { id: string; team?: string; access?: StoreAccessInfo }> | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  useEffect(() => {
    let ignore = false;
    fetch("/api/accounting/stores")
      .then((res) => (res.ok ? res.json() : { stores: [] }))
      .then((data: { stores?: { id: string; team?: string; access?: StoreAccessInfo }[] }) => {
        if (!ignore) setStoreInfo(new Map((data.stores || []).map((s) => [s.id, s])));
      })
      .catch(() => {
        if (!ignore) setStoreInfo(new Map());
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
  const selectedStore = storeInfo?.get(selectedStoreId);
  const showFbmTabs = storeInfo != null && storeHasTeam(selectedStore?.team, "FBM") && storeCanView(selectedStore, "FBM");
  // Phân quyền kế toán: người chỉ được xem FBM (team FBM) không thấy nhóm tab FBA
  const canViewFba = storeInfo == null || [...storeInfo.values()].some((s) => storeCanView(s, "FBA"));
  // Store không có FBM (hoặc đổi sang store khác) thì quay về tab FBA cùng kỳ; không xem được FBA thì sang FBM cùng kỳ
  const groupTabs = GROUP_TABS[group];
  const firstFba = groupTabs.find((t) => !FBM_TABS.includes(t));
  const firstFbm = groupTabs.find((t) => FBM_TABS.includes(t));
  const visibleTab: FinancialsSubTab =
    storeInfo != null && !showFbmTabs && FBM_TABS.includes(activeTab) && firstFba
      ? firstFba
      : !canViewFba && !FBM_TABS.includes(activeTab) && activeTab !== "weekly" && firstFbm
      ? firstFbm
      : activeTab;

  const handleTabChange = useCallback(
    (tab: FinancialsSubTab) => {
      setTabByGroup((prev) => ({ ...prev, [group]: tab }));
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(tabStorageKey(group), tab);
      }
    },
    [group],
  );

  const fbaItems = FBA_TAB_ITEMS.filter((t) => groupTabs.includes(t.key));
  const fbmItems = FBM_TAB_ITEMS.filter((t) => groupTabs.includes(t.key));
  const shownFba = canViewFba ? fbaItems : fbaItems.filter((t) => t.key === "weekly");
  const shownFbm = showFbmTabs || !canViewFba ? fbmItems : [];
  // Kỳ chỉ còn 1 tab (vd Tuần) thì không cần thanh tab
  const showTabBar = shownFba.length + shownFbm.length > 1;

  const renderTab = (tab: TabItem) => {
    const isActive = visibleTab === tab.key;
    const isFbm = FBM_TABS.includes(tab.key);
    const Icon = tab.icon;
    return (
      <button
        key={tab.key}
        type="button"
        onClick={() => handleTabChange(tab.key)}
        className={`relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wide border cursor-pointer select-none whitespace-nowrap acc-interactive-btn ${
          isActive
            ? isFbm
              ? "text-white border-violet-700"
              : "text-white border-sky-700"
            : "border-transparent text-slate-700 hover:bg-slate-300/70 hover:text-slate-900"
        }`}
      >
        {isActive && (
          <AnimatedTabPill
            layoutId="financials-tab-indicator"
            className={
              isFbm
                ? "bg-violet-600 shadow-2xs border border-violet-700"
                : "bg-sky-600 shadow-2xs border border-sky-700"
            }
          />
        )}
        <span className="relative z-10 flex items-center gap-1.5">
          <Icon size={14} weight="bold" />
          <span>{tab.label}</span>
          {tab.badge && (
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                isActive
                  ? channelTabBadgeActiveClass(isFbm ? "fbm" : "fba")
                  : "bg-slate-300/80 text-slate-700"
              }`}
            >
              {tab.badge}
            </span>
          )}
        </span>
      </button>
    );
  };

  return (
    <div className="flex h-full w-full flex-col bg-slate-50 overflow-hidden font-accounting-system">
      {/* SUB-TABS BAR (Đồng bộ phong cách với tab Import) */}
      {showTabBar && (
        <div className="bg-slate-200/80 px-3 pt-2 pb-1.5 border-b border-slate-300 shrink-0">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {shownFba.map(renderTab)}

            {/* Vạch ngăn nhóm tab FBA với nhóm tab FBM cho đỡ lẫn */}
            {shownFbm.length > 0 && (
              <>
                {shownFba.length > 0 && <span className="mx-1 h-6 w-px shrink-0 bg-slate-400" aria-hidden="true" />}
                {shownFbm.map(renderTab)}
              </>
            )}
          </div>
        </div>
      )}

      {/* CONTENT PANELS: Mount ONLY active tab to isolate performance and eliminate background lag */}
      <div className="flex-1 overflow-hidden relative">
        <AccountingViewTransition transitionKey={visibleTab} className="h-full w-full">
          {visibleTab === "fba" && <FbaDailyView key="fba" />}
          {visibleTab === "weekly" && <WeeklyReportView key="weekly" />}
          {visibleTab === "sku_monthly" && <SkuMonthlyView key="sku_monthly" />}
          {visibleTab === "sku_win" && <SkuWinView key="sku_win" />}
          {visibleTab === "sku_test" && <SkuTestView />}
                    {visibleTab === "fbm" && <FbaDailyView key="fbm" channel="fbm" />}
          {visibleTab === "sku_monthly_fbm" && <SkuMonthlyView key="sku_monthly_fbm" channel="fbm" />}
          {visibleTab === "fbm_fixed" && <SkuWinView key="fbm_fixed" variant="fbm_fixed" />}
        </AccountingViewTransition>
      </div>
    </div>
  );
}
