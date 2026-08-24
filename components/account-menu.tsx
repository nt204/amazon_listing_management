"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { GearSixIcon, KeyIcon, SignOutIcon, UserCircleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { RequestActor } from "@/lib/auth";

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "U";
}

export function AccountMenu({ actor }: { actor: RequestActor }) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
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
      setPasswordNotice("Đã đổi mật khẩu.");
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "Không thể đổi mật khẩu.");
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <details className="group relative">
      <summary
        className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-slate-200 bg-white py-1 pl-1 pr-2 text-left hover:bg-slate-50"
        aria-label="Mở menu tài khoản"
      >
        <span className="grid h-7 w-7 place-items-center rounded-md bg-blue-600 text-[10px] font-black text-white">
          {initials(actor.displayName)}
        </span>
        <span className="hidden max-w-28 truncate text-[11px] font-bold text-slate-700 md:block">{actor.displayName}</span>
      </summary>
      <div className="absolute right-0 top-[calc(100%+8px)] z-40 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="border-b border-slate-100 px-3 py-3">
          <div className="flex items-center gap-2">
            <UserCircleIcon className="text-slate-400" size={20} weight="fill" />
            <div className="min-w-0">
              <p className="truncate text-xs font-extrabold text-slate-900">{actor.displayName}</p>
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{actor.role}</p>
            </div>
          </div>
        </div>
        <div className="p-1.5">
          {actor.role === "admin" ? (
            <Link href="/admin" className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">
              <GearSixIcon size={16} /> Quản trị
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setShowPasswordForm((current) => !current);
              setPasswordError("");
              setPasswordNotice("");
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
          >
            <KeyIcon size={16} /> Đổi mật khẩu
          </button>
          {showPasswordForm ? (
            <div className="mx-1 my-1 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
              <label className="block text-[10px] font-bold text-slate-600" htmlFor="account-current-password">Mật khẩu hiện tại</label>
              <input
                id="account-current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                className="field-control mt-1"
              />
              <label className="mt-2 block text-[10px] font-bold text-slate-600" htmlFor="account-new-password">Mật khẩu mới</label>
              <input
                id="account-new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="field-control mt-1"
              />
              {passwordError ? <p className="mt-2 text-[10px] font-semibold leading-4 text-red-700" role="alert">{passwordError}</p> : null}
              {passwordNotice ? <p className="mt-2 text-[10px] font-semibold leading-4 text-emerald-700" role="status">{passwordNotice}</p> : null}
              <button
                type="button"
                disabled={savingPassword || currentPassword.length < 10 || newPassword.length < 10}
                onClick={() => void changePassword()}
                className="mt-2 w-full rounded-lg bg-blue-600 px-3 py-2 text-[10px] font-extrabold text-white hover:bg-blue-700 disabled:bg-slate-300"
              >
                {savingPassword ? "Đang lưu..." : "Lưu mật khẩu mới"}
              </button>
            </div>
          ) : null}
          <button
            type="button"
            disabled={loggingOut}
            onClick={() => void logout()}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-60"
          >
            <SignOutIcon size={16} /> {loggingOut ? "Đang đăng xuất..." : "Đăng xuất"}
          </button>
        </div>
      </div>
    </details>
  );
}
