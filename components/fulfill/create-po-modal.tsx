"use client";

import { useEffect, useState } from "react";
import {
  PlusIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { FulfillSupplier } from "@/lib/fulfill/types";

interface StoreOption {
  id: string;
  name: string;
}

interface SkuSuggestion {
  sku: string;
  asin?: string | null;
  fnsku?: string | null;
  transparency_code?: string | null;
  product_name?: string | null;
  dimensions?: string | null;
  basecost: number;
  fee_card: number;
  fee_tag: number;
  fee_stand: number;
  fee_box: number;
  design_url?: string | null;
  card_url?: string | null;
  tag_url?: string | null;
  box_url?: string | null;
}

interface CreatePoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newPoId: string) => void;
  stores: StoreOption[];
  suppliers: FulfillSupplier[];
  defaultStoreId?: string;
  defaultSupplierId?: string;
}

interface LineItem {
  id: string;
  sku: string;
  product_type: string;
  quantity: number;
  line_ship: string;
  dimensions: string;
  basecost: number;
  fee_card: number;
  fee_tag: number;
  fee_stand: number;
  fee_box: number;
  design_url: string;
  card_url: string;
  tag_url: string;
  box_url: string;
  fnsku: string;
  transparency_code: string;
  shipment_id: string;
}

export function CreatePoModal({
  isOpen,
  onClose,
  onSuccess,
  stores,
  suppliers,
  defaultStoreId,
  defaultSupplierId,
}: CreatePoModalProps) {
  const [storeId, setStoreId] = useState(defaultStoreId || "");
  const [supplierId, setSupplierId] = useState(defaultSupplierId || "");
  const [poNumber, setPoNumber] = useState("");
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [targetDate, setTargetDate] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  // SKU master suggestions cache for the chosen store
  const [skuCatalog, setSkuCatalog] = useState<SkuSuggestion[]>([]);

  // PO Line Items
  const [lines, setLines] = useState<LineItem[]>([
    {
      id: "line-1",
      sku: "",
      product_type: "",
      quantity: 50,
      line_ship: "FBA Sea",
      dimensions: "",
      basecost: 0,
      fee_card: 0,
      fee_tag: 0,
      fee_stand: 0,
      fee_box: 0,
      design_url: "",
      card_url: "",
      tag_url: "",
      box_url: "",
      fnsku: "",
      transparency_code: "",
      shipment_id: "",
    },
  ]);

  // Sync default values when modal opens
  useEffect(() => {
    if (isOpen) {
      const initialStore = defaultStoreId || stores[0]?.id || "";
      const initialSup = defaultSupplierId || suppliers[0]?.id || "";
      setStoreId(initialStore);
      setSupplierId(initialSup);

      // Auto generate PO Number like PO-20261127-01
      const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const supCode = suppliers.find((s) => s.id === initialSup)?.code || "PO";
      setPoNumber(`${supCode}-${todayStr}`);
    }
  }, [isOpen, defaultStoreId, defaultSupplierId, stores, suppliers]);

  // Fetch SKU master suggestions whenever store changes
  useEffect(() => {
    if (!storeId) {
      setSkuCatalog([]);
      return;
    }
    const fetchCatalog = async () => {
      try {
        const res = await fetch(`/api/fulfill/sku-master?storeId=${storeId}`);
        const data = await res.json();
        if (res.ok && data.items) {
          setSkuCatalog(data.items);
        }
      } catch (err) {
        console.error(err);
      }
    };
    void fetchCatalog();
  }, [storeId]);

  if (!isOpen) return null;

  // Handle store change
  const handleStoreChange = (newStoreId: string) => {
    setStoreId(newStoreId);
  };

  // Handle supplier change
  const handleSupplierChange = (newSupId: string) => {
    setSupplierId(newSupId);
    const supCode = suppliers.find((s) => s.id === newSupId)?.code || "PO";
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    setPoNumber(`${supCode}-${todayStr}`);
  };

  // Add line item
  const handleAddLine = () => {
    setLines((prev) => [
      ...prev,
      {
        id: `line-${Date.now()}`,
        sku: "",
        product_type: "",
        quantity: 50,
        line_ship: "FBA Sea",
        dimensions: "",
        basecost: 0,
        fee_card: 0,
        fee_tag: 0,
        fee_stand: 0,
        fee_box: 0,
        design_url: "",
        card_url: "",
        tag_url: "",
        box_url: "",
        fnsku: "",
        transparency_code: "",
        shipment_id: "",
      },
    ]);
  };

  // Remove line item
  const handleRemoveLine = (idx: number) => {
    if (lines.length <= 1) return;
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  // Update line field
  const handleLineChange = (idx: number, field: keyof LineItem, value: any) => {
    setLines((prev) => {
      const next = [...prev];
      const item = { ...next[idx], [field]: value };

      // If SKU was changed, check catalog and auto-populate
      if (field === "sku") {
        const found = skuCatalog.find(
          (c) => c.sku.toLowerCase() === String(value).trim().toLowerCase()
        );
        if (found) {
          if (found.product_name) item.product_type = found.product_name;
          if (found.dimensions) item.dimensions = found.dimensions;
          if (found.basecost) item.basecost = found.basecost;
          if (found.fee_card) item.fee_card = found.fee_card;
          if (found.fee_tag) item.fee_tag = found.fee_tag;
          if (found.fee_stand) item.fee_stand = found.fee_stand;
          if (found.fee_box) item.fee_box = found.fee_box;
          if (found.design_url) item.design_url = found.design_url;
          if (found.card_url) item.card_url = found.card_url;
          if (found.tag_url) item.tag_url = found.tag_url;
          if (found.box_url) item.box_url = found.box_url;
          if (found.fnsku) item.fnsku = found.fnsku;
          if (found.transparency_code) item.transparency_code = found.transparency_code;
        }
      }

      next[idx] = item;
      return next;
    });
  };

  // Compute total amount
  const totalQuantity = lines.reduce((acc, l) => acc + (Number(l.quantity) || 0), 0);
  const totalAmount = lines.reduce((acc, l) => {
    const unitCost =
      (Number(l.basecost) || 0) +
      (Number(l.fee_card) || 0) +
      (Number(l.fee_tag) || 0) +
      (Number(l.fee_stand) || 0) +
      (Number(l.fee_box) || 0);
    return acc + (Number(l.quantity) || 0) * unitCost;
  }, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!poNumber.trim() || !storeId || !supplierId) {
      setErrorNotice("Vui lòng điền đủ Mã đợt (PO#), Store và Nhà xưởng.");
      return;
    }

    const validLines = lines.filter((l) => l.sku.trim().length > 0);
    if (validLines.length === 0) {
      setErrorNotice("Vui lòng nhập ít nhất 1 dòng SKU hợp lệ.");
      return;
    }

    try {
      setSubmitting(true);
      setErrorNotice(null);

      const res = await fetch("/api/fulfill/pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          po_number: poNumber.trim().toUpperCase(),
          store_id: storeId,
          supplier_id: supplierId,
          order_date: orderDate,
          target_date: targetDate || null,
          notes: notes.trim() || null,
          lines: validLines.map((l) => ({
            sku: l.sku.trim().toUpperCase(),
            product_type: l.product_type.trim() || null,
            quantity: Number(l.quantity) || 0,
            line_ship: l.line_ship.trim() || null,
            dimensions: l.dimensions.trim() || null,
            basecost: Number(l.basecost) || 0,
            fee_card: Number(l.fee_card) || 0,
            fee_tag: Number(l.fee_tag) || 0,
            fee_stand: Number(l.fee_stand) || 0,
            fee_box: Number(l.fee_box) || 0,
            design_url: l.design_url.trim() || null,
            card_url: l.card_url.trim() || null,
            tag_url: l.tag_url.trim() || null,
            box_url: l.box_url.trim() || null,
            fnsku: l.fnsku.trim() || null,
            transparency_code: l.transparency_code.trim() || null,
            shipment_id: l.shipment_id.trim() || null,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi tạo đợt hàng");

      onSuccess(data.poId);
      onClose();
    } catch (err: any) {
      setErrorNotice(err.message || String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col rounded-3xl bg-white shadow-2xl ring-1 ring-slate-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-white px-8 py-5">
          <h2 className="text-xl font-black text-slate-900 tracking-tight">
            Tạo Đợt Đặt Hàng Mới
          </h2>
          <button
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer"
          >
            <XIcon size={20} weight="bold" />
          </button>
        </div>

        {errorNotice && (
          <div className="mx-8 mt-4 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm font-semibold text-red-700">
            {errorNotice}
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
          {/* General Info Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 rounded-2xl border border-slate-200/90 bg-[#f8fafc] p-5">
            <div>
              <label className="block text-xs font-bold uppercase text-slate-600 mb-1.5">
                Store <span className="text-red-500">*</span>
              </label>
              <select
                value={storeId}
                onChange={(e) => handleStoreChange(e.target.value)}
                required
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none"
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase text-slate-600 mb-1.5">
                Nhà xưởng (Sup) <span className="text-red-500">*</span>
              </label>
              <select
                value={supplierId}
                onChange={(e) => handleSupplierChange(e.target.value)}
                required
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none"
              >
                {suppliers.map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {sp.name} ({sp.code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase text-slate-600 mb-1.5">
                Mã đợt (PO#) <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value.toUpperCase())}
                required
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-900 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase text-slate-600 mb-1.5">
                Ngày đặt hàng <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
                required
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Lines Table */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-black uppercase tracking-wider text-slate-800">
                Danh sách SKU sản xuất ({lines.length} dòng)
              </span>
              <button
                type="button"
                onClick={handleAddLine}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-4 text-xs font-bold text-blue-700 hover:bg-blue-100 transition shadow-2xs cursor-pointer"
              >
                <PlusIcon size={14} weight="bold" />
                <span>Thêm dòng SKU</span>
              </button>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200/90 bg-white shadow-2xs">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">
                    <th className="px-3 py-3 w-12 text-center">STT</th>
                    <th className="px-3 py-3 w-48">SKU *</th>
                    <th className="px-3 py-3 w-36">Phôi (Type)</th>
                    <th className="px-3 py-3 w-28 text-right">SL (Qty) *</th>
                    <th className="px-3 py-3 w-28 text-right">Basecost ($)</th>
                    <th className="px-3 py-3 w-28 text-right">Card/Tag/Box</th>
                    <th className="px-3 py-3 w-32 text-right">Thành tiền ($)</th>
                    <th className="px-3 py-3 w-36">Line Ship</th>
                    <th className="px-3 py-3 w-44">Link Thiết kế</th>
                    <th className="px-3 py-3 w-16 text-center">Xóa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((line, idx) => {
                    const extraFees =
                      Number(line.fee_card || 0) +
                      Number(line.fee_tag || 0) +
                      Number(line.fee_stand || 0) +
                      Number(line.fee_box || 0);
                    const unitTotal = (Number(line.basecost) || 0) + extraFees;
                    const lineTotal = (Number(line.quantity) || 0) * unitTotal;

                    return (
                      <tr key={line.id} className="hover:bg-slate-50/70 transition">
                        <td className="px-3 py-2.5 text-center text-slate-400 font-semibold">{idx + 1}</td>
                        <td className="px-3 py-2.5">
                          <input
                            type="text"
                            placeholder="Nhập mã SKU..."
                            value={line.sku}
                            onChange={(e) => handleLineChange(idx, "sku", e.target.value.toUpperCase())}
                            required
                            className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-bold text-slate-900 focus:border-blue-500 focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <input
                            type="text"
                            placeholder="Phôi sản phẩm"
                            value={line.product_type}
                            onChange={(e) => handleLineChange(idx, "product_type", e.target.value)}
                            className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <input
                            type="number"
                            min="1"
                            value={line.quantity}
                            onChange={(e) => handleLineChange(idx, "quantity", e.target.value)}
                            className="w-24 rounded-xl border border-slate-200 px-3 py-1.5 text-right text-sm font-bold text-slate-900 focus:border-blue-500 focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <input
                            type="number"
                            step="0.01"
                            value={line.basecost}
                            onChange={(e) => handleLineChange(idx, "basecost", e.target.value)}
                            className="w-24 rounded-xl border border-slate-200 px-3 py-1.5 text-right text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-2.5 text-right text-sm text-slate-600 font-medium">
                          ${extraFees.toFixed(2)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-sm font-black text-emerald-700">
                          ${lineTotal.toFixed(2)}
                        </td>
                        <td className="px-3 py-2.5">
                          <input
                            type="text"
                            value={line.line_ship}
                            onChange={(e) => handleLineChange(idx, "line_ship", e.target.value)}
                            className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <input
                            type="text"
                            placeholder="https://..."
                            value={line.design_url}
                            onChange={(e) => handleLineChange(idx, "design_url", e.target.value)}
                            className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-600 focus:border-blue-500 focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveLine(idx)}
                            disabled={lines.length <= 1}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition disabled:opacity-30 cursor-pointer"
                          >
                            <TrashIcon size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Summary Footer bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-slate-200/90 bg-[#f8fafc] p-5">
            <div className="flex items-center gap-8 text-sm">
              <div>
                <span className="text-slate-500 block text-xs font-bold uppercase">Tổng số lượng</span>
                <strong className="text-slate-900 text-lg font-black">{totalQuantity.toLocaleString()} pcs</strong>
              </div>
              <div className="h-8 w-px bg-slate-200" />
              <div>
                <span className="text-slate-500 block text-xs font-bold uppercase">Tổng tiền sản xuất</span>
                <strong className="text-emerald-700 text-lg font-black">${totalAmount.toFixed(2)}</strong>
              </div>
            </div>

            <div className="flex items-center gap-3 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full px-6 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-200/60 transition cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-full bg-blue-600 px-8 py-2.5 text-sm font-bold text-white shadow-md shadow-blue-500/25 hover:bg-blue-700 transition disabled:opacity-50 cursor-pointer"
              >
                {submitting ? "Đang tạo đợt..." : "Tạo đợt hàng ngay"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
