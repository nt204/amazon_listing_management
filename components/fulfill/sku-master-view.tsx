"use client";

import { useEffect, useState, useCallback } from "react";
import { ArrowClockwiseIcon, ArrowUpRightIcon, MagnifyingGlassIcon, PencilSimpleIcon, PlusIcon } from "@phosphor-icons/react";
import type { FulfillSkuMasterItem } from "@/lib/fulfill/types";
import { CodeTag, Modal, Notice, fmtInt, fmtMoney, ui } from "./fulfill-ui";

interface SkuMasterViewProps {
  stores: Array<{ id: string; name: string }>;
  selectedStoreId: string;
  onSelectStore: (id: string) => void;
}

export function SkuMasterView({ stores, selectedStoreId, onSelectStore }: SkuMasterViewProps) {
  const [items, setItems] = useState<FulfillSkuMasterItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Edit / Add modal
  const [editingItem, setEditingItem] = useState<Partial<FulfillSkuMasterItem> | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedStoreId) params.set("storeId", selectedStoreId);
      if (searchTerm.trim()) params.set("search", searchTerm.trim());

      const res = await fetch(`/api/fulfill/sku-master?${params.toString()}`);
      const data = await res.json();
      if (res.ok) {
        setItems(data.items || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedStoreId, searchTerm]);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  // Sync from Accounting SKU Master
  const handleSyncFromAccounting = async () => {
    try {
      setSyncing(true);
      setMessage(null);
      const res = await fetch("/api/fulfill/sku-master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync", store_id: selectedStoreId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi đồng bộ");
      setMessage({ type: "success", text: data.message || "Đã đồng bộ" });
      void fetchItems();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "Đồng bộ thất bại" });
    } finally {
      setSyncing(false);
    }
  };

  // Save Item
  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem?.store_id || !editingItem?.sku) return;

    try {
      setSaving(true);
      const res = await fetch("/api/fulfill/sku-master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingItem),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi lưu");
      setEditingItem(null);
      void fetchItems();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const linkCell = (url: string | null, label: string) =>
    url ? (
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-(--ff-text-2) transition-colors duration-150 hover:text-(--ff-text)">
        {label}
        <ArrowUpRightIcon size={12} />
      </a>
    ) : (
      <span className="text-(--ff-muted)">—</span>
    );

  const field = (
    key: keyof FulfillSkuMasterItem,
    label: string,
    opts: { type?: "text" | "url" | "number" | "money"; placeholder?: string; parse?: (v: string) => unknown; required?: boolean; className?: string } = {},
  ) => {
    const kind = opts.type || "text";
    const numeric = kind === "number" || kind === "money";
    const current = editingItem?.[key] as string | number | null | undefined;
    return (
      <div>
        <label className={ui.label}>{label}</label>
        <input
          type={numeric ? "number" : kind}
          step={kind === "money" ? "0.01" : undefined}
          min={kind === "number" ? "1" : undefined}
          value={numeric ? Number(current) || (kind === "number" ? 1 : 0) : current || ""}
          onChange={(e) => {
            const value = opts.parse ? opts.parse(e.target.value) : e.target.value;
            setEditingItem((prev) => ({ ...prev, [key]: value }));
          }}
          placeholder={opts.placeholder}
          required={opts.required}
          className={`${ui.input} ${numeric ? "text-right" : ""} ${opts.className || ""}`}
        />
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-medium">SKU master</h1>
          <p className="mt-1 text-sm text-(--ff-muted)">Thông tin cố định của từng SKU, tự điền vào đợt hàng mới</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSyncFromAccounting}
            disabled={syncing}
            className={ui.btnSecondary}
            title="Lấy SKU và giá vốn từ Bảng Mã kế toán"
          >
            <ArrowClockwiseIcon size={16} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Đang đồng bộ" : "Đồng bộ từ Bảng Mã"}
          </button>
          <button
            type="button"
            onClick={() =>
              setEditingItem({
                store_id: selectedStoreId || stores[0]?.id || "",
                sku: "",
                pcs_per_box: 1,
                basecost: 0,
                fee_card: 0,
                fee_tag: 0,
                fee_stand: 0,
                fee_box: 0,
              })
            }
            className={ui.btnPrimary}
          >
            <PlusIcon size={16} />
            Thêm SKU
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={selectedStoreId} onChange={(e) => onSelectStore(e.target.value)} className={ui.select}>
          <option value="">Tất cả store</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <div className="relative w-72">
          <MagnifyingGlassIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-(--ff-muted)" />
          <input type="text" placeholder="SKU, ASIN, FNSKU" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className={`${ui.input} pl-9`} />
        </div>
        {!loading && <span className="ml-auto text-sm text-(--ff-muted)">{fmtInt(items.length)} SKU</span>}
      </div>

      {message && (
        <Notice tone={message.type} onClose={() => setMessage(null)}>
          {message.text}
        </Notice>
      )}

      <div className={`${ui.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-(--ff-line) bg-(--ff-bg)">
                <th className={`${ui.th} pl-6`}>SKU</th>
                <th className={ui.th}>Store</th>
                <th className={ui.th}>ASIN</th>
                <th className={ui.th}>FNSKU</th>
                <th className={ui.th}>Phôi</th>
                <th className={ui.th}>Kích thước</th>
                <th className={`${ui.th} text-right`}>Cái / thùng</th>
                <th className={`${ui.th} text-right`}>Basecost</th>
                <th className={`${ui.th} text-right`}>Phí đóng gói</th>
                <th className={ui.th}>Thiết kế</th>
                <th className={ui.th}>Card</th>
                <th className={ui.th}>Box</th>
                <th className={`${ui.th} pr-6`}>
                  <span className="sr-only">Sửa</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--ff-line)">
              {loading ? (
                <tr>
                  <td colSpan={13} className="py-16 text-center text-(--ff-muted)">
                    Đang tải SKU master
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={13} className="py-16 text-center text-(--ff-muted)">
                    Chưa có SKU nào. Đồng bộ từ Bảng Mã để lấy dữ liệu có sẵn
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const extraFees = Number(item.fee_card || 0) + Number(item.fee_tag || 0) + Number(item.fee_stand || 0) + Number(item.fee_box || 0);
                  return (
                    <tr key={item.id} className="h-12 transition-colors duration-150 hover:bg-(--ff-bg)">
                      <td className="py-2 pr-3 pl-6">
                        <CodeTag>{item.sku}</CodeTag>
                      </td>
                      <td className="px-3">{item.store_name}</td>
                      <td className="px-3 font-mono text-xs text-(--ff-text-2)">{item.asin || "—"}</td>
                      <td className="px-3 font-mono text-xs text-(--ff-text-2)">{item.fnsku || "—"}</td>
                      <td className="px-3 text-(--ff-text-2)">{item.product_name || "—"}</td>
                      <td className="px-3 text-(--ff-text-2)">{item.dimensions || "—"}</td>
                      <td className="px-3 text-right">{fmtInt(item.pcs_per_box)}</td>
                      <td className="px-3 text-right">{fmtMoney(item.basecost)}</td>
                      <td className="px-3 text-right text-(--ff-text-2)">{fmtMoney(extraFees)}</td>
                      <td className="px-3">{linkCell(item.design_url, "Mở")}</td>
                      <td className="px-3">{linkCell(item.card_url, "Mở")}</td>
                      <td className="px-3">{linkCell(item.box_url, "Mở")}</td>
                      <td className="py-2 pr-6 pl-3 text-right">
                        <button type="button" onClick={() => setEditingItem(item)} className={ui.iconBtn} title="Sửa SKU">
                          <PencilSimpleIcon size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editingItem && (
        <Modal title={editingItem.id ? `Sửa SKU ${editingItem.sku}` : "Thêm SKU"} onClose={() => setEditingItem(null)} width="max-w-2xl">
          <form onSubmit={handleSaveItem} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-6 overflow-y-auto p-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={ui.label}>Store</label>
                  <select
                    value={editingItem.store_id || ""}
                    onChange={(e) => setEditingItem((prev) => ({ ...prev, store_id: e.target.value }))}
                    className={`${ui.select} w-full`}
                    required
                  >
                    <option value="">Chọn store</option>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                {field("sku", "SKU", { placeholder: "MTL24052503PQ", required: true, parse: (v) => v.trim().toUpperCase(), className: "font-mono text-xs" })}
              </div>

              <div className="grid grid-cols-3 gap-4">
                {field("asin", "ASIN", { parse: (v) => v.trim(), className: "font-mono text-xs" })}
                {field("fnsku", "FNSKU", { parse: (v) => v.trim(), className: "font-mono text-xs" })}
                {field("pcs_per_box", "Cái / thùng", { type: "number", parse: (v) => Number(v) || 1 })}
              </div>

              <div className="grid grid-cols-2 gap-4">
                {field("product_name", "Phôi", { placeholder: "14oz Tumbler" })}
                {field("dimensions", "Kích thước", { placeholder: "20x15x10cm" })}
              </div>

              <fieldset className="grid grid-cols-3 gap-4 border-t border-(--ff-line) pt-6">
                <legend className="sr-only">Giá</legend>
                {field("basecost", "Basecost ($)", { type: "money", parse: (v) => Number(v) || 0 })}
                {field("fee_card", "Phí card ($)", { type: "money", parse: (v) => Number(v) || 0 })}
                {field("fee_box", "Phí box ($)", { type: "money", parse: (v) => Number(v) || 0 })}
              </fieldset>

              <fieldset className="space-y-4 border-t border-(--ff-line) pt-6">
                <legend className="sr-only">Link</legend>
                {field("design_url", "Link thiết kế (Dropbox, Drive)", { type: "url", placeholder: "https://", parse: (v) => v.trim() })}
                {field("card_url", "Link card", { type: "url", placeholder: "https://", parse: (v) => v.trim() })}
                {field("box_url", "Link box", { type: "url", placeholder: "https://", parse: (v) => v.trim() })}
              </fieldset>
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-(--ff-line) px-6 py-4">
              <button type="button" onClick={() => setEditingItem(null)} className={ui.btnGhost}>
                Hủy
              </button>
              <button type="submit" disabled={saving} className={ui.btnPrimary}>
                {saving ? "Đang lưu" : "Lưu SKU"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
