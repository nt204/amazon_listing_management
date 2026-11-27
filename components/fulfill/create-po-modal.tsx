"use client";

import { useEffect, useState } from "react";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import type { FulfillSupplier } from "@/lib/fulfill/types";
import { Modal, Notice, fmtInt, fmtMoney, ui } from "./fulfill-ui";

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
      setErrorNotice("Cần điền mã đợt, store và xưởng");
      return;
    }

    const validLines = lines.filter((l) => l.sku.trim().length > 0);
    if (validLines.length === 0) {
      setErrorNotice("Cần ít nhất một dòng có SKU");
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

  const lineInput = "h-9 w-full rounded-md border border-(--ff-line) bg-(--ff-card) px-2 text-sm focus-visible:outline-2 focus-visible:outline-(--ff-accent)";

  return (
    <Modal title="Tạo đợt hàng" onClose={onClose} width="max-w-5xl">
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
          {errorNotice && (
            <Notice tone="error" onClose={() => setErrorNotice(null)}>
              {errorNotice}
            </Notice>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
            <div>
              <label className={ui.label}>Store</label>
              <select value={storeId} onChange={(e) => handleStoreChange(e.target.value)} required className={`${ui.select} w-full`}>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={ui.label}>Xưởng</label>
              <select value={supplierId} onChange={(e) => handleSupplierChange(e.target.value)} required className={`${ui.select} w-full`}>
                {suppliers.map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {sp.code} · {sp.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={ui.label}>Mã đợt</label>
              <input type="text" value={poNumber} onChange={(e) => setPoNumber(e.target.value.toUpperCase())} required className={`${ui.input} font-mono text-xs`} />
            </div>

            <div>
              <label className={ui.label}>Ngày đặt</label>
              <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} required className={ui.input} />
            </div>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">
                SKU sản xuất <span className="font-normal text-(--ff-muted)">· {lines.length} dòng</span>
              </h3>
              <button type="button" onClick={handleAddLine} className={ui.btnGhost}>
                <PlusIcon size={16} />
                Thêm dòng
              </button>
            </div>

            <div className="relative overflow-x-auto rounded-lg border border-(--ff-line)">
              <table className="w-full border-collapse text-left text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-(--ff-line) bg-(--ff-head)">
                    <th className={`${ui.th} w-10 text-right`}>#</th>
                    <th className={`${ui.th} min-w-44`}>SKU</th>
                    <th className={`${ui.th} min-w-36`}>Phôi</th>
                    <th className={`${ui.th} w-28 text-right`}>Số lượng</th>
                    <th className={`${ui.th} w-28 text-right`}>Basecost</th>
                    <th className={`${ui.th} text-right`}>Card, tag, box</th>
                    <th className={`${ui.th} text-right`}>Thành tiền</th>
                    <th className={`${ui.th} min-w-32`}>Line ship</th>
                    <th className={`${ui.th} min-w-44`}>Link thiết kế</th>
                    <th className={`${ui.th} w-12`}>
                      <span className="sr-only">Xóa</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-(--ff-line)">
                  {lines.map((line, idx) => {
                    const extraFees =
                      Number(line.fee_card || 0) + Number(line.fee_tag || 0) + Number(line.fee_stand || 0) + Number(line.fee_box || 0);
                    const unitTotal = (Number(line.basecost) || 0) + extraFees;
                    const lineTotal = (Number(line.quantity) || 0) * unitTotal;

                    return (
                      <tr key={line.id}>
                        <td className="px-3 text-right font-mono text-xs text-(--ff-muted)">{idx + 1}</td>
                        <td className="px-1 py-2">
                          <input
                            type="text"
                            placeholder="SKU"
                            value={line.sku}
                            onChange={(e) => handleLineChange(idx, "sku", e.target.value.toUpperCase())}
                            required
                            className={`${lineInput} font-mono text-xs`}
                          />
                        </td>
                        <td className="px-1 py-2">
                          <input type="text" placeholder="Phôi" value={line.product_type} onChange={(e) => handleLineChange(idx, "product_type", e.target.value)} className={lineInput} />
                        </td>
                        <td className="px-1 py-2">
                          <input type="number" min="1" value={line.quantity} onChange={(e) => handleLineChange(idx, "quantity", e.target.value)} className={`${lineInput} text-right`} />
                        </td>
                        <td className="px-1 py-2">
                          <input type="number" step="0.01" value={line.basecost} onChange={(e) => handleLineChange(idx, "basecost", e.target.value)} className={`${lineInput} text-right`} />
                        </td>
                        <td className="px-3 text-right text-(--ff-text-2)">{fmtMoney(extraFees)}</td>
                        <td className="px-3 text-right font-medium">{fmtMoney(lineTotal)}</td>
                        <td className="px-1 py-2">
                          <input type="text" value={line.line_ship} onChange={(e) => handleLineChange(idx, "line_ship", e.target.value)} className={lineInput} />
                        </td>
                        <td className="px-1 py-2">
                          <input type="text" placeholder="Dán link" value={line.design_url} onChange={(e) => handleLineChange(idx, "design_url", e.target.value)} className={lineInput} />
                        </td>
                        <td className="px-2 text-center">
                          <button type="button" onClick={() => handleRemoveLine(idx)} disabled={lines.length <= 1} className={ui.iconBtnDanger} title="Xóa dòng">
                            <TrashIcon size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-(--ff-muted)">Nhập SKU có trong SKU master của store thì phôi, giá và link tự điền</p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-(--ff-line) px-4 py-3 sm:px-6 sm:py-4">
          <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 sm:gap-x-8">
            <div>
              <dt className="text-xs text-(--ff-muted)">Số lượng</dt>
              <dd className="text-lg font-medium">{fmtInt(totalQuantity)}</dd>
            </div>
            <div>
              <dt className="text-xs text-(--ff-muted)">Thành tiền</dt>
              <dd className="text-lg font-medium">{fmtMoney(totalAmount)}</dd>
            </div>
          </dl>

          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className={ui.btnGhost}>
              Hủy
            </button>
            <button type="submit" disabled={submitting} className={ui.btnPrimary}>
              {submitting ? "Đang tạo đợt" : "Tạo đợt hàng"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
