"use client";

import { useEffect, useState, useCallback } from "react";
import { PencilSimpleIcon, PlusIcon } from "@phosphor-icons/react";
import type { FulfillSupplier } from "@/lib/fulfill/types";
import { CodeTag, Modal, ui } from "./fulfill-ui";

export function SuppliersView() {
  const [suppliers, setSuppliers] = useState<FulfillSupplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingSup, setEditingSup] = useState<Partial<FulfillSupplier> | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchSuppliers = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/fulfill/suppliers");
      const data = await res.json();
      if (res.ok) {
        setSuppliers(data.suppliers || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSuppliers();
  }, [fetchSuppliers]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSup?.code || !editingSup?.name) return;

    try {
      setSaving(true);
      const res = await fetch("/api/fulfill/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingSup),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save the supplier");
      setEditingSup(null);
      void fetchSuppliers();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof FulfillSupplier, label: string, opts: { type?: string; placeholder?: string; transform?: (v: string) => string; required?: boolean; className?: string } = {}) => (
    <div>
      <label className={ui.label}>{label}</label>
      <input
        type={opts.type || "text"}
        value={(editingSup?.[key] as string) || ""}
        onChange={(e) => {
          const value = opts.transform ? opts.transform(e.target.value) : e.target.value;
          setEditingSup((prev) => ({ ...prev, [key]: value }));
        }}
        placeholder={opts.placeholder}
        required={opts.required}
        className={`${ui.input} ${opts.className || ""}`}
      />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className={ui.heading}>
        <h1 className={ui.title}>Suppliers</h1>
        <button type="button" onClick={() => setEditingSup({ code: "", name: "", is_active: true })} className={ui.btnPrimary}>
          <PlusIcon size={16} />
          Add Supplier
        </button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-(--ff-muted)">Loading suppliers…</div>
      ) : suppliers.length === 0 ? (
        <div className={`${ui.card} py-16 text-center text-sm text-(--ff-muted)`}>No suppliers yet.</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {suppliers.map((sup) => (
            <article key={sup.id} className={`${ui.card} flex min-w-0 flex-col`}>
              <div className="flex-1 p-4 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1.5">
                    <CodeTag>{sup.code}</CodeTag>
                    <h3 className="break-words text-lg font-semibold">{sup.name}</h3>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-2 text-sm text-(--ff-text-2)">
                    <span className={`h-2 w-2 rounded-full ${sup.is_active ? "bg-(--ff-pos)" : "bg-slate-300"}`} />
                    {sup.is_active ? "Active" : "Inactive"}
                  </span>
                </div>

                {(sup.contact_name || sup.phone || sup.email || sup.address) && (
                  <dl className="mt-4 grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-(--ff-line) pt-4 text-sm">
                    {sup.contact_name && (
                      <>
                        <dt className="text-(--ff-muted)">Contact</dt>
                        <dd>{sup.contact_name}</dd>
                      </>
                    )}
                    {sup.phone && (
                      <>
                        <dt className="text-(--ff-muted)">Phone</dt>
                        <dd className="font-mono text-xs leading-5">{sup.phone}</dd>
                      </>
                    )}
                    {sup.email && (
                      <>
                        <dt className="text-(--ff-muted)">Email</dt>
                        <dd className="truncate">{sup.email}</dd>
                      </>
                    )}
                    {sup.address && (
                      <>
                        <dt className="text-(--ff-muted)">Address</dt>
                        <dd>{sup.address}</dd>
                      </>
                    )}
                  </dl>
                )}

                {sup.notes && <p className="mt-4 text-sm text-(--ff-text-2)">{sup.notes}</p>}
              </div>

              <div className="flex items-center justify-between border-t border-(--ff-line) px-6 py-3">
                <span className="text-sm text-(--ff-muted)">
                  <span className="text-(--ff-text)">{sup.po_count || 0}</span> {Number(sup.po_count) === 1 ? "purchase order" : "purchase orders"}
                </span>
                <button type="button" onClick={() => setEditingSup(sup)} className={ui.btnGhost}>
                  <PencilSimpleIcon size={16} />
                  Edit
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {editingSup && (
        <Modal title={editingSup.id ? `Edit supplier ${editingSup.name}` : "Add Supplier"} onClose={() => setEditingSup(null)}>
          <form onSubmit={handleSave} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4 sm:grid-cols-[120px_minmax(0,1fr)]">
                {field("code", "Supplier code", { placeholder: "BFF", required: true, transform: (v) => v.trim().toUpperCase(), className: "font-mono text-xs" })}
                {field("name", "Supplier name", { placeholder: "BFF Manufacturing", required: true })}
              </div>
              <div className="grid grid-cols-2 gap-4">
                {field("contact_name", "Contact name")}
                {field("phone", "Phone or Zalo")}
              </div>
              {field("email", "Email", { type: "email", transform: (v) => v.trim() })}
              {field("address", "Supplier address")}
              <div>
                <label className={ui.label}>Notes</label>
                <textarea
                  rows={3}
                  value={editingSup.notes || ""}
                  onChange={(e) => setEditingSup((prev) => ({ ...prev, notes: e.target.value }))}
                  className={`${ui.input} h-auto py-2`}
                  placeholder="Product specialties or business hours"
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editingSup.is_active ?? true}
                  onChange={(e) => setEditingSup((prev) => ({ ...prev, is_active: e.target.checked }))}
                  className="h-4 w-4 accent-(--ff-accent)"
                />
                Active
              </label>
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-(--ff-line) px-6 py-4">
              <button type="button" onClick={() => setEditingSup(null)} className={ui.btnGhost}>
                Cancel
              </button>
              <button type="submit" disabled={saving} className={ui.btnPrimary}>
                {saving ? "Saving…" : "Save Supplier"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
