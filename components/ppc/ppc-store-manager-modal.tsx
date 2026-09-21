"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Storefront,
  X,
  Plus,
  PencilSimple,
  Trash,
  CheckCircle,
  WarningCircle,
  ArrowsClockwise,
  Table,
  CurrencyDollar,
  Percent,
} from "@phosphor-icons/react";
import type { PpcStore } from "@/lib/ppc/types";
import { PpcAddStoreModal } from "./ppc-add-store-modal";

interface PpcStoreManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStoreSelected?: (storeName: string) => void;
  onNavigateToCostMaster?: (storeName: string) => void;
}

export function PpcStoreManagerModal({
  isOpen,
  onClose,
  onStoreSelected,
  onNavigateToCostMaster,
}: PpcStoreManagerModalProps) {
  const [stores, setStores] = useState<PpcStore[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Add / Edit Modal state
  const [isAddEditOpen, setIsAddEditOpen] = useState(false);
  const [storeToEdit, setStoreToEdit] = useState<PpcStore | null>(null);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadStores = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/ppc/stores", { cache: "no-store" });
      if (!res.ok) throw new Error("Không thể tải danh sách store.");
      const json = await res.json();
      if (json?.data) {
        setStores(json.data);
      }
    } catch (err: any) {
      setError(err.message || "Lỗi khi tải danh sách store.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void loadStores();
      setError(null);
      setSuccess(null);
    }
  }, [isOpen, loadStores]);

  if (!isOpen) return null;

  const handleOpenAdd = () => {
    setStoreToEdit(null);
    setIsAddEditOpen(true);
  };

  const handleOpenEdit = (store: PpcStore) => {
    setStoreToEdit(store);
    setIsAddEditOpen(true);
  };

  const handleDeleteStore = async (store: PpcStore) => {
    if (store.name.toUpperCase() === "HSOSTORE") {
      alert("Không thể xóa store mặc định HSOSTORE.");
      return;
    }

    const confirmMsg = `Bạn có chắc chắn muốn xóa store "${store.name}"?\n\nLưu ý: Bảng phôi (Cost Master) của store này cũng sẽ bị xóa.`;
    if (!window.confirm(confirmMsg)) return;

    try {
      setDeletingId(store.id);
      setError(null);
      setSuccess(null);

      const res = await fetch(`/api/ppc/stores?id=${encodeURIComponent(store.id)}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Không thể xóa store.");
      }

      setSuccess(`Đã xóa store "${store.name}" thành công!`);
      await loadStores();
    } catch (err: any) {
      setError(err.message || "Lỗi khi xóa store.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 p-5 bg-gradient-to-r from-slate-50 to-indigo-50/30">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-600 text-white shadow-xs">
              <Storefront size={24} weight="duotone" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900 tracking-tight">
                Quản Lý Danh Sách Store
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Thêm mới, điều chỉnh Target ACoS, hoặc quản lý phôi riêng biệt cho từng Store
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleOpenAdd}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs shadow-xs transition cursor-pointer"
            >
              <Plus size={14} weight="bold" />
              <span>Thêm Store</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 transition cursor-pointer"
            >
              <X size={20} weight="bold" />
            </button>
          </div>
        </div>

        {/* Feedback Messages */}
        {error && (
          <div className="mx-6 mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2 font-semibold">
            <WarningCircle size={16} weight="fill" className="shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="mx-6 mt-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-2 font-semibold">
            <CheckCircle size={16} weight="fill" className="shrink-0" />
            <span>{success}</span>
          </div>
        )}

        {/* Store Table */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading && stores.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-xs">
              <ArrowsClockwise size={28} className="animate-spin mx-auto mb-2 text-indigo-500" />
              Đang tải danh sách store...
            </div>
          ) : stores.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-xs">
              Chưa có store nào trong hệ thống.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-3 w-12 text-center">#</th>
                    <th className="p-3">Tên Store</th>
                    <th className="p-3 w-32">Thị Trường</th>
                    <th className="p-3 w-32">Target ACoS</th>
                    <th className="p-3 w-32">Trạng Thái</th>
                    <th className="p-3 w-44 text-center">Thao Tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stores.map((store, index) => {
                    const isDefault = store.name.toUpperCase() === "HSOSTORE";
                    const isDeleting = deletingId === store.id;

                    return (
                      <tr key={store.id} className="hover:bg-slate-50/80 transition">
                        <td className="p-3 text-center font-bold text-slate-400">
                          {index + 1}
                        </td>
                        <td className="p-3 font-bold text-slate-900">
                          <div className="flex items-center gap-2">
                            <span>{store.name}</span>
                            {isDefault && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                MẶC ĐỊNH
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3">
                          <span className="inline-flex items-center gap-1 font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                            {store.marketplace}
                          </span>
                        </td>
                        <td className="p-3 font-bold text-indigo-700">
                          {store.targetAcos}%
                        </td>
                        <td className="p-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                              store.status === "ACTIVE"
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : "bg-amber-50 text-amber-700 border border-amber-200"
                            }`}
                          >
                            {store.status === "ACTIVE" ? "Hoạt Động" : "Tạm Dừng"}
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            {/* Nút Điền Phôi */}
                            {onNavigateToCostMaster && (
                              <button
                                type="button"
                                onClick={() => {
                                  onNavigateToCostMaster(store.name);
                                  onClose();
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-bold text-[11px] transition cursor-pointer"
                                title="Mở bảng phôi để điền giá vốn cho shop này"
                              >
                                <Table size={13} weight="bold" />
                                <span>Phôi</span>
                              </button>
                            )}

                            {/* Nút Sửa */}
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(store)}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition cursor-pointer"
                              title="Chỉnh sửa thông số store"
                            >
                              <PencilSimple size={15} weight="bold" />
                            </button>

                            {/* Nút Xóa */}
                            <button
                              type="button"
                              onClick={() => void handleDeleteStore(store)}
                              disabled={isDefault || isDeleting}
                              className={`p-1.5 rounded-lg transition ${
                                isDefault
                                  ? "text-slate-300 cursor-not-allowed"
                                  : "text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                              }`}
                              title={isDefault ? "Không thể xóa store mặc định" : "Xóa store này"}
                            >
                              <Trash size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-100 bg-slate-50/50 text-xs">
          <span className="text-slate-500">
            Tổng cộng: <strong className="text-slate-800 font-bold">{stores.length}</strong> store
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 font-bold text-slate-700 transition cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>

      {/* Modal Thêm / Sửa Store */}
      <PpcAddStoreModal
        isOpen={isAddEditOpen}
        onClose={() => setIsAddEditOpen(false)}
        storeToEdit={storeToEdit}
        onStoreCreated={async (newStore) => {
          await loadStores();
          setSuccess(`Đã tạo store "${newStore.name}" thành công! Bảng phôi trắng đã sẵn sàng.`);
          if (onStoreSelected) onStoreSelected(newStore.name);
        }}
        onStoreUpdated={async (updatedStore) => {
          await loadStores();
          setSuccess(`Đã cập nhật store "${updatedStore.name}" thành công!`);
        }}
      />
    </div>
  );
}
