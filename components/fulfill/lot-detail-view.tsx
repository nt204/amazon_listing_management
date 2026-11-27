"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ArrowLeftIcon, ArrowSquareOutIcon, FileXlsIcon, PrinterIcon, TrashIcon } from "@phosphor-icons/react";
import { isLotEditField, LOT_COLUMNS, type LotColumn, type LOT_EDIT_FIELDS } from "@/lib/fulfill/lot-columns";
import type { FulfillLot, FulfillLotLine } from "@/lib/fulfill/types";
import { LotStageLabel, MockupThumbnail, Notice, StoreDot, fmtInt, fmtMoney, ui } from "./fulfill-ui";

interface LotDetailViewProps {
  storeId: string;
  lotName: string;
  storeColor?: string;
  onBack: () => void;
}

type EditField = keyof typeof LOT_EDIT_FIELDS;
type Drafts = Record<string, Partial<Record<EditField, string>>>;
type DetailData = {
  lot: FulfillLot;
  lines: FulfillLotLine[];
  versions: Record<string, string>;
  canDelete: boolean;
  canEdit: boolean;
  canEditLotIdentity: boolean;
};
type FillRange = { start: number; end: number; field: EditField };
type FillDrag = FillRange & { value: string; y: number; x: number; frame: number };

function focusCellInput(input: HTMLInputElement | null) {
  input?.focus({ preventScroll: true });
}

function cell(line: FulfillLotLine, column: LotColumn) {
  const value = line[column.key];
  if (column.kind === "image") {
    if (typeof value !== "string" || !value.trim()) return <MockupThumbnail url={null} size={56} />;
    return (
      <a href={value} target="_blank" rel="noreferrer" className={`${ui.link} inline-block align-middle`} aria-label={`View mockup for ${line.sku}`}>
        <MockupThumbnail url={value} size={56} />
      </a>
    );
  }
  if (value === null || value === undefined || value === "") return <span className="text-(--ff-muted)">—</span>;
  switch (column.kind) {
    case "money":
      return fmtMoney(Number(value));
    case "int":
      return fmtInt(Number(value));
    case "link":
      return (
        <a href={String(value)} target="_blank" rel="noreferrer" className={ui.link}>Open link</a>
      );
    case "text":
      if (column.key === "sku" || column.key === "shipment_id" || column.key === "fnsku") {
        return <span className="font-mono text-xs">{String(value)}</span>;
      }
      return String(value);
    default:
      return String(value);
  }
}

export function LotDetailView({ storeId, lotName, storeColor, onBack }: LotDetailViewProps) {
  const [data, setData] = useState<DetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{ id: string; field: EditField } | null>(null);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [fillRange, setFillRange] = useState<FillRange | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<FillDrag | null>(null);
  const query = new URLSearchParams({ storeId, lot: lotName }).toString();

  useEffect(() => () => {
    if (drag.current) cancelAnimationFrame(drag.current.frame);
    drag.current = null;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/fulfill/lots/detail?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
        if (!controller.signal.aborted) setData(body);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message || "Could not load the shipment lot.");
      });
    return () => controller.abort();
  }, [query]);

  const lot = data?.lot;
  const lines = data?.lines ?? [];
  const active = lines.filter((l) => l.stage !== "cancelled");
  const totalQty = active.reduce((a, l) => a + l.quantity, 0);
  const totalAmount = active.reduce((a, l) => a + l.real_total, 0);
  const totalReceived = active.reduce((a, l) => a + (l.so_luong_amazon_nhan ?? 0), 0);
  const hasChanges = Object.keys(drafts).length > 0;

  const setValues = (targets: FulfillLotLine[], field: EditField, value: string) => {
    setDrafts((previous) => {
      const next = { ...previous };
      for (const line of targets) {
        const fields = { ...next[line.id] };
        if (value === String(line[field] ?? "")) delete fields[field];
        else fields[field] = value;
        if (Object.keys(fields).length) next[line.id] = fields;
        else delete next[line.id];
      }
      return next;
    });
  };

  const updateFillTarget = (current: FillDrag) => {
    const container = scroller.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const top = Math.max(rect.top, 0);
    const bottom = Math.min(rect.bottom, window.innerHeight);
    if (bottom <= top + 2) return;
    const target = document.elementFromPoint(
      Math.max(rect.left + 1, Math.min(rect.right - 1, current.x)),
      Math.max(top + 1, Math.min(bottom - 1, current.y)),
    )?.closest<HTMLTableRowElement>("tr[data-lot-row]");
    if (!target || !container.contains(target)) return;
    const end = Math.max(current.start, Number(target.dataset.lotRow));
    if (end !== current.end) {
      current.end = end;
      setFillRange({ start: current.start, end, field: current.field });
    }
  };

  const startFill = (event: PointerEvent<HTMLButtonElement>, index: number, field: EditField, value: string) => {
    if (event.button !== 0 || drag.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const current: FillDrag = { start: index, end: index, field, value, x: event.clientX, y: event.clientY, frame: 0 };
    drag.current = current;
    setFillRange({ start: index, end: index, field });
  };

  const moveFill = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current) return;
    current.x = event.clientX;
    current.y = event.clientY;
    updateFillTarget(current);
    if (current.frame) return;
    const scroll = () => {
      const container = scroller.current;
      if (drag.current !== current || !container) return;
      const rect = container.getBoundingClientRect();
      if (current.y >= Math.min(rect.bottom, window.innerHeight) - 28) container.scrollTop += 10;
      else if (current.y <= Math.max(rect.top, 0) + 28) container.scrollTop -= 10;
      updateFillTarget(current);
      current.frame = requestAnimationFrame(scroll);
    };
    current.frame = requestAnimationFrame(scroll);
  };

  const finishFill = (apply: boolean) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    cancelAnimationFrame(current.frame);
    setFillRange(null);
    if (apply && current.end > current.start) {
      setValues(lines.slice(current.start + 1, current.end + 1), current.field, current.value);
    }
  };

  const cancelEditing = () => {
    finishFill(false);
    setDrafts({});
    setSelectedCell(null);
    setActionError(null);
  };

  const saveChanges = async () => {
    if (!data?.canEdit || !hasChanges || saving) return;
    setSaving(true);
    setActionError(null);
    try {
      const edits = Object.entries(drafts).map(([id, fields]) => ({ id, version: data.versions[id], fields }));
      const response = await fetch(`/api/fulfill/lots/detail?${query}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(edits),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save shipment lot changes.");
      setData(result);
      cancelEditing();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not save shipment lot changes.");
    } finally {
      setSaving(false);
    }
  };

  const deleteLot = async () => {
    if (deleting || !data?.canDelete || !window.confirm(`Delete “${lotName}” and all its SKU lines?`)) return;
    setDeleting(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/fulfill/lots/detail?${query}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 403 || response.status === 404 || response.status === 409) {
          setData((current) => current && { ...current, canDelete: false, canEdit: false });
        }
        throw new Error(result.error || "Could not delete the shipment lot.");
      }
      onBack();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not delete the shipment lot.");
    } finally {
      setDeleting(false);
    }
  };

  const renderCell = (line: FulfillLotLine, column: LotColumn, index: number) => {
    const field = column.key;
    if (!data?.canEdit || !isLotEditField(field) ||
        (!data?.canEditLotIdentity && (field === "sup" || field === "ngay_request"))) {
      return cell(line, column);
    }
    const draft = drafts[line.id]?.[field];
    const original = String(line[field] ?? "");
    const value = draft ?? original;
    const inFillRange = fillRange?.field === field && index >= fillRange.start && index <= fillRange.end;
    const isActive = selectedCell?.id === line.id && selectedCell.field === field;
    const numeric = column.kind === "money" || column.kind === "int";
    const link = column.kind === "link";
    return (
      <div className="flex items-center gap-2">
        <div className={`relative min-h-9 flex-1 ${column.kind === "date" ? "min-w-32" : "min-w-24"}`}>
          <button
            type="button"
            aria-label={`Edit ${column.header} for ${line.sku}`}
            disabled={saving || deleting}
            onMouseDown={(event) => {
              if (event.button === 0) event.preventDefault();
            }}
            onClick={() => {
              setActionError(null);
              setSelectedCell({ id: line.id, field });
            }}
            className={`relative block min-h-9 w-full cursor-text rounded-sm text-inherit hover:outline-1 hover:outline-(--ff-accent) focus-visible:outline-2 focus-visible:outline-(--ff-accent) ${numeric ? "text-right" : "text-left"} ${link ? "max-w-40 truncate" : ""} ${isActive ? "invisible" : ""} ${inFillRange || draft !== undefined ? "bg-(--ff-accent-soft)" : ""}`}
          >
            <span className={draft === undefined ? undefined : "invisible"}>{link ? original || "—" : cell(line, column)}</span>
            {draft !== undefined && <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 truncate">{draft || "—"}</span>}
          </button>
          {isActive && (
            <>
              <input
                ref={focusCellInput}
                aria-label={`${column.header} for ${line.sku}`}
                type={column.kind === "date" ? "date" : "text"}
                inputMode={column.kind === "money" ? "decimal" : column.kind === "int" ? "numeric" : undefined}
                value={value}
                disabled={saving}
                onChange={(event) => setValues([line], field, event.target.value)}
                className={`absolute inset-0 h-full w-full min-w-0 rounded-md border border-(--ff-line-strong) px-2 text-sm outline-none focus:border-(--ff-accent) focus:ring-1 focus:ring-(--ff-accent) ${numeric ? "text-right" : ""} ${inFillRange ? "bg-(--ff-accent-soft)" : "bg-(--ff-card)"}`}
              />
              {index < lines.length - 1 && (
                <button
                  type="button"
                  aria-label={`Fill down ${column.header} from ${line.sku}`}
                  title="Drag down to copy"
                  disabled={saving}
                  onPointerDown={(event) => startFill(event, index, field, value)}
                  onPointerMove={moveFill}
                  onPointerUp={(event) => {
                    event.preventDefault();
                    finishFill(true);
                  }}
                  onPointerCancel={() => finishFill(false)}
                  onLostPointerCapture={() => finishFill(false)}
                  onClick={(event) => {
                    if (event.detail === 0) setValues([lines[index + 1]], field, value);
                  }}
                  className="absolute -right-1 -bottom-1 z-10 grid size-4 touch-none cursor-crosshair place-items-center rounded-sm text-(--ff-accent) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--ff-accent)"
                >
                  <span aria-hidden className="size-2.5 rounded-[2px] border border-white bg-(--ff-accent)" />
                </button>
              )}
            </>
          )}
        </div>
        {link && original && (
          <a href={original} target="_blank" rel="noreferrer" aria-label={`Open ${column.header} for ${line.sku}`} className={ui.link}>
            <ArrowSquareOutIcon size={16} aria-hidden />
          </a>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <button type="button" onClick={() => {
          if (!hasChanges || window.confirm("Discard unsaved changes?")) onBack();
        }} disabled={saving} className={ui.btnGhost}>
          <ArrowLeftIcon size={16} aria-hidden />
          Back to lots
        </button>
        <div className="grid min-w-0 max-w-full">
          <div className={`col-start-1 row-start-1 flex flex-wrap items-center justify-end gap-2 ${hasChanges ? "" : "invisible"}`}>
            <button type="button" onClick={cancelEditing} disabled={saving} className={ui.btnGhost}>Cancel</button>
            <button type="button" onClick={saveChanges} disabled={!hasChanges || saving} className={ui.btnPrimary}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
          <div className={`col-start-1 row-start-1 flex flex-wrap items-center justify-end gap-2 ${hasChanges ? "invisible" : ""}`}>
            {data?.canDelete && (
              <button type="button" onClick={deleteLot} disabled={deleting} className={`${ui.btnGhost} text-(--ff-neg)! hover:bg-red-50! disabled:opacity-50`}>
                <TrashIcon size={16} aria-hidden />
                {deleting ? "Deleting…" : "Delete lot"}
              </button>
            )}
            <button type="button" onClick={() => window.print()} className={ui.btnSecondary} disabled={!data}>
              <PrinterIcon size={16} aria-hidden />
              Print lot
            </button>
            <a href={`/api/fulfill/lots/export?${query}`} download className={ui.btnPrimary}>
              <FileXlsIcon size={16} aria-hidden />
              Download supplier Excel
            </a>
          </div>
        </div>
      </div>
      {actionError && <Notice tone="error" onClose={() => setActionError(null)}>{actionError}</Notice>}

      <div className={`${ui.card} px-5 py-5 sm:px-6`}>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 text-xl font-bold tracking-tight text-(--ff-text) [overflow-wrap:anywhere] sm:text-2xl">{lotName}</h1>
          {lot && <LotStageLabel stage={lot.stage} />}
        </div>
        {lot && (
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <div>
              <dt className="text-xs text-(--ff-muted)">Store</dt>
              <dd className="mt-0.5 inline-flex items-center gap-2 font-medium">
                <StoreDot color={storeColor} />
                {lot.store_name}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-(--ff-muted)">Supplier</dt>
              <dd className="mt-0.5 font-medium">{lot.sup || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-(--ff-muted)">Request date</dt>
              <dd className="mt-0.5 font-medium">
                {lot.first_request || "—"}
                {lot.last_request && lot.last_request !== lot.first_request ? ` → ${lot.last_request}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-(--ff-muted)">SKUs · Units</dt>
              <dd className="mt-0.5 font-medium">{lot.sku_count} · {fmtInt(lot.quantity)}</dd>
            </div>
            <div>
              <dt className="text-xs text-(--ff-muted)">Total</dt>
              <dd className="mt-0.5 font-semibold text-(--ff-accent)">{fmtMoney(lot.amount)}</dd>
            </div>
            <div>
              <dt className="text-xs text-(--ff-muted)">Paid</dt>
              <dd className="mt-0.5 font-medium">
                {fmtMoney(lot.paid_amount)}
                {lot.amount - lot.paid_amount > 0.005 && (
                  <span className="text-(--ff-muted)"> · {fmtMoney(lot.amount - lot.paid_amount)} remaining</span>
                )}
              </dd>
            </div>
          </dl>
        )}
        {lot && lot.shipment_ids.length > 0 && (
          <p className="mt-3 text-xs text-(--ff-muted)">
            Shipment ID: <span className="font-mono">{lot.shipment_ids.join(", ")}</span>
            {lot.units_expected > 0 && ` · Amazon received ${fmtInt(lot.units_located)}/${fmtInt(lot.units_expected)}`}
          </p>
        )}
      </div>

      <section className={`${ui.card} overflow-hidden`} aria-label="Lot details">
        <div ref={scroller} className={data?.canEdit ? "max-h-[65dvh] overflow-auto print:max-h-none" : "overflow-x-auto"}>
          <table className="w-full border-collapse text-left text-sm whitespace-nowrap print:text-[9px]">
            <thead className="bg-(--ff-table-head) [&_th]:text-sm [&_th]:text-white print:bg-white print:[&_th]:text-black">
              <tr>
                <th scope="col" className={`${ui.th} pl-4 text-right`}>#</th>
                {LOT_COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={`${ui.th} ${c.kind === "money" || c.kind === "int" ? "text-right" : ""}`}
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-(--ff-line)">
              {error ? (
                <tr>
                  <td colSpan={LOT_COLUMNS.length + 1} className="py-12 text-center text-(--ff-neg)">{error}</td>
                </tr>
              ) : !data ? (
                <tr>
                  <td colSpan={LOT_COLUMNS.length + 1} className="py-16 text-center text-(--ff-muted)">Loading lot details…</td>
                </tr>
              ) : (
                lines.map((line, index) => (
                  <tr
                    key={line.id}
                    data-lot-row={index}
                    className={`h-11 hover:bg-neutral-50 ${line.stage === "cancelled" ? "text-(--ff-muted) line-through" : ""}`}
                    title={line.stage === "cancelled" ? "Canceled line, excluded from totals" : undefined}
                  >
                    <td className="pr-2 pl-4 text-right text-xs text-(--ff-muted)">{index + 1}</td>
                    {LOT_COLUMNS.map((c) => (
                      <td
                        key={c.key}
                        className={`px-3 py-2 ${c.kind === "money" || c.kind === "int" ? "text-right tabular-nums" : ""} ${c.key === "real_total" ? "font-semibold" : ""} ${c.key === "note" ? "max-w-64 truncate" : ""}`}
                        title={c.key === "note" && line.note ? line.note : undefined}
                      >
                        {renderCell(line, c, index)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
            {data && lines.length > 0 && (
              <tfoot>
                <tr className="h-12 border-t border-(--ff-line-strong) bg-[#f5f5f5] font-bold print:bg-white">
                  <th colSpan={2} scope="row" className="px-4 text-left">Total</th>
                  {LOT_COLUMNS.slice(1).map((c) => (
                    <td key={c.key} className={`px-3 ${c.kind === "money" || c.kind === "int" ? "text-right tabular-nums" : ""}`}>
                      {c.key === "quantity"
                        ? fmtInt(totalQty)
                        : c.key === "real_total"
                          ? fmtMoney(totalAmount)
                          : c.key === "so_luong_amazon_nhan" && totalReceived > 0
                            ? fmtInt(totalReceived)
                            : ""}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>
    </div>
  );
}
