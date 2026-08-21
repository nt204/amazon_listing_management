"use client";

import { useEffect, useState } from "react";
import { Gear, CheckCircle, WarningCircle, X, Key, Info } from "@phosphor-icons/react";

interface SellerSpriteSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export function SellerSpriteSettingsModal({
  isOpen,
  onClose,
  onSaved,
}: SellerSpriteSettingsModalProps) {
  const [cookieInput, setCookieInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"configured" | "not_configured" | "expired">("not_configured");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    fetchStatus();
  }, [isOpen]);

  const fetchStatus = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/settings/sellersprite");
      if (res.ok) {
        const data = await res.json();
        setStatus(data.status || "not_configured");
        setUpdatedAt(data.updatedAt || null);
      }
    } catch {
      setErrorMsg("Không thể tải trạng thái Cookie Sellersprite.");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!cookieInput.trim()) {
      setErrorMsg("Vui lòng nhập hoặc dán chuỗi Cookie SellerSprite.");
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch("/api/settings/sellersprite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookies: cookieInput }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Lỗi khi lưu Cookie.");
      }

      setSuccessMsg("Lưu Cookie SellerSprite thành công!");
      setStatus("configured");
      setUpdatedAt(new Date().toISOString());
      setCookieInput("");
      if (onSaved) onSaved();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Đã xảy ra lỗi.");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl text-slate-800">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-lg bg-blue-50 text-blue-600 border border-blue-100">
              <Gear size={22} weight="bold" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">Cấu hình Cookie SellerSprite</h3>
              <p className="text-xs text-slate-500 font-medium">Thiết lập Cookie phiên làm việc để đào Keyword trực tiếp</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="py-4 space-y-4">
          {/* Status Badge */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
            <div className="flex items-center gap-2">
              <Key size={18} className="text-slate-500" />
              <span className="text-xs font-bold text-slate-700">Trạng thái kết nối:</span>
            </div>

            {loading ? (
              <span className="text-xs text-slate-500 font-medium">Đang kiểm tra...</span>
            ) : status === "configured" ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <CheckCircle size={14} weight="fill" /> Đã cấu hình Cookie
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                <WarningCircle size={14} weight="fill" /> Chưa có Cookie hợp lệ
              </span>
            )}
          </div>

          {updatedAt && (
            <p className="text-[11px] text-slate-500 text-right font-medium">
              Cập nhật lần cuối: {new Date(updatedAt).toLocaleString("vi-VN")}
            </p>
          )}

          {/* Instructions Box */}
          <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200/80 text-blue-900 text-xs space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold text-blue-800">
              <Info size={16} /> Hướng dẫn lấy Cookie từ Trình duyệt:
            </div>
            <ol className="list-decimal list-inside space-y-1 text-slate-700 text-[11px] font-medium leading-relaxed pl-1">
              <li>Đăng nhập tài khoản SellerSprite trên trình duyệt Chrome/Edge của bạn.</li>
              <li>Sử dụng extension <strong>Cookie-Editor</strong> hoặc <strong>EditThisCookie</strong>.</li>
              <li>Bấm <strong>Export JSON</strong> (hoặc copy chuỗi Header <code className="text-blue-700 font-mono">JSESSIONID=...</code>).</li>
              <li>Dán nội dung vừa copy vào ô dưới đây và bấm <strong>Lưu Cấu Hình</strong>.</li>
            </ol>
          </div>

          {/* Input Field */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-700">
              Cookie JSON hoặc Cookie Header String:
            </label>
            <textarea
              rows={4}
              value={cookieInput}
              onChange={(e) => setCookieInput(e.target.value)}
              placeholder='Paste JSON cookie (dạng [{"name":"...", "value":"..."}]) hoặc Cookie header tại đây...'
              className="w-full rounded-xl border border-slate-300 bg-slate-50 p-3 text-xs font-mono text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition"
            />
          </div>

          {/* Alerts */}
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium flex items-center gap-2">
              <WarningCircle size={16} className="shrink-0 text-rose-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium flex items-center gap-2">
              <CheckCircle size={16} className="shrink-0 text-emerald-600" />
              <span>{successMsg}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4.5 py-2 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-xs disabled:opacity-50 transition flex items-center gap-2"
          >
            {saving ? "Đang lưu..." : "Lưu Cấu Hình Cookie"}
          </button>
        </div>
      </div>
    </div>
  );
}
