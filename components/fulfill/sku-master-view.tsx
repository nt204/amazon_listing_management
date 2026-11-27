"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ArrowClockwiseIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
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
    <div className="space-y-6">
      {/* Action Header - Clean, spacious */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Store select */}
          <select
            value={selectedStoreId}
            onChange={(e) => onSelectStore(e.target.value)}
            className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 cursor-pointer"
          >
            <option value="">Tất cả Store</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          {/* Search box */}
          <div className="relative">
            <MagnifyingGlassIcon size={16} className="absolute left-3.5 top-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Tìm SKU, ASIN, FNSKU..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-11 w-64 rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Sync Button */}
          <button
            onClick={handleSyncFromAccounting}
            disabled={syncing}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-5 text-sm font-bold text-blue-700 hover:bg-blue-100 transition shadow-2xs disabled:opacity-50 cursor-pointer"
            title="Tự động đồng bộ các SKU và giá vốn từ Bảng Mã Kế toán"
          >
            <ArrowClockwiseIcon size={16} weight="bold" className={syncing ? "animate-spin" : ""} />
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
            className="inline-flex h-11 items-center gap-2 rounded-full bg-blue-600 px-6 text-sm font-bold text-white shadow-md shadow-blue-500/25 hover:bg-blue-700 transition cursor-pointer"
          >
            <PlusIcon size={16} weight="bold" />
            <span>Thêm SKU</span>
          </button>
        </div>
      </div>

      {message && (
        <div
          className={`flex items-center justify-between rounded-xl p-3.5 text-sm font-semibold ${
            message.type === "success"
              ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border border-red-200 bg-red-50 text-red-700"
          }`}
        >
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)} className="cursor-pointer">
            <XIcon size={16} />
          </button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-2xl border border-slate-200/90 bg-white shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase text-slate-600 tracking-wider whitespace-nowrap">
                <th className="px-4 py-4 w-12 text-center">STT</th>
                <th className="px-4 py-4 w-32">Store</th>
                <th className="px-4 py-4 w-44">SKU</th>
                <th className="px-4 py-4 w-32">ASIN</th>
                <th className="px-4 py-4 w-32">FNSKU</th>
                <th className="px-4 py-4 w-36">Phôi (Type)</th>
                <th className="px-4 py-4 w-28">Kích thước</th>
                <th className="px-4 py-4 w-24 text-right">SL/Thùng</th>
                <th className="px-4 py-4 w-28 text-right">Basecost ($)</th>
                <th className="px-4 py-4 w-32 text-right">Phí đóng gói</th>
                <th className="px-4 py-4 w-36">Link Thiết kế</th>
                <th className="px-4 py-4 w-32">Link Card</th>
                <th className="px-4 py-4 w-32">Link Box</th>
                <th className="px-4 py-4 w-16 text-center">Sửa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 whitespace-nowrap">
              {loading ? (
                <tr>
                  <td colSpan={14} className="py-16 text-center text-slate-400 font-medium">
                    Đang tải danh sách SKU Master...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={14} className="py-16 text-center text-slate-400 font-medium">
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
                      <td className="px-4 py-3.5 text-center text-slate-400 font-semibold">{idx + 1}</td>
                      <td className="px-4 py-3.5 font-bold text-slate-800">{item.store_name}</td>
                      <td className="px-4 py-3.5 font-black text-blue-600">{item.sku}</td>
                      <td className="px-4 py-3.5 text-slate-600 font-medium">{item.asin || "—"}</td>
                      <td className="px-4 py-3.5 text-slate-600 font-medium">{item.fnsku || "—"}</td>
                      <td className="px-4 py-3.5 text-slate-700">{item.product_name || "—"}</td>
                      <td className="px-4 py-3.5 text-slate-700">{item.dimensions || "—"}</td>
                      <td className="px-4 py-3.5 text-right font-bold text-slate-800">{item.pcs_per_box}</td>
                      <td className="px-4 py-3.5 text-right font-bold text-slate-900">
                        ${item.basecost.toFixed(2)}
                      </td>
                      <td className="px-4 py-3.5 text-right text-slate-600 font-medium">
                        ${extraFees.toFixed(2)}
                      </td>
                      <td className="px-4 py-3.5">
                        {item.design_url ? (
                          <a
                            href={item.design_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-block rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100 transition"
                          >
                            Thiết kế ↗
                          </a>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        {item.card_url ? (
                          <a
                            href={item.card_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-block rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition"
                          >
                            Card ↗
                          </a>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        {item.box_url ? (
                          <a
                            href={item.box_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-block rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-200 transition"
                          >
                            Box ↗
                          </a>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <button
                          onClick={() => setEditingItem(item)}
                          className="rounded-lg p-2 text-slate-500 hover:bg-blue-50 hover:text-blue-600 transition cursor-pointer"
                          title="Sửa thông số SKU"
                        >
                          <PencilSimpleIcon size={16} weight="bold" />
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

      {/* Edit/Create Modal */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-2xl rounded-3xl bg-white p-8 shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h3 className="text-xl font-black text-slate-900">
                {editingItem.id ? `Chỉnh sửa SKU: ${editingItem.sku}` : "Thêm SKU Master Mới"}
              </h3>
              <button
                onClick={() => setEditingItem(null)}
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer"
              >
                <XIcon size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveItem} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold uppercase text-slate-600 block mb-1.5">
                    Store
                  </label>
                  <select
                    value={editingItem.store_id || ""}
                    onChange={(e) => setEditingItem((prev) => ({ ...prev, store_id: e.target.value }))}
                    className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-800"
                    required
                  >
                    <option value="">Chọn Store</option>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold uppercase text-slate-600 block mb-1.5">
                    Mã SKU
                  </label>
                  <input
                    type="text"
                    value={editingItem.sku || ""}
                    onChange={(e) =>
                      setEditingItem((prev) => ({ ...prev, sku: e.target.value.trim().toUpperCase() }))
                    }
                    className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-900 uppercase"
                    placeholder="VD: MTL24052503PQ"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-xs font-bold uppercase text-slate-600 block mb-1.5">
                    ASIN
                  </label>
                  <input
                    type="text"
                    value={editingItem.asin || ""}
                    onChange={(e) => setEditingItem((prev) => ({ ...prev, asin: e.target.value.trim() }))}
                    className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-800"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-slate-600 block mb-1.5">
                    FNSKU
                  </label>
                  <input
                    type="text"
                    value={editingItem.fnsku || ""}
                    onChange={(e) => setEditingItem((prev) => ({ ...prev, fnsku: e.target.value.trim() }))}
                    className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-800"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-slate-600 block mb-1.5">
                    SL cái / thùng
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={editingItem.pcs_per_box || 1}
                    onChange={(e) =>
                      setEditingItem((prev) => ({ ...prev, pcs_per_box: Number(e.target.value) || 1 }))
                    }
                    className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-800"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold uppercase text-slate-600 block mb-1.5">
                    Phôi (Product Type)
                  </label>
                  <input
                    type="text"
                    value={editingItem.product_name || ""}
                    onChange={(e) =>
                      setEditingItem((prev) => ({ ...prev, product_name: e.target.value }))
                    }
                    className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-800"
                    placeholder="VD: 14oz Tumbler"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-slate-600 block mb-1.5">
                    Kích thước
                  </label>
                  <input
                    type="text"
                    value={editingItem.dimensions || ""}
                    onChange={(e) =>
                      setEditingItem((prev) => ({ ...prev, dimensions: e.target.value }))
                    }
                    className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-800"
                    placeholder="VD: 20x15x10cm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-xs font-bold uppercase text-slate-600 block mb-1.5">
                    Basecost ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={editingItem.basecost || 0}
                    onChange={(e) =>
                      setEditingItem((prev) => ({ ...prev, basecost: Number(e.target.value) || 0 }))
                    }
                    className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm font-extrabold text-slate-900"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-slate-600 block mb-1.5">
                    Phí Card ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={editingItem.fee_card || 0}
                    onChange={(e) =>
                      setEditingItem((prev) => ({ ...prev, fee_card: Number(e.target.value) || 0 }))
                    }
                    className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm text-slate-700"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-slate-600 block mb-1.5">
                    Phí Box ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={editingItem.fee_box || 0}
                    onChange={(e) =>
                      setEditingItem((prev) => ({ ...prev, fee_box: Number(e.target.value) || 0 }))
                    }
                    className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm text-slate-700"
                  />
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <div>
                  <label className="text-xs font-bold uppercase text-slate-600 block mb-1.5">
                    Link Thiết Kế (Dropbox / Drive)
                  </label>
                  <input
                    type="url"
                    value={editingItem.design_url || ""}
                    onChange={(e) =>
                      setEditingItem((prev) => ({ ...prev, design_url: e.target.value.trim() }))
                    }
                    className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm text-blue-600"
                    placeholder="https://dropbox.com/..."
                  />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-slate-600 block mb-1.5">
                    Link Card
                  </label>
                  <input
                    type="url"
                    value={editingItem.card_url || ""}
                    onChange={(e) =>
                      setEditingItem((prev) => ({ ...prev, card_url: e.target.value.trim() }))
                    }
                    className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm text-blue-600"
                    placeholder="https://..."
                  />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-slate-600 block mb-1.5">
                    Link Box
                  </label>
                  <input
                    type="url"
                    value={editingItem.box_url || ""}
                    onChange={(e) =>
                      setEditingItem((prev) => ({ ...prev, box_url: e.target.value.trim() }))
                    }
                    className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm text-blue-600"
                    placeholder="https://..."
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="rounded-full px-6 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-full bg-blue-600 px-8 py-2.5 text-sm font-bold text-white shadow-md shadow-blue-500/25 hover:bg-blue-700 transition disabled:opacity-50 cursor-pointer"
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
