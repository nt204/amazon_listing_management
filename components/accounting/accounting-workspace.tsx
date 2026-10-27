"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";

const ACCOUNTING_IMPORT_JOB_KEY = "accounting_import_active_job";

type TrackedAccountingImport = {
  id: string;
  fileName: string;
};

function AccountingImportTracker() {
  const [trackedJob, setTrackedJob] = useState<TrackedAccountingImport | null>(null);
  const [stage, setStage] = useState("Đang chờ worker nhận job");
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState<{ message: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    const restore = () => {
      try {
        const raw = localStorage.getItem(ACCOUNTING_IMPORT_JOB_KEY);
        setTrackedJob(raw ? JSON.parse(raw) : null);
      } catch {
        localStorage.removeItem(ACCOUNTING_IMPORT_JOB_KEY);
      }
    };
    const handleQueued = (event: Event) => {
      const detail = (event as CustomEvent<TrackedAccountingImport>).detail;
      if (detail?.id) setTrackedJob(detail);
    };
    restore();
    window.addEventListener("accounting-import-queued", handleQueued);
    return () => window.removeEventListener("accounting-import-queued", handleQueued);
  }, []);

  useEffect(() => {
    if (!trackedJob?.id) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (message: string, type: "success" | "error") => {
      localStorage.removeItem(ACCOUNTING_IMPORT_JOB_KEY);
      setTrackedJob(null);
      setNotice({ message, type });
      window.dispatchEvent(new CustomEvent("accounting-import-completed", { detail: { type } }));
      window.setTimeout(() => setNotice(null), 30_000);
    };

    const poll = async () => {
      try {
        const response = await fetch(
          `/api/accounting/unified-import?jobId=${encodeURIComponent(trackedJob.id)}`,
          { cache: "no-store" },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `Không đọc được trạng thái (${response.status})`);
        if (cancelled) return;
        const job = payload.job || {};
        setStage(job.stage || "Đang xử lý dữ liệu");
        setProgress(Number(job.progress_pct) || 0);
        if (job.status === "COMPLETED") {
          finish(job.result?.message || "Đã nạp thành công toàn bộ dữ liệu kế toán!", "success");
          return;
        }
        if (job.status === "FAILED") {
          finish(job.error_message || "Nạp dữ liệu kế toán thất bại.", "error");
          return;
        }
        timer = setTimeout(poll, 2500);
      } catch (error) {
        if (cancelled) return;
        // Lỗi mạng tạm thời không làm mất job; tiếp tục hỏi lại sau 5 giây.
        setStage(error instanceof Error ? error.message : "Đang kết nối lại…");
        timer = setTimeout(poll, 5000);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [trackedJob]);

  if (!trackedJob && !notice) return null;
  return (
    <div className="fixed right-5 top-5 z-[100] w-[min(390px,calc(100vw-2.5rem))]" aria-live="polite">
      {trackedJob && (
        <div className="rounded-xl border border-indigo-200 bg-white p-4 shadow-2xl">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-indigo-100 border-t-indigo-600" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3 text-sm font-bold text-slate-900">
                <span>Đang nạp file kế toán</span>
                <span className="text-indigo-700">{progress}%</span>
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-500" title={trackedJob.fileName}>{trackedJob.fileName}</p>
              <p className="mt-2 text-xs font-semibold text-indigo-800">{stage}</p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-indigo-100">
                <div className="h-full rounded-full bg-indigo-600 transition-all duration-500" style={{ width: `${Math.max(3, progress)}%` }} />
              </div>
              <p className="mt-2 text-[11px] text-slate-500">Bạn có thể chuyển sang tab khác; job vẫn tiếp tục chạy nền.</p>
            </div>
          </div>
        </div>
      )}
      {notice && (
        <div className={`flex items-start gap-3 rounded-xl p-4 text-white shadow-2xl ${notice.type === "success" ? "bg-emerald-600" : "bg-rose-600"}`}>
          <span className="mt-0.5 text-lg leading-none">{notice.type === "success" ? "✓" : "!"}</span>
          <p className="flex-1 text-sm font-bold leading-5">{notice.message}</p>
          <button type="button" onClick={() => setNotice(null)} className="rounded p-0.5 text-white/80 hover:bg-white/15 hover:text-white" aria-label="Đóng thông báo">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function AccountingSectionShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-accounting-system h-full w-full text-slate-900 bg-slate-50">
      <AccountingImportTracker />
      {children}
    </div>
  );
}

function AccountingSectionLoading() {
  return (
    <div className="grid h-full min-h-[420px] place-items-center bg-slate-50" role="status" aria-label="Đang tải mục Accounting">
      <div className="text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-indigo-100 border-t-indigo-600" />
        <p className="mt-3 text-xs font-bold text-slate-500">Đang tải dữ liệu…</p>
      </div>
    </div>
  );
}

const StoreManagementView = dynamic(
  () => import("./store-management-view").then((module) => module.StoreManagementView),
  { loading: AccountingSectionLoading },
);
const InventoryView = dynamic(
  () => import("./inventory-view").then((module) => module.InventoryView),
  { loading: AccountingSectionLoading },
);
const AccountingFileManager = dynamic(
  () => import("./accounting-file-manager").then((module) => module.AccountingFileManager),
  { loading: AccountingSectionLoading },
);
const OrderInputView = dynamic(
  () => import("./order-input-view").then((module) => module.OrderInputView),
  { loading: AccountingSectionLoading },
);
const FinancialsWorkspace = dynamic(
  () => import("./financials-workspace").then((module) => module.FinancialsWorkspace),
  { loading: AccountingSectionLoading },
);
const AccountingDashboardView = dynamic(
  () => import("./accounting-dashboard-view").then((module) => module.AccountingDashboardView),
  { loading: AccountingSectionLoading },
);


export type AccountingModuleKey =
  | "overview"
  | "stores"
  | "inventory"
  | "files"
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
  | "settlements"
  | "import";

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
    name: "Import",
    description: "Nhập và đối soát đơn hàng, ads, hoàn tiền và chi phí dịch vụ.",
  },
  import: {
    number: 4,
    name: "Import",
    description: "Nhập và đối soát đơn hàng, ads, hoàn tiền và chi phí dịch vụ.",
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

  // Section 1: Overview - Dashboard tổng quan P&L đa store
  if (effectiveSection === "overview") {
    return (
      <AccountingSectionShell>
        <AccountingDashboardView onNavigateFinancials={() => onSectionChange?.("financials")} />
      </AccountingSectionShell>
    );
  }

  // Section 2: Stores (Existing Full UI)
  if (effectiveSection === "stores") {
    return (
      <AccountingSectionShell>
        <StoreManagementView />
      </AccountingSectionShell>
    );
  }

  // Section 3: Inventory (Full Multi-Store UI with SKU Master & Inbound Shipments)
  if (effectiveSection === "inventory") {
    return (
      <AccountingSectionShell>
        <InventoryView />
      </AccountingSectionShell>
    );
  }

  // Section 4: Import (Đầu Vào Order, Ads, Return, Service Fee)
  if (effectiveSection === "orders" || effectiveSection === "import") {
    return (
      <AccountingSectionShell>
        <OrderInputView />
      </AccountingSectionShell>
    );
  }

  // Section 7: System Admin & Quản lý file Kế toán theo Ngày & Store
  if (effectiveSection === "admin" || effectiveSection === "files") {
    return (
      <AccountingSectionShell>
        <AccountingFileManager />
      </AccountingSectionShell>
    );
  }

  // Section 5: Financials - Lọc SKU Win & FBA (như file ketoan_limima.xlsx)
  if (effectiveSection === "financials") {
    return (
      <AccountingSectionShell>
        <FinancialsWorkspace />
      </AccountingSectionShell>
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
      <div className="w-full max-w-5xl mx-auto py-3 sm:py-6 space-y-4 sm:space-y-6">
        <AccountingImportTracker />
        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-7 shadow-2xs space-y-4 sm:space-y-6">
          <div className="space-y-3 sm:space-y-4">
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
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 sm:p-6 space-y-2">
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
    <div className="w-full max-w-4xl mx-auto py-4 sm:py-8">
      <AccountingImportTracker />
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-8 shadow-2xs text-center space-y-4">
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
