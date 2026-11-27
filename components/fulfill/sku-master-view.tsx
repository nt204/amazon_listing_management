"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ArrowClockwiseIcon,
  BuildingsIcon,
  CheckCircleIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  PackageIcon,
  PencilSimpleIcon,
  PlusIcon,
  StorefrontIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { FulfillSkuMasterItem } from "@/lib/fulfill/types";

interface SkuMasterViewProps {
  stores: Array<{ id: string; name: string }>;
  selectedStoreId: string;
  onSelectStore: (id: string) => void;
}

export function SkuMasterView({ stores, selectedStoreId, onSelectStore }: SkuMasterViewProps) {
  const [items, setItems] = useState<FulfillSkuMasterItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Edit / Add modal
  const [editingItem, setEditingItem] = useState<Partial<FulfillSkuMasterItem> | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedStoreId) params.set("storeId", selectedStoreId);
      if (searchTerm.trim()) params.set("search", searchTerm.trim());

      const res = await fetch(`/api/fulfill/sku-master?${params.toString()}`);
      const data = await res.json();
      if (res.ok) {
        setItems(data.items || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedStoreId, searchTerm]);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  // Sync from Accounting SKU Master
  const handleSyncFromAccounting = async () => {
    try {
      setSyncing(true);
      setMessage(null);
      const res = await fetch("/api/fulfill/sku-master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync", store_id: selectedStoreId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi đồng bộ");
      setMessage({ type: "success", text: data.message || "Đồng bộ thành công!" });
      void fetchItems();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "Đồng bộ thất bại" });
    } finally {
      setSyncing(false);
    }
  };

  // Save Item
  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem?.store_id || !editingItem?.sku) return;

    try {
      setSaving(true);
      const res = await fetch("/api/fulfill/sku-master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingItem),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi lưu");
      setEditingItem(null);
      void fetchItems();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs">
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Store select */}
          <div className="flex items-center gap-1.5">
            <StorefrontIcon size={16} className="text-blue-600" weight="bold" />
            <select
              value={selectedStoreId}
              onChange={(e) => onSelectStore(e.target.value)}
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

          {/* Search box */}
          <div className="relative">
            <MagnifyingGlassIcon size={14} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Tìm SKU, ASIN..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-56 rounded-xl border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Sync Button */}
          <button
            onClick={handleSyncFromAccounting}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition shadow-2xs disabled:opacity-50"
            title="Tự động đồng bộ các SKU và giá vốn từ Bảng Mã Kế toán"
          >
            <ArrowClockwiseIcon size={14} weight="bold" className={syncing ? "animate-spin" : ""} />
            <span>{syncing ? "Đang đồng bộ..." : "Đồng bộ từ Bảng Mã"}</span>
          </button>

          {/* Add SKU */}
          <button
            onClick={() =>
              setEditingItem({
                store_id: selectedStoreId || stores[0]?.id || "",
                sku: "",
                pcs_per_box: 1,
                basecost: 0,
                fee_card: 0,
                fee_tag: 0,
                fee_stand: 0,
                fee_box: 0,
              })
            }
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-md shadow-blue-500/20 hover:bg-blue-700 transition"
          >
            <PlusIcon size={14} weight="bold" />
            <span>Thêm SKU</span>
          </button>
        </div>
      </div>

      {message && (
        <div
          className={`flex items-center justify-between rounded-xl p-3 text-xs font-semibold ${
            message.type === "success"
              ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border border-red-200 bg-red-50 text-red-700"
          }`}
        >
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)}>
            <XIcon size={14} />
          </button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-3xl border border-slate-200/90 bg-white shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-[#f8fafc] text-[11px] font-extrabold uppercase text-slate-700 tracking-wider whitespace-nowrap">
                <th className="px-3 py-3 w-10 text-center">STT</th>
                <th className="px-3 py-3 w-28">Store</th>
                <th className="px-3 py-3 w-36">SKU</th>
                <th className="px-3 py-3 w-28">ASIN</th>
                <th className="px-3 py-3 w-28">FNSKU</th>
                <th className="px-3 py-3 w-32">Phôi (Type)</th>
                <th className="px-3 py-3 w-24">Kích thước</th>
                <th className="px-3 py-3 w-20 text-right">SL/Thùng</th>
                <th className="px-3 py-3 w-24 text-right">Basecost ($)</th>
                <th className="px-3 py-3 w-24 text-right">Card/Tag/Box</th>
                <th className="px-3 py-3 w-32">Link Thiết kế</th>
                <th className="px-3 py-3 w-32">Link Card</th>
                <th className="px-3 py-3 w-32">Link Box</th>
                <th className="px-3 py-3 w-12 text-center">Sửa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 whitespace-nowrap">
              {loading ? (
                <tr>
                  <td colSpan={14} className="py-12 text-center text-slate-400">
                    Đang tải danh sách SKU Master...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={14} className="py-12 text-center text-slate-400">
                    Chưa có SKU nào trong danh mục. Nhấn <strong>Đồng bộ từ Bảng Mã</strong> để lấy dữ liệu có sẵn.
                  </td>
                </tr>
              ) : (
                items.map((item, idx) => {
                  const extraFees =
                    Number(item.fee_card || 0) +
                    Number(item.fee_tag || 0) +
                    Number(item.fee_stand || 0) +
                    Number(item.fee_box || 0);

                  return (
                    <tr key={item.id} className="hover:bg-slate-50 transition">
                      <td className="px-3 py-2.5 text-center text-slate-400 font-semibold">{idx + 1}</td>
                      <td className="px-3 py-2.5 font-bold text-slate-800">{item.store_name}</td>
                      <td className="px-3 py-2.5 font-black text-blue-700">{item.sku}</td>
                      <td className="px-3 py-2.5 text-slate-600">{item.asin || "—"}</td>
                      <td className="px-3 py-2.5 text-slate-600">{item.fnsku || "—"}</td>
                      <td className="px-3 py-2.5 text-slate-700">{item.product_name || "—"}</td>
                      <td className="px-3 py-2.5 text-slate-700">{item.dimensions || "—"}</td>
                      <td className="px-3 py-2.5 text-right font-bold text-slate-800">{item.pcs_per_box}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-slate-900">
                        ${item.basecost.toFixed(2)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium text-slate-500">
                        ${extraFees.toFixed(2)}
                      </td>
                      <td className="px-3 py-2.5">
                        {item.design_url ? (
                          <a
                            href={item.design_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 font-medium hover:underline truncate max-w-[120px] block"
                          >
                            Xem link
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {item.card_url ? (
                          <a
                            href={item.card_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 font-medium hover:underline truncate max-w-[120px] block"
                          >
                            Xem link
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {item.box_url ? (
                          <a
                            href={item.box_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 font-medium hover:underline truncate max-w-[120px] block"
                          >
                            Xem link
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          onClick={() => setEditingItem(item)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition"
                        >
                          <PencilSimpleIcon size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit / Add Modal */}
      {editingItem && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h3 className="text-base font-extrabold text-slate-900">
                {editingItem.id ? `Chỉnh sửa SKU: ${editingItem.sku}` : "Thêm SKU mới"}
              </h3>
              <button
                onClick={() => setEditingItem(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <XIcon size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveItem} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Store *</label>
                  <select
                    value={editingItem.store_id || ""}
                    onChange={(e) => setEditingItem({ ...editingItem, store_id: e.target.value })}
                    required
                    className="w-full rounded-xl border border-slate-300 p-2 text-xs font-semibold"
                  >
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">SKU *</label>
                  <input
                    type="text"
                    value={editingItem.sku || ""}
                    onChange={(e) => setEditingItem({ ...editingItem, sku: e.target.value.toUpperCase() })}
                    required
                    className="w-full rounded-xl border border-slate-300 p-2 text-xs font-bold"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Phôi (Product Type)</label>
                  <input
                    type="text"
                    value={editingItem.product_name || ""}
                    onChange={(e) => setEditingItem({ ...editingItem, product_name: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 p-2 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Kích thước</label>
                  <input
                    type="text"
                    value={editingItem.dimensions || ""}
                    onChange={(e) => setEditingItem({ ...editingItem, dimensions: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 p-2 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">ASIN</label>
                  <input
                    type="text"
                    value={editingItem.asin || ""}
                    onChange={(e) => setEditingItem({ ...editingItem, asin: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 p-2 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">FNSKU</label>
                  <input
                    type="text"
                    value={editingItem.fnsku || ""}
                    onChange={(e) => setEditingItem({ ...editingItem, fnsku: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 p-2 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Số cái / Thùng</label>
                  <input
                    type="number"
                    value={editingItem.pcs_per_box || 1}
                    onChange={(e) => setEditingItem({ ...editingItem, pcs_per_box: Number(e.target.value) || 1 })}
                    className="w-full rounded-xl border border-slate-300 p-2 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Basecost ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editingItem.basecost || 0}
                    onChange={(e) => setEditingItem({ ...editingItem, basecost: Number(e.target.value) || 0 })}
                    className="w-full rounded-xl border border-slate-300 p-2 text-xs font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Link Thiết Kế (Design)</label>
                  <input
                    type="text"
                    placeholder="https://..."
                    value={editingItem.design_url || ""}
                    onChange={(e) => setEditingItem({ ...editingItem, design_url: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 p-2 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Link Card</label>
                  <input
                    type="text"
                    placeholder="https://..."
                    value={editingItem.card_url || ""}
                    onChange={(e) => setEditingItem({ ...editingItem, card_url: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 p-2 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Link Tag</label>
                  <input
                    type="text"
                    placeholder="https://..."
                    value={editingItem.tag_url || ""}
                    onChange={(e) => setEditingItem({ ...editingItem, tag_url: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 p-2 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Link Box</label>
                  <input
                    type="text"
                    placeholder="https://..."
                    value={editingItem.box_url || ""}
                    onChange={(e) => setEditingItem({ ...editingItem, box_url: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 p-2 text-xs"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-blue-600 px-5 py-2 text-xs font-extrabold text-white shadow-md shadow-blue-500/20 hover:bg-blue-700"
                >
                  {saving ? "Đang lưu..." : "Lưu SKU"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
