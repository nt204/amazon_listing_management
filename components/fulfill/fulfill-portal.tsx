"use client";

import { useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeftIcon, BarcodeIcon, FactoryIcon, MagnifyingGlassIcon, PackageIcon, StackIcon, XIcon } from "@phosphor-icons/react";
import type { RequestActor } from "@/lib/auth";
import type { FulfillPo, FulfillSupplier } from "@/lib/fulfill/types";
import { FulfillView } from "./fulfill-view";
import { SkuMasterView } from "./sku-master-view";
import { SuppliersView } from "./suppliers-view";
import { Keycap, fmtInt, StoreDot, storeColorMap } from "./fulfill-ui";

interface FulfillPortalProps {
  actor: RequestActor;
}

export type FulfillPortalTab = "pos" | "sku_master" | "suppliers";

type StoreOption = { id: string; name: string };

const TABS: Array<{ id: FulfillPortalTab; label: string; icon: typeof StackIcon }> = [
  { id: "pos", label: "Đợt hàng", icon: StackIcon },
  { id: "sku_master", label: "SKU master", icon: BarcodeIcon },
  { id: "suppliers", label: "Nhà xưởng", icon: FactoryIcon },
];

function SideRow({
  active,
  onClick,
  leading,
  label,
  count,
}: {
  active?: boolean;
  onClick: () => void;
  leading: ReactNode;
  label: string;
  count?: number | string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex h-9 w-full min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-1.5 text-left text-xs transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ff-accent) sm:text-sm lg:justify-start lg:gap-3 lg:px-3 ${
        active
          ? "bg-(--ff-accent-soft) font-semibold text-(--ff-accent)"
          : "text-(--ff-text-2) hover:bg-(--ff-raised) hover:text-(--ff-text)"
      }`}
    >
      <span className={`hidden w-4 shrink-0 items-center justify-center min-[360px]:flex ${active ? "" : "text-(--ff-muted)"}`}>{leading}</span>
      <span className="min-w-0 truncate lg:flex-1">{label}</span>
      {count !== undefined && <span className={`hidden shrink-0 text-xs lg:inline ${active ? "text-(--ff-accent)" : "text-(--ff-muted)"}`}>{count}</span>}
    </button>
  );
}

function SideSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-(--ff-line) px-3 pt-6 pb-4">
      <div className="mb-2 px-3 text-xs font-medium text-(--ff-muted)">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export function FulfillPortal({ actor }: FulfillPortalProps) {
  const [activeTab, setActiveTab] = useState<FulfillPortalTab>("pos");
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [suppliers, setSuppliers] = useState<FulfillSupplier[]>([]);
  const [allPos, setAllPos] = useState<FulfillPo[]>([]);
  const [skuCount, setSkuCount] = useState<number | null>(null);

  // Bộ lọc dùng chung: sidebar (Store / Xưởng / tìm kiếm) điều khiển trang Đợt hàng và SKU master
  const [storeId, setStoreId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const refreshSidebar = useCallback(async () => {
    try {
      const [resStores, resSups, resPos, resSku] = await Promise.all([
        fetch("/api/accounting/stores"),
        fetch("/api/fulfill/suppliers"),
        fetch("/api/fulfill/pos"),
        fetch("/api/fulfill/sku-master"),
      ]);
      const [dStores, dSups, dPos, dSku] = await Promise.all([resStores.json(), resSups.json(), resPos.json(), resSku.json()]);
      if (resStores.ok && dStores.stores) setStores(dStores.stores);
      if (resSups.ok && dSups.suppliers) setSuppliers(dSups.suppliers);
      if (resPos.ok && dPos.pos) setAllPos(dPos.pos);
      if (resSku.ok && dSku.items) setSkuCount(dSku.items.length);
    } catch (err) {
      console.error("Lỗi tải sidebar Đi hàng:", err);
    }
  }, []);

  useEffect(() => {
    void refreshSidebar();
  }, [refreshSidebar]);

  // ⌘K / Ctrl+K: nhảy vào ô tìm kiếm
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const colors = useMemo(() => storeColorMap(stores), [stores]);
  const posByStore = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of allPos) if (p.store_id) m[p.store_id] = (m[p.store_id] || 0) + 1;
    return m;
  }, [allPos]);
  const posBySupplier = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of allPos) m[p.supplier_id] = (m[p.supplier_id] || 0) + 1;
    return m;
  }, [allPos]);

  // Store có đợt hàng lên trước, rồi theo tên
  const sortedStores = useMemo(
    () => [...stores].sort((a, b) => (posByStore[b.id] || 0) - (posByStore[a.id] || 0) || a.name.localeCompare(b.name)),
    [stores, posByStore],
  );

  const counts: Record<FulfillPortalTab, number | undefined> = {
    pos: allPos.length,
    sku_master: skuCount ?? undefined,
    suppliers: suppliers.length,
  };

  const activeStore = stores.find((s) => s.id === storeId);
  const activeSupplier = suppliers.find((s) => s.id === supplierId);
  const currentTab = TABS.find((t) => t.id === activeTab) || TABS[0];
  const CurrentIcon = currentTab.icon;

  const pickStore = (id: string) => {
    setStoreId((prev) => (prev === id ? "" : id));
    if (activeTab === "suppliers") setActiveTab("pos");
  };
  const pickSupplier = (id: string) => {
    setSupplierId((prev) => (prev === id ? "" : id));
    setActiveTab("pos");
  };

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="flex flex-col border-b border-(--ff-line) bg-(--ff-side) lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto lg:border-r lg:border-b-0 print:hidden">
        <div className="flex h-16 shrink-0 items-center gap-3 px-6">
          <span className="grid size-9 place-items-center rounded-lg bg-(--ff-accent) text-white">
            <PackageIcon size={20} weight="fill" />
          </span>
          <span className="text-lg font-semibold">Đi Hàng</span>
        </div>

        <div className="px-4 pb-4">
          <label className="relative block">
            <span className="sr-only">Tìm đợt hàng</span>
            <MagnifyingGlassIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-(--ff-muted)" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                if (activeTab === "suppliers") setActiveTab("pos");
              }}
              placeholder="Tìm PO, SKU"
              className="h-10 w-full rounded-lg border border-(--ff-line) bg-(--ff-raised) pr-16 pl-9 text-sm text-(--ff-text) placeholder:text-(--ff-muted) transition-colors duration-150 focus:border-(--ff-accent) focus:bg-(--ff-card) focus:ring-2 focus:ring-(--ff-accent)/15 focus:outline-none"
            />
            <span className="pointer-events-none absolute top-1/2 right-2 flex -translate-y-1/2 gap-1">
              <Keycap>⌘</Keycap>
              <Keycap>K</Keycap>
            </span>
          </label>
        </div>

        <nav aria-label="Đi Hàng" className="grid grid-cols-3 gap-1 px-3 pb-3 lg:block lg:space-y-0.5 lg:border-t lg:border-(--ff-line) lg:py-4">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <SideRow
                key={tab.id}
                active={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                leading={<Icon size={16} />}
                label={tab.label}
                count={counts[tab.id]}
              />
            );
          })}
        </nav>

        <div className="hidden lg:block">
          <SideSection title="Store">
            {sortedStores.map((s) => {
              const n = posByStore[s.id] || 0;
              return (
                <SideRow
                  key={s.id}
                  active={storeId === s.id}
                  onClick={() => pickStore(s.id)}
                  leading={<StoreDot color={colors[s.id]} className="h-2.5 w-2.5" />}
                  label={s.name}
                  count={n ? fmtInt(n) : "—"}
                />
              );
            })}
          </SideSection>

          <SideSection title="Xưởng">
            {suppliers.map((sp) => (
              <SideRow
                key={sp.id}
                active={supplierId === sp.id}
                onClick={() => pickSupplier(sp.id)}
                leading={<FactoryIcon size={16} />}
                label={sp.name}
                count={fmtInt(posBySupplier[sp.id] || 0)}
              />
            ))}
          </SideSection>
        </div>

        <div className="mt-auto hidden border-t border-(--ff-line) px-6 py-4 lg:block">
          <div className="truncate text-sm text-(--ff-text-2)">{actor.displayName || actor.email || actor.userId}</div>
          <Link
            href="/?view=accounting"
            className="mt-2 inline-flex items-center gap-2 text-sm text-(--ff-muted) transition-colors duration-150 hover:text-(--ff-accent) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ff-accent)"
          >
            <ArrowLeftIcon size={14} />
            Về Kế toán
          </Link>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-(--ff-line) bg-(--ff-card) px-4 py-2 sm:px-6 lg:min-h-16 lg:px-10 print:hidden">
          <CurrentIcon size={18} className="text-(--ff-muted)" />
          <span className="text-base font-medium">{currentTab.label}</span>
          {(activeStore || activeSupplier) && activeTab !== "suppliers" && (
            <div className="order-last flex basis-full flex-wrap items-center gap-2 sm:order-0 sm:basis-auto">
              {activeStore && (
                <button
                  type="button"
                  onClick={() => setStoreId("")}
                  className="inline-flex h-7 cursor-pointer items-center gap-2 rounded-md border border-(--ff-line) bg-(--ff-raised) px-2.5 text-xs text-(--ff-text-2) transition-colors duration-150 hover:border-(--ff-line-strong) hover:text-(--ff-text)"
                  title="Bỏ lọc store"
                >
                  <StoreDot color={colors[activeStore.id]} />
                  {activeStore.name}
                  <XIcon size={12} />
                </button>
              )}
              {activeSupplier && activeTab === "pos" && (
                <button
                  type="button"
                  onClick={() => setSupplierId("")}
                  className="inline-flex h-7 cursor-pointer items-center gap-2 rounded-md border border-(--ff-line) bg-(--ff-raised) px-2.5 text-xs text-(--ff-text-2) transition-colors duration-150 hover:border-(--ff-line-strong) hover:text-(--ff-text)"
                  title="Bỏ lọc xưởng"
                >
                  {activeSupplier.name}
                  <XIcon size={12} />
                </button>
              )}
            </div>
          )}
          <Link
            href="/?view=accounting"
            className="ml-auto inline-flex items-center gap-2 text-sm text-(--ff-muted) hover:text-(--ff-accent) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ff-accent) lg:hidden"
          >
            <ArrowLeftIcon size={14} />
            Kế toán
          </Link>
        </header>

        <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:px-10 print:max-w-none print:p-0">
          {activeTab === "pos" && (
            <FulfillView
              storeId={storeId}
              supplierId={supplierId}
              search={search}
              onStoreChange={setStoreId}
              onSupplierChange={setSupplierId}
              onDataChanged={refreshSidebar}
              storeColors={colors}
            />
          )}
          {activeTab === "sku_master" && <SkuMasterView stores={stores} selectedStoreId={storeId} onSelectStore={setStoreId} />}
          {activeTab === "suppliers" && <SuppliersView />}
        </main>
      </div>
    </div>
  );
}
