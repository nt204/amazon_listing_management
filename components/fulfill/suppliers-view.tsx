"use client";

import { useEffect, useState, useCallback } from "react";
import {
  PencilSimpleIcon,
  PlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { FulfillSupplier } from "@/lib/fulfill/types";

export function SuppliersView() {
  const [suppliers, setSuppliers] = useState<FulfillSupplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingSup, setEditingSup] = useState<Partial<FulfillSupplier> | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchSuppliers = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/fulfill/suppliers");
      const data = await res.json();
      if (res.ok) {
        setSuppliers(data.suppliers || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSuppliers();
  }, [fetchSuppliers]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSup?.code || !editingSup?.name) return;

    try {
      setSaving(true);
      const res = await fetch("/api/fulfill/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingSup),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi lưu");
      setEditingSup(null);
      void fetchSuppliers();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header - Spacious, clean */}
      <div className="flex items-center justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs">
        <div>
          <h2 className="text-xl font-black text-slate-900 tracking-tight">
            Danh Sách Nhà Xưởng
          </h2>
          <span className="text-xs font-semibold text-slate-500 mt-1 block">
            Đối tác xưởng sản xuất gia công cho các Store
          </span>
        </div>

        <button
          onClick={() =>
            setEditingSup({
              code: "",
              name: "",
              is_active: true,
            })
          }
          className="inline-flex h-11 items-center gap-2 rounded-full bg-blue-600 px-6 text-sm font-bold text-white shadow-md shadow-blue-500/25 hover:bg-blue-700 transition cursor-pointer"
        >
          <PlusIcon size={16} weight="bold" />
          <span>Thêm Nhà Xưởng</span>
        </button>
      </div>

      {/* Grid of Suppliers Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {loading ? (
          <div className="col-span-full py-16 text-center text-sm font-medium text-slate-400">
            Đang tải danh sách nhà xưởng...
          </div>
        ) : suppliers.length === 0 ? (
          <div className="col-span-full py-16 text-center text-sm text-slate-400">
            Chưa có nhà xưởng nào. Bấm <strong>Thêm Nhà Xưởng</strong> để tạo mới.
          </div>
        ) : (
          suppliers.map((sup) => (
            <div
              key={sup.id}
              className="relative flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs hover:border-blue-400 transition"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-black text-slate-900">{sup.name}</h3>
                    <span className="mt-1 inline-block rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700 border border-blue-200/60">
                      Mã: {sup.code}
                    </span>
                  </div>

                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
                      sup.is_active
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-slate-100 text-slate-500 border border-slate-200"
                    }`}
                  >
                    {sup.is_active ? "Đang hợp tác" : "Tạm ngưng"}
                  </span>
                </div>

                <div className="mt-5 space-y-2.5 text-sm text-slate-600 border-t border-slate-100 pt-4">
                  {sup.contact_name && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase text-slate-400">Liên hệ:</span>
                      <span className="font-semibold text-slate-800">{sup.contact_name}</span>
                    </div>
                  )}
                  {sup.phone && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase text-slate-400">Điện thoại:</span>
                      <span className="font-semibold text-slate-800">{sup.phone}</span>
                    </div>
                  )}
                  {sup.email && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase text-slate-400">Email:</span>
                      <span className="font-semibold text-slate-800 truncate max-w-xs">{sup.email}</span>
                    </div>
                  )}
                  {sup.address && (
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-bold uppercase text-slate-400 shrink-0">Địa chỉ:</span>
                      <span className="font-semibold text-slate-800 text-right">{sup.address}</span>
                    </div>
                  )}
                  {sup.notes && (
                    <p className="text-xs text-slate-500 italic mt-3 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                      &ldquo;{sup.notes}&rdquo;
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">
                <span className="text-sm font-semibold text-slate-500">
                  Tổng đơn: <strong className="text-slate-900 font-bold">{sup.po_count || 0} PO</strong>
                </span>

                <button
                  onClick={() => setEditingSup(sup)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 hover:text-blue-600 transition cursor-pointer"
                >
                  <PencilSimpleIcon size={14} weight="bold" />
                  <span>Sửa</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Edit/Create Modal */}
      {editingSup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-8 shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h3 className="text-xl font-black text-slate-900">
                {editingSup.id ? `Sửa nhà xưởng: ${editingSup.name}` : "Thêm Nhà Xưởng Mới"}
              </h3>
              <button
                onClick={() => setEditingSup(null)}
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer"
              >
                <XIcon size={20} />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold uppercase text-slate-600 block mb-1.5">
                    Mã Sup (Viết tắt)
                  </label>
                  <input
                    type="text"
                    value={editingSup.code || ""}
                    onChange={(e) =>
                      setEditingSup((prev) => ({ ...prev, code: e.target.value.trim().toUpperCase() }))
                    }
                    className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm font-black text-slate-900 uppercase"
                    placeholder="VD: BFF"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-slate-600 block mb-1.5">
                    Tên đầy đủ của xưởng
                  </label>
                  <input
                    type="text"
                    value={editingSup.name || ""}
                    onChange={(e) => setEditingSup((prev) => ({ ...prev, name: e.target.value }))}
                    className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-900"
                    placeholder="VD: Xưởng BFF Bắc Ninh"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold uppercase text-slate-600 block mb-1.5">
                    Người liên hệ
                  </label>
                  <input
                    type="text"
                    value={editingSup.contact_name || ""}
                    onChange={(e) =>
                      setEditingSup((prev) => ({ ...prev, contact_name: e.target.value }))
                    }
                    className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm text-slate-800"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-slate-600 block mb-1.5">
                    Số điện thoại / Zalo
                  </label>
                  <input
                    type="text"
                    value={editingSup.phone || ""}
                    onChange={(e) => setEditingSup((prev) => ({ ...prev, phone: e.target.value }))}
                    className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm text-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold uppercase text-slate-600 block mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  value={editingSup.email || ""}
                  onChange={(e) => setEditingSup((prev) => ({ ...prev, email: e.target.value.trim() }))}
                  className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm text-slate-800"
                />
              </div>

              <div>
                <label className="text-xs font-bold uppercase text-slate-600 block mb-1.5">
                  Địa chỉ xưởng
                </label>
                <input
                  type="text"
                  value={editingSup.address || ""}
                  onChange={(e) => setEditingSup((prev) => ({ ...prev, address: e.target.value }))}
                  className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm text-slate-800"
                />
              </div>

              <div>
                <label className="text-xs font-bold uppercase text-slate-600 block mb-1.5">
                  Ghi chú
                </label>
                <textarea
                  rows={2}
                  value={editingSup.notes || ""}
                  onChange={(e) => setEditingSup((prev) => ({ ...prev, notes: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm text-slate-800"
                  placeholder="Thế mạnh sản phẩm, thời gian làm việc..."
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={editingSup.is_active ?? true}
                    onChange={(e) =>
                      setEditingSup((prev) => ({ ...prev, is_active: e.target.checked }))
                    }
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>Đang hợp tác sản xuất</span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingSup(null)}
                  className="rounded-full px-6 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-full bg-blue-600 px-8 py-2.5 text-sm font-bold text-white shadow-md shadow-blue-500/25 hover:bg-blue-700 transition disabled:opacity-50 cursor-pointer"
                >
                  {saving ? "Đang lưu..." : "Lưu Nhà Xưởng"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
