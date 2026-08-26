"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { EyeIcon, EyeSlashIcon, GearSixIcon, KeyIcon, SignOutIcon, UserCircleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { RequestActor } from "@/lib/auth";

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "U";
}

export function AccountMenu({ actor }: { actor: RequestActor }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordNotice, setPasswordNotice] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const logout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/session", { method: "DELETE" });
      router.push("/");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  };

  const changePassword = async () => {
    setSavingPassword(true);
    setPasswordError("");
    setPasswordNotice("");
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Không thể đổi mật khẩu.");
      setCurrentPassword("");
      setNewPassword("");
      setPasswordNotice("Đã đổi mật khẩu thành công.");
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "Không thể đổi mật khẩu.");
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex cursor-pointer list-none items-center gap-2 rounded-xl border border-slate-200/80 bg-white py-1 pl-1 pr-2.5 text-left shadow-2xs hover:border-indigo-200 hover:bg-slate-50 transition outline-none focus:ring-2 focus:ring-indigo-100"
        aria-label="Mở menu tài khoản"
        aria-expanded={isOpen}
      >
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-700 text-[10px] font-black text-white shadow-xs">
          {initials(actor.displayName)}
        </span>
        <span className="hidden max-w-28 truncate text-[11px] font-extrabold text-slate-800 md:block">{actor.displayName}</span>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => {
              setIsOpen(false);
              setShowPasswordForm(false);
            }}
          />
          <div className="absolute right-0 top-[calc(100%+8px)] z-[100] w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="border-b border-slate-100 px-3 py-2.5">
              <div className="flex items-center gap-2.5">
                <UserCircleIcon className="text-indigo-600" size={24} weight="duotone" />
                <div className="min-w-0">
                  <p className="truncate text-xs font-black text-slate-900">{actor.displayName}</p>
                  <p className="mt-0.5 inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.2 text-[9px] font-extrabold uppercase tracking-wide text-indigo-700">{actor.role}</p>
                </div>
              </div>
            </div>
            <div className="pt-1.5 space-y-0.5">
              {actor.role === "admin" ? (
                <Link
                  href="/admin"
                  onClick={() => setIsOpen(false)}
                  className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 hover:bg-indigo-50 hover:text-indigo-900 transition"
                >
                  <GearSixIcon size={16} className="text-indigo-600" /> Quản trị
                </Link>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setShowPasswordForm((current) => !current);
                  setPasswordError("");
                  setPasswordNotice("");
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 hover:bg-indigo-50 hover:text-indigo-900 transition"
              >
                <KeyIcon size={16} className="text-indigo-600" /> Đổi mật khẩu
              </button>
              {showPasswordForm ? (
                <div className="mx-1 my-1.5 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                  <label className="block text-[10px] font-extrabold text-slate-600" htmlFor="account-current-password">Mật khẩu hiện tại</label>
                  <div className="relative mt-1">
                    <input
                      id="account-current-password"
                      type={showCurrentPassword ? "text" : "password"}
                      autoComplete="current-password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      className="field-control pr-8"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword((prev) => !prev)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-0.5 rounded transition cursor-pointer"
                      tabIndex={-1}
                      title={showCurrentPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                    >
                      {showCurrentPassword ? <EyeSlashIcon size={15} /> : <EyeIcon size={15} />}
                    </button>
                  </div>
                  <label className="mt-2 block text-[10px] font-extrabold text-slate-600" htmlFor="account-new-password">Mật khẩu mới</label>
                  <div className="relative mt-1">
                    <input
                      id="account-new-password"
                      type={showNewPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      className="field-control pr-8"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((prev) => !prev)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-0.5 rounded transition cursor-pointer"
                      tabIndex={-1}
                      title={showNewPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                    >
                      {showNewPassword ? <EyeSlashIcon size={15} /> : <EyeIcon size={15} />}
                    </button>
                  </div>
                  {passwordError ? <p className="mt-2 text-[10px] font-semibold leading-4 text-rose-600" role="alert">{passwordError}</p> : null}
                  {passwordNotice ? <p className="mt-2 text-[10px] font-semibold leading-4 text-emerald-700" role="status">{passwordNotice}</p> : null}
                  <button
                    type="button"
                    disabled={savingPassword || currentPassword.length < 10 || newPassword.length < 10}
                    onClick={() => void changePassword()}
                    className="mt-2.5 w-full rounded-xl bg-indigo-600 px-3 py-2 text-xs font-extrabold text-white shadow-xs hover:bg-indigo-700 disabled:bg-slate-300 transition"
                  >
                    {savingPassword ? "Đang lưu..." : "Lưu mật khẩu mới"}
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                disabled={loggingOut}
                onClick={() => void logout()}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 transition disabled:opacity-60"
              >
                <SignOutIcon size={16} /> {loggingOut ? "Đang đăng xuất..." : "Đăng xuất"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

