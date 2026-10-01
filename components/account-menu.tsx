"use client";

import Link from "next/link";
import {
  ArrowClockwiseIcon,
  GearSixIcon,
  ShieldCheckIcon,
  SignOutIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { RequestActor } from "@/lib/auth";

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "U";
}

export function AccountMenu({
  actor,
  pendingUserCount,
}: {
  actor: RequestActor;
  pendingUserCount?: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [loadedPendingUserCount, setLoadedPendingUserCount] = useState(0);

  useEffect(() => {
    if (actor.role !== "admin" || pendingUserCount !== undefined) return;

    let cancelled = false;
    const loadPendingUsers = async () => {
      try {
        const response = await fetch("/api/admin/users", { cache: "no-store" });
        const body = await response.json() as {
          users?: Array<{ status?: string }>;
        };
        if (!response.ok || cancelled) return;
        setLoadedPendingUserCount(
          (body.users || []).filter((user) => user.status === "pending").length,
        );
      } catch {
        // Giữ trạng thái gần nhất nếu kết nối tạm thời bị gián đoạn.
      }
    };

    const initialTimer = window.setTimeout(() => void loadPendingUsers(), 0);
    const refreshTimer = window.setInterval(() => void loadPendingUsers(), 60_000);
    const refreshOnFocus = () => void loadPendingUsers();
    window.addEventListener("focus", refreshOnFocus);

    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(refreshTimer);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [actor.role, pendingUserCount]);

  const effectivePendingUserCount = pendingUserCount ?? loadedPendingUserCount;
  const hasPendingUsers = actor.role === "admin" && effectivePendingUserCount > 0;

  const [loggingOut, setLoggingOut] = useState(false);

  const handleReload = () => {
    window.location.reload();
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/session", { method: "DELETE" });
    } catch {
      // ignore
    }
    window.location.href = "/cdn-cgi/access/logout";
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative flex cursor-pointer list-none items-center gap-2 rounded-xl border border-slate-200/80 bg-white py-1 pl-1 pr-2.5 text-left shadow-2xs hover:border-indigo-200 hover:bg-slate-50 transition outline-none focus:ring-2 focus:ring-indigo-100"
        aria-label={hasPendingUsers
          ? `Mở menu tài khoản, có ${effectivePendingUserCount} người dùng chờ duyệt`
          : "Mở menu tài khoản"}
        aria-expanded={isOpen}
      >
        {hasPendingUsers ? (
          <span
            className="absolute -left-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-red-600 shadow-sm"
            title={`${effectivePendingUserCount} người dùng chờ duyệt`}
            aria-hidden="true"
          />
        ) : null}
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-700 text-[10px] font-black text-white shadow-xs">
          {initials(actor.displayName)}
        </span>
        <span className="hidden max-w-28 truncate text-[11px] font-extrabold text-slate-800 md:block">{actor.displayName}</span>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 top-[calc(100%+8px)] z-[100] w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="border-b border-slate-100 px-3 py-2.5">
              <div className="flex items-center gap-2.5">
                <UserCircleIcon className="text-indigo-600" size={24} weight="duotone" />
                <div className="min-w-0">
                  <p className="truncate text-xs font-black text-slate-900">{actor.displayName}</p>
                  <p className="truncate text-[10px] text-slate-500">{actor.email || actor.userId}</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.2 text-[9px] font-extrabold uppercase tracking-wide text-indigo-700">
                      {actor.role}
                    </span>
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-sky-50 border border-sky-100 px-1.5 py-0.2 text-[8px] font-bold text-sky-700">
                      <ShieldCheckIcon size={10} weight="fill" /> Cloudflare
                    </span>
                  </div>
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
                  <GearSixIcon size={16} className="text-indigo-600" /> Quản trị NCE HUB
                </Link>
              ) : null}

              <button
                type="button"
                onClick={handleReload}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 hover:bg-indigo-50 hover:text-indigo-900 transition cursor-pointer"
              >
                <ArrowClockwiseIcon size={16} className="text-slate-500" /> Làm mới quyền
              </button>

              <button
                type="button"
                disabled={loggingOut}
                onClick={() => void handleLogout()}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 transition disabled:opacity-60 cursor-pointer"
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
