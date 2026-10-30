"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwiseIcon,
  CaretDownIcon,
  CheckCircleIcon,
  CheckIcon,
  FloppyDiskIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { listTeams } from "@/lib/accounting/store-teams";

interface AccessUser {
  userId: string;
  username: string;
  displayName: string;
  role: string;
}

interface AccessGrant {
  actorId: string;
  storeTeam: string;
  canEdit: boolean;
}

/** Quyền của 1 người: các team được gán + 1 mức quyền chung cho các team đó. */
interface UserAccess {
  teams: string[];
  canEdit: boolean;
}

const FULL_ROLES: Record<string, string> = { admin: "Admin", accountant: "Kế toán" };

const isFbmTeam = (team: string) => /^fbm$/i.test(team);
const isChannelTeam = (team: string) => isFbmTeam(team) || /^fba\b/i.test(team);

const sameAccess = (a: UserAccess | undefined, b: UserAccess | undefined) =>
  (a?.teams.length ?? 0) === (b?.teams.length ?? 0) &&
  (!a?.teams.length || (a.canEdit === b!.canEdit && a.teams.every((t) => b!.teams.includes(t))));

/** Dropdown chọn nhiều team. */
function TeamSelect({ teams, value, onChange }: { teams: string[]; value: string[]; onChange: (next: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const allSelected = teams.length > 0 && teams.every((t) => value.includes(t));
  const toggle = (team: string) =>
    onChange(value.includes(team) ? value.filter((t) => t !== team) : teams.filter((t) => t === team || value.includes(t)));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-8 w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-left text-xs transition hover:border-slate-300 cursor-pointer"
      >
        <span className="flex min-w-0 flex-wrap gap-1">
          {allSelected ? (
            <span className="rounded bg-indigo-50 px-1.5 py-px text-[11px] font-bold text-indigo-700">Tất cả</span>
          ) : value.length ? (
            value.map((team) => (
              <span
                key={team}
                className={`rounded px-1.5 py-px text-[11px] font-bold ${
                  isFbmTeam(team) ? "bg-violet-50 text-violet-700" : "bg-sky-50 text-sky-700"
                }`}
              >
                {team}
              </span>
            ))
          ) : (
            <span className="text-slate-400">Chưa có team</span>
          )}
        </span>
        <CaretDownIcon size={12} weight="bold" className="shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          <button
            type="button"
            onClick={() => onChange(allSelected ? [] : [...teams])}
            className="flex w-full items-center gap-2 rounded-md border-b border-slate-100 px-2 py-1.5 text-left text-xs font-bold text-slate-900 hover:bg-slate-50 cursor-pointer"
          >
            <span
              className={`grid h-4 w-4 place-items-center rounded border ${
                allSelected ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white"
              }`}
            >
              {allSelected && <CheckIcon size={10} weight="bold" />}
            </span>
            Tất cả
          </button>
          {teams.map((team) => {
            const checked = value.includes(team);
            return (
              <button
                key={team}
                type="button"
                onClick={() => toggle(team)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <span
                  className={`grid h-4 w-4 place-items-center rounded border ${
                    checked ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white"
                  }`}
                >
                  {checked && <CheckIcon size={10} weight="bold" />}
                </span>
                {team}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Phân quyền kế toán: mỗi người 1 dòng — tên, tài khoản, team, quyền Xem / Sửa. */
export function AccountingAccessView() {
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [saved, setSaved] = useState<Map<string, UserAccess>>(new Map());
  const [draft, setDraft] = useState<Map<string, UserAccess>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");

  // Tăng để tải lại (nút Làm mới)
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/accounting/access", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as {
          users?: AccessUser[];
          stores?: { team: string; status: string }[];
          grants?: AccessGrant[];
          error?: string;
        };
        if (!res.ok) throw new Error(body.error || "Không tải được phân quyền.");
        // Chỉ team FBA… / FBM mới cấp quyền xem số liệu
        const teamList = listTeams((body.stores ?? []).filter((s) => s.status !== "inactive")).filter(isChannelTeam);
        const map = new Map<string, UserAccess>();
        for (const g of body.grants ?? []) {
          const team = teamList.find((t) => t.toUpperCase() === g.storeTeam.toUpperCase()) ?? g.storeTeam;
          const entry = map.get(g.actorId) ?? { teams: [], canEdit: false };
          entry.teams.push(team);
          entry.canEdit ||= g.canEdit;
          map.set(g.actorId, entry);
        }
        setUsers(body.users ?? []);
        setTeams(teamList);
        setSaved(map);
        setDraft(new Map(map));
        setError("");
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Không tải được phân quyền.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reloadKey]);

  const reload = () => {
    setLoading(true);
    setNotice("");
    setReloadKey((k) => k + 1);
  };

  const update = (userId: string, patch: Partial<UserAccess>) =>
    setDraft((prev) => {
      const next = new Map(prev);
      const current = next.get(userId) ?? { teams: [], canEdit: false };
      next.set(userId, { ...current, ...patch });
      return next;
    });

  const dirty = useMemo(
    () => users.some((u) => !sameAccess(draft.get(u.userId), saved.get(u.userId))),
    [users, draft, saved],
  );

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const grants: AccessGrant[] = [];
      for (const [actorId, access] of draft) {
        for (const team of access.teams) grants.push({ actorId, storeTeam: team, canEdit: access.canEdit });
      }
      const res = await fetch("/api/accounting/access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grants }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Không lưu được phân quyền.");
      setSaved(new Map(draft));
      setNotice("Đã lưu.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không lưu được phân quyền.");
    } finally {
      setSaving(false);
    }
  };

  const q = search.trim().toLowerCase();
  // Admin / Kế toán luôn lên đầu, giữ thứ tự tên trong từng nhóm
  const visibleUsers = users
    .filter((u) => !q || u.displayName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q))
    .sort((a, b) => Number(!FULL_ROLES[a.role]) - Number(!FULL_ROLES[b.role]));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 py-3 sm:py-6">
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-50 text-indigo-700">
              <ShieldCheckIcon size={19} weight="fill" />
            </div>
            <h2 className="text-sm font-extrabold text-slate-900">Phân quyền</h2>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-48">
              <MagnifyingGlassIcon size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Tìm người dùng..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-7 pr-2.5 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white"
              />
            </div>
            <button
              type="button"
              onClick={reload}
              disabled={loading || saving}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
            >
              <ArrowClockwiseIcon size={13} weight="bold" className={loading ? "animate-spin" : ""} />
              Làm mới
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!dirty || saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-bold text-white shadow-2xs transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              <FloppyDiskIcon size={13} weight="bold" />
              {saving ? "Đang lưu..." : "Lưu"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-5 mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-red-800" role="alert">
            <WarningCircleIcon className="mt-0.5 shrink-0" size={16} weight="fill" />
            <p className="text-xs font-semibold">{error}</p>
          </div>
        )}
        {notice && (
          <div className="mx-5 mt-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-emerald-800" role="status">
            <CheckCircleIcon className="mt-0.5 shrink-0" size={16} weight="fill" />
            <p className="text-xs font-semibold">{notice}</p>
          </div>
        )}

        {loading && users.length === 0 ? (
          <div className="grid gap-3 p-5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : (
          <div className="p-5 pt-4">
            {/* Không bọc overflow để dropdown Team không bị cắt ở các dòng cuối */}
            <table className="w-full border-separate border-spacing-0 text-left text-xs">
              <thead>
                <tr className="text-[12px] font-semibold text-slate-500">
                  <th className="rounded-l-lg bg-slate-50 px-3 py-2.5">Tên</th>
                  <th className="bg-slate-50 px-3 py-2.5">Tài khoản</th>
                  <th className="w-[38%] bg-slate-50 px-3 py-2.5">Team</th>
                  <th className="w-32 rounded-r-lg bg-slate-50 px-3 py-2.5">Quyền</th>
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map((user) => {
                  const fullRole = FULL_ROLES[user.role];
                  const access = draft.get(user.userId);
                  return (
                    <tr key={user.userId}>
                      <td className="border-b border-slate-100 px-3 py-2 font-bold text-slate-900">
                        {user.displayName || user.username}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2 text-slate-600">{user.username}</td>
                      {fullRole ? (
                        <td colSpan={2} className="border-b border-slate-100 px-3 py-2">
                          <span className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[11px] font-bold text-indigo-700">
                            {fullRole} · tất cả store
                          </span>
                        </td>
                      ) : (
                        <>
                          <td className="border-b border-slate-100 px-3 py-2">
                            <TeamSelect
                              teams={teams}
                              value={access?.teams ?? []}
                              onChange={(next) => update(user.userId, { teams: next })}
                            />
                          </td>
                          <td className="border-b border-slate-100 px-3 py-2">
                            <select
                              value={access?.canEdit ? "edit" : "view"}
                              onChange={(e) => update(user.userId, { canEdit: e.target.value === "edit" })}
                              disabled={!access?.teams.length}
                              className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 disabled:bg-slate-50 disabled:text-slate-400 cursor-pointer"
                            >
                              <option value="view">Xem</option>
                              <option value="edit">Sửa</option>
                            </select>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
                {visibleUsers.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-xs text-slate-500">
                      Không có người dùng nào.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
