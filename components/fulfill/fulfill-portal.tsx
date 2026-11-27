"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ArrowUpRightIcon, PackageIcon } from "@phosphor-icons/react";
import type { RequestActor } from "@/lib/auth";
import { FulfillView } from "./fulfill-view";
import { SkuMasterView } from "./sku-master-view";
import { SuppliersView } from "./suppliers-view";

interface FulfillPortalProps {
  actor: RequestActor;
}

export type FulfillPortalTab = "pos" | "sku_master" | "suppliers";

const TABS: Array<{ id: FulfillPortalTab; label: string }> = [
  { id: "pos", label: "Đợt hàng" },
  { id: "sku_master", label: "SKU master" },
  { id: "suppliers", label: "Nhà xưởng" },
];

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
    <>
      <header className="sticky top-0 z-40 border-b border-(--ff-line) bg-(--ff-card) print:hidden">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-8 px-6 lg:px-8">
          <Link href="/fulfill" className="flex items-center gap-2 text-(--ff-text)">
            <PackageIcon size={20} weight="regular" className="text-(--ff-accent)" />
            <span className="text-base font-semibold">Đi Hàng</span>
          </Link>

          <nav className="flex items-center gap-1">
            {TABS.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  aria-current={active ? "page" : undefined}
                  className={`h-8 cursor-pointer rounded-lg px-3 text-sm transition-colors duration-150 ${
                    active
                      ? "bg-(--ff-raised) font-medium text-(--ff-text)"
                      : "text-(--ff-text-2) hover:bg-(--ff-raised) hover:text-(--ff-text)"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-4">
            <span className="hidden text-sm text-(--ff-muted) sm:inline">{actor.displayName || actor.email || actor.userId}</span>
            <Link
              href="/?view=accounting"
              className="inline-flex items-center gap-1 text-sm text-(--ff-text-2) transition-colors duration-150 hover:text-(--ff-text)"
            >
              ← Về Kế toán
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-6 py-8 lg:px-8 print:max-w-none print:p-0">
        {activeTab === "pos" && <FulfillView />}
        {activeTab === "sku_master" && (
          <SkuMasterView stores={stores} selectedStoreId={selectedStoreId} onSelectStore={(id) => setSelectedStoreId(id)} />
        )}
        {activeTab === "suppliers" && <SuppliersView />}
      </main>
    </>
  );
}
