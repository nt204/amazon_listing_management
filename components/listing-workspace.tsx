"use client";

import {
  CheckSquareIcon,
  GearIcon,
  ImageSquareIcon,
  KanbanIcon,
  LightningIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { TrelloBoardView } from "@/components/trello-board-view";
import { SellerSpriteKeywordMiner } from "@/components/sellersprite-keyword-miner";
import { AccountMenu } from "@/components/account-menu";
import type { RequestActor } from "@/lib/auth";
import type { BrandProfile } from "@/lib/types";

interface ListingWorkspaceProps {
  initialBrands?: BrandProfile[];
  actor?: RequestActor;
}

export function ListingWorkspace({
  initialBrands = [],
  actor,
}: ListingWorkspaceProps) {
  const [brands, setBrands] = useState<BrandProfile[]>(initialBrands);
  const [sidebarTab, setSidebarTab] = useState<"trello" | "mockups">("trello");
  const [viewMode, setViewMode] = useState<"trello" | "sellersprite">("trello");
  const [showTrelloConfigModal, setShowTrelloConfigModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }, []);

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
    void refreshBrands();
  }, [refreshBrands]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 text-slate-800 font-sans">
      {/* LEFT SIDEBAR NAVIGATION */}
      <aside className="flex w-56 shrink-0 flex-col justify-between border-r border-slate-200/80 bg-white p-3.5 shadow-xs select-none">
        <div>
          {/* Logo & App Info */}
          <div className="mb-5 flex items-center gap-3 px-1 pt-1">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-sm shadow-indigo-500/30">
              <CheckSquareIcon size={20} weight="fill" />
            </div>
            <div>
              <h1 className="text-sm font-black tracking-tight text-slate-900 leading-tight">Listing Desk</h1>
              <p className="text-[10px] font-semibold text-slate-400">Workflow &amp; Trello Automation</p>
            </div>
          </div>

          {/* Navigation Menu List */}
          <nav className="space-y-1.5">
            <button
              type="button"
              onClick={() => {
                setSidebarTab("trello");
                setViewMode("trello");
              }}
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
              onClick={() => {
                setSidebarTab("mockups");
                setViewMode("trello");
              }}
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
              onClick={() => {
                setViewMode("sellersprite");
              }}
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
              onClick={() => notify("Liên hệ team kỹ thuật hoặc xem hướng dẫn tại Trello Board.")}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-white px-3 py-1.5 text-[11px] font-extrabold text-indigo-700 shadow-2xs hover:bg-indigo-50/80 hover:border-indigo-300 transition cursor-pointer"
            >
              <span>📖 Xem hướng dẫn</span>
            </button>
          </div>
        </div>
      </aside>

      {/* MAIN WORKSPACE AREA */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* TOP NAVBAR HEADER */}
        <header className="flex h-13 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/95 backdrop-blur-md px-5 shadow-2xs z-10">
          {/* Active View Title */}
          <div className="flex items-center gap-2.5">
            <span className="flex h-2.5 w-2.5 rounded-full bg-indigo-600 ring-4 ring-indigo-100" />
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-800">
              {viewMode === "sellersprite"
                ? "SellerSprite Keyword Mining"
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
                  setViewMode("trello");
                  notify("Đã đào xong từ khóa SellerSprite.");
                }}
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
    </div>
  );
}
