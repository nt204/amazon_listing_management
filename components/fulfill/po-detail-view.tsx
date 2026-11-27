"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  ClockIcon,
  DownloadSimpleIcon,
  FileXlsIcon,
  PackageIcon,
  PlusIcon,
  PrinterIcon,
  TrashIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { FulfillPo, FulfillPoLine, FulfillPoStatus } from "@/lib/fulfill/types";

interface PoDetailViewProps {
  poId: string;
  onBack: () => void;
}

const PO_STATUS_LABELS: Record<FulfillPoStatus, { label: string; bg: string; text: string; border: string }> = {
  draft: { label: "Nháp", bg: "bg-slate-100", text: "text-slate-700", border: "border-slate-300" },
  pending_sup: { label: "Chờ sup nhận", bg: "bg-amber-50", text: "text-amber-800", border: "border-amber-300" },
  producing: { label: "Đang sản xuất", bg: "bg-blue-50", text: "text-blue-800", border: "border-blue-300" },
  shipped: { label: "Đã ship", bg: "bg-purple-50", text: "text-purple-800", border: "border-purple-300" },
  received: { label: "Đã nhận hàng", bg: "bg-emerald-50", text: "text-emerald-800", border: "border-emerald-300" },
  cancelled: { label: "Đã hủy", bg: "bg-rose-50", text: "text-rose-800", border: "border-rose-300" },
};

export function PoDetailView({ poId, onBack }: PoDetailViewProps) {
  const [po, setPo] = useState<FulfillPo | null>(null);
  const [lines, setLines] = useState<FulfillPoLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingCellId, setSavingCellId] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Load PO details
  const fetchPo = useCallback(async () => {
    try {
      setLoading(true);
      setErrorNotice(null);
      const res = await fetch(`/api/fulfill/pos/${poId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không thể tải đợt hàng");
      setPo(data.po);
      setLines(data.lines || []);
    } catch (err: any) {
      setErrorNotice(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [poId]);

  useEffect(() => {
    void fetchPo();
  }, [fetchPo]);

  // Update PO Status
  const handleStatusChange = async (newStatus: FulfillPoStatus) => {
    if (!po) return;
    try {
      setPo((prev) => prev ? { ...prev, status: newStatus } : null);
      await fetch(`/api/fulfill/pos/${po.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err: any) {
      setErrorNotice(err.message || "Lỗi cập nhật trạng thái");
    }
  };

  // Inline Cell Edit Save
  const handleCellBlur = async (lineId: string, field: string, value: any, oldValue: any) => {
    if (value === oldValue) return; // No change
    const cellKey = `${lineId}-${field}`;
    try {
      setSavingCellId(cellKey);
      const res = await fetch(`/api/fulfill/pos/${poId}/lines/${lineId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, value }),
      });
      if (!res.ok) throw new Error("Lỗi lưu ô dữ liệu");

      // Update local line state
      setLines((prev) =>
        prev.map((l) => {
          if (l.id !== lineId) return l;
          const updated = { ...l, [field]: value };
          if (["quantity", "basecost", "fee_card", "fee_tag", "fee_stand", "fee_box"].includes(field)) {
            const unit =
              Number(updated.basecost || 0) +
              Number(updated.fee_card || 0) +
              Number(updated.fee_tag || 0) +
              Number(updated.fee_stand || 0) +
              Number(updated.fee_box || 0);
            updated.total_line_cost = Math.round(Number(updated.quantity || 0) * unit * 100) / 100;
          }
          return updated;
        })
      );

      // Re-fetch totals in background
      void fetchPo();
    } catch (err: any) {
      console.error(err);
      setErrorNotice("Không thể lưu thay đổi vào hệ thống.");
    } finally {
      setSavingCellId(null);
    }
  };

  // Add new line
  const handleAddNewLine = async () => {
    try {
      const res = await fetch(`/api/fulfill/pos/${poId}/lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: "NEW_SKU", quantity: 50, line_ship: "FBA Sea" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi thêm dòng");
      setLines((prev) => [...prev, data.line]);
      void fetchPo();
    } catch (err: any) {
      setErrorNotice(err.message);
    }
  };

  // Delete line
  const handleDeleteLine = async (lineId: string) => {
    if (!confirm("Bạn có chắc muốn xóa dòng sản phẩm này?")) return;
    try {
      await fetch(`/api/fulfill/pos/${poId}/lines/${lineId}`, { method: "DELETE" });
      setLines((prev) => prev.filter((l) => l.id !== lineId));
      void fetchPo();
    } catch (err: any) {
      setErrorNotice("Lỗi xóa dòng.");
    }
  };

  // Print PDF
  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-3 border-blue-600 border-t-transparent" />
        <p className="text-xs font-semibold text-slate-500">Đang tải bảng chi tiết đợt hàng...</p>
      </div>
    );
  }

  if (!po) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm font-semibold text-red-600">Không tìm thấy đợt hàng.</p>
        <button onClick={onBack} className="mt-3 text-xs text-blue-600 font-bold hover:underline">
          Quay lại danh sách
        </button>
      </div>
    );
  }

  const statusConfig = PO_STATUS_LABELS[po.status] || PO_STATUS_LABELS.draft;

  return (
    <div className="space-y-4">
      {/* Top action & meta header */}
      <div className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Left: Back + PO Info */}
          <div className="flex items-center gap-3.5">
            <button
              onClick={onBack}
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition"
              title="Quay lại danh sách đợt hàng"
            >
              <ArrowLeftIcon size={18} weight="bold" />
            </button>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-lg font-black text-slate-900 tracking-tight">{po.po_number}</h1>
                <span className="rounded-lg bg-blue-100 px-2 py-0.5 text-xs font-extrabold text-blue-900">
                  {po.store_name}
                </span>
                <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">
                  Xưởng: {po.supplier_code || po.supplier_name}
                </span>
                <span className="text-xs text-slate-400">| Ngày: {po.order_date}</span>
              </div>
              <div className="mt-1 flex items-center gap-4 text-xs text-slate-500">
                <span>Số SKU: <strong className="text-slate-800">{lines.length}</strong></span>
                <span>Tổng SL: <strong className="text-slate-800">{po.total_quantity.toLocaleString()} pcs</strong></span>
                <span>Tổng tiền: <strong className="text-emerald-700 font-bold">${po.total_amount.toFixed(2)}</strong></span>
              </div>
            </div>
          </div>

          {/* Right: Status selector & Action buttons */}
          <div className="flex items-center gap-2.5 flex-wrap self-end lg:self-center">
            {/* Status dropdown */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold uppercase text-slate-400">Trạng thái:</span>
              <select
                value={po.status}
                onChange={(e) => handleStatusChange(e.target.value as FulfillPoStatus)}
                className={`rounded-xl border px-3 py-1.5 text-xs font-extrabold uppercase tracking-wide cursor-pointer focus:outline-none transition ${statusConfig.bg} ${statusConfig.text} ${statusConfig.border}`}
              >
                <option value="draft">Nháp</option>
                <option value="pending_sup">Chờ sup nhận</option>
                <option value="producing">Đang sản xuất</option>
                <option value="shipped">Đã ship</option>
                <option value="received">Đã nhận hàng</option>
                <option value="cancelled">Đã hủy</option>
              </select>
            </div>

            {/* Export Excel */}
            <a
              href={`/api/fulfill/pos/${po.id}/export`}
              download
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition shadow-2xs"
            >
              <FileXlsIcon size={16} weight="bold" />
              <span>Xuất Excel</span>
            </a>

            {/* Print / PDF */}
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition shadow-2xs"
            >
              <PrinterIcon size={16} weight="bold" />
              <span>In phiếu</span>
            </button>

            {/* Add row */}
            <button
              onClick={handleAddNewLine}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-md shadow-blue-500/20 hover:bg-blue-700 transition"
            >
              <PlusIcon size={15} weight="bold" />
              <span>Thêm dòng</span>
            </button>
          </div>
        </div>

        {errorNotice && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs font-semibold text-red-700">
            <WarningCircleIcon size={16} weight="fill" className="shrink-0" />
            <span>{errorNotice}</span>
            <button onClick={() => setErrorNotice(null)} className="ml-auto text-red-500 hover:text-red-700">
              <XIcon size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Spreadsheet Table with 3 colored sections */}
      <div className="rounded-3xl border border-slate-200/90 bg-white shadow-xs overflow-hidden">
        <div className="overflow-x-auto max-h-[calc(100vh-280px)]">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 z-20 shadow-xs">
              {/* Group Header Level 1 */}
              <tr className="text-center font-black text-[11px] uppercase tracking-wider">
                <th colSpan={14} className="border-b border-r border-blue-200 bg-blue-50/90 text-blue-900 py-1.5 px-3">
                  1. BÊN MÌNH ĐIỀN (THÔNG TIN ĐẶT HÀNG)
                </th>
                <th colSpan={7} className="border-b border-r border-amber-200 bg-amber-50/90 text-amber-900 py-1.5 px-3">
                  2. PHẦN ĐÓNG GÓI FBA
                </th>
                <th colSpan={8} className="border-b border-emerald-200 bg-emerald-50/90 text-emerald-900 py-1.5 px-3">
                  3. THEO DÕI ĐƠN & VẬN CHUYỂN
                </th>
              </tr>

              {/* Column Header Level 2 */}
              <tr className="bg-slate-100/95 text-[10px] font-extrabold uppercase text-slate-700 tracking-wider whitespace-nowrap border-b border-slate-300">
                <th className="px-2 py-2 w-10 text-center border-r border-slate-200">STT</th>
                <th className="px-3 py-2 w-40 border-r border-slate-200">SKU</th>
                <th className="px-3 py-2 w-32 border-r border-slate-200">Phôi (Type)</th>
                <th className="px-2 py-2 w-20 text-right border-r border-slate-200 bg-blue-50/40">SL (Qty)</th>
                <th className="px-2 py-2 w-24 text-right border-r border-slate-200 bg-blue-50/40">Basecost ($)</th>
                <th className="px-2 py-2 w-16 text-right border-r border-slate-200">Card ($)</th>
                <th className="px-2 py-2 w-16 text-right border-r border-slate-200">Tag ($)</th>
                <th className="px-2 py-2 w-16 text-right border-r border-slate-200">Stand ($)</th>
                <th className="px-2 py-2 w-16 text-right border-r border-slate-200">Box ($)</th>
                <th className="px-2 py-2 w-24 text-right border-r border-slate-200 font-black text-emerald-800 bg-emerald-50/60">
                  Thành tiền ($)
                </th>
                <th className="px-3 py-2 w-28 border-r border-slate-200">Line ship</th>
                <th className="px-3 py-2 w-28 border-r border-slate-200">Kích thước</th>
                <th className="px-3 py-2 w-36 border-r border-slate-200">Design Link</th>
                <th className="px-3 py-2 w-32 border-r border-blue-300">Card Link</th>

                {/* FBA Packaging */}
                <th className="px-3 py-2 w-32 border-r border-slate-200">Transparency</th>
                <th className="px-3 py-2 w-32 border-r border-slate-200">FNSKU</th>
                <th className="px-3 py-2 w-32 border-r border-slate-200">Label FNSKU</th>
                <th className="px-3 py-2 w-36 border-r border-slate-200">Shipment ID</th>
                <th className="px-2 py-2 w-20 text-right border-r border-slate-200">Box Qty</th>
                <th className="px-3 py-2 w-32 border-r border-slate-200">Shipping Label</th>
                <th className="px-3 py-2 w-36 border-r border-amber-300">Shipping Address</th>

                {/* Factory Tracking */}
                <th className="px-3 py-2 w-28 border-r border-slate-200">Ship out date</th>
                <th className="px-3 py-2 w-28 border-r border-slate-200">Arrival date</th>
                <th className="px-2 py-2 w-24 text-right border-r border-slate-200">Phí bù ($)</th>
                <th className="px-3 py-2 w-32 border-r border-slate-200">Sample Link</th>
                <th className="px-3 py-2 w-32 border-r border-slate-200">Package Link</th>
                <th className="px-3 py-2 w-24 border-r border-slate-200">Check</th>
                <th className="px-3 py-2 w-36 border-r border-slate-200">Notes</th>
                <th className="px-2 py-2 w-10 text-center">Xóa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((line, idx) => {
                return (
                  <tr key={line.id} className="hover:bg-amber-50/40 transition whitespace-nowrap group">
                    <td className="px-2 py-1.5 text-center text-slate-400 font-semibold border-r border-slate-200">
                      {idx + 1}
                    </td>

                    {/* SKU */}
                    <td className="p-0 border-r border-slate-200">
                      <input
                        type="text"
                        defaultValue={line.sku}
                        onBlur={(e) => handleCellBlur(line.id, "sku", e.target.value.trim().toUpperCase(), line.sku)}
                        className="w-full h-full px-2.5 py-1.5 font-bold text-slate-900 bg-transparent focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 rounded"
                      />
                    </td>

                    {/* Phôi */}
                    <td className="p-0 border-r border-slate-200">
                      <input
                        type="text"
                        defaultValue={line.product_type || ""}
                        onBlur={(e) => handleCellBlur(line.id, "product_type", e.target.value.trim(), line.product_type)}
                        className="w-full h-full px-2.5 py-1.5 text-slate-800 bg-transparent focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 rounded"
                      />
                    </td>

                    {/* Quantity */}
                    <td className="p-0 border-r border-slate-200 bg-blue-50/20">
                      <input
                        type="number"
                        min="0"
                        defaultValue={line.quantity}
                        onBlur={(e) => handleCellBlur(line.id, "quantity", Number(e.target.value) || 0, line.quantity)}
                        className="w-full h-full px-2 py-1.5 text-right font-black text-slate-900 bg-transparent focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 rounded"
                      />
                    </td>

                    {/* Basecost */}
                    <td className="p-0 border-r border-slate-200 bg-blue-50/20">
                      <input
                        type="number"
                        step="0.01"
                        defaultValue={line.basecost}
                        onBlur={(e) => handleCellBlur(line.id, "basecost", Number(e.target.value) || 0, line.basecost)}
                        className="w-full h-full px-2 py-1.5 text-right font-semibold text-slate-900 bg-transparent focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 rounded"
                      />
                    </td>

                    {/* Fee Card */}
                    <td className="p-0 border-r border-slate-200">
                      <input
                        type="number"
                        step="0.01"
                        defaultValue={line.fee_card}
                        onBlur={(e) => handleCellBlur(line.id, "fee_card", Number(e.target.value) || 0, line.fee_card)}
                        className="w-full h-full px-1.5 py-1.5 text-right text-slate-600 bg-transparent focus:bg-white focus:outline-none rounded"
                      />
                    </td>

                    {/* Fee Tag */}
                    <td className="p-0 border-r border-slate-200">
                      <input
                        type="number"
                        step="0.01"
                        defaultValue={line.fee_tag}
                        onBlur={(e) => handleCellBlur(line.id, "fee_tag", Number(e.target.value) || 0, line.fee_tag)}
                        className="w-full h-full px-1.5 py-1.5 text-right text-slate-600 bg-transparent focus:bg-white focus:outline-none rounded"
                      />
                    </td>

                    {/* Fee Stand */}
                    <td className="p-0 border-r border-slate-200">
                      <input
                        type="number"
                        step="0.01"
                        defaultValue={line.fee_stand}
                        onBlur={(e) => handleCellBlur(line.id, "fee_stand", Number(e.target.value) || 0, line.fee_stand)}
                        className="w-full h-full px-1.5 py-1.5 text-right text-slate-600 bg-transparent focus:bg-white focus:outline-none rounded"
                      />
                    </td>

                    {/* Fee Box */}
                    <td className="p-0 border-r border-slate-200">
                      <input
                        type="number"
                        step="0.01"
                        defaultValue={line.fee_box}
                        onBlur={(e) => handleCellBlur(line.id, "fee_box", Number(e.target.value) || 0, line.fee_box)}
                        className="w-full h-full px-1.5 py-1.5 text-right text-slate-600 bg-transparent focus:bg-white focus:outline-none rounded"
                      />
                    </td>

                    {/* Total Line Cost */}
                    <td className="px-2 py-1.5 text-right font-black text-emerald-700 bg-emerald-50/30 border-r border-slate-200">
                      ${line.total_line_cost.toFixed(2)}
                    </td>

                    {/* Line Ship */}
                    <td className="p-0 border-r border-slate-200">
                      <input
                        type="text"
                        defaultValue={line.line_ship || ""}
                        onBlur={(e) => handleCellBlur(line.id, "line_ship", e.target.value.trim(), line.line_ship)}
                        className="w-full h-full px-2 py-1.5 text-slate-700 bg-transparent focus:bg-white focus:outline-none rounded"
                      />
                    </td>

                    {/* Dimensions */}
                    <td className="p-0 border-r border-slate-200">
                      <input
                        type="text"
                        defaultValue={line.dimensions || ""}
                        onBlur={(e) => handleCellBlur(line.id, "dimensions", e.target.value.trim(), line.dimensions)}
                        className="w-full h-full px-2 py-1.5 text-slate-700 bg-transparent focus:bg-white focus:outline-none rounded"
                      />
                    </td>

                    {/* Design URL */}
                    <td className="p-0 border-r border-slate-200">
                      <input
                        type="text"
                        defaultValue={line.design_url || ""}
                        placeholder="Link..."
                        onBlur={(e) => handleCellBlur(line.id, "design_url", e.target.value.trim(), line.design_url)}
                        className="w-full h-full px-2 py-1.5 text-blue-600 hover:underline bg-transparent focus:bg-white focus:outline-none rounded"
                      />
                    </td>

                    {/* Card URL */}
                    <td className="p-0 border-r border-blue-300">
                      <input
                        type="text"
                        defaultValue={line.card_url || ""}
                        placeholder="Link..."
                        onBlur={(e) => handleCellBlur(line.id, "card_url", e.target.value.trim(), line.card_url)}
                        className="w-full h-full px-2 py-1.5 text-blue-600 bg-transparent focus:bg-white focus:outline-none rounded"
                      />
                    </td>

                    {/* FBA: Transparency */}
                    <td className="p-0 border-r border-slate-200 bg-amber-50/10">
                      <input
                        type="text"
                        defaultValue={line.transparency_code || ""}
                        onBlur={(e) => handleCellBlur(line.id, "transparency_code", e.target.value.trim(), line.transparency_code)}
                        className="w-full h-full px-2 py-1.5 text-slate-800 bg-transparent focus:bg-white focus:outline-none rounded"
                      />
                    </td>

                    {/* FNSKU */}
                    <td className="p-0 border-r border-slate-200 bg-amber-50/10">
                      <input
                        type="text"
                        defaultValue={line.fnsku || ""}
                        onBlur={(e) => handleCellBlur(line.id, "fnsku", e.target.value.trim(), line.fnsku)}
                        className="w-full h-full px-2 py-1.5 text-slate-800 bg-transparent focus:bg-white focus:outline-none rounded"
                      />
                    </td>

                    {/* Label FNSKU */}
                    <td className="p-0 border-r border-slate-200 bg-amber-50/10">
                      <input
                        type="text"
                        defaultValue={line.label_fnsku || ""}
                        onBlur={(e) => handleCellBlur(line.id, "label_fnsku", e.target.value.trim(), line.label_fnsku)}
                        className="w-full h-full px-2 py-1.5 text-slate-800 bg-transparent focus:bg-white focus:outline-none rounded"
                      />
                    </td>

                    {/* Shipment ID */}
                    <td className="p-0 border-r border-slate-200 bg-amber-50/10">
                      <input
                        type="text"
                        defaultValue={line.shipment_id || ""}
                        onBlur={(e) => handleCellBlur(line.id, "shipment_id", e.target.value.trim(), line.shipment_id)}
                        className="w-full h-full px-2 py-1.5 font-bold text-amber-900 bg-transparent focus:bg-white focus:outline-none rounded"
                      />
                    </td>

                    {/* Box Qty */}
                    <td className="p-0 border-r border-slate-200 bg-amber-50/10">
                      <input
                        type="number"
                        defaultValue={line.box_quantity || ""}
                        onBlur={(e) => handleCellBlur(line.id, "box_quantity", e.target.value ? Number(e.target.value) : null, line.box_quantity)}
                        className="w-full h-full px-1.5 py-1.5 text-right font-semibold text-slate-800 bg-transparent focus:bg-white focus:outline-none rounded"
                      />
                    </td>

                    {/* Shipping Label */}
                    <td className="p-0 border-r border-slate-200 bg-amber-50/10">
                      <input
                        type="text"
                        defaultValue={line.shipping_label || ""}
                        onBlur={(e) => handleCellBlur(line.id, "shipping_label", e.target.value.trim(), line.shipping_label)}
                        className="w-full h-full px-2 py-1.5 text-slate-700 bg-transparent focus:bg-white focus:outline-none rounded"
                      />
                    </td>

                    {/* Shipping Address */}
                    <td className="p-0 border-r border-amber-300 bg-amber-50/10">
                      <input
                        type="text"
                        defaultValue={line.shipping_address || ""}
                        onBlur={(e) => handleCellBlur(line.id, "shipping_address", e.target.value.trim(), line.shipping_address)}
                        className="w-full h-full px-2 py-1.5 text-slate-700 bg-transparent focus:bg-white focus:outline-none rounded"
                      />
                    </td>

                    {/* Ship out date */}
                    <td className="p-0 border-r border-slate-200 bg-emerald-50/10">
                      <input
                        type="date"
                        defaultValue={line.shipping_out_date || ""}
                        onBlur={(e) => handleCellBlur(line.id, "shipping_out_date", e.target.value || null, line.shipping_out_date)}
                        className="w-full h-full px-1.5 py-1.5 text-slate-700 bg-transparent focus:bg-white focus:outline-none rounded"
                      />
                    </td>

                    {/* Arrival date */}
                    <td className="p-0 border-r border-slate-200 bg-emerald-50/10">
                      <input
                        type="date"
                        defaultValue={line.arrival_date || ""}
                        onBlur={(e) => handleCellBlur(line.id, "arrival_date", e.target.value || null, line.arrival_date)}
                        className="w-full h-full px-1.5 py-1.5 text-slate-700 bg-transparent focus:bg-white focus:outline-none rounded"
                      />
                    </td>

                    {/* Replacement fee */}
                    <td className="p-0 border-r border-slate-200 bg-emerald-50/10">
                      <input
                        type="number"
                        step="0.01"
                        defaultValue={line.replacement_fee}
                        onBlur={(e) => handleCellBlur(line.id, "replacement_fee", Number(e.target.value) || 0, line.replacement_fee)}
                        className="w-full h-full px-1.5 py-1.5 text-right text-rose-600 bg-transparent focus:bg-white focus:outline-none rounded"
                      />
                    </td>

                    {/* Sample URL */}
                    <td className="p-0 border-r border-slate-200">
                      <input
                        type="text"
                        defaultValue={line.sample_url || ""}
                        placeholder="Link ảnh..."
                        onBlur={(e) => handleCellBlur(line.id, "sample_url", e.target.value.trim(), line.sample_url)}
                        className="w-full h-full px-2 py-1.5 text-slate-600 bg-transparent focus:bg-white focus:outline-none rounded"
                      />
                    </td>

                    {/* Package URL */}
                    <td className="p-0 border-r border-slate-200">
                      <input
                        type="text"
                        defaultValue={line.package_url || ""}
                        placeholder="Link..."
                        onBlur={(e) => handleCellBlur(line.id, "package_url", e.target.value.trim(), line.package_url)}
                        className="w-full h-full px-2 py-1.5 text-slate-600 bg-transparent focus:bg-white focus:outline-none rounded"
                      />
                    </td>

                    {/* Check Status */}
                    <td className="p-0 border-r border-slate-200">
                      <select
                        defaultValue={line.check_status || ""}
                        onChange={(e) => handleCellBlur(line.id, "check_status", e.target.value, line.check_status)}
                        className="w-full h-full px-2 py-1.5 font-bold text-slate-800 bg-transparent focus:bg-white focus:outline-none rounded cursor-pointer"
                      >
                        <option value="">—</option>
                        <option value="ok">OK</option>
                        <option value="pending">Chờ check</option>
                        <option value="defect">Lỗi</option>
                        <option value="replaced">Đã bù</option>
                      </select>
                    </td>

                    {/* Notes */}
                    <td className="p-0 border-r border-slate-200">
                      <input
                        type="text"
                        defaultValue={line.notes || ""}
                        placeholder="Ghi chú..."
                        onBlur={(e) => handleCellBlur(line.id, "notes", e.target.value.trim(), line.notes)}
                        className="w-full h-full px-2 py-1.5 text-slate-600 bg-transparent focus:bg-white focus:outline-none rounded"
                      />
                    </td>

                    {/* Action */}
                    <td className="px-2 py-1.5 text-center">
                      <button
                        onClick={() => handleDeleteLine(line.id)}
                        className="rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 transition"
                        title="Xóa dòng"
                      >
                        <TrashIcon size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
