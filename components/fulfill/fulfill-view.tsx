"use client";

import { useEffect, useState, useCallback } from "react";
import {
  MagnifyingGlassIcon,
  PlusIcon,
  EyeIcon,
  FileXlsIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import type { FulfillDashboardSummary, FulfillPo, FulfillPoStatus, FulfillSupplier } from "@/lib/fulfill/types";
import { CreatePoModal } from "./create-po-modal";
import { PoDetailView } from "./po-detail-view";

interface StoreOption {
  id: string;
  name: string;
}

const PO_STATUS_LABELS: Record<FulfillPoStatus, { label: string; bg: string; text: string; border: string }> = {
  draft: { label: "Nháp", bg: "bg-slate-100", text: "text-slate-700", border: "border-slate-300" },
  pending_sup: { label: "Chờ sup nhận", bg: "bg-amber-50", text: "text-amber-800", border: "border-amber-300" },
  producing: { label: "Đang sản xuất", bg: "bg-blue-50", text: "text-blue-800", border: "border-blue-300" },
  shipped: { label: "Đã ship", bg: "bg-purple-50", text: "text-purple-800", border: "border-purple-300" },
  received: { label: "Đã nhận hàng", bg: "bg-emerald-50", text: "text-emerald-800", border: "border-emerald-300" },
  cancelled: { label: "Đã hủy", bg: "bg-rose-50", text: "text-rose-800", border: "border-rose-300" },
};

export function FulfillView() {
  const [selectedPoId, setSelectedPoId] = useState<string | null>(null);

  const [stores, setStores] = useState<StoreOption[]>([]);
  const [suppliers, setSuppliers] = useState<FulfillSupplier[]>([]);
  const [pos, setPos] = useState<FulfillPo[]>([]);
  const [summary, setSummary] = useState<FulfillDashboardSummary>({
    total_pos: 0,
    total_producing: 0,
    total_shipped: 0,
    total_received: 0,
    total_quantity: 0,
    total_amount: 0,
  });

  const [loading, setLoading] = useState(false);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const [showCreateModal, setShowCreateModal] = useState(false);

  // 1. Load Stores & Suppliers
  const fetchStoresAndSuppliers = useCallback(async () => {
    try {
      const [resStores, resSups] = await Promise.all([
        fetch("/api/accounting/stores"),
        fetch("/api/fulfill/suppliers"),
      ]);
      const dataStores = await resStores.json();
      const dataSups = await resSups.json();

      if (resStores.ok && dataStores.stores) {
        setStores(dataStores.stores);
      }
      if (resSups.ok && dataSups.suppliers) {
        setSuppliers(dataSups.suppliers);
      }
    } catch (err) {
      console.error(err);
    }
  }, []);

  // 2. Load POs
  const fetchPos = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedStoreId) params.set("storeId", selectedStoreId);
      if (selectedSupplierId) params.set("supplierId", selectedSupplierId);
      if (selectedStatus) params.set("status", selectedStatus);
      if (searchTerm.trim()) params.set("search", searchTerm.trim());

      const res = await fetch(`/api/fulfill/pos?${params.toString()}`);
      const data = await res.json();
      if (res.ok) {
        setPos(data.pos || []);
        if (data.summary) setSummary(data.summary);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedStoreId, selectedSupplierId, selectedStatus, searchTerm]);

  useEffect(() => {
    void fetchStoresAndSuppliers();
  }, [fetchStoresAndSuppliers]);

  useEffect(() => {
    void fetchPos();
  }, [fetchPos]);

  // Handle delete PO
  const handleDeletePo = async (e: React.MouseEvent, poId: string, poNumber: string) => {
    e.stopPropagation();
    if (!confirm(`Bạn có chắc muốn xóa đợt hàng ${poNumber}? Toàn bộ dòng SKU trong đợt này sẽ bị xóa.`)) {
      return;
    }
    try {
      await fetch(`/api/fulfill/pos/${poId}`, { method: "DELETE" });
      void fetchPos();
    } catch (err) {
      alert("Lỗi khi xóa đợt hàng.");
    }
  };

  // If a PO is selected, show detail view
  if (selectedPoId) {
    return (
      <PoDetailView
        poId={selectedPoId}
        onBack={() => {
          setSelectedPoId(null);
          void fetchPos();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* 5 KPI Metric Cards - Clean, bold, large typography */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {/* Card 1: Total POs */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs transition hover:shadow-sm">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
            Tổng số đợt hàng
          </span>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-extrabold text-slate-900">
              {summary.total_pos}
            </span>
            <span className="text-sm font-medium text-slate-500">đợt</span>
          </div>
        </div>

        {/* Card 2: Producing */}
        <div className="rounded-2xl border border-blue-200/90 bg-white p-5 shadow-xs transition hover:shadow-sm">
          <span className="text-xs font-bold uppercase tracking-wider text-blue-600 block">
            Đang sản xuất
          </span>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-extrabold text-blue-600">
              {summary.total_producing}
            </span>
            <span className="text-sm font-medium text-blue-500">đợt</span>
          </div>
        </div>

        {/* Card 3: Shipped */}
        <div className="rounded-2xl border border-purple-200/90 bg-white p-5 shadow-xs transition hover:shadow-sm">
          <span className="text-xs font-bold uppercase tracking-wider text-purple-600 block">
            Đã xuất xưởng (Ship)
          </span>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-extrabold text-purple-600">
              {summary.total_shipped}
            </span>
            <span className="text-sm font-medium text-purple-500">đợt</span>
          </div>
        </div>

        {/* Card 4: Received */}
        <div className="rounded-2xl border border-emerald-200/90 bg-white p-5 shadow-xs transition hover:shadow-sm">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 block">
            Đã nhận kho FBA
          </span>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-extrabold text-emerald-600">
              {summary.total_received}
            </span>
            <span className="text-sm font-medium text-emerald-500">đợt</span>
          </div>
        </div>

        {/* Card 5: Total Cost */}
        <div className="col-span-2 sm:col-span-1 rounded-2xl border border-slate-200/90 bg-slate-900 p-5 text-white shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
            Tổng tiền sản xuất
          </span>
          <div className="mt-2.5 flex items-baseline gap-1">
            <span className="text-3xl sm:text-4xl font-extrabold text-emerald-400">
              ${summary.total_amount.toLocaleString()}
            </span>
          </div>
          <span className="text-xs text-slate-400 mt-1 block font-medium">
            {summary.total_quantity.toLocaleString()} pcs
          </span>
        </div>
      </div>

      {/* Action & Filter Bar - Spacious, clean inputs, no micro-icons */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Store filter */}
          <select
            value={selectedStoreId}
            onChange={(e) => setSelectedStoreId(e.target.value)}
            className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 cursor-pointer"
          >
            <option value="">Tất cả Store</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          {/* Sup filter */}
          <select
            value={selectedSupplierId}
            onChange={(e) => setSelectedSupplierId(e.target.value)}
            className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 cursor-pointer"
          >
            <option value="">Tất cả Nhà xưởng (Sup)</option>
            {suppliers.map((sp) => (
              <option key={sp.id} value={sp.id}>
                {sp.name} ({sp.code})
              </option>
            ))}
          </select>

          {/* Status filter */}
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 cursor-pointer"
          >
            <option value="">Tất cả Trạng thái</option>
            <option value="draft">Nháp</option>
            <option value="pending_sup">Chờ sup nhận</option>
            <option value="producing">Đang sản xuất</option>
            <option value="shipped">Đã ship</option>
            <option value="received">Đã nhận hàng</option>
            <option value="cancelled">Đã hủy</option>
          </select>

          {/* Search */}
          <div className="relative">
            <MagnifyingGlassIcon size={16} className="absolute left-3.5 top-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Tìm PO#, Store, SKU..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-11 w-64 rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>

        {/* Create PO button - Prominent rounded-full pill */}
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-blue-600 px-6 text-sm font-bold text-white shadow-md shadow-blue-500/25 hover:bg-blue-700 transition cursor-pointer self-start lg:self-center shrink-0"
        >
          <PlusIcon size={16} weight="bold" />
          <span>Tạo Đợt Hàng Mới</span>
        </button>
      </div>

      {/* Orders Table - Spacious, clean rows, high contrast */}
      <div className="rounded-2xl border border-slate-200/90 bg-white shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase text-slate-600 tracking-wider whitespace-nowrap">
                <th className="px-4 py-4 w-12 text-center">STT</th>
                <th className="px-5 py-4 w-52">Mã đợt (PO#)</th>
                <th className="px-4 py-4 w-36">Store</th>
                <th className="px-4 py-4 w-32">Nhà xưởng</th>
                <th className="px-4 py-4 w-32">Ngày đặt</th>
                <th className="px-4 py-4 w-32">Hẹn giao</th>
                <th className="px-4 py-4 w-24 text-center">Số dòng</th>
                <th className="px-4 py-4 w-32 text-right">Tổng SL</th>
                <th className="px-5 py-4 w-36 text-right">Tổng tiền ($)</th>
                <th className="px-5 py-4 w-40 text-center">Trạng thái</th>
                <th className="px-4 py-4 w-28 text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 whitespace-nowrap">
              {loading ? (
                <tr>
                  <td colSpan={11} className="py-16 text-center text-slate-400 font-medium">
                    Đang tải danh sách đợt hàng...
                  </td>
                </tr>
              ) : pos.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-16 text-center text-slate-400">
                    Chưa có đợt hàng nào. Bấm <strong>Tạo Đợt Hàng Mới</strong> để bắt đầu.
                  </td>
                </tr>
              ) : (
                pos.map((p, idx) => {
                  const status = PO_STATUS_LABELS[p.status] || PO_STATUS_LABELS.draft;
                  return (
                    <tr
                      key={p.id}
                      onClick={() => setSelectedPoId(p.id)}
                      className="hover:bg-blue-50/50 transition cursor-pointer group"
                    >
                      <td className="px-4 py-4 text-center text-slate-400 font-semibold">{idx + 1}</td>
                      <td className="px-5 py-4">
                        <span className="text-base font-bold text-blue-600 group-hover:underline">
                          {p.po_number}
                        </span>
                        {p.notes && (
                          <p className="text-xs text-slate-400 truncate max-w-xs mt-0.5">{p.notes}</p>
                        )}
                      </td>
                      <td className="px-4 py-4 font-bold text-slate-900">{p.store_name}</td>
                      <td className="px-4 py-4">
                        <span className="rounded-lg bg-slate-100 px-3 py-1 font-bold text-slate-700 text-xs">
                          {p.supplier_code || p.supplier_name}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-slate-600 font-medium">{p.order_date}</td>
                      <td className="px-4 py-4 text-slate-600 font-medium">{p.target_date || "—"}</td>
                      <td className="px-4 py-4 text-center font-bold text-slate-700">
                        {p.line_count} SKU
                      </td>
                      <td className="px-4 py-4 text-right font-extrabold text-slate-900">
                        {p.total_quantity.toLocaleString()} pcs
                      </td>
                      <td className="px-5 py-4 text-right font-black text-emerald-700">
                        ${p.total_amount.toFixed(2)}
                      </td>
                      <td className="px-5 py-4 text-center">
                        <span
                          className={`inline-block rounded-full px-3.5 py-1 text-xs font-bold uppercase tracking-wide border ${status.bg} ${status.text} ${status.border}`}
                        >
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedPoId(p.id)}
                            className="rounded-lg p-2 text-blue-600 hover:bg-blue-50 transition"
                            title="Mở bảng chi tiết"
                          >
                            <EyeIcon size={18} weight="bold" />
                          </button>
                          <a
                            href={`/api/fulfill/pos/${p.id}/export`}
                            download
                            className="rounded-lg p-2 text-emerald-600 hover:bg-emerald-50 transition"
                            title="Xuất file Excel cho sup"
                          >
                            <FileXlsIcon size={18} weight="bold" />
                          </a>
                          <button
                            type="button"
                            onClick={(e) => handleDeletePo(e, p.id, p.po_number)}
                            className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 transition"
                            title="Xóa đợt hàng"
                          >
                            <TrashIcon size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create PO Modal */}
      <CreatePoModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={(newPoId) => {
          setSelectedPoId(newPoId);
          void fetchPos();
        }}
        stores={stores}
        suppliers={suppliers}
        defaultStoreId={selectedStoreId}
        defaultSupplierId={selectedSupplierId}
      />
    </div>
  );
}
