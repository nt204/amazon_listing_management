"use client";

import {
  BellRingingIcon,
  ChatCircleDotsIcon,
  CheckCircleIcon,
  FloppyDiskIcon,
  StorefrontIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";

type Store = { id: string; name: string };
type User = { userId: string; username: string; displayName: string };
type Grant = {
  storeId: string;
  actorId: string;
  canAskLark: boolean;
  receiveActionNotifications: boolean;
};

const grantKey = (storeId: string, actorId: string) => `${storeId}:${actorId}`;

export function PpcStoreAccessPanel() {
  const [stores, setStores] = useState<Store[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [grants, setGrants] = useState<Map<string, Grant>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/ppc-store-access", { cache: "no-store" });
      const body = await response.json() as {
        stores?: Store[];
        users?: User[];
        grants?: Grant[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "Không thể tải phân quyền store.");
      setStores(body.stores || []);
      setUsers(body.users || []);
      setGrants(new Map((body.grants || []).map((grant) => [grantKey(grant.storeId, grant.actorId), grant])));
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

  const activeGrantCount = useMemo(
    () => Array.from(grants.values()).filter((grant) => grant.canAskLark || grant.receiveActionNotifications).length,
    [grants],
  );

  function updateGrant(storeId: string, actorId: string, field: "canAskLark" | "receiveActionNotifications", checked: boolean) {
    setNotice("");
    setGrants((current) => {
      const next = new Map(current);
      const key = grantKey(storeId, actorId);
      const previous = next.get(key) || {
        storeId,
        actorId,
        canAskLark: false,
        receiveActionNotifications: false,
      };
      next.set(key, { ...previous, [field]: checked });
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/ppc-store-access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grants: Array.from(grants.values()) }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Không thể lưu phân quyền store.");
      setNotice("Đã lưu quyền hỏi đáp và nhận thông báo theo store.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Không thể lưu phân quyền store.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-50 text-indigo-700">
            <StorefrontIcon size={19} weight="fill" />
          </div>
          <div>
            <h2 className="text-sm font-extrabold text-slate-900">Phân quyền Lark theo PPC Store</h2>
            <p className="mt-0.5 text-[11px] font-medium text-slate-500">
              {stores.length} store, {activeGrantCount} lượt gán người dùng
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={loading || saving}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-bold text-white shadow-2xs transition hover:bg-indigo-700 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
        >
          <FloppyDiskIcon size={14} weight="bold" />
          {saving ? "Đang lưu..." : "Lưu phân quyền store"}
        </button>
      </div>

      <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 text-[11px] leading-5 text-slate-600 sm:px-5">
        <span className="font-bold text-slate-800">Hỏi đáp Lark</span> giới hạn dữ liệu bot được phép đọc.
        <span className="ml-1 font-bold text-slate-800">Nhận action</span> gửi kết quả upload và cảnh báo PPC theo đúng store.
      </div>

      {error ? (
        <div className="m-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-red-800" role="alert">
          <WarningCircleIcon className="mt-0.5 shrink-0" size={16} weight="fill" />
          <p className="text-[11px] font-semibold leading-5">{error}</p>
        </div>
      ) : null}
      {notice ? (
        <div className="m-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-emerald-800" role="status">
          <CheckCircleIcon className="mt-0.5 shrink-0" size={16} weight="fill" />
          <p className="text-[11px] font-semibold leading-5">{notice}</p>
        </div>
      ) : null}

      {loading ? (
        <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
          {[0, 1, 2, 3].map((item) => <div key={item} className="h-36 animate-pulse rounded-xl bg-slate-100" />)}
        </div>
      ) : stores.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <StorefrontIcon className="mx-auto text-slate-300" size={34} />
          <p className="mt-3 text-xs font-bold text-slate-700">Chưa có PPC store để phân quyền.</p>
        </div>
      ) : users.length === 0 ? (
        <div className="px-5 py-10 text-center text-xs font-semibold text-slate-600">
          Chưa có tài khoản đã duyệt để gán store.
        </div>
      ) : (
        <div className="grid gap-4 p-4 lg:grid-cols-2 sm:p-5">
          {stores.map((store) => (
            <article key={store.id} className="overflow-hidden rounded-xl border border-slate-200">
              <div className="flex items-center justify-between bg-slate-50 px-3.5 py-2.5">
                <h3 className="truncate text-xs font-black text-slate-900">{store.name}</h3>
                <span className="text-[10px] font-semibold text-slate-500">
                  {users.filter((user) => {
                    const grant = grants.get(grantKey(store.id, user.userId));
                    return grant?.canAskLark || grant?.receiveActionNotifications;
                  }).length} người
                </span>
              </div>
              <div className="divide-y divide-slate-100">
                {users.map((user) => {
                  const grant = grants.get(grantKey(store.id, user.userId));
                  return (
                    <div key={user.userId} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3.5 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-bold text-slate-800">{user.displayName || user.username}</p>
                        <p className="truncate text-[9px] text-slate-400">{user.username}</p>
                      </div>
                      <label className="flex cursor-pointer items-center gap-1.5 text-[10px] font-bold text-slate-600" title="Cho phép hỏi đáp dữ liệu store trên Lark">
                        <input
                          type="checkbox"
                          checked={Boolean(grant?.canAskLark)}
                          onChange={(event) => updateGrant(store.id, user.userId, "canAskLark", event.target.checked)}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <ChatCircleDotsIcon size={13} /> Hỏi đáp
                      </label>
                      <label className="flex cursor-pointer items-center gap-1.5 text-[10px] font-bold text-slate-600" title="Nhận thông báo action PPC của store">
                        <input
                          type="checkbox"
                          checked={Boolean(grant?.receiveActionNotifications)}
                          onChange={(event) => updateGrant(store.id, user.userId, "receiveActionNotifications", event.target.checked)}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <BellRingingIcon size={13} /> Nhận action
                      </label>
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
