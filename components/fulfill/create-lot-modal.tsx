"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { SHEET_HEADERS as H } from "@/lib/fulfill/lot-columns";
import { MockupThumbnail, Modal, Notice, fmtInt, fmtMoney, ui } from "./fulfill-ui";

// Form tạo yêu cầu đi hàng, bày giống tab gửi xưởng ("FBA BFF November 26 - Everphant"):
// mỗi dòng 1 SKU, cột theo đúng thứ tự sheet. Final Basecost = Real basecost + Card + Tag + Stand + box/bag,
// Real total = Final Basecost × Quantity/add. Lưu vào CHI TIẾT ĐI HÀNG (source = fulfill).

interface StoreOption {
  id: string;
  name: string;
}

interface SkuOption {
  sku: string;
  /** Trạng thái SKU trong Bảng Mã (Phát triển / Test / Hủy) — ghi vào cột Trạng thái của CHI TIẾT ĐI HÀNG */
  status: string | null;
  product_type: string | null;
  mockup: string | null;
  dimensions: string | null;
  design: string | null;
  fnsku: string | null;
  basecost_tb: number | null;
  last: {
    sup: string | null;
    line_ship: string | null;
    base_cost_per_unit: number | null;
    card: number | null;
    tag: number | null;
    hop_tui: number | null;
    custom_fields: Record<string, unknown> | null;
    ngay_request: string | null;
  } | null;
}

interface FormOptions {
  skus: SkuOption[];
  sups: string[];
  lineShips: string[];
  types: string[];
  existingLots: string[];
}

type NumField = "quantity_request" | "quantity" | "base_cost_per_unit" | "card" | "tag" | "stand_fee" | "hop_tui" | "box_quantity";
type TextField = "product_type" | "line_ship" | "dimensions" | "note" | "design" | "card_design" | "card_back" | "thankyou_card" | "tag_design" | "box_design";

interface Line {
  key: string;
  sku: string;
  mockup: string | null;
  status: string | null;
  lastRequest: string | null;
  /** Quantity/add còn đi theo Quantity cho tới khi sửa tay (giống công thức =H2 trên sheet) */
  addFollows: boolean;
  num: Record<NumField, string>;
  text: Record<TextField, string>;
}

interface Column {
  header: string;
  field: NumField | TextField | "final" | "total" | "image";
  kind: "num" | "money" | "text" | "link" | "calc" | "image";
  width: string;
}

// Tiêu đề lấy nguyên văn từ SHEET_HEADERS (lib/fulfill/lot-columns.ts) — không dịch. Đúng thứ tự cột "bên mình điền" của sheet gửi xưởng (Name / Sup / Date request nằm ở phần đầu form).
const COLUMNS: Column[] = [
  { header: H.product_type, field: "product_type", kind: "text", width: "w-32" },
  { header: H.mockup, field: "image", kind: "image", width: "w-16" },
  { header: H.quantity_request, field: "quantity_request", kind: "num", width: "w-20" },
  { header: H.quantity, field: "quantity", kind: "num", width: "w-24" },
  { header: H.line_ship, field: "line_ship", kind: "text", width: "w-32" },
  { header: H.dimensions, field: "dimensions", kind: "text", width: "w-24" },
  { header: H.base_cost_per_unit, field: "base_cost_per_unit", kind: "money", width: "w-24" },
  { header: H.note, field: "note", kind: "text", width: "w-40" },
  { header: H.card, field: "card", kind: "money", width: "w-20" },
  { header: H.tag, field: "tag", kind: "money", width: "w-20" },
  { header: H.stand_fee, field: "stand_fee", kind: "money", width: "w-20" },
  { header: H.hop_tui, field: "hop_tui", kind: "money", width: "w-20" },
  { header: H.final_basecost, field: "final", kind: "calc", width: "w-24" },
  { header: H.real_total, field: "total", kind: "calc", width: "w-24" },
  { header: H.file_design, field: "design", kind: "link", width: "w-40" },
  { header: H.card_design, field: "card_design", kind: "link", width: "w-40" },
  { header: H.card_back, field: "card_back", kind: "link", width: "w-40" },
  { header: H.thankyou_card, field: "thankyou_card", kind: "link", width: "w-40" },
  { header: H.tag_design, field: "tag_design", kind: "link", width: "w-40" },
  { header: H.box_design, field: "box_design", kind: "link", width: "w-40" },
  { header: H.box_quantity, field: "box_quantity", kind: "num", width: "w-20" },
];

const NUM_FIELDS: NumField[] = ["quantity_request", "quantity", "base_cost_per_unit", "card", "tag", "stand_fee", "hop_tui", "box_quantity"];
const TEXT_FIELDS: TextField[] = ["product_type", "line_ship", "dimensions", "note", "design", "card_design", "card_back", "thankyou_card", "tag_design", "box_design"];
const FEE_FIELDS: NumField[] = ["base_cost_per_unit", "card", "tag", "stand_fee", "hop_tui"];

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const monthName = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/** Tên lô mặc định giống tên tab sheet gửi xưởng: "FBA BFF November 26 - Everphant". */
function defaultLotName(sup: string, date: string, storeName: string) {
  if (!sup || !date || !storeName) return "";
  const d = new Date(`${date}T00:00:00Z`);
  return `FBA ${sup} ${monthName.format(d)} ${d.getUTCDate()} - ${titleCase(storeName)}`;
}

const toNumber = (value: string) => {
  const n = Number(value.replace(/[$,\s]/g, ""));
  return value.trim() === "" || !Number.isFinite(n) ? null : n;
};
const str = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const round2 = (n: number) => Math.round(n * 100) / 100;

function lineFinal(line: Line) {
  return round2(FEE_FIELDS.reduce((a, f) => a + (toNumber(line.num[f]) ?? 0), 0));
}
function lineTotal(line: Line) {
  return round2(lineFinal(line) * (toNumber(line.num.quantity) ?? 0));
}

let lineSeq = 0;
function newLine(option: SkuOption, quantity: string, lineShip: string): Line {
  const last = option.last;
  const extra = last?.custom_fields ?? {};
  const num = Object.fromEntries(NUM_FIELDS.map((f) => [f, ""])) as Record<NumField, string>;
  const text = Object.fromEntries(TEXT_FIELDS.map((f) => [f, ""])) as Record<TextField, string>;
  num.quantity_request = quantity;
  num.quantity = quantity;
  num.base_cost_per_unit = str(last?.base_cost_per_unit ?? option.basecost_tb);
  num.card = str(last?.card);
  num.tag = str(last?.tag);
  num.stand_fee = str(extra.stand_fee);
  num.hop_tui = str(last?.hop_tui);
  num.box_quantity = str(extra.box_quantity);
  text.product_type = option.product_type ?? "";
  text.line_ship = lineShip || last?.line_ship || "";
  text.dimensions = str(extra.dimensions) || option.dimensions || "";
  text.design = str(extra.design) || option.design || "";
  for (const f of ["card_design", "card_back", "thankyou_card", "tag_design", "box_design"] as const) text[f] = str(extra[f]);
  lineSeq += 1;
  return { key: `${option.sku}-${lineSeq}`, sku: option.sku, mockup: option.mockup, status: option.status, lastRequest: last?.ngay_request ?? null, addFollows: true, num, text };
}

export interface CreatedLot {
  storeId: string;
  lotName: string;
}

export function CreateLotModal({
  stores,
  defaultStoreId,
  defaultSup,
  onClose,
  onCreated,
}: {
  stores: StoreOption[];
  defaultStoreId?: string;
  defaultSup?: string;
  onClose: () => void;
  onCreated: (lot: CreatedLot) => void;
}) {
  const ids = useId();
  const [storeId, setStoreId] = useState(defaultStoreId || "");
  const [sup, setSup] = useState(defaultSup || "");
  const [requestDate, setRequestDate] = useState(today());
  const [orderDate, setOrderDate] = useState("");
  const [lotName, setLotName] = useState("");
  const [lotNameEdited, setLotNameEdited] = useState(false);
  const [lineShip, setLineShip] = useState("");
  const [options, setOptions] = useState<{ storeId: string; data: FormOptions | null; error: string | null } | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [skuInput, setSkuInput] = useState("");
  const [skuPickerOpen, setSkuPickerOpen] = useState(false);
  const [activeSkuIndex, setActiveSkuIndex] = useState(-1);
  const [skuQty, setSkuQty] = useState("50");
  const [pasteText, setPasteText] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const store = stores.find((s) => s.id === storeId);
  const current = options?.storeId === storeId ? options : null;
  const loadingOptions = Boolean(storeId) && current === null;
  const formOptions = current?.data ?? null;
  const skuMap = useMemo(() => new Map((formOptions?.skus ?? []).map((s) => [s.sku.trim().toLowerCase(), s])), [formOptions]);
  const skuQuery = skuInput.trim().toLowerCase();
  const skuMatches = (formOptions?.skus ?? []).filter((option) =>
    option.sku.toLowerCase().includes(skuQuery) || option.product_type?.toLowerCase().includes(skuQuery),
  );
  const activeSku = skuPickerOpen ? skuMatches[activeSkuIndex] : undefined;
  const skuListId = `${ids}-sku-options`;
  const activeSkuId = activeSku ? `${skuListId}-${activeSkuIndex}` : undefined;

  useEffect(() => {
    if (activeSkuId) document.getElementById(activeSkuId)?.scrollIntoView({ block: "nearest" });
  }, [activeSkuId]);

  useEffect(() => {
    if (!storeId) return;
    const controller = new AbortController();
    fetch(`/api/fulfill/lots/options?storeId=${storeId}`, { signal: controller.signal })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
        if (!controller.signal.aborted) setOptions({ storeId, data: body, error: null });
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setOptions({ storeId, data: null, error: e.message });
      });
    return () => controller.abort();
  }, [storeId]);

  const suggestedName = defaultLotName(sup, requestDate, store?.name ?? "");
  const effectiveLotName = lotNameEdited ? lotName : suggestedName;
  const lotExists = Boolean(
    effectiveLotName && formOptions?.existingLots.some((l) => l.toLowerCase() === effectiveLotName.trim().toLowerCase()),
  );

  const changeStore = (id: string) => {
    if (lines.length && !confirm("Changing the store clears the SKU rows. Continue?")) return;
    setStoreId(id);
    setLines([]);
    setSkuInput("");
    closeSkuPicker();
    setMessage(null);
  };

  const closeSkuPicker = () => {
    setSkuPickerOpen(false);
    setActiveSkuIndex(-1);
  };

  const selectSku = (option: SkuOption) => {
    setSkuInput(option.sku);
    closeSkuPicker();
  };

  const addSkus = (entries: Array<{ sku: string; qty: string }>) => {
    const missing: string[] = [];
    const duplicate: string[] = [];
    const added: Line[] = [];
    const present = new Set(lines.map((l) => l.sku.toLowerCase()));
    for (const { sku, qty } of entries) {
      const option = skuMap.get(sku.trim().toLowerCase());
      if (!option) missing.push(sku);
      else if (present.has(option.sku.toLowerCase())) duplicate.push(option.sku);
      else {
        present.add(option.sku.toLowerCase());
        added.push(newLine(option, qty, lineShip));
      }
    }
    if (added.length) setLines((prev) => [...prev, ...added]);
    const notes = [
      missing.length ? `Not in the SKU Master: ${missing.join(", ")}` : "",
      duplicate.length ? `Already in the list: ${duplicate.join(", ")}` : "",
    ].filter(Boolean);
    setMessage(notes.length ? { tone: "error", text: notes.join(". ") } : null);
    return added.length;
  };

  const addOne = () => {
    if (!skuInput.trim()) return;
    if (addSkus([{ sku: skuInput.trim(), qty: skuQty }])) {
      setSkuInput("");
      closeSkuPicker();
    }
  };

  const addPasted = () => {
    const entries = pasteText
      .split(/\r?\n/)
      .map((row) => row.trim())
      .filter(Boolean)
      .map((row) => {
        const [sku, qty] = row.split(/[\t,;]+|\s+/);
        return { sku, qty: qty && /^\d+$/.test(qty) ? qty : skuQty };
      });
    if (entries.length && addSkus(entries)) setPasteText("");
  };

  const updateNum = (key: string, field: NumField, value: string) =>
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const num = { ...l.num, [field]: value };
        if (field === "quantity_request" && l.addFollows) num.quantity = value;
        return { ...l, num, addFollows: field === "quantity" ? false : l.addFollows };
      }),
    );
  const updateText = (key: string, field: TextField, value: string) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, text: { ...l.text, [field]: value } } : l)));

  const applyLineShipToAll = (value: string) => {
    setLineShip(value);
    if (value) setLines((prev) => prev.map((l) => ({ ...l, text: { ...l.text, line_ship: value } })));
  };

  const totalQty = lines.reduce((a, l) => a + (toNumber(l.num.quantity) ?? 0), 0);
  const totalAmount = round2(lines.reduce((a, l) => a + lineTotal(l), 0));
  const missingPrice = lines.filter((l) => toNumber(l.num.base_cost_per_unit) === null).length;

  const submit = async () => {
    setMessage(null);
    if (!storeId || !sup || !requestDate || !effectiveLotName.trim()) {
      setMessage({ tone: "error", text: "Select a store and supplier, and enter a request date and lot name." });
      return;
    }
    if (!lines.length) {
      setMessage({ tone: "error", text: "Add at least one SKU." });
      return;
    }
    const bad = lines.find((l) => (toNumber(l.num.quantity) ?? 0) < 1);
    if (bad) {
      setMessage({ tone: "error", text: `${bad.sku}: ${H.quantity} must be at least 1.` });
      return;
    }
    if (missingPrice && !confirm(`${missingPrice} rows have no unit base cost. Save anyway?`)) return;

    setSaving(true);
    try {
      const response = await fetch("/api/fulfill/lots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_id: storeId,
          sup,
          ngay_request: requestDate,
          order_date: orderDate || null,
          ten_lo_hang: effectiveLotName.trim(),
          lines: lines.map((l) => ({
            sku: l.sku,
            mockup: l.mockup,
            ...Object.fromEntries(NUM_FIELDS.map((f) => [f, toNumber(l.num[f])])),
            ...Object.fromEntries(TEXT_FIELDS.map((f) => [f, l.text[f].trim() || null])),
          })),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
      onCreated({ storeId: body.storeId, lotName: body.lotName });
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Could not save the request." });
    } finally {
      setSaving(false);
    }
  };

  const cellInput = "h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-sm transition-[border-color,background-color,box-shadow] duration-150 ease hover:border-(--ff-line-strong) focus:border-(--ff-accent) focus:bg-(--ff-card) focus:outline-none";

  return (
    <Modal title="New Shipment Request" onClose={onClose} width="max-w-[1560px]" minHeight="md:min-h-[min(580px,85dvh)]">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <label>
            <span className={ui.label}>{H.name}</span>
            <select value={storeId} onChange={(e) => changeStore(e.target.value)} className={`${ui.select} w-full`}>
              <option value="">Select a store</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>
            <span className={ui.label}>{H.sup}</span>
            <input list={`${ids}-sups`} value={sup} onChange={(e) => setSup(e.target.value)} placeholder="BFF, Ella…" className={ui.input} />
            <datalist id={`${ids}-sups`}>{formOptions?.sups.map((s) => <option key={s} value={s} />)}</datalist>
          </label>
          <label>
            <span className={ui.label}>{H.ngay_request}</span>
            <input type="date" value={requestDate} onChange={(e) => setRequestDate(e.target.value)} className={ui.input} />
          </label>
          <label>
            <span className={ui.label}>{H.order_date}</span>
            <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className={ui.input} />
          </label>
          <label className="lg:col-span-2">
            <span className={ui.label}>Lot name (supplier sheet tab)</span>
            <input
              value={effectiveLotName}
              onChange={(e) => {
                setLotNameEdited(true);
                setLotName(e.target.value);
              }}
              placeholder="FBA BFF November 26 - Everphant"
              className={ui.input}
            />
            {lotExists && <span className="mt-1 block text-xs text-amber-700">This lot already exists. New SKUs will be added to it.</span>}
          </label>
        </div>

        <div className="rounded-xl border border-(--ff-line) bg-(--ff-card) p-3">
          {!storeId ? (
            <p className="text-sm text-(--ff-muted)">Select a store to load its SKU Master.</p>
          ) : loadingOptions ? (
            <p className="text-sm text-(--ff-muted)">Loading SKU Master…</p>
          ) : current?.error ? (
            <p className="text-sm text-(--ff-neg)">{current.error}</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="flex flex-wrap items-end gap-2">
                <div className="relative min-w-48 flex-1">
                  <label htmlFor={`${ids}-sku-search`} className={ui.label}>Add SKU ({fmtInt(formOptions?.skus.length)} available)</label>
                  <input
                    id={`${ids}-sku-search`}
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={skuPickerOpen}
                    aria-controls={skuPickerOpen ? skuListId : undefined}
                    aria-activedescendant={activeSkuId}
                    autoComplete="off"
                    value={skuInput}
                    onFocus={() => setSkuPickerOpen(true)}
                    onClick={() => setSkuPickerOpen(true)}
                    onBlur={closeSkuPicker}
                    onChange={(event) => {
                      setSkuInput(event.target.value);
                      setSkuPickerOpen(true);
                      setActiveSkuIndex(-1);
                    }}
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing) return;
                      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        setSkuPickerOpen(true);
                        if (skuMatches.length) {
                          const last = skuMatches.length - 1;
                          setActiveSkuIndex((index) => event.key === "ArrowDown"
                            ? index >= last ? 0 : index + 1
                            : index <= 0 ? last : index - 1);
                        }
                      } else if (event.key === "Enter") {
                        event.preventDefault();
                        if (activeSku) selectSku(activeSku);
                        else addOne();
                      } else if (event.key === "Escape" && skuPickerOpen) {
                        event.preventDefault();
                        event.stopPropagation();
                        closeSkuPicker();
                      }
                    }}
                    placeholder="Search SKUs"
                    className={ui.input}
                  />
                  {skuPickerOpen && (
                    <div className="animate-ff-popover origin-top absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-(--ff-line-strong) bg-(--ff-card) shadow-(--ff-shadow)">
                      <ul id={skuListId} role="listbox" aria-label="Matching SKUs" className="max-h-56 overflow-y-auto p-1">
                        {skuMatches.map((option, index) => (
                          <li
                            key={option.sku}
                            id={`${skuListId}-${index}`}
                            role="option"
                            aria-selected={index === activeSkuIndex}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectSku(option)}
                            className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors duration-100 ease hover:bg-(--ff-raised) ${index === activeSkuIndex ? "bg-(--ff-accent-soft)" : ""}`}
                          >
                            <MockupThumbnail url={option.mockup} size={40} />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold">{option.sku}</span>
                              <span className="flex items-center gap-1.5 truncate text-xs text-(--ff-muted)">
                                {option.product_type}
                                <SkuStatus status={option.status} />
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                      {!skuMatches.length && <p role="status" className="px-3 pb-3 text-sm text-(--ff-muted)">No matching SKUs.</p>}
                    </div>
                  )}
                </div>
                <label className="w-24">
                  <span className={ui.label}>Quantity</span>
                  <input inputMode="numeric" value={skuQty} onChange={(e) => setSkuQty(e.target.value)} className={ui.input} />
                </label>
                <label className="w-40">
                  <span className={ui.label}>{H.line_ship} (all rows)</span>
                  <input list={`${ids}-ships`} value={lineShip} onChange={(e) => applyLineShipToAll(e.target.value)} placeholder="SEA 15 DAYS" className={ui.input} />
                  <datalist id={`${ids}-ships`}>{formOptions?.lineShips.map((s) => <option key={s} value={s} />)}</datalist>
                </label>
                <button type="button" onClick={addOne} className={ui.btnSecondary}>
                  <PlusIcon size={16} aria-hidden />
                  Add
                </button>
              </div>
              <div className="flex items-end gap-2">
                <label className="flex-1">
                  <span className={ui.label}>Or paste rows of SKUs and quantities</span>
                  <textarea
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    rows={2}
                    placeholder={"CTDT1106NT01\t50\nCTDT1104WL03\t50"}
                    className={`${ui.input} h-auto py-2 font-mono text-xs`}
                  />
                </label>
                <button type="button" onClick={addPasted} disabled={!pasteText.trim()} className={ui.btnSecondary}>
                  Add rows
                </button>
              </div>
            </div>
          )}
        </div>

        {message && <Notice tone={message.tone} onClose={() => setMessage(null)}>{message.text}</Notice>}

        {lines.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-(--ff-line) overscroll-x-contain">
            <table className="w-max min-w-full border-collapse text-left text-sm">
              <thead className={ui.tableHead}>
                <tr className="border-b border-(--ff-line)">
                  <th className={`${ui.th} sticky left-0 z-10`}>SKU</th>
                  {COLUMNS.map((c) => (
                    <th key={c.header} className={`${ui.th} whitespace-nowrap ${c.kind === "money" || c.kind === "num" || c.kind === "calc" ? "text-right" : ""}`}>
                      {c.header}
                    </th>
                  ))}
                  <th className={ui.th}><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--ff-line)">
                {lines.map((line) => (
                  <tr key={line.key} className="align-middle transition-colors duration-150 ease hover:bg-(--ff-raised)/40">
                    <th scope="row" className="sticky left-0 z-10 bg-(--ff-card) px-3 py-1 font-mono text-xs font-semibold whitespace-nowrap transition-colors duration-150 ease">
                      {line.sku}
                      <SkuStatus status={line.status} />
                      {line.lastRequest && <span className="block font-sans text-[11px] font-normal text-(--ff-muted)">Last ordered {line.lastRequest}</span>}
                    </th>
                    {COLUMNS.map((c) => {
                      if (c.kind === "image") {
                        return (
                          <td key={c.header} className="px-2 py-1">
                            {line.mockup ? (
                              <a href={line.mockup} target="_blank" rel="noreferrer" aria-label={`View mockup for ${line.sku}`} className={`${ui.link} inline-block align-middle`}>
                                <MockupThumbnail url={line.mockup} size={48} />
                              </a>
                            ) : (
                              <MockupThumbnail url={null} size={48} />
                            )}
                          </td>
                        );
                      }
                      if (c.kind === "calc") {
                        return (
                          <td key={c.header} className="px-3 text-right font-medium tabular-nums whitespace-nowrap">
                            {fmtMoney(c.field === "final" ? lineFinal(line) : lineTotal(line))}
                          </td>
                        );
                      }
                      const isNum = c.kind === "num" || c.kind === "money";
                      const value = isNum ? line.num[c.field as NumField] : line.text[c.field as TextField];
                      return (
                        <td key={c.header} className={`px-1 py-1 ${c.width}`}>
                          <input
                            aria-label={`${c.header} ${line.sku}`}
                            value={value}
                            inputMode={isNum ? "decimal" : undefined}
                            list={c.field === "line_ship" ? `${ids}-ships` : c.field === "product_type" ? `${ids}-types` : undefined}
                            placeholder={c.kind === "money" ? "$" : undefined}
                            onChange={(e) =>
                              isNum ? updateNum(line.key, c.field as NumField, e.target.value) : updateText(line.key, c.field as TextField, e.target.value)
                            }
                            className={`${cellInput} ${isNum ? "text-right tabular-nums" : ""} ${c.width}`}
                          />
                        </td>
                      );
                    })}
                    <td className="px-2">
                      <button
                        type="button"
                        onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                        className={ui.iconBtnDanger}
                        title={`Remove ${line.sku}`}
                      >
                        <TrashIcon size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={`h-11 border-t border-(--ff-line-strong) ${ui.tableTotal}`}>
                  <td className={`sticky left-0 px-3 ${ui.tableTotal}`}>{lines.length} SKU</td>
                  {COLUMNS.map((c) => (
                    <td key={c.header} className="px-3 text-right tabular-nums whitespace-nowrap">
                      {c.field === "quantity" ? fmtInt(totalQty) : c.field === "final" ? "Total" : c.field === "total" ? fmtMoney(totalAmount) : ""}
                    </td>
                  ))}
                  <td />
                </tr>
              </tfoot>
            </table>
            <datalist id={`${ids}-types`}>{formOptions?.types.map((t) => <option key={t} value={t} />)}</datalist>
          </div>
        ) : formOptions ? (
          <p className="rounded-xl border border-(--ff-line) px-4 py-6 text-center text-sm text-(--ff-muted)">No SKUs added yet.</p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-(--ff-line) bg-(--ff-card) px-4 py-3 sm:px-6">
        <span className="text-sm text-(--ff-text-2)">
          {lines.length} SKU · {fmtInt(totalQty)} {totalQty === 1 ? "unit" : "units"} · <strong className="text-(--ff-accent)">{fmtMoney(totalAmount)}</strong>
        </span>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className={ui.btnGhost}>Cancel</button>
          <button type="button" onClick={submit} disabled={saving || !lines.length} className={ui.btnPrimary}>
            {saving ? "Saving…" : "Create request"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Trạng thái SKU lấy từ Bảng Mã; SKU "Hủy" tô đỏ để tránh đặt nhầm hàng đã ngừng. */
function SkuStatus({ status }: { status: string | null }) {
  if (!status) return null;
  const isCancelled = status.normalize("NFC").toLowerCase().startsWith("hủy");
  return (
    <span
      title="Trạng thái trong Bảng Mã"
      className={`ml-1.5 inline-block rounded-sm px-1 align-middle font-sans text-[10px] font-medium ${
        isCancelled ? "bg-red-100 text-red-800" : status === "Test" ? "bg-amber-100 text-amber-800" : "bg-(--ff-raised) text-(--ff-text-2)"
      }`}
    >
      {status}
    </span>
  );
}
