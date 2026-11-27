"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  BuildingsIcon,
  CalendarBlankIcon,
  CheckCircleIcon,
  ClockIcon,
  EyeIcon,
  FileXlsIcon,
  FunnelIcon,
  HourglassIcon,
  MagnifyingGlassIcon,
  PackageIcon,
  PlusIcon,
  StorefrontIcon,
  TrashIcon,
  TruckIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { FulfillDashboardSummary, FulfillPo, FulfillPoStatus, FulfillSupplier } from "@/lib/fulfill/types";
import { CreatePoModal } from "./create-po-modal";
import { PoDetailView } from "./po-detail-view";
import { SkuMasterView } from "./sku-master-view";
import { SuppliersView } from "./suppliers-view";

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

type FulfillTab = "pos" | "sku_master" | "suppliers";

export function FulfillView() {
  const [activeTab, setActiveTab] = useState<FulfillTab>("pos");
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
      <div className="p-4 sm:p-6 bg-[#f8fafc] min-h-[calc(100vh-64px)]">
        <PoDetailView poId={selectedPoId} onBack={() => { setSelectedPoId(null); void fetchPos(); }} />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 bg-[#f8fafc] min-h-[calc(100vh-64px)] space-y-6">
      {/* Top Header Card */}
      <div className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-lg shadow-blue-500/20">
              <PackageIcon size={26} weight="bold" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black text-slate-900 tracking-tight">
                  Quản Lý Đặt Sản Xuất FBA
                </h1>
                <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[10px] font-extrabold uppercase text-blue-700 border border-blue-200">
                  Fulfill System
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Quản lý các đợt đặt hàng gửi xưởng gia công, đồng bộ thiết kế, đóng gói FBA và tiến độ sản xuất
              </p>
            </div>
          </div>

          {/* Quick Tab Switcher */}
          <div className="flex items-center gap-1.5 rounded-2xl bg-slate-100 p-1.5 self-start md:self-center">
            <button
              onClick={() => setActiveTab("pos")}
              className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
                activeTab === "pos"
                  ? "bg-white text-blue-700 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Đợt Hàng ({pos.length})
            </button>
            <button
              onClick={() => setActiveTab("sku_master")}
              className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
                activeTab === "sku_master"
                  ? "bg-white text-blue-700 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              SKU Master
            </button>
            <button
              onClick={() => setActiveTab("suppliers")}
              className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
                activeTab === "suppliers"
                  ? "bg-white text-blue-700 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Nhà Xưởng ({suppliers.length})
            </button>
          </div>
        </div>

        {/* 5 KPI Metric Cards (Clean, rounded-2xl cards as in design kit) */}
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
          {/* Card 1: Total POs */}
          <div className="rounded-2xl border border-slate-200/80 bg-[#f8fafc]/70 p-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
              Tổng số đợt hàng
            </span>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-2xl font-black text-slate-900">{summary.total_pos}</span>
              <span className="text-xs font-semibold text-slate-500">đợt</span>
            </div>
          </div>

          {/* Card 2: Producing */}
          <div className="rounded-2xl border border-blue-200/80 bg-blue-50/50 p-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700 block flex items-center justify-between">
              Đang sản xuất
              <span className="flex h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
            </span>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-2xl font-black text-blue-900">{summary.total_producing}</span>
              <span className="text-xs font-semibold text-blue-600">đợt</span>
            </div>
          </div>

          {/* Card 3: Shipped */}
          <div className="rounded-2xl border border-purple-200/80 bg-purple-50/50 p-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-purple-700 block">
              Đã xuất xưởng (Ship)
            </span>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-2xl font-black text-purple-900">{summary.total_shipped}</span>
              <span className="text-xs font-semibold text-purple-600">đợt</span>
            </div>
          </div>

          {/* Card 4: Received */}
          <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/50 p-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 block">
              Đã nhận kho FBA
            </span>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-2xl font-black text-emerald-900">{summary.total_received}</span>
              <span className="text-xs font-semibold text-emerald-600">đợt</span>
            </div>
          </div>

          {/* Card 5: Total Cost */}
          <div className="col-span-2 sm:col-span-1 rounded-2xl border border-slate-200/80 bg-gradient-to-br from-slate-900 to-blue-950 p-4 text-white shadow-xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300 block">
              Tổng tiền sản xuất
            </span>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-2xl font-black text-emerald-400">
                ${summary.total_amount.toLocaleString()}
              </span>
            </div>
            <span className="text-[10px] text-slate-400 mt-1 block font-medium">
              SL: {summary.total_quantity.toLocaleString()} pcs
            </span>
          </div>
        </div>
      </div>

      {/* Main Tab Content */}
      {activeTab === "pos" ? (
        <div className="space-y-4">
          {/* Action & Filter Bar */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Store filter */}
              <div className="flex items-center gap-1.5">
                <StorefrontIcon size={15} className="text-blue-600" weight="bold" />
                <select
                  value={selectedStoreId}
                  onChange={(e) => setSelectedStoreId(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-800 focus:outline-none"
                >
                  <option value="">Tất cả Store</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Sup filter */}
              <div className="flex items-center gap-1.5">
                <BuildingsIcon size={15} className="text-blue-600" weight="bold" />
                <select
                  value={selectedSupplierId}
                  onChange={(e) => setSelectedSupplierId(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-800 focus:outline-none"
                >
                  <option value="">Tất cả Sup</option>
                  {suppliers.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name} ({sp.code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Status filter */}
              <div className="flex items-center gap-1.5">
                <FunnelIcon size={15} className="text-slate-500" weight="bold" />
                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none"
                >
                  <option value="">Tất cả Trạng thái</option>
                  <option value="draft">Nháp</option>
                  <option value="pending_sup">Chờ sup nhận</option>
                  <option value="producing">Đang sản xuất</option>
                  <option value="shipped">Đã ship</option>
                  <option value="received">Đã nhận hàng</option>
                  <option value="cancelled">Đã hủy</option>
                </select>
              </div>

              {/* Search */}
              <div className="relative">
                <MagnifyingGlassIcon size={14} className="absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Tìm PO#, Store, Sup..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-52 rounded-xl border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Create PO button */}
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-extrabold text-white shadow-md shadow-blue-500/20 hover:bg-blue-700 transition cursor-pointer self-end lg:self-center"
            >
              <PlusIcon size={15} weight="bold" />
              <span>Tạo Đợt Hàng Mới</span>
            </button>
          </div>

          {/* Table */}
          <div className="rounded-3xl border border-slate-200/90 bg-white shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-[#f8fafc] text-[11px] font-extrabold uppercase text-slate-700 tracking-wider whitespace-nowrap">
                    <th className="px-3.5 py-3.5 w-12 text-center">STT</th>
                    <th className="px-4 py-3.5 w-48">Mã đợt (PO#)</th>
                    <th className="px-3.5 py-3.5 w-32">Store</th>
                    <th className="px-3.5 py-3.5 w-28">Nhà xưởng (Sup)</th>
                    <th className="px-3.5 py-3.5 w-28">Ngày đặt</th>
                    <th className="px-3.5 py-3.5 w-28">Hẹn giao</th>
                    <th className="px-3.5 py-3.5 w-24 text-center">Số dòng</th>
                    <th className="px-3.5 py-3.5 w-28 text-right">Tổng SL</th>
                    <th className="px-3.5 py-3.5 w-32 text-right">Tổng tiền ($)</th>
                    <th className="px-4 py-3.5 w-36 text-center">Trạng thái</th>
                    <th className="px-4 py-3.5 w-28 text-center">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 whitespace-nowrap">
                  {loading ? (
                    <tr>
                      <td colSpan={11} className="py-12 text-center text-slate-400">
                        Đang tải danh sách đợt hàng...
                      </td>
                    </tr>
                  ) : pos.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-12 text-center text-slate-400">
                        Chưa có đợt hàng nào phù hợp bộ lọc. Nhấn <strong>Tạo Đợt Hàng Mới</strong> để bắt đầu.
                      </td>
                    </tr>
                  ) : (
                    pos.map((p, idx) => {
                      const status = PO_STATUS_LABELS[p.status] || PO_STATUS_LABELS.draft;
                      return (
                        <tr
                          key={p.id}
                          onClick={() => setSelectedPoId(p.id)}
                          className="hover:bg-blue-50/40 transition cursor-pointer group"
                        >
                          <td className="px-3.5 py-3 text-center text-slate-400 font-semibold">{idx + 1}</td>
                          <td className="px-4 py-3">
                            <span className="font-extrabold text-blue-700 group-hover:underline">
                              {p.po_number}
                            </span>
                            {p.notes && (
                              <p className="text-[11px] text-slate-400 truncate max-w-xs">{p.notes}</p>
                            )}
                          </td>
                          <td className="px-3.5 py-3 font-bold text-slate-800">{p.store_name}</td>
                          <td className="px-3.5 py-3">
                            <span className="rounded-md bg-slate-100 px-2 py-0.5 font-bold text-slate-700 text-[11px]">
                              {p.supplier_code || p.supplier_name}
                            </span>
                          </td>
                          <td className="px-3.5 py-3 text-slate-600">{p.order_date}</td>
                          <td className="px-3.5 py-3 text-slate-600">{p.target_date || "—"}</td>
                          <td className="px-3.5 py-3 text-center font-semibold text-slate-700">
                            {p.line_count} SKU
                          </td>
                          <td className="px-3.5 py-3 text-right font-extrabold text-slate-900">
                            {p.total_quantity.toLocaleString()} pcs
                          </td>
                          <td className="px-3.5 py-3 text-right font-black text-emerald-700">
                            ${p.total_amount.toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span
                              className={`rounded-full px-3 py-1 text-[11px] font-extrabold uppercase tracking-wide border ${status.bg} ${status.text} ${status.border}`}
                            >
                              {status.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => setSelectedPoId(p.id)}
                                className="rounded-lg p-1.5 text-blue-600 hover:bg-blue-50 transition"
                                title="Mở bảng chi tiết"
                              >
                                <EyeIcon size={16} weight="bold" />
                              </button>
                              <a
                                href={`/api/fulfill/pos/${p.id}/export`}
                                download
                                className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50 transition"
                                title="Xuất file Excel cho sup"
                              >
                                <FileXlsIcon size={16} weight="bold" />
                              </a>
                              <button
                                onClick={(e) => handleDeletePo(e, p.id, p.po_number)}
                                className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition"
                                title="Xóa đợt hàng"
                              >
                                <TrashIcon size={16} />
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
        </div>
      ) : activeTab === "sku_master" ? (
        <SkuMasterView
          stores={stores}
          selectedStoreId={selectedStoreId}
          onSelectStore={(id) => setSelectedStoreId(id)}
        />
      ) : (
        <SuppliersView />
      )}

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
