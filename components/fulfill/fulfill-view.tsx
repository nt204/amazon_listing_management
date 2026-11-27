"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CalendarBlankIcon, CaretDownIcon, CaretLeftIcon, CaretRightIcon, ChartBarIcon, FileXlsIcon, MagnifyingGlassIcon, PlusIcon, CheckIcon } from "@phosphor-icons/react";
import type { FulfillLot, FulfillLotStage } from "@/lib/fulfill/types";
import { CreateLotModal } from "./create-lot-modal";
import { LotDetailView } from "./lot-detail-view";
import { MonthRangePicker } from "./month-range-picker";
import { LOT_STAGE, LOT_STAGE_ORDER, LotStageLabel, StoreDot, fmtInt, fmtMoney, storeColorMap, ui } from "./fulfill-ui";

interface StoreOption {
  id: string;
  name: string;
}

interface FulfillViewProps {
  /** Portal lưu bộ lọc khi chuyển tab. Khi dùng độc lập, view tự lưu. */
  storeId?: string;
  sup?: string;
  search?: string;
  onStoreChange?: (id: string) => void;
  onSupChange?: (sup: string) => void;
  onSearchChange?: (search: string) => void;
}

const EMPTY_LOTS: FulfillLot[] = [];
const LOTS_PER_PAGE = 10;
const LOT_CELL = "min-w-0 md:table-cell md:px-3 md:py-1.5 md:align-middle [overflow-wrap:anywhere]";
const monthKey = (d: string | null) => (d ?? "").slice(0, 7); // YYYY-MM
const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const monthLabel = (key: string) => monthFormatter.format(new Date(`${key}-01T00:00:00Z`));
const lotHref = (lot: FulfillLot, path = "") =>
  `/api/fulfill/lots${path}?${new URLSearchParams({ storeId: lot.store_id, lot: lot.lot_name })}`;

const dayFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmtDay = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? dayFormatter.format(new Date(`${d}T00:00:00Z`)) : d ?? "");

function useControlled<T>(value: T | undefined, onChange: ((v: T) => void) | undefined, initial: T): [T, (v: T) => void] {
  const [local, setLocal] = useState<T>(initial);
  return value !== undefined && onChange ? [value, onChange] : [local, setLocal];
}

function currentMonthKeys(end = new Date()) {
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return [key(end), key(new Date(end.getFullYear(), end.getMonth() - 1, 1))] as const;
}

export function FulfillView(props: FulfillViewProps = {}) {
  const listHeadingId = useId();
  const monthPickerId = useId();
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const monthFilterRef = useRef<HTMLButtonElement>(null);
  const [selectedLot, setSelectedLot] = useState<Pick<FulfillLot, "store_id" | "lot_name"> | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const [stores, setStores] = useState<StoreOption[]>([]);
  const [result, setResult] = useState<{ requestKey: string; lots: FulfillLot[]; error: boolean } | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);

  const [selectedStoreId, setSelectedStoreId] = useControlled(props.storeId, props.onStoreChange, "");
  const [selectedSup, setSelectedSup] = useControlled(props.sup, props.onSupChange, "");
  const [searchTerm, setSearchTerm] = useControlled(props.search, props.onSearchChange, "");
  const [selectedStage, setSelectedStage] = useState<FulfillLotStage | "">("");
  const [fromMonth, setFromMonth] = useState("");
  const [toMonth, setToMonth] = useState("");
  const [monthDraft, setMonthDraft] = useState<{ mode: "single" | "range"; from: string; to: string } | null>(null);
  const [page, setPage] = useState(1);
  const monthPickerOpen = monthDraft !== null;


  const colors = useMemo(() => storeColorMap(stores), [stores]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/accounting/stores", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!controller.signal.aborted && data?.stores) setStores(data.stores);
      })
      .catch((error) => {
        if (!controller.signal.aborted) console.error(error);
      });
    return () => controller.abort();
  }, []);

  const params = new URLSearchParams();
  if (selectedStoreId) params.set("storeId", selectedStoreId);
  if (selectedSup) params.set("sup", selectedSup);
  if (searchTerm.trim()) params.set("search", searchTerm.trim());
  const query = params.toString();
  const requestKey = `${refreshVersion}:${query}`;
  const currentResult = result?.requestKey === requestKey ? result : null;
  const loading = currentResult === null;
  const loadError = currentResult?.error;
  const lots = currentResult?.lots ?? EMPTY_LOTS;
  const [sups, setSups] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    async function fetchLots() {
      try {
        const response = await fetch(`/api/fulfill/lots?${query}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (controller.signal.aborted) return;
        setResult({ requestKey, lots: data.lots ?? [], error: false });
        setSups(data.sups ?? []);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error(error);
        setResult({ requestKey, lots: [], error: true });
      }
    }
    void fetchLots();
    return () => controller.abort();
  }, [query, requestKey]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (!searchRef.current || (!event.metaKey && !event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      searchRef.current.focus();
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const refresh = () => setRefreshVersion((version) => version + 1);
  const hasMonthRange = Boolean(fromMonth || toMonth);
  const hasFilters = Boolean(query || selectedStage || hasMonthRange);
  const closeMonthPicker = useCallback(() => setMonthDraft(null), []);
  const applyMonths = (from: string, to: string) => {
    setPage(1);
    setFromMonth(from);
    setToMonth(to);
    setMonthDraft(null);
    monthFilterRef.current?.focus();
  };
  const clearFilters = () => {
    setPage(1);
    setSearchTerm("");
    setSelectedStoreId("");
    setSelectedSup("");
    setSelectedStage("");
    setFromMonth("");
    setToMonth("");
    setMonthDraft(null);
  };

  const [thisMonth, prevMonth] = currentMonthKeys();
  const activeLots = lots.filter((l) => l.stage !== "cancelled");
  const amountIn = (key: string) => activeLots.filter((l) => monthKey(l.first_request) === key).reduce((a, l) => a + l.amount, 0);
  const amountThis = amountIn(thisMonth);
  const amountPrev = amountIn(prevMonth);
  const change = amountPrev > 0 ? ((amountThis - amountPrev) / amountPrev) * 100 : null;

  const monthRangeLabel = fromMonth && toMonth
    ? fromMonth === toMonth ? monthLabel(fromMonth) : `${monthLabel(fromMonth)} – ${monthLabel(toMonth)}`
    : fromMonth ? `From ${monthLabel(fromMonth)}` : toMonth ? `Through ${monthLabel(toMonth)}` : "All months";
  const monthLots = useMemo(() => {
    if (!hasMonthRange) return lots;
    return lots.filter((lot) => {
      const month = monthKey(lot.first_request);
      return month && (!fromMonth || month >= fromMonth) && (!toMonth || month <= toMonth);
    });
  }, [lots, fromMonth, toMonth, hasMonthRange]);
  const monthActive = monthLots.filter((l) => l.stage !== "cancelled");

  const stageCounts = useMemo(() => {
    const counts: Record<FulfillLotStage, number> = { waiting: 0, in_transit: 0, receiving: 0, closed: 0, cancelled: 0 };
    for (const lot of monthLots) counts[lot.stage] += 1;
    return counts;
  }, [monthLots]);

  const unpaid = monthActive.reduce((a, l) => a + Math.max(0, l.amount - l.paid_amount), 0);
  const unpaidLots = monthActive.filter((l) => l.amount - l.paid_amount > 0.005).length;

  const visibleLots = selectedStage ? monthLots.filter((l) => l.stage === selectedStage) : monthLots;
  const pageCount = Math.max(1, Math.ceil(visibleLots.length / LOTS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * LOTS_PER_PAGE;
  const pageLots = visibleLots.slice(pageStart, pageStart + LOTS_PER_PAGE);
  const visibleQuantity = visibleLots.reduce((total, l) => total + l.quantity, 0);
  const visibleActive = visibleLots.filter((lot) => lot.stage !== "cancelled");
  const visibleAmount = visibleActive.reduce((total, lot) => total + lot.amount, 0);
  const visiblePaid = visibleActive.reduce((total, lot) => total + lot.paid_amount, 0);
  const visibleShipmentCount = new Set(
    visibleLots.flatMap((lot) => lot.shipment_ids.map((id) => `${lot.store_id}:${id}`)),
  ).size;

  const goToPage = (nextPage: number) => {
    setPage(nextPage);
    const heading = listHeadingRef.current;
    if (heading && heading.getBoundingClientRect().top < 0) heading.scrollIntoView({ block: "start" });
  };

  const storeStats = (() => {
    const m = new Map<string, { id: string; name: string; lots: number; qty: number; amount: number; unpaid: number; byStage: Partial<Record<FulfillLotStage, number>> }>();
    for (const l of monthActive) {
      const r = m.get(l.store_id) || { id: l.store_id, name: l.store_name, lots: 0, qty: 0, amount: 0, unpaid: 0, byStage: {} };
      r.lots += 1;
      r.qty += l.quantity;
      r.amount += l.amount;
      r.unpaid += Math.max(0, l.amount - l.paid_amount);
      r.byStage[l.stage] = (r.byStage[l.stage] || 0) + 1;
      m.set(l.store_id, r);
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  })();

  if (selectedLot) {
    return (
      <LotDetailView
        storeId={selectedLot.store_id}
        lotName={selectedLot.lot_name}
        storeColor={colors[selectedLot.store_id]}
        onBack={() => {
          setSelectedLot(null);
          refresh();
        }}
      />
    );
  }

  const dash = loading || loadError;

  return (
    <div className="space-y-4">
      <div className={`${ui.heading} py-4! sm:py-5!`}>
        <h1 className={ui.title}>Shipment <span className="text-(--ff-accent)">lots</span></h1>

        <dl className="ml-auto grid w-full grid-cols-2 divide-x divide-(--ff-line-strong) overflow-hidden rounded-xl border border-(--ff-line-strong) bg-(--ff-card) md:w-auto md:grid-cols-[repeat(2,minmax(175px,auto))]">
          <div className="min-w-0 px-3 py-3 sm:px-4">
            <dt className="text-xs font-semibold text-(--ff-text-2)">Production cost</dt>
            <dd className="mt-1 text-lg leading-tight font-bold text-(--ff-text) [overflow-wrap:anywhere] sm:text-2xl">
              {dash ? "–" : fmtMoney(amountThis)}
            </dd>
            <dd className="mt-1 text-xs text-(--ff-muted)">
              {monthLabel(thisMonth)}
              {!dash && change !== null && ` · ${change >= 0 ? "+" : ""}${change.toFixed(0)}% vs. ${monthLabel(prevMonth)}`}
            </dd>
          </div>
          <div className="min-w-0 px-3 py-3 sm:px-4">
            <dt className="text-xs font-semibold text-(--ff-text-2)">Outstanding</dt>
            <dd className="mt-1 text-lg leading-tight font-bold text-(--ff-accent-hover) [overflow-wrap:anywhere] sm:text-2xl">
              {dash ? "–" : fmtMoney(unpaid)}
            </dd>
            <dd className="mt-1 text-xs text-(--ff-muted)">
              {monthRangeLabel}
              {!dash && ` · ${fmtInt(unpaidLots)} ${unpaidLots === 1 ? "lot" : "lots"}`}
            </dd>
          </div>
        </dl>
      </div>

      <section aria-labelledby={listHeadingId} className={`${ui.card} overflow-hidden`}>
        <div className="space-y-3 px-4 pt-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 ref={listHeadingRef} id={listHeadingId} className="scroll-mt-4 text-xl font-bold">Lot list</h2>
            <button type="button" onClick={() => setShowCreate(true)} className={`${ui.btnPrimary} ml-auto px-3! sm:px-5!`}>
              <PlusIcon size={16} aria-hidden />
              New Shipment Request
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Search and filter lots">
            <label className="relative w-full sm:w-84">
              <span className="sr-only">Search lots</span>
              <MagnifyingGlassIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-(--ff-muted)" aria-hidden />
              <input
                ref={searchRef}
                type="search"
                value={searchTerm}
                onChange={(event) => {
                  setPage(1);
                  setSearchTerm(event.target.value);
                }}
                placeholder="Lot name, SKU, shipment ID…"
                className={`${ui.input} pl-9`}
                aria-keyshortcuts="Control+K Meta+K"
              />
            </label>
            <div className="relative">
            <button
              ref={monthFilterRef}
              type="button"
              aria-expanded={monthPickerOpen}
              aria-controls={monthDraft ? monthPickerId : undefined}
              onClick={() => setMonthDraft((draft) => draft ? null : {
                mode: !hasMonthRange || fromMonth === toMonth ? "single" : "range",
                from: fromMonth,
                to: toMonth,
              })}
              className={`${ui.select} inline-flex items-center gap-2 whitespace-nowrap ${hasMonthRange ? "border-(--ff-accent) text-(--ff-accent)" : ""}`}
            >
              <CalendarBlankIcon size={16} aria-hidden />
              {monthRangeLabel}
              <CaretDownIcon size={13} aria-hidden />
            </button>
              {monthPickerOpen && (
                <MonthRangePicker
                  id={monthPickerId}
                  from={fromMonth}
                  to={toMonth}
                  onApply={applyMonths}
                  onClose={closeMonthPicker}
                />
              )}
            </div>
            <select aria-label="Filter by store" value={selectedStoreId} onChange={(event) => {
              setPage(1);
              setSelectedStoreId(event.target.value);
            }} className={ui.select}>
              <option value="">All stores</option>
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
            </select>
            <select aria-label="Filter by supplier" value={selectedSup} onChange={(event) => {
              setPage(1);
              setSelectedSup(event.target.value);
            }} className={ui.select}>
              <option value="">All suppliers</option>
              {sups.map((sup) => <option key={sup} value={sup}>{sup}</option>)}
            </select>
            {hasFilters && (
              <button type="button" className={ui.link} onClick={clearFilters}>Clear filters</button>
            )}
          </div>
        </div>
        <div role="group" aria-label="Filter by shipment stage" className="flex flex-wrap items-center gap-1 border-b border-(--ff-line) px-4 py-3 sm:px-6">
          {(["", ...LOT_STAGE_ORDER, "cancelled"] as Array<FulfillLotStage | "">).map((s) => {
            const active = selectedStage === s;
            const n = s ? stageCounts[s] : monthLots.length;
            if (s === "cancelled" && n === 0 && !active) return null;
            return (
              <button
                key={s || "all"}
                type="button"
                onClick={() => {
                  if (active) return;
                  setPage(1);
                  setSelectedStage(s);
                }}
                aria-pressed={active}
                className={`inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ff-accent) sm:gap-2 sm:px-3 ${
                  active ? "bg-(--ff-accent) font-semibold text-white" : "text-(--ff-text-2) hover:bg-(--ff-raised) hover:text-(--ff-accent)"
                }`}
              >
                {s && <span aria-hidden className={`size-2 shrink-0 rounded-full ${active ? "bg-white" : LOT_STAGE[s].dot}`} />}
                {s ? LOT_STAGE[s].label : "All"}
                {!dash && (
                  <span className={`rounded-full px-1.5 text-xs font-medium ${active ? "bg-white/15 text-white" : "bg-(--ff-raised) text-(--ff-muted)"}`}>{n}</span>
                )}
              </button>
            );
          })}
        </div>

        <table aria-labelledby={listHeadingId} role="table" className="block w-full border-collapse text-left text-sm md:table md:table-fixed">
          <thead role="rowgroup" className={`sr-only md:not-sr-only md:table-header-group ${ui.tableHead}`}>
            <tr role="row">
              <th role="columnheader" scope="col" className={`${ui.th} w-[27%] pl-6`}>Lot / request date</th>
              <th role="columnheader" scope="col" className={`${ui.th} w-[16%]`}>Store / supplier</th>
              <th role="columnheader" scope="col" className={`${ui.th} w-[12%] text-right`}>Quantity</th>
              <th role="columnheader" scope="col" className={`${ui.th} w-[16%] text-right`}>Payment</th>
              <th role="columnheader" scope="col" className={ui.th}>Shipment</th>
              <th role="columnheader" scope="col" className="w-12"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          {!dash && visibleLots.length > 0 && (
            <tbody role="rowgroup" className={`block border-b border-(--ff-line-strong) md:table-row-group ${ui.tableTotal}`}>
              <tr role="row" className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,0.85fr)_minmax(0,1fr)] items-start gap-x-3 gap-y-1 px-4 py-2.5 md:table-row">
                <th role="rowheader" scope="row" className={`${LOT_CELL} text-left font-bold md:pl-6`}>
                  Total
                  <div className="text-xs font-normal text-(--ff-text-2)">
                    {fmtInt(visibleLots.length)} {visibleLots.length === 1 ? "lot" : "lots"}
                  </div>
                </th>
                <td role="cell" className="hidden md:table-cell" />
                <td role="cell" className={`${LOT_CELL} text-right font-semibold`}>
                  {fmtInt(visibleQuantity)} {visibleQuantity === 1 ? "unit" : "units"}
                </td>
                <td role="cell" className={`${LOT_CELL} text-right font-semibold`}>
                  {fmtMoney(visibleAmount)}
                  <div className="text-xs font-normal text-(--ff-text-2)">{fmtMoney(visiblePaid)} paid</div>
                </td>
                <td role="cell" className={`${LOT_CELL} col-span-3 text-xs font-medium text-(--ff-text-2)`}>
                  {fmtInt(visibleShipmentCount)} {visibleShipmentCount === 1 ? "shipment" : "shipments"}
                </td>
                <td role="cell" className="hidden md:table-cell" />
              </tr>
            </tbody>
          )}
          <tbody role="rowgroup" className="block md:table-row-group">
            {loading || loadError || visibleLots.length === 0 ? (
              <tr role="row" className="block md:table-row">
                <td role="cell" colSpan={6} className="block px-4 py-12 text-center text-(--ff-muted) md:table-cell">
                  {loading ? "Loading shipment lots…" : loadError ? (
                    <>
                      Could not load shipment lots.{" "}
                      <button type="button" className={ui.link} onClick={refresh}>Retry</button>
                    </>
                  ) : hasFilters ? "No lots match your filters." : "No shipment lots yet."}
                </td>
              </tr>
            ) : (
              pageLots.map((lot) => {
                const paidInFull = lot.amount > 0 && lot.paid_amount >= lot.amount - 0.005;
                const receivedShort = lot.stage === "closed" && lot.units_located < lot.units_expected;
                const shipmentCount = lot.shipment_ids.length;
                const due = Math.max(0, lot.amount - lot.paid_amount);
                const showProgress = lot.units_expected > 0 && (lot.stage === "receiving" || lot.stage === "closed");
                const progress = lot.units_expected > 0 ? Math.min(100, (lot.units_located / lot.units_expected) * 100) : 0;
                return (
                  <tr
                    key={lot.key}
                    role="row"
                    onClick={() => setSelectedLot(lot)}
                    className="group relative grid cursor-pointer grid-cols-[minmax(0,1.1fr)_minmax(0,0.85fr)_minmax(0,1fr)] items-start gap-x-3 gap-y-2 border-t border-(--ff-line) px-4 py-3 transition-colors hover:bg-(--ff-accent-soft) focus-within:bg-(--ff-accent-soft) md:table-row"
                  >
                    <td role="cell" className={`${LOT_CELL} col-span-3 pr-9 md:pl-6`}>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedLot(lot);
                        }}
                        className="max-w-full cursor-pointer rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ff-accent)"
                      >
                        <span className={`font-semibold group-hover:underline ${lot.lot_name_generated ? "text-(--ff-text-2)" : "text-(--ff-accent-hover)"}`}>{lot.lot_name}</span>
                      </button>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-(--ff-muted)">
                        <span>
                          {lot.first_request ? fmtDay(lot.first_request) : "No request date"}
                          {lot.last_request && lot.last_request !== lot.first_request && ` – ${fmtDay(lot.last_request)}`}
                        </span>
                        {lot.lot_name_generated && <span className="rounded-sm bg-(--ff-raised) px-1 text-[11px]">Unnamed lot</span>}
                      </div>
                    </td>
                    <td role="cell" className={LOT_CELL}>
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <StoreDot color={colors[lot.store_id]} />
                        <span>{lot.store_name}</span>
                      </span>
                      {lot.sup && <div className="text-xs text-(--ff-muted)">{lot.sup}</div>}
                    </td>
                    <td role="cell" className={`${LOT_CELL} text-right`}>
                      <div className="font-semibold tabular-nums">{fmtInt(lot.quantity)}</div>
                      <div className="text-xs text-(--ff-muted)">{fmtInt(lot.sku_count)} SKU</div>
                    </td>
                    <td role="cell" className={`${LOT_CELL} text-right`}>
                      <div className="font-semibold tabular-nums">{fmtMoney(lot.amount)}</div>
                      {paidInFull ? (
                        <div className="inline-flex items-center gap-1 text-xs font-semibold text-(--ff-pos)">
                          <CheckIcon size={12} weight="bold" aria-hidden />
                          Paid
                        </div>
                      ) : lot.amount > 0 ? (
                        <div className="text-xs font-semibold text-amber-900 tabular-nums">
                          {lot.paid_amount > 0 ? `${fmtMoney(due)} due` : "Unpaid"}
                        </div>
                      ) : null}
                    </td>
                    <td role="cell" className={`${LOT_CELL} col-span-3 border-t border-(--ff-line) pt-2 md:border-0`}>
                      <LotStageLabel stage={lot.stage} />
                      {(shipmentCount > 0 || lot.units_expected > 0) && (
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-(--ff-muted)">
                          {shipmentCount > 0 && (
                            <span>{shipmentCount === 1 ? lot.shipment_ids[0] : `${shipmentCount} shipments`}</span>
                          )}
                          {lot.units_expected > 0 && !showProgress && <span className="tabular-nums">{fmtInt(lot.units_expected)} expected</span>}
                          {showProgress && (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="h-1.5 w-20 overflow-hidden rounded-full bg-(--ff-raised)" aria-hidden>
                                <span
                                  className={`block h-full rounded-full ${receivedShort ? "bg-(--ff-neg)" : lot.stage === "closed" ? "bg-(--ff-pos)" : "bg-(--ff-accent)"}`}
                                  style={{ width: `${progress}%` }}
                                />
                              </span>
                              <span className={`tabular-nums ${receivedShort ? "font-medium text-(--ff-neg)" : ""}`}>
                                {fmtInt(lot.units_located)}/{fmtInt(lot.units_expected)} received
                              </span>
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td role="cell" className="absolute top-2 right-3 md:static md:table-cell md:align-middle" onClick={(event) => event.stopPropagation()}>
                      <a
                        href={lotHref(lot, "/export")}
                        download
                        className={`${ui.iconBtn} border border-(--ff-line) md:border-0 md:opacity-50 md:group-hover:opacity-100 md:focus-visible:opacity-100`}
                        aria-label={`Download Excel for ${lot.lot_name}`}
                        title="Download supplier Excel"
                      >
                        <FileXlsIcon size={16} aria-hidden />
                      </a>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {!dash && pageCount > 1 && (
          <nav aria-label="Lot list pagination" className="flex flex-wrap items-center justify-between gap-2 border-t border-(--ff-line) bg-(--ff-card) px-4 py-2 sm:px-6">
            <span className="text-xs text-(--ff-muted)" aria-live="polite">
              {fmtInt(pageStart + 1)}–{fmtInt(pageStart + pageLots.length)} of {fmtInt(visibleLots.length)} lots
            </span>
            <div className="flex items-center gap-2">
              <button type="button" className={`${ui.iconBtn} border border-(--ff-line) bg-(--ff-card)`} onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1} aria-label="Previous page">
                <CaretLeftIcon size={16} aria-hidden />
              </button>
              <span className="text-xs font-medium text-(--ff-text-2)">Page {currentPage} of {pageCount}</span>
              <button type="button" className={`${ui.iconBtn} border border-(--ff-line) bg-(--ff-card)`} onClick={() => goToPage(currentPage + 1)} disabled={currentPage === pageCount} aria-label="Next page">
                <CaretRightIcon size={16} aria-hidden />
              </button>
            </div>
          </nav>
        )}
      </section>

      <details className={`${ui.card} group overflow-hidden`} open>
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--ff-accent) sm:px-6 [&::-webkit-details-marker]:hidden">
          <ChartBarIcon size={18} className="shrink-0 text-(--ff-accent)" aria-hidden />
          Store breakdown{hasMonthRange ? ` · ${monthRangeLabel}` : ""}
          <CaretDownIcon size={16} className="ml-auto shrink-0 text-(--ff-muted) group-open:rotate-180" aria-hidden />
        </summary>
        <div className="overflow-x-auto border-t border-(--ff-line)">
          <table className="w-full border-collapse text-left text-sm whitespace-nowrap">
            <thead className={ui.tableHead}>
              <tr className="border-b border-(--ff-line)">
                <th className={`${ui.th} pl-6`}>Store</th>
                <th className={`${ui.th} text-right`}>Lots</th>
                {LOT_STAGE_ORDER.map((st) => (
                  <th key={st} className={`${ui.th} text-right`}>{LOT_STAGE[st].label}</th>
                ))}
                <th className={`${ui.th} text-right`}>Quantity</th>
                <th className={`${ui.th} text-right`}>Total</th>
                <th className={`${ui.th} pr-6 text-right`}>Outstanding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--ff-line)">
              {storeStats.length === 0 ? (
                <tr>
                  <td colSpan={5 + LOT_STAGE_ORDER.length} className="py-10 text-center text-(--ff-muted)">
                    {loading ? "Loading shipment lots…" : loadError ? "Could not load store totals." : "No shipment lots yet."}
                  </td>
                </tr>
              ) : (
                storeStats.map((r) => (
                  <tr
                    key={r.id}
                    className="h-12 cursor-pointer hover:bg-(--ff-raised)"
                    onClick={() => {
                      setPage(1);
                      setSelectedStoreId(selectedStoreId === r.id ? "" : r.id);
                    }}
                    title="Filter by this store"
                  >
                    <th scope="row" className="py-2 pr-3 pl-6 font-medium">
                      <span className="inline-flex items-center gap-2">
                        <StoreDot color={colors[r.id]} />
                        {r.name}
                      </span>
                    </th>
                    <td className="px-3 text-right">{r.lots}</td>
                    {LOT_STAGE_ORDER.map((st) => (
                      <td key={st} className={`px-3 text-right ${r.byStage[st] ? "" : "text-(--ff-muted)"}`}>{r.byStage[st] || "—"}</td>
                    ))}
                    <td className="px-3 text-right">{fmtInt(r.qty)}</td>
                    <td className="px-3 text-right font-medium">{fmtMoney(r.amount)}</td>
                    <td className={`py-2 pr-6 pl-3 text-right ${r.unpaid > 0 ? "font-medium" : "text-(--ff-muted)"}`}>{r.unpaid > 0 ? fmtMoney(r.unpaid) : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
            {storeStats.length > 1 && (
              <tfoot>
                <tr className={`h-12 border-t border-(--ff-line-strong) ${ui.tableTotal}`}>
                  <td className="py-2 pr-3 pl-6">Total</td>
                  <td className="px-3 text-right">{monthActive.length}</td>
                  {LOT_STAGE_ORDER.map((st) => (
                    <td key={st} className="px-3 text-right">{stageCounts[st] || "—"}</td>
                  ))}
                  <td className="px-3 text-right">{fmtInt(monthActive.reduce((a, l) => a + l.quantity, 0))}</td>
                  <td className="px-3 text-right">{fmtMoney(monthActive.reduce((a, l) => a + l.amount, 0))}</td>
                  <td className="py-2 pr-6 pl-3 text-right">{fmtMoney(unpaid)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </details>
      {showCreate && (
        <CreateLotModal
          stores={stores}
          defaultStoreId={selectedStoreId}
          defaultSup={selectedSup}
          onClose={() => setShowCreate(false)}
          onCreated={(lot) => {
            setShowCreate(false);
            setSelectedLot({ store_id: lot.storeId, lot_name: lot.lotName });
            refresh();
          }}
        />
      )}
    </div>
  );
}
