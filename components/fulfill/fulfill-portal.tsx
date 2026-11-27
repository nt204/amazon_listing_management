"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import type { RequestActor } from "@/lib/auth";
import { FulfillView } from "./fulfill-view";
import { SkuMasterView } from "./sku-master-view";
import { SuppliersView } from "./suppliers-view";

interface FulfillPortalProps {
  actor: RequestActor;
}

export type FulfillPortalTab = "pos" | "sku_master" | "suppliers";

export function FulfillPortal({ actor }: FulfillPortalProps) {
  const [activeTab, setActiveTab] = useState<FulfillPortalTab>("pos");
  const [stores, setStores] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedStoreId, setSelectedStoreId] = useState("");

  const fetchStores = useCallback(async () => {
    try {
      const res = await fetch("/api/accounting/stores");
      const data = await res.json();
      if (res.ok && data.stores) {
        setStores(data.stores);
      }
    } catch (err) {
      console.error("Lỗi tải danh sách store:", err);
    }
  }, []);

  useEffect(() => {
    void fetchStores();
  }, [fetchStores]);

  return (
    <div className="min-h-screen bg-[#f4f6fa] text-slate-900 font-sans">
      {/* Top Standalone Header - Clean, spacious, modern SaaS look */}
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex h-18 max-w-[1750px] items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <Link
              href="/fulfill"
              className="flex items-center gap-2.5 transition hover:opacity-90"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-md shadow-blue-500/25 font-black text-lg">
                F
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-black tracking-tight text-slate-900">
                  NCE FULFILL
                </span>
                <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-extrabold uppercase text-blue-700 border border-blue-200/60">
                  FBA
                </span>
              </div>
            </Link>
          </div>

          {/* Central Pill Navigation - Clean and high contrast */}
          <nav className="flex items-center rounded-full bg-slate-100 p-1.5 shadow-inner">
            <button
              type="button"
              onClick={() => setActiveTab("pos")}
              className={`rounded-full px-6 py-2 text-sm font-bold transition-all cursor-pointer ${
                activeTab === "pos"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Đợt Hàng
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("sku_master")}
              className={`rounded-full px-6 py-2 text-sm font-bold transition-all cursor-pointer ${
                activeTab === "sku_master"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              SKU Master
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("suppliers")}
              className={`rounded-full px-6 py-2 text-sm font-bold transition-all cursor-pointer ${
                activeTab === "suppliers"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Nhà Xưởng
            </button>
          </nav>

          {/* Right: User Identity & Hub Link */}
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex flex-col text-right">
              <span className="text-xs font-bold text-slate-900">
                {actor.displayName || actor.userId}
              </span>
              <span className="text-[11px] text-slate-500 font-medium">{actor.email}</span>
            </div>

            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-slate-900 transition cursor-pointer"
            >
              <ArrowLeftIcon size={14} weight="bold" />
              <span>Về NCE HUB</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="mx-auto max-w-[1750px] p-4 sm:p-6 lg:p-8">
        {activeTab === "pos" && <FulfillView />}
        {activeTab === "sku_master" && (
          <SkuMasterView
            stores={stores}
            selectedStoreId={selectedStoreId}
            onSelectStore={(id) => setSelectedStoreId(id)}
          />
        )}
        {activeTab === "suppliers" && <SuppliersView />}
      </main>
    </div>
  );
}
