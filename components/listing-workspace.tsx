"use client";

import {
  EyeIcon,
  FilePdfIcon,
  GearIcon,
  ImageSquareIcon,
  KanbanIcon,
  LightningIcon,
  WarningCircleIcon,
  XIcon,
  ChartLineUpIcon,
  CaretDownIcon,
  ReceiptIcon,
  SquaresFourIcon,
  StorefrontIcon,
  PackageIcon,
  ShoppingCartIcon,
  WalletIcon,
  TrendUpIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { AccountMenu } from "@/components/account-menu";
import type { RequestActor } from "@/lib/auth";
import type { BrandProfile } from "@/lib/types";

const ViewLoading = () => <div className="h-full w-full animate-pulse bg-slate-100" />;

const TrelloBoardView = dynamic(
  () => import("@/components/trello-board-view").then((module) => module.TrelloBoardView),
  { loading: ViewLoading },
);
const SellerSpriteKeywordMiner = dynamic(
  () => import("@/components/sellersprite-keyword-miner").then((module) => module.SellerSpriteKeywordMiner),
  { loading: ViewLoading },
);
const PpcDashboard = dynamic(
  () => import("@/components/ppc/ppc-dashboard").then((module) => module.PpcDashboard),
  { loading: ViewLoading },
);
const PpcCostMasterStandalone = dynamic(
  () => import("@/components/ppc/ppc-settings-tab").then((module) => module.PpcCostMasterStandalone),
  { loading: ViewLoading },
);
const PpcRuleManagerStandalone = dynamic(
  () => import("@/components/ppc/ppc-settings-tab").then((module) => module.PpcRuleManagerStandalone),
  { loading: ViewLoading },
);
const AccountingWorkspace = dynamic(
  () => import("@/components/accounting/accounting-workspace").then((module) => module.AccountingWorkspace),
  { loading: ViewLoading },
);

interface SystemGuideItem {
  id: string;
  title: string;
  description: string;
  filename: string;
  byteSize: number;
  createdAt: string;
}

interface ListingWorkspaceProps {
  initialBrands?: BrandProfile[];
  actor?: RequestActor;
  initialView?: WorkspaceView;
}

type WorkspaceView = "listing" | "mockups" | "sellersprite" | "ppc" | "accounting";

export function ListingWorkspace({
  initialBrands = [],
  actor,
  initialView = "listing",
}: ListingWorkspaceProps) {
  const allowedFeatureSet = useMemo(
    () => new Set<WorkspaceView>((actor?.allowedFeatures as WorkspaceView[] | undefined) ?? ["listing", "mockups", "sellersprite", "ppc", "accounting"]),
    [actor?.allowedFeatures],
  );
  const hasTrelloAccess = allowedFeatureSet.has("listing") || allowedFeatureSet.has("mockups");
  const [brands, setBrands] = useState<BrandProfile[]>(initialBrands);
  const [activeView, setActiveView] = useState<WorkspaceView>(initialView);
  type PpcSection = "dashboard" | "negative_keyword" | "sale_kw" | "auto_bid" | "phoi" | "rules";
  type PpcDashboardTab = "overview" | "campaigns" | "targets" | "search_terms" | "skus" | "st_campaigns";
  type AccountingSection =
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
  const [ppcSection, setPpcSection] = useState<PpcSection>("dashboard");
  const [ppcDashboardTab, setPpcDashboardTab] = useState<PpcDashboardTab>("overview");
  const [ppcNavNonce, setPpcNavNonce] = useState(0);
  const [accountingSection, setAccountingSection] = useState<AccountingSection>("overview");
  const [accountingSubTab, setAccountingSubTab] = useState<string | undefined>(undefined);
  const sidebarTab = activeView === "mockups" ? "mockups" : "trello";
  const viewMode =
    activeView === "sellersprite" || activeView === "ppc" || activeView === "accounting"
      ? activeView
      : "trello";
  const [showTrelloConfigModal, setShowTrelloConfigModal] = useState(false);
  const [showGuidesModal, setShowGuidesModal] = useState(false);
  const [guides, setGuides] = useState<SystemGuideItem[]>([]);
  const [loadingGuides, setLoadingGuides] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const selectView = useCallback((view: WorkspaceView) => {
    if (!allowedFeatureSet.has(view)) return;
    setActiveView(view);
    try {
      localStorage.setItem("nce_last_active_view", view);
    } catch { }
    const url = new URL(window.location.href);
    if (view === "listing") {
      url.searchParams.delete("view");
      url.searchParams.delete("section");
    } else {
      url.searchParams.set("view", view);
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [allowedFeatureSet]);

  const selectPpcDashboardTab = useCallback((tab: PpcDashboardTab) => {
    if (!allowedFeatureSet.has("ppc")) return;
    setActiveView("ppc");
    setPpcSection("dashboard");
    setPpcDashboardTab(tab);
    try {
      localStorage.setItem("nce_last_active_view", "ppc");
      localStorage.setItem("nce_last_ppc_section", "dashboard");
      localStorage.setItem("nce_ppc_last_tab", tab);
      const url = new URL(window.location.href);
      url.searchParams.set("view", "ppc");
      url.searchParams.delete("section");
      if (tab === "overview") {
        url.searchParams.delete("tab");
      } else {
        url.searchParams.set("tab", tab);
      }
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    } catch { }
  }, [allowedFeatureSet]);

  const selectPpcSection = useCallback((section: PpcSection) => {
    if (!allowedFeatureSet.has("ppc")) return;
    setActiveView("ppc");
    setPpcSection(section);
    if (section === "dashboard") {
      setPpcDashboardTab("overview");
      setPpcNavNonce((prev) => prev + 1);
    }
    try {
      localStorage.setItem("nce_last_active_view", "ppc");
      localStorage.setItem("nce_last_ppc_section", section);
      const url = new URL(window.location.href);
      url.searchParams.set("view", "ppc");
      if (section === "dashboard") {
        url.searchParams.delete("section");
        url.searchParams.delete("tab");
      } else {
        url.searchParams.set("section", section);
        url.searchParams.delete("tab");
      }
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    } catch { }
  }, [allowedFeatureSet]);

  const selectAccountingSection = useCallback(
    (section: AccountingSection = "overview", subTab?: string) => {
      if (!allowedFeatureSet.has("accounting")) return;
      setActiveView("accounting");
      setAccountingSection(section);
      setAccountingSubTab(subTab);
      try {
        localStorage.setItem("nce_last_active_view", "accounting");
        localStorage.setItem("nce_last_accounting_section", section);
        if (subTab) {
          localStorage.setItem("nce_last_accounting_subtab", subTab);
        } else {
          localStorage.removeItem("nce_last_accounting_subtab");
        }
        const url = new URL(window.location.href);
        url.searchParams.set("view", "accounting");
        if (section === "overview") {
          url.searchParams.delete("section");
          url.searchParams.delete("subtab");
        } else {
          url.searchParams.set("section", section);
          if (subTab) {
            url.searchParams.set("subtab", subTab);
          } else {
            url.searchParams.delete("subtab");
          }
        }
        url.searchParams.delete("tab");
        window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      } catch { }
    },
    [allowedFeatureSet],
  );

  // Restore position on initial mount if not specified in SSR initialView
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const urlView = url.searchParams.get("view") as WorkspaceView | null;
      const urlSection = url.searchParams.get("section") as PpcSection | null;
      const urlTab = url.searchParams.get("tab") as PpcDashboardTab | null;
      const savedView = localStorage.getItem("nce_last_active_view") as WorkspaceView | null;
      const savedSection = localStorage.getItem("nce_last_ppc_section") as PpcSection | null;
      const savedTab = localStorage.getItem("nce_ppc_last_tab") as PpcDashboardTab | null;

      const effectiveView = urlView || savedView;
      const validViews: WorkspaceView[] = ["listing", "mockups", "sellersprite", "ppc", "accounting"];
      const validPpcSections: PpcSection[] = ["dashboard", "negative_keyword", "sale_kw", "auto_bid", "phoi", "rules"];
      const validDashboardTabs: PpcDashboardTab[] = ["overview", "campaigns", "targets", "search_terms", "skus", "st_campaigns"];
      const validAccountingSections: AccountingSection[] = [
        "overview",
        "stores",
        "inventory",
        "orders",
        "financials",
        "reports",
        "admin",
        "dashboard",
        "revenue",
        "costs",
        "amazon_fees",
        "ads",
        "pnl",
        "settlements",
      ];
      if (effectiveView && validViews.includes(effectiveView) && allowedFeatureSet.has(effectiveView)) {
        setActiveView(effectiveView);
        if (effectiveView === "ppc") {
          const effectiveSection = urlSection || savedSection;
          if (effectiveSection && validPpcSections.includes(effectiveSection)) {
            setPpcSection(effectiveSection);
            if (effectiveSection === "dashboard") {
              const effectiveTab = urlTab || savedTab;
              if (effectiveTab && validDashboardTabs.includes(effectiveTab)) {
                setPpcDashboardTab(effectiveTab);
              }
            }
          }
        } else if (effectiveView === "accounting") {
          const savedAccSection = localStorage.getItem("nce_last_accounting_section") as AccountingSection | null;
          const savedAccSubTab = localStorage.getItem("nce_last_accounting_subtab") || undefined;
          const urlSubTab = url.searchParams.get("subtab") || undefined;
          const effectiveAccSection = (urlSection as AccountingSection) || savedAccSection;
          if (effectiveAccSection && validAccountingSections.includes(effectiveAccSection)) {
            if (effectiveAccSection === "dashboard") {
              setAccountingSection("overview");
            } else if (
              effectiveAccSection === "revenue" ||
              effectiveAccSection === "costs" ||
              effectiveAccSection === "amazon_fees" ||
              effectiveAccSection === "ads"
            ) {
              setAccountingSection("financials");
              setAccountingSubTab(effectiveAccSection);
            } else if (effectiveAccSection === "pnl" || effectiveAccSection === "settlements") {
              setAccountingSection("reports");
              setAccountingSubTab(effectiveAccSection);
            } else {
              setAccountingSection(effectiveAccSection);
              setAccountingSubTab(urlSubTab || savedAccSubTab);
            }
          }
        }
      }
    } catch { }
  }, [allowedFeatureSet]);

  const handleOpenGuides = async () => {
    setLoadingGuides(true);
    try {
      const res = await fetch("/api/guides", { cache: "no-store" });
      const data = await res.json() as { guides?: SystemGuideItem[]; error?: string };
      if (!res.ok || !data.guides) throw new Error(data.error || "Không thể tải tài liệu.");
      const list = data.guides;
      setGuides(list);
      if (list.length === 0) {
        notify("Chưa có tài liệu hướng dẫn nào. Vui lòng liên hệ Quản trị viên.");
      } else if (list.length === 1) {
        window.open(`/api/guides/${list[0].id}`, "_blank");
      } else {
        setShowGuidesModal(true);
      }
    } catch {
      notify("Không thể tải danh sách tài liệu hướng dẫn.");
    } finally {
      setLoadingGuides(false);
    }
  };

  const refreshBrands = useCallback(async () => {
    try {
      const res = await fetch("/api/brands");
      if (res.ok) {
        const data = (await res.json()) as { brands: BrandProfile[] };
        setBrands(data.brands || []);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void fetch("/api/auth/session");
    const timer = hasTrelloAccess
      ? window.setTimeout(() => void refreshBrands(), 0)
      : undefined;
    return () => window.clearTimeout(timer);
  }, [hasTrelloAccess, refreshBrands]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 text-slate-800 font-sans">
      {/* LEFT SIDEBAR NAVIGATION */}
      <aside className="flex w-64 shrink-0 flex-col justify-between border-r border-slate-200/80 bg-white p-3.5 shadow-xs select-none">
        <div>
          {/* Logo & App Info */}
          <div className="mb-5 flex items-center gap-2.5 px-1 pt-1">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-50 border border-slate-200/80 p-1 shadow-xs">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="NCE HUB Logo" className="h-full w-full object-contain" />
            </div>
            <div>
              <h1 className="text-sm font-black tracking-tight text-slate-900 leading-tight">NCE HUB</h1>
              <p className="text-[10px] font-semibold text-slate-400">Workflow &amp; Trello Automation</p>
            </div>
          </div>

          {/* Navigation Menu List */}
          <nav className="space-y-1.5">
            {/* Listing Tab */}
            {(actor?.allowedFeatures?.includes("listing") ?? true) && (
              <button
                type="button"
                onClick={() => selectView("listing")}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-bold transition-all duration-150 cursor-pointer ${sidebarTab === "trello" && viewMode === "trello"
                    ? "bg-indigo-50 text-indigo-700 font-extrabold shadow-2xs ring-1 ring-indigo-200/60"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  }`}
              >
                <KanbanIcon
                  size={17}
                  className={sidebarTab === "trello" && viewMode === "trello" ? "text-indigo-600" : "text-slate-400"}
                  weight="duotone"
                />
                <span>Listing</span>
              </button>
            )}

            {/* Mockups Tab */}
            {(actor?.allowedFeatures?.includes("mockups") ?? true) && (
              <button
                type="button"
                onClick={() => selectView("mockups")}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-bold transition-all duration-150 cursor-pointer ${sidebarTab === "mockups" && viewMode === "trello"
                    ? "bg-indigo-50 text-indigo-700 font-extrabold shadow-2xs ring-1 ring-indigo-200/60"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  }`}
              >
                <ImageSquareIcon
                  size={17}
                  className={sidebarTab === "mockups" && viewMode === "trello" ? "text-indigo-600" : "text-slate-400"}
                  weight="duotone"
                />
                <span>Mockup design</span>
              </button>
            )}

            {/* SellerSprite Tab */}
            {(actor?.allowedFeatures?.includes("sellersprite") ?? true) && (
              <button
                type="button"
                onClick={() => selectView("sellersprite")}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-bold transition-all duration-150 cursor-pointer ${viewMode === "sellersprite"
                    ? "bg-indigo-50 text-indigo-700 font-extrabold shadow-2xs ring-1 ring-indigo-200/60"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  }`}
              >
                <LightningIcon
                  size={17}
                  className={viewMode === "sellersprite" ? "text-indigo-600" : "text-slate-400"}
                  weight="duotone"
                />
                <span>Đào Keyword</span>
              </button>
            )}

            {/* Amazon PPC Analytics Group */}
            {(actor?.allowedFeatures?.includes("ppc") ?? true) && (
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => selectPpcSection("dashboard")}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-xs font-bold transition-all duration-150 cursor-pointer ${viewMode === "ppc"
                      ? "bg-indigo-50 text-indigo-700 font-extrabold shadow-2xs ring-1 ring-indigo-200/60"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                >
                  <div className="flex items-center gap-2.5">
                    <ChartLineUpIcon
                      size={17}
                      weight={viewMode === "ppc" ? "fill" : "duotone"}
                      className={viewMode === "ppc" ? "text-indigo-600" : "text-emerald-600"}
                    />
                    <span>PPC Analytics</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded border transition-colors ${viewMode === "ppc"
                          ? "bg-indigo-100/70 text-indigo-700 border-indigo-200"
                          : "bg-emerald-50 text-emerald-700 border-emerald-200"
                        }`}
                    >
                      MỚI
                    </span>
                    <CaretDownIcon
                      size={12}
                      weight="bold"
                      className={`transition-transform duration-200 ${viewMode === "ppc" ? "rotate-0 text-indigo-600" : "-rotate-90 text-slate-400"
                        }`}
                    />
                  </div>
                </button>

                {/* Sub-items under PPC Analytics */}
                {viewMode === "ppc" && (
                  <div className="ml-3 pl-2.5 border-l-2 border-indigo-100 space-y-0.5 pt-0.5 animate-in fade-in slide-in-from-top-1 duration-150">
                    {/* Mục 1: PPC Dashboard */}
                    <button
                      type="button"
                      onClick={() => {
                        selectPpcSection("dashboard");
                        setPpcDashboardTab("overview");
                      }}
                      className={`flex w-full items-center justify-between gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-all cursor-pointer ${ppcSection === "dashboard" && ppcDashboardTab === "overview"
                          ? "bg-indigo-100/80 text-indigo-900 font-bold shadow-2xs"
                          : ppcSection === "dashboard"
                            ? "text-indigo-900 font-semibold hover:bg-slate-100"
                            : "text-slate-600 font-semibold hover:bg-slate-100 hover:text-slate-900"
                        }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`h-2 w-2 rounded-full shrink-0 transition-colors ${ppcSection === "dashboard" ? "bg-indigo-600 ring-2 ring-indigo-200" : "bg-slate-300"
                            }`}
                        />
                        <span className="truncate">PPC Dashboard</span>
                      </div>
                      <CaretDownIcon
                        size={11}
                        weight="bold"
                        className="rotate-0 text-indigo-500 shrink-0"
                      />
                    </button>

                    {/* Sub-items under PPC Dashboard - giữ cố định mở luôn */}
                    <div className="ml-2 pl-2 border-l border-indigo-200/80 space-y-0.5 py-0.5">
                      {/* Mục: Campaign */}
                      <button
                        type="button"
                        onClick={() => selectPpcDashboardTab("campaigns")}
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-all cursor-pointer ${ppcSection === "dashboard" && ppcDashboardTab === "campaigns"
                            ? "bg-indigo-100/80 text-indigo-900 font-bold shadow-2xs"
                            : "text-slate-600 font-semibold hover:bg-slate-100 hover:text-slate-900"
                          }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full shrink-0 transition-colors ${ppcSection === "dashboard" && ppcDashboardTab === "campaigns" ? "bg-indigo-600 ring-2 ring-indigo-200" : "bg-slate-300"
                            }`}
                        />
                        <span className="truncate">Campaign</span>
                      </button>

                      {/* Mục: Target */}
                      <button
                        type="button"
                        onClick={() => selectPpcDashboardTab("targets")}
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-all cursor-pointer ${ppcSection === "dashboard" && ppcDashboardTab === "targets"
                            ? "bg-indigo-100/80 text-indigo-900 font-bold shadow-2xs"
                            : "text-slate-600 font-semibold hover:bg-slate-100 hover:text-slate-900"
                          }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full shrink-0 transition-colors ${ppcSection === "dashboard" && ppcDashboardTab === "targets" ? "bg-indigo-600 ring-2 ring-indigo-200" : "bg-slate-300"
                            }`}
                        />
                        <span className="truncate">Target</span>
                      </button>

                      {/* Mục: Search Term */}
                      <button
                        type="button"
                        onClick={() => selectPpcDashboardTab("search_terms")}
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-all cursor-pointer ${ppcSection === "dashboard" && ppcDashboardTab === "search_terms"
                            ? "bg-indigo-100/80 text-indigo-900 font-bold shadow-2xs"
                            : "text-slate-600 font-semibold hover:bg-slate-100 hover:text-slate-900"
                          }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full shrink-0 transition-colors ${ppcSection === "dashboard" && ppcDashboardTab === "search_terms" ? "bg-indigo-600 ring-2 ring-indigo-200" : "bg-slate-300"
                            }`}
                        />
                        <span className="truncate">Search Term</span>
                      </button>

                      {/* Mục: SKU */}
                      <button
                        type="button"
                        onClick={() => selectPpcDashboardTab("skus")}
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-all cursor-pointer ${ppcSection === "dashboard" && ppcDashboardTab === "skus"
                            ? "bg-indigo-100/80 text-indigo-900 font-bold shadow-2xs"
                            : "text-slate-600 font-semibold hover:bg-slate-100 hover:text-slate-900"
                          }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full shrink-0 transition-colors ${ppcSection === "dashboard" && ppcDashboardTab === "skus" ? "bg-indigo-600 ring-2 ring-indigo-200" : "bg-slate-300"
                            }`}
                        />
                        <span className="truncate">SKU</span>
                      </button>

                      {/* Mục: Đối Soát ST */}
                      <button
                        type="button"
                        onClick={() => selectPpcDashboardTab("st_campaigns")}
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-all cursor-pointer ${ppcSection === "dashboard" && ppcDashboardTab === "st_campaigns"
                            ? "bg-indigo-100/80 text-indigo-900 font-bold shadow-2xs"
                            : "text-slate-600 font-semibold hover:bg-slate-100 hover:text-slate-900"
                          }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full shrink-0 transition-colors ${ppcSection === "dashboard" && ppcDashboardTab === "st_campaigns" ? "bg-indigo-600 ring-2 ring-indigo-200" : "bg-slate-300"
                            }`}
                        />
                        <span className="truncate">Đối Soát ST</span>
                      </button>
                    </div>

                    {/* Mục 2: Negative Keyword */}
                    <button
                      type="button"
                      onClick={() => selectPpcSection("negative_keyword")}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-all cursor-pointer ${ppcSection === "negative_keyword"
                          ? "bg-rose-50 text-rose-800 font-bold shadow-2xs border border-rose-200/60"
                          : "text-slate-600 font-semibold hover:bg-slate-100 hover:text-slate-900"
                        }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ml-0.5 shrink-0 transition-colors ${ppcSection === "negative_keyword" ? "bg-rose-600 ring-2 ring-rose-200" : "bg-slate-300"
                          }`}
                      />
                      <span>Negative Keyword</span>
                    </button>

                    {/* Mục 3: Lên Camp Sale KW */}
                    <button
                      type="button"
                      onClick={() => selectPpcSection("sale_kw")}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-all cursor-pointer ${ppcSection === "sale_kw"
                          ? "bg-emerald-50 text-emerald-800 font-bold shadow-2xs border border-emerald-200/60"
                          : "text-slate-600 font-semibold hover:bg-slate-100 hover:text-slate-900"
                        }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ml-0.5 shrink-0 transition-colors ${ppcSection === "sale_kw" ? "bg-emerald-600 ring-2 ring-emerald-200" : "bg-slate-300"
                          }`}
                      />
                      <span>Lên Camp Sale KW</span>
                    </button>

                    {/* Mục 4: Auto Bid */}
                    <button
                      type="button"
                      onClick={() => selectPpcSection("auto_bid")}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-all cursor-pointer ${ppcSection === "auto_bid"
                          ? "bg-indigo-100/80 text-indigo-900 font-bold shadow-2xs"
                          : "text-slate-600 font-semibold hover:bg-slate-100 hover:text-slate-900"
                        }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ml-0.5 shrink-0 transition-colors ${ppcSection === "auto_bid" ? "bg-indigo-600 ring-2 ring-indigo-200" : "bg-slate-300"
                          }`}
                      />
                      <span>Auto Bid</span>
                    </button>

                    {/* Phân cách danh mục cấu hình */}
                    <div className="h-px bg-slate-200/70 my-1 mx-1" />

                    {/* Mục con 1: Quản lý Phôi */}
                    <button
                      type="button"
                      onClick={() => selectPpcSection("phoi")}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-all cursor-pointer ${ppcSection === "phoi"
                          ? "bg-indigo-100/80 text-indigo-900 font-bold shadow-2xs"
                          : "text-slate-600 font-semibold hover:bg-slate-100 hover:text-slate-900"
                        }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ml-0.5 shrink-0 transition-colors ${ppcSection === "phoi" ? "bg-indigo-600 ring-2 ring-indigo-200" : "bg-slate-300"
                          }`}
                      />
                      <span>Quản lý Phôi</span>
                    </button>

                    {/* Mục con 2: Quản lý Rule */}
                    <button
                      type="button"
                      onClick={() => selectPpcSection("rules")}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-all cursor-pointer ${ppcSection === "rules"
                          ? "bg-indigo-100/80 text-indigo-900 font-bold shadow-2xs"
                          : "text-slate-600 font-semibold hover:bg-slate-100 hover:text-slate-900"
                        }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ml-0.5 shrink-0 transition-colors ${ppcSection === "rules" ? "bg-indigo-600 ring-2 ring-indigo-200" : "bg-slate-300"
                          }`}
                      />
                      <span>Quản lý Rule</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Accounting Group (cùng cấp với PPC Analytics) */}
            {(actor?.allowedFeatures?.includes("accounting") ?? true) && (
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => selectAccountingSection("overview")}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-xs font-bold transition-all duration-150 cursor-pointer ${viewMode === "accounting"
                      ? "bg-indigo-50 text-indigo-700 font-extrabold shadow-2xs ring-1 ring-indigo-200/60"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                >
                  <div className="flex items-center gap-2.5">
                    <ReceiptIcon
                      size={17}
                      weight={viewMode === "accounting" ? "fill" : "duotone"}
                      className={viewMode === "accounting" ? "text-indigo-600" : "text-slate-500"}
                    />
                    <span>Accounting</span>
                  </div>
                  <CaretDownIcon
                    size={12}
                    weight="bold"
                    className={`transition-transform duration-200 ${viewMode === "accounting" ? "rotate-0 text-indigo-600" : "-rotate-90 text-slate-400"
                      }`}
                  />
                </button>

                {/* Sub-items under Accounting: 6 main groups + System Admin */}
                {viewMode === "accounting" && (
                  <div className="space-y-0.5 pt-1 animate-in fade-in slide-in-from-top-1 duration-150">
                    {/* 1. Overview */}
                    <button
                      type="button"
                      onClick={() => selectAccountingSection("overview")}
                      className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-all cursor-pointer ${accountingSection === "overview" || accountingSection === "dashboard"
                          ? "bg-indigo-50/80 text-indigo-950 shadow-2xs ring-1 ring-indigo-200/60"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                        }`}
                    >
                      <SquaresFourIcon
                        size={17}
                        weight={accountingSection === "overview" || accountingSection === "dashboard" ? "fill" : "duotone"}
                        className={`shrink-0 mt-0.5 ${accountingSection === "overview" || accountingSection === "dashboard"
                            ? "text-indigo-600"
                            : "text-slate-400"
                          }`}
                      />
                      <div className="flex min-w-0 flex-1 flex-col leading-tight">
                        <span className="text-xs font-bold text-slate-800">Overview</span>
                        <span className="text-[10.5px] font-normal text-slate-400 leading-snug">Dashboard tổng quan</span>
                      </div>
                    </button>

                    {/* 2. Stores */}
                    <button
                      type="button"
                      onClick={() => selectAccountingSection("stores")}
                      className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-all cursor-pointer ${accountingSection === "stores"
                          ? "bg-indigo-50/80 text-indigo-950 shadow-2xs ring-1 ring-indigo-200/60"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                        }`}
                    >
                      <StorefrontIcon
                        size={17}
                        weight={accountingSection === "stores" ? "fill" : "duotone"}
                        className={`shrink-0 mt-0.5 ${accountingSection === "stores" ? "text-indigo-600" : "text-slate-400"
                          }`}
                      />
                      <div className="flex min-w-0 flex-1 flex-col leading-tight">
                        <span className="text-xs font-bold text-slate-800">Stores</span>
                        <span className="text-[10.5px] font-normal text-slate-400 leading-snug">Quản lý Store</span>
                      </div>
                    </button>

                    {/* 3. Inventory */}
                    <button
                      type="button"
                      onClick={() => selectAccountingSection("inventory")}
                      className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-all cursor-pointer ${accountingSection === "inventory"
                          ? "bg-indigo-50/80 text-indigo-950 shadow-2xs ring-1 ring-indigo-200/60"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                        }`}
                    >
                      <PackageIcon
                        size={17}
                        weight={accountingSection === "inventory" ? "fill" : "duotone"}
                        className={`shrink-0 mt-0.5 ${accountingSection === "inventory" ? "text-indigo-600" : "text-slate-400"
                          }`}
                      />
                      <div className="flex min-w-0 flex-1 flex-col leading-tight">
                        <span className="text-xs font-bold text-slate-800">Inventory</span>
                        <span className="text-[10.5px] font-normal text-slate-400 leading-snug break-words">SKU, phôi, lô hàng, shipment</span>
                      </div>
                    </button>

                    {/* 4. Orders */}
                    <button
                      type="button"
                      onClick={() => selectAccountingSection("orders")}
                      className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-all cursor-pointer ${accountingSection === "orders"
                          ? "bg-indigo-50/80 text-indigo-950 shadow-2xs ring-1 ring-indigo-200/60"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                        }`}
                    >
                      <ShoppingCartIcon
                        size={17}
                        weight={accountingSection === "orders" ? "fill" : "duotone"}
                        className={`shrink-0 mt-0.5 ${accountingSection === "orders" ? "text-indigo-600" : "text-slate-400"
                          }`}
                      />
                      <div className="flex min-w-0 flex-1 flex-col leading-tight">
                        <span className="text-xs font-bold text-slate-800">Orders</span>
                        <span className="text-[10.5px] font-normal text-slate-400 leading-snug break-words">Đơn hàng, hoàn tiền, hủy đơn</span>
                      </div>
                    </button>

                    {/* 5. Financials */}
                    <button
                      type="button"
                      onClick={() => selectAccountingSection("financials")}
                      className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-all cursor-pointer ${accountingSection === "financials" ||
                          accountingSection === "revenue" ||
                          accountingSection === "costs" ||
                          accountingSection === "amazon_fees" ||
                          accountingSection === "ads"
                          ? "bg-indigo-50/80 text-indigo-950 shadow-2xs ring-1 ring-indigo-200/60"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                        }`}
                    >
                      <WalletIcon
                        size={17}
                        weight={
                          accountingSection === "financials" ||
                            accountingSection === "revenue" ||
                            accountingSection === "costs" ||
                            accountingSection === "amazon_fees" ||
                            accountingSection === "ads"
                            ? "fill"
                            : "duotone"
                        }
                        className={`shrink-0 mt-0.5 ${accountingSection === "financials" ||
                            accountingSection === "revenue" ||
                            accountingSection === "costs" ||
                            accountingSection === "amazon_fees" ||
                            accountingSection === "ads"
                            ? "text-indigo-600"
                            : "text-slate-400"
                          }`}
                      />
                      <div className="flex min-w-0 flex-1 flex-col leading-tight">
                        <span className="text-xs font-bold text-slate-800">Financials</span>
                        <span className="text-[10.5px] font-normal text-slate-400 leading-snug break-words">Doanh thu, chi phí, Amazon Fees, Ads</span>
                      </div>
                    </button>

                    {/* 6. Reports */}
                    <button
                      type="button"
                      onClick={() => selectAccountingSection("reports")}
                      className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-all cursor-pointer ${accountingSection === "reports" ||
                          accountingSection === "pnl" ||
                          accountingSection === "settlements"
                          ? "bg-indigo-50/80 text-indigo-950 shadow-2xs ring-1 ring-indigo-200/60"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                        }`}
                    >
                      <TrendUpIcon
                        size={17}
                        weight={
                          accountingSection === "reports" ||
                            accountingSection === "pnl" ||
                            accountingSection === "settlements"
                            ? "fill"
                            : "duotone"
                        }
                        className={`shrink-0 mt-0.5 ${accountingSection === "reports" ||
                            accountingSection === "pnl" ||
                            accountingSection === "settlements"
                            ? "text-indigo-600"
                            : "text-slate-400"
                          }`}
                      />
                      <div className="flex min-w-0 flex-1 flex-col leading-tight">
                        <span className="text-xs font-bold text-slate-800">Reports</span>
                        <span className="text-[10.5px] font-normal text-slate-400 leading-snug break-words">P&L, Settlement, đối soát</span>
                      </div>
                    </button>

                    {/* Subtle Divider before System Admin */}
                    <div className="my-1.5 border-t border-slate-100" />

                    {/* 7. System Admin */}
                    <button
                      type="button"
                      onClick={() => selectAccountingSection("admin")}
                      className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-all cursor-pointer ${accountingSection === "admin"
                          ? "bg-indigo-50/80 text-indigo-950 shadow-2xs ring-1 ring-indigo-200/60"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                        }`}
                    >
                      <GearIcon
                        size={17}
                        weight={accountingSection === "admin" ? "fill" : "duotone"}
                        className={`shrink-0 ${accountingSection === "admin" ? "text-indigo-600" : "text-slate-400"
                          }`}
                      />
                      <span className="text-xs font-bold text-slate-800">System Admin</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </nav>
        </div>

        {/* SIDEBAR BOTTOM WIDGETS */}
        <div className="space-y-3 pt-3 border-t border-slate-100">
          {/* Need Help Box */}
          <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/80 via-white to-sky-50/60 p-3 shadow-2xs">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white text-[10px] font-bold shadow-xs">
                ?
              </div>
              <h4 className="text-xs font-extrabold text-slate-900">Cần hỗ trợ?</h4>
            </div>
            <p className="text-[11px] font-medium leading-relaxed text-slate-500 mb-2.5">
              Xem hướng dẫn hoặc liên hệ team hỗ trợ.
            </p>
            <button
              type="button"
              disabled={loadingGuides}
              onClick={() => void handleOpenGuides()}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-white px-3 py-1.5 text-[11px] font-extrabold text-indigo-700 shadow-2xs hover:bg-indigo-50/80 hover:border-indigo-300 transition cursor-pointer disabled:opacity-60"
            >
              <span>{loadingGuides ? "Đang mở..." : "📖 Xem hướng dẫn"}</span>
            </button>
          </div>
        </div>
      </aside>

      {/* MAIN WORKSPACE AREA */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* TOP NAVBAR HEADER */}
        <header className="flex h-13 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/95 backdrop-blur-md px-5 shadow-2xs relative z-50">
          {/* Active View Title */}
          <div className="flex items-center gap-2.5">
            <span className="flex h-2.5 w-2.5 rounded-full bg-indigo-600 ring-4 ring-indigo-100" />
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-800">
              {viewMode === "sellersprite"
                ? "Đào Keyword"
                : viewMode === "ppc"
                  ? ppcSection === "phoi"
                    ? "Amazon PPC - Quản Lý Phôi (Cost Master)"
                    : ppcSection === "rules"
                      ? "Amazon PPC - Quản Lý Rule PPC"
                      : ppcSection === "negative_keyword"
                        ? "Amazon PPC - Negative Keyword (ST Optimization)"
                        : ppcSection === "sale_kw"
                          ? "Amazon PPC - Lên Campaign Sale KW"
                          : ppcSection === "auto_bid"
                            ? "Amazon PPC - Đề Xuất & Auto Bid"
                            : ppcDashboardTab === "campaigns"
                              ? "Amazon PPC - Quản Lý Campaign"
                              : ppcDashboardTab === "targets"
                                ? "Amazon PPC - Quản Lý Target & Keyword"
                                : ppcDashboardTab === "search_terms"
                                  ? "Amazon PPC - Báo Cáo Search Terms"
                                  : ppcDashboardTab === "skus"
                                    ? "Amazon PPC - Hiệu Suất Theo SKU"
                                    : ppcDashboardTab === "st_campaigns"
                                      ? "Amazon PPC - Đối Soát Search Term"
                                      : "Amazon PPC Dashboard & Analytics"
                  : viewMode === "accounting"
                    ? accountingSection === "stores"
                      ? "Accounting - Quản Lý Store"
                      : accountingSection === "overview" || accountingSection === "dashboard"
                        ? "Accounting - Overview & Dashboard"
                        : accountingSection === "inventory"
                          ? "Accounting - Quản Lý Inventory"
                          : accountingSection === "orders"
                            ? "Accounting - Quản Lý Orders"
                            : accountingSection === "financials" ||
                              accountingSection === "revenue" ||
                              accountingSection === "costs" ||
                              accountingSection === "amazon_fees" ||
                              accountingSection === "ads"
                              ? "Accounting - Financials (Tài Chính)"
                              : accountingSection === "reports" ||
                                accountingSection === "pnl" ||
                                accountingSection === "settlements"
                                ? "Accounting - Báo Cáo & Đối Soát"
                                : "Accounting - System Admin"
                    : sidebarTab === "mockups"
                      ? "Auto Mockup Generator"
                      : "Bảng Trello Kanban & Listing"}
            </h2>
          </div>

          {/* Right Header Items: Trello Config & User Avatar */}
          <div className="flex items-center gap-2.5">
            {hasTrelloAccess && viewMode !== "ppc" && viewMode !== "accounting" ? (
              <button
                type="button"
                onClick={() => setShowTrelloConfigModal(true)}
                className="flex items-center gap-2 rounded-xl border border-slate-200/90 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 shadow-2xs hover:bg-slate-50 hover:border-slate-300 transition duration-150 cursor-pointer"
                title="Cấu hình Board và các cột Trello"
              >
                <GearIcon size={16} className="text-slate-500" weight="bold" />
                <span>Cấu hình Trello</span>
              </button>
            ) : null}

            {actor ? (
              <AccountMenu actor={actor} />
            ) : (
              <AccountMenu
                actor={{
                  teamId: "default",
                  userId: "guest",
                  displayName: "User",
                  role: "admin",
                  ruleProfile: "",
                }}
              />
            )}
          </div>
        </header>

        {/* ALERTS AND TOASTS */}
        {error ? (
          <div
            className="fixed left-1/2 top-16 z-50 flex w-[min(92vw,560px)] -translate-x-1/2 items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50/95 p-3.5 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-150"
            role="alert"
          >
            <WarningCircleIcon className="mt-0.5 shrink-0 text-rose-600" size={19} weight="fill" />
            <p className="flex-1 text-xs font-bold text-rose-900">{error}</p>
            <button
              type="button"
              aria-label="Dismiss error"
              onClick={() => setError(null)}
              className="text-rose-500 hover:text-rose-800 p-0.5 rounded-lg hover:bg-rose-100 transition cursor-pointer"
            >
              <XIcon size={16} />
            </button>
          </div>
        ) : null}

        {toast ? (
          <div
            className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-2xl bg-slate-900/95 backdrop-blur-md px-5 py-2.5 text-xs font-bold text-white shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-200"
            role="status"
          >
            {toast}
          </div>
        ) : null}

        {/* VIEW MODE CONTENT */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {viewMode === "sellersprite" ? (
            <div className="h-full w-full overflow-y-auto p-6 bg-slate-50 thin-scrollbar">
              <SellerSpriteKeywordMiner
                onImportKeywords={() => {
                  selectView("listing");
                  notify("Đã đào xong từ khóa SellerSprite.");
                }}
              />
            </div>
          ) : viewMode === "ppc" ? (
            <div className="h-full w-full overflow-y-auto p-6 bg-slate-50 thin-scrollbar">
              {ppcSection === "phoi" ? (
                <PpcCostMasterStandalone />
              ) : ppcSection === "rules" ? (
                <PpcRuleManagerStandalone />
              ) : (
                <PpcDashboard
                  isEmbedded={true}
                  actor={actor}
                  navNonce={ppcNavNonce}
                  standaloneTab={
                    ppcSection === "negative_keyword"
                      ? "st_optimization"
                      : ppcSection === "sale_kw"
                        ? "sale_kw"
                        : ppcSection === "auto_bid"
                          ? "recommendations"
                          : undefined
                  }
                  initialTab={
                    ppcSection === "negative_keyword"
                      ? "st_optimization"
                      : ppcSection === "sale_kw"
                        ? "sale_kw"
                        : ppcSection === "auto_bid"
                          ? "recommendations"
                          : ppcDashboardTab
                  }
                  activeTabProp={
                    ppcSection === "dashboard" ? ppcDashboardTab : undefined
                  }
                  onTabChange={(newTab) => {
                    if (ppcSection === "dashboard") {
                      if (["overview", "campaigns", "targets", "search_terms", "skus", "st_campaigns"].includes(newTab)) {
                        setPpcDashboardTab(newTab as PpcDashboardTab);
                      }
                    }
                  }}
                />
              )}
            </div>
          ) : viewMode === "accounting" ? (
            <div className="h-full w-full overflow-y-auto p-6 bg-slate-50 font-[family-name:var(--font-accounting)] thin-scrollbar">
              <AccountingWorkspace
                activeSection={accountingSection}
                activeSubTab={accountingSubTab}
                onSectionChange={(s, tab) => selectAccountingSection(s, tab)}
              />
            </div>
          ) : (
            <div className="h-full w-full overflow-hidden">
              <TrelloBoardView
                brands={brands}
                activeTab={sidebarTab === "mockups" ? "mockups" : "listing"}
                showConfigModal={showTrelloConfigModal}
                onCloseConfigModal={() => setShowTrelloConfigModal(false)}
                onListingCreated={(listing) => {
                  notify(`Listing cho SKU ${listing.input.internal_name} đã được tạo.`);
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* GUIDES MODAL */}
      {showGuidesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="max-h-[calc(100dvh-4rem)] w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-150 flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className="grid h-8 w-8 place-items-center rounded-xl bg-rose-50 text-rose-600 border border-rose-100">
                  <FilePdfIcon size={18} weight="fill" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">Tài liệu Hướng dẫn sử dụng</h3>
                  <p className="text-[11px] font-medium text-slate-500">{guides.length} tài liệu PDF</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuidesModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
              >
                <XIcon size={16} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto max-h-96 space-y-2.5 thin-scrollbar">
              {guides.map((guide) => (
                <div
                  key={guide.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 hover:border-indigo-300 hover:bg-indigo-50/20 transition shadow-2xs"
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-rose-50 text-rose-600 border border-rose-100 mt-0.5">
                      <FilePdfIcon size={20} weight="fill" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-xs font-extrabold text-slate-900 truncate">{guide.title}</h4>
                      {guide.description && (
                        <p className="mt-0.5 text-[11px] text-slate-600 line-clamp-2">{guide.description}</p>
                      )}
                      <p className="mt-0.5 text-[10px] text-slate-400 font-mono">
                        {guide.filename}
                      </p>
                    </div>
                  </div>
                  <a
                    href={`/api/guides/${guide.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-indigo-700 transition shrink-0 shadow-xs"
                  >
                    <EyeIcon size={14} weight="bold" />
                    Xem PDF
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
