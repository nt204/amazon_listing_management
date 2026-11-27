"use client";

import { useEffect, useState } from "react";
import { Modal, Notice, fmtInt, fmtMoney, ui } from "./fulfill-ui";

// Quản lý xưởng & tài khoản xưởng. Tài khoản xưởng chỉ xem được lô của các Sup được gán, ở trang /sup.

interface SupAccount {
  id: string;
  email: string;
  display_name: string | null;
  sup_names: string[];
  is_active: boolean;
  notes: string | null;
  created_at: string;
  last_seen_at: string | null;
}

interface SupSummary {
  sup: string;
  lots: number;
  amount: number;
  last_request: string | null;
}

type Draft = { id?: string; email: string; display_name: string; sup_names: string[]; is_active: boolean; notes: string };

const SUP_PORTAL_URL = process.env.NEXT_PUBLIC_SUP_PORTAL_URL || "https://fulfill.ncehub.net/sup";

const emptyDraft = (sup?: string): Draft => ({ email: "", display_name: sup ?? "", sup_names: sup ? [sup] : [], is_active: true, notes: "" });
const fmtTime = (value: string | null) => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleString("sv-SE").slice(0, 16) : "—";
};
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function SupAccountsView() {
  const [data, setData] = useState<{ accounts: SupAccount[]; sups: SupSummary[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [log, setLog] = useState<{ account: SupAccount; rows: Array<{ action: string; detail: string | null; at: string }> } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/fulfill/sup-accounts", { signal: controller.signal })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
        if (!controller.signal.aborted) setData(body);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [version]);

  const reload = () => setVersion((v) => v + 1);
  const accounts = data?.accounts ?? [];
  const accountsOf = (sup: string) => accounts.filter((a) => a.sup_names.some((n) => same(n, sup)));

  const toggleActive = async (account: SupAccount) => {
    const response = await fetch(`/api/fulfill/sup-accounts/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...account, is_active: !account.is_active }),
    });
    if (!response.ok) setError((await response.json())?.error ?? "Could not update the account.");
    reload();
  };

  const remove = async (account: SupAccount) => {
    if (!confirm(`Delete the account ${account.email}? The supplier will lose access immediately.`)) return;
    const response = await fetch(`/api/fulfill/sup-accounts/${account.id}`, { method: "DELETE" });
    if (!response.ok) setError((await response.json())?.error ?? "Could not delete the account.");
    reload();
  };

  const openLog = async (account: SupAccount) => {
    const response = await fetch(`/api/fulfill/sup-accounts/${account.id}`);
    const body = await response.json();
    if (!response.ok) setError(body?.error ?? "Could not load history.");
    else setLog({ account, rows: body.log });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className={ui.title}>Suppliers</h1>
          <p className="mt-1 text-sm text-(--ff-muted)">
            Supplier page: <span className="font-mono text-(--ff-text)">{SUP_PORTAL_URL}</span>
          </p>
        </div>
        <button type="button" className={ui.btnPrimary} onClick={() => setDraft(emptyDraft())}>Add account</button>
      </div>

      {error && <Notice tone="error" onClose={() => setError(null)}>{error}</Notice>}

      <section className={`${ui.card} overflow-hidden`}>
        <h2 className="px-5 pt-4 pb-3 font-semibold">Accounts</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead className={ui.tableHead}>
              <tr className="border-b border-(--ff-line)">
                <th className={`${ui.th} pl-5`}>Email</th>
                <th className={ui.th}>Name</th>
                <th className={ui.th}>Sup</th>
                <th className={ui.th}>Status</th>
                <th className={ui.th}>Last seen</th>
                <th className={`${ui.th} pr-5`}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--ff-line)">
              {!data ? (
                <tr><td colSpan={6} className="py-10 text-center text-(--ff-muted)">{error ? "—" : "Loading…"}</td></tr>
              ) : accounts.length === 0 ? (
                <tr><td colSpan={6} className="py-10 text-center text-(--ff-muted)">No supplier accounts yet.</td></tr>
              ) : (
                accounts.map((a) => (
                  <tr key={a.id} className={a.is_active ? "" : "text-(--ff-muted)"}>
                    <td className="py-3 pr-3 pl-5 font-medium">{a.email}</td>
                    <td className="px-3">{a.display_name || "—"}</td>
                    <td className="px-3">{a.sup_names.join(", ")}</td>
                    <td className="px-3">{a.is_active ? "Active" : "Disabled"}</td>
                    <td className="px-3 whitespace-nowrap tabular-nums">{fmtTime(a.last_seen_at)}</td>
                    <td className="py-2 pr-5 pl-3">
                      <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
                        <button type="button" className={ui.link} onClick={() => setDraft({ ...a, display_name: a.display_name ?? "", notes: a.notes ?? "" })}>Edit</button>
                        <button type="button" className={ui.link} onClick={() => toggleActive(a)}>{a.is_active ? "Disable" : "Enable"}</button>
                        <button type="button" className={ui.link} onClick={() => openLog(a)}>History</button>
                        <button type="button" className={`${ui.link} text-(--ff-neg)`} onClick={() => remove(a)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`${ui.card} overflow-hidden`}>
        <h2 className="px-5 pt-4 pb-3 font-semibold">Suppliers in Chi tiết đi hàng</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead className={ui.tableHead}>
              <tr className="border-b border-(--ff-line)">
                <th className={`${ui.th} pl-5`}>Sup</th>
                <th className={`${ui.th} text-right`}>Lots</th>
                <th className={`${ui.th} text-right`}>Real total</th>
                <th className={ui.th}>Last request</th>
                <th className={ui.th}>Accounts</th>
                <th className={`${ui.th} pr-5`}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--ff-line)">
              {(data?.sups ?? []).map((s) => {
                const linked = accountsOf(s.sup);
                return (
                  <tr key={s.sup}>
                    <td className="py-3 pr-3 pl-5 font-medium">{s.sup}</td>
                    <td className="px-3 text-right tabular-nums">{fmtInt(s.lots)}</td>
                    <td className="px-3 text-right tabular-nums">{fmtMoney(s.amount)}</td>
                    <td className="px-3 tabular-nums">{s.last_request ?? "—"}</td>
                    <td className="px-3 text-(--ff-text-2)">{linked.length ? linked.map((a) => a.email).join(", ") : "—"}</td>
                    <td className="py-2 pr-5 pl-3 text-right">
                      <button type="button" className={ui.link} onClick={() => setDraft(emptyDraft(s.sup))}>Add account</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {draft && (
        <AccountForm
          draft={draft}
          sups={(data?.sups ?? []).map((s) => s.sup)}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            reload();
          }}
        />
      )}

      {log && (
        <Modal title={`History · ${log.account.email}`} onClose={() => setLog(null)}>
          <div className="max-h-[60dvh] overflow-y-auto px-5 py-3">
            {log.rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-(--ff-muted)">No visits yet.</p>
            ) : (
              <table className="w-full border-collapse text-left text-sm">
                <thead className={ui.tableHead}>
                  <tr>
                    <th scope="col" className={ui.th}>Date</th>
                    <th scope="col" className={ui.th}>Action</th>
                    <th scope="col" className={ui.th}>Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-(--ff-line)">
                  {log.rows.map((r, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums text-(--ff-muted)">{fmtTime(r.at)}</td>
                      <td className="px-3 py-2">{r.action}</td>
                      <td className="px-3 py-2">{r.detail ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function AccountForm({ draft, sups, onClose, onSaved }: { draft: Draft; sups: string[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState(draft);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const options = [...new Set([...sups, ...form.sup_names])];

  const toggleSup = (sup: string) =>
    setForm((f) => ({ ...f, sup_names: f.sup_names.some((n) => same(n, sup)) ? f.sup_names.filter((n) => !same(n, sup)) : [...f.sup_names, sup] }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(form.id ? `/api/fulfill/sup-accounts/${form.id}` : "/api/fulfill/sup-accounts", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email,
          display_name: form.display_name || null,
          sup_names: form.sup_names,
          is_active: form.is_active,
          notes: form.notes || null,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={form.id ? "Edit account" : "Add account"} onClose={onClose}>
      <div className="space-y-4 overflow-y-auto px-5 py-4">
        <label className="block">
          <span className={ui.label}>Email</span>
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={ui.input} placeholder="supplier@example.com" />
        </label>
        <label className="block">
          <span className={ui.label}>Name</span>
          <input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} className={ui.input} />
        </label>
        <fieldset>
          <legend className={ui.label}>Sup</legend>
          <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
            {options.map((sup) => {
              const on = form.sup_names.some((n) => same(n, sup));
              return (
                <button
                  key={sup}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleSup(sup)}
                  className={`cursor-pointer rounded-full border px-3 py-1 text-sm focus-visible:outline-2 focus-visible:outline-(--ff-accent) ${
                    on ? "border-(--ff-accent) bg-(--ff-accent) text-white" : "border-(--ff-line-strong) text-(--ff-text-2) hover:border-(--ff-accent)"
                  }`}
                >
                  {sup}
                </button>
              );
            })}
          </div>
        </fieldset>
        <label className="block">
          <span className={ui.label}>Notes</span>
          <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={ui.input} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
          Active
        </label>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
      <div className="flex justify-end gap-2 border-t border-(--ff-line) bg-(--ff-head) px-5 py-3">
        <button type="button" className={ui.btnGhost} onClick={onClose}>Cancel</button>
        <button type="button" className={ui.btnPrimary} disabled={saving || !form.email.trim() || !form.sup_names.length} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}
