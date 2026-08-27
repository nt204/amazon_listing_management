"use client";

import Link from "next/link";
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  DatabaseIcon,
  EyeIcon,
  FilePdfIcon,
  HardDrivesIcon,
  ProhibitIcon,
  ShieldCheckIcon,
  TrashIcon,
  UserCheckIcon,
  UserMinusIcon,
  UsersThreeIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AccountMenu } from "@/components/account-menu";
import type { RequestActor } from "@/lib/auth";
import type { AppUserStatus, AppUserSummary, ImageStorageStats, SystemGuideSummary } from "@/lib/db";

type UserAction = "approve" | "reject" | "disable" | "restore";

const statusLabels: Record<AppUserStatus, string> = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Từ chối",
  disabled: "Đã khóa",
};

const statusStyles: Record<AppUserStatus, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-800",
  rejected: "border-red-200 bg-red-50 text-red-700",
  disabled: "border-slate-300 bg-slate-100 text-slate-700",
};

function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1_024 && unit < units.length - 1) {
    value /= 1_024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDate(value: string | null) {
  if (!value) return "Chưa có";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function AdminConsole({ actor }: { actor: RequestActor }) {
  const [users, setUsers] = useState<AppUserSummary[]>([]);
  const [storage, setStorage] = useState<{ driver: string; stats: ImageStorageStats } | null>(null);
  const [guides, setGuides] = useState<SystemGuideSummary[]>([]);
  const [showUploadGuideModal, setShowUploadGuideModal] = useState(false);
  const [guideTitle, setGuideTitle] = useState("");
  const [guideDesc, setGuideDesc] = useState("");
  const [guideFile, setGuideFile] = useState<File | null>(null);
  const [uploadingGuide, setUploadingGuide] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionKey, setActionKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [usersResponse, storageResponse, guidesResponse] = await Promise.all([
        fetch("/api/admin/users", { cache: "no-store" }),
        fetch("/api/admin/storage", { cache: "no-store" }),
        fetch("/api/guides", { cache: "no-store" }),
      ]);
      const usersBody = await usersResponse.json() as { users?: AppUserSummary[]; error?: string };
      const storageBody = await storageResponse.json() as { driver?: string; stats?: ImageStorageStats; error?: string };
      const guidesBody = await guidesResponse.json() as { guides?: SystemGuideSummary[]; error?: string };
      if (!usersResponse.ok) throw new Error(usersBody.error || "Không thể tải tài khoản.");
      if (!storageResponse.ok) throw new Error(storageBody.error || "Không thể tải lưu trữ.");
      setUsers(usersBody.users || []);
      setStorage({ driver: storageBody.driver || "unknown", stats: storageBody.stats! });
      if (guidesResponse.ok && guidesBody.guides) {
        setGuides(guidesBody.guides);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không thể tải dữ liệu quản trị.");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleUploadGuide = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guideTitle.trim() || !guideFile) return;
    setUploadingGuide(true);
    setError("");
    setNotice("");
    try {
      const formData = new FormData();
      formData.append("title", guideTitle.trim());
      formData.append("description", guideDesc.trim());
      formData.append("file", guideFile);

      const res = await fetch("/api/guides", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không thể tải lên tài liệu hướng dẫn.");
      if (data.guide) {
        setGuides((prev) => [data.guide, ...prev.filter((g) => g.id !== data.guide.id)]);
      }
      setNotice(`Đã tải lên tài liệu "${guideTitle.trim()}" thành công!`);
      setGuideTitle("");
      setGuideDesc("");
      setGuideFile(null);
      setShowUploadGuideModal(false);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Lỗi tải lên tài liệu.");
    } finally {
      setUploadingGuide(false);
    }
  };

  const handleDeleteGuide = async (guide: SystemGuideSummary) => {
    if (!window.confirm(`Xác nhận xóa tài liệu hướng dẫn "${guide.title}"?`)) return;
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/guides/${guide.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không thể xóa tài liệu.");
      setGuides((prev) => prev.filter((g) => g.id !== guide.id));
      setNotice(`Đã xóa tài liệu "${guide.title}".`);
    } catch (delError) {
      setError(delError instanceof Error ? delError.message : "Lỗi xóa tài liệu.");
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const pendingCount = useMemo(
    () => users.filter((user) => user.status === "pending").length,
    [users],
  );

  const updateUser = async (user: AppUserSummary, action: UserAction) => {
    const labels: Record<UserAction, string> = {
      approve: "duyệt",
      reject: "từ chối",
      disable: "khóa",
      restore: "mở lại",
    };
    if (!window.confirm(`Xác nhận ${labels[action]} tài khoản ${user.username}?`)) return;
    setActionKey(`${user.userId}:${action}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.userId, action }),
      });
      const body = await response.json() as { user?: AppUserSummary; error?: string };
      if (!response.ok || !body.user) throw new Error(body.error || "Không thể cập nhật tài khoản.");
      setUsers((current) => current.map((item) => item.userId === body.user!.userId ? body.user! : item));
      setNotice(`Đã ${labels[action]} tài khoản ${user.username}.`);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Không thể cập nhật tài khoản.");
    } finally {
      setActionKey("");
    }
  };

  const cleanupDatabaseImages = async () => {
    if (!storage || storage.driver !== "r2") return;
    const eligible = storage.stats.listingR2BackedDatabaseBytes + storage.stats.trelloR2BackedDatabaseBytes;
    if (eligible <= 0) return;
    if (!window.confirm(
      `Xóa ${formatBytes(eligible)} bản sao ảnh khỏi PostgreSQL? Ảnh trên R2 và metadata vẫn được giữ nguyên.`,
    )) return;
    setActionKey("storage:cleanup");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "clear-r2-backed-db-image-bytes",
          confirmation: "XOA ANH DB",
        }),
      });
      const body = await response.json() as { stats?: ImageStorageStats; freedBytes?: number; error?: string };
      if (!response.ok || !body.stats) throw new Error(body.error || "Không thể dọn ảnh trong DB.");
      setStorage((current) => current ? { ...current, stats: body.stats! } : current);
      setNotice(`Đã giải phóng ${formatBytes(body.freedBytes || 0)} trong PostgreSQL. Ảnh trên R2 vẫn còn nguyên.`);
    } catch (cleanupError) {
      setError(cleanupError instanceof Error ? cleanupError.message : "Không thể dọn ảnh trong DB.");
    } finally {
      setActionKey("");
    }
  };

  const eligibleBytes = storage
    ? storage.stats.listingR2BackedDatabaseBytes + storage.stats.trelloR2BackedDatabaseBytes
    : 0;

  return (
    <main className="min-h-[100dvh] bg-slate-100 text-slate-800">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100" aria-label="Quay lại NCE HUB">
              <ArrowLeftIcon size={16} />
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-extrabold text-slate-900">Quản trị NCE HUB</h1>
              <p className="truncate text-[10px] font-semibold text-slate-500">Tài khoản và lưu trữ ảnh</p>
            </div>
          </div>
          <AccountMenu actor={actor} />
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        {error ? (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-800" role="alert">
            <WarningCircleIcon className="mt-0.5 shrink-0" size={17} weight="fill" />
            <p className="text-xs font-semibold leading-5">{error}</p>
          </div>
        ) : null}
        {notice ? (
          <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800" role="status">
            <CheckCircleIcon className="mt-0.5 shrink-0" size={17} weight="fill" />
            <p className="text-xs font-semibold leading-5">{notice}</p>
          </div>
        ) : null}

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-700">
                <UsersThreeIcon size={19} weight="fill" />
              </div>
              <div>
                <h2 className="text-sm font-extrabold text-slate-900">Tài khoản</h2>
                <p className="mt-0.5 text-[11px] font-medium text-slate-500">{pendingCount} tài khoản đang chờ duyệt</p>
              </div>
            </div>
            <button type="button" onClick={() => void load()} disabled={loading} className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              {loading ? "Đang tải..." : "Làm mới"}
            </button>
          </div>

          {loading && users.length === 0 ? (
            <div className="grid gap-3 p-4 sm:p-5">
              {[0, 1, 2].map((item) => <div key={item} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}
            </div>
          ) : users.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <UsersThreeIcon className="mx-auto text-slate-300" size={34} />
              <p className="mt-3 text-xs font-bold text-slate-700">Chưa có tài khoản nào.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {users.map((user) => {
                const isSelf = user.userId === actor.userId;
                return (
                  <article key={user.userId} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-xs font-extrabold text-slate-900">{user.displayName}</p>
                        <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${statusStyles[user.status]}`}>{statusLabels[user.status]}</span>
                        {isSelf ? <span className="text-[10px] font-bold text-blue-700">Tài khoản hiện tại</span> : null}
                      </div>
                      <p className="mt-1 text-[11px] font-semibold text-slate-500">@{user.username} | {user.role}</p>
                      <p className="mt-1 text-[10px] text-slate-400">Đăng ký: {formatDate(user.createdAt)} | Đăng nhập gần nhất: {formatDate(user.lastLoginAt)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      {user.status === "pending" ? (
                        <>
                          <button type="button" disabled={Boolean(actionKey)} onClick={() => void updateUser(user, "approve")} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-extrabold text-white hover:bg-emerald-700 disabled:opacity-60">
                            <UserCheckIcon size={15} /> Duyệt
                          </button>
                          <button type="button" disabled={Boolean(actionKey)} onClick={() => void updateUser(user, "reject")} className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-[11px] font-extrabold text-red-700 hover:bg-red-50 disabled:opacity-60">
                            <XCircleIcon size={15} /> Từ chối
                          </button>
                        </>
                      ) : user.status === "approved" && !isSelf ? (
                        <button type="button" disabled={Boolean(actionKey)} onClick={() => void updateUser(user, "disable")} className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-[11px] font-extrabold text-slate-700 hover:bg-slate-100 disabled:opacity-60">
                          <UserMinusIcon size={15} /> Khóa
                        </button>
                      ) : (user.status === "disabled" || user.status === "rejected") ? (
                        <button type="button" disabled={Boolean(actionKey)} onClick={() => void updateUser(user, "restore")} className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-2 text-[11px] font-extrabold text-blue-700 hover:bg-blue-50 disabled:opacity-60">
                          <ShieldCheckIcon size={15} /> Mở lại
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-700">
                <DatabaseIcon size={19} weight="fill" />
              </div>
              <div>
                <h2 className="text-sm font-extrabold text-slate-900">Lưu trữ ảnh</h2>
                <p className="mt-0.5 text-[11px] font-medium text-slate-500">Giữ ảnh gốc trên R2, dọn bản sao byte trong PostgreSQL</p>
              </div>
            </div>
          </div>

          {storage ? (
            <div className="p-4 sm:p-5">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center gap-2 text-slate-700"><HardDrivesIcon size={17} /><h3 className="text-xs font-extrabold">Ảnh listing</h3></div>
                  <p className="mt-3 text-xl font-black text-slate-900">{formatBytes(storage.stats.listingDatabaseBytes)}</p>
                  <p className="mt-1 text-[11px] font-medium text-slate-500">{storage.stats.listingRows} hàng ảnh trong DB</p>
                  <p className="mt-2 text-[10px] font-semibold text-blue-700">Có thể dọn: {formatBytes(storage.stats.listingR2BackedDatabaseBytes)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center gap-2 text-slate-700"><DatabaseIcon size={17} /><h3 className="text-xs font-extrabold">Preview Trello</h3></div>
                  <p className="mt-3 text-xl font-black text-slate-900">{formatBytes(storage.stats.trelloPreviewDatabaseBytes)}</p>
                  <p className="mt-1 text-[11px] font-medium text-slate-500">{storage.stats.trelloPreviewRows} hàng preview trong DB</p>
                  <p className="mt-2 text-[10px] font-semibold text-blue-700">Có thể dọn: {formatBytes(storage.stats.trelloR2BackedDatabaseBytes)}</p>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2">
                  {storage.driver === "r2" ? <CheckCircleIcon className="mt-0.5 shrink-0 text-emerald-700" size={17} weight="fill" /> : <ProhibitIcon className="mt-0.5 shrink-0 text-red-700" size={17} weight="fill" />}
                  <div>
                    <p className="text-xs font-extrabold text-slate-900">Object storage: {storage.driver.toUpperCase()}</p>
                    <p className="mt-1 max-w-2xl text-[11px] font-medium leading-5 text-slate-600">Thao tác chỉ đặt trường byte trong PostgreSQL về rỗng khi hàng đó đã có object key trên R2. Metadata, listing, prompt và cấu hình không bị xóa.</p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={storage.driver !== "r2" || eligibleBytes <= 0 || Boolean(actionKey)}
                  onClick={() => void cleanupDatabaseImages()}
                  className="shrink-0 rounded-lg bg-red-700 px-4 py-2.5 text-[11px] font-extrabold text-white hover:bg-red-800 disabled:bg-slate-300 cursor-pointer"
                >
                  {actionKey === "storage:cleanup" ? "Đang dọn..." : "Xóa bản sao ảnh trong DB"}
                </button>
              </div>
            </div>
          ) : (
            <div className="h-44 animate-pulse bg-slate-50" />
          )}
        </section>

        {/* Section: Tài liệu Hướng dẫn sử dụng PDF */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-50 text-indigo-700">
                <FilePdfIcon size={20} weight="fill" />
              </div>
              <div>
                <h2 className="text-sm font-extrabold text-slate-900">Tài liệu Hướng dẫn sử dụng (PDF)</h2>
                <p className="mt-0.5 text-[11px] font-medium text-slate-500">Tải lên file PDF hướng dẫn cho toàn bộ nhân viên và người dùng xem</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowUploadGuideModal((prev) => !prev)}
              className="rounded-xl bg-indigo-600 px-3.5 py-1.5 text-[11px] font-bold text-white shadow-xs hover:bg-indigo-700 transition cursor-pointer"
            >
              + Tải lên file PDF
            </button>
          </div>

          {/* Modal / Form Tải lên PDF */}
          {showUploadGuideModal && (
            <form onSubmit={handleUploadGuide} className="border-b border-slate-200 bg-slate-50/80 p-4 sm:p-5 space-y-3">
              <h3 className="text-xs font-extrabold text-slate-800">Thêm tài liệu hướng dẫn mới</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Tiêu đề tài liệu *</label>
                  <input
                    type="text"
                    required
                    value={guideTitle}
                    onChange={(e) => setGuideTitle(e.target.value)}
                    placeholder="Ví dụ: Hướng dẫn tạo Listing & Đào Keyword"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Chọn file PDF *</label>
                  <input
                    type="file"
                    required
                    accept=".pdf"
                    onChange={(e) => setGuideFile(e.target.files?.[0] || null)}
                    className="w-full text-xs text-slate-600 file:mr-3 file:rounded-xl file:border-0 file:bg-indigo-100 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-indigo-700 hover:file:bg-indigo-200 cursor-pointer"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Mô tả ngắn</label>
                <input
                  type="text"
                  value={guideDesc}
                  onChange={(e) => setGuideDesc(e.target.value)}
                  placeholder="Ví dụ: Quy trình từng bước xuất Excel và đồng bộ Trello..."
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 outline-none focus:border-indigo-500"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowUploadGuideModal(false)}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={uploadingGuide}
                  className="rounded-xl bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-60 cursor-pointer shadow-xs"
                >
                  {uploadingGuide ? "Đang tải lên..." : "Lưu tài liệu"}
                </button>
              </div>
            </form>
          )}

          {/* Danh sách PDF Guides */}
          {guides.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <FilePdfIcon className="mx-auto text-slate-300" size={36} />
              <p className="mt-2 text-xs font-bold text-slate-700">Chưa có tài liệu hướng dẫn nào được tải lên.</p>
              <p className="mt-1 text-[11px] text-slate-500">Bấm nút "+ Tải lên file PDF" ở trên để đưa tài liệu hướng dẫn cho nhân viên.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {guides.map((guide) => (
                <article key={guide.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5 hover:bg-slate-50/50 transition">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-600 border border-rose-100 mt-0.5">
                      <FilePdfIcon size={22} weight="fill" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-xs font-black text-slate-900">{guide.title}</h3>
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 font-mono">
                          {formatBytes(guide.byteSize)}
                        </span>
                      </div>
                      {guide.description && (
                        <p className="mt-0.5 text-[11px] text-slate-600 line-clamp-1">{guide.description}</p>
                      )}
                      <p className="mt-0.5 text-[10px] text-slate-400 font-mono">
                        File: {guide.filename} • {formatDate(guide.createdAt)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <a
                      href={`/api/guides/${guide.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition shadow-2xs"
                    >
                      <EyeIcon size={14} weight="bold" />
                      Xem file PDF
                    </a>
                    <button
                      type="button"
                      onClick={() => void handleDeleteGuide(guide)}
                      className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100 transition cursor-pointer"
                      title="Xóa tài liệu này"
                    >
                      <TrashIcon size={14} weight="bold" />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
