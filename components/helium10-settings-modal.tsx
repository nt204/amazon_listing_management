"use client";

import { useEffect, useState, useRef } from "react";
import {
  Gear,
  CheckCircle,
  WarningCircle,
  X,
  Key,
  CloudCheck,
  ArrowClockwise,
  UploadSimple,
} from "@phosphor-icons/react";

interface Helium10SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export function Helium10SettingsModal({
  isOpen,
  onClose,
  onSaved,
}: Helium10SettingsModalProps) {
  const [cookieInput, setCookieInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"configured" | "not_configured" | "expired">("not_configured");
  const [plan, setPlan] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [cookieCountDetected, setCookieCountDetected] = useState<number | null>(null);
  const [showManualInput, setShowManualInput] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    fetchStatus();
  }, [isOpen]);

  const fetchStatus = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/settings/helium10");
      if (res.ok) {
        const data = await res.json();
        setStatus(data.status || "not_configured");
        setPlan(data.plan || null);
        setAccountId(data.accountId || null);
        setUpdatedAt(data.updatedAt || null);
      }
    } catch {
      setErrorMsg("Không thể tải trạng thái Helium 10.");
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch("/api/settings/helium10?action=test");
      const data = await res.json();
      if (data.valid) {
        setStatus("configured");
        setPlan(data.plan || "Helium 10 Diamond");
        if (data.accountId) setAccountId(data.accountId);
        setSuccessMsg(`Kết nối thành công! Gói: ${data.plan || "Diamond"}`);
      } else {
        setStatus("expired");
        setErrorMsg(data.error || "Cookie đã hết hạn hoặc không hợp lệ.");
      }
    } catch {
      setErrorMsg("Lỗi khi kiểm tra kết nối tới Helium 10.");
    } finally {
      setTesting(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFileName(file.name);
    setErrorMsg(null);
    setSuccessMsg(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = String(event.target?.result || "").trim();
        setCookieInput(text);

        try {
          const parsed = JSON.parse(text);
          const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.cookies) ? parsed.cookies : []);
          setCookieCountDetected(list.length);
        } catch {
          setCookieCountDetected(null);
        }
      } catch {
        setErrorMsg("Không thể đọc nội dung file JSON.");
      }
    };
    reader.onerror = () => {
      setErrorMsg("Lỗi khi đọc file.");
    };
    reader.readAsText(file);
  };

  const handleSave = async () => {
    if (!cookieInput.trim()) {
      setErrorMsg("Vui lòng tải lên file Cookie JSON của Helium 10.");
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch("/api/settings/helium10", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookies: cookieInput }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Lỗi khi lưu Cookie.");
      }

      setSuccessMsg("Lưu Cookie Helium 10 thành công!");
      setStatus("configured");
      if (data.plan) setPlan(data.plan);
      if (data.accountId) setAccountId(data.accountId);
      setUpdatedAt(new Date().toISOString());
      setCookieInput("");
      setSelectedFileName(null);
      setCookieCountDetected(null);
      if (onSaved) onSaved();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Đã xảy ra lỗi.");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl text-slate-800 flex flex-col max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3.5 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-50 text-sky-600 border border-sky-100">
              <Gear size={20} weight="bold" />
            </div>
            <h3 className="text-base font-extrabold text-slate-900">Cấu hình Helium 10</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Status Badge Card */}
        <div className="mt-4 flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Key size={16} className="text-slate-500" />
              <span className="text-xs font-bold text-slate-700">Trạng thái:</span>
            </div>
            {accountId && (
              <p className="text-[11px] text-slate-500 font-medium pl-6">
                Account ID: <span className="text-slate-800 font-mono font-bold">{accountId}</span>
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            {loading ? (
              <span className="text-xs text-slate-500 font-medium">Đang kiểm tra...</span>
            ) : status === "configured" ? (
              <div className="flex items-center gap-1.5">
                <span className="px-2 py-0.5 rounded-md bg-sky-100 text-sky-800 text-[11px] font-bold">
                  {plan || "Diamond"}
                </span>
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle size={14} weight="fill" /> Đang hoạt động
                </span>
              </div>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                <WarningCircle size={14} weight="fill" /> Chưa cấu hình
              </span>
            )}

            <button
              type="button"
              disabled={loading || testing}
              onClick={handleTestConnection}
              title="Kiểm tra kết nối"
              className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 hover:text-slate-900 text-xs font-bold transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              <ArrowClockwise size={14} className={testing ? "animate-spin" : ""} />
              <span className="hidden sm:inline">Kiểm tra</span>
            </button>
          </div>
        </div>

        {updatedAt && (
          <p className="mt-1 text-[11px] text-slate-400 text-right font-medium">
            Cập nhật: {new Date(updatedAt).toLocaleString("vi-VN")}
          </p>
        )}

        {/* Primary Action: File Upload Box */}
        <div className="mt-4 space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileChange}
            className="hidden"
          />

          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-300 hover:border-sky-500 bg-slate-50/70 hover:bg-sky-50/40 p-6 rounded-2xl flex flex-col items-center justify-center text-center cursor-pointer transition group"
          >
            <div className="p-3 rounded-full bg-white text-sky-600 shadow-xs border border-slate-200 group-hover:border-sky-300 group-hover:scale-105 transition">
              <UploadSimple size={24} weight="bold" />
            </div>
            <p className="mt-2.5 text-xs font-bold text-slate-800">
              {selectedFileName ? selectedFileName : "Bấm vào đây để chọn file Cookie JSON"}
            </p>

            {cookieCountDetected !== null && (
              <span className="mt-2 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[11px] font-bold">
                <CheckCircle size={12} weight="fill" /> Đã nhận diện {cookieCountDetected} cookie
              </span>
            )}
          </div>

          {/* Optional Collapsible Manual Paste */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowManualInput(!showManualInput)}
              className="text-[11px] font-bold text-slate-400 hover:text-slate-700 flex items-center gap-1 cursor-pointer"
            >
              <span>{showManualInput ? "▲ Thu gọn nhập thủ công" : "▼ Hoặc dán chuỗi JSON thủ công"}</span>
            </button>

            {showManualInput && (
              <div className="mt-2 space-y-1.5 animate-in fade-in duration-150">
                <textarea
                  rows={4}
                  value={cookieInput}
                  onChange={(e) => setCookieInput(e.target.value)}
                  placeholder='Dán nội dung JSON cookie tại đây...'
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 p-3 text-xs font-mono text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-sky-600 focus:ring-1 focus:ring-sky-600 outline-none transition"
                />
              </div>
            )}
          </div>
        </div>

        {/* Feedback Messages */}
        {errorMsg && (
          <div className="mt-3 flex items-center gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
            <WarningCircle size={16} weight="fill" className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="mt-3 flex items-center gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium">
            <CheckCircle size={16} weight="fill" className="shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 pt-4 mt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 transition cursor-pointer"
          >
            Đóng
          </button>
          <button
            type="button"
            disabled={saving || (!cookieInput.trim() && !selectedFileName)}
            onClick={() => void handleSave()}
            className="px-5 py-2 rounded-xl bg-sky-600 text-white text-xs font-bold shadow-md shadow-sky-600/20 hover:bg-sky-700 disabled:opacity-50 transition cursor-pointer flex items-center gap-1.5"
          >
            <CloudCheck size={16} />
            <span>{saving ? "Đang lưu..." : "Lưu Vào Hệ Thống"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
