"use client";

import Link from "next/link";
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  DatabaseIcon,
  EyeIcon,
  FilePdfIcon,
  HardDrivesIcon,
  PencilSimpleIcon,
  PlusIcon,
  ProhibitIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  TrashIcon,
  UserCheckIcon,
  UserMinusIcon,
  UsersThreeIcon,
  WarningCircleIcon,
  XCircleIcon,
  XIcon,
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

const availableFeatures = [
  { id: "listing", label: "Listing Desk", desc: "Tạo và duyệt Listing Amazon" },
  { id: "mockups", label: "Mockup Design", desc: "Tạo ảnh Mockup AI Gemini/ChatGPT" },
  { id: "sellersprite", label: "Đào Keyword", desc: "Đào từ khóa và phân tích đối thủ" },
  { id: "ppc", label: "PPC Analytics", desc: "Chiến dịch PPC, Phôi, Rules" },
  { id: "accounting", label: "Accounting", desc: "Store, Inventory và quản lý tài chính" },
];

const defaultFeatureIds = availableFeatures.map((feature) => feature.id);

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

  // Modal Thêm Email
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<"editor" | "reviewer" | "admin">("editor");
  const [newFeatures, setNewFeatures] = useState<string[]>([...defaultFeatureIds]);
  const [addingUser, setAddingUser] = useState(false);

  // Modal Phân Quyền Features
  const [editingFeaturesUser, setEditingFeaturesUser] = useState<AppUserSummary | null>(null);
  const [editFeatures, setEditFeatures] = useState<string[]>([]);
  const [savingFeatures, setSavingFeatures] = useState(false);

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
      setUsers((current) => current.map((item) => (item.userId === body.user!.userId ? body.user! : item)));
      setNotice(`Đã ${labels[action]} tài khoản ${user.username}.`);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Không thể cập nhật tài khoản.");
    } finally {
      setActionKey("");
    }
  };

  const handleRoleChange = async (user: AppUserSummary, role: "editor" | "reviewer" | "admin") => {
    if (user.role === role) return;
    setActionKey(`${user.userId}:role`);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.userId, role }),
      });
      const body = await response.json() as { user?: AppUserSummary; error?: string };
      if (!response.ok || !body.user) throw new Error(body.error || "Không thể đổi vai trò.");
      setUsers((current) => current.map((item) => (item.userId === body.user!.userId ? body.user! : item)));
      setNotice(`Đã chuyển vai trò tài khoản ${user.username} thành ${role.toUpperCase()}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi đổi vai trò.");
    } finally {
      setActionKey("");
    }
  };

  const handleDeleteUser = async (user: AppUserSummary) => {
    if (!window.confirm(`Xác nhận XÓA HẲN tài khoản email ${user.username} khỏi hệ thống?`)) return;
    setActionKey(`${user.userId}:delete`);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.userId }),
      });
      const body = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || !body.success) throw new Error(body.error || "Không thể xóa tài khoản.");
      setUsers((current) => current.filter((item) => item.userId !== user.userId));
      setNotice(`Đã xóa tài khoản ${user.username}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi xóa tài khoản.");
    } finally {
      setActionKey("");
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setAddingUser(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail.trim().toLowerCase(),
          displayName: newName.trim(),
          role: newRole,
          allowedFeatures: newFeatures,
        }),
      });
      const data = await res.json() as { user?: AppUserSummary; error?: string };
      if (!res.ok || !data.user) throw new Error(data.error || "Không thể thêm tài khoản.");
      setUsers((prev) => [data.user!, ...prev.filter((u) => u.userId !== data.user!.userId)]);
      setNotice(`Đã cấp quyền trước cho email ${data.user.username}!`);
      setShowAddUserModal(false);
      setNewEmail("");
      setNewName("");
      setNewRole("editor");
      setNewFeatures([...defaultFeatureIds]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi thêm tài khoản.");
    } finally {
      setAddingUser(false);
    }
  };

  const openEditFeatures = (user: AppUserSummary) => {
    setEditingFeaturesUser(user);
    setEditFeatures(user.allowedFeatures ?? [...defaultFeatureIds]);
  };

  const handleSaveFeatures = async () => {
    if (!editingFeaturesUser) return;
    setSavingFeatures(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: editingFeaturesUser.userId,
          allowedFeatures: editFeatures,
        }),
      });
      const data = await res.json() as { user?: AppUserSummary; error?: string };
      if (!res.ok || !data.user) throw new Error(data.error || "Không thể lưu quyền chức năng.");
      setUsers((prev) => prev.map((u) => (u.userId === data.user!.userId ? data.user! : u)));
      setNotice(`Đã cập nhật quyền chức năng cho ${data.user.username}.`);
      setEditingFeaturesUser(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi lưu quyền chức năng.");
    } finally {
      setSavingFeatures(false);
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
      setStorage((current) => (current ? { ...current, stats: body.stats! } : current));
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
              <p className="truncate text-[10px] font-semibold text-slate-500">Phân quyền Email Cloudflare & Lưu trữ</p>
            </div>
          </div>
          <AccountMenu actor={actor} pendingUserCount={pendingCount} />
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

        {/* BẢNG TÀI KHOẢN VÀ PHÂN QUYỀN CHỨC NĂNG */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-700">
                <UsersThreeIcon size={19} weight="fill" />
              </div>
              <div>
                <h2 className="text-sm font-extrabold text-slate-900">Quản lý Tài khoản & Phân quyền chức năng</h2>
                <p className="mt-0.5 text-[11px] font-medium text-slate-500">
                  {users.length} tài khoản • {pendingCount} tài khoản đang chờ duyệt • Bảo vệ qua Cloudflare Access
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAddUserModal(true)}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-indigo-700 shadow-2xs transition cursor-pointer"
              >
                <PlusIcon size={14} weight="bold" /> Thêm Email
              </button>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
              >
                {loading ? "Đang tải..." : "Làm mới"}
              </button>
            </div>
          </div>

          {loading && users.length === 0 ? (
            <div className="grid gap-3 p-4 sm:p-5">
              {[0, 1, 2].map((item) => (
                <div key={item} className="h-20 animate-pulse rounded-xl bg-slate-100" />
              ))}
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
                  <article key={user.userId} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5 hover:bg-slate-50/50 transition">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-xs font-black text-slate-900">{user.displayName || user.username}</p>
                        <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${statusStyles[user.status]}`}>
                          {statusLabels[user.status]}
                        </span>
                        {isSelf ? <span className="rounded-md bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 text-[10px] font-extrabold">Bạn (Admin)</span> : null}
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="font-semibold text-slate-700">{user.username}</span>
                        <span className="text-slate-300">•</span>
                        {/* Dropdown đổi role */}
                        {isSelf ? (
                          <span className="font-bold text-indigo-700 uppercase tracking-wide text-[10px]">
                            {user.role}
                          </span>
                        ) : (
                          <select
                            value={user.role}
                            onChange={(e) => void handleRoleChange(user, e.target.value as "editor" | "reviewer" | "admin")}
                            disabled={Boolean(actionKey)}
                            className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-700 hover:border-slate-300 focus:outline-hidden cursor-pointer"
                          >
                            <option value="editor">Editor (Thành viên)</option>
                            <option value="reviewer">Reviewer (Kiểm duyệt)</option>
                            <option value="admin">Admin (Quản trị)</option>
                          </select>
                        )}
                      </div>

                      {/* Danh sách các chức năng được cấp */}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-bold text-slate-400">Chức năng:</span>
                        {(user.allowedFeatures || defaultFeatureIds).map((feat) => {
                          const item = availableFeatures.find((f) => f.id === feat);
                          return (
                            <span
                              key={feat}
                              className="rounded-md border border-slate-200 bg-slate-100/80 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600"
                            >
                              {item ? item.label : feat}
                            </span>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => openEditFeatures(user)}
                          className="flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50/50 px-1.5 py-0.5 text-[9px] font-bold text-indigo-700 hover:bg-indigo-100/70 transition cursor-pointer"
                          title="Sửa quyền chức năng"
                        >
                          <PencilSimpleIcon size={10} /> Phân quyền
                        </button>
                      </div>

                      <p className="mt-1.5 text-[10px] text-slate-400">
                        Tạo lúc: {formatDate(user.createdAt)} | Đăng nhập gần nhất: {formatDate(user.lastLoginAt)}
                      </p>
                    </div>

                    {/* Actions buttons */}
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      {user.status === "pending" ? (
                        <>
                          <button
                            type="button"
                            disabled={Boolean(actionKey)}
                            onClick={() => void updateUser(user, "approve")}
                            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-extrabold text-white hover:bg-emerald-700 disabled:opacity-60 cursor-pointer"
                          >
                            <UserCheckIcon size={14} /> Duyệt
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(actionKey)}
                            onClick={() => void updateUser(user, "reject")}
                            className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-[11px] font-extrabold text-red-700 hover:bg-red-50 disabled:opacity-60 cursor-pointer"
                          >
                            <XCircleIcon size={14} /> Từ chối
                          </button>
                        </>
                      ) : user.status === "approved" && !isSelf ? (
                        <button
                          type="button"
                          disabled={Boolean(actionKey)}
                          onClick={() => void updateUser(user, "disable")}
                          className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-60 cursor-pointer"
                        >
                          <UserMinusIcon size={14} /> Khóa
                        </button>
                      ) : (user.status === "disabled" || user.status === "rejected") && !isSelf ? (
                        <button
                          type="button"
                          disabled={Boolean(actionKey)}
                          onClick={() => void updateUser(user, "restore")}
                          className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-60 cursor-pointer"
                        >
                          <ShieldCheckIcon size={14} /> Mở lại
                        </button>
                      ) : null}

                      {!isSelf ? (
                        <button
                          type="button"
                          disabled={Boolean(actionKey)}
                          onClick={() => void handleDeleteUser(user)}
                          className="flex items-center gap-1 rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:border-red-300 hover:bg-red-50 hover:text-red-600 transition disabled:opacity-60 cursor-pointer"
                          title="Xóa tài khoản khỏi hệ thống"
                        >
                          <TrashIcon size={14} />
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* MODAL THÊM EMAIL MỚI */}
        {showAddUserModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
            <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-sm font-black text-slate-900">Cấp quyền trước cho Email</h3>
                <button
                  type="button"
                  onClick={() => setShowAddUserModal(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                >
                  <XIcon size={16} />
                </button>
              </div>

              <form onSubmit={handleAddUser} className="mt-4 space-y-4">
                <div>
                  <label className="block text-[11px] font-extrabold text-slate-700">Email Cloudflare (Gmail / Work email) *</label>
                  <input
                    type="email"
                    required
                    placeholder="vidu@gmail.com"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-hidden"
                  />
                  <p className="mt-1 text-[10px] text-slate-400">Email này sẽ được cấp quyền đăng nhập thẳng mà không cần duyệt.</p>
                </div>

                <div>
                  <label className="block text-[11px] font-extrabold text-slate-700">Tên hiển thị (Tùy chọn)</label>
                  <input
                    type="text"
                    placeholder="Ví dụ: Nguyễn Văn A"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-extrabold text-slate-700">Vai trò hệ thống</label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as "editor" | "reviewer" | "admin")}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold focus:border-indigo-500 focus:outline-hidden"
                  >
                    <option value="editor">Editor (Thành viên - thao tác dữ liệu thông thường)</option>
                    <option value="reviewer">Reviewer (Kiểm duyệt - xem và xuất báo cáo)</option>
                    <option value="admin">Admin (Toàn quyền quản trị tài khoản và lưu trữ)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-extrabold text-slate-700 mb-2">Các chức năng được phép dùng</label>
                  <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/50 p-3">
                    {availableFeatures.map((feat) => {
                      const checked = newFeatures.includes(feat.id);
                      return (
                        <label key={feat.id} className="flex items-start gap-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setNewFeatures((prev) => [...prev, feat.id]);
                              } else {
                                setNewFeatures((prev) => prev.filter((id) => id !== feat.id));
                              }
                            }}
                            className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <div>
                            <span className="block text-xs font-bold text-slate-800">{feat.label}</span>
                            <span className="block text-[10px] text-slate-500">{feat.desc}</span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddUserModal(false)}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={addingUser}
                    className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60 cursor-pointer"
                  >
                    {addingUser ? "Đang lưu..." : "Cấp quyền Email"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL PHÂN QUYỀN CHỨC NĂNG */}
        {editingFeaturesUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
            <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-black text-slate-900">Phân quyền chức năng</h3>
                  <p className="text-[11px] font-semibold text-slate-500">{editingFeaturesUser.username}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingFeaturesUser(null)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                >
                  <XIcon size={16} />
                </button>
              </div>

              <div className="mt-4 space-y-3">
                <p className="text-xs text-slate-600">Chọn các phân hệ được phép truy cập cho tài khoản này:</p>
                <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/50 p-3.5">
                  {availableFeatures.map((feat) => {
                    const checked = editFeatures.includes(feat.id);
                    return (
                      <label key={feat.id} className="flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setEditFeatures((prev) => [...prev, feat.id]);
                            } else {
                              setEditFeatures((prev) => prev.filter((id) => id !== feat.id));
                            }
                          }}
                          className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <div>
                          <span className="block text-xs font-bold text-slate-800">{feat.label}</span>
                          <span className="block text-[10px] text-slate-500">{feat.desc}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-5">
                <button
                  type="button"
                  onClick={() => setEditingFeaturesUser(null)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  onClick={handleSaveFeatures}
                  disabled={savingFeatures}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60 cursor-pointer"
                >
                  {savingFeatures ? "Đang lưu..." : "Lưu quyền"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* LƯU TRỮ ẢNH R2 */}
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
                  {actionKey === "storage:cleanup" ? "Đang dọn..." : `Dọn ${formatBytes(eligibleBytes)} ảnh trong PostgreSQL`}
                </button>
              </div>
            </div>
          ) : null}
        </section>

        {/* TÀI LIỆU HƯỚNG DẪN */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-purple-50 text-purple-700">
                <FilePdfIcon size={19} weight="fill" />
              </div>
              <div>
                <h2 className="text-sm font-extrabold text-slate-900">Tài liệu hướng dẫn</h2>
                <p className="mt-0.5 text-[11px] font-medium text-slate-500">Tải lên file PDF hướng dẫn cho các thành viên trong team</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowUploadGuideModal(true)}
              className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-purple-700 shadow-2xs transition cursor-pointer"
            >
              <PlusIcon size={14} weight="bold" /> Tải lên tài liệu
            </button>
          </div>

          <div className="p-4 sm:p-5">
            {guides.length === 0 ? (
              <div className="py-8 text-center text-slate-400">
                <FilePdfIcon size={32} className="mx-auto text-slate-300 mb-2" />
                <p className="text-xs font-semibold">Chưa có tài liệu hướng dẫn nào</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Bấm &quot;Tải lên tài liệu&quot; để thêm file hướng dẫn cho team</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {guides.map((guide) => (
                  <div key={guide.id} className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      <div className="grid h-8 w-8 place-items-center rounded-lg bg-red-50 text-red-600 border border-red-100">
                        <FilePdfIcon size={18} />
                      </div>
                      <div>
                        <a
                          href={`/api/guides/${guide.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-extrabold text-slate-900 hover:text-indigo-600 hover:underline flex items-center gap-1"
                        >
                          {guide.title}
                          <EyeIcon size={13} className="text-slate-400" />
                        </a>
                        {guide.description && (
                          <p className="text-[11px] text-slate-500 mt-0.5">{guide.description}</p>
                        )}
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {formatBytes(guide.byteSize)} • {formatDate(guide.createdAt)}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDeleteGuide(guide)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition cursor-pointer"
                      title="Xóa tài liệu"
                    >
                      <TrashIcon size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
