"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeftIcon, BarcodeIcon, FactoryIcon, PackageIcon, StackIcon } from "@phosphor-icons/react";
import type { RequestActor } from "@/lib/auth";
import { FulfillView } from "./fulfill-view";
import { SkuMasterView } from "./sku-master-view";
import { SupAccountsView } from "./sup-accounts-view";

interface FulfillPortalProps {
  actor: RequestActor;
}

export type FulfillPortalTab = "pos" | "sku_master" | "suppliers";

type StoreOption = { id: string; name: string };

const TABS: Array<{ id: FulfillPortalTab; label: string; icon: typeof StackIcon }> = [
  { id: "pos", label: "Shipment Lots", icon: StackIcon },
  { id: "sku_master", label: "SKU Master", icon: BarcodeIcon },
  { id: "suppliers", label: "Suppliers", icon: FactoryIcon },
];

export function FulfillPortal({ actor }: FulfillPortalProps) {
  const [activeTab, setActiveTab] = useState<FulfillPortalTab>("pos");
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [storeId, setStoreId] = useState("");
  const [sup, setSup] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (activeTab !== "sku_master") return;

    const controller = new AbortController();
    async function loadStores() {
      try {
        const response = await fetch("/api/accounting/stores", { signal: controller.signal });
        if (response.ok) {
          const data = await response.json();
          if (!controller.signal.aborted) setStores(data.stores ?? []);
        }
      } catch (error) {
        if (!controller.signal.aborted) console.error("Could not load stores for SKU Master:", error);
      }
    }
    void loadStores();
    return () => controller.abort();
  }, [activeTab]);

  return (
    <div className="min-h-dvh">
      <header className="border-b border-(--ff-line) bg-(--ff-side) print:hidden">
        <div className="mx-auto grid max-w-[1440px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-6 md:grid-cols-[1fr_auto_1fr] lg:px-8">
          <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-(--ff-accent) text-white">
              <PackageIcon size={20} weight="fill" aria-hidden />
            </span>
            <span className="whitespace-nowrap font-(family-name:--font-app-sans) text-lg font-bold tracking-tight">Fulfill</span>
          </div>

          <nav aria-label="Fulfill" className="col-span-2 col-start-1 row-start-2 grid grid-cols-3 gap-1 rounded-full border border-(--ff-line) bg-(--ff-raised) p-1 md:col-span-1 md:col-start-2 md:row-start-1 md:flex">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                aria-current={activeTab === id ? "page" : undefined}
                className={`flex min-h-9 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ff-accent) sm:px-4 sm:text-sm ${
                  activeTab === id
                    ? "bg-(--ff-accent) font-semibold text-white shadow-sm"
                    : "text-(--ff-text-2) hover:bg-(--ff-card) hover:text-(--ff-accent)"
                }`}
              >
                <Icon size={16} className="hidden shrink-0 min-[360px]:block" aria-hidden />
                {label}
              </button>
            ))}
          </nav>

          <div className="col-start-2 row-start-1 flex min-w-0 items-center justify-end gap-4 md:col-start-3">
            <span className="hidden truncate text-sm text-(--ff-muted) lg:block">{actor.displayName || actor.email || actor.userId}</span>
            <Link
              href="/?view=accounting"
              className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-2 text-sm font-medium text-(--ff-accent) hover:bg-(--ff-accent-soft) focus-visible:outline-2 focus-visible:outline-(--ff-accent)"
            >
              <ArrowLeftIcon size={14} aria-hidden />
              Accounting
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8 print:max-w-none print:p-0">
        {activeTab === "pos" && (
          <FulfillView
            storeId={storeId}
            sup={sup}
            search={search}
            onStoreChange={setStoreId}
            onSupChange={setSup}
            onSearchChange={setSearch}
          />
        )}
        {activeTab === "sku_master" && <SkuMasterView stores={stores} selectedStoreId={storeId} onSelectStore={setStoreId} />}
        {activeTab === "suppliers" && <SupAccountsView />}
      </main>
    </div>
  );
}
