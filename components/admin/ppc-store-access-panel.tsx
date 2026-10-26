"use client";

import {
  ArrowCounterClockwiseIcon,
  BellRingingIcon,
  ChatCircleDotsIcon,
  CheckCircleIcon,
  CopyIcon,
  FloppyDiskIcon,
  InfoIcon,
  MagnifyingGlassIcon,
  SlidersHorizontalIcon,
  StorefrontIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";

export type Store = { id: string; name: string };
export type User = { userId: string; username: string; displayName: string };
export type Grant = {
  storeId: string;
  actorId: string;
  canAskLark: boolean;
  receiveActionNotifications: boolean;
};

const grantKey = (storeId: string, actorId: string) => `${storeId}:${actorId}`;

function getStoreShortName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= 6) return trimmed.toUpperCase();
  const match = trimmed.match(/^([A-Za-z0-9]{3,6})/);
  if (match) return match[1].toUpperCase();
  return trimmed.slice(0, 5).toUpperCase();
}

export function PpcStoreAccessPanel() {
  const [stores, setStores] = useState<Store[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [grants, setGrants] = useState<Map<string, Grant>>(new Map());
  const [initialGrants, setInitialGrants] = useState<Map<string, Grant>>(new Map());

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Filters & selection
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());

  // Side Drawer state for editing a single employee
  const [drawerUserId, setDrawerUserId] = useState<string | null>(null);

  // Quick Copy Modal state
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [copySourceUserId, setCopySourceUserId] = useState<string>("");
  const [copyTargetUserIds, setCopyTargetUserIds] = useState<Set<string>>(new Set());

  // Help Drawer state
  const [showHelpDrawer, setShowHelpDrawer] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/ppc-store-access", { cache: "no-store" });
      const body = (await response.json()) as {
        stores?: Store[];
        users?: User[];
        grants?: Grant[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "Không thể tải phân quyền store.");
      const loadedStores = body.stores || [];
      const loadedUsers = body.users || [];
      const loadedGrantsMap = new Map(
        (body.grants || []).map((grant) => [grantKey(grant.storeId, grant.actorId), { ...grant }]),
      );

      setStores(loadedStores);
      setUsers(loadedUsers);
      setGrants(loadedGrantsMap);
      setInitialGrants(new Map(loadedGrantsMap));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không thể tải phân quyền store.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial fetch synchronizes this client panel with the admin API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Track unsaved changes
  const changedCount = useMemo(() => {
    let diffs = 0;
    const allKeys = new Set([...grants.keys(), ...initialGrants.keys()]);
    for (const key of allKeys) {
      const g = grants.get(key) || { canAskLark: false, receiveActionNotifications: false };
      const init = initialGrants.get(key) || { canAskLark: false, receiveActionNotifications: false };
      if (
        Boolean(g.canAskLark) !== Boolean(init.canAskLark) ||
        Boolean(g.receiveActionNotifications) !== Boolean(init.receiveActionNotifications)
      ) {
        diffs++;
      }
    }
    return diffs;
  }, [grants, initialGrants]);

  const hasUnsavedChanges = changedCount > 0;

  // Prompt before unload if unsaved
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Filtered users list
  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return users;
    const q = searchQuery.toLowerCase().trim();
    return users.filter(
      (u) =>
        u.displayName?.toLowerCase().includes(q) ||
        u.username?.toLowerCase().includes(q),
    );
  }, [users, searchQuery]);

  // Toggle single cell grant
  function toggleCellGrant(
    storeId: string,
    actorId: string,
    field: "canAskLark" | "receiveActionNotifications",
  ) {
    setNotice("");
    setGrants((current) => {
      const next = new Map(current);
      const key = grantKey(storeId, actorId);
      const prev = next.get(key) || {
        storeId,
        actorId,
        canAskLark: false,
        receiveActionNotifications: false,
      };
      next.set(key, { ...prev, [field]: !prev[field] });
      return next;
    });
  }

  // Toggle whole column (store) for all visible users
  function toggleStoreColumnField(
    storeId: string,
    field: "canAskLark" | "receiveActionNotifications",
  ) {
    const allHaveIt = filteredUsers.every((u) => {
      const g = grants.get(grantKey(storeId, u.userId));
      return Boolean(g?.[field]);
    });
    const targetValue = !allHaveIt;

    setNotice("");
    setGrants((current) => {
      const next = new Map(current);
      for (const u of filteredUsers) {
        const key = grantKey(storeId, u.userId);
        const prev = next.get(key) || {
          storeId,
          actorId: u.userId,
          canAskLark: false,
          receiveActionNotifications: false,
        };
        next.set(key, { ...prev, [field]: targetValue });
      }
      return next;
    });
  }

  // Bulk set stores for selected users
  function bulkSetForSelectedUsers(
    field: "canAskLark" | "receiveActionNotifications",
    targetValue: boolean,
  ) {
    if (selectedUserIds.size === 0) return;

    setNotice("");
    setGrants((current) => {
      const next = new Map(current);
      for (const userId of selectedUserIds) {
        for (const store of stores) {
          const key = grantKey(store.id, userId);
          const prev = next.get(key) || {
            storeId: store.id,
            actorId: userId,
            canAskLark: false,
            receiveActionNotifications: false,
          };
          next.set(key, { ...prev, [field]: targetValue });
        }
      }
      return next;
    });
  }

  function bulkSetBothForSelectedUsers(targetValue: boolean) {
    if (selectedUserIds.size === 0) return;

    setNotice("");
    setGrants((current) => {
      const next = new Map(current);
      for (const userId of selectedUserIds) {
        for (const store of stores) {
          const key = grantKey(store.id, userId);
          next.set(key, {
            storeId: store.id,
            actorId: userId,
            canAskLark: targetValue,
            receiveActionNotifications: targetValue,
          });
        }
      }
      return next;
    });
  }

  // Copy permissions from source user to target users
  function executeCopyPermissions() {
    if (!copySourceUserId || copyTargetUserIds.size === 0) return;

    setNotice("");
    setGrants((current) => {
      const next = new Map(current);
      for (const store of stores) {
        const sourceGrant = current.get(grantKey(store.id, copySourceUserId)) || {
          storeId: store.id,
          actorId: copySourceUserId,
          canAskLark: false,
          receiveActionNotifications: false,
        };

        for (const targetUserId of copyTargetUserIds) {
          const targetKey = grantKey(store.id, targetUserId);
          next.set(targetKey, {
            storeId: store.id,
            actorId: targetUserId,
            canAskLark: sourceGrant.canAskLark,
            receiveActionNotifications: sourceGrant.receiveActionNotifications,
          });
        }
      }
      return next;
    });

    setShowCopyModal(false);
    setNotice(`Đã sao chép phân quyền sang ${copyTargetUserIds.size} nhân viên.`);
  }

  // Save changes to API
  async function save() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payloadGrants = Array.from(grants.values()).filter(
        (g) => g.canAskLark || g.receiveActionNotifications,
      );
      const response = await fetch("/api/admin/ppc-store-access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grants: payloadGrants }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Không thể lưu phân quyền store.");
      setInitialGrants(new Map(grants));
      setNotice("Đã lưu thành công phân quyền Store!");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Không thể lưu phân quyền store.");
    } finally {
      setSaving(false);
    }
  }

  // Reset to initial grants
  function resetChanges() {
    setGrants(new Map(initialGrants));
    setNotice("Đã hoàn tác toàn bộ thay đổi chưa lưu.");
    setError("");
  }

  // Drawer user entity
  const drawerUser = useMemo(
    () => users.find((u) => u.userId === drawerUserId) || null,
    [users, drawerUserId],
  );

  return (
    <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
      {/* 1. HEADER CHÍNH */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 bg-gradient-to-r from-slate-50/80 to-white">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-600 text-white shadow-xs">
            <StorefrontIcon size={22} weight="fill" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black text-slate-900">Phân quyền Store</h2>
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600 border border-slate-200">
                {stores.length} Stores
              </span>
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600 border border-slate-200">
                {users.length} Nhân viên
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500 font-medium">
              Quản lý quyền hỏi đáp & quyền thao tác PPC theo từng Store
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowHelpDrawer(true)}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-2xs transition hover:border-indigo-300 hover:bg-indigo-50/50 hover:text-indigo-600 active:scale-98 cursor-pointer"
            title="Xem hướng dẫn sử dụng & quy tắc phân quyền"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 font-black text-[10px]">
              i
            </span>
            <span>Hướng dẫn</span>
          </button>

          {hasUnsavedChanges ? (
            <button
              type="button"
              onClick={resetChanges}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 hover:text-slate-900 active:scale-98 cursor-pointer disabled:opacity-50"
              title="Khôi phục trạng thái đã lưu ban đầu"
            >
              <ArrowCounterClockwiseIcon size={14} weight="bold" />
              Hoàn tác ({changedCount})
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => void save()}
            disabled={loading || saving || !hasUnsavedChanges}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black text-white shadow-sm transition active:scale-98 cursor-pointer disabled:cursor-not-allowed ${
              hasUnsavedChanges
                ? "bg-indigo-600 hover:bg-indigo-700 ring-2 ring-indigo-300 ring-offset-1"
                : "bg-slate-300 text-slate-500 opacity-60"
            }`}
          >
            <FloppyDiskIcon size={16} weight="bold" />
            {saving ? "Đang lưu..." : hasUnsavedChanges ? `Lưu ${changedCount} thay đổi` : "Đã lưu"}
          </button>
        </div>
      </div>

      {/* CẢNH BÁO CHƯA LƯU */}
      {hasUnsavedChanges ? (
        <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50/90 px-5 py-2.5 text-xs font-semibold text-amber-900">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-500 animate-ping" />
            <span>
              Bạn có <strong>{changedCount}</strong> thay đổi chưa lưu. Hãy nhấn <strong>Lưu thay đổi</strong> để áp dụng vào hệ thống.
            </span>
          </div>
          <button
            type="button"
            onClick={resetChanges}
            className="underline hover:text-amber-950 cursor-pointer text-[11px]"
          >
            Hủy bỏ thay đổi
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="m-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-red-800" role="alert">
          <WarningCircleIcon className="mt-0.5 shrink-0" size={17} weight="fill" />
          <p className="text-xs font-bold leading-5">{error}</p>
        </div>
      ) : null}

      {notice ? (
        <div className="m-4 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-emerald-800" role="status">
          <CheckCircleIcon className="mt-0.5 shrink-0" size={17} weight="fill" />
          <p className="text-xs font-bold leading-5">{notice}</p>
        </div>
      ) : null}

      {/* 2. THANH CÔNG CỤ TINH GỌN */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/70 p-3 sm:px-5">
        {/* CHÚ THÍCH TINH GỌN */}
        <div className="flex items-center gap-3 text-xs font-bold text-slate-700">
          <div className="flex items-center gap-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-indigo-600 text-white shadow-2xs">
              <ChatCircleDotsIcon size={12} weight="fill" />
            </span>
            <span>Hỏi đáp Lark</span>
          </div>

          <span className="text-slate-300">•</span>

          <div className="flex items-center gap-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-amber-500 text-white shadow-2xs">
              <BellRingingIcon size={12} weight="fill" />
            </span>
            <span>Action PPC</span>
          </div>
        </div>

        {/* SEARCH & COPY TOOLBAR */}
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input
              type="text"
              placeholder="Tìm nhân viên..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-44 sm:w-52 rounded-xl border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <button
            type="button"
            onClick={() => {
              if (users.length > 0) {
                setCopySourceUserId(users[0].userId);
                setCopyTargetUserIds(new Set());
                setShowCopyModal(true);
              }
            }}
            disabled={users.length < 2}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-2xs hover:border-slate-300 hover:bg-slate-50 transition cursor-pointer disabled:opacity-50"
            title="Sao chép toàn bộ phân quyền từ một người sang các nhân viên khác"
          >
            <CopyIcon size={14} weight="bold" />
            Sao chép cấu hình
          </button>
        </div>
      </div>

      {/* 3. BẢNG THAO TÁC HÀNG LOẠT (KHI CÓ NHÂN VIÊN ĐƯỢC CHỌN) */}
      {selectedUserIds.size > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-indigo-200 bg-indigo-50/70 px-5 py-2.5 animate-in fade-in duration-150">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-xs font-black text-white">
              {selectedUserIds.size}
            </span>
            <span className="text-xs font-bold text-indigo-950">
              nhân viên được chọn
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-500">Áp dụng:</span>
            <button
              type="button"
              onClick={() => bulkSetForSelectedUsers("canAskLark", true)}
              className="flex items-center gap-1 rounded-lg bg-white border border-indigo-200 px-2.5 py-1 text-xs font-bold text-indigo-700 shadow-2xs hover:bg-indigo-50 cursor-pointer"
            >
              <ChatCircleDotsIcon size={13} weight="fill" /> + Hỏi đáp
            </button>
            <button
              type="button"
              onClick={() => bulkSetForSelectedUsers("canAskLark", false)}
              className="rounded-lg bg-white border border-slate-200 px-2 py-1 text-xs font-bold text-slate-600 shadow-2xs hover:bg-slate-50 cursor-pointer"
            >
              - Hỏi đáp
            </button>

            <button
              type="button"
              onClick={() => bulkSetForSelectedUsers("receiveActionNotifications", true)}
              className="flex items-center gap-1 rounded-lg bg-white border border-amber-200 px-2.5 py-1 text-xs font-bold text-amber-700 shadow-2xs hover:bg-amber-50 cursor-pointer"
            >
              <BellRingingIcon size={13} weight="fill" /> + Nhận action
            </button>
            <button
              type="button"
              onClick={() => bulkSetForSelectedUsers("receiveActionNotifications", false)}
              className="rounded-lg bg-white border border-slate-200 px-2 py-1 text-xs font-bold text-slate-600 shadow-2xs hover:bg-slate-50 cursor-pointer"
            >
              - Nhận action
            </button>

            <button
              type="button"
              onClick={() => bulkSetBothForSelectedUsers(true)}
              className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-black text-white shadow-2xs hover:bg-indigo-700 cursor-pointer"
            >
              Cấp Full
            </button>
            <button
              type="button"
              onClick={() => bulkSetBothForSelectedUsers(false)}
              className="rounded-lg bg-white border border-slate-200 px-2 py-1 text-xs font-bold text-slate-600 shadow-2xs hover:bg-slate-50 cursor-pointer"
            >
              Gỡ hết
            </button>

            <button
              type="button"
              onClick={() => setSelectedUserIds(new Set())}
              className="rounded-lg px-2 py-1 text-xs font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              Hủy chọn
            </button>
          </div>
        </div>
      ) : null}

      {/* 4. BẢNG MA TRẬN DUY NHẤT: NGƯỜI DÙNG × STORE */}
      {loading ? (
        <div className="p-8 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          <p className="mt-3 text-xs font-bold text-slate-500">Đang tải danh sách phân quyền...</p>
        </div>
      ) : stores.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <StorefrontIcon className="mx-auto text-slate-300" size={40} />
          <p className="mt-3 text-sm font-bold text-slate-700">Chưa có PPC store nào để phân quyền.</p>
        </div>
      ) : users.length === 0 ? (
        <div className="px-5 py-12 text-center text-sm font-semibold text-slate-600">
          Chưa có tài khoản nhân viên nào được duyệt trong hệ thống.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/90 text-[11px] font-black text-slate-700">
                {/* CỘT NHÂN VIÊN */}
                <th className="sticky left-0 z-20 bg-slate-50 px-4 py-3 min-w-[230px] max-w-[280px]">
                  <div className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={
                        filteredUsers.length > 0 &&
                        filteredUsers.every((u) => selectedUserIds.has(u.userId))
                      }
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedUserIds(new Set(filteredUsers.map((u) => u.userId)));
                        } else {
                          setSelectedUserIds(new Set());
                        }
                      }}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      title="Chọn tất cả nhân viên đang hiển thị"
                    />
                    <span>Nhân viên ({filteredUsers.length})</span>
                  </div>
                </th>

                {/* CÁC CỘT STORE */}
                {stores.map((store) => {
                  const shortName = getStoreShortName(store.name);
                  const askCount = users.filter((u) =>
                    Boolean(grants.get(grantKey(store.id, u.userId))?.canAskLark),
                  ).length;
                  const actionCount = users.filter((u) =>
                    Boolean(grants.get(grantKey(store.id, u.userId))?.receiveActionNotifications),
                  ).length;

                  return (
                    <th
                      key={store.id}
                      className="px-3 py-3 text-center border-l border-slate-200/70 min-w-[105px]"
                    >
                      <div className="flex flex-col items-center">
                        <span
                          className="font-black text-slate-900 tracking-tight truncate max-w-[110px]"
                          title={store.name}
                        >
                          {shortName}
                        </span>

                        {/* COUNTER & QUICK TOGGLES CHO CỘT */}
                        <div className="mt-1 flex items-center gap-1.5 text-[10px] font-bold">
                          <button
                            type="button"
                            onClick={() => toggleStoreColumnField(store.id, "canAskLark")}
                            className="flex items-center gap-0.5 rounded px-1 py-0.5 text-indigo-700 hover:bg-indigo-100/70 cursor-pointer"
                            title={`Bật/tắt quyền Hỏi đáp Lark cho toàn bộ cột ${store.name}`}
                          >
                            <ChatCircleDotsIcon size={11} weight="fill" />
                            <span>{askCount}</span>
                          </button>
                          <span className="text-slate-300">•</span>
                          <button
                            type="button"
                            onClick={() => toggleStoreColumnField(store.id, "receiveActionNotifications")}
                            className="flex items-center gap-0.5 rounded px-1 py-0.5 text-amber-700 hover:bg-amber-100/70 cursor-pointer"
                            title={`Bật/tắt quyền Nhận action PPC cho toàn bộ cột ${store.name}`}
                          >
                            <BellRingingIcon size={11} weight="fill" />
                            <span>{actionCount}</span>
                          </button>
                        </div>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredUsers.map((user) => {
                const isSelected = selectedUserIds.has(user.userId);
                const userActiveStoreCount = stores.filter((s) => {
                  const g = grants.get(grantKey(s.id, user.userId));
                  return Boolean(g?.canAskLark || g?.receiveActionNotifications);
                }).length;

                return (
                  <tr
                    key={user.userId}
                    className={`transition hover:bg-indigo-50/20 ${
                      isSelected ? "bg-indigo-50/50" : ""
                    }`}
                  >
                    {/* CỘT THÔNG TIN NHÂN VIÊN (STICKY) */}
                    <td className="sticky left-0 z-10 bg-inherit px-4 py-3 border-r border-slate-200/80">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              setSelectedUserIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(user.userId);
                                else next.delete(user.userId);
                                return next;
                              });
                            }}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                          <div
                            className="min-w-0 cursor-pointer group"
                            onClick={() => setDrawerUserId(user.userId)}
                            title="Nhấn để mở panel cấu hình chi tiết cho nhân viên này"
                          >
                            <p className="truncate font-bold text-slate-900 group-hover:text-indigo-600 group-hover:underline">
                              {user.displayName || user.username}
                            </p>
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-[10px] text-slate-400">
                                {user.username}
                              </span>
                              <span className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.2 text-[9px] font-semibold text-slate-500">
                                {userActiveStoreCount}/{stores.length}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => setDrawerUserId(user.userId)}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-indigo-700 transition cursor-pointer"
                            title="Mở panel chỉnh quyền nhân viên này"
                          >
                            <SlidersHorizontalIcon size={15} weight="bold" />
                          </button>
                        </div>
                      </div>
                    </td>

                    {/* CÁC Ô GIAO (STORE × USER): HIỂN THỊ CẢ 2 BIỂU TƯỢNG VÀ TICK TRỰC TIẾP */}
                    {stores.map((store) => {
                      const key = grantKey(store.id, user.userId);
                      const grant = grants.get(key);
                      const hasLark = Boolean(grant?.canAskLark);
                      const hasAction = Boolean(grant?.receiveActionNotifications);

                      return (
                        <td
                          key={store.id}
                          className="px-2 py-2 text-center border-l border-slate-100/80 align-middle"
                        >
                          <div className="flex items-center justify-center gap-1.5">
                            {/* NÚT TOGGLE HỎI ĐÁP LARK */}
                            <button
                              type="button"
                              onClick={() => toggleCellGrant(store.id, user.userId, "canAskLark")}
                              className={`flex h-7 w-7 items-center justify-center rounded-lg border transition cursor-pointer ${
                                hasLark
                                  ? "border-indigo-600 bg-indigo-600 text-white shadow-2xs hover:bg-indigo-700"
                                  : "border-slate-200 bg-slate-50 text-slate-300 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-500"
                              }`}
                              title={`${user.displayName || user.username} @ ${store.name}: ${
                                hasLark ? "ĐANG ĐƯỢC hỏi đáp (Click để bỏ)" : "CHƯA được hỏi đáp (Click để cấp)"
                              }`}
                            >
                              <ChatCircleDotsIcon size={15} weight={hasLark ? "fill" : "regular"} />
                            </button>

                            {/* NÚT TOGGLE NHẬN ACTION PPC */}
                            <button
                              type="button"
                              onClick={() => toggleCellGrant(store.id, user.userId, "receiveActionNotifications")}
                              className={`flex h-7 w-7 items-center justify-center rounded-lg border transition cursor-pointer ${
                                hasAction
                                  ? "border-amber-500 bg-amber-500 text-white shadow-2xs hover:bg-amber-600"
                                  : "border-slate-200 bg-slate-50 text-slate-300 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-500"
                              }`}
                              title={`${user.displayName || user.username} @ ${store.name}: ${
                                hasAction ? "ĐANG ĐƯỢC nhận action (Click để bỏ)" : "CHƯA được nhận action (Click để cấp)"
                              }`}
                            >
                              <BellRingingIcon size={15} weight={hasAction ? "fill" : "regular"} />
                            </button>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* FOOTER TINH GỌN */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-2.5 text-xs text-slate-500">
        <p className="font-medium text-slate-500">
          Mẹo: Nhấp icon để bật/tắt • Nhấp tên nhân viên hoặc tên Store để cấu hình nhanh.
        </p>
        <button
          type="button"
          onClick={() => setShowHelpDrawer(true)}
          className="inline-flex items-center gap-1.5 font-bold text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer"
        >
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 font-black text-[10px]">
            i
          </span>
          <span>Xem hướng dẫn chi tiết</span>
        </button>
      </div>

      {/* 5. SIDE PANEL / DRAWER CHỈNH QUYỀN THEO NHÂN VIÊN */}
      {drawerUser ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-2xs animate-in fade-in duration-200">
          <div className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl animate-in slide-in-from-right duration-200">
            {/* Header Drawer */}
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 bg-slate-50">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-100 text-indigo-700 font-black text-sm">
                  {drawerUser.displayName?.charAt(0) || drawerUser.username.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900">{drawerUser.displayName || drawerUser.username}</h3>
                  <p className="text-xs text-slate-500 font-medium">Cấu hình quyền truy cập Store</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDrawerUserId(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 cursor-pointer transition"
              >
                <XIcon size={18} weight="bold" />
              </button>
            </div>

            {/* Nội dung Drawer */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* PHẦN 1: STORE ĐƯỢC PHÂN QUYỀN */}
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-700">
                    Store được phân quyền
                  </h4>
                  <div className="flex items-center gap-2 text-[11px] font-bold text-indigo-600">
                    <button
                      type="button"
                      onClick={() => {
                        setGrants((curr) => {
                          const next = new Map(curr);
                          for (const s of stores) {
                            const key = grantKey(s.id, drawerUser.userId);
                            const prev = next.get(key) || {
                              storeId: s.id,
                              actorId: drawerUser.userId,
                              canAskLark: false,
                              receiveActionNotifications: false,
                            };
                            next.set(key, { ...prev, canAskLark: true, receiveActionNotifications: true });
                          }
                          return next;
                        });
                      }}
                      className="hover:underline cursor-pointer"
                    >
                      Cấp tất cả
                    </button>
                    <span>•</span>
                    <button
                      type="button"
                      onClick={() => {
                        setGrants((curr) => {
                          const next = new Map(curr);
                          for (const s of stores) {
                            const key = grantKey(s.id, drawerUser.userId);
                            next.set(key, {
                              storeId: s.id,
                              actorId: drawerUser.userId,
                              canAskLark: false,
                              receiveActionNotifications: false,
                            });
                          }
                          return next;
                        });
                      }}
                      className="text-slate-500 hover:underline cursor-pointer"
                    >
                      Bỏ tất cả
                    </button>
                  </div>
                </div>

                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-2xs">
                  {stores.map((store) => {
                    const key = grantKey(store.id, drawerUser.userId);
                    const grant = grants.get(key);

                    return (
                      <div
                        key={store.id}
                        className="flex items-center justify-between p-3 transition hover:bg-slate-50"
                      >
                        <span className="text-xs font-bold text-slate-800">{store.name}</span>
                        <div className="flex items-center gap-2">
                          <label
                            className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold transition ${
                              grant?.canAskLark
                                ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                                : "border-slate-200 text-slate-500 hover:bg-slate-50"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(grant?.canAskLark)}
                              onChange={() =>
                                toggleCellGrant(store.id, drawerUser.userId, "canAskLark")
                              }
                              className="hidden"
                            />
                            <ChatCircleDotsIcon size={14} weight={grant?.canAskLark ? "fill" : "bold"} />
                            Hỏi đáp
                          </label>

                          <label
                            className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold transition ${
                              grant?.receiveActionNotifications
                                ? "border-amber-300 bg-amber-50 text-amber-700"
                                : "border-slate-200 text-slate-500 hover:bg-slate-50"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(grant?.receiveActionNotifications)}
                              onChange={() =>
                                toggleCellGrant(store.id, drawerUser.userId, "receiveActionNotifications")
                              }
                              className="hidden"
                            />
                            <BellRingingIcon size={14} weight={grant?.receiveActionNotifications ? "fill" : "bold"} />
                            Nhận action
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* PHẦN 2: THAO TÁC NHANH CHO TẤT CẢ STORE CỦA NGƯỜI NÀY */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                <h4 className="text-xs font-black text-slate-800 mb-2">Quyền áp dụng hàng loạt cho tất cả Store</h4>
                <div className="space-y-2">
                  <label className="flex items-center gap-2.5 text-xs font-bold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={stores.every((s) => grants.get(grantKey(s.id, drawerUser.userId))?.canAskLark)}
                      onChange={(e) => {
                        const val = e.target.checked;
                        setGrants((curr) => {
                          const next = new Map(curr);
                          for (const s of stores) {
                            const k = grantKey(s.id, drawerUser.userId);
                            const prev = next.get(k) || {
                              storeId: s.id,
                              actorId: drawerUser.userId,
                              canAskLark: false,
                              receiveActionNotifications: false,
                            };
                            next.set(k, { ...prev, canAskLark: val });
                          }
                          return next;
                        });
                      }}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Cho phép hỏi đáp toàn bộ Store trên Lark</span>
                  </label>

                  <label className="flex items-center gap-2.5 text-xs font-bold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={stores.every((s) => grants.get(grantKey(s.id, drawerUser.userId))?.receiveActionNotifications)}
                      onChange={(e) => {
                        const val = e.target.checked;
                        setGrants((curr) => {
                          const next = new Map(curr);
                          for (const s of stores) {
                            const k = grantKey(s.id, drawerUser.userId);
                            const prev = next.get(k) || {
                              storeId: s.id,
                              actorId: drawerUser.userId,
                              canAskLark: false,
                              receiveActionNotifications: false,
                            };
                            next.set(k, { ...prev, receiveActionNotifications: val });
                          }
                          return next;
                        });
                      }}
                      className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                    />
                    <span>Nhận thông báo action toàn bộ Store</span>
                  </label>
                </div>
                <p className="mt-2.5 text-[10px] text-slate-500 leading-relaxed font-medium">
                  Lưu ý: Hai quyền này hoàn toàn độc lập. Người được hỏi đáp không mặc nhiên nhận thông báo và ngược lại.
                </p>
              </div>

              {/* PHẦN 3: SAO CHÉP TỪ NGƯỜI KHÁC */}
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h4 className="text-xs font-black text-slate-800 mb-1.5 flex items-center gap-1.5">
                  <CopyIcon size={14} weight="bold" />
                  Sao chép quyền từ nhân viên khác
                </h4>
                <div className="flex items-center gap-2 mt-2">
                  <select
                    className="flex-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                    onChange={(e) => {
                      const srcId = e.target.value;
                      if (!srcId) return;
                      setGrants((curr) => {
                        const next = new Map(curr);
                        for (const s of stores) {
                          const srcGrant = curr.get(grantKey(s.id, srcId));
                          const targetKey = grantKey(s.id, drawerUser.userId);
                          next.set(targetKey, {
                            storeId: s.id,
                            actorId: drawerUser.userId,
                            canAskLark: Boolean(srcGrant?.canAskLark),
                            receiveActionNotifications: Boolean(srcGrant?.receiveActionNotifications),
                          });
                        }
                        return next;
                      });
                      setNotice(`Đã sao chép cấu hình sang ${drawerUser.displayName || drawerUser.username}.`);
                    }}
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Chọn nhân viên mẫu...
                    </option>
                    {users
                      .filter((u) => u.userId !== drawerUser.userId)
                      .map((u) => (
                        <option key={u.userId} value={u.userId}>
                          {u.displayName || u.username} ({u.username})
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Footer Drawer */}
            <div className="border-t border-slate-200 p-4 bg-slate-50 flex items-center justify-between">
              <span className="text-xs text-slate-500 font-medium">
                {hasUnsavedChanges ? "Có thay đổi chưa lưu" : "Chưa có thay đổi"}
              </span>
              <button
                type="button"
                onClick={() => setDrawerUserId(null)}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-2xs hover:bg-indigo-700 cursor-pointer"
              >
                Đóng Panel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 6. SIDE PANEL / DRAWER HƯỚNG DẪN CHI TIẾT */}
      {showHelpDrawer ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-2xs animate-in fade-in duration-200">
          <div className="flex h-full w-full max-w-lg flex-col bg-white shadow-2xl animate-in slide-in-from-right duration-200">
            {/* Header Drawer */}
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-gradient-to-r from-indigo-50/60 to-white">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-600 text-white shadow-xs">
                  <InfoIcon size={20} weight="bold" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900">Hướng dẫn sử dụng Phân quyền Store</h3>
                  <p className="text-xs text-slate-500 font-medium">Quy tắc phân quyền & mẹo thao tác nhanh</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowHelpDrawer(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 cursor-pointer transition"
                title="Đóng hướng dẫn"
              >
                <XIcon size={18} weight="bold" />
              </button>
            </div>

            {/* Nội dung Drawer */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs text-slate-600 leading-relaxed">
              {/* PHẦN 1: Ý NGHĨA 2 QUYỀN */}
              <div className="space-y-3">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-900 border-b border-slate-100 pb-1.5">
                  1. Ý nghĩa 2 loại quyền truy cập
                </h4>

                {/* Quyền 1: Hỏi đáp Lark */}
                <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3.5 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-indigo-600 text-white shadow-2xs">
                      <ChatCircleDotsIcon size={13} weight="fill" />
                    </span>
                    <span className="text-xs font-black text-indigo-950">Quyền 1: Hỏi đáp Lark</span>
                  </div>
                  <ul className="list-disc pl-5 space-y-1 text-slate-700 font-medium">
                    <li>
                      <strong>Chức năng:</strong> Cho phép nhân sự nhắn tin qua bot Lark để tra cứu dữ liệu doanh thu, chi phí Ads, ACOS, orders và SKU của Store này.
                    </li>
                    <li>
                      <strong>Bảo mật:</strong> Nếu nhân sự không được cấp quyền cho Store, bot sẽ từ chối trả lời số liệu liên quan đến Store đó.
                    </li>
                  </ul>
                </div>

                {/* Quyền 2: Action PPC */}
                <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-3.5 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-amber-500 text-white shadow-2xs">
                      <BellRingingIcon size={13} weight="fill" />
                    </span>
                    <span className="text-xs font-black text-amber-950">Quyền 2: Quản lý Action PPC</span>
                  </div>
                  <ul className="list-disc pl-5 space-y-1 text-slate-700 font-medium">
                    <li>
                      <strong>Thao tác:</strong> Chỉ nhân sự được gán quyền cho Store mới có thể thực hiện thao tác PPC trên Store đó (phủ định Negative KW, chỉnh Bid, tạo Campaign từ khóa, Auto-upload tối ưu).
                    </li>
                    <li>
                      <strong>Thông báo cá nhân:</strong> Khi bạn thực hiện action, bot Lark sẽ <strong>chỉ gửi thông báo riêng đến tài khoản của bạn</strong> để đối soát kết quả, không làm phiền người khác và không gửi vào nhóm chung.
                    </li>
                    <li>
                      <strong>Không gửi spam:</strong> Việc tải file PPC thủ công hoặc đồng bộ kế toán không gửi thông báo Lark.
                    </li>
                  </ul>
                </div>
              </div>

              {/* PHẦN 2: CÁCH THAO TÁC CỰC NHANH TRÊN BẢNG */}
              <div className="space-y-3">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-900 border-b border-slate-100 pb-1.5">
                  2. Mẹo thao tác nhanh trên ma trận
                </h4>

                <div className="grid grid-cols-1 gap-2.5">
                  <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    <p className="font-black text-slate-800">⚡ Bật / tắt trực tiếp tại ô</p>
                    <p className="mt-1 text-slate-600">
                      Click vào biểu tượng 💬 hoặc 🔔 tại ô giao giữa Nhân viên và Store. Icon sáng màu là đang được cấp, icon xám là chưa cấp.
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    <p className="font-black text-slate-800">👤 Cấu hình nhanh theo nhân viên</p>
                    <p className="mt-1 text-slate-600">
                      Click vào <strong>tên nhân viên</strong> hoặc icon ⚙️ ở cột đầu để mở bảng cấu hình riêng. Tại đây bạn có thể bấm <em>&ldquo;Cấp tất cả&rdquo;</em> hoặc <em>&ldquo;Bỏ tất cả&rdquo;</em> các Store chỉ với 1 click.
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    <p className="font-black text-slate-800">🏬 Cấu hình nhanh theo Store</p>
                    <p className="mt-1 text-slate-600">
                      Click vào <strong>tiêu đề Store</strong> ở đầu cột (ví dụ: BOZSPA, FASTPE...) để bật hoặc tắt quyền cho toàn bộ nhân viên đối với Store đó.
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    <p className="font-black text-slate-800">☑️ Thao tác hàng loạt nhiều người</p>
                    <p className="mt-1 text-slate-600">
                      Tick vào ô checkbox bên trái của nhiều nhân viên. Thanh công cụ màu tím sẽ hiện lên ở trên bảng để bạn cấp/bỏ quyền cùng lúc cho tất cả người đã chọn.
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    <p className="font-black text-slate-800">📋 Sao chép cấu hình</p>
                    <p className="mt-1 text-slate-600">
                      Bấm nút <strong>&ldquo;Sao chép cấu hình&rdquo;</strong> ở thanh tìm kiếm để copy nhanh toàn bộ thiết lập từ một nhân viên mẫu sang các nhân viên khác.
                    </p>
                  </div>
                </div>
              </div>

              {/* PHẦN 3: LƯU Ý QUAN TRỌNG */}
              <div className="space-y-3">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-900 border-b border-slate-100 pb-1.5">
                  3. Lưu ý quan trọng
                </h4>

                <div className="rounded-xl border border-slate-200 bg-amber-50/50 p-3 space-y-2 text-slate-700">
                  <p>
                    👑 <strong>Admin cũng tự cấu hình quyền:</strong> Admin cần tự tick chọn các Store mình phụ trách để hệ thống ghi nhận đúng phạm vi hành động và gửi thông báo cá nhân tương ứng.
                  </p>
                  <p>
                    📊 <strong>Nhân sự Kế toán (Accounting):</strong> Kế toán chỉ cần tick chọn <em>&ldquo;Accounting&rdquo;</em> trong phần <em>Cài đặt thông báo</em> (modal Cài đặt) để nhận báo cáo tài chính hàng ngày lúc sáng sớm, không cần cấp quyền Action PPC lẻ ở bảng này.
                  </p>
                  <p>
                    💾 <strong>Đừng quên Lưu thay đổi:</strong> Sau khi cấu hình xong, hãy nhớ nhấn nút <strong>&ldquo;Lưu thay đổi&rdquo;</strong> màu tím ở góc phải trên.
                  </p>
                </div>
              </div>
            </div>

            {/* Footer Drawer */}
            <div className="flex items-center justify-end border-t border-slate-200 px-6 py-3.5 bg-slate-50">
              <button
                type="button"
                onClick={() => setShowHelpDrawer(false)}
                className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-black text-white shadow-2xs hover:bg-indigo-700 cursor-pointer transition active:scale-98"
              >
                Đã hiểu & Đóng
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 6. MODAL SAO CHÉP CẤU HÌNH HÀNG LOẠT */}
      {showCopyModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-2xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <CopyIcon className="text-indigo-600" size={18} weight="bold" />
                <h3 className="text-sm font-black text-slate-900">Sao chép cấu hình phân quyền</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCopyModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
              >
                <XIcon size={16} />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  1. Chọn nhân viên nguồn (mẫu quyền):
                </label>
                <select
                  value={copySourceUserId}
                  onChange={(e) => setCopySourceUserId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-xs font-bold text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                >
                  {users.map((u) => (
                    <option key={u.userId} value={u.userId}>
                      {u.displayName || u.username} ({u.username})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-extrabold text-slate-700">
                    2. Áp dụng cho các nhân viên đích ({copyTargetUserIds.size} đã chọn):
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const allOthers = users
                        .filter((u) => u.userId !== copySourceUserId)
                        .map((u) => u.userId);
                      if (copyTargetUserIds.size === allOthers.length) {
                        setCopyTargetUserIds(new Set());
                      } else {
                        setCopyTargetUserIds(new Set(allOthers));
                      }
                    }}
                    className="text-[11px] font-bold text-indigo-600 hover:underline cursor-pointer"
                  >
                    {copyTargetUserIds.size === users.length - 1 ? "Bỏ chọn tất cả" : "Chọn tất cả"}
                  </button>
                </div>

                <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-200 bg-slate-50 p-2">
                  {users
                    .filter((u) => u.userId !== copySourceUserId)
                    .map((u) => {
                      const checked = copyTargetUserIds.has(u.userId);
                      return (
                        <label
                          key={u.userId}
                          className="flex items-center gap-2.5 p-2 text-xs font-bold text-slate-800 hover:bg-white rounded-lg cursor-pointer transition"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setCopyTargetUserIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(u.userId);
                                else next.delete(u.userId);
                                return next;
                              });
                            }}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span>{u.displayName || u.username}</span>
                          <span className="text-[10px] text-slate-400 font-normal">({u.username})</span>
                        </label>
                      );
                    })}
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2.5 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => setShowCopyModal(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={!copySourceUserId || copyTargetUserIds.size === 0}
                onClick={executeCopyPermissions}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-2xs hover:bg-indigo-700 cursor-pointer disabled:opacity-50"
              >
                Áp dụng sao chép ({copyTargetUserIds.size} người)
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
