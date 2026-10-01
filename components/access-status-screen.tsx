"use client";

import {
  CheckCircleIcon,
  ClockCountdownIcon,
  CopyIcon,
  LockKeyIcon,
  ProhibitIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import { useState } from "react";

interface AccessStatusScreenProps {
  status: "pending" | "approved" | "rejected" | "disabled" | "unauthenticated" | "no_features";
  email: string | null;
}

export function AccessStatusScreen({ status, email }: AccessStatusScreenProps) {
  const [copied, setCopied] = useState(false);

  const copyEmail = () => {
    if (!email) return;
    navigator.clipboard.writeText(email);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRefresh = () => {
    window.location.reload();
  };

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[#f3f5f7] p-5">
      <section className="w-full max-w-[460px] overflow-hidden rounded-2xl border border-[#d8dde1] bg-white shadow-[0_24px_70px_rgba(31,41,49,0.12)]">
        {/* Header */}
        <div className="border-b border-[#e2e6e9] px-6 py-5 bg-gradient-to-b from-slate-50 to-white">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white border border-slate-200 p-1.5 shadow-xs">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="NCE HUB Logo" className="h-full w-full object-contain" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black tracking-tight text-[#1f2933]">NCE HUB</h1>
                <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700">
                  <ShieldCheckIcon size={12} weight="fill" /> Cloudflare Access
                </span>
              </div>
              <p className="mt-0.5 text-xs font-medium text-[#65717c]">Hệ thống bảo vệ phân quyền tập trung</p>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 text-center">
          {status === "pending" ? (
            <div>
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-amber-600 border border-amber-200 shadow-xs mb-4">
                <ClockCountdownIcon size={32} weight="duotone" />
              </div>
              <h2 className="text-base font-extrabold text-slate-900">Tài khoản đang chờ duyệt</h2>
              <p className="mt-2 text-xs font-medium text-slate-600 leading-relaxed">
                Email của bạn đã được xác thực an toàn qua Cloudflare Zero Trust:
              </p>
              <div className="mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2">
                <span className="text-xs font-bold text-slate-800">{email || "Chưa xác định"}</span>
                <button
                  type="button"
                  onClick={copyEmail}
                  className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-800 transition"
                  title="Sao chép email"
                >
                  {copied ? <CheckCircleIcon size={14} className="text-emerald-600" /> : <CopyIcon size={14} />}
                </button>
              </div>
              <p className="mt-4 text-[11px] font-medium text-slate-500 leading-5">
                Vui lòng liên hệ Quản trị viên hệ thống (<strong className="text-slate-700">ndtrince@gmail.com</strong>) để được phân quyền chức năng vào hệ thống làm việc.
              </p>
            </div>
          ) : status === "disabled" || status === "rejected" ? (
            <div>
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-red-50 text-red-600 border border-red-200 shadow-xs mb-4">
                <ProhibitIcon size={32} weight="duotone" />
              </div>
              <h2 className="text-base font-extrabold text-slate-900">Quyền truy cập bị vô hiệu hóa</h2>
              <p className="mt-2 text-xs font-medium text-slate-600 leading-relaxed">
                Tài khoản <strong className="text-slate-800">{email}</strong> hiện đang bị tạm khóa hoặc từ chối truy cập.
              </p>
              <p className="mt-3 text-[11px] text-slate-500">
                Nếu bạn cần tiếp tục sử dụng, vui lòng liên hệ Admin để mở lại tài khoản.
              </p>
            </div>
          ) : status === "no_features" ? (
            <div>
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-amber-600 border border-amber-200 shadow-xs mb-4">
                <LockKeyIcon size={32} weight="duotone" />
              </div>
              <h2 className="text-base font-extrabold text-slate-900">Chưa được cấp tính năng nào</h2>
              <p className="mt-2 text-xs font-medium text-slate-600 leading-relaxed">
                Tài khoản <strong className="text-slate-800">{email}</strong> đã được duyệt nhưng chưa được chỉ định quyền truy cập tính năng (Listing, Mockup, Keyword, PPC).
              </p>
              <p className="mt-3 text-[11px] text-slate-500">
                Vui lòng nhờ Admin tích chọn các tính năng được phép dùng trong trang Quản trị.
              </p>
            </div>
          ) : (
            <div>
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-sky-50 text-sky-600 border border-sky-200 shadow-xs mb-4">
                <LockKeyIcon size={32} weight="duotone" />
              </div>
              <h2 className="text-base font-extrabold text-slate-900">Yêu cầu xác thực Cloudflare</h2>
              <p className="mt-2 text-xs font-medium text-slate-600 leading-relaxed">
                Hệ thống chỉ chấp nhận các yêu cầu truy cập đã qua cổng xác thực bảo mật của Cloudflare Zero Trust.
              </p>
              <p className="mt-3 text-[11px] text-slate-500">
                Vui lòng truy cập qua đường dẫn chính thức đã được cấu hình Cloudflare Access.
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="mt-6 border-t border-slate-100 pt-5">
            <button
              type="button"
              onClick={handleRefresh}
              className="w-full rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-slate-800 transition active:scale-[0.99] cursor-pointer"
            >
              Kiểm tra lại quyền truy cập
            </button>
            <p className="mt-3 text-[10px] text-slate-400">
              Đã gỡ bỏ toàn bộ mật khẩu • Bảo vệ qua Cloudflare Access Email
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
