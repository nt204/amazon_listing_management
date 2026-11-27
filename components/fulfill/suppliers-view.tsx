"use client";

import { useEffect, useState, useCallback } from "react";
import {
  BuildingsIcon,
  CheckCircleIcon,
  EnvelopeIcon,
  MapPinIcon,
  PencilSimpleIcon,
  PhoneIcon,
  PlusIcon,
  UserIcon,
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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs">
        <div>
          <h2 className="text-sm font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <BuildingsIcon size={18} className="text-blue-600" weight="bold" />
            Danh sách Nhà Xưởng (Suppliers)
          </h2>
          <p className="text-xs text-slate-500">Quản lý đối tác xưởng sản xuất gia công cho các Store</p>
        </div>

        <button
          onClick={() =>
            setEditingSup({
              code: "",
              name: "",
              is_active: true,
            })
          }
          className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-md shadow-blue-500/20 hover:bg-blue-700 transition"
        >
          <PlusIcon size={14} weight="bold" />
          <span>Thêm Nhà Xưởng</span>
        </button>
      </div>

      {/* Grid of Suppliers Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-full py-12 text-center text-xs text-slate-400">
            Đang tải danh sách nhà xưởng...
          </div>
        ) : suppliers.length === 0 ? (
          <div className="col-span-full py-12 text-center text-xs text-slate-400">
            Chưa có nhà xưởng nào. Nhấn <strong>Thêm Nhà Xưởng</strong> để tạo mới.
          </div>
        ) : (
          suppliers.map((sup) => (
            <div
              key={sup.id}
              className="relative flex flex-col justify-between rounded-3xl border border-slate-200/90 bg-white p-5 shadow-xs hover:border-blue-300 transition"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 font-black text-white shadow-md shadow-blue-500/20 text-sm">
                      {sup.code.slice(0, 3)}
                    </div>
                    <div>
                      <h3 className="text-sm font-extrabold text-slate-900">{sup.name}</h3>
                      <span className="text-[11px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md inline-block mt-0.5">
                        Mã: {sup.code}
                      </span>
                    </div>
                  </div>

                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
                      sup.is_active
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-slate-100 text-slate-500 border border-slate-200"
                    }`}
                  >
                    {sup.is_active ? "Đang hợp tác" : "Tạm ngưng"}
                  </span>
                </div>

                <div className="mt-4 space-y-2 text-xs text-slate-600 border-t border-slate-100 pt-3">
                  {sup.contact_name && (
                    <div className="flex items-center gap-2">
                      <UserIcon size={14} className="text-slate-400 shrink-0" />
                      <span>{sup.contact_name}</span>
                    </div>
                  )}
                  {sup.phone && (
                    <div className="flex items-center gap-2">
                      <PhoneIcon size={14} className="text-slate-400 shrink-0" />
                      <span>{sup.phone}</span>
                    </div>
                  )}
                  {sup.email && (
                    <div className="flex items-center gap-2">
                      <EnvelopeIcon size={14} className="text-slate-400 shrink-0" />
                      <span className="truncate">{sup.email}</span>
                    </div>
                  )}
                  {sup.address && (
                    <div className="flex items-center gap-2">
                      <MapPinIcon size={14} className="text-slate-400 shrink-0" />
                      <span className="truncate">{sup.address}</span>
                    </div>
                  )}
                  {sup.notes && (
                    <p className="text-[11px] text-slate-500 italic mt-2 line-clamp-2">
                      &ldquo;{sup.notes}&rdquo;
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-3">
                <span className="text-xs font-semibold text-slate-500">
                  Tổng đơn PO: <strong className="text-slate-800">{sup.po_count || 0}</strong>
                </span>

                <button
                  onClick={() => setEditingSup(sup)}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 hover:text-blue-600 transition"
                >
                  <PencilSimpleIcon size={13} weight="bold" />
                  <span>Sửa</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Edit / Add Modal */}
      {editingSup && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-extrabold text-slate-900">
                {editingSup.id ? `Sửa thông tin: ${editingSup.name}` : "Thêm Nhà Xưởng mới"}
              </h3>
              <button
                onClick={() => setEditingSup(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <XIcon size={18} />
              </button>
            </div>

            <form onSubmit={handleSave} className="mt-4 space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Mã xưởng (Code) *</label>
                  <input
                    type="text"
                    placeholder="VD: BFF"
                    value={editingSup.code || ""}
                    onChange={(e) => setEditingSup({ ...editingSup, code: e.target.value.toUpperCase() })}
                    required
                    className="w-full rounded-xl border border-slate-300 p-2 text-xs font-extrabold uppercase"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Tên xưởng *</label>
                  <input
                    type="text"
                    placeholder="VD: Xưởng BFF"
                    value={editingSup.name || ""}
                    onChange={(e) => setEditingSup({ ...editingSup, name: e.target.value })}
                    required
                    className="w-full rounded-xl border border-slate-300 p-2 text-xs font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Người phụ trách liên hệ</label>
                  <input
                    type="text"
                    value={editingSup.contact_name || ""}
                    onChange={(e) => setEditingSup({ ...editingSup, contact_name: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 p-2 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Số điện thoại</label>
                  <input
                    type="text"
                    value={editingSup.phone || ""}
                    onChange={(e) => setEditingSup({ ...editingSup, phone: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 p-2 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  value={editingSup.email || ""}
                  onChange={(e) => setEditingSup({ ...editingSup, email: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 p-2 text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Địa chỉ nhà xưởng</label>
                <input
                  type="text"
                  value={editingSup.address || ""}
                  onChange={(e) => setEditingSup({ ...editingSup, address: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 p-2 text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Ghi chú</label>
                <textarea
                  rows={2}
                  value={editingSup.notes || ""}
                  onChange={(e) => setEditingSup({ ...editingSup, notes: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 p-2 text-xs"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="sup-active"
                  checked={editingSup.is_active ?? true}
                  onChange={(e) => setEditingSup({ ...editingSup, is_active: e.target.checked })}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="sup-active" className="text-xs font-semibold text-slate-700">
                  Đang hợp tác / Nhận đơn sản xuất
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingSup(null)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-blue-600 px-5 py-2 text-xs font-extrabold text-white shadow-md shadow-blue-500/20 hover:bg-blue-700"
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
