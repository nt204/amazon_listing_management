"use client";

import { useEffect, useState, useCallback } from "react";
import { ArrowLeftIcon, FileXlsIcon, PlusIcon, PrinterIcon, TrashIcon } from "@phosphor-icons/react";
import type { FulfillPo, FulfillPoLine, FulfillPoStatus } from "@/lib/fulfill/types";
import { Notice, PO_STATUS, fmtInt, fmtMoney, ui } from "./fulfill-ui";

interface PoDetailViewProps {
  poId: string;
  onBack: () => void;
}

type CellKind = "text" | "upper" | "int" | "money" | "nullableInt" | "date";

const COST_FIELDS = ["quantity", "basecost", "fee_card", "fee_tag", "fee_stand", "fee_box"];

function parseCell(kind: CellKind, raw: string): unknown {
  switch (kind) {
    case "upper":
      return raw.trim().toUpperCase();
    case "text":
      return raw.trim();
    case "int":
    case "money":
      return Number(raw) || 0;
    case "nullableInt":
      return raw ? Number(raw) : null;
    case "date":
      return raw || null;
  }
}

// Ranh giới giữa các nhóm cột (bên mình điền / đóng gói FBA / xưởng cập nhật)
const GROUP_EDGE = "border-l border-(--ff-line-strong)";

export function PoDetailView({ poId, onBack }: PoDetailViewProps) {
  const [po, setPo] = useState<FulfillPo | null>(null);
  const [lines, setLines] = useState<FulfillPoLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  const fetchPo = useCallback(async () => {
    try {
      setLoading(true);
      setErrorNotice(null);
      const res = await fetch(`/api/fulfill/pos/${poId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không thể tải đợt hàng");
      setPo(data.po);
      setLines(data.lines || []);
    } catch (err: any) {
      setErrorNotice(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [poId]);

  useEffect(() => {
    void fetchPo();
  }, [fetchPo]);

  const handleStatusChange = async (newStatus: FulfillPoStatus) => {
    if (!po) return;
    try {
      setPo((prev) => (prev ? { ...prev, status: newStatus } : null));
      await fetch(`/api/fulfill/pos/${po.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch (err: any) {
      setErrorNotice(err.message || "Lỗi cập nhật trạng thái");
    }
  };

  const handleCellBlur = async (lineId: string, field: string, value: any, oldValue: any) => {
    if (value === oldValue) return;
    try {
      const res = await fetch(`/api/fulfill/pos/${poId}/lines/${lineId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, value }),
      });
      if (!res.ok) throw new Error("Lỗi lưu ô dữ liệu");

      setLines((prev) =>
        prev.map((l) => {
          if (l.id !== lineId) return l;
          const updated = { ...l, [field]: value };
          if (COST_FIELDS.includes(field)) {
            const unit =
              Number(updated.basecost || 0) +
              Number(updated.fee_card || 0) +
              Number(updated.fee_tag || 0) +
              Number(updated.fee_stand || 0) +
              Number(updated.fee_box || 0);
            updated.total_line_cost = Math.round(Number(updated.quantity || 0) * unit * 100) / 100;
          }
          return updated;
        }),
      );

      void fetchPo();
    } catch (err: any) {
      console.error(err);
      setErrorNotice("Không thể lưu thay đổi vào hệ thống");
    }
  };

  const handleAddNewLine = async () => {
    try {
      const res = await fetch(`/api/fulfill/pos/${poId}/lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: "NEW_SKU", quantity: 50, line_ship: "FBA Sea" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi thêm dòng");
      setLines((prev) => [...prev, data.line]);
      void fetchPo();
    } catch (err: any) {
      setErrorNotice(err.message);
    }
  };

  const handleDeleteLine = async (lineId: string) => {
    if (!confirm("Xóa dòng sản phẩm này?")) return;
    try {
      await fetch(`/api/fulfill/pos/${poId}/lines/${lineId}`, { method: "DELETE" });
      setLines((prev) => prev.filter((l) => l.id !== lineId));
      void fetchPo();
    } catch {
      setErrorNotice("Lỗi xóa dòng");
    }
  };

  if (loading && !po) {
    return <div className="py-24 text-center text-sm text-(--ff-muted)">Đang tải phiếu đợt hàng</div>;
  }

  if (!po) {
    return (
      <div className="py-24 text-center">
        <p className="text-sm text-(--ff-neg)">{errorNotice || "Không tìm thấy đợt hàng"}</p>
        <button type="button" onClick={onBack} className={`${ui.btnSecondary} mt-4`}>
          <ArrowLeftIcon size={16} />
          Về danh sách đợt
        </button>
      </div>
    );
  }

  /** Ô sửa trực tiếp: lưu khi rời ô, giống cách nhập trên sheet. */
  const cell = (line: FulfillPoLine, field: keyof FulfillPoLine, kind: CellKind, opts: { className?: string; placeholder?: string } = {}) => {
    const current = line[field] as any;
    const numeric = kind === "int" || kind === "money" || kind === "nullableInt";
    return (
      <input
        type={kind === "date" ? "date" : numeric ? "number" : "text"}
        step={kind === "money" ? "0.01" : undefined}
        min={kind === "int" ? "0" : undefined}
        defaultValue={current ?? ""}
        placeholder={opts.placeholder}
        onBlur={(e) => handleCellBlur(line.id, field, parseCell(kind, e.target.value), current)}
        className={`h-10 w-full bg-transparent px-3 ${opts.className?.includes("text-xs") ? "" : "text-sm"} text-(--ff-text) placeholder:text-(--ff-muted) focus:outline-none focus:ring-2 focus:ring-(--ff-accent) focus:ring-inset ${
          numeric ? "text-right" : ""
        } ${opts.className || ""}`}
      />
    );
  };

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <button type="button" onClick={onBack} className="inline-flex cursor-pointer items-center gap-2 text-sm text-(--ff-text-2) transition-colors duration-150 hover:text-(--ff-text)">
          <ArrowLeftIcon size={16} />
          Đợt hàng
        </button>
      </div>

      {/* Đầu phiếu sản xuất */}
      <section className={`${ui.card} print:border-0`}>
        <div className="flex flex-wrap items-start justify-between gap-5 p-4 sm:p-6">
          <div className="space-y-3">
            <div className="text-xs text-(--ff-muted)">Phiếu đặt sản xuất</div>
            <h1 className={ui.title}>{po.po_number}</h1>
            <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <div>
                <dt className="text-xs text-(--ff-muted)">Store</dt>
                <dd className="mt-0.5">{po.store_name || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-(--ff-muted)">Xưởng</dt>
                <dd className="mt-0.5">{po.supplier_name || po.supplier_code}</dd>
              </div>
              <div>
                <dt className="text-xs text-(--ff-muted)">Ngày đặt</dt>
                <dd className="mt-0.5 font-mono text-xs leading-5">{po.order_date}</dd>
              </div>
              <div>
                <dt className="text-xs text-(--ff-muted)">Hẹn giao</dt>
                <dd className="mt-0.5 font-mono text-xs leading-5">{po.target_date || "—"}</dd>
              </div>
            </dl>
          </div>

          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <label className="relative">
              <span className="sr-only">Trạng thái</span>
              <span className={`pointer-events-none absolute top-1/2 left-3 h-2 w-2 -translate-y-1/2 rounded-full ${PO_STATUS[po.status]?.dot}`} />
              <select value={po.status} onChange={(e) => handleStatusChange(e.target.value as FulfillPoStatus)} className={`${ui.select} pl-7`}>
                {(Object.keys(PO_STATUS) as FulfillPoStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {PO_STATUS[s].label}
                  </option>
                ))}
              </select>
            </label>
            <a href={`/api/fulfill/pos/${po.id}/export`} download className={ui.btnSecondary}>
              <FileXlsIcon size={16} />
              Xuất Excel
            </a>
            <button type="button" onClick={() => window.print()} className={ui.btnSecondary}>
              <PrinterIcon size={16} />
              In phiếu
            </button>
            <button type="button" onClick={handleAddNewLine} className={ui.btnPrimary}>
              <PlusIcon size={16} />
              Thêm dòng
            </button>
          </div>
        </div>

        <div className="border-t border-(--ff-line)">
          <dl className="grid grid-cols-3 sm:max-w-xl">
            <div className="px-3 py-3 sm:px-6 sm:py-4">
              <dt className="text-xs text-(--ff-muted)">Số SKU</dt>
              <dd className="mt-1 text-lg font-semibold sm:text-2xl">{lines.length}</dd>
            </div>
            <div className="border-l border-(--ff-line) px-3 py-3 sm:px-6 sm:py-4">
              <dt className="text-xs text-(--ff-muted)">Số lượng</dt>
              <dd className="mt-1 text-lg font-semibold sm:text-2xl">{fmtInt(po.total_quantity)}</dd>
            </div>
            <div className="border-l border-(--ff-line) px-3 py-3 sm:px-6 sm:py-4">
              <dt className="text-xs text-(--ff-muted)">Thành tiền</dt>
              <dd className="mt-1 break-words text-lg font-semibold text-(--ff-accent) sm:text-2xl">{fmtMoney(po.total_amount)}</dd>
            </div>
          </dl>
        </div>
      </section>

      {errorNotice && (
        <Notice tone="error" onClose={() => setErrorNotice(null)}>
          {errorNotice}
        </Notice>
      )}

      <div className={`${ui.card} overflow-hidden`}>
        <div className="relative max-h-[max(18rem,calc(100dvh-240px))] overflow-auto print:max-h-none">
          <table className="w-full border-collapse text-left text-sm whitespace-nowrap">
            <thead className="sticky top-0 z-20 bg-(--ff-head)">
              <tr className="border-b border-(--ff-line)">
                <th colSpan={14} className="px-3 pt-3 pb-1 text-xs font-medium text-(--ff-head-text)">
                  <span className="sticky left-3 inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-(--ff-accent)" />Bên mình điền</span>
                </th>
                <th colSpan={7} className={`${GROUP_EDGE} px-3 pt-3 pb-1 text-xs font-medium text-(--ff-head-text)`}>
                  <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-amber-500" />Đóng gói FBA</span>
                </th>
                <th colSpan={8} className={`${GROUP_EDGE} px-3 pt-3 pb-1 text-xs font-medium text-(--ff-head-text)`}>
                  <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-(--ff-pos)" />Xưởng cập nhật</span>
                </th>
              </tr>
              <tr className="border-b border-(--ff-line-strong)">
                <th className={`${ui.th} sticky left-0 z-10 w-10 min-w-10 bg-(--ff-head) text-right`}>#</th>
                <th className={`${ui.th} sticky left-10 z-10 min-w-44 border-r border-(--ff-line) bg-(--ff-head)`}>SKU</th>
                <th className={`${ui.th} min-w-36`}>Phôi</th>
                <th className={`${ui.th} min-w-24 text-right`}>Số lượng</th>
                <th className={`${ui.th} min-w-28 text-right`}>Basecost</th>
                <th className={`${ui.th} min-w-20 text-right`}>Card</th>
                <th className={`${ui.th} min-w-20 text-right`}>Tag</th>
                <th className={`${ui.th} min-w-20 text-right`}>Stand</th>
                <th className={`${ui.th} min-w-20 text-right`}>Box</th>
                <th className={`${ui.th} min-w-28 text-right`}>Thành tiền</th>
                <th className={`${ui.th} min-w-32`}>Line ship</th>
                <th className={`${ui.th} min-w-28`}>Kích thước</th>
                <th className={`${ui.th} min-w-40`}>Link thiết kế</th>
                <th className={`${ui.th} min-w-36`}>Link card</th>

                <th className={`${ui.th} ${GROUP_EDGE} min-w-36`}>Transparency</th>
                <th className={`${ui.th} min-w-36`}>FNSKU</th>
                <th className={`${ui.th} min-w-36`}>Label FNSKU</th>
                <th className={`${ui.th} min-w-40`}>Shipment ID</th>
                <th className={`${ui.th} min-w-24 text-right`}>Số thùng</th>
                <th className={`${ui.th} min-w-36`}>Shipping label</th>
                <th className={`${ui.th} min-w-40`}>Địa chỉ ship</th>

                <th className={`${ui.th} ${GROUP_EDGE} min-w-36`}>Ngày xuất xưởng</th>
                <th className={`${ui.th} min-w-36`}>Ngày tới kho</th>
                <th className={`${ui.th} min-w-24 text-right`}>Phí bù</th>
                <th className={`${ui.th} min-w-36`}>Link sample</th>
                <th className={`${ui.th} min-w-36`}>Link package</th>
                <th className={`${ui.th} min-w-28`}>Check</th>
                <th className={`${ui.th} min-w-40`}>Ghi chú</th>
                <th className={`${ui.th} w-12`}>
                  <span className="sr-only">Xóa</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--ff-line)">
              {lines.length === 0 && (
                <tr>
                  <td colSpan={29} className="py-12 text-center text-(--ff-muted)">
                    Đợt này chưa có dòng nào
                  </td>
                </tr>
              )}
              {lines.map((line, idx) => (
                <tr key={line.id} className="group transition-colors duration-150 hover:bg-(--ff-raised)">
                  <td className="sticky left-0 z-[1] w-10 min-w-10 bg-(--ff-card) px-3 text-right font-mono text-xs text-(--ff-muted) group-hover:bg-(--ff-raised)">{idx + 1}</td>
                  <td className="sticky left-10 z-[1] min-w-44 border-r border-(--ff-line) bg-(--ff-card) p-0 group-hover:bg-(--ff-raised)">{cell(line, "sku", "upper", { className: "font-mono text-xs font-medium" })}</td>
                  <td className="p-0">{cell(line, "product_type", "text")}</td>
                  <td className="p-0">{cell(line, "quantity", "int")}</td>
                  <td className="p-0">{cell(line, "basecost", "money")}</td>
                  <td className="p-0">{cell(line, "fee_card", "money", { className: "text-(--ff-text-2)" })}</td>
                  <td className="p-0">{cell(line, "fee_tag", "money", { className: "text-(--ff-text-2)" })}</td>
                  <td className="p-0">{cell(line, "fee_stand", "money", { className: "text-(--ff-text-2)" })}</td>
                  <td className="p-0">{cell(line, "fee_box", "money", { className: "text-(--ff-text-2)" })}</td>
                  <td className="px-3 text-right font-medium">{fmtMoney(line.total_line_cost)}</td>
                  <td className="p-0">{cell(line, "line_ship", "text")}</td>
                  <td className="p-0">{cell(line, "dimensions", "text")}</td>
                  <td className="p-0">{cell(line, "design_url", "text", { placeholder: "Dán link", className: "text-(--ff-text-2)" })}</td>
                  <td className="p-0">{cell(line, "card_url", "text", { placeholder: "Dán link", className: "text-(--ff-text-2)" })}</td>

                  <td className={`p-0 ${GROUP_EDGE}`}>{cell(line, "transparency_code", "text", { className: "font-mono text-xs" })}</td>
                  <td className="p-0">{cell(line, "fnsku", "text", { className: "font-mono text-xs" })}</td>
                  <td className="p-0">{cell(line, "label_fnsku", "text")}</td>
                  <td className="p-0">{cell(line, "shipment_id", "text", { className: "font-mono text-xs" })}</td>
                  <td className="p-0">{cell(line, "box_quantity", "nullableInt")}</td>
                  <td className="p-0">{cell(line, "shipping_label", "text")}</td>
                  <td className="p-0">{cell(line, "shipping_address", "text")}</td>

                  <td className={`p-0 ${GROUP_EDGE}`}>{cell(line, "shipping_out_date", "date")}</td>
                  <td className="p-0">{cell(line, "arrival_date", "date")}</td>
                  <td className="p-0">{cell(line, "replacement_fee", "money", { className: Number(line.replacement_fee) > 0 ? "text-(--ff-neg)" : "" })}</td>
                  <td className="p-0">{cell(line, "sample_url", "text", { placeholder: "Dán link", className: "text-(--ff-text-2)" })}</td>
                  <td className="p-0">{cell(line, "package_url", "text", { placeholder: "Dán link", className: "text-(--ff-text-2)" })}</td>
                  <td className="p-0">
                    <select
                      defaultValue={line.check_status || ""}
                      onChange={(e) => handleCellBlur(line.id, "check_status", e.target.value, line.check_status)}
                      className="h-10 w-full cursor-pointer bg-transparent px-3 text-sm text-(--ff-text) focus:ring-2 focus:ring-(--ff-accent) focus:outline-none focus:ring-inset"
                    >
                      <option value="">—</option>
                      <option value="ok">OK</option>
                      <option value="pending">Chờ check</option>
                      <option value="defect">Lỗi</option>
                      <option value="replaced">Đã bù</option>
                    </select>
                  </td>
                  <td className="p-0">{cell(line, "notes", "text", { placeholder: "Ghi chú", className: "text-(--ff-text-2)" })}</td>
                  <td className="px-2 text-center print:hidden">
                    <button type="button" onClick={() => handleDeleteLine(line.id)} className={ui.iconBtnDanger} title="Xóa dòng">
                      <TrashIcon size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
