"use client";

import React, { useState, useEffect } from "react";
import {
  Storefront,
  X,
  CheckCircle,
  Percent,
  Sparkle,
  WarningCircle,
} from "@phosphor-icons/react";
import type { PpcStore } from "@/lib/ppc/types";

interface PpcAddStoreModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStoreCreated?: (store: PpcStore) => void;
  onStoreUpdated?: (store: PpcStore) => void;
  storeToEdit?: PpcStore | null;
}

const MARKETPLACES = [
  { code: "US", name: "United States (.com)", currency: "$" },
  { code: "CA", name: "Canada (.ca)", currency: "CA$" },
  { code: "MX", name: "Mexico (.com.mx)", currency: "MX$" },
  { code: "UK", name: "United Kingdom (.co.uk)", currency: "£" },
  { code: "DE", name: "Germany (.de)", currency: "€" },
  { code: "FR", name: "France (.fr)", currency: "€" },
  { code: "IT", name: "Italy (.it)", currency: "€" },
  { code: "ES", name: "Spain (.es)", currency: "€" },
  { code: "JP", name: "Japan (.co.jp)", currency: "¥" },
  { code: "AU", name: "Australia (.com.au)", currency: "A$" },
];

export function PpcAddStoreModal({
  isOpen,
  onClose,
  onStoreCreated,
  onStoreUpdated,
  storeToEdit,
}: PpcAddStoreModalProps) {
  const isEditing = Boolean(storeToEdit);
  const [name, setName] = useState("");
  const [marketplace, setMarketplace] = useState("US");
  const [targetAcos, setTargetAcos] = useState("30.0");
  const [status, setStatus] = useState<"ACTIVE" | "PAUSED">("ACTIVE");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset or populate form when modal opens or storeToEdit changes
  useEffect(() => {
    if (isOpen) {
      if (storeToEdit) {
        setName(storeToEdit.name);
        setMarketplace(storeToEdit.marketplace || "US");
        setTargetAcos(String(storeToEdit.targetAcos ?? "30.0"));
        setStatus(storeToEdit.status || "ACTIVE");
      } else {
        setName("");
        setMarketplace("US");
        setTargetAcos("30.0");
        setStatus("ACTIVE");
      }
      setError(null);
    }
  }, [isOpen, storeToEdit]);

  // Handle ESC key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Vui lòng nhập tên store.");
      return;
    }
    if (trimmedName.toUpperCase() === "ALL") {
      setError("Tên 'ALL' là từ khóa hệ thống, vui lòng chọn tên khác.");
      return;
    }
    if (/[/\\?%*:|"<>#]/.test(trimmedName)) {
      setError("Tên store không được chứa ký tự đặc biệt (/ \\ ? % * : | \" < > #).");
      return;
    }

    const parsedAcos = parseFloat(targetAcos.replace(",", "."));
    if (isNaN(parsedAcos) || parsedAcos <= 0 || parsedAcos > 200) {
      setError("Target ACoS phải từ 1% đến 200%.");
      return;
    }

    try {
      setIsSubmitting(true);
      if (isEditing && storeToEdit) {
        // Cập nhật store
        const res = await fetch("/api/ppc/stores", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: storeToEdit.id,
            name: trimmedName,
            marketplace,
            targetAcos: parsedAcos,
            status,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || "Không thể cập nhật store.");
        }
        if (onStoreUpdated) onStoreUpdated(data.data);
      } else {
        // Tạo store mới
        const res = await fetch("/api/ppc/stores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: trimmedName,
            marketplace,
            targetAcos: parsedAcos,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || "Không thể tạo store mới.");
        }
        if (onStoreCreated) onStoreCreated(data.data);
      }

      onClose();
    } catch (err: any) {
      setError(err.message || "Đã xảy ra lỗi khi lưu store.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 p-5 bg-gradient-to-r from-slate-50 to-indigo-50/30">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-600 text-white shadow-xs">
              <Storefront size={22} weight="duotone" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900 tracking-tight">
                {isEditing ? "Chỉnh Sửa Store" : "Thêm Store Mới"}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {isEditing
                  ? `Cập nhật thông số cho store ${storeToEdit?.name}`
                  : "Khởi tạo store Amazon mới cho hệ thống quản lý PPC"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 transition cursor-pointer"
          >
            <X size={18} weight="bold" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 font-semibold text-xs">
              <WarningCircle size={18} weight="fill" className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Store Name */}
          <div>
            <label className="block text-slate-700 font-bold mb-1.5">
              Tên Store <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VD: STORE_UK, HSOSTORE_CA, STORE_B..."
              className="w-full px-3.5 py-2.5 bg-slate-50 hover:bg-white focus:bg-white border border-slate-200 focus:border-indigo-600 rounded-xl outline-none font-bold text-slate-900 transition text-xs shadow-2xs"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Định danh duy nhất hiển thị trên báo cáo và các file Bulksheet.
            </p>
          </div>

          {/* Marketplace */}
          <div>
            <label className="block text-slate-700 font-bold mb-1.5">
              Thị Trường Amazon (Marketplace) <span className="text-rose-500">*</span>
            </label>
            <select
              value={marketplace}
              onChange={(e) => setMarketplace(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 hover:bg-white focus:bg-white border border-slate-200 focus:border-indigo-600 rounded-xl outline-none font-bold text-slate-900 transition text-xs cursor-pointer shadow-2xs"
            >
              {MARKETPLACES.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.code} - {m.name} ({m.currency})
                </option>
              ))}
            </select>
          </div>

          {/* Target ACoS & Status */}
          <div className="grid grid-cols-2 gap-3.5 pt-1">
            {/* Target ACoS */}
            <div>
              <label className="block text-slate-700 font-bold mb-1.5 flex items-center gap-1">
                <Percent size={13} weight="bold" className="text-indigo-600" />
                <span>Target ACoS (%)</span>
              </label>
              <input
                type="number"
                step="0.5"
                min="1"
                max="200"
                value={targetAcos}
                onChange={(e) => setTargetAcos(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 focus:bg-white border border-slate-200 focus:border-indigo-600 rounded-xl outline-none font-bold text-slate-900 transition text-xs shadow-2xs"
              />
              <p className="text-[10px] text-slate-400 mt-1">Mục tiêu hòa vốn chung</p>
            </div>

            {/* Trạng thái hoạt động */}
            <div>
              <label className="block text-slate-700 font-bold mb-1.5">
                Trạng Thái Hoạt Động
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as "ACTIVE" | "PAUSED")}
                className="w-full px-3.5 py-2.5 bg-slate-50 focus:bg-white border border-slate-200 focus:border-indigo-600 rounded-xl outline-none font-bold text-slate-900 transition text-xs cursor-pointer shadow-2xs"
              >
                <option value="ACTIVE">Hoạt Động (ACTIVE)</option>
                <option value="PAUSED">Tạm Dừng (PAUSED)</option>
              </select>
              <p className="text-[10px] text-slate-400 mt-1">Trạng thái theo dõi PPC</p>
            </div>
          </div>

          {/* Phôi Notice */}
          {!isEditing && (
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-start gap-2.5 mt-2">
              <Sparkle size={18} weight="fill" className="text-indigo-600 shrink-0 mt-0.5" />
              <div className="text-slate-600 text-[11px] leading-relaxed">
                <strong className="font-bold text-slate-800">Bảng Phôi (Cost Master):</strong> Khi tạo xong, store sẽ sẵn sàng với một bảng phôi trắng riêng biệt để bạn dễ dàng điền trực tiếp hoặc tải file mẫu Excel lên.
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200/80 text-slate-700 font-bold transition cursor-pointer text-xs"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold transition shadow-xs cursor-pointer text-xs disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Đang lưu...</span>
                </>
              ) : (
                <>
                  <CheckCircle size={15} weight="bold" />
                  <span>{isEditing ? "Cập Nhật Store" : "Tạo Store"}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

