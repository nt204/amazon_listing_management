"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { MagnifyingGlassIcon, PlusIcon, FileXlsIcon, TrashIcon } from "@phosphor-icons/react";
import type { FulfillPo, FulfillPoStatus, FulfillSupplier } from "@/lib/fulfill/types";
import { CreatePoModal } from "./create-po-modal";
import { PoDetailView } from "./po-detail-view";
import { CodeTag, PO_STATUS, PO_STATUS_ORDER, StatusLabel, fmtInt, fmtMoney, ui } from "./fulfill-ui";

interface StoreOption {
  id: string;
  name: string;
}

export function FulfillView() {
  const [selectedPoId, setSelectedPoId] = useState<string | null>(null);

  const [stores, setStores] = useState<StoreOption[]>([]);
  const [suppliers, setSuppliers] = useState<FulfillSupplier[]>([]);
  const [pos, setPos] = useState<FulfillPo[]>([]);

  const [loading, setLoading] = useState(false);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<FulfillPoStatus | "">("");
  const [searchTerm, setSearchTerm] = useState("");

  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchStoresAndSuppliers = useCallback(async () => {
    try {
      const [resStores, resSups] = await Promise.all([fetch("/api/accounting/stores"), fetch("/api/fulfill/suppliers")]);
      const dataStores = await resStores.json();
      const dataSups = await resSups.json();

      if (resStores.ok && dataStores.stores) {
        setStores(dataStores.stores);
      }
      if (resSups.ok && dataSups.suppliers) {
        setSuppliers(dataSups.suppliers);
      }
    } catch (err) {
      console.error(err);
    }
  }, []);

  // Trạng thái lọc ở client để dải tiến độ luôn đếm đủ mọi trạng thái của store/xưởng đang chọn.
  const fetchPos = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedStoreId) params.set("storeId", selectedStoreId);
      if (selectedSupplierId) params.set("supplierId", selectedSupplierId);
      if (searchTerm.trim()) params.set("search", searchTerm.trim());

      const res = await fetch(`/api/fulfill/pos?${params.toString()}`);
      const data = await res.json();
      if (res.ok) {
        setPos(data.pos || []);
      }
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

  const counts = useMemo(() => {
    const result: Record<FulfillPoStatus, number> = {
      draft: 0,
      pending_sup: 0,
      producing: 0,
      shipped: 0,
      received: 0,
      cancelled: 0,
    };
    for (const p of pos) result[p.status] = (result[p.status] || 0) + 1;
    return result;
  }, [pos]);

  const activePos = useMemo(() => pos.filter((p) => p.status !== "cancelled"), [pos]);
  const totalAmount = activePos.reduce((acc, p) => acc + (Number(p.total_amount) || 0), 0);
  const totalQuantity = activePos.reduce((acc, p) => acc + (Number(p.total_quantity) || 0), 0);
  const visiblePos = selectedStatus ? pos.filter((p) => p.status === selectedStatus) : pos;

  const handleDeletePo = async (e: React.MouseEvent, poId: string, poNumber: string) => {
    e.stopPropagation();
    if (!confirm(`Xóa đợt hàng ${poNumber}? Toàn bộ dòng SKU trong đợt này sẽ bị xóa.`)) {
      return;
    }
    try {
      await fetch(`/api/fulfill/pos/${poId}`, { method: "DELETE" });
      void fetchPos();
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
          void fetchPos();
        }}
      />
    );
  }

  const toggleStatus = (status: FulfillPoStatus) => setSelectedStatus((prev) => (prev === status ? "" : status));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-medium">Đợt hàng</h1>
          <p className="mt-1 text-sm text-(--ff-muted)">Đặt sản xuất với xưởng, theo dõi từ lúc gửi phiếu tới khi hàng vào kho FBA</p>
        </div>
        <button type="button" onClick={() => setShowCreateModal(true)} className={ui.btnPrimary}>
          <PlusIcon size={16} />
          Tạo đợt hàng
        </button>
      </div>

      {/* Dải tiến độ: mỗi đoạn là số đợt ở một trạng thái, bấm để lọc */}
      <section className={`${ui.card} p-6`}>
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <div className="flex h-3 w-full gap-1 overflow-hidden rounded-sm">
              {activePos.length === 0 ? (
                <div className="h-full w-full rounded-sm bg-(--ff-raised)" />
              ) : (
                PO_STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => (
                  <div
                    key={s}
                    title={`${PO_STATUS[s].label}: ${counts[s]} đợt`}
                    className={`h-full rounded-sm transition-opacity duration-150 ${PO_STATUS[s].bar} ${
                      selectedStatus && selectedStatus !== s ? "opacity-30" : ""
                    }`}
                    style={{ flexGrow: counts[s], flexBasis: 0, minWidth: 12 }}
                  />
                ))
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
              {PO_STATUS_ORDER.map((s) => {
                const active = selectedStatus === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleStatus(s)}
                    aria-pressed={active}
                    className={`-mx-2 flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-1 text-left transition-colors duration-150 ${
                      active ? "bg-(--ff-raised)" : "hover:bg-(--ff-raised)"
                    }`}
                  >
                    <StatusLabel status={s} />
                    <span className="font-mono text-sm text-(--ff-text)">{counts[s]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="shrink-0 border-l border-(--ff-line) pl-6 text-right">
            <div className="text-xs text-(--ff-muted)">Tiền sản xuất</div>
            <div className="mt-1 text-3xl font-medium">{fmtMoney(totalAmount)}</div>
            <div className="mt-1 font-mono text-xs text-(--ff-muted)">
              {fmtInt(totalQuantity)} cái · {activePos.length} đợt
            </div>
          </div>
        </div>

        {(counts.cancelled > 0 || selectedStatus) && (
          <div className="mt-4 flex items-center gap-4 border-t border-(--ff-line) pt-4 text-sm text-(--ff-muted)">
            {counts.cancelled > 0 && (
              <button type="button" onClick={() => toggleStatus("cancelled")} className={ui.link}>
                {counts.cancelled} đợt đã hủy
              </button>
            )}
            {selectedStatus && (
              <button type="button" onClick={() => setSelectedStatus("")} className={ui.link}>
                Bỏ lọc {PO_STATUS[selectedStatus].label.toLowerCase()}
              </button>
            )}
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <select value={selectedStoreId} onChange={(e) => setSelectedStoreId(e.target.value)} className={ui.select}>
          <option value="">Tất cả store</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        <select value={selectedSupplierId} onChange={(e) => setSelectedSupplierId(e.target.value)} className={ui.select}>
          <option value="">Tất cả xưởng</option>
          {suppliers.map((sp) => (
            <option key={sp.id} value={sp.id}>
              {sp.code} · {sp.name}
            </option>
          ))}
        </select>

        <div className="relative w-72">
          <MagnifyingGlassIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-(--ff-muted)" />
          <input
            type="text"
            placeholder="PO, store, SKU"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`${ui.input} pl-9`}
          />
        </div>
      </div>

      <div className={`${ui.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-(--ff-line) bg-(--ff-bg)">
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
              {loading ? (
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
                  <tr key={p.id} onClick={() => setSelectedPoId(p.id)} className="h-12 cursor-pointer transition-colors duration-150 hover:bg-(--ff-bg)">
                    <td className="py-2 pr-3 pl-6">
                      <CodeTag>{p.po_number}</CodeTag>
                      {p.notes && <p className="mt-1 max-w-xs truncate text-xs text-(--ff-muted)">{p.notes}</p>}
                    </td>
                    <td className="px-3 text-(--ff-text)">{p.store_name}</td>
                    <td className="px-3 font-mono text-xs text-(--ff-text-2)">{p.supplier_code || p.supplier_name}</td>
                    <td className="px-3 font-mono text-xs text-(--ff-text-2)">{p.order_date}</td>
                    <td className="px-3 font-mono text-xs text-(--ff-text-2)">{p.target_date || "—"}</td>
                    <td className="px-3 text-right text-(--ff-text-2)">{p.line_count ?? 0}</td>
                    <td className="px-3 text-right">{fmtInt(p.total_quantity)}</td>
                    <td className="px-3 text-right">{fmtMoney(p.total_amount)}</td>
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
      </div>

      <CreatePoModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={(newPoId) => {
          setSelectedPoId(newPoId);
          void fetchPos();
        }}
        stores={stores}
        suppliers={suppliers}
        defaultStoreId={selectedStoreId}
        defaultSupplierId={selectedSupplierId}
      />
    </div>
  );
}
