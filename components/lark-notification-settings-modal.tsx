"use client";

import {
  BellRingingIcon,
  CheckCircleIcon,
  FlaskIcon,
  PlusIcon,
  TrashIcon,
  UserCircleIcon,
  UsersThreeIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Category = "listing" | "mockups" | "ppc" | "accounting";

type ChannelItem = {
  id: string;
  name: string;
  chatId: string;
  enabled: boolean;
  categories: Record<Category, boolean>;
};

type Snapshot = {
  isAdmin: boolean;
  allowedCategories: Category[];
  personal: { receiveId: string; receiveIdType: "email" | "open_id" | "user_id"; enabled: boolean };
  personalRules: Record<Category, boolean>;
  channels: ChannelItem[];
};

const categories: Array<{ id: Category; label: string }> = [
  { id: "listing", label: "Listing" },
  { id: "mockups", label: "Mockup" },
  { id: "ppc", label: "PPC" },
  { id: "accounting", label: "Kế toán" },
];

const emptySnapshot: Snapshot = {
  isAdmin: false,
  allowedCategories: [],
  personal: { receiveId: "", receiveIdType: "email", enabled: false },
  personalRules: { listing: false, mockups: false, ppc: false, accounting: false },
  channels: [],
};

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500/20 ${
        checked ? "bg-indigo-600" : "bg-slate-300"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export function LarkNotificationSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  const [settings, setSettings] = useState<Snapshot>(emptySnapshot);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string>("");
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const response = await fetch("/api/settings/lark", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Không thể tải cài đặt.");
      setSettings({
        isAdmin: Boolean(body.isAdmin),
        allowedCategories: Array.isArray(body.allowedCategories) && body.allowedCategories.length > 0
          ? body.allowedCategories
          : categories.map((c) => c.id),
        personal: {
          receiveId: body.personal?.receiveId || "",
          receiveIdType: body.personal?.receiveIdType || "email",
          enabled: Boolean(body.personal?.enabled),
        },
        personalRules: {
          listing: Boolean(body.personalRules?.listing),
          mockups: Boolean(body.personalRules?.mockups),
          ppc: Boolean(body.personalRules?.ppc),
          accounting: Boolean(body.personalRules?.accounting),
        },
        channels: Array.isArray(body.channels)
          ? body.channels.map((ch: any) => ({
              id: ch.id || "",
              name: ch.name || "",
              chatId: ch.chatId || "",
              enabled: ch.enabled ?? true,
              categories: {
                listing: Boolean(ch.categories?.listing),
                mockups: Boolean(ch.categories?.mockups),
                ppc: Boolean(ch.categories?.ppc),
                accounting: Boolean(ch.categories?.accounting),
              },
            }))
          : [],
      });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Không thể tải cài đặt." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!open || !mounted) return null;

  const allowedList = Array.isArray(settings.allowedCategories) && settings.allowedCategories.length > 0
    ? settings.allowedCategories
    : categories.map((c) => c.id);
  const visibleCategories = categories.filter((category) => allowedList.includes(category.id));

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch("/api/settings/lark", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Không thể lưu cài đặt.");
      setSettings((current) => ({
        isAdmin: typeof body.isAdmin === "boolean" ? body.isAdmin : current.isAdmin,
        allowedCategories: Array.isArray(body.allowedCategories) && body.allowedCategories.length > 0
          ? body.allowedCategories
          : current.allowedCategories,
        personal: {
          receiveId: body.personal?.receiveId || "",
          receiveIdType: body.personal?.receiveIdType || "email",
          enabled: Boolean(body.personal?.enabled),
        },
        personalRules: {
          listing: Boolean(body.personalRules?.listing),
          mockups: Boolean(body.personalRules?.mockups),
          ppc: Boolean(body.personalRules?.ppc),
          accounting: Boolean(body.personalRules?.accounting),
        },
        channels: Array.isArray(body.channels)
          ? body.channels.map((ch: any) => ({
              id: ch.id || "",
              name: ch.name || "",
              chatId: ch.chatId || "",
              enabled: ch.enabled ?? true,
              categories: {
                listing: Boolean(ch.categories?.listing),
                mockups: Boolean(ch.categories?.mockups),
                ppc: Boolean(ch.categories?.ppc),
                accounting: Boolean(ch.categories?.accounting),
              },
            }))
          : [],
      }));
      setNotice({ type: "success", text: "Đã lưu cài đặt thông báo Lark thành công." });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Không thể lưu cài đặt." });
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async (target: "personal" | "channel", channelId?: string) => {
    setTesting(channelId || target);
    setNotice(null);
    try {
      const response = await fetch("/api/settings/lark", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target,
          channelId,
          receiveId: target === "personal" ? settings.personal.receiveId : undefined,
          receiveIdType: target === "personal" ? settings.personal.receiveIdType : undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Không thể gửi tin nhắn thử.");
      setNotice({ type: "success", text: body.message || "Đã gửi tin nhắn thử nghiệm thành công." });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Gửi tin nhắn thử thất bại." });
    } finally {
      setTesting("");
    }
  };

  const updateChannel = (index: number, patch: Partial<ChannelItem>) => {
    setSettings((current) => ({
      ...current,
      channels: current.channels.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  };

  const removeChannel = (index: number) => {
    setSettings((current) => ({
      ...current,
      channels: current.channels.filter((_, i) => i !== index),
    }));
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="lark-settings-title"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-50 text-indigo-600">
              <BellRingingIcon size={20} weight="duotone" />
            </span>
            <h2 id="lark-settings-title" className="text-base font-black text-slate-900">
              Cài đặt thông báo Lark
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <XIcon size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {notice && (
            <div
              className={`mb-4 flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs font-semibold ${
                notice.type === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-rose-200 bg-rose-50 text-rose-800"
              }`}
            >
              {notice.type === "success" ? <CheckCircleIcon size={18} weight="fill" /> : <WarningCircleIcon size={18} weight="fill" />}
              <span>{notice.text}</span>
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-xs font-medium text-slate-500">Đang tải cấu hình...</div>
          ) : (
            <div className="space-y-5">
              {/* Cấu hình cá nhân */}
              <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3.5">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2.5">
                    <UserCircleIcon size={20} className="text-indigo-600" weight="duotone" />
                    <h3 className="text-sm font-black text-slate-900">Thông báo cá nhân</h3>
                  </div>
                  <Toggle
                    checked={settings.personal.enabled}
                    onChange={(enabled) =>
                      setSettings((current) => ({
                        ...current,
                        personal: { ...current.personal, enabled },
                      }))
                    }
                    label="Bật tin nhắn Lark cá nhân"
                  />
                </div>

                <div className="grid gap-2.5 sm:grid-cols-[150px_1fr_auto]">
                  <select
                    value={settings.personal.receiveIdType}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        personal: {
                          ...current.personal,
                          receiveIdType: event.target.value as Snapshot["personal"]["receiveIdType"],
                        },
                      }))
                    }
                    className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  >
                    <option value="email">Email Lark</option>
                    <option value="open_id">Open ID (ou_...)</option>
                    <option value="user_id">User ID</option>
                  </select>
                  <input
                    value={settings.personal.receiveId}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        personal: { ...current.personal, receiveId: event.target.value },
                      }))
                    }
                    placeholder={
                      settings.personal.receiveIdType === "email"
                        ? "Email Lark cá nhân"
                        : settings.personal.receiveIdType === "open_id"
                        ? "ou_..."
                        : "User ID"
                    }
                    className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  />
                  <button
                    type="button"
                    disabled={!settings.personal.receiveId || testing === "personal"}
                    onClick={() => void sendTest("personal")}
                    className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-50"
                  >
                    <FlaskIcon size={14} /> {testing === "personal" ? "Đang gửi..." : "Gửi thử"}
                  </button>
                </div>

                {/* Chức năng nhận cá nhân theo quyền của tài khoản */}
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                  <span className="text-[11px] font-bold text-slate-500 mr-1">Nhận khi hoàn tất:</span>
                  {visibleCategories.map((category) => {
                    const isChecked = Boolean(settings.personalRules?.[category.id]);
                    return (
                      <label
                        key={category.id}
                        className={`inline-flex items-center gap-1.5 cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-bold transition select-none ${
                          isChecked
                            ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(event) =>
                            setSettings((current) => ({
                              ...current,
                              personalRules: {
                                ...current.personalRules,
                                [category.id]: event.target.checked,
                              },
                            }))
                          }
                          className="h-3.5 w-3.5 accent-indigo-600 rounded"
                        />
                        {category.label}
                      </label>
                    );
                  })}
                </div>
              </section>

              {/* Cấu hình từng kênh nhóm (Admin) */}
              {settings.isAdmin && (
                <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2.5">
                      <UsersThreeIcon size={20} className="text-indigo-600" weight="duotone" />
                      <h3 className="text-sm font-black text-slate-900">Kênh nhóm nhận thông báo</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setSettings((current) => ({
                          ...current,
                          channels: [
                            ...current.channels,
                            {
                              id: `new:${crypto.randomUUID()}`,
                              name: "",
                              chatId: "",
                              enabled: true,
                              categories: { listing: true, mockups: true, ppc: true, accounting: true },
                            },
                          ],
                        }))
                      }
                      className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-lg bg-indigo-600 px-3 text-xs font-bold text-white transition hover:bg-indigo-700 active:scale-[0.98]"
                    >
                      <PlusIcon size={14} weight="bold" /> Thêm nhóm
                    </button>
                  </div>

                  <div className="space-y-3">
                    {settings.channels.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-300 py-6 text-center text-xs text-slate-400">
                        Chưa có nhóm nào. Bấm &quot;Thêm nhóm&quot; để cấu hình nhóm Lark.
                      </div>
                    ) : (
                      settings.channels.map((channel, index) => (
                        <div
                          key={channel.id || index}
                          className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 space-y-2"
                        >
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1.4fr]">
                            <input
                              value={channel.name}
                              onChange={(event) => updateChannel(index, { name: event.target.value })}
                              placeholder="Tên nhóm (ví dụ: Cuong Nguyen, Trí Dev)"
                              className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-800 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                            />
                            <input
                              value={channel.chatId}
                              onChange={(event) => updateChannel(index, { chatId: event.target.value })}
                              placeholder="Chat ID (oc_...)"
                              className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 font-mono text-xs text-slate-800 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                            />
                          </div>

                          <div className="flex items-center justify-between gap-1.5 pt-1.5 border-t border-slate-200/60">
                            <div className="flex items-center gap-1 shrink-0">
                              <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap mr-0.5">Chức năng:</span>
                              {categories.map((category) => {
                                const isChecked = Boolean(channel.categories?.[category.id]);
                                return (
                                  <label
                                    key={category.id}
                                    className={`inline-flex items-center gap-1 cursor-pointer whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-bold transition select-none ${
                                      isChecked
                                        ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={(event) =>
                                        updateChannel(index, {
                                          categories: {
                                            ...channel.categories,
                                            [category.id]: event.target.checked,
                                          },
                                        })
                                      }
                                      className="h-3 w-3 accent-indigo-600 rounded"
                                    />
                                    {category.label}
                                  </label>
                                );
                              })}
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                              <button
                                type="button"
                                disabled={channel.id.startsWith("new:") || !channel.chatId || testing === channel.id}
                                onClick={() => void sendTest("channel", channel.id)}
                                className="inline-flex h-6 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 text-[11px] font-bold text-slate-700 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-50"
                              >
                                <FlaskIcon size={11} /> {testing === channel.id ? "Đang gửi..." : "Gửi thử"}
                              </button>
                              <button
                                type="button"
                                role="switch"
                                aria-checked={channel.enabled}
                                aria-label="Bật/Tắt nhóm"
                                onClick={() => updateChannel(index, { enabled: !channel.enabled })}
                                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                  channel.enabled ? "bg-indigo-600" : "bg-slate-300"
                                }`}
                              >
                                <span
                                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition duration-200 ease-in-out ${
                                    channel.enabled ? "translate-x-4" : "translate-x-0"
                                  }`}
                                />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeChannel(index)}
                                aria-label="Xóa nhóm"
                                className="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                              >
                                <TrashIcon size={13} />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2.5 border-t border-slate-100 bg-white px-5 py-3.5 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-xl px-4 text-xs font-bold text-slate-600 hover:bg-slate-100"
          >
            Đóng
          </button>
          <button
            type="button"
            disabled={loading || saving}
            onClick={() => void save()}
            className="h-9 whitespace-nowrap rounded-xl bg-indigo-600 px-5 text-xs font-bold text-white transition hover:bg-indigo-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Đang lưu..." : "Lưu cài đặt"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
