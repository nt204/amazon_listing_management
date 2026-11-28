"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeftIcon, BarcodeIcon, FactoryIcon, PackageIcon, StackIcon } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import type { RequestActor } from "@/lib/auth";
import { FulfillView } from "./fulfill-view";
import { SkuCatalogView } from "./sku-catalog-view";
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
  const [{ activeTab, animateTab }, setTab] = useState<{ activeTab: FulfillPortalTab; animateTab: boolean }>({ activeTab: "pos", animateTab: false });
  const reducedMotion = useReducedMotion();
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
    <div className="fulfill-portal min-h-dvh">
      <header className="shrink-0 border-b border-(--ff-line) bg-(--ff-side) print:hidden">
        <div className="mx-auto grid max-w-[1440px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-6 md:grid-cols-[1fr_auto_1fr] lg:px-8">
          <Link
            href="/?view=accounting"
            title="Back to Accounting"
            className="col-start-1 row-start-1 flex min-w-0 items-center gap-2.5 justify-self-start rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ff-accent)"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-(--ff-accent) text-white">
              <PackageIcon size={20} weight="fill" aria-hidden />
            </span>
            <span className="whitespace-nowrap font-(family-name:--font-app-sans) text-lg font-bold tracking-tight">Fulfill</span>
          </Link>

          <nav aria-label="Fulfill" className="col-span-2 col-start-1 row-start-2 grid grid-cols-3 gap-1 rounded-full border border-(--ff-line) bg-(--ff-raised) p-1 md:col-span-1 md:col-start-2 md:row-start-1 md:flex">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={(event) => {
                  if (id !== activeTab) setTab({ activeTab: id, animateTab: event.detail > 0 });
                }}
                aria-current={activeTab === id ? "page" : undefined}
                className={`relative flex min-h-9 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ff-accent) sm:px-4 sm:text-sm ${
                  activeTab === id
                    ? "font-semibold text-white"
                    : "text-(--ff-text-2) hover:text-(--ff-accent)"
                }`}
              >
                {activeTab === id && (
                  <motion.span
                    layoutId={reducedMotion ? undefined : "fulfill-portal-tab-pill"}
                    className="absolute inset-0 rounded-full bg-(--ff-accent) shadow-sm"
                    transition={{ duration: animateTab ? 0.18 : 0, ease: [0.645, 0.045, 0.355, 1] }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  <Icon size={16} className="hidden shrink-0 min-[360px]:block" aria-hidden />
                  {label}
                </span>
              </button>
            ))}
          </nav>

          <div className="col-start-2 row-start-1 flex min-w-0 items-center justify-end gap-4 md:col-start-3">
            <span className="hidden truncate text-sm text-(--ff-muted) lg:block">{actor.displayName || actor.email || actor.userId}</span>
            <Link
              href="/?view=accounting"
              className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium text-(--ff-accent) transition-[color,background-color,scale] duration-150 ease hover:bg-(--ff-accent-soft) motion-safe:active:scale-95 focus-visible:outline-2 focus-visible:outline-(--ff-accent)"
            >
              <ArrowLeftIcon size={14} aria-hidden />
              Accounting
            </Link>
          </div>
        </div>
      </header>

      {/* Trang chi tiết lô (bảng 42 cột) dùng hết chiều ngang màn hình; danh sách giữ khung 1440px */}
      <main className="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8 has-[[data-wide-page]]:max-w-none print:max-w-none print:p-0">
        <div key={activeTab} className={animateTab ? "animate-ff-content" : undefined}>
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
          {activeTab === "sku_master" && <SkuCatalogView stores={stores} selectedStoreId={storeId} onSelectStore={setStoreId} />}
          {activeTab === "suppliers" && <SupAccountsView />}
        </div>
      </main>
    </div>
  );
}
