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
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
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

type WorkspaceView = "listing" | "mockups" | "sellersprite" | "ppc";

export function ListingWorkspace({
  initialBrands = [],
  actor,
  initialView = "listing",
}: ListingWorkspaceProps) {
  const [brands, setBrands] = useState<BrandProfile[]>(initialBrands);
  const [activeView, setActiveView] = useState<WorkspaceView>(initialView);
  const [ppcSection, setPpcSection] = useState<"dashboard" | "phoi" | "rules">("dashboard");
  const sidebarTab = activeView === "mockups" ? "mockups" : "trello";
  const viewMode = activeView === "sellersprite" || activeView === "ppc" ? activeView : "trello";
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
    setActiveView(view);
    const url = new URL(window.location.href);
    if (view === "listing") {
      url.searchParams.delete("view");
    } else {
      url.searchParams.set("view", view);
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

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
    const timer = window.setTimeout(() => void refreshBrands(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshBrands]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 text-slate-800 font-sans">
      {/* LEFT SIDEBAR NAVIGATION */}
      <aside className="flex w-56 shrink-0 flex-col justify-between border-r border-slate-200/80 bg-white p-3.5 shadow-xs select-none">
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
            <button
              type="button"
              onClick={() => selectView("listing")}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-bold transition-all duration-150 cursor-pointer ${
                sidebarTab === "trello" && viewMode === "trello"
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

            <button
              type="button"
              onClick={() => selectView("mockups")}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-bold transition-all duration-150 cursor-pointer ${
                sidebarTab === "mockups" && viewMode === "trello"
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

            <button
              type="button"
              onClick={() => selectView("sellersprite")}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-bold transition-all duration-150 cursor-pointer ${
                viewMode === "sellersprite"
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

            {/* Amazon PPC Analytics Group */}
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => {
                  selectView("ppc");
                  setPpcSection("dashboard");
                }}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-xs font-bold transition-all duration-150 cursor-pointer ${
                  viewMode === "ppc"
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
                    className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded border transition-colors ${
                      viewMode === "ppc"
                        ? "bg-indigo-100/70 text-indigo-700 border-indigo-200"
                        : "bg-emerald-50 text-emerald-700 border-emerald-200"
                    }`}
                  >
                    MỚI
                  </span>
                  <CaretDownIcon
                    size={12}
                    weight="bold"
                    className={`transition-transform duration-200 ${
                      viewMode === "ppc" ? "rotate-0 text-indigo-600" : "-rotate-90 text-slate-400"
                    }`}
                  />
                </div>
              </button>

              {/* Sub-items under PPC Analytics */}
              {viewMode === "ppc" && (
                <div className="ml-3 pl-2.5 border-l-2 border-indigo-100 space-y-0.5 pt-0.5 animate-in fade-in slide-in-from-top-1 duration-150">
                  {/* Mục to: PPC Dashboard */}
                  <button
                    type="button"
                    onClick={() => {
                      selectView("ppc");
                      setPpcSection("dashboard");
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-all cursor-pointer ${
                      ppcSection === "dashboard"
                        ? "bg-indigo-100/70 text-indigo-900 font-black shadow-2xs"
                        : "text-slate-600 font-bold hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full transition-colors ${
                        ppcSection === "dashboard" ? "bg-indigo-600 ring-2 ring-indigo-200" : "bg-slate-300"
                      }`}
                    />
                    <span>PPC Dashboard</span>
                  </button>

                  {/* Mục con 1: Quản lý Phôi */}
                  <button
                    type="button"
                    onClick={() => {
                      selectView("ppc");
                      setPpcSection("phoi");
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-all cursor-pointer ${
                      ppcSection === "phoi"
                        ? "bg-indigo-100/70 text-indigo-900 font-black shadow-2xs"
                        : "text-slate-600 font-medium hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ml-0.5 transition-colors ${
                        ppcSection === "phoi" ? "bg-indigo-600 ring-2 ring-indigo-200" : "bg-slate-300"
                      }`}
                    />
                    <span>Quản lý Phôi</span>
                  </button>

                  {/* Mục con 2: Quản lý Rule */}
                  <button
                    type="button"
                    onClick={() => {
                      selectView("ppc");
                      setPpcSection("rules");
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-all cursor-pointer ${
                      ppcSection === "rules"
                        ? "bg-indigo-100/70 text-indigo-900 font-black shadow-2xs"
                        : "text-slate-600 font-medium hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ml-0.5 transition-colors ${
                        ppcSection === "rules" ? "bg-indigo-600 ring-2 ring-indigo-200" : "bg-slate-300"
                      }`}
                    />
                    <span>Quản lý Rule</span>
                  </button>
                </div>
              )}
            </div>
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
                ? "SellerSprite Keyword Mining"
                : viewMode === "ppc"
                ? ppcSection === "phoi"
                  ? "Amazon PPC - Quản Lý Phôi (Cost Master)"
                  : ppcSection === "rules"
                  ? "Amazon PPC - Quản Lý Rule PPC"
                  : "Amazon PPC Dashboard & Analytics"
                : sidebarTab === "mockups"
                ? "Auto Mockup Generator"
                : "Bảng Trello Kanban & Listing"}
            </h2>
          </div>

          {/* Right Header Items: Trello Config & User Avatar */}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setShowTrelloConfigModal(true)}
              className="flex items-center gap-2 rounded-xl border border-slate-200/90 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 shadow-2xs hover:bg-slate-50 hover:border-slate-300 transition duration-150 cursor-pointer"
              title="Cấu hình Board và các cột Trello"
            >
              <GearIcon size={16} className="text-slate-500" weight="bold" />
              <span>Cấu hình Trello</span>
            </button>

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
                <PpcDashboard isEmbedded={true} />
              )}
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
