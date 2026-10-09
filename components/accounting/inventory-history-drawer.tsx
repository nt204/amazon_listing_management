"use client";

import { useEffect, useState } from "react";
import {
  ArrowCounterClockwiseIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { InventoryHistoryItem } from "@/lib/accounting/inventory-db";

interface InventoryHistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  storeId: string;
  storeName?: string;
  entityType?: "sku" | "inbound";
  entityId?: string;
  entityTitle?: string;
  onRestored?: () => void;
}

const FIELD_LABELS: Record<string, string> = {
  sku: "Mã SKU",
  brand: "Brand",
  product_type: "Loại sản phẩm",
  mockup: "Mockup",
  mockup_url: "Mockup URL",
  asin: "ASIN",
  fnsku: "FNSKU",
  amazon_fee: "Phí Amazon ($)",
  referral_fee_pct: "Referral Fee (%)",
  pic_mkt: "PIC MKT",
  loai: "Loại",
  niche: "Niche",
  pic_idea: "PIC Idea",
  status: "Trạng thái",
  event: "Event",
  tinh_trang: "Tình trạng",
  design_pic: "Design PIC",
  thang_listing: "Tháng Listing",
  thang_danh_gia: "Tháng Đánh Giá",
  event_250th: "Event 250th",
  ngay_danh_gia_sku_event: "Ngày ĐG SKU Event",
  amazon_fba_fee_thay_doi: "FBA Fee Thay Đổi ($)",
  basecost_tb: "Basecost TB ($)",
  brand_entity_id: "Brand Entity ID",
  creative_asins_video: "Creative ASINs Video",
  creative_asins_collection: "Creative Collection",
  video_media_ids: "Video Media IDs",
  creative_headline: "Creative Headline",
  brand_logo_asset_id: "Logo Asset ID",
  landing_page_url: "Landing Page URL",
  // Inbound fields
  ten_lo_hang: "Tên lô hàng",
  shipment_id: "Shipment ID",
  quantity: "Số lượng",
  sup: "Supplier",
  line_ship: "Line Ship",
  base_cost_per_unit: "Basecost/SP",
  card: "Card",
  tag: "Tag",
  shipping_fee: "Cước vận chuyển",
  hop_tui: "Hộp/Túi",
  final_basecost: "Final Basecost",
  total_basecost: "Tổng Basecost",
  ngay_request: "Ngày Request",
  ngay_thanh_toan: "Ngày Thanh Toán",
  ngay_di: "Ngày Đi",
  ngay_den: "Ngày Đến",
  amazon_received: "Amazon Received",
  tinh_trang_hang_den_kho: "Tình Trạng Hàng Đến",
  so_luong_amazon_nhan: "SL Amazon Nhận",
  discrepancy: "Chênh lệch (Discrepancy)",
  note: "Ghi chú",
  trang_thai: "Trạng thái lô hàng",
};

function formatHistoryDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function getRelativeTime(dateStr: string): string {
  try {
    const d = new Date(dateStr).getTime();
    const now = Date.now();
    const diffSec = Math.floor((now - d) / 1000);
    if (diffSec < 45) return "Vừa xong";
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} phút trước`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} giờ trước`;
    return `${Math.floor(diffSec / 86400)} ngày trước`;
  } catch {
    return "";
  }
}

export function InventoryHistoryDrawer({
  isOpen,
  onClose,
  storeId,
  storeName,
  entityType,
  entityId,
  entityTitle,
  onRestored,
}: InventoryHistoryDrawerProps) {
  const [history, setHistory] = useState<InventoryHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<"all" | "sku" | "inbound">(
    entityType || "all"
  );

  useEffect(() => {
    if (!isOpen || !storeId) return;

    let isMounted = true;
    const fetchHistory = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ store_id: storeId });
        if (entityId) {
          params.append("entity_id", entityId);
        }
        const effectiveType = entityId
          ? entityType
          : activeFilter !== "all"
          ? activeFilter
          : undefined;
        if (effectiveType) {
          params.append("entity_type", effectiveType);
        }

        const res = await fetch(`/api/accounting/inventory/history?${params}`);
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Không thể tải lịch sử.");
        }
        const data = await res.json();
        if (isMounted) {
          setHistory(data.history || []);
        }
      } catch (err) {
        if (isMounted) setError((err as Error).message);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchHistory();
    return () => {
      isMounted = false;
    };
  }, [isOpen, storeId, entityId, entityType, activeFilter]);

  const handleRestore = async (item: InventoryHistoryItem) => {
    if (!confirm(`Bạn có chắc chắn muốn khôi phục phiên bản lúc ${formatHistoryDate(item.created_at)}?`)) {
      return;
    }

    setRestoringId(item.id);
    try {
      const res = await fetch("/api/accounting/inventory/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_id: storeId,
          history_id: item.id,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không thể khôi phục phiên bản.");

      onRestored?.();
      // Refetch history
      const params = new URLSearchParams({ store_id: storeId });
      if (entityId) params.append("entity_id", entityId);
      if (entityType) params.append("entity_type", entityType);
      const refetchRes = await fetch(`/api/accounting/inventory/history?${params}`);
      if (refetchRes.ok) {
        const refetchData = await refetchRes.json();
        setHistory(refetchData.history || []);
      }
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setRestoringId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden animate-in fade-in duration-200">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 flex max-w-full pl-10">
        <div className="w-screen max-w-xl bg-white shadow-2xl flex flex-col border-l border-slate-200">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-xs">
                <ClockCounterClockwiseIcon size={20} weight="bold" />
              </span>
              <div>
                <h2 className="text-base font-extrabold text-slate-900">
                  Lịch Sử Thay Đổi & Khôi Phục
                </h2>
                <p className="text-xs text-slate-500">
                  Store: <strong className="text-indigo-700">{storeName || "Hiện tại"}</strong>
                  {entityTitle && (
                    <span className="ml-1.5 font-mono text-slate-700">
                      • {entityType === "sku" ? "SKU" : "Lô hàng"}: <strong>{entityTitle}</strong>
                    </span>
                  )}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition cursor-pointer"
            >
              <XIcon size={20} />
            </button>
          </div>

          {/* Filter Bar (if viewing store-wide) */}
          {!entityId && (
            <div className="flex items-center gap-1 border-b border-slate-200 px-6 py-2 bg-white text-xs">
              <span className="text-slate-400 font-medium mr-2">Lọc theo:</span>
              <button
                type="button"
                onClick={() => setActiveFilter("all")}
                className={`px-2.5 py-1 rounded-md font-semibold transition cursor-pointer ${
                  activeFilter === "all"
                    ? "bg-indigo-600 text-white shadow-2xs"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                Tất cả
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter("sku")}
                className={`px-2.5 py-1 rounded-md font-semibold transition cursor-pointer ${
                  activeFilter === "sku"
                    ? "bg-indigo-600 text-white shadow-2xs"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                Tổng kho (SKU Master)
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter("inbound")}
                className={`px-2.5 py-1 rounded-md font-semibold transition cursor-pointer ${
                  activeFilter === "inbound"
                    ? "bg-indigo-600 text-white shadow-2xs"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                Chi Tiết Đi Hàng
              </button>
            </div>
          )}

          {/* Content Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400 space-y-3">
                <ClockCounterClockwiseIcon size={32} className="animate-spin text-indigo-500" />
                <p className="text-xs">Đang tải lịch sử phiên bản...</p>
              </div>
            ) : error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700">
                {error}
              </div>
            ) : history.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400 space-y-2">
                <ClockCounterClockwiseIcon size={40} className="text-slate-300" />
                <p className="text-sm font-bold text-slate-600">Chưa có lịch sử thay đổi</p>
                <p className="text-xs text-slate-400 max-w-xs text-center">
                  Mọi thao tác tạo mới, sửa ô dữ liệu hoặc xóa đều sẽ được ghi nhận tự động tại đây.
                </p>
              </div>
            ) : (
              <div className="relative border-l-2 border-slate-200 pl-4 ml-3 space-y-5">
                {history.map((item) => {
                  const actionMeta = getActionMeta(item.action);
                  const diffEntries = getDiffEntries(item.before_data, item.after_data);
                  const afterObj = (item.after_data || {}) as Record<string, any>;
                  const beforeObj = (item.before_data || {}) as Record<string, any>;
                  const itemLabel = String(
                    afterObj.sku ||
                    beforeObj.sku ||
                    afterObj.ten_lo_hang ||
                    beforeObj.ten_lo_hang ||
                    "Bản ghi"
                  );

                  return (
                    <div key={item.id} className="relative group">
                      {/* Timeline dot */}
                      <span
                        className={`absolute -left-[23px] top-1.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white ring-2 ${actionMeta.ringClass}`}
                      />

                      <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs hover:shadow-xs transition space-y-2">
                        {/* Header card */}
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${actionMeta.badgeClass}`}
                              >
                                {actionMeta.label}
                              </span>
                              <span className="font-mono text-xs font-bold text-slate-900">
                                {item.entity_type === "sku" ? "SKU" : "Lô hàng"}: {itemLabel}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              {formatHistoryDate(item.created_at)} ({getRelativeTime(item.created_at)}) • Bởi{" "}
                              <strong className="text-slate-600 font-medium">{item.changed_by || "system"}</strong>
                            </p>
                          </div>

                          {/* Restore button */}
                          {item.action !== "restore" && (
                            <button
                              type="button"
                              disabled={restoringId === item.id}
                              onClick={() => handleRestore(item)}
                              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-50"
                              title="Khôi phục dữ liệu về trạng thái trước thay đổi này"
                            >
                              <ArrowCounterClockwiseIcon size={13} weight="bold" />
                              {restoringId === item.id ? "Đang phục hồi..." : "Khôi phục"}
                            </button>
                          )}
                        </div>

                        {/* Diff display */}
                        {item.action === "update" && diffEntries.length > 0 && (
                          <div className="rounded-lg bg-slate-50 p-2 text-xs space-y-1 border border-slate-100">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                              Chi tiết thay đổi ({diffEntries.length} trường):
                            </p>
                            {diffEntries.map(([field, { oldVal, newVal }]) => (
                              <div key={field} className="flex items-baseline gap-1 text-[11px] font-mono leading-tight">
                                <span className="text-slate-500 shrink-0 font-sans font-bold">
                                  {FIELD_LABELS[field] || field}:
                                </span>
                                <span className="line-through text-rose-500 bg-rose-50 px-1 rounded truncate max-w-[140px]" title={String(oldVal)}>
                                  {oldVal === null || oldVal === undefined || oldVal === "" ? "—" : String(oldVal)}
                                </span>
                                <span className="text-slate-400">➔</span>
                                <span className="text-emerald-700 font-bold bg-emerald-50 px-1 rounded truncate max-w-[140px]" title={String(newVal)}>
                                  {newVal === null || newVal === undefined || newVal === "" ? "—" : String(newVal)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        {item.action === "delete" && (
                          <div className="rounded-lg bg-rose-50 border border-rose-100 p-2 text-xs text-rose-700 flex items-center gap-1.5">
                            <TrashIcon size={14} className="shrink-0 text-rose-500" />
                            <span>Đã xóa dòng này vào thùng rác (soft delete). Bấm nút &quot;Khôi phục&quot; để đưa lại vào bảng.</span>
                          </div>
                        )}

                        {item.action === "create" && (
                          <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-2 text-xs text-emerald-800 flex items-center gap-1.5">
                            <CheckCircleIcon size={14} className="shrink-0 text-emerald-600" />
                            <span>Tạo mới dòng dữ liệu thành công.</span>
                          </div>
                        )}

                        {item.action === "restore" && (
                          <div className="rounded-lg bg-purple-50 border border-purple-100 p-2 text-xs text-purple-800 flex items-center gap-1.5">
                            <ArrowCounterClockwiseIcon size={14} className="shrink-0 text-purple-600" />
                            <span>Khôi phục bản ghi từ phiên bản trước đó.</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function getActionMeta(action: string) {
  switch (action) {
    case "create":
      return {
        label: "Tạo mới",
        badgeClass: "bg-emerald-100 text-emerald-800",
        ringClass: "ring-emerald-500 bg-emerald-500",
      };
    case "update":
      return {
        label: "Cập nhật",
        badgeClass: "bg-sky-100 text-sky-800",
        ringClass: "ring-sky-500 bg-sky-500",
      };
    case "delete":
      return {
        label: "Đã xóa",
        badgeClass: "bg-rose-100 text-rose-800",
        ringClass: "ring-rose-500 bg-rose-500",
      };
    case "restore":
      return {
        label: "Khôi phục",
        badgeClass: "bg-purple-100 text-purple-800",
        ringClass: "ring-purple-500 bg-purple-500",
      };
    default:
      return {
        label: action,
        badgeClass: "bg-slate-100 text-slate-800",
        ringClass: "ring-slate-400 bg-slate-400",
      };
  }
}

function getDiffEntries(before: any, after: any): [string, { oldVal: any; newVal: any }][] {
  if (!before || !after) return [];
  const ignored = new Set(["id", "store_id", "created_at", "updated_at", "last_changed_by", "deleted_at", "custom_fields"]);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const diffs: [string, { oldVal: any; newVal: any }][] = [];

  for (const k of keys) {
    if (ignored.has(k)) continue;
    const b = before[k] ?? null;
    const a = after[k] ?? null;
    // Normalize floats or empty strings
    const strB = b === null ? "" : String(b).trim();
    const strA = a === null ? "" : String(a).trim();
    if (strB !== strA) {
      diffs.push([k, { oldVal: b, newVal: a }]);
    }
  }

  return diffs;
}
