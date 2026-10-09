"use client";

import { useState, useEffect } from "react";
import { StoreManagementView } from "./store-management-view";
import { InventoryView } from "./inventory-view";

export type AccountingModuleKey =
  | "overview"
  | "stores"
  | "inventory"
  | "orders"
  | "financials"
  | "reports"
  | "admin"
  | "dashboard"
  | "revenue"
  | "costs"
  | "amazon_fees"
  | "ads"
  | "pnl"
  | "settlements";

export type FinancialsTabKey = "revenue" | "costs" | "amazon_fees" | "ads";
export type ReportsTabKey = "pnl" | "settlements";

export interface AccountingWorkspaceProps {
  activeSection?: AccountingModuleKey;
  activeSubTab?: string;
  onSectionChange?: (section: AccountingModuleKey, subTab?: string) => void;
}

const FINANCIALS_TABS: { key: FinancialsTabKey; label: string; name: string; description: string }[] = [
  {
    key: "revenue",
    label: "Revenue",
    name: "Revenue",
    description: "Doanh thu theo Store, SKU, ASIN và thời gian.",
  },
  {
    key: "costs",
    label: "Costs",
    name: "Costs",
    description: "Chi phí nhập hàng gốc (COGS), chi phí phôi và chi phí hoàn tất đơn hàng.",
  },
  {
    key: "amazon_fees",
    label: "Amazon Fees",
    name: "Amazon Fees",
    description: "Phí Referral, FBA fulfillment fees, Storage fees và các phụ phí sàn Amazon.",
  },
  {
    key: "ads",
    label: "Advertising",
    name: "Advertising",
    description: "Chi phí quảng cáo Amazon Ads (Sponsored Products, Brands, Display) và phân bổ chi phí.",
  },
];

const REPORTS_TABS: { key: ReportsTabKey; label: string; name: string; description: string }[] = [
  {
    key: "pnl",
    label: "Profit & Loss",
    name: "Profit & Loss",
    description: "Báo cáo P&L lợi nhuận ròng, biên lợi nhuận theo Store, SKU, tháng và thị trường.",
  },
  {
    key: "settlements",
    label: "Settlements",
    name: "Settlements",
    description: "Bảng đối soát Settlement Amazon, đối chiếu payout chuyển về tài khoản ngân hàng.",
  },
];

const MODULE_DEFINITIONS: Record<
  string,
  { number: number; name: string; description: string }
> = {
  overview: {
    number: 1,
    name: "Overview",
    description: "Executive overview tổng quan về doanh thu, chi phí, lợi nhuận ròng và biên lợi nhuận.",
  },
  dashboard: {
    number: 1,
    name: "Overview",
    description: "Executive overview tổng quan về doanh thu, chi phí, lợi nhuận ròng và biên lợi nhuận.",
  },
  stores: {
    number: 2,
    name: "Store Management",
    description: "Quản lý danh sách Store, marketplace, tài khoản liên kết và pháp nhân.",
  },
  inventory: {
    number: 3,
    name: "Inventory",
    description: "Khai báo SKU, phôi hàng, quản lý niche, lô hàng, lô tồn và shipment.",
  },
  orders: {
    number: 4,
    name: "Orders",
    description: "Nhập và đối soát đơn hàng, hoàn tiền, hủy đơn và trạng thái vòng đời đơn hàng.",
  },
  admin: {
    number: 7,
    name: "System Admin",
    description: "Phân quyền vai trò người dùng, cài đặt hệ thống và cấu hình dữ liệu.",
  },
};

export function AccountingWorkspace({
  activeSection = "stores",
  activeSubTab,
  onSectionChange,
}: AccountingWorkspaceProps) {
  // Normalize legacy keys
  const effectiveSection: AccountingModuleKey =
    activeSection === "dashboard"
      ? "overview"
      : activeSection === "revenue" ||
        activeSection === "costs" ||
        activeSection === "amazon_fees" ||
        activeSection === "ads"
      ? "financials"
      : activeSection === "pnl" || activeSection === "settlements"
      ? "reports"
      : activeSection;

  // Sub-tabs state
  const initialFinancialsTab: FinancialsTabKey =
    activeSection === "costs"
      ? "costs"
      : activeSection === "amazon_fees"
      ? "amazon_fees"
      : activeSection === "ads"
      ? "ads"
      : (activeSubTab as FinancialsTabKey) || "revenue";

  const initialReportsTab: ReportsTabKey =
    activeSection === "settlements"
      ? "settlements"
      : (activeSubTab as ReportsTabKey) || "pnl";

  const [financialsTab, setFinancialsTab] = useState<FinancialsTabKey>(initialFinancialsTab);
  const [reportsTab, setReportsTab] = useState<ReportsTabKey>(initialReportsTab);

  useEffect(() => {
    if (
      activeSection === "revenue" ||
      activeSection === "costs" ||
      activeSection === "amazon_fees" ||
      activeSection === "ads"
    ) {
      setFinancialsTab(activeSection);
    } else if (activeSubTab && ["revenue", "costs", "amazon_fees", "ads"].includes(activeSubTab)) {
      setFinancialsTab(activeSubTab as FinancialsTabKey);
    }
  }, [activeSection, activeSubTab]);

  useEffect(() => {
    if (activeSection === "pnl" || activeSection === "settlements") {
      setReportsTab(activeSection);
    } else if (activeSubTab && ["pnl", "settlements"].includes(activeSubTab)) {
      setReportsTab(activeSubTab as ReportsTabKey);
    }
  }, [activeSection, activeSubTab]);

  // Section 2: Stores (Existing Full UI)
  if (effectiveSection === "stores") {
    return <StoreManagementView />;
  }

  // Section 3: Inventory (Full Multi-Store UI with SKU Master & Inbound Shipments)
  if (effectiveSection === "inventory") {
    return <InventoryView />;
  }

  // Section 5: Financials with Horizontal Tabs
  if (effectiveSection === "financials") {
    const activeTabDef =
      FINANCIALS_TABS.find((t) => t.key === financialsTab) || FINANCIALS_TABS[0];

    const handleFinancialsTabSelect = (tabKey: FinancialsTabKey) => {
      setFinancialsTab(tabKey);
      onSectionChange?.("financials", tabKey);
    };

    return (
      <div className="w-full max-w-5xl mx-auto py-6 space-y-6">
        <div className="bg-white rounded-2xl border border-slate-200/90 p-7 shadow-2xs space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Financials</h1>
              <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full">
                4 Chức Năng
              </span>
            </div>

            {/* Horizontal pill tabs as requested in mockup */}
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-4">
              {FINANCIALS_TABS.map((tab) => {
                const isActive = financialsTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => handleFinancialsTabSelect(tab.key)}
                    className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                      isActive
                        ? "bg-slate-900 text-white shadow-xs"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sub-tab view area */}
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-6 space-y-2">
            <h2 className="text-base font-bold text-slate-900">
              {activeTabDef.name}
            </h2>
            <p className="text-xs text-slate-500 max-w-xl leading-relaxed">
              {activeTabDef.description}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Section 6: Reports with Horizontal Tabs
  if (effectiveSection === "reports") {
    const activeTabDef =
      REPORTS_TABS.find((t) => t.key === reportsTab) || REPORTS_TABS[0];

    const handleReportsTabSelect = (tabKey: ReportsTabKey) => {
      setReportsTab(tabKey);
      onSectionChange?.("reports", tabKey);
    };

    return (
      <div className="w-full max-w-5xl mx-auto py-6 space-y-6">
        <div className="bg-white rounded-2xl border border-slate-200/90 p-7 shadow-2xs space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Reports</h1>
              <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full">
                2 Báo Cáo
              </span>
            </div>

            {/* Horizontal pill tabs as requested in mockup */}
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-4">
              {REPORTS_TABS.map((tab) => {
                const isActive = reportsTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => handleReportsTabSelect(tab.key)}
                    className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                      isActive
                        ? "bg-slate-900 text-white shadow-xs"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sub-tab view area */}
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-6 space-y-2">
            <h2 className="text-base font-bold text-slate-900">
              {activeTabDef.name}
            </h2>
            <p className="text-xs text-slate-500 max-w-xl leading-relaxed">
              {activeTabDef.description}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Other single sections: Overview, Inventory, Orders, Admin
  const moduleInfo = MODULE_DEFINITIONS[effectiveSection] || MODULE_DEFINITIONS.overview;

  return (
    <div className="w-full max-w-4xl mx-auto py-8">
      <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-2xs text-center space-y-4">
        <div className="inline-flex items-center justify-center h-10 w-10 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600 font-extrabold text-sm">
          {moduleInfo.number}
        </div>
        <h2 className="text-base font-extrabold text-slate-900 tracking-tight">
          {moduleInfo.name}
        </h2>
        <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
          {moduleInfo.description}
        </p>
        <div className="pt-4">
          <button
            type="button"
            onClick={() => onSectionChange?.("stores")}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition cursor-pointer"
          >
            Go to Store Management
          </button>
        </div>
      </div>
    </div>
  );
}
