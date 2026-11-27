"use client";

import { useEffect, useId, useMemo, useState, useCallback } from "react";
import { PlusIcon, FileXlsIcon, TrashIcon } from "@phosphor-icons/react";
import type { FulfillPo, FulfillPoStatus, FulfillSupplier } from "@/lib/fulfill/types";
import { CreatePoModal } from "./create-po-modal";
import { PoDetailView } from "./po-detail-view";
import { CodeTag, PO_STATUS, PO_STATUS_ORDER, StatusLabel, StoreDot, fmtInt, fmtMoney, storeColorMap, ui } from "./fulfill-ui";

interface StoreOption {
  id: string;
  name: string;
}

interface FulfillViewProps {
  /** Khi portal truyền vào thì sidebar điều khiển bộ lọc; không truyền thì view tự giữ. */
  storeId?: string;
  supplierId?: string;
  search?: string;
  onStoreChange?: (id: string) => void;
  onSupplierChange?: (id: string) => void;
  onDataChanged?: () => void;
  storeColors?: Record<string, string>;
}

const monthKey = (d: string) => d.slice(0, 7); // YYYY-MM
function lastMonths(n: number, end = new Date()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function useControlled<T>(value: T | undefined, onChange: ((v: T) => void) | undefined, initial: T): [T, (v: T) => void] {
  const [local, setLocal] = useState<T>(initial);
  return value !== undefined && onChange ? [value, onChange] : [local, setLocal];
}

export function FulfillView(props: FulfillViewProps = {}) {
  const listHeadingId = useId();
  const [selectedPoId, setSelectedPoId] = useState<string | null>(null);

  const [stores, setStores] = useState<StoreOption[]>([]);
  const [suppliers, setSuppliers] = useState<FulfillSupplier[]>([]);
  const [pos, setPos] = useState<FulfillPo[]>([]);
  const [loading, setLoading] = useState(false);

  const [selectedStoreId, setSelectedStoreId] = useControlled(props.storeId, props.onStoreChange, "");
  const [selectedSupplierId, setSelectedSupplierId] = useControlled(props.supplierId, props.onSupplierChange, "");
  const searchTerm = props.search ?? "";
  const [selectedStatus, setSelectedStatus] = useState<FulfillPoStatus | "">("");
  const [showCreateModal, setShowCreateModal] = useState(false);

  const { onDataChanged } = props;
  const colors = useMemo(() => props.storeColors || storeColorMap(stores), [props.storeColors, stores]);

  const fetchStoresAndSuppliers = useCallback(async () => {
    try {
      const [resStores, resSups] = await Promise.all([fetch("/api/accounting/stores"), fetch("/api/fulfill/suppliers")]);
      const dataStores = await resStores.json();
      const dataSups = await resSups.json();
      if (resStores.ok && dataStores.stores) setStores(dataStores.stores);
      if (resSups.ok && dataSups.suppliers) setSuppliers(dataSups.suppliers);
    } catch (err) {
      console.error(err);
    }
  }, []);

  // Trạng thái lọc ở client để thẻ số và tab trạng thái luôn đếm đủ mọi trạng thái của store/xưởng đang chọn.
  const fetchPos = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedStoreId) params.set("storeId", selectedStoreId);
      if (selectedSupplierId) params.set("supplierId", selectedSupplierId);
      if (searchTerm.trim()) params.set("search", searchTerm.trim());

      const res = await fetch(`/api/fulfill/pos?${params.toString()}`);
      const data = await res.json();
      if (res.ok) setPos(data.pos || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedStoreId, selectedSupplierId, searchTerm]);

  useEffect(() => {
    void fetchStoresAndSuppliers();
  }, [fetchStoresAndSuppliers]);

  useEffect(() => {
    void fetchPos();
  }, [fetchPos]);

  const refreshAll = () => {
    void fetchPos();
    onDataChanged?.();
  };

  const counts = useMemo(() => {
    const result: Record<FulfillPoStatus, number> = { draft: 0, pending_sup: 0, producing: 0, shipped: 0, received: 0, cancelled: 0 };
    for (const p of pos) result[p.status] = (result[p.status] || 0) + 1;
    return result;
  }, [pos]);

  const qtyByStatus = useMemo(() => {
    const result: Partial<Record<FulfillPoStatus, number>> = {};
    for (const p of pos) result[p.status] = (result[p.status] || 0) + (Number(p.total_quantity) || 0);
    return result;
  }, [pos]);

  const now = new Date();
  const [thisMonth, prevMonth] = lastMonths(2, now).reverse();
  const activePos = pos.filter((p) => p.status !== "cancelled");
  const amountIn = (key: string) => activePos.filter((p) => monthKey(p.order_date) === key).reduce((a, p) => a + (Number(p.total_amount) || 0), 0);
  const amountThis = amountIn(thisMonth);
  const amountPrev = amountIn(prevMonth);
  const change = amountPrev > 0 ? ((amountThis - amountPrev) / amountPrev) * 100 : null;

  const visiblePos = selectedStatus ? pos.filter((p) => p.status === selectedStatus) : pos;

  // Bảng thống kê theo store (thay cho biểu đồ): số đợt theo trạng thái, số lượng, thành tiền
  const storeStats = (() => {
    const m = new Map<string, { id: string; name: string; pos: number; qty: number; amount: number; byStatus: Partial<Record<FulfillPoStatus, number>> }>();
    for (const p of activePos) {
      const id = p.store_id || "none";
      const r = m.get(id) || { id, name: p.store_name || "Chưa gán store", pos: 0, qty: 0, amount: 0, byStatus: {} };
      r.pos += 1;
      r.qty += Number(p.total_quantity) || 0;
      r.amount += Number(p.total_amount) || 0;
      r.byStatus[p.status] = (r.byStatus[p.status] || 0) + 1;
      m.set(id, r);
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  })();

  const handleDeletePo = async (e: React.MouseEvent, poId: string, poNumber: string) => {
    e.stopPropagation();
    if (!confirm(`Xóa đợt hàng ${poNumber}? Toàn bộ dòng SKU trong đợt này sẽ bị xóa.`)) return;
    try {
      await fetch(`/api/fulfill/pos/${poId}`, { method: "DELETE" });
      refreshAll();
    } catch {
      alert("Lỗi khi xóa đợt hàng.");
    }
  };

  if (selectedPoId) {
    return (
      <PoDetailView
        poId={selectedPoId}
        onBack={() => {
          setSelectedPoId(null);
          refreshAll();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h1 className="flex flex-wrap items-baseline gap-x-3 text-[32px] leading-tight font-semibold tracking-tight sm:text-[40px]">
          Tháng {now.getMonth() + 1} <span className="text-2xl font-medium tracking-normal text-(--ff-muted) sm:text-3xl">{now.getFullYear()}</span>
        </h1>
        <button type="button" onClick={() => setShowCreateModal(true)} className={ui.btnPrimary}>
          <PlusIcon size={16} />
          Tạo đợt hàng
        </button>
      </div>

      <section aria-label="Tổng quan đợt hàng" className="grid gap-px overflow-hidden rounded-xl border border-(--ff-line) bg-(--ff-line) shadow-[0_1px_2px_rgba(15,23,42,0.04)] lg:grid-cols-[minmax(15rem,1fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col justify-center bg-(--ff-card) px-5 py-6 sm:px-7">
          <div className="text-sm font-medium text-(--ff-text-2)">Tiền sản xuất tháng này</div>
          <div className="mt-2 text-[36px] leading-tight font-semibold tracking-tight text-(--ff-text) [overflow-wrap:anywhere] sm:text-[40px]">{fmtMoney(amountThis)}</div>
          <div className="mt-2 text-sm">
            {change === null ? (
              <span className="text-(--ff-muted)">Tháng {Number(prevMonth.slice(5))} chưa có đợt hàng</span>
            ) : (
              <>
                <strong className={`font-semibold ${change >= 0 ? "text-(--ff-pos)" : "text-(--ff-neg)"}`}>
                  {change >= 0 ? "+" : ""}
                  {change.toFixed(0)}%
                </strong>{" "}so với tháng {Number(prevMonth.slice(5))}
              </>
            )}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-px 2xl:grid-cols-4">
          {PO_STATUS_ORDER.filter((status) => status !== "draft").map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setSelectedStatus((prev) => (prev === status ? "" : status))}
              aria-pressed={selectedStatus === status}
              title="Bấm để lọc danh sách theo trạng thái này"
              className={`min-w-0 cursor-pointer px-4 py-4 text-left transition-colors duration-150 sm:px-5 2xl:flex 2xl:flex-col 2xl:justify-center ${
                selectedStatus === status ? "bg-(--ff-accent-soft)" : "bg-(--ff-card) hover:bg-(--ff-raised)"
              }`}
            >
              <dt>
                <StatusLabel status={status} />
              </dt>
              <dd className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-2xl leading-none font-semibold text-(--ff-text)">{fmtInt(counts[status])}</span>
                <span className="text-xs text-(--ff-muted)">{fmtInt(qtyByStatus[status] || 0)} cái</span>
              </dd>
            </button>
          ))}
        </dl>
      </section>

      <section aria-label="Thống kê theo store" className={`${ui.card} overflow-hidden`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-(--ff-line) px-4 py-3.5 sm:px-6">
          <h2 className="text-lg font-semibold">Thống kê theo store</h2>
          <span className="text-xs text-(--ff-muted)">Không tính đợt đã hủy · bấm dòng để lọc</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm whitespace-nowrap">
            <thead className="bg-(--ff-head)">
              <tr className="border-b border-(--ff-line)">
                <th className={`${ui.th} pl-6`}>Store</th>
                <th className={`${ui.th} text-right`}>Số đợt</th>
                {PO_STATUS_ORDER.map((st) => (
                  <th key={st} className={`${ui.th} text-right`}>
                    {PO_STATUS[st].label}
                  </th>
                ))}
                <th className={`${ui.th} text-right`}>Số lượng</th>
                <th className={`${ui.th} pr-6 text-right`}>Thành tiền</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--ff-line)">
              {storeStats.length === 0 ? (
                <tr>
                  <td colSpan={4 + PO_STATUS_ORDER.length} className="py-10 text-center text-(--ff-muted)">
                    Chưa có đợt hàng
                  </td>
                </tr>
              ) : (
                storeStats.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => setSelectedStoreId(selectedStoreId === r.id ? "" : r.id)}
                    className={`h-12 cursor-pointer transition-colors duration-150 ${selectedStoreId === r.id ? "bg-(--ff-accent-soft)" : "hover:bg-(--ff-raised)"}`}
                  >
                    <th scope="row" className="py-2 pr-3 pl-6 font-medium">
                      <span className="inline-flex items-center gap-2">
                        <StoreDot color={colors[r.id]} />
                        {r.name}
                      </span>
                    </th>
                    <td className="px-3 text-right">{r.pos}</td>
                    {PO_STATUS_ORDER.map((st) => (
                      <td key={st} className={`px-3 text-right ${r.byStatus[st] ? "" : "text-(--ff-muted)"}`}>
                        {r.byStatus[st] || "—"}
                      </td>
                    ))}
                    <td className="px-3 text-right">{fmtInt(r.qty)}</td>
                    <td className="py-2 pr-6 pl-3 text-right font-medium">{fmtMoney(r.amount)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {storeStats.length > 1 && (
              <tfoot>
                <tr className="h-12 border-t border-(--ff-line-strong) bg-(--ff-head) font-semibold">
                  <td className="py-2 pr-3 pl-6">Tổng</td>
                  <td className="px-3 text-right">{activePos.length}</td>
                  {PO_STATUS_ORDER.map((st) => (
                    <td key={st} className="px-3 text-right">
                      {counts[st] || "—"}
                    </td>
                  ))}
                  <td className="px-3 text-right">{fmtInt(activePos.reduce((a, p) => a + (Number(p.total_quantity) || 0), 0))}</td>
                  <td className="py-2 pr-6 pl-3 text-right">{fmtMoney(activePos.reduce((a, p) => a + (Number(p.total_amount) || 0), 0))}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      <section aria-labelledby={listHeadingId} className={`${ui.card} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3.5 sm:px-6">
          <h2 id={listHeadingId} className="text-lg font-semibold">Danh sách đợt hàng</h2>

          <div className={`flex max-w-full flex-wrap gap-2 ${props.onStoreChange && props.onSupplierChange ? "lg:hidden" : ""}`}>
            <select aria-label="Lọc theo store" value={selectedStoreId} onChange={(e) => setSelectedStoreId(e.target.value)} className={ui.select}>
              <option value="">Tất cả store</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select aria-label="Lọc theo xưởng" value={selectedSupplierId} onChange={(e) => setSelectedSupplierId(e.target.value)} className={ui.select}>
              <option value="">Tất cả xưởng</option>
              {suppliers.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div role="group" aria-label="Lọc theo trạng thái" className="flex items-center gap-1 overflow-x-auto border-b border-(--ff-line) px-4 py-3 sm:px-6">
          {(["", ...PO_STATUS_ORDER, "cancelled"] as Array<FulfillPoStatus | "">).map((s) => {
            const active = selectedStatus === s;
            const n = s ? counts[s] : pos.length;
            if (s === "cancelled" && n === 0) return null;
            return (
              <button
                key={s || "all"}
                type="button"
                onClick={() => setSelectedStatus(s)}
                aria-pressed={active}
                className={`inline-flex h-8 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-3 text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ff-accent) ${
                  active ? "bg-(--ff-accent-soft) font-semibold text-(--ff-accent)" : "text-(--ff-text-2) hover:bg-(--ff-raised) hover:text-(--ff-text)"
                }`}
              >
                {s ? PO_STATUS[s].label : "Tất cả"}
                <span className={`rounded px-1.5 text-xs font-medium ${active ? "bg-(--ff-card) text-(--ff-accent)" : "bg-(--ff-raised) text-(--ff-muted)"}`}>{n}</span>
              </button>
            );
          })}

        </div>

        <div className="relative overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm whitespace-nowrap">
            <thead className="bg-(--ff-head)">
              <tr className="border-b border-(--ff-line)">
                <th className={`${ui.th} pl-6`}>Mã đợt</th>
                <th className={ui.th}>Store</th>
                <th className={ui.th}>Xưởng</th>
                <th className={ui.th}>Ngày đặt</th>
                <th className={ui.th}>Hẹn giao</th>
                <th className={`${ui.th} text-right`}>SKU</th>
                <th className={`${ui.th} text-right`}>Số lượng</th>
                <th className={`${ui.th} text-right`}>Thành tiền</th>
                <th className={ui.th}>Trạng thái</th>
                <th className={`${ui.th} pr-6`}>
                  <span className="sr-only">Thao tác</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--ff-line)">
              {loading && pos.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-16 text-center text-(--ff-muted)">
                    Đang tải đợt hàng
                  </td>
                </tr>
              ) : visiblePos.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-16 text-center text-(--ff-muted)">
                    {pos.length === 0 ? "Chưa có đợt hàng nào. Tạo đợt đầu tiên để gửi phiếu cho xưởng" : "Không có đợt nào ở trạng thái này"}
                  </td>
                </tr>
              ) : (
                visiblePos.map((p) => (
                  <tr key={p.id} onClick={() => setSelectedPoId(p.id)} className="h-14 cursor-pointer transition-colors duration-150 hover:bg-(--ff-raised)">
                    <td className="py-2 pr-3 pl-6">
                      <button type="button" onClick={() => setSelectedPoId(p.id)} className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-(--ff-accent)">
                        <CodeTag>{p.po_number}</CodeTag>
                      </button>
                    </td>
                    <td className="px-3">
                      <span className="inline-flex items-center gap-2">
                        {p.store_id && <StoreDot color={colors[p.store_id]} />}
                        {p.store_name}
                      </span>
                    </td>
                    <td className="px-3 text-(--ff-text-2)">{p.supplier_code || p.supplier_name}</td>
                    <td className="px-3 text-(--ff-text-2)">{p.order_date}</td>
                    <td className="px-3 text-(--ff-text-2)">{p.target_date || "—"}</td>
                    <td className="px-3 text-right text-(--ff-text-2)">{p.line_count ?? 0}</td>
                    <td className="px-3 text-right">{fmtInt(p.total_quantity)}</td>
                    <td className="px-3 text-right font-medium">{fmtMoney(p.total_amount)}</td>
                    <td className="px-3">
                      <StatusLabel status={p.status} />
                    </td>
                    <td className="py-2 pr-6 pl-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <a href={`/api/fulfill/pos/${p.id}/export`} download className={ui.iconBtn} title="Xuất Excel gửi xưởng">
                          <FileXlsIcon size={16} />
                        </a>
                        <button type="button" onClick={(e) => handleDeletePo(e, p.id, p.po_number)} className={ui.iconBtnDanger} title="Xóa đợt hàng">
                          <TrashIcon size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <CreatePoModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={(newPoId) => {
          setSelectedPoId(newPoId);
          refreshAll();
        }}
        stores={stores}
        suppliers={suppliers}
        defaultStoreId={selectedStoreId}
        defaultSupplierId={selectedSupplierId}
      />
    </div>
  );
}
