"use client";

import { useEffect, useState } from "react";
import {
  Gear,
  CheckCircle,
  WarningCircle,
  X,
  Key,
  Info,
  CloudCheck,
  Lightning,
  Desktop,
  ArrowClockwise,
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
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"cookie" | "local_browser">("cookie");

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
        setUpdatedAt(data.updatedAt || null);
      }
    } catch {
      setErrorMsg("Không thể tải trạng thái Cookie Helium 10.");
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
        setPlan(data.plan || "Helium 10 Active");
        setSuccessMsg(`Kết nối Helium 10 thành công! Gói cước: ${data.plan || "Active"}`);
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

  const handleSave = async () => {
    if (!cookieInput.trim()) {
      setErrorMsg("Vui lòng nhập hoặc dán chuỗi Cookie Helium 10.");
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

      setSuccessMsg("Lưu Cookie Helium 10 thành công! Kết nối API Cerebro & Magnet hoạt động tốt.");
      setStatus("configured");
      if (data.plan) setPlan(data.plan);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl text-slate-800 flex flex-col max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-sky-50 text-sky-600 border border-sky-100">
              <Gear size={22} weight="bold" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">Cấu hình Helium 10 (Server-Ready)</h3>
              <p className="text-xs text-slate-500 font-medium">
                Kết nối Direct REST API đào Cerebro &amp; Magnet siêu tốc
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Server-Ready Architecture Callout */}
        <div className="mt-4 p-3 rounded-xl bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200/80 flex items-start gap-2.5">
          <CloudCheck size={20} weight="fill" className="text-emerald-600 shrink-0 mt-0.5" />
          <div className="text-xs space-y-0.5">
            <p className="font-extrabold text-emerald-900">Kiến trúc sẵn sàng cho Server / VPS / Docker</p>
            <p className="text-emerald-800 text-[11px] leading-relaxed">
              Hệ thống sử dụng <strong>Direct HTTP API</strong> kết hợp Cookie lưu trong PostgreSQL. Khi deploy lên remote VPS, server không cần cài đặt Google Chrome/màn hình GUI mà vẫn đào dữ liệu chính xác 100% trong 2 giây!
            </p>
          </div>
        </div>

        {/* Status Badge */}
        <div className="mt-3 flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
          <div className="flex items-center gap-2">
            <Key size={18} className="text-slate-500" />
            <span className="text-xs font-bold text-slate-700">Trạng thái API:</span>
          </div>

          <div className="flex items-center gap-2">
            {loading ? (
              <span className="text-xs text-slate-500 font-medium">Đang kiểm tra...</span>
            ) : status === "configured" ? (
              <div className="flex items-center gap-2">
                {plan && (
                  <span className="px-2 py-0.5 rounded-md bg-sky-100 text-sky-800 text-[11px] font-bold">
                    {plan}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle size={14} weight="fill" /> Đang hoạt động
                </span>
              </div>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                <WarningCircle size={14} weight="fill" /> Chưa có Cookie hợp lệ
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
          <p className="mt-1 text-[11px] text-slate-500 text-right font-medium">
            Lần cập nhật cuối: {new Date(updatedAt).toLocaleString("vi-VN")}
          </p>
        )}

        {/* Tab Navigation */}
        <div className="mt-4 flex border-b border-slate-200 text-xs font-bold">
          <button
            type="button"
            onClick={() => setActiveTab("cookie")}
            className={`pb-2 px-3 border-b-2 transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === "cookie"
                ? "border-sky-600 text-sky-600 font-extrabold"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <CloudCheck size={16} />
            <span>1. Dán Cookie (Dành cho Server &amp; Mọi môi trường)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("local_browser")}
            className={`pb-2 px-3 border-b-2 transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === "local_browser"
                ? "border-sky-600 text-sky-600 font-extrabold"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <Desktop size={16} />
            <span>2. Tự Động Đăng Nhập (Chỉ Localhost)</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="py-4 space-y-4">
          {activeTab === "cookie" ? (
            <>
              {/* Instructions */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 text-xs space-y-2">
                <div className="flex items-center gap-1.5 font-bold text-slate-700">
                  <Info size={16} className="text-sky-600" />
                  <span>Cách đồng bộ Cookie lên Server (Chỉ cần làm 1 lần, dùng được 30-90 ngày):</span>
                </div>
                <ol className="list-decimal list-inside space-y-1 text-slate-600 text-[11px] font-medium leading-relaxed pl-1">
                  <li>
                    Đăng nhập tài khoản Helium 10 trên trình duyệt cá nhân tại{" "}
                    <strong className="text-slate-800">members.helium10.com</strong>.
                  </li>
                  <li>
                    Mở tiện ích <strong className="text-slate-800">Cookie-Editor</strong> (hoặc copy Header trong F12 Network) bấm{" "}
                    <strong className="text-sky-700">Export JSON</strong>.
                  </li>
                  <li>
                    Dán vào ô bên dưới rồi bấm <strong className="text-sky-700">&quot;Lưu Vào Server&quot;</strong>. Hệ thống sẽ lưu vào Database Postgres để mọi người dùng đều dùng được.
                  </li>
                </ol>
              </div>

              {/* Textarea */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">
                  Cookie JSON hoặc Chuỗi Header String:
                </label>
                <textarea
                  rows={5}
                  value={cookieInput}
                  onChange={(e) => setCookieInput(e.target.value)}
                  placeholder='Dán JSON cookie (dạng [{"name":"...", "value":"..."}]) hoặc chuỗi Header (key=value; ...) tại đây...'
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 p-3 text-xs font-mono text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-sky-600 focus:ring-1 focus:ring-sky-600 outline-none transition"
                />
              </div>
            </>
          ) : (
            <div className="p-4 rounded-xl bg-sky-50/70 border border-sky-200/90 space-y-3">
              <div className="flex items-start gap-2.5">
                <Desktop size={20} className="text-sky-600 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <h4 className="font-black text-slate-900">
                    Trợ lý đăng nhập tự động trên máy cá nhân
                  </h4>
                  <p className="text-slate-600 text-[11px] leading-relaxed">
                    Tính năng này sẽ khởi chạy một cửa sổ Google Chrome trên máy tính của bạn, tự động điền tài khoản, mật khẩu và sinh mã xác thực 2FA TOTP. Bạn chỉ cần giải captcha nếu có, hệ thống sẽ tự động bắt Cookie và lưu vào database.
                  </p>
                  <p className="text-[11px] text-amber-700 font-bold bg-amber-50 p-2 rounded-lg border border-amber-200">
                    ⚠️ Lưu ý: Tính năng này chỉ hoạt động khi chạy trên máy tính cá nhân Mac/Windows. Không hoạt động trên máy chủ VPS Linux (vì server không có màn hình desktop).
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-sky-200/60">
                <div className="text-[11px] text-slate-600">
                  Tài khoản: <strong className="text-slate-800">haonguyen36928@gmail.com</strong>
                </div>
                <button
                  type="button"
                  disabled={loading || saving}
                  onClick={async () => {
                    setSaving(true);
                    setErrorMsg(null);
                    setSuccessMsg(null);
                    try {
                      const res = await fetch("/api/settings/helium10/auto-login", { method: "POST" });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error || "Không thể tự động đăng nhập.");
                      setSuccessMsg("Đăng nhập Helium 10 thành công! Đã lưu Cookie vào Server.");
                      await fetchStatus();
                      if (onSaved) onSaved();
                    } catch (err) {
                      setErrorMsg(err instanceof Error ? err.message : "Lỗi khi tự động đăng nhập.");
                    } finally {
                      setSaving(false);
                    }
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition shadow-xs cursor-pointer disabled:opacity-50"
                >
                  <Lightning size={16} weight="fill" />
                  {saving ? "Đang mở Chrome..." : "Mở Chrome Đăng Nhập"}
                </button>
              </div>
            </div>
          )}

          {/* Feedback Messages */}
          {errorMsg && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
              <WarningCircle size={16} weight="fill" className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium">
              <CheckCircle size={16} weight="fill" className="shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-100">
          <div className="text-[11px] text-slate-400 font-medium">
            Helium 10 Cerebro &amp; Magnet Engine v2.0
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 transition cursor-pointer"
            >
              Đóng
            </button>
            {activeTab === "cookie" && (
              <button
                type="button"
                disabled={saving || !cookieInput.trim()}
                onClick={handleSave}
                className="px-5 py-2 rounded-xl bg-sky-600 text-white text-xs font-bold shadow-md shadow-sky-600/20 hover:bg-sky-700 disabled:opacity-50 transition cursor-pointer"
              >
                {saving ? "Đang lưu..." : "Lưu Vào Server"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
